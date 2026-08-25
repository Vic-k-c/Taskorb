(function () {
  const DEFAULT_CENTER = [39.8283, -98.5795]; // fallback: center of the US
  const map = L.map('map', { zoomControl: true }).setView(DEFAULT_CENTER, 5);

  const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  });
  const satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics' }
  );
  streetLayer.addTo(map);

  // Compact Google-Maps-style map type toggle (bottom-right thumbnail button)
  // instead of a full layer-list control, which ate too much screen on mobile.
  const MapTypeToggle = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd: function () {
      const el = L.DomUtil.create('div', 'map-type-toggle');
      let onSatellite = false;
      function render() {
        el.style.backgroundImage = onSatellite
          ? "url('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/2/2')"
          : "url('https://tile.openstreetmap.org/3/2/2.png')";
        el.innerHTML = `<span>${onSatellite ? 'Map' : 'Satellite'}</span>`;
      }
      render();
      L.DomEvent.on(el, 'click', function (e) {
        L.DomEvent.stopPropagation(e);
        onSatellite = !onSatellite;
        if (onSatellite) { map.removeLayer(streetLayer); satelliteLayer.addTo(map); }
        else { map.removeLayer(satelliteLayer); streetLayer.addTo(map); }
        render();
      });
      L.DomEvent.disableClickPropagation(el);
      return el;
    }
  });
  map.addControl(new MapTypeToggle());

  const hint = document.getElementById('mapHint');
  let clickMarker = null;
  const prospectMarkers = L.layerGroup().addTo(map);

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
        map.setView([latitude, longitude], 17);
        L.circleMarker([latitude, longitude], {
          radius: 8, color: '#1B2A41', fillColor: '#5D8A66', fillOpacity: 0.9, weight: 2
        }).addTo(map).bindTooltip('You are here');
        setHint('Tap anywhere on the map to log a card there.', true);
      },
      () => { setHint("Couldn't find your location \u2014 scroll the map, then tap a spot to log a card.", true); },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  } else {
    setHint('Tap anywhere on the map to log a card there.', true);
  }

  function interestColor(level) {
    return (window.INTEREST_COLORS && window.INTEREST_COLORS[level]) || '#3AA0E0';
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
    return Object.keys(templates).map((key) => `<option value="${key}">${templates[key].label}</option>`).join('');
  }

  function listOptionsHtml(boardId) {
    const boards = window.BOARDS_DATA || [];
    const board = boards.find((b) => String(b.id) === String(boardId));
    if (!board) return '';
    let html = board.lists.map((l) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('');
    html += `<option value="__new__">+ Create new list</option>`;
    return html;
  }

  function popupFormHtml(lat, lng) {
    const boards = window.BOARDS_DATA || [];
    const hasBoards = boards.length > 0;
    return `
      <form class="popup-form" id="prospectForm" enctype="multipart/form-data">
        <strong>New card</strong>
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

        <label>Priority</label>
        <select name="priority">
          <option value="warm" selected>Normal</option>
          <option value="hot">Urgent</option>
          <option value="cold">Low priority</option>
        </select>
        <label>Notes</label>
        <textarea name="notes" placeholder="Conversation notes, best time to return..."></textarea>
        <label>Attach files</label>
        <input type="file" id="popupFileInput" class="file-input" multiple accept="image/*,application/pdf,video/mp4,video/quicktime">

        <input type="hidden" name="lat" value="${lat}">
        <input type="hidden" name="lng" value="${lng}">
        <button type="submit" class="btn">Save card</button>
      </form>
    `;
  }

  function wirePopupForm() {
    const boardSelect = document.getElementById('boardSelect');
    const newBoardFields = document.getElementById('newBoardFields');
    const listFieldWrap = document.getElementById('listFieldWrap');
    const listSelect = document.getElementById('listSelect');
    const newListFields = document.getElementById('newListFields');

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
    }

    if (boardSelect) {
      boardSelect.addEventListener('change', refreshForBoard);
      refreshForBoard();
    }
    if (listSelect) {
      listSelect.addEventListener('change', function () {
        newListFields.classList.toggle('open', listSelect.value === '__new__');
      });
    }
  }

  function loadProspects() {
    fetch('/api/map-pins')
      .then((r) => r.json())
      .then((rows) => {
        prospectMarkers.clearLayers();
        rows.forEach((p) => {
          const marker = L.circleMarker([p.lat, p.lng], {
            radius: 9, color: '#1B2A41', weight: 2,
            fillColor: interestColor(p.priority), fillOpacity: 0.9
          });
          marker.bindPopup(`
            <strong>${escapeHtml(p.name)}</strong><br>
            <span style="font-size:12px;color:#555;">${escapeHtml(p.board_title || '')} &rsaquo; ${escapeHtml(p.list_name || '')}</span><br>
            ${p.address ? `<span style="font-size:12px;">${escapeHtml(p.address)}</span><br>` : ''}
            ${p.phone ? `<span style="font-size:12px;">${escapeHtml(p.phone)}</span><br>` : ''}
            ${p.assigned_name ? `<span style="font-size:12px;">Assigned: ${escapeHtml(p.assigned_name)}</span><br>` : ''}
            <a href="/boards/${p.board_id}" style="font-size:12px;">Open board &rarr;</a>
          `);
          marker.addTo(prospectMarkers);
        });
      });
  }

  map.on('click', (e) => {
    const { lat, lng } = e.latlng;
    if (clickMarker) map.removeLayer(clickMarker);
    clickMarker = L.marker([lat, lng]).addTo(map);
    clickMarker.bindPopup(popupFormHtml(lat.toFixed(6), lng.toFixed(6)), { minWidth: 280, maxWidth: 320 }).openPopup();
    wirePopupForm();

    fetch(`/api/reverse-geocode?lat=${lat}&lng=${lng}`)
      .then((r) => r.json())
      .then((data) => {
        const field = document.getElementById('addressField');
        if (field && data.address) field.value = data.address;
      })
      .catch(() => {});
  });

  document.addEventListener('submit', function (e) {
    if (e.target.id !== 'prospectForm') return;
    e.preventDefault();
    const form = e.target;
    const fileInput = document.getElementById('popupFileInput');
    const payload = Object.fromEntries(new FormData(form).entries());
    delete payload.files;

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
        map.closePopup();
        if (clickMarker) { map.removeLayer(clickMarker); clickMarker = null; }
        loadProspects();
      })
      .catch((err) => alert(err.message));
  });

  loadProspects();
})();
