(function () {
  // --- Card drag-and-drop between lists ---
  document.querySelectorAll('.board-list-cards').forEach((el) => {
    new Sortable(el, {
      group: 'board',
      animation: 150,
      ghostClass: 'sortable-ghost',
      filter: '.quick-add-card',
      preventOnFilter: false, // let the "+ Add card" button's own click/tap through instead of Sortable eating it (fixes it not working on iOS Safari specifically)
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
      const count = list.querySelectorAll('.prospect-card:not(.pending-delete)').length;
      list.querySelector('.count').textContent = count;
    });
  }

  // --- Search / filter cards ---
  const searchInput = document.getElementById('cardSearch');
  const searchBox = document.getElementById('boardSearchBox');
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      const q = searchInput.value.trim().toLowerCase();
      document.querySelectorAll('.prospect-card').forEach((card) => {
        const name = card.getAttribute('data-card-name') || '';
        card.style.display = !q || name.includes(q) ? '' : 'none';
      });
    });
  }
  // On mobile, the search box starts collapsed to an icon; tapping it expands
  // inline so it's always reachable without competing for header space.
  if (searchBox) {
    searchBox.addEventListener('click', function (e) {
      if (!searchBox.classList.contains('expanded')) {
        searchBox.classList.add('expanded');
        searchInput.focus();
      }
    });
    document.addEventListener('click', function (e) {
      if (!searchBox.contains(e.target) && !searchInput.value.trim()) {
        searchBox.classList.remove('expanded');
      }
    });
  }

  // --- Kebab menu (mobile): Share / Settings / All boards ---
  const kebabBtn = document.getElementById('kebabBtn');
  const kebabDropdown = document.getElementById('kebabDropdown');
  if (kebabBtn) {
    kebabBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      kebabDropdown.classList.toggle('open');
    });
    document.addEventListener('click', function (e) {
      if (!kebabDropdown.contains(e.target) && e.target !== kebabBtn) kebabDropdown.classList.remove('open');
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
    document.getElementById('cardAssigned').value = card.assigned_to || '';
    document.getElementById('cardNotes').value = card.notes || '';

    const cardTagIds = (card.tags || []).map((t) => String(t.id));
    document.querySelectorAll('#cardTagPicker input[type=checkbox]').forEach((cb) => {
      cb.checked = cardTagIds.includes(cb.value);
      applyTagCheckboxStyle(cb);
    });

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

  // --- Tags ---
  function applyTagCheckboxStyle(checkbox) {
    const label = checkbox.closest('label');
    const color = checkbox.getAttribute('data-color');
    label.classList.toggle('checked', checkbox.checked);
    label.style.background = checkbox.checked ? color : `${color}1a`;
  }

  window.toggleCardTag = function (checkbox) {
    applyTagCheckboxStyle(checkbox);
    const cardId = document.getElementById('cardId').value;
    const tagId = checkbox.value;
    const req = checkbox.checked
      ? fetch(`/api/cards/${cardId}/tags`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag_id: tagId }) })
      : fetch(`/api/cards/${cardId}/tags/${tagId}`, { method: 'DELETE' });
    req.catch(() => {});
  };

  window.createBoardTag = function () {
    const name = document.getElementById('newBoardTagName').value.trim();
    const color = document.getElementById('newBoardTagColor').value;
    if (!name) return;
    fetch(`/boards/${window.BOARD_ID}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color })
    })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => { if (!ok) throw new Error(data.error); location.reload(); })
      .catch((err) => toast.error(err.message));
  };

  // Hide the element now, send the real DELETE after a short window so the
  // user can Undo. If they leave the page first, the delete is flushed.
  const pendingDeletes = new Set();
  function undoableDelete(el, message, url, afterCommit) {
    el.style.display = 'none';
    el.classList.add('pending-delete');
    updateCounts();
    let done = false;
    const entry = { commit() {
      if (done) return; done = true; pendingDeletes.delete(entry);
      return fetch(url, { method: 'DELETE', keepalive: true }).then((r) => {
        if (!r.ok) return r.json().catch(() => ({})).then((d) => { throw new Error(d.error || 'Delete failed.'); });
        el.remove(); if (afterCommit) afterCommit(); updateCounts();
      }).catch((err) => { el.style.display = ''; el.classList.remove('pending-delete'); updateCounts(); toast.error(err.message); });
    } };
    pendingDeletes.add(entry);
    toast(message, {
      actionLabel: 'Undo', ms: 6000,
      onAction() { done = true; pendingDeletes.delete(entry); el.style.display = ''; el.classList.remove('pending-delete'); updateCounts(); },
      onTimeout() { entry.commit(); }
    });
  }
  window.addEventListener('pagehide', () => { pendingDeletes.forEach((e) => e.commit()); });

  window.deleteCard = function () {
    const id = document.getElementById('cardId').value;
    const el = document.querySelector(`.prospect-card[data-card-id="${id}"]`);
    if (!el) return;
    closeModal();
    undoableDelete(el, 'Card deleted', `/api/cards/${id}`, () => {
      window.BOARD_DATA.forEach((l) => { l.cards = l.cards.filter((c) => String(c.id) !== String(id)); });
    });
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
        .catch((err) => toast.error(err.message));
    });
  }

  // --- Quick-add card ---
  window.showQuickAdd = function (listId) {
    const container = document.getElementById(`qa-${listId}`);
    container.innerHTML = `
      <input type="text" placeholder="Card name" id="qaName-${listId}" autocomplete="off" enterkeyhint="done">
      <div class="qa-actions">
        <button type="button" class="btn small" onclick="submitQuickAdd(${listId})">Add</button>
        <button type="button" class="btn ghost small" onclick="cancelQuickAdd(${listId})">Done</button>
      </div>
    `;
    const qaInput = document.getElementById(`qaName-${listId}`);
    qaInput.addEventListener('keydown', function (e) {
      if (e.isComposing) return; // don't fire mid-IME composition
      if (e.key === 'Enter') { e.preventDefault(); submitQuickAdd(listId, { open: e.shiftKey }); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelQuickAdd(listId); }
    });
    qaInput.focus();
  };

  window.cancelQuickAdd = function (listId) {
    document.getElementById(`qa-${listId}`).innerHTML =
      `<button type="button" class="btn ghost small" style="width:100%;" onclick="showQuickAdd(${listId})">+ Add card</button>`;
  };

  function buildCardTile(card) {
    const tile = document.createElement('div');
    tile.className = 'prospect-card';
    tile.style.borderLeftColor = 'var(--border)';
    tile.setAttribute('draggable', 'true');
    tile.setAttribute('data-card-id', card.id);
    tile.setAttribute('data-card-name', String(card.name || '').toLowerCase());
    tile.addEventListener('click', () => openCard(card.id));
    const name = document.createElement('div');
    name.className = 'pname';
    name.textContent = card.name;
    const tags = document.createElement('div');
    tags.className = 'ptags';
    tile.appendChild(name);
    tile.appendChild(tags);
    return tile;
  }

  // Adds the card in place: no page reload, input stays open and focused so
  // several cards can be typed in a row. Shift+Enter also opens the new card.
  window.submitQuickAdd = function (listId, opts) {
    const input = document.getElementById(`qaName-${listId}`);
    if (!input) return;
    const name = input.value.trim();
    if (!name || input.dataset.busy) return; // ignore empty / double Enter
    input.dataset.busy = '1';
    fetch(`/lists/${listId}/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    }).then((res) => res.json().catch(() => ({})).then((d) => ({ ok: res.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) throw new Error(d.error || 'Could not add the card.');
        const card = Object.assign({ tags: [], attachment_count: 0 }, d);
        const listData = window.BOARD_DATA.find((l) => String(l.id) === String(listId));
        if (listData) listData.cards.push(card);
        const container = document.querySelector(`.board-list-cards[data-list-id="${listId}"]`);
        const qa = document.getElementById(`qa-${listId}`);
        if (container && qa) container.insertBefore(buildCardTile(card), qa);
        updateCounts();
        input.value = '';
        delete input.dataset.busy;
        input.focus();
        if (opts && opts.open) openCard(card.id);
        else toast('Card added');
      })
      .catch((err) => { delete input.dataset.busy; toast.error(err.message || 'Network error. Try again.'); });
  };

  // --- Lists ---
  window.addList = function () {
    const btn = document.querySelector('.add-list-btn');
    if (!btn || document.getElementById('addListBox')) return;
    const box = document.createElement('div');
    box.className = 'add-list-box';
    box.id = 'addListBox';
    box.innerHTML = `
      <input type="text" id="newListName" placeholder="List name" autocomplete="off" enterkeyhint="done">
      <div class="qa-actions">
        <button type="button" class="btn small" id="newListSave">Add list</button>
        <button type="button" class="btn ghost small" id="newListCancel">Cancel</button>
      </div>`;
    btn.style.display = 'none';
    btn.parentNode.insertBefore(box, btn);
    const input = box.querySelector('#newListName');
    const close = () => { box.remove(); btn.style.display = ''; };
    const save = () => {
      const name = input.value.trim();
      if (!name || input.dataset.busy) return;
      input.dataset.busy = '1';
      fetch(`/boards/${window.BOARD_ID}/lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      }).then((r) => r.json().catch(() => ({})).then((d) => ({ ok: r.ok, d })))
        .then(({ ok, d }) => {
          if (!ok) throw new Error(d.error || 'Could not add the list.');
          toast.flash('List added');
          location.reload();
        })
        .catch((err) => { delete input.dataset.busy; toast.error(err.message); });
    };
    box.querySelector('#newListSave').addEventListener('click', save);
    box.querySelector('#newListCancel').addEventListener('click', close);
    input.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    input.focus();
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
    const el = document.querySelector(`.board-list[data-list-id="${listId}"]`);
    if (!el) return;
    const n = el.querySelectorAll('.prospect-card').length;
    undoableDelete(el, `List deleted${n ? ` (${n} card${n === 1 ? '' : 's'})` : ''}`, `/lists/${listId}`, () => {
      window.BOARD_DATA = window.BOARD_DATA.filter((l) => String(l.id) !== String(listId));
    });
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
      .catch((err) => toast.error(err.message));
  };

  window.changePermission = function (userId, permission) {
    fetch(`/boards/${window.BOARD_ID}/members/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permission })
    }).then((r) => r.json()).then((data) => { if (data.error) { toast.error(data.error); setTimeout(() => location.reload(), 1200); } });
  };

  window.removeMember = function (userId) {
    if (!confirm('Remove this person from the board?')) return;
    fetch(`/boards/${window.BOARD_ID}/members/${userId}`, { method: 'DELETE' })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => { if (!ok) throw new Error(data.error); location.reload(); })
      .catch((err) => toast.error(err.message));
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
        .catch((err) => toast.error(err.message));
    });
  }

  window.removeCover = function () {
    fetch(`/boards/${window.BOARD_ID}/cover`, { method: 'DELETE' }).then(() => location.reload());
  };

  window.saveSettings = function () {
    const title = document.getElementById('settingsTitle').value;
    const description = document.getElementById('settingsDescription').value;
    const date_label = document.getElementById('settingsDateLabel').value;
    fetch(`/boards/${window.BOARD_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, date_label })
    }).then(() => location.reload());
  };

  window.deleteBoard = function () {
    const confirmInput = document.getElementById('deleteConfirmInput');
    if (confirmInput.value.trim() !== 'DELETE') {
      toast.error('Type DELETE (all caps) in the box to confirm.');
      return;
    }
    fetch(`/boards/${window.BOARD_ID}`, { method: 'DELETE' })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => { if (!ok) throw new Error(data.error); window.location.href = '/boards'; })
      .catch((err) => toast.error(err.message));
  };
})();
