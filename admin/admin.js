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

  // Wires the shared purple header's "Signed in as" name and "Sign out"
  // button, per README "02 — Home" / "03 — Pick a page". `opts.onUser`, if
  // given, receives the full user record (e.g. to show owner-only tiles).
  function initHeader(opts) {
    var userNameEl = opts.userNameId ? $(opts.userNameId) : null;
    var signOutBtn = opts.signOutBtnId ? $(opts.signOutBtnId) : null;

    fetch(API + '/v1/auth/me', { headers: authHeaders() }).then(function (res) {
      if (res.status === 401) { goToSignIn(); return; }
      return res.json().then(function (user) {
        if (userNameEl) userNameEl.textContent = user.displayName;
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

  // Wires the shared status strip, driven by GET /v1/publish/pending, per
  // README "The status strip". Screen 06 (the publish confirmation modal)
  // does not exist yet, so the button stays a commented seam — never
  // publish directly from here.
  function initStatusStrip(ids) {
    var stripEl = $(ids.stripId);
    var iconPending = $(ids.iconPendingId);
    var iconClean = $(ids.iconCleanId);
    var textEl = $(ids.textId);
    var btn = $(ids.btnId);

    function render(count) {
      var pending = count > 0;
      show(iconPending, pending);
      show(iconClean, !pending);
      stripEl.classList[pending ? 'add' : 'remove']('is-pending');
      textEl.textContent = pending ? pageSentence(count) : 'Everything is on the website.';
      btn.disabled = !pending;
    }

    // Screen 06 (the publish confirmation modal) does not exist yet. Wire
    // the button to this seam only — replace with the real modal call once
    // 06 lands.
    btn.addEventListener('click', function () {
      if (btn.disabled) return;
      // TODO: open the screen 06 publish confirmation modal once it exists.
    });

    fetch(API + '/v1/publish/pending', { headers: authHeaders() }).then(function (res) {
      if (res.status === 401) { goToSignIn(); return; }
      return res.json().then(function (body) { render(body.count); });
    }).catch(function () { /* offline: leave the last-known strip state on screen */ });
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
    initStatusStrip: initStatusStrip
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
