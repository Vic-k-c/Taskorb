(function () {
  const bell = document.getElementById('notifBell');
  const badge = document.getElementById('notifBadge');
  const dropdown = document.getElementById('notifDropdown');
  const list = document.getElementById('notifList');
  if (!bell) return;

  function timeAgo(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Popup for "celebration"-type notifications (e.g. a subscription
  // being activated) -- shown once per notification, tracked in
  // localStorage so it doesn't reappear on every page load even though
  // the notification itself may stay technically "unread" until the
  // bell dropdown is opened.
  const POPUP_SEEN_KEY = 'taskorb_celebration_popups_seen';
  function getSeenPopupIds() {
    try { return new Set(JSON.parse(localStorage.getItem(POPUP_SEEN_KEY) || '[]')); } catch (e) { return new Set(); }
  }
  function markPopupSeen(id) {
    const seen = getSeenPopupIds();
    seen.add(id);
    try { localStorage.setItem(POPUP_SEEN_KEY, JSON.stringify(Array.from(seen).slice(-50))); } catch (e) {}
  }
  function showCelebrationPopup(n) {
    const overlay = document.createElement('div');
    overlay.className = 'celebration-popup-overlay';
    overlay.innerHTML = `
      <div class="celebration-popup">
        <div class="celebration-popup-icon">\u{1F389}</div>
        <p>${escapeHtml(n.message)}</p>
        <div class="celebration-popup-actions">
          ${n.link ? `<a href="${n.link}" class="btn small">View</a>` : ''}
          <button type="button" class="btn ghost small" data-dismiss>Nice, thanks</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-dismiss]').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    markPopupSeen(n.id);
  }

  function refreshCount() {
    fetch('/api/notifications')
      .then((r) => r.json())
      .then((data) => {
        if (data.unread_count > 0) {
          badge.textContent = data.unread_count > 9 ? '9+' : data.unread_count;
          badge.classList.add('show');
        } else {
          badge.classList.remove('show');
        }
        renderList(data.notifications || []);

        const seen = getSeenPopupIds();
        const toPopup = (data.notifications || []).find((n) => n.type === 'celebration' && !n.read && !seen.has(n.id));
        if (toPopup && !document.querySelector('.celebration-popup-overlay')) showCelebrationPopup(toPopup);
      })
      .catch(() => {});
  }

  function renderList(items) {
    if (items.length === 0) {
      list.innerHTML = '<div class="notif-empty">No notifications yet.</div>';
      return;
    }
    list.innerHTML = items.map((n) => `
      <a href="${n.link || '#'}" class="notif-item ${n.read ? '' : 'unread'}">
        <div>${escapeHtml(n.message)}</div>
        <div class="notif-time">${timeAgo(n.created_at)}</div>
      </a>
    `).join('');
  }

  bell.addEventListener('click', function (e) {
    e.stopPropagation();
    dropdown.classList.toggle('open');
    if (dropdown.classList.contains('open')) {
      fetch('/api/notifications/read', { method: 'POST' }).then(refreshCount);
    }
  });

  document.addEventListener('click', function (e) {
    if (!dropdown.contains(e.target) && e.target !== bell) dropdown.classList.remove('open');
  });

  refreshCount();
  setInterval(refreshCount, 20000);
})();
