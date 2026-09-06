(function () {
  'use strict';

  // Screen 10 — What changed recently (owner only). Shared header, session,
  // and status-strip behavior live in admin.js on window.VHS; this file only
  // fetches/renders the activity feed, per
  // design_handoff_admin_console/README.md ("10 — What changed recently").
  //
  // MICROCOPY.md has no entry for: the sentence for slot.clear ("removed a
  // photo from <page>"), asset.upload ("uploaded a new photo" — this event
  // has no page yet, only auth.* events ("signed in" / "signed out" /
  // "changed their password"), the "removed" half of the added/removed
  // person pattern (README shows only "added"), user.role_change ("changed
  // what <person> can do"), user.password_reset ("reset the password for
  // <person>"), the catch-all fallback sentence, and the "Load more" button
  // label. Each is written in the sheet's stated voice (short, literal,
  // verb-first, no system words) and flagged in the task report rather than
  // silently invented.
  var VHS = window.VHS;
  var API = VHS.API;

  var contentEl = VHS.$('activityContent');
  var rowsEl = VHS.$('activityRows');
  var emptyEl = VHS.$('activityEmpty');
  var moreWrap = VHS.$('activityMoreWrap');
  var moreBtn = VHS.$('activityMoreBtn');
  var iconPublishTpl = VHS.$('activityIconPublish');
  var iconPeopleTpl = VHS.$('activityIconPeople');

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  // page_path -> that page's thumbs[], from a single GET /v1/pages (README
  // "Thumbnails": "Fetch GET /v1/pages once ... Do not issue a request per row").
  var thumbsByPath = {};
  var nextBefore = null;
  var loadingMore = false;

  // People-management actions get the grey person tile (README "10": "a
  // grey person icon for a people change"); auth.* self-service events
  // (sign in/out, own password change) have no page or person to show and
  // are not a "people change" in that sense, so they fall through to the
  // neutral tile below rather than borrowing this icon.
  var PEOPLE_ACTIONS = { 'user.create': 1, 'user.delete': 1, 'user.role_change': 1, 'user.password_reset': 1 };

  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  // "today, 3:15 pm" / "yesterday, 4:02 pm" / "12 August, 10:20 am" — README
  // "10": lowercase "today" / "yesterday" / "12 August", time lowercase
  // 12-hour with am/pm.
  function formatWhen(iso) {
    var d = new Date(iso);
    var now = new Date();
    var diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
    var dayLabel = diffDays === 0 ? 'today' : diffDays === 1 ? 'yesterday' : (d.getDate() + ' ' + MONTHS[d.getMonth()]);

    var hours = d.getHours();
    var minutes = d.getMinutes();
    var ampm = hours >= 12 ? 'pm' : 'am';
    var h12 = hours % 12;
    if (h12 === 0) h12 = 12;
    var mm = minutes < 10 ? '0' + minutes : String(minutes);

    return dayLabel + ', ' + h12 + ':' + mm + ' ' + ampm;
  }

  // A sentence is a list of {text, bold} segments — the page or person name
  // is the only bold segment, per README "10" ("with the page or person
  // name in bold"). The trailing " — <when>" is appended separately by
  // buildRow, never bold.
  function sentenceWithPage(actor, verbPhrase, pageLabel, fallbackText) {
    if (pageLabel) {
      return [{ text: actor + ' ' + verbPhrase + ' ' }, { text: pageLabel, bold: true }];
    }
    // Defensive: a slot event should always resolve a pagePath, but render
    // legibly rather than showing an empty bold segment if it somehow does not.
    return [{ text: actor + ' ' + fallbackText }];
  }

  function sentenceWithPerson(actor, verbPhrase, personName, trailingText) {
    var segments = [{ text: actor + ' ' + verbPhrase + ' ' }, { text: personName || 'a person', bold: true }];
    if (trailingText) segments.push({ text: ' ' + trailingText });
    return segments;
  }

  // Maps the Worker's action strings to a plain-English sentence. README
  // "10" gives verbatim patterns for slot.update, slot.revert, publish, and
  // "a person added"; every other action here is composed in the same voice
  // (see the file header comment) rather than left to show a raw action code.
  function buildSentence(entry) {
    // actorDisplay comes from the Worker's display_name/username fallback, but the
    // console and the Worker deploy independently: an older Worker sends only
    // `actor`, and a deleted user's audit rows can carry neither. Never let a
    // missing field reach the page as the word "undefined".
    var actor = entry.actorDisplay || entry.actor || 'Someone';
    switch (entry.action) {
      case 'slot.update':
        return sentenceWithPage(actor, 'changed a photo on the', entry.pageLabel, 'changed a photo');
      case 'slot.revert':
        return sentenceWithPage(actor, 'restored the original photo on', entry.pageLabel, 'restored the original photo');
      case 'slot.clear':
        return sentenceWithPage(actor, 'removed a photo from', entry.pageLabel, 'removed a photo');
      case 'asset.upload':
        return [{ text: actor + ' uploaded a new photo' }];
      case 'publish':
        return [{ text: actor + ' put changes on the website' }];
      case 'auth.login':
        return [{ text: actor + ' signed in' }];
      case 'auth.logout':
        return [{ text: actor + ' signed out' }];
      case 'auth.password_change':
        return [{ text: actor + ' changed their password' }];
      case 'user.create':
        return sentenceWithPerson(actor, 'added', entry.target);
      case 'user.delete':
        return sentenceWithPerson(actor, 'removed', entry.target);
      case 'user.role_change':
        return sentenceWithPerson(actor, 'changed what', entry.target, 'can do');
      case 'user.password_reset':
        return sentenceWithPerson(actor, 'reset the password for', entry.target);
      default:
        // An action with no pattern here still needs to render legibly
        // rather than vanish or show its raw code (README "Copy rules").
        return [{ text: actor + ' made a change to the website' }];
    }
  }

  function buildTile(className, iconTemplate) {
    var tile = document.createElement('div');
    tile.className = 'vhs-activity-tile ' + className;
    if (iconTemplate) tile.appendChild(iconTemplate.content.firstElementChild.cloneNode(true));
    return tile;
  }

  // A thumbnail for a photo event, the publish tick, the people-change
  // icon, or (when a photo event's page has no sourceable image) the
  // neutral tile — never a broken image (README "Thumbnails").
  function buildVisual(entry) {
    if (entry.action === 'publish') {
      return buildTile('vhs-activity-tile-publish', iconPublishTpl);
    }
    if (PEOPLE_ACTIONS[entry.action]) {
      return buildTile('vhs-activity-tile-people', iconPeopleTpl);
    }
    if (entry.pagePath) {
      var thumbs = thumbsByPath[entry.pagePath];
      if (thumbs && thumbs.length > 0) {
        var img = document.createElement('img');
        img.className = 'vhs-activity-thumb';
        img.src = thumbs[0];
        img.alt = '';
        return img;
      }
    }
    return buildTile('vhs-activity-tile-neutral', null);
  }

  function buildRow(entry) {
    var row = document.createElement('div');
    row.className = 'vhs-row vhs-activity-row';
    row.appendChild(buildVisual(entry));

    var text = document.createElement('div');
    text.className = 'vhs-activity-text';
    var segments = buildSentence(entry);
    var i;
    for (i = 0; i < segments.length; i++) {
      var seg = segments[i];
      if (seg.bold) {
        var b = document.createElement('b');
        b.textContent = seg.text;
        text.appendChild(b);
      } else {
        text.appendChild(document.createTextNode(seg.text));
      }
    }
    text.appendChild(document.createTextNode(' — ' + formatWhen(entry.at)));
    row.appendChild(text);
    return row;
  }

  function appendEntries(entries) {
    var i;
    for (i = 0; i < entries.length; i++) rowsEl.appendChild(buildRow(entries[i]));
  }

  function rememberThumbs(pages) {
    var i;
    for (i = 0; i < pages.length; i++) thumbsByPath[pages[i].pagePath] = pages[i].thumbs;
  }

  function updateMoreVisibility() {
    VHS.show(moreWrap, nextBefore !== null);
  }

  function loadAudit(before) {
    var url = API + '/v1/audit?limit=50' + (before ? '&before=' + before : '');
    return fetch(url, { headers: VHS.authHeaders() }).then(function (res) {
      if (res.status === 401) { VHS.showSessionExpired(); return null; }
      return res.json();
    });
  }

  function loadPages() {
    return fetch(API + '/v1/pages', { headers: VHS.authHeaders() }).then(function (res) {
      if (res.status === 401) { VHS.showSessionExpired(); return null; }
      return res.json();
    });
  }

  // README "12": a loading block while this first fetch pair is in flight,
  // an offline block in its place if it fails before ever loading (inserted
  // here rather than in activity.html, per this task's file scope).
  var stateEl = document.createElement('div');
  document.querySelector('.vhs-activity-body').insertBefore(stateEl, contentEl);
  var loadedOnce = false;

  function loadInitial() {
    if (!loadedOnce) VHS.showLoading(stateEl);
    Promise.all([loadPages(), loadAudit(null)]).then(function (results) {
      var pages = results[0];
      var body = results[1];
      if (pages) rememberThumbs(pages);
      if (!body) return;
      loadedOnce = true;
      stateEl.innerHTML = '';
      nextBefore = body.nextBefore;
      var hasAny = body.entries.length > 0;
      VHS.show(contentEl, hasAny);
      VHS.show(emptyEl, !hasAny);
      if (hasAny) appendEntries(body.entries);
      updateMoreVisibility();
    }).catch(function () {
      if (!loadedOnce) VHS.showOffline(stateEl, loadInitial);
    });
  }

  window.addEventListener('offline', function () { if (!loadedOnce) VHS.showOffline(stateEl, loadInitial); });
  window.addEventListener('online', function () { if (!loadedOnce) loadInitial(); });

  moreBtn.addEventListener('click', function () {
    if (nextBefore === null || loadingMore) return;
    loadingMore = true;
    moreBtn.disabled = true;
    loadAudit(nextBefore).then(function (body) {
      loadingMore = false;
      moreBtn.disabled = false;
      if (!body) return;
      nextBefore = body.nextBefore;
      appendEntries(body.entries);
      updateMoreVisibility();
    }).catch(function () {
      loadingMore = false;
      moreBtn.disabled = false;
    });
  });

  function init() {
    VHS.initHeader({
      userNameId: 'activityUserName',
      signOutBtnId: 'signOutBtn',
      onUser: function (user) {
        // README "10": owner only. Hiding the home tile is not enough —
        // this is the real guard, same as screen 09 (people.js).
        if (user.role !== 'owner') {
          location.href = 'index.html';
          return;
        }
        loadInitial();
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
