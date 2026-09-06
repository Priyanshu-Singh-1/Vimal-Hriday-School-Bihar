(function () {
  'use strict';

  // Screen 08 — Change my password. Shared header, session, and status-strip
  // behavior live in admin.js on window.VHS; this file only wires the form,
  // per design_handoff_admin_console/README.md ("08 — Change my password").
  var VHS = window.VHS;
  var API = VHS.API;

  var fields = VHS.$('passwordFields');
  var alertEl = VHS.$('passwordAlert');
  var currentInput = VHS.$('passwordCurrent');
  var newInput = VHS.$('passwordNew');
  var confirmInput = VHS.$('passwordConfirm');
  var submitBtn = VHS.$('passwordSubmit');

  function resetAlert() {
    VHS.show(alertEl, false);
    alertEl.classList.remove('vhs-alert-error', 'vhs-alert-success');
  }

  function showError(message) {
    resetAlert();
    alertEl.classList.add('vhs-alert-error');
    alertEl.textContent = message;
    VHS.show(alertEl, true);
  }

  function showSuccess(message) {
    resetAlert();
    alertEl.classList.add('vhs-alert-success');
    alertEl.textContent = message;
    VHS.show(alertEl, true);
  }

  function setFieldsDisabled(disabled) {
    currentInput.disabled = disabled;
    newInput.disabled = disabled;
    confirmInput.disabled = disabled;
    submitBtn.disabled = disabled;
  }

  VHS.$('passwordForm').addEventListener('submit', function (e) {
    e.preventDefault();
    resetAlert();

    // Client-side only, per README "Interactions & behavior" — never send a
    // request when the two new passwords differ.
    if (newInput.value !== confirmInput.value) {
      showError('The two new passwords are not the same. Please type them again.');
      return;
    }

    setFieldsDisabled(true);

    var headers = VHS.authHeaders();
    headers['Content-Type'] = 'application/json';

    fetch(API + '/v1/auth/password', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ currentPassword: currentInput.value, newPassword: newInput.value })
    }).then(function (res) {
      if (res.status === 401) { VHS.goToSignIn(); return; }
      return res.json().catch(function () { return {}; }).then(function () {
        if (res.ok) {
          // Changing the password bumps token_version server-side, which
          // invalidates the token this page is still holding. Clear it now
          // so the operator is cleanly signed out rather than hitting a 401
          // on the next click (e.g. "Go back").
          VHS.clearSession();
          showSuccess('Your new password is saved. Use it the next time you sign in.');
          return;
        }
        if (res.status === 403) {
          showError('That is not your password now. Please try again.');
        } else if (res.status === 400) {
          showError('Use at least 10 letters or numbers.');
        }
        // Any other status has no verbatim copy in MICROCOPY.md, so it is
        // left as a silent re-enable rather than inventing a message.
        setFieldsDisabled(false);
      });
    }).catch(function () {
      showError('You are not connected to the internet. Your changes are safe. Please connect and try again.');
      setFieldsDisabled(false);
    });
  });

  function init() {
    VHS.initHeader({ userNameId: 'passwordUserName', signOutBtnId: 'signOutBtn' });
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
