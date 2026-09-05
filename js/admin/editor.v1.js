(function () {
  'use strict';

  // API base resolution order (highest priority first):
  //   0. An already-set window.VHS_API_BASE (the admin console may have set one).
  //   1. `?api=<url>` on this page's URL - persisted to localStorage (key vhs_api_base)
  //      so it survives navigating to a page with no query string. `?api=` (empty) or
  //      `?api=reset` clears a stored override.
  //   2. A previously persisted localStorage override.
  //   3. Hostname default: localhost/127.0.0.1 -> local `wrangler dev`, else production.
  // Exists so a local browser can be pointed at a deployed Worker (e.g. when
  // `wrangler dev --remote` is unavailable) instead of only localhost/production.
  function vhsResolveApiBase() {
    var KEY = 'vhs_api_base';
    // Away from localhost the api is same-origin: the host rewrites /v1/* to
    // the Worker (see vercel.json). Kept in step with the same resolver inlined
    // in each admin/*.html page.
    var deflt = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
      ? 'http://localhost:8787'
      : '';
    var m = /[?&]api=([^&]*)/.exec(location.search);
    var q = m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
    if (q !== null) {
      if (q === '' || q === 'reset') {
        try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
        return deflt;
      }
      if (/^https?:\/\//.test(q)) {
        try { localStorage.setItem(KEY, q); } catch (e) { /* ignore */ }
        return q;
      }
      // malformed value: ignore and fall through to a stored/default base
    }
    var stored = null;
    try { stored = localStorage.getItem(KEY); } catch (e) { stored = null; }
    return (stored && /^https?:\/\//.test(stored)) ? stored : deflt;
  }
  // Checked for being a string, not for truthiness: '' is a valid base meaning
  // "same origin", and `||` would throw it away and re-resolve.
  var API = typeof window.VHS_API_BASE === 'string' ? window.VHS_API_BASE : vhsResolveApiBase();
  var TOKEN_KEY = 'vhs_admin_token';
  var MAX_EDGE = 1920;
  var THUMB_EDGE = 400;
  var QUALITY = 0.82;
  // README §05 gives no duration for the Saved flag; brief and non-animated
  // is the only stated constraint, so this is a plain timeout, not a CSS
  // transition.
  var SAVED_DISPLAY_MS = 2500;

  var token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) return;

  /** Repo-relative path of the current page, matching slots.page_path. */
  function pagePath() {
    var p = location.pathname.replace(/^\/+/, '');
    if (p === '' || p.endsWith('/')) p += 'index.html';
    return decodeURIComponent(p);
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    headers.Authorization = 'Bearer ' + token;
    if (opts.json) headers['Content-Type'] = 'application/json';
    return fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.json ? JSON.stringify(opts.json) : opts.body
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) { var e = new Error(body.error || ('failed: ' + res.status)); e.status = res.status; e.body = body; throw e; }
        return body;
      });
    });
  }

  // ---- image resizing, in the browser so the Worker never sees a large body ----

  function drawTo(bitmap, w, h) {
    if (typeof OffscreenCanvas === 'function') {
      var oc = new OffscreenCanvas(w, h);
      oc.getContext('2d').drawImage(bitmap, 0, 0, w, h);
      return oc.convertToBlob({ type: 'image/webp', quality: QUALITY });
    }
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    return new Promise(function (resolve, reject) {
      c.toBlob(function (b) { b ? resolve(b) : reject(new Error('encode failed')); }, 'image/webp', QUALITY);
    });
  }

  function resize(file, maxEdge) {
    return createImageBitmap(file).then(function (bmp) {
      var scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
      var w = Math.max(1, Math.round(bmp.width * scale));
      var h = Math.max(1, Math.round(bmp.height * scale));
      return drawTo(bmp, w, h).then(function (blob) { return { blob: blob, width: w, height: h }; });
    });
  }

  function upload(file) {
    return Promise.all([resize(file, MAX_EDGE), resize(file, THUMB_EDGE)]).then(function (pair) {
      var main = pair[0], thumb = pair[1];
      if (main.blob.size > 3 * 1024 * 1024) {
        throw new Error('This photo is too large. Please choose a photo smaller than 3 MB.');
      }
      var base = (file.name || 'image').replace(/\.[^.]+$/, '') + '.webp';
      var form = new FormData();
      form.set('file', main.blob, base);
      form.set('thumb', thumb.blob, 'thumb-' + base);
      form.set('width', String(main.width));
      form.set('height', String(main.height));
      return api('/v1/uploads', { method: 'POST', body: form });
    });
  }

  function pick() {
    return new Promise(function (resolve) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg,image/png,image/webp';
      input.addEventListener('change', function () { resolve(input.files && input.files[0]); });
      input.click();
    });
  }

  // ---- inline SVG icons, copied verbatim from
  // design_handoff_admin_console/admin-console-design.dc.html (artboard 04
  // for the toolbar, artboard 02's status strip for the strip icons) ----

  var ICON_UPLOAD =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 16V4"></path><path d="M8 8l4-4 4 4"></path><path d="M4 16v3h16v-3"></path></svg>';
  var ICON_RESTORE =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#614BC3" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 10a8 8 0 1114 5"></path><path d="M4 5v5h5"></path></svg>';
  var ICON_STRIP_PENDING =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#614BC3" stroke-width="1.8" stroke-linecap="round">' +
    '<circle cx="12" cy="12" r="9"></circle><path d="M12 8v.5M12 11.5V16"></path></svg>';
  var ICON_STRIP_CLEAN =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3c763d" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M5 13l4 4 10-10"></path></svg>';
  var ICON_SAVED_TICK =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M5 13l4 4 10-10"></path></svg>';

  function elFromHTML(html) {
    var div = document.createElement('div');
    div.innerHTML = html;
    return div.firstChild;
  }

  // ---- overlay styling — inlined here per README "Constraints that must
  // not be violated": no stylesheet is ever added to a public page. Every
  // rule is namespaced .vhs-*. The dashed outline is applied straight to the
  // host <img> via `outline` (never `border`/`margin`), which is painted
  // outside the border box and so cannot affect layout. The toolbar/flag/
  // caption are never inserted as DOM descendants of the host image — they
  // live in a single fixed overlay layer, positioned from the image's own
  // measured rect, so the host page's containing-block structure (and thus
  // any percentage-sized image) never changes. ----

  var style = document.createElement('style');
  style.textContent =
    '.vhs-context-bar{position:fixed;top:0;left:0;right:0;z-index:9999;background:#614BC3;height:52px;box-sizing:border-box;padding:0 20px;display:flex;align-items:center;justify-content:space-between;}' +
    '.vhs-body-offset{margin-top:52px;}' +
    '.vhs-context-bar-left{font:600 17px Raleway,Arial,sans-serif;color:#fff;}' +
    '.vhs-context-bar-right{display:flex;align-items:center;gap:12px;}' +
    '.vhs-context-btn{background:#fff;color:#614BC3;border:1px solid #fff;border-radius:4px;height:40px;padding:0 16px;display:inline-flex;align-items:center;font:600 16px Raleway,Arial,sans-serif;text-decoration:none;cursor:pointer;box-sizing:border-box;}' +
    '.vhs-context-signout{background:transparent;color:#fff;border:1px solid #fff;border-radius:4px;height:40px;padding:0 16px;display:inline-flex;align-items:center;font:600 16px Raleway,Arial,sans-serif;cursor:pointer;box-sizing:border-box;}' +
    '.vhs-context-btn:focus,.vhs-context-signout:focus,.vhs-toolbar-item:focus,.vhs-status-strip-btn:focus,.vhs-limit-confirm:focus,.vhs-error-btn-primary:focus,.vhs-error-btn-secondary:focus{outline:2px solid #614BC3;outline-offset:2px;}' +
    '.vhs-photo-outline{outline:3px dashed #614BC3;outline-offset:3px;}' +
    '.vhs-photo-outline-error{outline:3px dashed #A94442;outline-offset:3px;}' +
    '.vhs-overlay-layer{position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:9999;}' +
    '.vhs-caption{position:absolute;pointer-events:none;font:600 15px Raleway,Arial,sans-serif;color:#614BC3;background:rgba(255,255,255,.94);border-radius:4px;padding:5px 10px;}' +
    '.vhs-flag{position:absolute;pointer-events:none;background:#3C763D;color:#fff;border-radius:4px;padding:5px 10px;font:600 14px Raleway,Arial,sans-serif;}' +
    '.vhs-saved-flag{position:absolute;pointer-events:none;background:#3C763D;color:#fff;border-radius:4px;padding:6px 10px;display:flex;align-items:center;gap:8px;font:600 15px Raleway,Arial,sans-serif;}' +
    '.vhs-toolbar{position:absolute;pointer-events:auto;background:#fff;border:1px solid #614BC3;border-radius:4px;height:44px;box-shadow:0 1px 0 rgba(0,0,0,.08);display:none;align-items:stretch;}' +
    '.vhs-toolbar-item{display:flex;align-items:center;gap:8px;padding:0 14px;font:600 15px Raleway,Arial,sans-serif;color:#222;background:#fff;border:0;cursor:pointer;box-sizing:border-box;height:100%;}' +
    '.vhs-toolbar-item:not(:first-child){border-left:1px solid #ddd;}' +
    '.vhs-toolbar-item-primary{background:#614BC3;color:#fff;}' +
    '.vhs-toolbar-item-primary:hover{background:#4A37A0;}' +
    '.vhs-bottom-panel{position:absolute;box-sizing:border-box;pointer-events:auto;}' +
    '.vhs-limit-panel{background:#F5F5F5;border:1px solid #DDD;border-radius:4px;padding:12px 14px;font:400 15px/22px Raleway,Arial,sans-serif;color:#333;}' +
    '.vhs-limit-confirm{display:block;margin-top:10px;background:#614BC3;color:#fff;border:0;border-radius:4px;padding:8px 14px;font:600 15px Raleway,Arial,sans-serif;cursor:pointer;}' +
    '.vhs-sending-panel{background:rgba(255,255,255,.94);border-top:1px solid #DDD;padding:12px 14px;box-sizing:border-box;}' +
    '.vhs-sending-text{font:600 16px Raleway,Arial,sans-serif;color:#222;margin-bottom:8px;}' +
    '.vhs-sending-track{height:12px;background:#DDD;border-radius:2px;overflow:hidden;}' +
    '.vhs-sending-fill{height:100%;background:#614BC3;}' +
    '.vhs-saved-alert{background:#DFF0D8;border:1px solid #D6E9C6;border-radius:4px;padding:12px 14px;font:600 16px/24px Raleway,Arial,sans-serif;color:#3C763D;}' +
    '.vhs-error-alert{background:#F2DEDE;border:1px solid #EBCCD1;border-radius:4px;padding:14px;box-sizing:border-box;}' +
    '.vhs-error-cause{font:600 16px/24px Raleway,Arial,sans-serif;color:#A94442;margin-bottom:6px;}' +
    '.vhs-error-reassurance{font:400 15px/22px Raleway,Arial,sans-serif;color:#333;}' +
    '.vhs-error-actions{display:flex;gap:10px;margin-top:16px;}' +
    '.vhs-error-btn-primary{background:#614BC3;color:#fff;border:1px solid #614BC3;border-radius:4px;height:44px;padding:0 18px;display:flex;align-items:center;font:600 17px Raleway,Arial,sans-serif;cursor:pointer;}' +
    '.vhs-error-btn-secondary{background:#fff;color:#222;border:1px solid #ddd;border-radius:4px;height:44px;padding:0 18px;display:flex;align-items:center;font:600 17px Raleway,Arial,sans-serif;cursor:pointer;}' +
    '.vhs-hidden{display:none!important;}' +
    '.vhs-status-strip{position:fixed;left:0;right:0;bottom:0;border-top:2px solid #614BC3;background:#fff;height:78px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;box-sizing:border-box;z-index:9999;}' +
    '.vhs-status-strip.is-pending{background:#C8FFE0;}' +
    '.vhs-status-strip-message{display:flex;align-items:center;gap:14px;}' +
    '.vhs-status-strip-lines{display:flex;flex-direction:column;gap:2px;}' +
    '.vhs-status-strip-text{font:600 19px Raleway,Arial,sans-serif;color:#222;}' +
    '.vhs-status-strip-pages{font:400 15px/22px Raleway,Arial,sans-serif;color:#333;}' +
    '.vhs-status-strip-btn{height:52px;padding:0 26px;border-radius:4px;font:600 18px Raleway,Arial,sans-serif;display:flex;align-items:center;background:#3C763D;color:#fff;border:1px solid #3C763D;cursor:pointer;box-sizing:border-box;}' +
    '.vhs-status-strip-btn:disabled,.vhs-status-strip-btn.is-disabled{background:#F5F5F5;color:#777;border-color:#ddd;cursor:not-allowed;}' +
    // ---- Screen 06 — Confirm dialogs. Namespaced .vhs-* and inlined here
    // like every other overlay rule, per README "Constraints" #4/#5: the
    // in-page editor must not depend on Bootstrap's CSS/JS being present on
    // a public page, so no `modal`/`fade`/`modal-backdrop` class names are
    // used here (unlike admin.js) even though the values below are the
    // same ones admin.css ships for the console. ----
    '.vhs-modal-backdrop{position:fixed;top:0;right:0;bottom:0;left:0;background:rgba(0,0,0,0.5);z-index:10000;}' +
    '.vhs-modal-dialog{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:480px;box-sizing:border-box;background:#fff;border:1px solid #ddd;border-radius:4px;z-index:10001;}' +
    '.vhs-modal-header{padding:18px 20px;border-bottom:1px solid #ddd;}' +
    '.vhs-modal-title{margin:0;font:700 22px "PT Serif",serif;color:#222;}' +
    '.vhs-modal-body{padding:20px;}' +
    '.vhs-modal-body-photo{display:flex;gap:16px;}' +
    '.vhs-modal-photo{display:block;width:130px;height:92px;object-fit:cover;border:1px solid #ddd;flex:none;}' +
    '.vhs-modal-text{font:400 16px/25px Raleway,Arial,sans-serif;color:#222;}' +
    '.vhs-modal-text+.vhs-modal-page-list,.vhs-modal-page-list+.vhs-modal-text{margin-top:16px;}' +
    '.vhs-modal-page-list{border:1px solid #ddd;border-radius:4px;}' +
    '.vhs-modal-page-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border-bottom:1px solid #ddd;}' +
    '.vhs-modal-page-row:last-child{border-bottom:none;}' +
    '.vhs-modal-page-thumb{display:block;width:64px;height:46px;object-fit:cover;border:1px solid #ddd;flex:none;}' +
    '.vhs-modal-page-name{font:600 16px Raleway,Arial,sans-serif;color:#222;}' +
    '.vhs-modal-page-count{font:400 15px Raleway,Arial,sans-serif;color:#777;margin-left:auto;}' +
    '.vhs-modal-footer{padding:16px 20px;border-top:1px solid #ddd;display:flex;justify-content:flex-end;gap:12px;}' +
    '.vhs-modal-btn{box-sizing:border-box;height:46px;padding:0 20px;border-radius:4px;font:600 18px Raleway,Arial,sans-serif;display:flex;align-items:center;cursor:pointer;border:0;}' +
    '.vhs-modal-btn-secondary{background:#fff;color:#222;border:1px solid #ddd;}' +
    '.vhs-modal-btn-primary{background:#614BC3;color:#fff;border:1px solid #614BC3;}' +
    '.vhs-modal-btn-confirm-publish{background:#3C763D;color:#fff;border:1px solid #3C763D;}' +
    // ---- Screen 12 — States sheet, the subset this file needs (offline,
    // signed-out, conflict). Same class names and values as admin.css's own
    // copy — duplicated for the same reason as the modal chrome above: this
    // page loads no admin.css. Loading/skeleton and the empty state are not
    // needed here (the editor shows neither). ----
    '.vhs-state-overlay-backdrop{position:fixed;top:0;right:0;bottom:0;left:0;background:rgba(0,0,0,0.5);z-index:10000;}' +
    '.vhs-state-overlay-panel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:480px;box-sizing:border-box;z-index:10001;}' +
    '.vhs-state-alert-error{background:#F2DEDE;border:1px solid #EBCCD1;border-radius:4px;padding:16px;}' +
    '.vhs-state-alert-title{font:600 18px/26px Raleway,Arial,sans-serif;color:#A94442;margin-bottom:6px;}' +
    '.vhs-state-alert-title:last-child{margin-bottom:0;}' +
    '.vhs-state-alert-body{font:400 16px/24px Raleway,Arial,sans-serif;color:#333;}' +
    '.vhs-state-alert-mint{background:#C8FFE0;border:1px solid #9FE6C0;border-radius:4px;padding:16px;}' +
    '.vhs-state-alert-mint-text{font:400 16px/24px Raleway,Arial,sans-serif;color:#222;}' +
    '.vhs-state-actions{display:flex;gap:12px;margin-top:18px;}' +
    '.vhs-state-btn-primary{background:#614BC3;color:#fff;border:1px solid #614BC3;border-radius:4px;height:46px;padding:0 20px;display:inline-flex;align-items:center;font:600 18px Raleway,Arial,sans-serif;cursor:pointer;}' +
    // ---- One breakpoint (README "Responsive" / "11" — Mobile, 390x844).
    // Same values as admin.css's own mobile block; duplicated here because
    // this page loads no admin.css, only this inlined bundle. ----
    '@media (max-width:767px){' +
    '.vhs-context-bar{height:auto;padding:10px 14px;}' +
    '.vhs-context-bar-left{font:600 15px/22px Raleway,Arial,sans-serif;}' +
    // README "11" frame 3's context line carries no buttons at this width.
    '.vhs-context-bar-right{display:none;}' +
    '.vhs-body-offset{margin-top:42px;}' +
    '.vhs-toolbar{flex-direction:column;align-items:stretch;height:auto;padding:10px;gap:8px;box-shadow:none;box-sizing:border-box;}' +
    '.vhs-toolbar-item{width:100%;height:46px;justify-content:center;font:600 17px Raleway,Arial,sans-serif;border-left:0!important;}' +
    '.vhs-toolbar-item svg{display:none;}' +
    // Product-approved fix: on a small photo (e.g. `width="35%"` at 390px)
    // the caption pill is wider than the photo itself and covers the
    // subject. The dashed outline still marks the photo and tapping it
    // reveals the toolbar with explicit labels, so hiding the caption below
    // this same breakpoint loses no functionality.
    '.vhs-caption{display:none;}' +
    '.vhs-status-strip{height:auto;flex-direction:column;align-items:stretch;gap:12px;padding:14px 16px;}' +
    '.vhs-status-strip-text{font:600 17px/24px Raleway,Arial,sans-serif;}' +
    '.vhs-status-strip-btn{width:100%;height:50px;justify-content:center;}' +
    '}';
  document.head.appendChild(style);

  // ---- admin context bar (README "04" layer 1) ----

  function buildContextBar(label) {
    var bar = document.createElement('div');
    bar.className = 'vhs-context-bar';

    var left = document.createElement('div');
    left.className = 'vhs-context-bar-left';
    left.appendChild(document.createTextNode('You are changing photos on: '));
    var b = document.createElement('b');
    b.textContent = label;
    left.appendChild(b);
    bar.appendChild(left);

    var right = document.createElement('div');
    right.className = 'vhs-context-bar-right';

    var choose = document.createElement('a');
    choose.className = 'vhs-context-btn';
    choose.href = '/admin/pages.html';
    choose.textContent = 'Choose another page';
    right.appendChild(choose);

    var signOut = document.createElement('button');
    signOut.type = 'button';
    signOut.className = 'vhs-context-signout';
    signOut.textContent = 'Sign out';
    signOut.addEventListener('click', function () {
      api('/v1/auth/logout', { method: 'POST' }).catch(function () { /* sign out locally regardless */ })
        .then(function () { sessionStorage.removeItem(TOKEN_KEY); location.reload(); });
    });
    right.appendChild(signOut);

    bar.appendChild(right);
    document.body.insertBefore(bar, document.body.firstChild);
    // The bar is now `position: fixed` (so it stays put while the operator
    // scrolls) and no longer occupies flow space of its own. Compensate on
    // the body itself so the page's content sits exactly where it did when
    // the bar was still in-flow.
    document.body.classList.add('vhs-body-offset');
  }

  // ---- status strip (README "The status strip", editor variant with the
  // second line of changed page names) ----

  function pageSentence(count) {
    return count === 1
      ? '1 page changed. It is not on the website yet.'
      : count + ' pages changed. They are not on the website yet.';
  }

  // ---- Screen 06 — Confirm dialogs. Same values and verbatim copy as
  // admin.js's version (see that file's matching comment) — duplicated
  // rather than shared because this page loads no admin.js module, only
  // this one inlined bundle. ----

  function openModal(opts) {
    var backdrop = document.createElement('div');
    backdrop.className = 'vhs-modal-backdrop';

    var dialog = document.createElement('div');
    dialog.className = 'vhs-modal-dialog';
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
      if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      // Focus back on the opener before onClose runs: the opener is a
      // toolbar item whose own visibility is hover/focus-driven (README
      // "04"), so onClose (which lets the caller drop its "force visible
      // while a modal is open" guard) must not run until the opener has
      // already received focus and so re-triggered that guard itself via
      // its own focusin listener.
      if (openedFrom && openedFrom.focus) openedFrom.focus();
      if (opts.onClose) opts.onClose();
    }

    document.addEventListener('keydown', onKeydown, true);
    document.body.appendChild(backdrop);
    document.body.appendChild(dialog);
    if (buttonEls[0]) buttonEls[0].focus();
  }

  // "1 photo" / "N photos" — same singular/plural pattern as pageSentence.
  function photoCountLabel(n) {
    return n === 1 ? '1 photo' : n + ' photos';
  }

  // Never derive a page name/thumbnail client-side: join GET
  // /v1/publish/pending's page paths against GET /v1/pages's records, which
  // alone carry label/thumbs/unpublishedCount.
  function joinPendingPages(pendingPages, allPages) {
    var byPath = {};
    var i;
    for (i = 0; i < allPages.length; i++) byPath[allPages[i].pagePath] = allPages[i];
    var joined = [];
    for (i = 0; i < pendingPages.length; i++) {
      var full = byPath[pendingPages[i].pagePath];
      if (full) joined.push(full);
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
      var count = document.createElement('div');
      count.className = 'vhs-modal-page-count';
      count.textContent = photoCountLabel(p.unpublishedCount);
      row.appendChild(count);
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
      buildBody: function (bodyEl) { buildPublishModalBody(bodyEl, joinedPages); },
      buttons: [
        { label: 'Not now', className: 'vhs-modal-btn-secondary' },
        { label: 'Yes, put them on the website', className: 'vhs-modal-btn-confirm-publish', onClick: onConfirm }
      ]
    });
  }

  function openRestoreModal(photoSrc, onConfirm, onClose) {
    openModal({
      title: 'Restore the original photo?',
      buildBody: function (bodyEl) {
        bodyEl.className += ' vhs-modal-body-photo';
        var img = document.createElement('img');
        img.className = 'vhs-modal-photo';
        img.src = photoSrc;
        img.alt = '';
        bodyEl.appendChild(img);
        var text = document.createElement('div');
        text.className = 'vhs-modal-text';
        text.textContent = 'The photo you put here will be taken away. The photo that was on the website before will come back.';
        bodyEl.appendChild(text);
      },
      buttons: [
        { label: 'No, keep my photo', className: 'vhs-modal-btn-secondary' },
        { label: 'Yes, restore the original photo', className: 'vhs-modal-btn-primary', onClick: onConfirm }
      ],
      onClose: onClose
    });
  }

  // README "Copy rules": no verbatim string exists for an in-flight publish
  // label (and "Publish"/"Publishing" are explicitly banned words), so the
  // waiting state is the look-disabled treatment only — no text change.
  var NOTHING_TO_PUBLISH_MS = 2500;

  function buildStatusStrip() {
    var strip = document.createElement('div');
    strip.className = 'vhs-status-strip';

    var message = document.createElement('div');
    message.className = 'vhs-status-strip-message';

    var iconPending = elFromHTML(ICON_STRIP_PENDING);
    var iconClean = elFromHTML(ICON_STRIP_CLEAN);
    message.appendChild(iconPending);
    message.appendChild(iconClean);

    var lines = document.createElement('div');
    lines.className = 'vhs-status-strip-lines';
    var text = document.createElement('div');
    text.className = 'vhs-status-strip-text';
    var pagesLine = document.createElement('div');
    pagesLine.className = 'vhs-status-strip-pages';
    lines.appendChild(text);
    lines.appendChild(pagesLine);
    message.appendChild(lines);

    strip.appendChild(message);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vhs-status-strip-btn';
    btn.textContent = 'Put my changes on the website';
    strip.appendChild(btn);

    document.body.appendChild(strip);

    var state = {
      root: strip, iconPending: iconPending, iconClean: iconClean,
      text: text, pagesLine: pagesLine, btn: btn,
      pendingCount: 0, pendingLabels: []
    };

    // Gates on the screen 06 publish confirmation modal, per README
    // "Interactions & behavior" ("Publish: modal lists affected pages ->
    // confirm -> the strip button becomes a named waiting state -> success
    // screen 07 -> strip flips to clean"). A successful publish sends the
    // operator to the console's screen 07 (/admin/published.html), which
    // asserts the clean state itself. A root-absolute path is used, like
    // buildContextBar's "Choose another page" link above, because this
    // page can be nested at any depth under the site root.
    btn.addEventListener('click', function () {
      if (state.pendingCount <= 0) { showNothingToPublish(state); return; }
      Promise.all([api('/v1/pages'), api('/v1/publish/pending')]).then(function (results) {
        openPublishModal(joinPendingPages(results[1].pages, results[0]), function () { startPublishing(state); });
      }).catch(function (err) {
        if (err && err.status === 401) sessionStorage.removeItem(TOKEN_KEY);
        /* offline/failed: leave the strip as-is; publish stays reachable next click */
      });
    });

    return state;
  }

  function showNothingToPublish(strip) {
    var restore = strip.text.textContent;
    strip.text.textContent = 'There is nothing new to put on the website.';
    setTimeout(function () { if (strip.pendingCount <= 0) strip.text.textContent = restore; }, NOTHING_TO_PUBLISH_MS);
  }

  function startPublishing(strip) {
    strip.btn.classList.add('is-disabled');
    api('/v1/publish', { method: 'POST' }).then(function () {
      location.href = '/admin/published.html';
    }).catch(function (err) {
      if (err && err.status === 401) { sessionStorage.removeItem(TOKEN_KEY); return; }
      // Offline/failed publish: the pages are still pending server-side, so
      // restore the pending look rather than stranding the strip on the
      // look-disabled waiting state.
      renderStatusStrip(strip, strip.pendingCount, strip.pendingLabels);
    });
  }

  function renderStatusStrip(strip, count, pendingLabels) {
    var pending = count > 0;
    strip.pendingCount = count;
    strip.pendingLabels = pendingLabels || [];
    strip.root.classList[pending ? 'add' : 'remove']('is-pending');
    strip.iconPending.classList[pending ? 'remove' : 'add']('vhs-hidden');
    strip.iconClean.classList[pending ? 'add' : 'remove']('vhs-hidden');
    strip.text.textContent = pending ? pageSentence(count) : 'Everything is on the website.';
    strip.pagesLine.textContent = pending ? pendingLabels.join(', ') : '';
    // Never a native `disabled` control (README "The status strip" requires
    // pressing it with nothing pending to still surface "nothing to
    // publish", which a truly disabled button could never receive a click
    // for) — .is-disabled reproduces the disabled look only.
    strip.btn.classList[pending ? 'remove' : 'add']('is-disabled');
  }

  // ---- per-photo affordances (README "04", layer 3) ----
  //
  // The host <img> is never re-parented or wrapped: some school photos carry
  // percentage `height`/`width` attributes that resolve against the host
  // page's own containing block, and inserting a new box around the image
  // would change that containing block and silently resize the photo. So
  // every affordance (toolbar, flag, caption) lives in one overlay layer
  // fixed to the viewport, positioned purely from `img.getBoundingClientRect()`.

  var vhsOverlayLayer = null;
  function getOverlayLayer() {
    if (!vhsOverlayLayer) {
      vhsOverlayLayer = document.createElement('div');
      vhsOverlayLayer.className = 'vhs-overlay-layer';
      document.body.appendChild(vhsOverlayLayer);
    }
    return vhsOverlayLayer;
  }

  var vhsGroups = [];

  // README "Responsive": below 768px "the toolbar stacks under the photo".
  // The overlay layer stays a single fixed layer either way (per the "must
  // never occupy layout space" note in this screen's contract) — only the
  // toolbar's own position/size changes with viewport width.
  var MOBILE_BREAKPOINT = 768;
  function isMobileViewport() { return window.innerWidth < MOBILE_BREAKPOINT; }

  function positionGroup(g) {
    var rect = g.img.getBoundingClientRect();
    g.toolbar.style.left = rect.left + 'px';
    if (isMobileViewport()) {
      // README "11" requires full sentence labels with no truncation, but
      // some public-page photos render narrower than their own label text
      // (e.g. a `width="35%"` attribute on a small viewport) — matching the
      // toolbar's width to the photo's own rect would wrap/clip the labels.
      // The photo's immediate parent is the actual content column at that
      // point in the page, so the stacked block spans that width instead,
      // still starting at the photo's own left edge, directly beneath it.
      var colRect = g.img.parentElement.getBoundingClientRect();
      var left = Math.min(rect.left, colRect.left);
      var right = Math.max(rect.right, colRect.right);
      g.toolbar.style.left = left + 'px';
      g.toolbar.style.width = (right - left) + 'px';
      // 14px below the photo, matching the canvas's measured gap (README
      // "11" frame 3).
      g.toolbar.style.top = (rect.bottom + 14) + 'px';
    } else {
      g.toolbar.style.width = '';
      g.toolbar.style.top = (rect.top - 50) + 'px';
    }
    g.flag.style.left = (rect.right - 8) + 'px';
    g.flag.style.top = (rect.top + 8) + 'px';
    g.flag.style.transform = 'translateX(-100%)';
    g.caption.style.left = (rect.left + 8) + 'px';
    g.caption.style.top = (rect.bottom - 8) + 'px';
    g.caption.style.transform = 'translateY(-100%)';
    g.savedFlag.style.left = (rect.right - 8) + 'px';
    g.savedFlag.style.top = (rect.top + 8) + 'px';
    g.savedFlag.style.transform = 'translateX(-100%)';
    // Anchored by `bottom` (not `top`+measured height) so the panel's
    // varying content (limit line / sending bar / alert+buttons) always
    // stays flush with the photo's own bottom edge, growing upward.
    g.panel.style.left = rect.left + 'px';
    g.panel.style.width = rect.width + 'px';
    g.panel.style.bottom = (window.innerHeight - rect.bottom) + 'px';
  }

  function repositionAllGroups() {
    for (var i = 0; i < vhsGroups.length; i++) positionGroup(vhsGroups[i]);
  }

  var vhsRepositionScheduled = false;
  function scheduleReposition() {
    if (vhsRepositionScheduled) return;
    vhsRepositionScheduled = true;
    requestAnimationFrame(function () {
      vhsRepositionScheduled = false;
      repositionAllGroups();
    });
  }
  // capture:true so scrolling inside a nested scroll container also reflows.
  window.addEventListener('scroll', scheduleReposition, true);
  window.addEventListener('resize', scheduleReposition);

  // ---- replace-flow failure copy (README "05d") — verbatim from MICROCOPY.md,
  // selected by cause, never by surfacing a status code to the operator ----

  var CAUSES = {
    tooLarge: 'This photo is too large. Please choose a photo smaller than 3 MB.',
    wrongType: 'This file is not a photo. Please choose a JPG, PNG or WEBP photo.',
    conflict: 'Somebody else changed this photo a moment ago. We have loaded their version. Please try again.',
    offline: 'You are not connected to the internet. Your changes are safe. Please connect and try again.'
  };
  var ERROR_REASSURANCE = 'The old photo is still there. Nothing has changed.';

  // The Worker reports size/type failures as HTTP 413/415 (see
  // worker/src/routes/uploads.ts); the client's own pre-flight size check
  // throws with the exact CAUSES.tooLarge string instead of a status.
  function classifyError(err) {
    if (!navigator.onLine) return 'offline';
    var status = err && err.status;
    if (status === 409) return 'conflict';
    if (status === 413) return 'tooLarge';
    if (status === 415) return 'wrongType';
    if (err && err.message === CAUSES.tooLarge) return 'tooLarge';
    return 'wrongType';
  }

  /**
   * `changed` here means "this photo differs from the original AND the page
   * is currently in the unpublished batch" — the same approximation the
   * Worker's own /v1/pages endpoint uses (a slot's r2_key never clears on
   * publish, so r2Key alone can't tell "changed" from "changed, published
   * long ago").
   */
  function decorate(img, slot, changed, onChange) {
    img.classList.add('vhs-photo-outline');

    var layer = getOverlayLayer();

    var toolbar = document.createElement('span');
    toolbar.className = 'vhs-toolbar';
    layer.appendChild(toolbar);

    var changeBtn = document.createElement('button');
    changeBtn.type = 'button';
    changeBtn.className = 'vhs-toolbar-item vhs-toolbar-item-primary';
    changeBtn.appendChild(elFromHTML(ICON_UPLOAD));
    changeBtn.appendChild(document.createTextNode('Change this photo'));
    toolbar.appendChild(changeBtn);

    var restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'vhs-toolbar-item';
    restoreBtn.appendChild(elFromHTML(ICON_RESTORE));
    restoreBtn.appendChild(document.createTextNode('Restore the original photo'));
    toolbar.appendChild(restoreBtn);

    var flag = document.createElement('span');
    flag.className = 'vhs-flag';
    flag.textContent = 'Changed · not on the website yet';
    layer.appendChild(flag);

    var caption = document.createElement('span');
    caption.className = 'vhs-caption';
    layer.appendChild(caption);

    // README "05" states a/b/c/d — one bottom-pinned panel whose content is
    // swapped per state, plus the transient "Saved" corner flag for c.
    var panel = document.createElement('div');
    panel.className = 'vhs-bottom-panel vhs-hidden';
    layer.appendChild(panel);

    var savedFlag = elFromHTML('<span class="vhs-saved-flag vhs-hidden">' + ICON_SAVED_TICK + 'Saved</span>');
    layer.appendChild(savedFlag);

    var group = { img: img, toolbar: toolbar, flag: flag, caption: caption, panel: panel, savedFlag: savedFlag };
    vhsGroups.push(group);
    positionGroup(group);
    // The image's box is not final until it loads — including when a
    // replacement photo (a different intrinsic size) finishes loading.
    img.addEventListener('load', function () { positionGroup(group); });

    // The toolbar is no longer a DOM descendant of the photo, so CSS
    // :hover/:focus-within on a shared ancestor can't drive it — track
    // hover/focus across both elements explicitly instead.
    // `modalOpen` covers the restore-confirm modal (README "06"): opening it
    // covers the toolbar under the pointer, which the browser treats as a
    // real mouseleave, and shifts focus onto the modal's own first button —
    // without this flag the toolbar would go display:none mid-flow and the
    // modal's own close() could never focus back onto a hidden button.
    var overImg = false, overToolbar = false, toolbarFocused = false, modalOpen = false;
    function updateToolbarVisibility() {
      toolbar.style.display = (overImg || overToolbar || toolbarFocused || modalOpen) ? 'flex' : 'none';
    }
    img.addEventListener('mouseenter', function () { overImg = true; updateToolbarVisibility(); });
    img.addEventListener('mouseleave', function () { overImg = false; updateToolbarVisibility(); });
    // A touch screen has no hover — README "11" requires the stacked mobile
    // toolbar to appear on tap, so a tap/click on the photo latches it
    // visible the same way a mouseenter does on desktop.
    img.addEventListener('click', function () { overImg = true; updateToolbarVisibility(); });
    toolbar.addEventListener('mouseenter', function () { overToolbar = true; updateToolbarVisibility(); });
    toolbar.addEventListener('mouseleave', function () { overToolbar = false; updateToolbarVisibility(); });
    toolbar.addEventListener('focusin', function () { toolbarFocused = true; updateToolbarVisibility(); });
    toolbar.addEventListener('focusout', function () { toolbarFocused = false; updateToolbarVisibility(); });

    var etag = slot.updatedAt;
    var previewUrl = null;

    function setChanged(on) {
      changed = on;
      flag.classList[on ? 'remove' : 'add']('vhs-hidden');
      caption.textContent = on ? 'This photo can be changed.' : 'This photo can be changed. Not changed yet.';
    }
    flag.classList.add('vhs-hidden');
    setChanged(changed);

    function showPreview(blob) {
      try {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(blob);
        img.src = previewUrl;
      } catch (e) { /* a preview is a nicety; never block the edit */ }
    }

    // ---- README "05" states a/b/c/d, rendered into the shared bottom panel ----

    function resetOverlayState() {
      panel.className = 'vhs-bottom-panel vhs-hidden';
      panel.innerHTML = '';
      savedFlag.classList.add('vhs-hidden');
      img.classList.remove('vhs-photo-outline-error');
      img.classList.add('vhs-photo-outline');
    }

    function showLimitPanel() {
      resetOverlayState();
      panel.classList.remove('vhs-hidden');
      panel.innerHTML =
        '<div class="vhs-limit-panel">Choose a JPG, PNG or WEBP photo smaller than 3 MB.' +
        '<button type="button" class="vhs-limit-confirm">Change this photo</button></div>';
      var confirmBtn = panel.querySelector('.vhs-limit-confirm');
      confirmBtn.focus();
      // Esc dismisses in place of a modal (this is an overlay panel, not a
      // Bootstrap modal) and returns focus to where the operator started.
      function onKey(e) {
        if (e.keyCode === 27 || e.key === 'Escape') {
          document.removeEventListener('keydown', onKey, true);
          resetOverlayState();
          changeBtn.focus();
        }
      }
      document.addEventListener('keydown', onKey, true);
      confirmBtn.addEventListener('click', function () {
        document.removeEventListener('keydown', onKey, true);
        resetOverlayState();
        startReplace();
      });
    }

    function showSendingPanel() {
      resetOverlayState();
      panel.classList.remove('vhs-hidden');
      // No real upload-progress signal is wired up (fetch(), not XHR), so
      // this is a fixed, non-animating bar per README "no animation anywhere".
      panel.innerHTML =
        '<div class="vhs-sending-panel">' +
        '<div class="vhs-sending-text">Sending your photo… please do not close this page.</div>' +
        '<div class="vhs-sending-track"><div class="vhs-sending-fill" style="width:50%"></div></div>' +
        '</div>';
    }

    function showSavedState() {
      resetOverlayState();
      savedFlag.classList.remove('vhs-hidden');
      panel.classList.remove('vhs-hidden');
      panel.innerHTML = '<div class="vhs-saved-alert">Saved. This is not on the website yet.</div>';
    }

    function showErrorState(cause) {
      resetOverlayState();
      img.classList.remove('vhs-photo-outline');
      img.classList.add('vhs-photo-outline-error');
      panel.classList.remove('vhs-hidden');
      // README "12": a conflict is shown in the mint panel, not the red
      // alert — and by the time this renders the other person's photo has
      // already been loaded (see `applied(err.body.current)` in `failed()`
      // below), so the "old photo is still there" reassurance would be
      // false for this one cause and is dropped rather than shown anyway.
      var isConflict = cause === 'conflict';
      panel.innerHTML =
        (isConflict
          ? '<div class="vhs-state-alert-mint"><div class="vhs-state-alert-mint-text">' + CAUSES[cause] + '</div></div>'
          : '<div class="vhs-error-alert"><div class="vhs-error-cause">' + CAUSES[cause] + '</div><div class="vhs-error-reassurance">' + ERROR_REASSURANCE + '</div></div>') +
        '<div class="vhs-error-actions">' +
        '<button type="button" class="vhs-error-btn-primary">Choose another photo</button>' +
        '<button type="button" class="vhs-error-btn-secondary">Leave it as it is</button>' +
        '</div>';
      panel.querySelector('.vhs-error-btn-primary').addEventListener('click', showLimitPanel);
      panel.querySelector('.vhs-error-btn-secondary').addEventListener('click', function () {
        resetOverlayState();
        changeBtn.focus();
      });
    }

    function applied(updated) {
      etag = updated.updatedAt;
      slot.r2Key = updated.r2Key;
      setChanged(!!updated.r2Key);
      // Swap to the served URL only once it genuinely loads. R2 is not publicly
      // reachable in local development and the CDN can lag briefly in production;
      // until then the local preview is the honest thing to show.
      if (updated.src) {
        var probe = new Image();
        probe.onload = function () {
          img.src = updated.src;
          if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
        };
        probe.src = updated.src;
      }
      changeBtn.disabled = false;
      onChange();
    }

    function failed(previousSrc, err) {
      changeBtn.disabled = false;
      var cause = classifyError(err);
      // On a 409 the Worker's `current` payload is the authoritative photo
      // now on the slot, not the pre-attempt one — load that instead of
      // reverting to `previousSrc`.
      if (cause === 'conflict' && err.body && err.body.current) {
        applied(err.body.current);
      } else {
        if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
        img.src = previousSrc;
      }
      showErrorState(cause);
    }

    function startReplace() {
      pick().then(function (file) {
        if (!file) return;
        var previousSrc = img.src;
        changeBtn.disabled = true;
        showPreview(file);
        showSendingPanel();
        return upload(file).then(function (asset) {
          return api('/v1/slots/' + encodeURIComponent(slot.id), {
            method: 'PUT', json: { r2Key: asset.r2Key, alt: slot.alt || '' },
            headers: { 'If-Match': etag }
          });
        }).then(function (updated) {
          applied(updated);
          showSavedState();
          setTimeout(resetOverlayState, SAVED_DISPLAY_MS);
        }).catch(function (err) { failed(previousSrc, err); });
      });
    }

    changeBtn.addEventListener('click', function () {
      // README "05a": the 3 MB limit is stated before the file picker opens,
      // in an in-page panel (never a native alert()), with the operator
      // confirming from that panel.
      showLimitPanel();
    });

    restoreBtn.addEventListener('click', function () {
      modalOpen = true;
      updateToolbarVisibility();
      // README "06": shows the photograph the operator is about to lose —
      // the current one, i.e. img.src at the moment the modal opens.
      openRestoreModal(img.src, function () {
        api('/v1/slots/' + encodeURIComponent(slot.id) + '/revert', { method: 'POST' })
          .then(function (u) { slot.alt = u.alt; img.alt = u.alt; applied(u); })
          .catch(function (err) { failed(img.src, err); });
      }, function () { modalOpen = false; updateToolbarVisibility(); });
    });
  }

  // ---- Screen 12 — States sheet: signed-out and offline, as page-level
  // overlays (a non-dismissable panel over a dimmed backdrop) rather than
  // per-photo panels, since neither is tied to one editable photo. ----

  function showSessionExpiredOverlay() {
    sessionStorage.removeItem(TOKEN_KEY);
    if (document.getElementById('vhsSessionExpired')) return;
    var backdrop = document.createElement('div');
    backdrop.id = 'vhsSessionExpired';
    backdrop.className = 'vhs-state-overlay-backdrop';
    var panel = document.createElement('div');
    panel.className = 'vhs-state-overlay-panel';
    panel.innerHTML =
      '<div class="vhs-state-alert-error">' +
      '<div class="vhs-state-alert-title">You have been signed out for safety. Please sign in again.</div>' +
      '</div>' +
      '<div class="vhs-state-actions"><button type="button" class="vhs-state-btn-primary">Sign in again</button></div>';
    panel.querySelector('button').addEventListener('click', function () { location.href = '/admin/index.html'; });
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
  }

  // README "Offline": listen for the browser's `offline` event, show this
  // state, keep any local preview (this overlay never touches a photo's own
  // src/state), and retry on `online`.
  var vhsOfflineOverlay = null;
  function hideOfflineOverlay() {
    if (vhsOfflineOverlay && vhsOfflineOverlay.parentNode) vhsOfflineOverlay.parentNode.removeChild(vhsOfflineOverlay);
    vhsOfflineOverlay = null;
  }
  function showOfflineOverlay() {
    if (vhsOfflineOverlay) return;
    vhsOfflineOverlay = document.createElement('div');
    vhsOfflineOverlay.className = 'vhs-state-overlay-backdrop';
    var panel = document.createElement('div');
    panel.className = 'vhs-state-overlay-panel';
    panel.innerHTML =
      '<div class="vhs-state-alert-error">' +
      '<div class="vhs-state-alert-title">You are not connected to the internet.</div>' +
      '<div class="vhs-state-alert-body">Your changes are safe. Please connect and try again.</div>' +
      '</div>' +
      '<div class="vhs-state-actions"><button type="button" class="vhs-state-btn-primary">Try again</button></div>';
    panel.querySelector('button').addEventListener('click', function () {
      if (navigator.onLine) { hideOfflineOverlay(); vhsRefreshPending(); }
    });
    vhsOfflineOverlay.appendChild(panel);
    document.body.appendChild(vhsOfflineOverlay);
  }
  window.addEventListener('offline', showOfflineOverlay);
  window.addEventListener('online', function () { hideOfflineOverlay(); vhsRefreshPending(); });

  // ---- boot ----

  function labelMap(pages) {
    var map = {};
    for (var i = 0; i < pages.length; i++) map[pages[i].pagePath] = pages[i].label;
    return map;
  }

  var signedOut = false;
  function apiOrDefault(promise, fallback) {
    return promise.catch(function (err) {
      if (err && err.status === 401) signedOut = true;
      return fallback;
    });
  }

  // Reassigned once boot succeeds (see below) so the offline overlay's
  // `online` handler and "Try again" button have a real pending-count
  // refresh to call; a no-op until then.
  var vhsRefreshPending = function () {};

  Promise.all([
    apiOrDefault(api('/v1/pages'), []),
    api('/v1/slots?page=' + encodeURIComponent(pagePath())),
    apiOrDefault(api('/v1/publish/pending'), { count: 0, pages: [] })
  ]).then(function (results) {
    if (signedOut) { showSessionExpiredOverlay(); return; }

    var pages = results[0];
    var slots = results[1];
    var pending = results[2];
    var labels = labelMap(pages);
    var here = pagePath();
    // Friendly names come only from GET /v1/pages (MICROCOPY.md's map),
    // never derived client-side; the raw path is a last-resort fallback if
    // that fetch failed above.
    var pageIsPending = false;
    var pendingLabels = [];
    for (var i = 0; i < pending.pages.length; i++) {
      var p = pending.pages[i];
      if (p.pagePath === here) pageIsPending = true;
      pendingLabels.push(labels[p.pagePath] || p.pagePath);
    }

    buildContextBar(labels[here] || here);
    var strip = buildStatusStrip();
    renderStatusStrip(strip, pending.count, pendingLabels);

    function refreshPending() {
      api('/v1/publish/pending').then(function (r) {
        var names = [];
        for (var j = 0; j < r.pages.length; j++) names.push(labels[r.pages[j].pagePath] || r.pages[j].pagePath);
        renderStatusStrip(strip, r.count, names);
      }).catch(function () { /* leave the last-known strip state on screen */ });
    }
    vhsRefreshPending = refreshPending;

    slots.forEach(function (slot) {
      var img = document.querySelector('[data-vhs-slot="' + slot.id.replace(/"/g, '\\"') + '"]');
      if (img) decorate(img, slot, !!slot.r2Key && pageIsPending, refreshPending);
    });
  }).catch(function (err) {
    if (err && err.status === 401) showSessionExpiredOverlay();
  });
})();
