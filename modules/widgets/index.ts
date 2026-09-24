import { NativeModule, requireOptionalNativeModule } from 'expo';

// ---------------------------------------------------------------------------
// Operarius widgets — the JS face of the Android module in ./android: two
// home-screen widgets (today's timeline, and the month) drawn from what the
// app hands over here. Anywhere the module isn't linked (web) every call is a
// harmless no-op.
// ---------------------------------------------------------------------------

export type WidgetKind = 'today' | 'month';
export type WidgetStatus = { today: number; month: number; canPin: boolean };

declare class WidgetsNative extends NativeModule {
  update(json: string): Promise<boolean>;
  status(): Promise<WidgetStatus>;
  pin(kind: WidgetKind): Promise<boolean>;
}

const native = requireOptionalNativeModule<WidgetsNative>('OperariusWidgets');

export const available = !!native;

/** Hands the widgets their data (a snapshot built by src/widgets.ts) and redraws them. */
export async function update(json: string): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.update(json);
  } catch {
    return false;
  }
}

export async function status(): Promise<WidgetStatus> {
  if (!native) return { today: 0, month: 0, canPin: false };
  try {
    return await native.status();
  } catch {
    return { today: 0, month: 0, canPin: false };
  }
}

/** Asks the launcher to add a widget. false = it can't (add it from the widget picker instead). */
export async function pin(kind: WidgetKind): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.pin(kind);
  } catch {
    return false;
  }
}
