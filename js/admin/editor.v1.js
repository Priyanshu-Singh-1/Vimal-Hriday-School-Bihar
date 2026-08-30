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
    var deflt = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
      ? 'http://localhost:8787'
      : 'https://api.vhspurnea.com';
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
  var API = window.VHS_API_BASE || vhsResolveApiBase();
  var TOKEN_KEY = 'vhs_admin_token';
  var MAX_EDGE = 1920;
  var THUMB_EDGE = 400;
  var QUALITY = 0.82;

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
    '.vhs-context-btn:focus,.vhs-context-signout:focus,.vhs-toolbar-item:focus,.vhs-status-strip-btn:focus{outline:2px solid #614BC3;outline-offset:2px;}' +
    '.vhs-photo-outline{outline:3px dashed #614BC3;outline-offset:3px;}' +
    '.vhs-overlay-layer{position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:9999;}' +
    '.vhs-caption{position:absolute;pointer-events:none;font:600 15px Raleway,Arial,sans-serif;color:#614BC3;background:rgba(255,255,255,.94);border-radius:4px;padding:5px 10px;}' +
    '.vhs-flag{position:absolute;pointer-events:none;background:#3C763D;color:#fff;border-radius:4px;padding:5px 10px;font:600 14px Raleway,Arial,sans-serif;}' +
    '.vhs-toolbar{position:absolute;pointer-events:auto;background:#fff;border:1px solid #614BC3;border-radius:4px;height:44px;box-shadow:0 1px 0 rgba(0,0,0,.08);display:none;align-items:stretch;}' +
    '.vhs-toolbar-item{display:flex;align-items:center;gap:8px;padding:0 14px;font:600 15px Raleway,Arial,sans-serif;color:#222;background:#fff;border:0;cursor:pointer;box-sizing:border-box;height:100%;}' +
    '.vhs-toolbar-item:not(:first-child){border-left:1px solid #ddd;}' +
    '.vhs-toolbar-item-primary{background:#614BC3;color:#fff;}' +
    '.vhs-toolbar-item-primary:hover{background:#4A37A0;}' +
    '.vhs-hidden{display:none!important;}' +
    '.vhs-status-strip{position:fixed;left:0;right:0;bottom:0;border-top:2px solid #614BC3;background:#fff;height:78px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;box-sizing:border-box;z-index:9999;}' +
    '.vhs-status-strip.is-pending{background:#C8FFE0;}' +
    '.vhs-status-strip-message{display:flex;align-items:center;gap:14px;}' +
    '.vhs-status-strip-lines{display:flex;flex-direction:column;gap:2px;}' +
    '.vhs-status-strip-text{font:600 19px Raleway,Arial,sans-serif;color:#222;}' +
    '.vhs-status-strip-pages{font:400 15px/22px Raleway,Arial,sans-serif;color:#333;}' +
    '.vhs-status-strip-btn{height:52px;padding:0 26px;border-radius:4px;font:600 18px Raleway,Arial,sans-serif;display:flex;align-items:center;background:#3C763D;color:#fff;border:1px solid #3C763D;cursor:pointer;box-sizing:border-box;}' +
    '.vhs-status-strip-btn:disabled{background:#F5F5F5;color:#777;border-color:#ddd;cursor:not-allowed;}';
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
    btn.disabled = true;
    btn.textContent = 'Put my changes on the website';
    // Screen 06 (the publish confirmation modal) does not exist yet. This
    // button must open that modal before publishing, never publish
    // directly — replace this seam with the real modal call once 06 lands.
    btn.addEventListener('click', function () {
      if (btn.disabled) return;
      // TODO: open the screen 06 publish confirmation modal once it exists.
    });
    strip.appendChild(btn);

    document.body.appendChild(strip);

    return { root: strip, iconPending: iconPending, iconClean: iconClean, text: text, pagesLine: pagesLine, btn: btn };
  }

  function renderStatusStrip(strip, count, pendingLabels) {
    var pending = count > 0;
    strip.root.classList[pending ? 'add' : 'remove']('is-pending');
    strip.iconPending.classList[pending ? 'remove' : 'add']('vhs-hidden');
    strip.iconClean.classList[pending ? 'add' : 'remove']('vhs-hidden');
    strip.text.textContent = pending ? pageSentence(count) : 'Everything is on the website.';
    strip.pagesLine.textContent = pending ? pendingLabels.join(', ') : '';
    strip.btn.disabled = !pending;
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

  function positionGroup(g) {
    var rect = g.img.getBoundingClientRect();
    g.toolbar.style.left = rect.left + 'px';
    g.toolbar.style.top = (rect.top - 50) + 'px';
    g.flag.style.left = (rect.right - 8) + 'px';
    g.flag.style.top = (rect.top + 8) + 'px';
    g.flag.style.transform = 'translateX(-100%)';
    g.caption.style.left = (rect.left + 8) + 'px';
    g.caption.style.top = (rect.bottom - 8) + 'px';
    g.caption.style.transform = 'translateY(-100%)';
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

    var group = { img: img, toolbar: toolbar, flag: flag, caption: caption };
    vhsGroups.push(group);
    positionGroup(group);
    // The image's box is not final until it loads — including when a
    // replacement photo (a different intrinsic size) finishes loading.
    img.addEventListener('load', function () { positionGroup(group); });

    // The toolbar is no longer a DOM descendant of the photo, so CSS
    // :hover/:focus-within on a shared ancestor can't drive it — track
    // hover/focus across both elements explicitly instead.
    var overImg = false, overToolbar = false, toolbarFocused = false;
    function updateToolbarVisibility() {
      toolbar.style.display = (overImg || overToolbar || toolbarFocused) ? 'flex' : 'none';
    }
    img.addEventListener('mouseenter', function () { overImg = true; updateToolbarVisibility(); });
    img.addEventListener('mouseleave', function () { overImg = false; updateToolbarVisibility(); });
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
      if (err && err.status === 409) {
        alert('Somebody else changed this photo a moment ago. We have loaded their version. Please try again.');
        if (err.body && err.body.current) applied(err.body.current);
        return;
      }
      if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
      img.src = previousSrc;
      alert(err && err.message ? err.message : 'The old photo is still there. Nothing has changed.');
    }

    changeBtn.addEventListener('click', function () {
      // README "Uploads" constraint: the 3 MB cap is stated before the file
      // picker opens, never only after a failed upload.
      alert('Choose a JPG, PNG or WEBP photo smaller than 3 MB.');
      pick().then(function (file) {
        if (!file) return;
        var previousSrc = img.src;
        changeBtn.disabled = true;
        showPreview(file);
        return upload(file).then(function (asset) {
          return api('/v1/slots/' + encodeURIComponent(slot.id), {
            method: 'PUT', json: { r2Key: asset.r2Key, alt: slot.alt || '' },
            headers: { 'If-Match': etag }
          });
        }).then(applied).catch(function (err) { failed(previousSrc, err); });
      });
    });

    restoreBtn.addEventListener('click', function () {
      var ok = confirm('Restore the original photo? The photo you put here will be taken away. The photo that was on the website before will come back.');
      if (!ok) return;
      api('/v1/slots/' + encodeURIComponent(slot.id) + '/revert', { method: 'POST' })
        .then(function (u) { slot.alt = u.alt; img.alt = u.alt; applied(u); })
        .catch(function (err) { failed(img.src, err); });
    });
  }

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

  Promise.all([
    apiOrDefault(api('/v1/pages'), []),
    api('/v1/slots?page=' + encodeURIComponent(pagePath())),
    apiOrDefault(api('/v1/publish/pending'), { count: 0, pages: [] })
  ]).then(function (results) {
    if (signedOut) { sessionStorage.removeItem(TOKEN_KEY); return; }

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

    slots.forEach(function (slot) {
      var img = document.querySelector('[data-vhs-slot="' + slot.id.replace(/"/g, '\\"') + '"]');
      if (img) decorate(img, slot, !!slot.r2Key && pageIsPending, refreshPending);
    });
  }).catch(function (err) {
    if (err && err.status === 401) sessionStorage.removeItem(TOKEN_KEY);
  });
})();
