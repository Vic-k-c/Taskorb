// TaskOrb service worker. Scope is the whole site because it's served from
// the root (/sw.js). Right now it does two things: lets the app be
// installed to a phone/computer, and shows follow-up reminders as native
// notifications even when TaskOrb isn't open. It deliberately does NOT
// cache pages or API responses -- board data must always be live.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// A fetch listener is part of what browsers look for when deciding an app
// is installable. This one intentionally lets every request go straight to
// the network, untouched.
self.addEventListener('fetch', () => {});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { body: event.data ? event.data.text() : '' }; }

  event.waitUntil(
    self.registration.showNotification(data.title || 'TaskOrb', {
      body: data.body || '',
      icon: '/img/icon-192.png',
      badge: '/img/badge-72.png',
      tag: data.tag || undefined,       // same tag replaces instead of stacking
      renotify: !!data.tag,
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          return client.focus().then((c) => (c && 'navigate' in c ? c.navigate(target) : undefined));
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
