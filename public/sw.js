/* The league's service worker.
 *
 * It does one job: turn a Web Push message into a notification, and turn a tap
 * on that notification into the right screen. Deliberately no offline caching —
 * every screen here reads live scores, live claims and live offers, and a
 * cached one would be a confident lie. The manifest already makes this
 * installable; a cache would only make it wrong.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  // A push with no readable payload still deserves to be shown: Chrome will
  // otherwise show its own "This site has been updated in the background"
  // notice, which is worse than anything we would write.
  let data = { title: "Main Street Steakhouse", body: "Something happened in the league.", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    try { data.body = event.data.text() || data.body; } catch { /* keep the default */ }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon.png",
      badge: "/icon.png",
      // One notification per kind replaces the last rather than stacking six
      // waiver results on a Wednesday morning.
      tag: data.kind || "league",
      renotify: true,
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  // Focus the tab that is already open rather than opening a fifth one.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          if ("navigate" in client) client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
