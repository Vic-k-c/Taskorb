// Registers the service worker (installable app + notifications) and
// exposes window.TaskOrbPush for the Calendar page's notification panel.
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function (err) {
        console.warn('Service worker registration failed:', err);
      });
    });
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function isStandalone() {
    return window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }
  function urlBase64ToUint8Array(base64) {
    var padding = '='.repeat((4 - (base64.length % 4)) % 4);
    var raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); });
  }

  var api = {
    supported: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,

    // iPhone/iPad only allow web push for an app that's been added to the
    // Home Screen -- in a normal Safari tab PushManager doesn't even exist.
    iosNeedsInstall: function () { return isIos() && !isStandalone() && !('PushManager' in window); },

    // -> { state, deviceCount } where state is one of:
    //   'server-off'   the server has no VAPID keys configured
    //   'ios-install'  must add to Home Screen first
    //   'unsupported'  this browser can't do web push
    //   'denied'       the user blocked notifications in browser settings
    //   'off'          available, not turned on for this device
    //   'on'           turned on for this device
    status: function () {
      return fetch('/api/push/config').then(function (r) { return r.json(); }).then(function (cfg) {
        if (!cfg.enabled) return { state: 'server-off', reason: cfg.reason };
        if (api.iosNeedsInstall()) return { state: 'ios-install' };
        if (!api.supported) return { state: 'unsupported' };
        if (Notification.permission === 'denied') return { state: 'denied' };
        return navigator.serviceWorker.ready
          .then(function (reg) { return reg.pushManager.getSubscription(); })
          .then(function (sub) {
            return { state: sub && Notification.permission === 'granted' ? 'on' : 'off', deviceCount: cfg.deviceCount };
          });
      });
    },

    // Must be called from a click handler -- browsers refuse the
    // permission prompt otherwise.
    enable: function () {
      return Notification.requestPermission().then(function (permission) {
        if (permission !== 'granted') throw new Error('Notifications were not allowed.');
        return Promise.all([navigator.serviceWorker.ready, fetch('/api/push/config').then(function (r) { return r.json(); })]);
      }).then(function (res) {
        var reg = res[0], cfg = res[1];
        if (!cfg.enabled) throw new Error('Notifications are not configured on this server.');
        return reg.pushManager.getSubscription().then(function (existing) {
          return existing || reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(cfg.publicKey)
          });
        });
      }).then(function (sub) {
        return post('/api/push/subscribe', { subscription: sub.toJSON() });
      }).then(function (res) {
        if (!res.ok) throw new Error(res.data.error || 'Could not save this device.');
      });
    },

    disable: function () {
      return navigator.serviceWorker.ready
        .then(function (reg) { return reg.pushManager.getSubscription(); })
        .then(function (sub) {
          if (!sub) return;
          var endpoint = sub.endpoint;
          return sub.unsubscribe().then(function () { return post('/api/push/unsubscribe', { endpoint: endpoint }); });
        });
    },

    test: function () {
      return post('/api/push/test').then(function (res) {
        if (!res.ok) throw new Error(res.data.error || 'Test failed.');
        return res.data.sent;
      });
    }
  };

  window.TaskOrbPush = api;
})();
