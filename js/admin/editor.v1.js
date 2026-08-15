(function () {
  'use strict';

  // Overridable via window.VHS_API_BASE. Otherwise: served from localhost -> `wrangler dev`,
  // anywhere else -> production. The site pages that load this bundle set no global, so it
  // must pick a sensible default on its own.
  var API = window.VHS_API_BASE || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? 'http://localhost:8787'
    : 'https://api.vhspurnea.com');
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
        throw new Error('Image is still over 3 MB after compression — please use a smaller photo.');
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

  // ---- UI ----

  var style = document.createElement('style');
  style.textContent =
    '.vhs-wrap{position:relative;display:inline-block;outline:2px dashed #614BC3;outline-offset:2px}' +
    '.vhs-tools{position:absolute;top:4px;left:4px;z-index:9998;display:flex;gap:4px}' +
    '.vhs-tools button{font:12px/1.4 Arial;padding:3px 7px;border:0;border-radius:3px;background:#614BC3;color:#fff;cursor:pointer}' +
    '.vhs-tools button.vhs-secondary{background:#777}' +
    '.vhs-busy{opacity:.45}' +
    '#vhs-bar{position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#222;color:#fff;' +
    'font:14px/1.5 Arial;padding:8px 14px;display:flex;align-items:center;gap:12px}' +
    '#vhs-bar button{padding:5px 12px;border:0;border-radius:3px;background:#33BBC5;color:#fff;cursor:pointer}' +
    '#vhs-bar button[disabled]{background:#555;cursor:default}' +
    '#vhs-bar .vhs-msg{margin-left:auto}';
  document.head.appendChild(style);

  var bar = document.createElement('div');
  bar.id = 'vhs-bar';
  bar.innerHTML =
    '<strong>Edit mode</strong><span id="vhs-pending">checking…</span>' +
    '<button id="vhs-publish" disabled>Publish</button>' +
    '<span class="vhs-msg"><a href="/admin/" style="color:#8ff">Admin</a></span>';
  document.body.appendChild(bar);

  function setMsg(s) { document.getElementById('vhs-pending').textContent = s; }

  function refreshPending() {
    return api('/v1/publish/pending').then(function (r) {
      setMsg(r.count ? r.count + ' page(s) unpublished' : 'all published');
      document.getElementById('vhs-publish').disabled = r.count === 0;
    }).catch(function () { setMsg('status unavailable'); });
  }

  document.getElementById('vhs-publish').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true;
    setMsg('publishing…');
    api('/v1/publish', { method: 'POST' })
      .then(function (r) { setMsg(r.commit ? 'published — live in ~1 min' : 'nothing to publish'); })
      .catch(function (e) { setMsg(e.message); })
      .then(refreshPending);
  });

  function pick() {
    return new Promise(function (resolve) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg,image/png,image/webp';
      input.addEventListener('change', function () { resolve(input.files && input.files[0]); });
      input.click();
    });
  }

  function decorate(img, slot) {
    var wrap = document.createElement('span');
    wrap.className = 'vhs-wrap';
    img.parentNode.insertBefore(wrap, img);
    wrap.appendChild(img);

    var tools = document.createElement('span');
    tools.className = 'vhs-tools';
    wrap.appendChild(tools);

    var etag = slot.updatedAt;
    var previewUrl = null;

    function showPreview(blob) {
      try {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(blob);
        img.src = previewUrl;
      } catch (e) { /* a preview is a nicety; never block the edit */ }
    }

    function busy(on) { img.classList[on ? 'add' : 'remove']('vhs-busy'); }

    function button(label, cls, handler) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); handler(); });
      tools.appendChild(b);
      return b;
    }

    function applied(updated) {
      etag = updated.updatedAt;
      slot.r2Key = updated.r2Key;
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
      busy(false);
      refreshPending();
    }

    function failed(err) {
      busy(false);
      if (err.status === 409) {
        alert('Someone else changed this image. Reloading it.');
        if (err.body && err.body.current) applied(err.body.current);
        return;
      }
      alert(err.message);
    }

    button('Replace', null, function () {
      pick().then(function (file) {
        if (!file) return;
        showPreview(file);
        busy(true);
        return upload(file).then(function (asset) {
          return api('/v1/slots/' + encodeURIComponent(slot.id), {
            method: 'PUT', json: { r2Key: asset.r2Key, alt: slot.alt || '' },
            headers: { 'If-Match': etag }
          });
        }).then(applied);
      }).catch(failed);
    });

    button('Alt text', 'vhs-secondary', function () {
      var next = prompt('Describe this image (used by screen readers and search engines):', slot.alt || '');
      if (next === null) return;
      if (!slot.r2Key) { alert('Replace the image first, then set its alt text.'); return; }
      busy(true);
      api('/v1/slots/' + encodeURIComponent(slot.id), {
        method: 'PUT', json: { r2Key: slot.r2Key, alt: next }, headers: { 'If-Match': etag }
      }).then(function (u) { slot.alt = next; img.alt = next; applied(u); }).catch(failed);
    });

    if (slot.r2Key) {
      button('Revert', 'vhs-secondary', function () {
        if (!confirm('Restore the original image?')) return;
        busy(true);
        api('/v1/slots/' + encodeURIComponent(slot.id) + '/revert', { method: 'POST' })
          .then(function (u) { slot.alt = u.alt; img.alt = u.alt; applied(u); })
          .catch(failed);
      });
    }

    if (slot.optional) {
      button('Remove', 'vhs-secondary', function () {
        if (!confirm('Remove this image from the page?')) return;
        busy(true);
        api('/v1/slots/' + encodeURIComponent(slot.id) + '/image', { method: 'DELETE' })
          .then(function () { busy(false); refreshPending(); location.reload(); })
          .catch(failed);
      });
    }
  }

  api('/v1/slots?page=' + encodeURIComponent(pagePath()))
    .then(function (list) {
      list.forEach(function (slot) {
        var img = document.querySelector('[data-vhs-slot="' + slot.id.replace(/"/g, '\\"') + '"]');
        if (img) decorate(img, slot);
      });
      setMsg(list.length ? list.length + ' editable image(s)' : 'no editable images here');
      return refreshPending();
    })
    .catch(function (err) {
      if (err.status === 401) { sessionStorage.removeItem(TOKEN_KEY); bar.remove(); return; }
      setMsg('could not load editor: ' + err.message);
    });
})();
