(function () {
  'use strict';

  // Screen 07 — Put on the website · success. Shared header, session, and
  // status-strip behavior live in admin.js on window.VHS; this file only
  // wires them for this screen, per design_handoff_admin_console/README.md
  // ("07 — Put on the website · success").
  var VHS = window.VHS;

  function init() {
    VHS.initHeader({ userNameId: 'publishedUserName', signOutBtnId: 'signOutBtn' });
    VHS.initStatusStrip({
      stripId: 'statusStrip',
      iconPendingId: 'statusStripIconPending',
      iconCleanId: 'statusStripIconClean',
      textId: 'statusStripText',
      btnId: 'statusStripBtn',
      // README "07": "Status strip switches to its clean state on this
      // screen" — asserted immediately rather than trusting GET
      // /v1/publish/pending, which the publish cron may not have caught up
      // with yet right after the operator just published.
      forceClean: true
    });
  }

  if (!VHS.hasSession()) {
    VHS.goToSignIn();
  } else {
    init();
  }
})();
