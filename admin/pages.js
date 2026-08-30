(function () {
  'use strict';

  // Screen 03 — Pick a page. Shared header, session, and status-strip
  // behavior live in admin.js on window.VHS; this file only fetches and
  // renders the page list, per design_handoff_admin_console/README.md
  // ("03 — Pick a page").
  var VHS = window.VHS;
  var API = VHS.API;

  // README "Friendly page names (phase 1)" fixes this row order — it is not
  // the order GET /v1/pages returns. Any page not in this list (a later
  // phase's page) is appended afterwards, in the order the API returned it,
  // so new pages show up without a code change here.
  var KNOWN_ORDER = [
    'index.html',
    'pages/about/OurManagement.html',
    'pages/about/OurFounder.html',
    'pages/about/PrincipalMessage.html',
    'pages/about/FIH.html'
  ];

  function orderPages(list) {
    var byPath = {};
    var used = {};
    var ordered = [];
    var i;
    for (i = 0; i < list.length; i++) {
      byPath[list[i].pagePath] = list[i];
    }
    for (i = 0; i < KNOWN_ORDER.length; i++) {
      var known = byPath[KNOWN_ORDER[i]];
      if (known) {
        ordered.push(known);
        used[KNOWN_ORDER[i]] = true;
      }
    }
    for (i = 0; i < list.length; i++) {
      if (!used[list[i].pagePath]) {
        ordered.push(list[i]);
      }
    }
    return ordered;
  }

  // "N photos can be changed", plus the verbatim unpublished-edits clause
  // when unpublishedCount > 0 — per README "03 — Pick a page" and MICROCOPY.md
  // "Page row count". unpublishedCount (not editedCount) drives this: editedCount
  // stays > 0 forever once a photo has ever changed, even after publishing, so it
  // can't tell us whether the page is still waiting to go on the website.
  function rowMeta(slotCount, unpublishedCount) {
    var text = slotCount === 1 ? '1 photo can be changed' : slotCount + ' photos can be changed';
    if (unpublishedCount > 0) {
      text += ' · ' + unpublishedCount + ' changed, not on the website yet';
    }
    return text;
  }

  // `pagePath` is a site-relative path from the repo root; every admin
  // screen lives one directory below that, so the real page is one level up.
  function pageHref(pagePath) {
    return '../' + pagePath;
  }

  function buildRow(page, isFirst) {
    var row = document.createElement('div');
    row.className = 'vhs-row vhs-page-row';

    var info = document.createElement('div');
    info.className = 'vhs-page-row-info';

    var title = document.createElement('div');
    title.className = 'vhs-h-row';
    title.textContent = page.label;
    info.appendChild(title);

    var meta = document.createElement('div');
    meta.className = 'vhs-muted-text vhs-page-row-meta';
    meta.textContent = rowMeta(page.slotCount, page.unpublishedCount);
    info.appendChild(meta);

    row.appendChild(info);

    var thumbs = document.createElement('div');
    thumbs.className = 'vhs-page-thumbs';
    var shown = page.thumbs.slice(0, 3);
    var i;
    for (i = 0; i < shown.length; i++) {
      var img = document.createElement('img');
      img.className = 'vhs-page-thumb';
      img.src = shown[i];
      img.alt = '';
      thumbs.appendChild(img);
    }
    var remaining = page.slotCount - shown.length;
    if (remaining > 0) {
      var more = document.createElement('div');
      more.className = 'vhs-page-thumb-more';
      more.textContent = '+' + remaining;
      thumbs.appendChild(more);
    }
    row.appendChild(thumbs);

    // One primary action per screen (README "Buttons") — only the first row
    // gets it; every other row is secondary.
    var link = document.createElement('a');
    link.className = 'vhs-btn vhs-page-row-btn ' + (isFirst ? 'vhs-btn-primary' : 'vhs-btn-secondary');
    link.href = pageHref(page.pagePath);
    link.textContent = 'Open this page';
    row.appendChild(link);

    return row;
  }

  function renderPages(list) {
    var panel = VHS.$('pagesPanel');
    var ordered = orderPages(list);
    var i;
    for (i = 0; i < ordered.length; i++) {
      panel.appendChild(buildRow(ordered[i], i === 0));
    }
  }

  function init() {
    VHS.initHeader({ userNameId: 'pagesUserName', signOutBtnId: 'signOutBtn' });
    VHS.initStatusStrip({
      stripId: 'statusStrip',
      iconPendingId: 'statusStripIconPending',
      iconCleanId: 'statusStripIconClean',
      textId: 'statusStripText',
      btnId: 'statusStripBtn'
    });

    fetch(API + '/v1/pages', { headers: VHS.authHeaders() }).then(function (res) {
      if (res.status === 401) { VHS.goToSignIn(); return; }
      return res.json().then(function (list) { renderPages(list); });
    }).catch(function () { /* offline: leave the panel empty; last-known list stays cached by the browser's back-forward cache, if any */ });
  }

  if (!VHS.hasSession()) {
    VHS.goToSignIn();
  } else {
    init();
  }
})();
