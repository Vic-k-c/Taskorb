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
