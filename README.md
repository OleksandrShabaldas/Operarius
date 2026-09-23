# Operarius

A phone scheduler app — a day-timeline planner. Tasks live on a vertical
timeline you can drag to reschedule, tap to edit, and check off. Built from the
Claude Design prototype as a real **React Native + Expo** app (Android-first,
cross-platform-ready).

Built with Expo SDK 57 (React Native 0.86, React 19), TypeScript, Reanimated 4 +
Gesture Handler, and react-native-svg.

## Features

- **Day timeline** — hour grid from your day-start to day-end, full-bleed
  "beginning/end of day" bands, and a live "now" line. Hour ticks and the now-line
  are mapped through the real card layout so they stay aligned. Elapsed tasks
  desaturate and dim; upcoming ones stay in full color.
- **Tasks** — emoji icon, color, title, start time, duration, an optional tag (or
  sub-tag), and a place. Long-press a card to **drag it to a new time** (snaps to
  5 min); tap to edit; tap the checkbox to complete (with haptics).
- **Free blocks & gaps** — larger gaps show a tappable "＋ Create a task" block
  (diagonal hatch feathered on all sides); small gaps show a compact "x min" pill.
  The pill-vs-block threshold is configurable in Settings.
- **Per-day scheduling** — a week strip to pick any day (tap), swipe the strip to
  change weeks, and dots mark days that have tasks.
- **Task editor** — a bottom sheet with start/duration steppers, a tag/sub-tag
  picker, a place picker, and a combined icon+color tile that opens a picker popup.
- **Tags, sub-tags & places** — create your own in Settings; tags can have
  sub-tags, and places show with a 📍 marker on cards.
- **Reminders** — per task: X minutes before it starts, X minutes after it
  ends, and any number of custom date-and-time reminders (relative ones follow
  the task when it moves and fire for every occurrence of a repeating task).
  Three intensities: **Easy** (a notification), **Medium** (a full-screen
  reminder over any app or the lock screen, one short buzz, and a
  notification) and **Intense** (a full-screen alarm that rings and vibrates in
  pulses until dismissed). Snooze, Done and Open task right from the
  notification or the reminder screen. Built on exact alarms and a foreground
  service, re-armed after reboots, app updates and time-zone changes, with a
  reliability checklist (notifications, full-screen alerts, overlay, battery
  optimization, vendor auto-start) in Settings → Reminders. The native side is
  a local Expo module in `modules/reminders`.
- **Stats** — completion ring, scheduled/completed/free hours, a scheduled-per-day
  bar chart (tap a bar to jump to that day), and time-by-tag bars.
- **Settings** (the ☰ menu) — day window, gap-pill threshold, week-start day,
  reminder defaults and alarm sound, animation speed, tag/sub-tag and place
  management, in-app update check, and data management.
- **Offline & persistent** — everything is stored on-device with AsyncStorage.
- **Self-updating** — checks GitHub Releases on launch and from Settings, then
  downloads and installs newer APKs.

## Run it on your Android phone

The app has its own native code (the reminders module, the keyboard
controller), so **Expo Go can't run it** — install a release APK (below), or
build a development build with the Android SDK installed:

```bash
npm install
npx expo run:android
```

`npx expo start --web` runs the UI in a browser (reminders don't ring there).

## Releases & the installable APK

APKs are built and published automatically by **GitHub Actions** — no Android
Studio or local Java needed. Each release is a GitHub Release with the `.apk`
attached at
[github.com/OleksandrShabaldas/Operarius/releases](https://github.com/OleksandrShabaldas/Operarius/releases).

To download: open the latest release on your phone, download the `.apk`, and
install it (allow "install from unknown sources" the first time).

### Cutting a new version

Either:

- **From GitHub** — Actions tab → **Build & Release APK** → **Run workflow** →
  type the version (e.g. `1.0.1`). It tags, builds, and publishes the release.
- **From your machine**:
  ```bash
  git tag v1.0.1 && git push origin v1.0.1
  ```

The workflow stamps the app's `version` from the tag and an auto-incrementing
`versionCode`, so the in-app updater will detect it.

### In-app updates

On launch (and via **Settings → Check for updates**), the app asks GitHub for the
latest release. If it's newer than the installed version, it shows an **Update
available** prompt; tapping **Update now** downloads the release APK and opens
Android's installer. This needs the `REQUEST_INSTALL_PACKAGES` permission (already
declared) and, the first time, you'll grant "install unknown apps" for the app.

### Signing

Release APKs are signed with the committed `signing/debug.keystore` (a standard,
non-secret debug key) so **every build shares one signature** — required for
updates to install over the previous version. For a Play Store release you'd swap
in a private keystore via repository secrets; for personal sideloading this is
fine.

## Project structure

```
App.tsx                     App root: providers, screens, sheets, splash
src/
  theme.ts                  Geometry constants + palette + option sets
  types.ts                  Task / Draft / Settings types
  utils.ts                  Time & date formatting/helpers
  layout.ts                 Pure timeline layout algorithm (ported from prototype)
  storage.ts                Repository interface + AsyncStorage impl + seed data
  store.tsx                 App state (tasks, settings) with persistence
  screens/
    TodayScreen.tsx         Header, week strip, timeline, drag wiring
    StatsScreen.tsx         Insights (ring, tiles, weekly chart, tag bars)
  components/
    Timeline.tsx            Bands, hour ticks, spine, free blocks, chips, now-line
    TaskCard.tsx            Draggable/tappable card + checkbox + elapsed scrim
    WeekStrip.tsx           Day picker + week swipe
    TaskEditorSheet.tsx     Create/edit bottom sheet
    SettingsSheet.tsx       The ☰ menu
    BottomNav.tsx           Today/Stats bar + floating add button
    Hatch.tsx               SVG diagonal-stripe fill for bands/free blocks
```

## Future: cloud sync & a desktop app

Persistence goes through the `Repository` interface in `src/storage.ts`. Today it
is backed by on-device AsyncStorage; a cloud backend can implement the same
interface and be swapped in without touching the UI — that's the seam a future
desktop client would share to sync the same data.
