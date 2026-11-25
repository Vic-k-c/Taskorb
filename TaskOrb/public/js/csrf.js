(function () {
  if (!window.CSRF_TOKEN) return;
  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    init = init || {};
    const method = (init.method || 'GET').toUpperCase();
    if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(method)) {
      init.headers = init.headers || {};
      if (init.headers instanceof Headers) {
        init.headers.set('x-csrf-token', window.CSRF_TOKEN);
      } else {
        init.headers['x-csrf-token'] = window.CSRF_TOKEN;
      }
    }
    return originalFetch(input, init);
  };
})();
