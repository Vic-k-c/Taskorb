// Entry point is initTaskorbMap(), called by the Google Maps JS API once it
// finishes loading (see the callback=initTaskorbMap param on the script tag
// in views/map.ejs). Everything below used to run immediately in an IIFE
// under Leaflet; it's now wrapped in this function so it only runs once the
// `google` global actually exists.
function initTaskorbMap() {
  const DEFAULT_CENTER = { lat: 39.8283, lng: -98.5795 }; // fallback: center of the US
  const map = new google.maps.Map(document.getElementById('map'), {
    center: DEFAULT_CENTER,
    zoom: 5,
    mapTypeControl: false, // replaced by our own compact bottom-right toggle
    streetViewControl: false,
    fullscreenControl: false,
    mapTypeId: 'roadmap'
  });

  // Compact Google-Maps-style map type toggle (bottom-right button). Google
  // Maps' "hybrid" type is satellite imagery + street/place labels combined,
  // so there's no need to stitch two tile layers together like the old
  // Leaflet version did.
  const toggleEl = document.createElement('div');
  toggleEl.className = 'map-type-toggle';
  let onSatellite = false;
  function renderToggle() {
    toggleEl.innerHTML = `<span>${onSatellite ? 'Map' : 'Satellite'}</span>`;
  }
  renderToggle();
  toggleEl.addEventListener('click', () => {
    onSatellite = !onSatellite;
    map.setMapTypeId(onSatellite ? 'hybrid' : 'roadmap');
    renderToggle();
  });
  map.controls[google.maps.ControlPosition.RIGHT_BOTTOM].push(toggleEl);

  const hint = document.getElementById('mapHint');
  let clickMarker = null;

  function setHint(text, autoFade) {
    hint.textContent = text;
    hint.classList.add('show');
    hint.classList.remove('faded');
    if (autoFade) setTimeout(() => hint.classList.add('faded'), 3200);
  }

  setHint('Locating you\u2026', false);

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        map.setCenter({ lat: latitude, lng: longitude });
        map.setZoom(17);
        new google.maps.Marker({
          position: { lat: latitude, lng: longitude },
          map,
          title: 'You are here',
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            strokeColor: '#1B2A41',
            strokeWeight: 2,
            fillColor: '#5D8A66',
            fillOpacity: 0.9
          }
        });
        setHint('Tap anywhere on the map to log a card there.', true);
      },
      () => { setHint("Couldn't find your location \u2014 scroll the map, then tap a spot to log a card.", true); },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  } else {
    setHint('Tap anywhere on the map to log a card there.', true);
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function boardOptionsHtml() {
    const boards = window.BOARDS_DATA || [];
    let html = boards.map((b) => `<option value="${b.id}">${escapeHtml(b.title)}</option>`).join('');
    html += `<option value="__new__">+ Create new board</option>`;
    return html;
  }

  function templateOptionsHtml() {
    const templates = window.TEMPLATES || {};
    const def = window.DEFAULT_TEMPLATE || 'blank';
    return Object.keys(templates).map((key) => `<option value="${key}" ${key === def ? 'selected' : ''}>${templates[key].label}</option>`).join('');
  }

  function listOptionsHtml(boardId) {
    const boards = window.BOARDS_DATA || [];
    const board = boards.find((b) => String(b.id) === String(boardId));
    if (!board) return '';
    let html = board.lists.map((l) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('');
    html += `<option value="__new__">+ Create new list</option>`;
    return html;
  }

  function tagPickerHtml(boardId) {
    const boards = window.BOARDS_DATA || [];
    const board = boards.find((b) => String(b.id) === String(boardId));
    const tags = board ? board.tags : (window.ORG_TAGS || []);
    if (!tags || tags.length === 0) return '<span style="font-size:12px; color:var(--text-muted);">No tags yet -- add some from the Tags page.</span>';
    return tags.map((t) => `
      <label style="background:${t.color}1a; border-color:${t.color};">
        <input type="checkbox" name="tag_ids" value="${t.id}" data-color="${t.color}" onchange="window.__applyMapTagStyle(this)">
        ${escapeHtml(t.name)}
      </label>
    `).join('');
  }

  function popupFormHtml(lat, lng) {
    const boards = window.BOARDS_DATA || [];
    const hasBoards = boards.length > 0;
    return `
      <form class="popup-form" id="prospectForm" enctype="multipart/form-data">
        <h3>New card</h3>
        <label>Name *</label>
        <input type="text" name="name" required>
        <label>Phone</label>
        <input type="tel" name="phone">
        <label>Address</label>
        <input type="text" name="address" id="addressField" placeholder="Looking it up...">

        <label>Board</label>
        <select name="board_id" id="boardSelect">
          ${hasBoards ? boardOptionsHtml() : '<option value="__new__">+ Create new board</option>'}
        </select>
        <div class="inline-new ${hasBoards ? '' : 'open'}" id="newBoardFields">
          <label>New board title</label>
          <input type="text" name="new_board_title" id="newBoardTitle" placeholder="e.g. Sunday Outreach">
          <label>Template</label>
          <select name="new_board_template" id="newBoardTemplate">${templateOptionsHtml()}</select>
        </div>

        <div id="listFieldWrap" style="${hasBoards ? '' : 'display:none;'}">
          <label>List</label>
          <select name="list_id" id="listSelect">${hasBoards ? listOptionsHtml(boards[0] && boards[0].id) : ''}</select>
          <div class="inline-new" id="newListFields">
            <label>New list name</label>
            <input type="text" name="new_list_name" id="newListName" placeholder="e.g. Follow-Up">
          </div>
        </div>

        <label>Tags</label>
        <div class="tag-picker" id="popupTagPicker"></div>
        <label>Notes</label>
        <textarea name="notes" placeholder="Conversation notes, best time to return..."></textarea>
        <label>Attach files</label>
        <input type="file" id="popupFileInput" class="file-input" multiple accept="image/*,application/pdf,video/mp4,video/quicktime">

        <input type="hidden" name="lat" value="${lat}">
        <input type="hidden" name="lng" value="${lng}">
        <div class="modal-actions">
          <span></span>
          <div>
            <button type="button" class="btn ghost" id="mapCreateCancel">Cancel</button>
            <button type="submit" class="btn">Save card</button>
          </div>
        </div>
      </form>
    `;
  }

  window.__applyMapTagStyle = function (checkbox) {
    const label = checkbox.closest('label');
    const color = checkbox.getAttribute('data-color');
    label.classList.toggle('checked', checkbox.checked);
    label.style.background = checkbox.checked ? color : `${color}1a`;
  };

  function wirePopupForm() {
    const boardSelect = document.getElementById('boardSelect');
    const newBoardFields = document.getElementById('newBoardFields');
    const listFieldWrap = document.getElementById('listFieldWrap');
    const listSelect = document.getElementById('listSelect');
    const newListFields = document.getElementById('newListFields');
    const tagPicker = document.getElementById('popupTagPicker');

    function refreshForBoard() {
      const val = boardSelect.value;
      if (val === '__new__') {
        newBoardFields.classList.add('open');
        listFieldWrap.style.display = 'none';
      } else {
        newBoardFields.classList.remove('open');
        listFieldWrap.style.display = '';
        listSelect.innerHTML = listOptionsHtml(val);
        newListFields.classList.remove('open');
      }
      tagPicker.innerHTML = tagPickerHtml(val === '__new__' ? null : val);
    }

    if (boardSelect) {
      boardSelect.addEventListener('change', refreshForBoard);
      refreshForBoard();
    } else {
      tagPicker.innerHTML = tagPickerHtml(null);
    }
    if (listSelect) {
      listSelect.addEventListener('change', function () {
        newListFields.classList.toggle('open', listSelect.value === '__new__');
      });
    }
  }

  // --- Filter panel: board / list / tag ---
  // Built entirely in JS (no template/CSS file changes needed) using the
  // app's existing global classes (.btn, .card-panel, base input/select
  // styling) so it looks native without adding a new stylesheet. Pushed
  // onto the map as a custom control the same way the type-toggle is.
  let allPins = [];
  const filterState = { boardId: '', listId: '', tagId: '' };

  const filterWrap = document.createElement('div');
  filterWrap.style.position = 'relative';

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'btn ghost small';
  toggleBtn.style.background = '#fff';
  toggleBtn.style.boxShadow = '0 1px 4px rgba(0,0,0,0.3)';
  toggleBtn.textContent = 'Filters';
  filterWrap.appendChild(toggleBtn);

  const panel = document.createElement('div');
  panel.className = 'card-panel';
  panel.style.cssText = 'position:absolute; top:38px; right:0; width:220px; display:none; z-index:1000;';
  filterWrap.appendChild(panel);

  const boardsForFilter = window.BOARDS_DATA || [];
  const allTagsMap = {};
  boardsForFilter.forEach((b) => (b.tags || []).forEach((t) => { allTagsMap[t.id] = t; }));
  const allTags = Object.values(allTagsMap);

  panel.innerHTML = `
    <label style="margin-top:0;">Board</label>
    <select id="filterBoard">
      <option value="">All boards</option>
      ${boardsForFilter.map((b) => `<option value="${b.id}">${escapeHtml(b.title)}</option>`).join('')}
    </select>
    <label>List</label>
    <select id="filterList" disabled>
      <option value="">All lists</option>
    </select>
    <label>Tag</label>
    <select id="filterTag">
      <option value="">Any tag</option>
      ${allTags.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
    </select>
    <button type="button" class="btn ghost small" id="filterClear" style="width:100%; margin-top:10px;">Clear filters</button>
  `;

  // Stop clicks/drags inside the control from reaching the map underneath
  // (Google Maps controls sit outside the map div so this matters less than
  // it did with Leaflet's overlay-based controls, but it's still worth
  // guarding against a stray drag-to-pan starting on the panel).
  ['click', 'dblclick', 'mousedown', 'touchstart', 'wheel'].forEach((evt) => {
    filterWrap.addEventListener(evt, (e) => e.stopPropagation());
  });

  toggleBtn.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });

  const boardSel = panel.querySelector('#filterBoard');
  const listSel = panel.querySelector('#filterList');
  const tagSel = panel.querySelector('#filterTag');
  const clearBtn = panel.querySelector('#filterClear');

  boardSel.addEventListener('change', () => {
    filterState.boardId = boardSel.value;
    filterState.listId = '';
    const board = boardsForFilter.find((b) => String(b.id) === boardSel.value);
    if (board) {
      listSel.disabled = false;
      listSel.innerHTML = '<option value="">All lists</option>' +
        board.lists.map((l) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('');
    } else {
      listSel.disabled = true;
      listSel.innerHTML = '<option value="">All lists</option>';
    }
    renderFilteredPins();
  });
  listSel.addEventListener('change', () => { filterState.listId = listSel.value; renderFilteredPins(); });
  tagSel.addEventListener('change', () => { filterState.tagId = tagSel.value; renderFilteredPins(); });
  clearBtn.addEventListener('click', () => {
    filterState.boardId = ''; filterState.listId = ''; filterState.tagId = '';
    boardSel.value = ''; tagSel.value = ''; listSel.value = ''; listSel.disabled = true;
    listSel.innerHTML = '<option value="">All lists</option>';
    renderFilteredPins();
  });

  map.controls[google.maps.ControlPosition.TOP_RIGHT].push(filterWrap);

  function pinMatchesFilter(p) {
    if (filterState.boardId && String(p.board_id) !== filterState.boardId) return false;
    if (filterState.listId && String(p.list_id) !== filterState.listId) return false;
    if (filterState.tagId && !(p.tags || []).some((t) => String(t.id) === filterState.tagId)) return false;
    return true;
  }

  // One shared InfoWindow (Google's equivalent of a Leaflet popup) reused
  // across pins, plus the live list of pin markers so we can clear them
  // when filters change (Leaflet's layerGroup.clearLayers() equivalent).
  const sharedInfoWindow = new google.maps.InfoWindow();
  let prospectMarkers = [];

  function renderFilteredPins() {
    prospectMarkers.forEach((m) => m.setMap(null));
    prospectMarkers = [];
    allPins.filter(pinMatchesFilter).forEach((p) => {
      const lat = Number(p.lat);
      const lng = Number(p.lng);
      const pinColor = (p.tags && p.tags[0]) ? p.tags[0].color : '#3AA0E0';
      const marker = new google.maps.Marker({
        position: { lat, lng },
        map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          strokeColor: '#1B2A41',
          strokeWeight: 2,
          fillColor: pinColor,
          fillOpacity: 0.9
        }
      });
      const tagChips = (p.tags || []).map((t) => `<span class="tag-chip" style="background:${t.color};">${escapeHtml(t.name)}</span>`).join(' ');
      const content = `
        <div style="min-width:220px;">
          <strong>${escapeHtml(p.name)}</strong><br>
          <span style="font-size:12px;color:#555;">${escapeHtml(p.board_title || '')} &rsaquo; ${escapeHtml(p.list_name || '')}</span><br>
          ${tagChips ? `<div style="margin:4px 0;">${tagChips}</div>` : ''}
          ${p.address ? `<span style="font-size:12px;">${escapeHtml(p.address)}</span><br>` : ''}
          ${p.phone ? `<span style="font-size:12px;">${escapeHtml(p.phone)}</span><br>` : ''}
          ${p.assigned_name ? `<span style="font-size:12px;">Assigned: ${escapeHtml(p.assigned_name)}</span><br>` : ''}
          <a href="/boards/${p.board_id}" style="font-size:12px;">Open board &rarr;</a>
        </div>
      `;
      marker.addListener('click', () => {
        sharedInfoWindow.setContent(content);
        sharedInfoWindow.open({ anchor: marker, map });
      });
      prospectMarkers.push(marker);
    });
  }

  function loadProspects() {
    fetch('/api/map-pins')
      .then((r) => r.json())
      .then((rows) => {
        allPins = rows;
        renderFilteredPins();
      });
  }

  // --- Create-card modal: a fixed overlay, NOT a map-anchored popup. A
  // map-anchored popup re-positions (and can auto-pan the whole map) as you
  // interact with it, which felt like the form was "moving around". This
  // instead reuses the app's existing modal pattern (same .modal-backdrop /
  // .modal-box classes as the board's card/settings modals) so it stays
  // fixed and centered regardless of the map underneath.
  let createModalEl = null;
  function ensureCreateModal() {
    if (createModalEl) return createModalEl;
    createModalEl = document.createElement('div');
    createModalEl.className = 'modal-backdrop';
    createModalEl.id = 'mapCreateModal';
    document.body.appendChild(createModalEl);
    return createModalEl;
  }

  function openCreateModal(lat, lng) {
    const modal = ensureCreateModal();
    modal.innerHTML = `<div class="modal-box">${popupFormHtml(lat.toFixed(6), lng.toFixed(6))}</div>`;
    modal.classList.add('open');
    wirePopupForm();
  }

  function closeCreateModal() {
    if (createModalEl) createModalEl.classList.remove('open');
    if (clickMarker) { clickMarker.setMap(null); clickMarker = null; }
  }

  map.addListener('click', (e) => {
    const lat = e.latLng.lat();
    const lng = e.latLng.lng();
    if (clickMarker) clickMarker.setMap(null);
    clickMarker = new google.maps.Marker({ position: { lat, lng }, map });
    openCreateModal(lat, lng);

    fetch(`/api/reverse-geocode?lat=${lat}&lng=${lng}`)
      .then((r) => r.json())
      .then((data) => {
        const field = document.getElementById('addressField');
        if (!field) return;
        if (data.address) field.value = data.address;
        else field.placeholder = "Couldn't auto-fill — type the address";
      })
      .catch(() => {
        const field = document.getElementById('addressField');
        if (field) field.placeholder = "Couldn't auto-fill — type the address";
      });
  });

  document.addEventListener('submit', function (e) {
    if (e.target.id !== 'prospectForm') return;
    e.preventDefault();
    const form = e.target;
    const fileInput = document.getElementById('popupFileInput');
    const checkedTagIds = Array.from(form.querySelectorAll('input[name="tag_ids"]:checked')).map((cb) => cb.value);
    const payload = Object.fromEntries(new FormData(form).entries());
    delete payload.files;
    delete payload.tag_ids; // FormData/fromEntries only keeps the last checkbox with this name -- use the array collected above instead
    payload.tag_ids = checkedTagIds;

    if (payload.board_id === '__new__') {
      delete payload.board_id;
    } else {
      delete payload.new_board_title;
      delete payload.new_board_template;
    }
    if (payload.list_id === '__new__' || !payload.list_id) {
      delete payload.list_id;
    } else {
      delete payload.new_list_name;
    }

    fetch('/api/map-pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || 'Could not save.');
        const cardId = data.card.id;
        if (fileInput && fileInput.files.length) {
          const fd = new FormData();
          Array.from(fileInput.files).forEach((f) => fd.append('files', f));
          return fetch(`/api/cards/${cardId}/attachments`, { method: 'POST', body: fd }).catch(() => {});
        }
      })
      .then(() => {
        closeCreateModal();
        loadProspects();
      })
      .catch((err) => alert(err.message));
  });

  document.addEventListener('click', function (e) {
    if (e.target.id === 'mapCreateCancel') closeCreateModal();
  });

  loadProspects();
}
