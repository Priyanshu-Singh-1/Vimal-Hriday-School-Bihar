/**
 * One event's photos: add, remove, and see how many there are.
 *
 * Adding is deliberately a two-step server conversation -- each file goes to
 * /v1/uploads on its own, then the resulting keys are attached to the event in
 * one call. Uploading one at a time keeps a single failure from losing the
 * whole selection, and lets the count on screen move as it goes.
 */
(function () {
  'use strict';

  var VHS = window.VHS;
  var API = VHS.API;

  /** Must match MAX_PHOTOS_PER_BATCH in worker/src/lib/galleryLimits.ts. */
  var MAX_PER_BATCH = 25;
  /** Must match MAX_PHOTOS_PER_EVENT in worker/src/lib/galleryLimits.ts. */
  var MAX_PER_EVENT = 150;
  /** Must match MAX_BYTES in worker/src/routes/uploads.ts. */
  var MAX_BYTES = 3 * 1024 * 1024;

  var alertEl = document.getElementById('eventAlert');
  var contentEl = document.getElementById('eventContent');
  var titleEl = document.getElementById('eventTitle');
  var countEl = document.getElementById('photoCount');
  var gridEl = document.getElementById('photoGrid');
  var inputEl = document.getElementById('photoInput');
  var addBtn = document.getElementById('addPhotosBtn');
  var limitNote = document.getElementById('photoLimitNote');
  var progressEl = document.getElementById('addProgress');
  var backLink = document.getElementById('eventBackLink');

  var stateEl = document.createElement('div');
  document.querySelector('.vhs-gallery-body').insertBefore(stateEl, alertEl);
  var loadedOnce = false;

  var eventId = (/[?&]id=([^&]*)/.exec(location.search) || [])[1];
  var current = null;

  function showError(message) {
    alertEl.textContent = message;
    VHS.show(alertEl, true);
  }

  function clearError() { VHS.show(alertEl, false); }

  function photosSentence(n) {
    if (n === 0) return 'No photos yet.';
    return n === 1 ? '1 photo' : n + ' photos';
  }

  function buildCell(photo) {
    var cell = document.createElement('div');
    cell.className = 'vhs-photo-cell';

    var img = document.createElement('img');
    img.src = photo.src;
    img.alt = '';
    img.loading = 'lazy';
    cell.appendChild(img);

    var actions = document.createElement('div');
    actions.className = 'vhs-photo-cell-actions';
    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'vhs-btn vhs-btn-destructive';
    remove.textContent = 'Remove';
    remove.addEventListener('click', function () { confirmRemove(photo); });
    actions.appendChild(remove);
    cell.appendChild(actions);

    return cell;
  }

  function confirmRemove(photo) {
    VHS.openModal({
      title: 'Remove this photo?',
      buildBody: function (body) {
        var img = document.createElement('img');
        img.className = 'vhs-modal-photo';
        img.src = photo.src;
        img.alt = '';
        body.appendChild(img);
        var text = document.createElement('p');
        text.className = 'vhs-modal-text';
        text.textContent = 'It will be taken off this event when you put your changes on the website.';
        body.appendChild(text);
      },
      buttons: [
        { label: 'No, keep it', className: 'vhs-modal-btn-secondary' },
        {
          label: 'Yes, remove it',
          className: 'vhs-modal-btn-destructive',
          onClick: function () { removePhoto(photo); }
        }
      ]
    });
  }

  function removePhoto(photo) {
    clearError();
    fetch(API + '/v1/gallery/events/' + eventId + '/photos/' + photo.id, {
      method: 'DELETE',
      headers: VHS.authHeaders()
    })
      .then(function (res) {
        if (res.status === 401) { VHS.showSessionExpired(); return; }
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok) {
            showError(body && body.error ? body.error : 'That photo could not be removed. Please try again.');
            return;
          }
          load();
        });
      })
      .catch(function () {
        showError('The website could not be reached. Please try again.');
      });
  }

  /* ------------------------------------------------------------ adding */

  function setProgress(text) {
    if (!text) { VHS.show(progressEl, false); return; }
    progressEl.textContent = text;
    VHS.show(progressEl, true);
  }

  /** Upload one file, resolving to its r2Key or rejecting with a plain message. */
  function uploadOne(file) {
    var form = new FormData();
    form.append('file', file);
    return fetch(API + '/v1/uploads', {
      method: 'POST',
      headers: VHS.authHeaders(),
      body: form
    }).then(function (res) {
      if (res.status === 401) { VHS.showSessionExpired(); throw new Error('signed out'); }
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          // The server's own wording for a too-large or non-image file is
          // developer-facing, so say it the way the rest of the console does.
          if (res.status === 413) throw new Error('"' + file.name + '" is larger than 3 MB. Please choose a smaller photo.');
          if (res.status === 415) throw new Error('"' + file.name + '" is not a photo. Please choose a JPG, PNG or WebP file.');
          throw new Error('"' + file.name + '" could not be added. Please try again.');
        }
        return body.r2Key;
      });
    });
  }

  function addPhotos() {
    clearError();
    var files = inputEl.files ? Array.prototype.slice.call(inputEl.files) : [];

    if (!files.length) {
      showError('Please choose the photos you want to add.');
      return;
    }

    // Checked here as well as on the server, so a large selection is refused
    // before any of it is uploaded rather than after.
    if (files.length > MAX_PER_BATCH) {
      showError(
        'You can add up to ' + MAX_PER_BATCH + ' photos at a time. You chose ' + files.length +
        '. Please add the first ' + MAX_PER_BATCH + ', then add the rest.'
      );
      return;
    }

    var tooBig = files.filter(function (f) { return f.size > MAX_BYTES; });
    if (tooBig.length) {
      showError('"' + tooBig[0].name + '" is larger than 3 MB. Please choose a smaller photo.');
      return;
    }

    addBtn.disabled = true;
    inputEl.disabled = true;

    var keys = [];
    var index = 0;

    function next() {
      if (index >= files.length) return attach(keys);
      setProgress('Adding photo ' + (index + 1) + ' of ' + files.length + '…');
      return uploadOne(files[index]).then(function (key) {
        keys.push(key);
        index += 1;
        return next();
      });
    }

    function attach(uploaded) {
      if (!uploaded.length) return null;
      setProgress('Almost done…');
      return fetch(API + '/v1/gallery/events/' + eventId + '/photos', {
        method: 'POST',
        headers: (function () {
          var h = VHS.authHeaders();
          h['Content-Type'] = 'application/json';
          return h;
        })(),
        body: JSON.stringify({ r2Keys: uploaded })
      }).then(function (res) {
        if (res.status === 401) { VHS.showSessionExpired(); return; }
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok) {
            showError(body && body.error ? body.error : 'Those photos could not be added. Please try again.');
            return;
          }
          inputEl.value = '';
          load();
        });
      });
    }

    next()
      .catch(function (err) {
        // Whatever uploaded before the failure is still attached, so the work
        // is not lost; the message names the file that stopped it.
        if (keys.length) {
          attach(keys);
        }
        if (err && err.message && err.message !== 'signed out') showError(err.message);
      })
      .then(function () {
        setProgress('');
        addBtn.disabled = false;
        inputEl.disabled = false;
      });
  }

  /* ------------------------------------------------------------ loading */

  function render(event) {
    current = event;
    titleEl.textContent = event.title;
    countEl.textContent = photosSentence(event.photos.length);
    if (backLink && event.category) {
      backLink.href = 'gallery.html?category=' + encodeURIComponent(event.category);
    }

    gridEl.innerHTML = '';
    for (var i = 0; i < event.photos.length; i++) {
      gridEl.appendChild(buildCell(event.photos[i]));
    }

    // Reached directly by url for an event whose list is not managed: show the
    // photos, but do not offer changes the server would refuse.
    if (event.photosManaged === false) {
      showError(
        'The photos on this page are arranged in a special way, so they cannot ' +
        'be changed here. Please ask your developer.'
      );
      var panel = document.querySelector('.vhs-add-photos-panel');
      if (panel) VHS.show(panel, false);
      var cells = gridEl.querySelectorAll('.vhs-photo-cell-actions');
      for (var c = 0; c < cells.length; c++) cells[c].style.display = 'none';
      VHS.show(contentEl, true);
      return;
    }

    var room = MAX_PER_EVENT - event.photos.length;
    limitNote.textContent =
      'You can add up to ' + MAX_PER_BATCH + ' photos at a time, and each one must be under 3 MB.' +
      (room <= MAX_PER_BATCH ? ' This event has room for ' + room + ' more.' : '');

    VHS.show(contentEl, true);
  }

  function load() {
    if (!loadedOnce) VHS.showLoading(stateEl);
    fetch(API + '/v1/gallery/events/' + eventId, { headers: VHS.authHeaders() })
      .then(function (res) {
        if (res.status === 401) { VHS.showSessionExpired(); return null; }
        if (res.status === 404) { showError('That event could not be found.'); return null; }
        return res.json();
      })
      .then(function (event) {
        if (!event) return;
        loadedOnce = true;
        stateEl.innerHTML = '';
        render(event);
      })
      .catch(function () {
        if (!loadedOnce) VHS.showOffline(stateEl, load);
      });
  }

  window.addEventListener('offline', function () { if (!loadedOnce) VHS.showOffline(stateEl, load); });
  window.addEventListener('online', function () { if (!loadedOnce) load(); });

  function init() {
    VHS.initHeader({
      userNameId: 'eventUserName',
      signOutBtnId: 'signOutBtn',
      onUser: function () {
        if (!eventId) { showError('That event could not be found.'); return; }
        addBtn.addEventListener('click', addPhotos);
        load();
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

  init();
})();
