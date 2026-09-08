/**
 * The site inside the iPhone app.
 *
 * The App Store build is steakhouse.football in a web view, and the frame
 * injects a bridge before the first script runs. These are the few places the
 * site has to know it is in the frame: the install nudge makes no sense there,
 * pull-to-refresh is the only refresh there is, and notifications go through
 * Apple rather than a service worker.
 *
 * `isNativeApp` reads the injected global and imports nothing, so the two
 * components that call it on every page carry no extra weight in a browser.
 * The plugin packages are imported on demand, and only once we are inside.
 */

type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };

const cap = (): CapacitorGlobal | undefined =>
  typeof window === "undefined" ? undefined : (window as Window & { Capacitor?: CapacitorGlobal }).Capacitor;

export function isNativeApp(): boolean {
  try { return cap()?.isNativePlatform?.() === true; } catch { return false; }
}

export function nativePlatform(): "ios" | "android" | null {
  if (!isNativeApp()) return null;
  const p = cap()?.getPlatform?.();
  return p === "ios" || p === "android" ? p : null;
}

/** Set when the manager turns notifications off in the app, so a granted
 *  permission is not read as "on" and the next launch does not re-register. */
export const NATIVE_PUSH_OFF = "mss-native-push-off";
/** The last token Apple issued, so it can be forgotten by name. */
export const NATIVE_PUSH_TOKEN = "mss-native-push-token";

export type NativePermission = "granted" | "denied" | "prompt";

export async function nativePushPermission(): Promise<NativePermission> {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const { receive } = await PushNotifications.checkPermissions();
  return receive === "granted" ? "granted" : receive === "denied" ? "denied" : "prompt";
}

export async function requestNativePushPermission(): Promise<NativePermission> {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const { receive } = await PushNotifications.requestPermissions();
  return receive === "granted" ? "granted" : receive === "denied" ? "denied" : "prompt";
}

/**
 * Ask Apple for this phone's token. Resolves with it, or rejects with what
 * Apple said — the usual reason being a build with no push entitlement.
 */
export async function registerNativePush(): Promise<string> {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Apple did not answer.")), 15_000);
    const done = async () => { clearTimeout(timer); await Promise.all([ok, bad]).then((hs) => hs.forEach((h) => h.remove())); };
    const ok = PushNotifications.addListener("registration", (t) => { void done(); resolve(t.value); });
    const bad = PushNotifications.addListener("registrationError", (e) => { void done(); reject(new Error(e.error)); });
    PushNotifications.register().catch((e: Error) => { void done(); reject(e); });
  });
}

export async function unregisterNativePush(): Promise<void> {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  await PushNotifications.unregister();
}
