// Tiny toast helper: window.toast(msg, {type, actionLabel, onAction, ms}).
// toast.flash(msg) shows a toast after the next page load (for reload flows).
(function () {
  var root;
  function ensureRoot() {
    if (root) return root;
    root = document.createElement('div');
    root.className = 'toast-stack';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    document.body.appendChild(root);
    return root;
  }
  function toast(msg, opts) {
    opts = opts || {};
    var el = document.createElement('div');
    el.className = 'toast' + (opts.type ? ' toast-' + opts.type : '');
    var span = document.createElement('span');
    span.textContent = msg;
    el.appendChild(span);
    var timer;
    function close() { clearTimeout(timer); if (el.parentNode) el.parentNode.removeChild(el); if (opts.onClose) opts.onClose(false); }
    if (opts.actionLabel) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'toast-action';
      b.textContent = opts.actionLabel;
      b.addEventListener('click', function () {
        clearTimeout(timer);
        if (el.parentNode) el.parentNode.removeChild(el);
        if (opts.onAction) opts.onAction();
      });
      el.appendChild(b);
    }
    ensureRoot().appendChild(el);
    timer = setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
      if (opts.onTimeout) opts.onTimeout();
    }, opts.ms || (opts.type === 'error' ? 6000 : 3500));
    return { close: close };
  }
  toast.error = function (m) { return toast(m, { type: 'error' }); };
  toast.flash = function (m) { try { sessionStorage.setItem('taskorb_flash', m); } catch (e) {} };
  document.addEventListener('DOMContentLoaded', function () {
    try {
      var m = sessionStorage.getItem('taskorb_flash');
      if (m) { sessionStorage.removeItem('taskorb_flash'); toast(m); }
    } catch (e) {}
  });
  window.toast = toast;
})();
