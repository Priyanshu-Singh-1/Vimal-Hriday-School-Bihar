(function () {
  'use strict';
  var API = window.VHS_API_BASE;
  var TOKEN_KEY = 'vhs_admin_token';
  var USER_KEY = 'vhs_admin_user';

  var $ = function (id) { return document.getElementById(id); };
  var show = function (el, on) { el.classList[on ? 'remove' : 'add']('vhs-hidden'); };
  var text = function (el, s, cls) { el.textContent = s || ''; if (cls) el.className = cls; };

  var ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return ESCAPE_MAP[ch]; });
  }

  function token() { return sessionStorage.getItem(TOKEN_KEY); }
  function user() { try { return JSON.parse(sessionStorage.getItem(USER_KEY) || 'null'); } catch (e) { return null; } }

  function api(path, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    if (token()) headers.Authorization = 'Bearer ' + token();
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw new Error(body.error || ('request failed: ' + res.status));
        return body;
      });
    });
  }

  function signOutLocal() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    show($('appView'), false);
    show($('loginView'), true);
  }

  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    text($('loginErr'), '');
    $('loginBtn').disabled = true;
    api('/v1/auth/login', { method: 'POST', body: { username: $('u').value, password: $('p').value } })
      .then(function (r) {
        sessionStorage.setItem(TOKEN_KEY, r.token);
        sessionStorage.setItem(USER_KEY, JSON.stringify(r.user));
        $('p').value = '';
        boot();
      })
      .catch(function (err) { text($('loginErr'), err.message); })
      .then(function () { $('loginBtn').disabled = false; });
  });

  $('logoutBtn').addEventListener('click', function () {
    api('/v1/auth/logout', { method: 'POST' }).catch(function () {}).then(signOutLocal);
  });

  $('pwForm').addEventListener('submit', function (e) {
    e.preventDefault();
    api('/v1/auth/password', {
      method: 'POST',
      body: { currentPassword: $('pwCur').value, newPassword: $('pwNew').value }
    })
      .then(function () {
        text($('pwMsg'), 'Password updated. Please sign in again.', 'vhs-ok');
        setTimeout(signOutLocal, 1500);
      })
      .catch(function (err) { text($('pwMsg'), err.message, 'vhs-err'); });
  });

  function refreshPending() {
    return api('/v1/publish/pending').then(function (r) {
      $('pendingLine').textContent = r.count
        ? r.count + ' page(s) waiting to publish: ' + r.pages.map(function (p) { return p.pagePath; }).join(', ')
        : 'Everything is published.';
      $('publishBtn').disabled = r.count === 0;
    });
  }

  $('publishBtn').addEventListener('click', function () {
    $('publishBtn').disabled = true;
    text($('publishMsg'), 'Publishing…', 'vhs-ok');
    api('/v1/publish', { method: 'POST' })
      .then(function (r) {
        text($('publishMsg'), r.commit
          ? 'Published ' + r.pages.length + ' page(s). Live in about a minute.'
          : 'Nothing needed publishing.', 'vhs-ok');
      })
      .catch(function (err) { text($('publishMsg'), err.message, 'vhs-err'); })
      .then(refreshPending);
  });

  function renderPages(list) {
    $('pagesBody').innerHTML = '';
    list.forEach(function (p) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      var a = document.createElement('a');
      a.href = '../' + p.pagePath;
      a.textContent = p.label;
      td.appendChild(a);
      var count = document.createElement('div');
      count.className = 'vhs-muted';
      count.textContent = p.slotCount + (p.slotCount === 1 ? ' photograph' : ' photographs');
      td.appendChild(count);
      if (p.editedCount > 0) {
        var changed = document.createElement('div');
        changed.className = 'vhs-muted';
        changed.textContent = p.editedCount + ' changed, not yet published';
        td.appendChild(changed);
      }
      tr.appendChild(td);
      $('pagesBody').appendChild(tr);
    });
  }

  function loadPages() {
    return api('/v1/pages').then(renderPages).catch(function (e) {
      text($('pagesMsg'), e.message, 'vhs-err');
    });
  }

  function renderUsers(list) {
    var me = user();
    $('usersBody').innerHTML = '';
    list.forEach(function (row) {
      var tr = document.createElement('tr');
      var badge = '<span class="vhs-badge-' + row.role + '">' + row.role + '</span>';
      tr.innerHTML = '<td>' + row.username + '</td><td>' + badge +
        '</td><td>' + (row.last_login_at || 'never') + '</td>';
      var td = document.createElement('td');
      if (me && row.id !== me.id) {
        var del = document.createElement('button');
        del.className = 'btn btn-danger btn-xs';
        del.textContent = 'Delete';
        del.addEventListener('click', function () {
          if (!confirm('Delete ' + row.username + '?')) return;
          api('/v1/users/' + row.id, { method: 'DELETE' })
            .then(loadUsers)
            .catch(function (e) { text($('usersMsg'), e.message, 'vhs-err'); });
        });
        td.appendChild(del);
      }
      tr.appendChild(td);
      $('usersBody').appendChild(tr);
    });
  }

  function loadUsers() {
    return api('/v1/users').then(renderUsers).catch(function (e) {
      text($('usersMsg'), e.message, 'vhs-err');
    });
  }

  var auditNextBefore = null;

  function describeAudit(e) {
    var actor = '<strong>' + escapeHtml(e.actor) + '</strong>';
    var target = escapeHtml(e.target);
    var where = e.pageLabel ? escapeHtml(e.pageLabel) : target;
    switch (e.action) {
      case 'auth.login': return actor + ' signed in';
      case 'auth.logout': return actor + ' signed out';
      case 'auth.password_change': return actor + ' changed their password';
      case 'user.create': return actor + ' created the account ' + target;
      case 'user.delete': return actor + ' deleted the account ' + target;
      case 'user.role_change': return actor + ' changed the role of ' + target;
      case 'user.password_reset': return actor + ' reset the password for ' + target;
      case 'asset.upload':
        var kb = (e.detail && typeof e.detail.bytes === 'number') ? Math.round(e.detail.bytes / 1024) : null;
        return actor + ' uploaded a photograph' + (kb !== null ? ' (' + kb + ' KB)' : '');
      case 'slot.update': return actor + ' replaced a photograph on ' + where;
      case 'slot.revert': return actor + ' restored the original photograph on ' + where;
      case 'slot.clear': return actor + ' removed a photograph from ' + where;
      case 'publish':
        var n = (e.detail && e.detail.pages && e.detail.pages.length) || 0;
        var ref = e.target ? escapeHtml(e.target.slice(0, 7)) : '';
        return actor + ' published ' + n + ' page(s)' + (ref ? ' <span class="vhs-muted">' + ref + '</span>' : '');
      default:
        return actor + ' — ' + escapeHtml(e.action);
    }
  }

  function renderAuditRows(list) {
    list.forEach(function (e) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.innerHTML = '<div>' + describeAudit(e) + '</div><div class="vhs-muted">' + escapeHtml(e.at) + '</div>';
      tr.appendChild(td);
      $('auditBody').appendChild(tr);
    });
  }

  function loadAudit(reset) {
    if (reset) {
      $('auditBody').innerHTML = '';
      auditNextBefore = null;
    }
    var qs = '?limit=50' + (auditNextBefore ? '&before=' + auditNextBefore : '');
    return api('/v1/audit' + qs).then(function (r) {
      renderAuditRows(r.entries);
      auditNextBefore = r.nextBefore;
      show($('auditMoreBtn'), auditNextBefore !== null);
      text($('auditMsg'), '');
    }).catch(function (e) {
      text($('auditMsg'), e.message, 'vhs-err');
    });
  }

  $('auditMoreBtn').addEventListener('click', function () { loadAudit(false); });

  function boot() {
    if (!token()) { show($('loginView'), true); show($('appView'), false); return; }
    api('/v1/auth/me')
      .then(function (me) {
        sessionStorage.setItem(USER_KEY, JSON.stringify(me));
        $('whoami').textContent = me.username;
        $('whorole').innerHTML = '<span class="vhs-badge-' + me.role + '">' + me.role + '</span>';
        show($('loginView'), false);
        show($('appView'), true);
        show($('usersCard'), me.role === 'owner');
        show($('auditCard'), me.role === 'owner');
        loadPages();
        refreshPending();
        if (me.role === 'owner') {
          loadUsers();
          loadAudit(true);
        }
      })
      .catch(signOutLocal);
  }

  boot();
})();
