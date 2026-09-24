package com.operarius.files

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The JS bridge (modules/files/index.ts): the system "Save as" screen
 * (ACTION_CREATE_DOCUMENT) — the user names the file and picks where it goes
 * (Downloads, Google Drive, any folder), and only that one file is shared
 * with the app.
 */
class FilesModule : Module() {
  companion object {
    private const val SAVE_AS = 0x0F11
  }

  private var pending: Pair<Promise, String>? = null

  override fun definition() = ModuleDefinition {
    Name("OperariusFiles")

    AsyncFunction("saveAs") { name: String, mime: String, text: String, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      pending?.first?.resolve(null)
      pending = promise to text
      val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
        .addCategory(Intent.CATEGORY_OPENABLE)
        .setType(mime)
        .putExtra(Intent.EXTRA_TITLE, name)
      try {
        activity.startActivityForResult(intent, SAVE_AS)
      } catch (_: Exception) {
        pending = null
        promise.resolve(null)
      }
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, payload ->
      if (payload.requestCode != SAVE_AS) return@OnActivityResult
      val (promise, text) = pending ?: return@OnActivityResult
      pending = null
      val uri = payload.data?.data
      if (payload.resultCode != Activity.RESULT_OK || uri == null) {
        promise.resolve(null)
        return@OnActivityResult
      }
      val ctx = appContext.reactContext
      if (ctx == null) {
        promise.resolve(null)
        return@OnActivityResult
      }
      Thread {
        try {
          ctx.contentResolver.openOutputStream(uri, "wt")?.use { it.write(text.toByteArray(Charsets.UTF_8)) } ?: throw IllegalStateException("Couldn't open the file")
          promise.resolve(mapOf("uri" to uri.toString(), "name" to (displayName(ctx, uri) ?: "")))
        } catch (e: Exception) {
          // The empty file the picker made is removed again.
          runCatching { android.provider.DocumentsContract.deleteDocument(ctx.contentResolver, uri) }
          promise.reject("ERR_SAVE", e.message ?: "Couldn't write the file", e)
        }
      }.start()
    }
  }

  private fun displayName(ctx: android.content.Context, uri: Uri): String? =
    runCatching {
      ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
    }.getOrNull()
}
