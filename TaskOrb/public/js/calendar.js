(function () {
  var items = (window.FOLLOWUPS || []).map(function (f) { f.when = new Date(f.follow_up_at); return f; });
  var meId = window.ME_ID;
  var onlyMine = false;

  var today = new Date(); today.setHours(0, 0, 0, 0);
  var viewMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  var selected = new Date(today);

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;   // textContent, never innerHTML: card names are user input
    return e;
  }
  function dayKey(d) { return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
  function sameDay(a, b) { return dayKey(a) === dayKey(b); }
  function timeStr(d) { return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function labelOf(f) { return f.date_label || 'Due date'; }
  // Opens the board with this card's modal already open (see followup-card.js).
  function cardUrl(f) { return '/boards/' + f.board_id + '?card=' + f.id; }
  function visible() {
    return items.filter(function (f) { return !onlyMine || f.assigned_to === meId || f.follow_up_set_by === meId; });
  }
  function groupByDay(list) {
    var map = {};
    list.forEach(function (f) { (map[dayKey(f.when)] = map[dayKey(f.when)] || []).push(f); });
    return map;
  }

  // ---- Month grid --------------------------------------------------
  function renderGrid() {
    var grid = document.getElementById('calGrid');
    grid.innerHTML = '';
    document.getElementById('calMonthTitle').textContent =
      viewMonth.toLocaleDateString([], { month: 'long', year: 'numeric' });

    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(function (d) { grid.appendChild(el('div', 'cal-weekday', d)); });

    var byDay = groupByDay(visible());
    var first = new Date(viewMonth);
    var start = new Date(first); start.setDate(1 - first.getDay());
    var now = new Date();

    for (var i = 0; i < 42; i++) {
      var date = new Date(start); date.setDate(start.getDate() + i);
      // A div, not a button: the chips inside are links, and interactive
      // elements can't be nested inside a button.
      var cell = el('div', 'cal-day');
      cell.setAttribute('role', 'button');
      cell.tabIndex = 0;
      cell.setAttribute('aria-label', date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
      if (date.getMonth() !== viewMonth.getMonth()) cell.classList.add('other-month');
      if (sameDay(date, today)) cell.classList.add('today');
      if (sameDay(date, selected)) cell.classList.add('selected');

      cell.appendChild(el('span', 'cal-date', String(date.getDate())));
      var dayItems = (byDay[dayKey(date)] || []).slice().sort(function (a, b) { return a.when - b.when; });
      dayItems.slice(0, 2).forEach(function (f) {
        // Each chip links straight to the card on its board.
        var chip = el('a', 'cal-chip' + (f.when < now ? ' past' : ''), timeStr(f.when) + ' ' + f.name);
        chip.href = cardUrl(f);
        chip.title = labelOf(f) + ': ' + f.name + ' \u00B7 ' + f.board_title;
        chip.addEventListener('click', function (e) { e.stopPropagation(); });
        cell.appendChild(chip);
      });
      if (dayItems.length > 2) cell.appendChild(el('span', 'cal-more', '+' + (dayItems.length - 2) + ' more'));
      if (dayItems.length > 0) cell.appendChild(el('span', 'cal-count', String(dayItems.length)));

      (function (d) {
        function select() {
          selected = new Date(d);
          if (d.getMonth() !== viewMonth.getMonth()) viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
          renderAll();
          // On a phone the grid shows only counts, so bring the day's list into view.
          if (window.matchMedia && window.matchMedia('(max-width: 700px)').matches) {
            document.getElementById('dayTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
        cell.addEventListener('click', select);
        cell.addEventListener('keydown', function (e) {
          if (e.target === cell && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(); }
        });
      })(date);
      grid.appendChild(cell);
    }
  }

  // ---- Lists -------------------------------------------------------
  function removeItem(f) {
    var what = labelOf(f).toLowerCase();
    if (!confirm('Remove the ' + what + ' from "' + f.name + '"?\n\nIt will disappear from the calendar and its reminder will be cancelled. The card itself stays on the board.')) return;
    fetch('/api/cards/' + f.id + '/follow-up', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ followUpAt: null })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.data.error || 'Could not remove it.');
        items = items.filter(function (x) { return x.id !== f.id; });
        renderAll();
      })
      .catch(function (err) { alert(err.message); });
  }

  function renderItem(f) {
    var past = f.when < new Date();
    var row = el('div', 'fu-item' + (past ? ' past' : ''));
    row.title = 'Open "' + f.name + '" on its board';

    var time = el('div', 'fu-time');
    time.appendChild(el('div', null, timeStr(f.when)));
    time.appendChild(el('div', 'fu-date', f.when.toLocaleDateString([], { month: 'short', day: 'numeric' })));
    row.appendChild(time);

    var body = el('div', 'fu-body');
    var name = el('a', 'fu-name', f.name);
    name.href = cardUrl(f);
    body.appendChild(name);
    var meta = el('div', 'fu-meta');
    meta.appendChild(el('span', 'fu-label', labelOf(f)));
    meta.appendChild(document.createTextNode(' ' + f.board_title + ' \u203A ' + f.list_name + (f.assigned_name ? ' \u00B7 ' + f.assigned_name : '')));
    body.appendChild(meta);
    if (f.address) body.appendChild(el('div', 'fu-meta', f.address));
    row.appendChild(body);

    var actions = el('div', 'fu-actions');
    var open = el('a', null, 'Open'); open.href = cardUrl(f); actions.appendChild(open);
    var g = el('a', null, 'Google'); g.href = '/cards/' + f.id + '/follow-up/google'; g.target = '_blank'; g.rel = 'noopener'; actions.appendChild(g);
    var ics = el('a', null, '.ics'); ics.href = '/cards/' + f.id + '/follow-up.ics'; ics.title = 'Apple Calendar / Outlook / any calendar app'; actions.appendChild(ics);
    if (f.can_edit) {
      var rm = el('button', 'fu-remove', 'Remove');
      rm.type = 'button';
      rm.title = 'Remove this ' + labelOf(f).toLowerCase() + ' and cancel its reminder';
      rm.addEventListener('click', function (e) { e.stopPropagation(); removeItem(f); });
      actions.appendChild(rm);
    }
    row.appendChild(actions);

    // The whole row is a link target too, not just the name -- except for
    // the action buttons, which do their own thing.
    row.addEventListener('click', function (e) {
      if (e.target.closest('a, button')) return;
      window.location.href = cardUrl(f);
    });
    return row;
  }

  function renderDay() {
    document.getElementById('dayTitle').textContent =
      selected.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    var list = document.getElementById('dayList');
    list.innerHTML = '';
    var todays = (groupByDay(visible())[dayKey(selected)] || []).slice().sort(function (a, b) { return a.when - b.when; });
    if (todays.length === 0) { list.appendChild(el('p', 'cal-empty', 'Nothing scheduled this day.')); return; }
    todays.forEach(function (f) { list.appendChild(renderItem(f)); });
  }

  function renderUpcoming() {
    var list = document.getElementById('upcomingList');
    list.innerHTML = '';
    var now = new Date();
    var next = visible().filter(function (f) { return f.when >= now; }).sort(function (a, b) { return a.when - b.when; }).slice(0, 8);
    if (next.length === 0) { list.appendChild(el('p', 'cal-empty', 'Nothing coming up. Open any card and set a date to see it here.')); return; }
    next.forEach(function (f) { list.appendChild(renderItem(f)); });
  }

  function renderAll() { renderGrid(); renderDay(); renderUpcoming(); }

  document.getElementById('calPrev').addEventListener('click', function () { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1); renderGrid(); });
  document.getElementById('calNext').addEventListener('click', function () { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1); renderGrid(); });
  document.getElementById('calToday').addEventListener('click', function () {
    selected = new Date(today); viewMonth = new Date(today.getFullYear(), today.getMonth(), 1); renderAll();
  });
  document.querySelectorAll('.cal-filter button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      onlyMine = btn.getAttribute('data-filter') === 'mine';
      document.querySelectorAll('.cal-filter button').forEach(function (b) { b.classList.toggle('active', b === btn); });
      renderAll();
    });
  });

  // ---- Notification panel -----------------------------------------
  function renderPush() {
    var text = document.getElementById('pushText');
    var actions = document.getElementById('pushActions');
    actions.innerHTML = '';
    function button(label, cls, handler) {
      var b = el('button', 'btn small ' + (cls || ''), label);
      b.type = 'button'; b.addEventListener('click', handler); actions.appendChild(b); return b;
    }
    if (!window.TaskOrbPush) { text.textContent = 'Notifications are unavailable on this page.'; return; }

    TaskOrbPush.status().then(function (s) {
      switch (s.state) {
        case 'server-off':
          text.textContent = 'Device notifications aren\u2019t switched on for this server yet. You\u2019ll still get reminders in the bell icon.';
          if (s.reason) {
            // Only platform admins are sent a reason, so this never shows to ordinary users.
            text.appendChild(document.createElement('br'));
            text.appendChild(el('strong', null, 'Admin note: '));
            text.appendChild(document.createTextNode(s.reason + '.'));
          }
          break;
        case 'ios-install':
          text.innerHTML = '';
          text.appendChild(el('strong', null, 'Get reminders on your iPhone or iPad. '));
          text.appendChild(document.createTextNode('Apple only allows notifications for apps on your Home Screen: tap Share, choose \u201CAdd to Home Screen\u201D, open TaskOrb from there, then come back to this page.'));
          break;
        case 'unsupported':
          text.textContent = 'This browser can\u2019t show device notifications. You\u2019ll still get reminders in the bell icon.'; break;
        case 'denied':
          text.textContent = 'Notifications are blocked for TaskOrb in your browser settings. Allow them there, then reload this page.'; break;
        case 'on':
          text.innerHTML = '';
          text.appendChild(el('strong', null, 'Device notifications are on. '));
          text.appendChild(document.createTextNode('You\u2019ll get a reminder on this device before each date, even when TaskOrb is closed.'));
          button('Send a test', 'ghost', function () {
            TaskOrbPush.test().then(function (n) { text.appendChild(document.createTextNode(n ? ' Test sent \u2014 check your notifications.' : ' No device received it.')); })
              .catch(function (e) { alert(e.message); });
          });
          button('Turn off', 'ghost', function () { TaskOrbPush.disable().then(renderPush); });
          break;
        default:
          text.textContent = 'Get a notification on this phone or computer before each date, even when TaskOrb is closed.';
          button('Turn on notifications', '', function () {
            TaskOrbPush.enable().then(renderPush).catch(function (e) { alert(e.message); renderPush(); });
          });
      }
    }).catch(function () { text.textContent = 'Couldn\u2019t check notification settings.'; });
  }

  renderAll();
  renderPush();
})();
