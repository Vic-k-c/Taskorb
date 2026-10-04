// Follow-up appointment controls inside the card modal. Wraps (rather than
// edits) board.js's openCard so the existing modal code stays untouched.
(function () {
  var input = document.getElementById('cardFollowUp');
  if (!input) return;
  var remind = document.getElementById('cardRemindBefore');
  var statusEl = document.getElementById('followUpStatus');
  var links = document.getElementById('followUpLinks');
  var saveBtn = document.getElementById('followUpSave');
  var clearBtn = document.getElementById('followUpClear');

  function pad(n) { return String(n).padStart(2, '0'); }
  // <input type="datetime-local"> wants local wall-clock time, not UTC.
  function toLocalInput(iso) {
    var d = new Date(iso);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function formatChip(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function currentCard() {
    var id = document.getElementById('cardId').value;
    return window.BOARD_DATA.flatMap(function (l) { return l.cards; }).find(function (c) { return String(c.id) === String(id); });
  }
  function setStatus(msg, bad) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('bad', !!bad);
  }
  function showLinks(card) {
    if (card && card.follow_up_at) {
      links.style.display = '';
      document.getElementById('followUpGoogle').href = '/cards/' + card.id + '/follow-up/google';
      document.getElementById('followUpIcs').href = '/cards/' + card.id + '/follow-up.ics';
    } else {
      links.style.display = 'none';
    }
  }
  function updateChip(cardId, iso) {
    var tile = document.querySelector('.prospect-card[data-card-id="' + cardId + '"]');
    var tags = tile && tile.querySelector('.ptags');
    if (!tags) return;
    var chip = tags.querySelector('.followup-chip');
    if (!iso) { if (chip) chip.remove(); return; }
    if (!chip) { chip = document.createElement('span'); chip.className = 'tag followup-chip'; tags.appendChild(chip); }
    chip.textContent = '\uD83D\uDCC5 ' + formatChip(iso);
    chip.title = window.BOARD_DATE_LABEL || 'Due date';
  }

  // The server renders each chip with a UTC timestamp; it can't know the
  // viewer's timezone, so fill in the visible text here.
  document.querySelectorAll('.followup-chip[data-followup]').forEach(function (c) {
    c.textContent = '\uD83D\uDCC5 ' + formatChip(c.getAttribute('data-followup'));
    c.title = window.BOARD_DATE_LABEL || 'Due date';
  });

  var originalOpenCard = window.openCard;
  window.openCard = function (id) {
    originalOpenCard(id);
    var card = currentCard();
    if (card && card.follow_up_at) {
      input.value = toLocalInput(card.follow_up_at);
      remind.value = String(card.follow_up_remind_before == null ? 60 : card.follow_up_remind_before);
    } else {
      input.value = '';
      remind.value = '60';
    }
    setStatus('');
    showLinks(card);
  };

  function send(followUpAt) {
    var card = currentCard();
    if (!card) return;
    setStatus('Saving\u2026');
    fetch('/api/cards/' + card.id + '/follow-up', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ followUpAt: followUpAt, remindBefore: Number(remind.value) })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.data.error || 'Could not save.');
        card.follow_up_at = res.data.followUpAt;
        card.follow_up_remind_before = res.data.remindBefore;
        showLinks(card);
        updateChip(card.id, res.data.followUpAt);
        if (!res.data.followUpAt) input.value = '';
        setStatus(res.data.followUpAt ? 'Saved.' : 'Cleared.');
      })
      .catch(function (err) { setStatus(err.message, true); });
  }

  // Deep link: /boards/12?card=34 (from the calendar, a reminder
  // notification, or an exported calendar event) opens straight onto that
  // card. The parameter is stripped once used, otherwise saving the card
  // (which reloads the page) would reopen it every time.
  (function openLinkedCard() {
    var wanted = parseInt(new URLSearchParams(window.location.search).get('card'), 10);
    if (!wanted) return;
    var tile = document.querySelector('.prospect-card[data-card-id="' + wanted + '"]');
    if (tile) {
      tile.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      tile.classList.add('deeplink-flash');
      window.openCard(wanted);
    }
    history.replaceState(null, '', window.location.pathname);
  })();

  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      if (!input.value) { setStatus('Choose a date and time first.', true); return; }
      send(new Date(input.value).toISOString());   // parsed as local time, sent as UTC
    });
  }
  if (clearBtn) clearBtn.addEventListener('click', function () { send(null); });
})();
