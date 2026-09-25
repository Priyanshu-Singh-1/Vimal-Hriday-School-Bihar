/**
 * Navigation menus: the "The School" and "Circulars" dropdowns in the site's
 * top menu. Both menus are fixed by design -- they are never created,
 * renamed or removed here, only the links inside them are. Every other item
 * in the top menu (Home, About Us, Gallery, Exam, School Fee) has no admin
 * section at all.
 */
(function () {
  'use strict';

  var VHS = window.VHS;
  var API = VHS.API;

  var MENUS = [
    { key: 'the_school', rowsId: 'theSchoolRows', emptyId: 'theSchoolEmpty', addBtnId: 'addTheSchoolBtn' },
    { key: 'circulars', rowsId: 'circularsRows', emptyId: 'circularsEmpty', addBtnId: 'addCircularsBtn' }
  ];

  var alertEl = document.getElementById('navAlert');
  var contentEl = document.getElementById('navContent');

  var stateEl = document.createElement('div');
  document.querySelector('.vhs-nav-body').insertBefore(stateEl, alertEl);
  var loadedOnce = false;

  function showError(message) {
    alertEl.textContent = message;
    VHS.show(alertEl, true);
  }

  function clearError() {
    VHS.show(alertEl, false);
  }

  /* --------------------------------------------------------- form fields */

  function buildTextField(container, opts) {
    var label = document.createElement('label');
    label.className = 'vhs-label';
    label.setAttribute('for', opts.id);
    label.textContent = opts.labelText;
    var input = document.createElement('input');
    input.className = 'vhs-input';
    input.type = 'text';
    input.id = opts.id;
    input.value = opts.value || '';
    if (opts.maxLength) input.maxLength = opts.maxLength;
    var field = document.createElement('div');
    field.className = 'vhs-field';
    field.appendChild(label);
    field.appendChild(input);
    container.appendChild(field);
    return input;
  }

  function buildCheckboxField(container, opts) {
    var wrap = document.createElement('label');
    wrap.className = 'vhs-checkbox-field';
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.id = opts.id;
    input.checked = !!opts.checked;
    var span = document.createElement('span');
    span.textContent = opts.labelText;
    wrap.appendChild(input);
    wrap.appendChild(span);
    container.appendChild(wrap);
    return input;
  }

  /* --------------------------------------------------------------- send */

  function send(method, path, body) {
    clearError();
    var init = { method: method, headers: VHS.authHeaders() };
    if (body) {
      init.headers = VHS.authHeaders();
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return fetch(API + path, init).then(function (res) {
      if (res.status === 401) { VHS.showSessionExpired(); return null; }
      return res.json().catch(function () { return {}; }).then(function (payload) {
        if (!res.ok) {
          showError(payload && payload.error ? payload.error : 'That did not work. Please try again.');
          return null;
        }
        return payload;
      });
    }).then(function (ok) {
      if (!ok) return null;
      loadMenus();
      if (VHS.refreshStatusStrip) VHS.refreshStatusStrip();
      return ok;
    }).catch(function () {
      showError('The website could not be reached. Please try again.');
      return null;
    });
  }

  /* -------------------------------------------------------------- modal */

  function openLinkModal(opts) {
    var labelInput, hrefInput, newTabInput, badgeInput;
    VHS.openModal({
      title: opts.title,
      buildBody: function (body) {
        labelInput = buildTextField(body, { id: 'navLinkLabel', labelText: 'Link text', value: opts.label, maxLength: 120 });
        hrefInput = buildTextField(body, { id: 'navLinkHref', labelText: 'Web address', value: opts.href, maxLength: 2000 });
        newTabInput = buildCheckboxField(body, { id: 'navLinkNewTab', labelText: 'Open in a new tab', checked: opts.newTab !== false });
        badgeInput = buildCheckboxField(body, { id: 'navLinkBadge', labelText: 'Show the "New" flag next to it', checked: opts.badge !== false });
      },
      buttons: [
        { label: 'Cancel', className: 'vhs-modal-btn-secondary' },
        {
          label: opts.saveLabel,
          onClick: function () {
            var label = (labelInput.value || '').trim();
            var href = (hrefInput.value || '').trim();
            if (!label) { showError('Please type a name for this link.'); return; }
            if (!href) { showError('Please enter a web address for this link.'); return; }
            opts.onSave({ label: label, href: href, newTab: newTabInput.checked, badge: badgeInput.checked });
          }
        }
      ]
    });
    if (labelInput) labelInput.focus();
  }

  function addLink(menuKey) {
    openLinkModal({
      title: 'Add a link',
      label: '', href: '', newTab: true, badge: true,
      saveLabel: 'Add this link',
      onSave: function (fields) { send('POST', '/v1/nav/' + menuKey, fields); }
    });
  }

  function editLink(item) {
    openLinkModal({
      title: 'Change this link',
      label: item.label, href: item.href, newTab: item.newTab, badge: item.badge,
      saveLabel: 'Save this link',
      onSave: function (fields) { send('PATCH', '/v1/nav/items/' + item.id, fields); }
    });
  }

  function removeLink(item) {
    VHS.openModal({
      title: 'Remove "' + item.label + '"?',
      buildBody: function (body) {
        var text = document.createElement('div');
        text.className = 'vhs-modal-text';
        text.textContent = "It will no longer show in the website's top menu.";
        body.appendChild(text);
      },
      buttons: [
        { label: 'Cancel', className: 'vhs-modal-btn-secondary' },
        { label: 'Yes, remove this link', className: 'vhs-modal-btn-destructive', onClick: function () { send('DELETE', '/v1/nav/items/' + item.id); } }
      ]
    });
  }

  function moveLink(menuKey, items, index, delta) {
    var target = index + delta;
    if (target < 0 || target >= items.length) return;
    var ids = items.map(function (i) { return i.id; });
    var moved = ids.splice(index, 1)[0];
    ids.splice(target, 0, moved);
    send('POST', '/v1/nav/' + menuKey + '/order', { ids: ids });
  }

  /* --------------------------------------------------------------- rows */

  function buildRow(item, menuKey, items, index) {
    var row = document.createElement('div');
    row.className = 'vhs-page-row vhs-row';

    var info = document.createElement('div');
    info.className = 'vhs-page-row-info';
    var name = document.createElement('div');
    name.className = 'vhs-h-row';
    name.textContent = item.label;
    info.appendChild(name);
    var meta = document.createElement('div');
    meta.className = 'vhs-page-row-meta vhs-muted-text';
    meta.textContent = item.href;
    info.appendChild(meta);
    row.appendChild(info);

    var buttons = document.createElement('div');
    buttons.className = 'vhs-event-row-buttons';

    var up = document.createElement('button');
    up.type = 'button';
    up.className = 'vhs-btn vhs-btn-secondary vhs-nav-move-btn';
    up.textContent = 'Move up';
    up.disabled = index === 0;
    up.addEventListener('click', function () { moveLink(menuKey, items, index, -1); });
    buttons.appendChild(up);

    var down = document.createElement('button');
    down.type = 'button';
    down.className = 'vhs-btn vhs-btn-secondary vhs-nav-move-btn';
    down.textContent = 'Move down';
    down.disabled = index === items.length - 1;
    down.addEventListener('click', function () { moveLink(menuKey, items, index, 1); });
    buttons.appendChild(down);

    var change = document.createElement('button');
    change.type = 'button';
    change.className = 'vhs-btn vhs-btn-secondary';
    change.textContent = 'Change';
    change.addEventListener('click', function () { editLink(item); });
    buttons.appendChild(change);

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'vhs-btn vhs-btn-destructive';
    remove.textContent = 'Remove';
    remove.addEventListener('click', function () { removeLink(item); });
    buttons.appendChild(remove);

    row.appendChild(buttons);
    return row;
  }

  function renderMenu(menu, items) {
    var rowsEl = document.getElementById(menu.rowsId);
    var emptyEl = document.getElementById(menu.emptyId);
    rowsEl.innerHTML = '';
    VHS.show(rowsEl, items.length > 0);
    VHS.show(emptyEl, items.length === 0);
    for (var i = 0; i < items.length; i++) {
      rowsEl.appendChild(buildRow(items[i], menu.key, items, i));
    }
  }

  function loadMenus() {
    if (!loadedOnce) VHS.showLoading(stateEl);
    fetch(API + '/v1/nav', { headers: VHS.authHeaders() })
      .then(function (res) {
        if (res.status === 401) { VHS.showSessionExpired(); return null; }
        return res.json();
      })
      .then(function (byMenu) {
        if (!byMenu) return;
        loadedOnce = true;
        stateEl.innerHTML = '';
        for (var i = 0; i < MENUS.length; i++) {
          renderMenu(MENUS[i], byMenu[MENUS[i].key] || []);
        }
        VHS.show(contentEl, true);
      })
      .catch(function () {
        if (!loadedOnce) VHS.showOffline(stateEl, loadMenus);
      });
  }

  window.addEventListener('offline', function () { if (!loadedOnce) VHS.showOffline(stateEl, loadMenus); });
  window.addEventListener('online', function () { if (!loadedOnce) loadMenus(); });

  function init() {
    VHS.initHeader({
      userNameId: 'navUserName',
      signOutBtnId: 'signOutBtn',
      onUser: function () {
        document.getElementById('addTheSchoolBtn').addEventListener('click', function () { addLink('the_school'); });
        document.getElementById('addCircularsBtn').addEventListener('click', function () { addLink('circulars'); });
        loadMenus();
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

  if (!VHS.hasSession()) {
    VHS.goToSignIn();
  } else {
    init();
  }
})();
