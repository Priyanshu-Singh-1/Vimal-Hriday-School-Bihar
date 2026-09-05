/**
 * Photo gallery: the three fixed parts, and the events inside one of them.
 *
 * The three parts (Celebrations, Non-curricular activities, Cultural events)
 * are fixed by design -- they are never created, renamed or removed here.
 * Everything editable lives one level down, at the event.
 */
(function () {
  'use strict';

  var VHS = window.VHS;
  var API = VHS.API;

  var alertEl = document.getElementById('galleryAlert');
  var introEl = document.getElementById('galleryIntro');
  var categoryList = document.getElementById('categoryList');
  var categoryGrid = document.getElementById('categoryGrid');
  var eventList = document.getElementById('eventList');
  var eventRows = document.getElementById('eventRows');
  var eventCountEl = document.getElementById('eventCount');
  var addEventBtn = document.getElementById('addEventBtn');

  var stateEl = document.createElement('div');
  document.querySelector('.vhs-gallery-body').insertBefore(stateEl, alertEl);
  var loadedOnce = false;

  // Which part of the gallery we are looking at, from the page's own url so a
  // refresh or a bookmark lands in the same place.
  var categoryId = (/[?&]category=([^&]*)/.exec(location.search) || [])[1];
  if (categoryId) categoryId = decodeURIComponent(categoryId);

  function showError(message) {
    alertEl.textContent = message;
    VHS.show(alertEl, true);
  }

  function clearError() {
    VHS.show(alertEl, false);
  }

  function eventsSentence(shown, total) {
    if (total === 0) return 'No events yet.';
    var hidden = total - shown;
    var s = total + (total === 1 ? ' event' : ' events');
    if (hidden > 0) s += ', ' + hidden + ' not showing on the website';
    return s;
  }

  /* ---------------------------------------------------------------- parts */

  function buildCategoryTile(category) {
    var a = document.createElement('a');
    a.className = 'vhs-tile';
    a.href = 'gallery.html?category=' + encodeURIComponent(category.id);

    var text = document.createElement('div');
    var title = document.createElement('div');
    title.className = 'vhs-h-card vhs-tile-title';
    title.textContent = category.label;
    var desc = document.createElement('div');
    desc.className = 'vhs-tile-desc';
    desc.textContent = eventsSentence(category.shownCount, category.eventCount);
    text.appendChild(title);
    text.appendChild(desc);
    a.appendChild(text);
    return a;
  }

  function loadCategories() {
    if (!loadedOnce) VHS.showLoading(stateEl);
    fetch(API + '/v1/gallery/categories', { headers: VHS.authHeaders() })
      .then(function (res) {
        if (res.status === 401) { VHS.showSessionExpired(); return null; }
        return res.json();
      })
      .then(function (list) {
        if (!list) return;
        loadedOnce = true;
        stateEl.innerHTML = '';
        categoryGrid.innerHTML = '';
        for (var i = 0; i < list.length; i++) {
          categoryGrid.appendChild(buildCategoryTile(list[i]));
        }
        VHS.show(categoryList, true);
      })
      .catch(function () {
        if (!loadedOnce) VHS.showOffline(stateEl, loadCategories);
      });
  }

  /* --------------------------------------------------------------- events */

  function renameEvent(event) {
    var input;
    VHS.openModal({
      title: 'Change this name',
      buildBody: function (body) {
        var label = document.createElement('label');
        label.className = 'vhs-label';
        label.setAttribute('for', 'renameInput');
        label.textContent = 'What should this event be called?';
        input = document.createElement('input');
        input.className = 'vhs-input';
        input.type = 'text';
        input.id = 'renameInput';
        input.value = event.title;
        input.maxLength = 120;
        body.appendChild(label);
        body.appendChild(input);
      },
      buttons: [
        { label: 'Cancel', className: 'vhs-modal-btn-secondary' },
        {
          label: 'Save this name',
          onClick: function () {
            var title = (input.value || '').trim();
            if (!title) { showError('Please type a name for this event.'); return; }
            send('PATCH', '/v1/gallery/events/' + event.id, { title: title });
          }
        }
      ]
    });
    if (input) input.focus();
  }

  /**
   * Removing an event asks which kind of removal is meant, because the two are
   * not equally undoable: hiding is reversible from this screen, deleting the
   * page is not. Deleting is offered only for a page this console created --
   * an original page of the website keeps working on any link already shared.
   */
  function removeEvent(event) {
    var modal = VHS.openModal({
      title: 'Remove "' + event.title + '"?',
      buildBody: function (body) {
        var hide = document.createElement('button');
        hide.type = 'button';
        hide.className = 'vhs-remove-choice';
        hide.innerHTML = '';
        var hideTitle = document.createElement('div');
        hideTitle.className = 'vhs-remove-choice-title';
        hideTitle.textContent = 'Hide from the gallery';
        var hideDesc = document.createElement('div');
        hideDesc.className = 'vhs-remove-choice-desc';
        hideDesc.textContent = 'It stops showing in the gallery. You can bring it back here at any time.';
        hide.appendChild(hideTitle);
        hide.appendChild(hideDesc);
        hide.addEventListener('click', function () {
          modal.close();
          send('DELETE', '/v1/gallery/events/' + event.id);
        });
        body.appendChild(hide);

        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'vhs-remove-choice';
        var delTitle = document.createElement('div');
        delTitle.className = 'vhs-remove-choice-title';
        delTitle.textContent = 'Delete for good';
        var delDesc = document.createElement('div');
        delDesc.className = 'vhs-remove-choice-desc';
        if (event.pageOwned) {
          delDesc.textContent = 'The event and its page are removed from the website. This cannot be undone.';
          del.addEventListener('click', function () {
            modal.close();
            send('DELETE', '/v1/gallery/events/' + event.id + '?mode=delete');
          });
        } else {
          delDesc.textContent = 'This event was part of the website before, so it cannot be deleted here. Hide it instead.';
          del.disabled = true;
        }
        del.appendChild(delTitle);
        del.appendChild(delDesc);
        body.appendChild(del);
      },
      buttons: [{ label: 'Cancel', className: 'vhs-modal-btn-secondary' }]
    });
  }

  function showEvent(event) {
    send('PATCH', '/v1/gallery/events/' + event.id, { visible: true });
  }

  function send(method, path, body) {
    clearError();
    var init = { method: method, headers: VHS.authHeaders() };
    if (body) {
      init.headers = VHS.authHeaders();
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    fetch(API + path, init)
      .then(function (res) {
        if (res.status === 401) { VHS.showSessionExpired(); return null; }
        return res.json().catch(function () { return {}; }).then(function (payload) {
          if (!res.ok) {
            showError(payload && payload.error ? payload.error : 'That did not work. Please try again.');
            return null;
          }
          return payload;
        });
      })
      .then(function (ok) {
        if (ok) loadEvents();
      })
      .catch(function () {
        showError('The website could not be reached. Please try again.');
      });
  }

  function buildEventRow(event) {
    var row = document.createElement('div');
    row.className = 'vhs-page-row vhs-row' + (event.visible ? '' : ' vhs-event-row-hidden');

    if (event.coverSrc) {
      var thumb = document.createElement('img');
      thumb.className = 'vhs-page-thumb';
      thumb.src = event.coverSrc;
      thumb.alt = '';
      row.appendChild(thumb);
    }

    var info = document.createElement('div');
    info.className = 'vhs-page-row-info';

    var name = document.createElement('div');
    name.className = 'vhs-h-row';
    name.textContent = event.title;
    info.appendChild(name);

    var meta = document.createElement('div');
    meta.className = 'vhs-page-row-meta';
    meta.textContent = event.photoCount === 1 ? '1 photo' : event.photoCount + ' photos';
    info.appendChild(meta);

    if (!event.visible) {
      var badge = document.createElement('span');
      badge.className = 'vhs-badge vhs-badge-hidden';
      badge.textContent = 'Not showing on the website';
      info.appendChild(badge);
    }
    row.appendChild(info);

    var buttons = document.createElement('div');
    buttons.className = 'vhs-event-row-buttons';

    // An event whose page arranges its photos under subheadings cannot have
    // that list rebuilt, so the button would lead to a screen that refuses
    // every action. Say why instead of offering it.
    if (event.photosManaged === false) {
      var note = document.createElement('span');
      note.className = 'vhs-muted-text';
      note.textContent = 'Photos set up by your developer';
      buttons.appendChild(note);
    } else {
      var photos = document.createElement('a');
      photos.className = 'vhs-btn vhs-btn-secondary vhs-page-row-btn';
      photos.href = 'event.html?id=' + event.id;
      photos.textContent = 'Change photos';
      buttons.appendChild(photos);
    }

    var rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'vhs-btn vhs-btn-secondary';
    rename.textContent = 'Change name';
    rename.addEventListener('click', function () { renameEvent(event); });
    buttons.appendChild(rename);

    if (event.visible) {
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'vhs-btn vhs-btn-destructive';
      remove.textContent = 'Remove';
      remove.addEventListener('click', function () { removeEvent(event); });
      buttons.appendChild(remove);
    } else {
      var unhide = document.createElement('button');
      unhide.type = 'button';
      unhide.className = 'vhs-btn vhs-btn-secondary';
      unhide.textContent = 'Show on the website';
      unhide.addEventListener('click', function () { showEvent(event); });
      buttons.appendChild(unhide);
    }

    row.appendChild(buttons);
    return row;
  }

  function addEvent() {
    var input;
    VHS.openModal({
      title: 'Add an event',
      buildBody: function (body) {
        var label = document.createElement('label');
        label.className = 'vhs-label';
        label.setAttribute('for', 'newEventInput');
        label.textContent = 'What is this event called?';
        input = document.createElement('input');
        input.className = 'vhs-input';
        input.type = 'text';
        input.id = 'newEventInput';
        input.maxLength = 120;
        var help = document.createElement('p');
        help.className = 'vhs-muted-text';
        help.textContent =
          'The event starts hidden, so nobody sees it until you have added its photos.';
        body.appendChild(label);
        body.appendChild(input);
        body.appendChild(help);
      },
      buttons: [
        { label: 'Cancel', className: 'vhs-modal-btn-secondary' },
        {
          label: 'Add this event',
          onClick: function () {
            var title = (input.value || '').trim();
            if (!title) { showError('Please type a name for this event.'); return; }
            send('POST', '/v1/gallery/categories/' + encodeURIComponent(categoryId) + '/events', { title: title });
          }
        }
      ]
    });
    if (input) input.focus();
  }

  function loadEvents() {
    if (!loadedOnce) VHS.showLoading(stateEl);
    fetch(API + '/v1/gallery/categories/' + encodeURIComponent(categoryId) + '/events', {
      headers: VHS.authHeaders()
    })
      .then(function (res) {
        if (res.status === 401) { VHS.showSessionExpired(); return null; }
        return res.json();
      })
      .then(function (list) {
        if (!list) return;
        loadedOnce = true;
        stateEl.innerHTML = '';
        eventRows.innerHTML = '';
        var shown = 0;
        for (var i = 0; i < list.length; i++) {
          if (list[i].visible) shown += 1;
          eventRows.appendChild(buildEventRow(list[i]));
        }
        eventCountEl.textContent = eventsSentence(shown, list.length);
        VHS.show(eventList, true);
      })
      .catch(function () {
        if (!loadedOnce) VHS.showOffline(stateEl, loadEvents);
      });
  }

  window.addEventListener('offline', function () {
    if (!loadedOnce) VHS.showOffline(stateEl, categoryId ? loadEvents : loadCategories);
  });
  window.addEventListener('online', function () {
    if (!loadedOnce) (categoryId ? loadEvents : loadCategories)();
  });

  function init() {
    VHS.initHeader({
      userNameId: 'galleryUserName',
      signOutBtnId: 'signOutBtn',
      onUser: function () {
        if (categoryId) {
          introEl.textContent = 'Add an event, change its photos or its name, or take it off the website.';
          addEventBtn.addEventListener('click', addEvent);
          loadEvents();
        } else {
          loadCategories();
        }
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
