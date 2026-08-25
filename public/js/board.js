(function () {
  // --- Card drag-and-drop between lists ---
  document.querySelectorAll('.board-list-cards').forEach((el) => {
    new Sortable(el, {
      group: 'board',
      animation: 150,
      ghostClass: 'sortable-ghost',
      filter: '.quick-add-card',
      disabled: !window.CAN_EDIT,
      delay: 120,
      delayOnTouchOnly: true,
      onEnd: function (evt) {
        if (evt.item.classList.contains('quick-add-card')) return;
        const cardId = evt.item.getAttribute('data-card-id');
        const newListId = evt.to.getAttribute('data-list-id');
        const newPosition = evt.newIndex;
        fetch(`/api/cards/${cardId}/move`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ list_id: newListId, position: newPosition })
        }).then(() => updateCounts());
      }
    });
  });

  // --- List drag-and-drop reordering ---
  const boardWrap = document.getElementById('boardWrap');
  if (boardWrap && window.CAN_EDIT) {
    new Sortable(boardWrap, {
      animation: 150,
      handle: '.board-list-header',
      filter: '.add-list-btn',
      delay: 150,
      delayOnTouchOnly: true,
      onEnd: function () {
        const order = Array.from(boardWrap.querySelectorAll('.board-list')).map((el) => el.getAttribute('data-list-id'));
        fetch(`/boards/${window.BOARD_ID}/lists/reorder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order })
        });
      }
    });
  }

  function updateCounts() {
    document.querySelectorAll('.board-list').forEach((list) => {
      const count = list.querySelectorAll('.prospect-card').length;
      list.querySelector('.count').textContent = count;
    });
  }

  // --- Search / filter cards ---
  const searchInput = document.getElementById('cardSearch');
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      const q = searchInput.value.trim().toLowerCase();
      document.querySelectorAll('.prospect-card').forEach((card) => {
        const name = card.getAttribute('data-card-name') || '';
        card.style.display = !q || name.includes(q) ? '' : 'none';
      });
    });
  }

  function findCard(id) {
    const flat = window.BOARD_DATA.flatMap((l) => l.cards);
    return flat.find((c) => String(c.id) === String(id));
  }

  // --- Card detail modal ---
  window.openCard = function (id) {
    const card = findCard(id);
    if (!card) return;
    document.getElementById('cardId').value = card.id;
    document.getElementById('cardName').value = card.name || '';
    document.getElementById('cardPhone').value = card.phone || '';
    document.getElementById('cardEmail').value = card.email || '';
    document.getElementById('cardAddress').value = card.address || '';
    document.getElementById('cardInterest').value = card.priority || 'warm';
    document.getElementById('cardAssigned').value = card.assigned_to || '';
    document.getElementById('cardNotes').value = card.notes || '';
    document.getElementById('modalBackdrop').classList.add('open');
    loadAttachments(card.id, card.cover_attachment_id);
  };

  window.closeModal = function () {
    document.getElementById('modalBackdrop').classList.remove('open');
  };

  const cardForm = document.getElementById('cardForm');
  if (cardForm) {
    cardForm.addEventListener('submit', function (e) {
      e.preventDefault();
      const id = document.getElementById('cardId').value;
      const payload = {
        name: document.getElementById('cardName').value,
        phone: document.getElementById('cardPhone').value,
        email: document.getElementById('cardEmail').value,
        address: document.getElementById('cardAddress').value,
        priority: document.getElementById('cardInterest').value,
        assigned_to: document.getElementById('cardAssigned').value || null,
        notes: document.getElementById('cardNotes').value
      };
      fetch(`/api/cards/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(() => location.reload());
    });
  }

  window.deleteCard = function () {
    const id = document.getElementById('cardId').value;
    if (!confirm('Delete this card? This cannot be undone.')) return;
    fetch(`/api/cards/${id}`, { method: 'DELETE' }).then(() => location.reload());
  };

  // --- Attachments + card cover selection ---
  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function loadAttachments(cardId, coverAttachmentId) {
    const list = document.getElementById('attachmentList');
    list.innerHTML = 'Loading…';
    fetch(`/api/cards/${cardId}/attachments`)
      .then((r) => r.json())
      .then((files) => {
        if (files.length === 0) { list.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">No attachments yet.</div>'; return; }
        list.innerHTML = files.map((f) => {
          const isImage = f.mime_type.startsWith('image/');
          const isCover = coverAttachmentId && String(coverAttachmentId) === String(f.id);
          return `
            <div class="attachment-item ${isCover ? 'is-cover' : ''}" data-attachment-id="${f.id}">
              <a href="/api/attachments/${f.id}" target="_blank" rel="noopener">${escapeHtml(f.filename)}</a>
              <span style="display:flex; align-items:center; gap:6px;">
                <span class="file-size">${formatSize(f.size_bytes)}</span>
                ${window.CAN_EDIT && isImage ? `<button type="button" class="btn ghost small set-cover-btn" onclick="setCover(${cardId}, ${isCover ? 'null' : f.id})">${isCover ? 'Unset cover' : 'Set as cover'}</button>` : ''}
                ${window.CAN_EDIT ? `<button type="button" class="btn danger small" onclick="deleteAttachment(${f.id}, ${cardId})">&times;</button>` : ''}
              </span>
            </div>
          `;
        }).join('');
      });
  }

  window.setCover = function (cardId, attachmentId) {
    fetch(`/api/cards/${cardId}/cover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attachment_id: attachmentId })
    }).then(() => location.reload());
  };

  window.deleteAttachment = function (attachmentId, cardId) {
    fetch(`/api/attachments/${attachmentId}`, { method: 'DELETE' }).then(() => loadAttachments(cardId));
  };

  const attachInput = document.getElementById('attachInput');
  if (attachInput) {
    attachInput.addEventListener('change', function () {
      const cardId = document.getElementById('cardId').value;
      const files = attachInput.files;
      if (!files.length) return;
      const formData = new FormData();
      Array.from(files).forEach((f) => formData.append('files', f));
      fetch(`/api/cards/${cardId}/attachments`, { method: 'POST', body: formData })
        .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
        .then(({ ok, data }) => {
          if (!ok) throw new Error(Array.isArray(data) ? 'Upload failed.' : (data.error || 'Upload failed.'));
          attachInput.value = '';
          loadAttachments(cardId);
        })
        .catch((err) => alert(err.message));
    });
  }

  // --- Quick-add card ---
  window.showQuickAdd = function (listId) {
    const container = document.getElementById(`qa-${listId}`);
    container.innerHTML = `
      <input type="text" placeholder="Card name" id="qaName-${listId}" autofocus>
      <div class="qa-actions">
        <button type="button" class="btn small" onclick="submitQuickAdd(${listId})">Add</button>
        <button type="button" class="btn ghost small" onclick="cancelQuickAdd(${listId})">Cancel</button>
      </div>
    `;
    document.getElementById(`qaName-${listId}`).focus();
  };

  window.cancelQuickAdd = function (listId) {
    document.getElementById(`qa-${listId}`).innerHTML =
      `<button type="button" class="btn ghost small" style="width:100%;" onclick="showQuickAdd(${listId})">+ Add card</button>`;
  };

  window.submitQuickAdd = function (listId) {
    const input = document.getElementById(`qaName-${listId}`);
    const name = input.value.trim();
    if (!name) return;
    fetch(`/lists/${listId}/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    }).then(() => location.reload());
  };

  // --- Lists ---
  window.addList = function () {
    const name = prompt('Name this list:');
    if (!name || !name.trim()) return;
    fetch(`/boards/${window.BOARD_ID}/lists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() })
    }).then(() => location.reload());
  };

  window.renameList = function (input) {
    const listId = input.getAttribute('data-list-id');
    fetch(`/lists/${listId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: input.value })
    });
  };

  window.deleteList = function (listId) {
    if (!confirm('Delete this list and every card in it? This cannot be undone.')) return;
    fetch(`/lists/${listId}`, { method: 'DELETE' }).then(() => location.reload());
  };

  // --- Sharing ---
  window.openShare = function () { document.getElementById('shareBackdrop').classList.add('open'); };
  window.closeShare = function () { document.getElementById('shareBackdrop').classList.remove('open'); };

  window.addMember = function () {
    const userId = document.getElementById('newMemberUser').value;
    const permission = document.getElementById('newMemberPermission').value;
    if (!userId) return;
    fetch(`/boards/${window.BOARD_ID}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, permission })
    })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => { if (!ok) throw new Error(data.error); location.reload(); })
      .catch((err) => alert(err.message));
  };

  window.changePermission = function (userId, permission) {
    fetch(`/boards/${window.BOARD_ID}/members/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permission })
    }).then((r) => r.json()).then((data) => { if (data.error) { alert(data.error); location.reload(); } });
  };

  window.removeMember = function (userId) {
    if (!confirm('Remove this person from the board?')) return;
    fetch(`/boards/${window.BOARD_ID}/members/${userId}`, { method: 'DELETE' })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => { if (!ok) throw new Error(data.error); location.reload(); })
      .catch((err) => alert(err.message));
  };

  // --- Board settings: cover photo, title/description, delete ---
  window.openSettings = function () { document.getElementById('settingsBackdrop').classList.add('open'); };
  window.closeSettings = function () { document.getElementById('settingsBackdrop').classList.remove('open'); };

  const coverInput = document.getElementById('coverInput');
  if (coverInput) {
    coverInput.addEventListener('change', function () {
      if (!coverInput.files.length) return;
      const fd = new FormData();
      fd.append('cover', coverInput.files[0]);
      fetch(`/boards/${window.BOARD_ID}/cover`, { method: 'POST', body: fd })
        .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
        .then(({ ok, data }) => { if (!ok) throw new Error(data.error); location.reload(); })
        .catch((err) => alert(err.message));
    });
  }

  window.removeCover = function () {
    fetch(`/boards/${window.BOARD_ID}/cover`, { method: 'DELETE' }).then(() => location.reload());
  };

  window.saveSettings = function () {
    const title = document.getElementById('settingsTitle').value;
    const description = document.getElementById('settingsDescription').value;
    fetch(`/boards/${window.BOARD_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description })
    }).then(() => location.reload());
  };

  window.deleteBoard = function () {
    const confirmInput = document.getElementById('deleteConfirmInput');
    if (confirmInput.value.trim() !== 'DELETE') {
      alert('Type DELETE (all caps) in the box to confirm.');
      return;
    }
    fetch(`/boards/${window.BOARD_ID}`, { method: 'DELETE' })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => { if (!ok) throw new Error(data.error); window.location.href = '/boards'; })
      .catch((err) => alert(err.message));
  };
})();
