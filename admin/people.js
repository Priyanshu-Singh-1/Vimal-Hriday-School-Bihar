(function () {
  'use strict';

  // Screen 09 — People who can sign in (owner only). Shared header, session,
  // and status-strip behavior live in admin.js on window.VHS; this file only
  // fetches/renders the people table and wires Remove, per
  // design_handoff_admin_console/README.md ("09 — People who can sign in").
  //
  // MICROCOPY.md has no entry for: the muted line replacing the removed
  // "Add a person" card (README says an existing console line should be
  // reused, but none of the console's current copy matches this meaning),
  // the remove-person confirm dialog's title/body/button labels (MICROCOPY's
  // "Remove modal" entry is specific to removing a *photo*), or the
  // last-owner refusal message. Each is written in the sheet's stated voice
  // (short, literal, verb-first) and flagged in the task report rather than
  // silently invented.
  var VHS = window.VHS;
  var API = VHS.API;

  var alertEl = VHS.$('peopleAlert');
  var contentEl = VHS.$('peopleContent');
  var rowsEl = VHS.$('peopleRows');
  var currentUserId = null;

  // README "12": a loading block while the first GET /v1/users is in
  // flight, an offline block in its place if that first fetch fails.
  // Inserted here (not in people.html) since this screen's own file is the
  // only one this task may touch.
  var stateEl = document.createElement('div');
  document.querySelector('.vhs-people-body').insertBefore(stateEl, alertEl);
  var loadedOnce = false;

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  // "Today, 2:40 pm" / "Yesterday, 11:05 am" / "12 August, 10:20 am" — same
  // today/yesterday/day-month convention as the activity screen (README
  // "10", "Dates: 'today' / 'yesterday' / '12 August'"), measured off the
  // 09 canvas for the exact "Today, <time>" phrasing.
  function formatLastSignIn(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    var now = new Date();
    var diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
    var dayLabel = diffDays === 0 ? 'Today' : diffDays === 1 ? 'Yesterday' : (d.getDate() + ' ' + MONTHS[d.getMonth()]);

    var hours = d.getHours();
    var minutes = d.getMinutes();
    var ampm = hours >= 12 ? 'pm' : 'am';
    var h12 = hours % 12;
    if (h12 === 0) h12 = 12;
    var mm = minutes < 10 ? '0' + minutes : String(minutes);

    return dayLabel + ', ' + h12 + ':' + mm + ' ' + ampm;
  }

  // Role: editor -> "Can change photos" / owner -> "Can change photos and
  // manage people" (MICROCOPY.md "Role: editor" / "Role: owner") — the raw
  // words "owner"/"editor" are never printed.
  function roleBadge(role) {
    var span = document.createElement('span');
    if (role === 'owner') {
      span.className = 'vhs-badge vhs-badge-owner';
      span.textContent = 'Can change photos and manage people';
    } else {
      span.className = 'vhs-badge vhs-badge-editor';
      span.textContent = 'Can change photos';
    }
    return span;
  }

  function resetAlert() {
    VHS.show(alertEl, false);
  }

  function showRefusal(message) {
    alertEl.textContent = message;
    VHS.show(alertEl, true);
  }

  function removePerson(person) {
    fetch(API + '/v1/users/' + person.id, { method: 'DELETE', headers: VHS.authHeaders() }).then(function (res) {
      if (res.status === 401) { VHS.showSessionExpired(); return; }
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (res.ok) {
          resetAlert();
          loadUsers();
          return;
        }
        if (body && body.error === 'cannot delete the last owner') {
          // No verbatim copy for this refusal exists in MICROCOPY.md; see
          // the file header comment.
          showRefusal('This person cannot be removed. They are the only one who can change photos and manage people.');
          return;
        }
        // Any other refusal (not found, self-delete guard) has no verbatim
        // copy either and cannot be reached from this table's own UI (the
        // signed-in operator's own row never gets a Remove button), so the
        // list is refreshed rather than inventing a message.
        loadUsers();
      });
    }).catch(function () { /* offline: leave the table as-is */ });
  }

  function confirmRemove(person) {
    VHS.openModal({
      title: 'Remove this person?',
      buildBody: function (body) {
        var text = document.createElement('div');
        text.className = 'vhs-modal-text';
        text.textContent = 'They will no longer be able to sign in.';
        body.appendChild(text);
      },
      buttons: [
        { label: 'No, keep them', className: 'vhs-modal-btn-secondary' },
        { label: 'Yes, remove this person', className: 'vhs-modal-btn-destructive', onClick: function () { removePerson(person); } }
      ]
    });
  }

  function buildRow(person) {
    var isYou = person.id === currentUserId;

    var row = document.createElement('div');
    row.className = 'vhs-row vhs-people-row';

    var nameCell = document.createElement('div');
    nameCell.className = 'vhs-body';
    nameCell.appendChild(document.createTextNode(person.displayName || person.username || ''));
    if (isYou) {
      nameCell.appendChild(document.createTextNode(' '));
      var you = document.createElement('span');
      you.className = 'vhs-muted-text';
      you.textContent = '(you)';
      nameCell.appendChild(you);
    }
    row.appendChild(nameCell);

    var roleCell = document.createElement('div');
    roleCell.appendChild(roleBadge(person.role));
    row.appendChild(roleCell);

    var lastCell = document.createElement('div');
    var formatted = formatLastSignIn(person.last_login_at);
    if (formatted) {
      lastCell.className = 'vhs-people-lastlogin';
      lastCell.textContent = formatted;
    } else {
      lastCell.className = 'vhs-muted-text';
      lastCell.textContent = 'Has not signed in yet';
    }
    row.appendChild(lastCell);

    // The signed-in operator's own row has no Remove button (README "09").
    var actionCell = document.createElement('div');
    if (!isYou) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vhs-people-remove';
      btn.textContent = 'Remove';
      btn.addEventListener('click', function () { confirmRemove(person); });
      actionCell.appendChild(btn);
    }
    row.appendChild(actionCell);

    return row;
  }

  function renderUsers(list) {
    rowsEl.innerHTML = '';
    var i;
    for (i = 0; i < list.length; i++) {
      rowsEl.appendChild(buildRow(list[i]));
    }
    VHS.show(contentEl, true);
  }

  function loadUsers() {
    if (!loadedOnce) VHS.showLoading(stateEl);
    fetch(API + '/v1/users', { headers: VHS.authHeaders() }).then(function (res) {
      if (res.status === 401) { VHS.showSessionExpired(); return; }
      return res.json().then(function (list) {
        loadedOnce = true;
        stateEl.innerHTML = '';
        renderUsers(list);
      });
    }).catch(function () {
      // A background refresh (e.g. after Remove) failing offline leaves the
      // table as-is; the first load failing shows the offline block instead.
      if (!loadedOnce) VHS.showOffline(stateEl, loadUsers);
    });
  }

  window.addEventListener('offline', function () { if (!loadedOnce) VHS.showOffline(stateEl, loadUsers); });
  window.addEventListener('online', function () { if (!loadedOnce) loadUsers(); });

  function init() {
    VHS.initHeader({
      userNameId: 'peopleUserName',
      signOutBtnId: 'signOutBtn',
      onUser: function (user) {
        // README "09": editors never reach this screen; the route redirects
        // Home. Hiding the tile is not enough — this is the real guard.
        if (user.role !== 'owner') {
          location.href = 'index.html';
          return;
        }
        currentUserId = user.id;
        loadUsers();
      }
    });
    VHS.initStatusStrip({
      stripId: 'statusStrip',
      iconPendingId: 'statusStripIconPending',
      iconCleanId: 'statusStripIconClean',
      textId: 'statusStripText',
      btnId: 'statusStripBtn'
    });
  }

  if (!VHS.hasSession()) {
    VHS.goToSignIn();
  } else {
    init();
  }
})();
