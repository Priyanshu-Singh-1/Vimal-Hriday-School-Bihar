(function () {
  'use strict';

  // Shared helpers for every admin screen — API base resolution, the
  // sessionStorage token, the purple header, and the status strip. Each
  // screen's own file (this one for 01/02, pages.js for 03, and so on)
  // calls into window.VHS instead of re-implementing these pieces.
  var API = window.VHS_API_BASE;
  var TOKEN_KEY = 'vhs_admin_token';

  var $ = function (id) { return document.getElementById(id); };
  var show = function (el, on) { el.classList[on ? 'remove' : 'add']('vhs-hidden'); };

  function hasSession() {
    return !!sessionStorage.getItem(TOKEN_KEY);
  }

  function clearSession() {
    sessionStorage.removeItem(TOKEN_KEY);
  }

  function authHeaders() {
    return { Authorization: 'Bearer ' + sessionStorage.getItem(TOKEN_KEY) };
  }

  // Every screen but sign-in itself sends the operator here on 401 or sign
  // out. `index.html` picks the sign-in view because clearSession() has
  // already run by the time it loads.
  function goToSignIn() {
    clearSession();
    location.href = 'index.html';
  }

  function pageSentence(count) {
    return count === 1
      ? '1 page changed. It is not on the website yet.'
      : count + ' pages changed. They are not on the website yet.';
  }

  // ---- Screen 12 — States sheet: loading / offline / signed-out. Shared
  // here so every console screen renders identical markup; a matching
  // (values-only) copy is inlined into js/admin/editor.v1.js's own <style>
  // for the same reason that file already duplicates the modal chrome — a
  // public page loads no admin.css/admin.js. The empty state has no shared
  // builder: it was already built per-screen (activity.html) before this
  // task and already matches README "12" exactly. ----

  // README "12": a static arc icon, copied verbatim from the reference —
  // never a spinner (README bans decorative animation everywhere).
  var STATE_LOADING_SVG =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#614BC3" stroke-width="2.2" stroke-linecap="round"><path d="M12 3a9 9 0 109 9"></path></svg>';

  function buildLoadingBlock() {
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="vhs-state-loading">' + STATE_LOADING_SVG +
      '<div class="vhs-state-loading-text">Opening the page… please wait.</div></div>' +
      '<div class="vhs-skeleton">' +
      '<div class="vhs-skeleton-line"></div>' +
      '<div class="vhs-skeleton-line vhs-skeleton-line-short"></div>' +
      '<div class="vhs-skeleton-block"></div>' +
      '</div>';
    return wrap;
  }

  // Shows the loading block in place of `container`'s own content — for a
  // list screen's first fetch (pick-a-page, people, activity — README "12").
  function showLoading(container) {
    container.innerHTML = '';
    container.appendChild(buildLoadingBlock());
  }

  function buildOfflineBlock(onRetry) {
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="vhs-state-alert-error">' +
      '<div class="vhs-state-alert-title">You are not connected to the internet.</div>' +
      '<div class="vhs-state-alert-body">Your changes are safe. Please connect and try again.</div>' +
      '</div>' +
      '<div class="vhs-state-actions"><button type="button" class="vhs-btn vhs-btn-primary vhs-state-action">Try again</button></div>';
    wrap.querySelector('button').addEventListener('click', onRetry);
    return wrap;
  }

  // README "Offline": shows this state in place of `container`'s content;
  // `onRetry` is also the caller's own retry-on-`online` handler.
  function showOffline(container, onRetry) {
    container.innerHTML = '';
    container.appendChild(buildOfflineBlock(onRetry));
  }

  // README "Session": "on a 401 show the signed-out state and route to sign
  // in" — a non-dismissable overlay (rather than a per-screen container)
  // since a 401 can happen with no natural content area to render into
  // (e.g. mid-publish from the status strip). Routing only happens once the
  // operator presses the button, not silently.
  function showSessionExpired() {
    if ($('vhsSessionExpired')) return;
    var backdrop = document.createElement('div');
    backdrop.id = 'vhsSessionExpired';
    backdrop.className = 'vhs-state-overlay-backdrop';
    var panel = document.createElement('div');
    panel.className = 'vhs-state-overlay-panel';
    panel.innerHTML =
      '<div class="vhs-state-alert-error">' +
      '<div class="vhs-state-alert-title">You have been signed out for safety. Please sign in again.</div>' +
      '</div>' +
      '<div class="vhs-state-actions"><button type="button" class="vhs-btn vhs-btn-primary vhs-state-action">Sign in again</button></div>';
    panel.querySelector('button').addEventListener('click', goToSignIn);
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
  }

  // Wires the shared purple header's "Signed in as" name and "Sign out"
  // button, per README "02 — Home" / "03 — Pick a page". `opts.onUser`, if
  // given, receives the full user record (e.g. to show owner-only tiles).
  function initHeader(opts) {
    var userNameEl = opts.userNameId ? $(opts.userNameId) : null;
    var signOutBtn = opts.signOutBtnId ? $(opts.signOutBtnId) : null;

    fetch(API + '/v1/auth/me', { headers: authHeaders() }).then(function (res) {
      if (res.status === 401) { showSessionExpired(); return; }
      return res.json().then(function (user) {
        // Same guard as activity.js: displayName resolves a nullable column on
        // the Worker side, so tolerate an older Worker that omits it.
        if (userNameEl) userNameEl.textContent = user.displayName || user.username || '';
        if (opts.onUser) opts.onUser(user);
      });
    }).catch(function () { /* offline: leave the last-known header state on screen */ });

    if (signOutBtn) {
      signOutBtn.addEventListener('click', function () {
        fetch(API + '/v1/auth/logout', { method: 'POST', headers: authHeaders() }).then(function () {
          goToSignIn();
        }).catch(function () { goToSignIn(); });
      });
    }
  }

  // ---- Screen 06 — Confirm dialogs (shared modal chrome, README "06") ----
  // Bootstrap 3's own modal.js is never invoked; the class names are added
  // only because README "Constraints" allows Bootstrap 3 names in the
  // admin console. Open/close/focus-trap is hand-rolled here because
  // index.html/pages.html ship no modal skeleton markup — building it in JS
  // is the only option given the "modify only admin.js/admin.css" scope.

  function openModal(opts) {
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop fade in vhs-modal-backdrop';

    var dialog = document.createElement('div');
    dialog.className = 'modal fade in vhs-modal-dialog';
    // Bootstrap 3's `.modal` rule is `display: none` by default; only its
    // own modal.js (never loaded here) would flip that to `block`. Set it
    // ourselves so the dialog's visibility never depends on Bootstrap's JS.
    dialog.style.display = 'block';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('tabindex', '-1');

    var header = document.createElement('div');
    header.className = 'vhs-modal-header';
    var title = document.createElement('h2');
    title.className = 'vhs-modal-title';
    title.textContent = opts.title;
    header.appendChild(title);
    dialog.appendChild(header);

    var body = document.createElement('div');
    body.className = 'vhs-modal-body';
    opts.buildBody(body);
    dialog.appendChild(body);

    var footer = document.createElement('div');
    footer.className = 'vhs-modal-footer';
    var buttonEls = [];
    opts.buttons.forEach(function (b) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vhs-modal-btn ' + b.className;
      btn.textContent = b.label;
      btn.addEventListener('click', function () {
        close();
        if (b.onClick) b.onClick();
      });
      footer.appendChild(btn);
      buttonEls.push(btn);
    });
    dialog.appendChild(footer);

    var openedFrom = document.activeElement;

    function onKeydown(e) {
      var key = e.key || (e.keyCode === 27 ? 'Escape' : (e.keyCode === 9 ? 'Tab' : ''));
      if (key === 'Escape') { close(); return; }
      if (key === 'Tab') {
        var first = buttonEls[0], last = buttonEls[buttonEls.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }

    function close() {
      document.removeEventListener('keydown', onKeydown, true);
      dialog.style.display = 'none';
      if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      if (openedFrom && openedFrom.focus) openedFrom.focus();
    }

    document.addEventListener('keydown', onKeydown, true);
    document.body.appendChild(backdrop);
    document.body.appendChild(dialog);
    if (buttonEls[0]) buttonEls[0].focus();

    // Footer buttons already close themselves. A dialog whose body carries the
    // real choices (the gallery's remove dialog) has to close itself from
    // buildBody, so hand back a handle. Existing callers ignore it.
    return { close: close };
  }

  // "1 photo" / "N photos" — same singular/plural pattern as pageSentence,
  // per MICROCOPY.md "Page row count" and the 06 publish-modal canvas.
  function photoCountLabel(n) {
    return n === 1 ? '1 photo' : n + ' photos';
  }

  // Never derive a page name/thumbnail client-side (README "Publish"): join
  // GET /v1/publish/pending's page paths against GET /v1/pages's records,
  // which alone carry label/thumbs/unpublishedCount. A pending path missing
  // from /v1/pages is dropped rather than guessed at.
  function joinPendingPages(pendingPages, allPages) {
    var byPath = {};
    var i;
    for (i = 0; i < allPages.length; i++) byPath[allPages[i].pagePath] = allPages[i];
    var joined = [];
    for (i = 0; i < pendingPages.length; i++) {
      var full = byPath[pendingPages[i].pagePath];
      // A page with photo slots arrives with a thumbnail and a count. A gallery
      // page has neither and is not in /v1/pages at all, so fall back to the
      // name the server sent. Dropping it instead left the confirm dialog
      // listing nothing for a gallery-only change.
      joined.push(full || {
        pagePath: pendingPages[i].pagePath,
        label: pendingPages[i].label || pendingPages[i].pagePath,
        thumbs: [],
        unpublishedCount: 0
      });
    }
    return joined;
  }

  function buildPublishModalBody(body, joinedPages) {
    var lead = document.createElement('div');
    lead.className = 'vhs-modal-text';
    lead.textContent = 'These pages will change for everyone who visits the website:';
    body.appendChild(lead);

    var list = document.createElement('div');
    list.className = 'vhs-modal-page-list';
    joinedPages.forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'vhs-modal-page-row';
      if (p.thumbs && p.thumbs[0]) {
        var img = document.createElement('img');
        img.className = 'vhs-modal-page-thumb';
        img.src = p.thumbs[0];
        img.alt = '';
        row.appendChild(img);
      }
      var name = document.createElement('div');
      name.className = 'vhs-modal-page-name';
      name.textContent = p.label;
      row.appendChild(name);
      // A pending page can be pending only for a revert, which clears
      // r2_key and so leaves unpublishedCount at 0 — that is not "0
      // photos", it's just no count to show. MICROCOPY.md has no string
      // for that case, so the count text is omitted rather than invented.
      if (p.unpublishedCount > 0) {
        var count = document.createElement('div');
        count.className = 'vhs-modal-page-count';
        count.textContent = photoCountLabel(p.unpublishedCount);
        row.appendChild(count);
      }
      list.appendChild(row);
    });
    body.appendChild(list);

    var closing = document.createElement('div');
    closing.className = 'vhs-modal-text';
    closing.textContent = 'Do you want to continue?';
    body.appendChild(closing);
  }

  function openPublishModal(joinedPages, onConfirm) {
    openModal({
      title: 'Put changes on the website?',
      buildBody: function (body) { buildPublishModalBody(body, joinedPages); },
      buttons: [
        { label: 'Not now', className: 'vhs-modal-btn-secondary' },
        { label: 'Yes, put them on the website', className: 'vhs-modal-btn-confirm-publish', onClick: onConfirm }
      ]
    });
  }

  // README "Copy rules": no verbatim string exists for an in-flight publish
  // label (and "Publish"/"Publishing" are explicitly banned words), so the
  // waiting state is the look-disabled treatment only — no text change.
  var NOTHING_TO_PUBLISH_MS = 2500;

  // Wires the shared status strip, driven by GET /v1/publish/pending, per
  // README "The status strip", and the publish confirmation modal (06) that
  // gates it, per README "Interactions & behavior" ("Publish: modal lists
  // affected pages -> confirm -> the strip button becomes a named waiting
  // state -> success screen 07 -> strip flips to clean"). A successful
  // publish navigates to screen 07 (published.html), which asserts the
  // clean state itself via `ids.forceClean` below rather than trusting
  // GET /v1/publish/pending, which the publish cron may not have caught up
  // with yet right after the operator lands there.
  function initStatusStrip(ids) {
    var stripEl = $(ids.stripId);
    var iconPending = $(ids.iconPendingId);
    var iconClean = $(ids.iconCleanId);
    var textEl = $(ids.textId);
    var btn = $(ids.btnId);
    var pendingCount = 0;

    // The static markup ships `disabled` as a safe pre-JS fallback; from
    // here on the look-disabled `.is-disabled` class (see render()) is the
    // only gate, so a press with nothing pending still reaches the click
    // handler below and can surface "nothing to publish".
    btn.disabled = false;

    /**
     * The strip is fixed to the bottom, so the page must reserve exactly its
     * height or the last row sits underneath it and cannot be clicked.
     *
     * Measured rather than hardcoded: the strip is 78px on a wide screen but
     * stacks to about 140px below 768px, so a fixed 78px leaves the newest row
     * unreachable on a phone. Re-measured on resize and orientation change.
     */
    function reserveRoomForStrip() {
      var pageEl = stripEl.parentNode;
      if (!pageEl || !pageEl.style) return;
      var h = stripEl.getBoundingClientRect().height;
      if (h > 0) pageEl.style.paddingBottom = Math.ceil(h) + 'px';
    }

    reserveRoomForStrip();
    window.addEventListener('resize', reserveRoomForStrip);
    window.addEventListener('orientationchange', reserveRoomForStrip);

    function render(count) {
      pendingCount = count;
      var pending = count > 0;
      show(iconPending, pending);
      show(iconClean, !pending);
      stripEl.classList[pending ? 'add' : 'remove']('is-pending');
      textEl.textContent = pending ? pageSentence(count) : 'Everything is on the website.';
      // Never a native `disabled` button (see the .is-disabled rule in
      // admin.css) — README requires pressing it with nothing pending to
      // still surface the "nothing to publish" line, which a truly
      // disabled control could never receive a click for.
      btn.classList[pending ? 'remove' : 'add']('is-disabled');
      // The sentence length decides how tall the strip wraps to on a narrow
      // screen, so the room it needs is only known once the text is in.
      reserveRoomForStrip();
    }

    function showNothingToPublish() {
      var restore = textEl.textContent;
      textEl.textContent = 'There is nothing new to put on the website.';
      setTimeout(function () { if (pendingCount <= 0) textEl.textContent = restore; }, NOTHING_TO_PUBLISH_MS);
    }

    function startPublishing() {
      btn.classList.add('is-disabled');
      fetch(API + '/v1/publish', { method: 'POST', headers: authHeaders() }).then(function (res) {
        if (res.status === 401) { showSessionExpired(); return; }
        return res.json().then(function () { location.href = 'published.html'; });
      }).catch(function () {
        // Offline/failed publish: the pages are still pending server-side,
        // so restore the pending look rather than stranding the strip on
        // the look-disabled waiting state.
        render(pendingCount);
      });
    }

    btn.addEventListener('click', function () {
      if (pendingCount <= 0) { showNothingToPublish(); return; }
      fetch(API + '/v1/pages', { headers: authHeaders() }).then(function (res) {
        if (res.status === 401) { showSessionExpired(); return; }
        return res.json();
      }).then(function (allPages) {
        if (!allPages) return;
        return fetch(API + '/v1/publish/pending', { headers: authHeaders() }).then(function (res2) {
          if (res2.status === 401) { showSessionExpired(); return; }
          return res2.json().then(function (pendingBody) {
            openPublishModal(joinPendingPages(pendingBody.pages, allPages), startPublishing);
          });
        });
      }).catch(function () { /* offline: leave the strip as-is; publish stays reachable next click */ });
    });

    // README "07": that screen always asserts the clean state immediately
    // instead of asking the server, per the seam comment above.
    if (ids.forceClean) {
      render(0);
    } else {
      fetch(API + '/v1/publish/pending', { headers: authHeaders() }).then(function (res) {
        if (res.status === 401) { showSessionExpired(); return; }
        return res.json().then(function (body) { render(body.count); });
      }).catch(function () { /* offline: leave the last-known strip state on screen */ });
    }
  }

  window.VHS = {
    API: API,
    TOKEN_KEY: TOKEN_KEY,
    $: $,
    show: show,
    hasSession: hasSession,
    clearSession: clearSession,
    authHeaders: authHeaders,
    goToSignIn: goToSignIn,
    pageSentence: pageSentence,
    initHeader: initHeader,
    initStatusStrip: initStatusStrip,
    // Exposed for screen 09 (people.js), which needs the same confirm-dialog
    // chrome as the publish modal above but with its own title/body/buttons.
    openModal: openModal,
    // Screen 12 — States sheet, for pages.js/people.js/activity.js's own
    // first-fetch loading/offline handling; showSessionExpired is also used
    // internally by initHeader/initStatusStrip above.
    showLoading: showLoading,
    showOffline: showOffline,
    showSessionExpired: showSessionExpired
  };

  // ---- Screens 01 (sign in) and 02 (home) — both views live in index.html ----
  // Guarded on the sign-in view existing so this block is a no-op on every
  // other screen's file that merely loads admin.js for window.VHS.

  function initHome() {
    var tilePeople = $('tilePeople');
    var tileActivity = $('tileActivity');

    initHeader({
      userNameId: 'homeUserName',
      signOutBtnId: 'signOutBtn',
      onUser: function (user) {
        show(tilePeople, user.role === 'owner');
        show(tileActivity, user.role === 'owner');
      }
    });

    initStatusStrip({
      stripId: 'statusStrip',
      iconPendingId: 'statusStripIconPending',
      iconCleanId: 'statusStripIconClean',
      textId: 'statusStripText',
      btnId: 'statusStripBtn'
    });
  }

  function initSignIn() {
    var card = $('signinCard');
    var alertEl = $('signinAlert');
    var fields = $('signinFields');
    var forgot = $('signinForgot');
    var usernameInput = $('signinUsername');
    var passwordInput = $('signinPassword');
    var submitBtn = $('signinSubmit');
    var lockoutTimer = null;

    function resetAlert() {
      show(alertEl, false);
      card.classList.remove('has-alert');
      usernameInput.classList.remove('is-error');
      passwordInput.classList.remove('is-error');
    }

    function showAlert(message) {
      alertEl.textContent = message;
      show(alertEl, true);
      card.classList.add('has-alert');
    }

    function setInputsDisabled(disabled) {
      usernameInput.disabled = disabled;
      passwordInput.disabled = disabled;
      submitBtn.disabled = disabled;
    }

    function showWrongCredentials() {
      resetAlert();
      showAlert('Wrong username or password. Please try again.');
      usernameInput.classList.add('is-error');
      passwordInput.classList.add('is-error');
      passwordInput.value = '';
    }

    function showLockedOut(retryAfterSeconds) {
      resetAlert();
      showAlert('Too many tries. Please wait 15 minutes and try again.');
      fields.classList.add('is-disabled');
      setInputsDisabled(true);
      show(forgot, true);

      // The Worker enforces the actual lock-out window; retryAfterSeconds is
      // its real remaining time, not an assumed 15 minutes, so the form
      // re-enables exactly when the Worker would accept another attempt.
      clearTimeout(lockoutTimer);
      lockoutTimer = setTimeout(function () {
        resetAlert();
        fields.classList.remove('is-disabled');
        setInputsDisabled(false);
        show(forgot, false);
      }, retryAfterSeconds * 1000);
    }

    function readRetryAfterSeconds(res, body) {
      if (body && typeof body.retryAfterSeconds === 'number') return body.retryAfterSeconds;
      var header = res.headers.get('Retry-After');
      var seconds = header ? parseInt(header, 10) : NaN;
      return isNaN(seconds) ? 15 * 60 : seconds;
    }

    $('signinForm').addEventListener('submit', function (e) {
      e.preventDefault();
      resetAlert();
      setInputsDisabled(true);

      fetch(API + '/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameInput.value, password: passwordInput.value })
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (res.ok) {
            sessionStorage.setItem(TOKEN_KEY, body.token);
            location.href = './';
            return;
          }
          if (res.status === 401) {
            showWrongCredentials();
            setInputsDisabled(false);
          } else if (res.status === 429) {
            // showLockedOut manages its own re-enable timer; do not undo it here.
            showLockedOut(readRetryAfterSeconds(res, body));
          } else {
            // Any other status is a server-side fault, not an operator mistake.
            // There is no verbatim copy for it (MICROCOPY.md covers only wrong
            // credentials and rate-limiting on this screen), so it is left as
            // a silent re-enable rather than inventing a message.
            setInputsDisabled(false);
          }
        });
      }).catch(function () {
        // A rejected fetch (no response at all) is the offline case.
        showAlert('You are not connected to the internet. Your changes are safe. Please connect and try again.');
        setInputsDisabled(false);
      });
    });
  }

  if ($('signinPage')) {
    if (hasSession()) {
      $('signinPage').classList.add('vhs-hidden');
      show($('homeView'), true);
      initHome();
    } else {
      initSignIn();
    }
  }
})();
