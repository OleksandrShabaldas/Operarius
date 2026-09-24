import { NativeModule, requireOptionalNativeModule } from 'expo';

// ---------------------------------------------------------------------------
// Operarius files — the system "Save as" screen (Android). The user names the
// file and chooses where it goes (Downloads, Google Drive, any folder); only
// that one file is shared with the app.
// ---------------------------------------------------------------------------

declare class FilesNative extends NativeModule {
  saveAs(name: string, mime: string, text: string): Promise<{ uri: string; name: string } | null>;
}

const native = requireOptionalNativeModule<FilesNative>('OperariusFiles');

export const available = !!native;

/** Saves `text` where the user picks. null = they cancelled (or it's not available here). */
export async function saveAs(name: string, mime: string, text: string): Promise<{ uri: string; name: string } | null> {
  if (!native) return null;
  return native.saveAs(name, mime, text);
}
