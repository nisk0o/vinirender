// ============================================================
// VINICUS Y AMIGOS — frontend conectado al backend Node
// Mismo diseño y mismas vistas que la versión HTML autónoma,
// pero ahora todo (usuarios, tablón, hall, apuntes, raideo) se
// guarda de verdad en el servidor, con login real por sesión.
// ============================================================

/* ---- Datos "estáticos" (no cambian, no hace falta backend) ---- */
var ROLES = ['Gru', 'Minion menaje', 'Minion fundador', 'Amo de segundo nivel', 'Minion supremo'];
var ROLE_META = {
  'Gru':                   { icon: '👑', badgeClass: 'rank-gru',     slug: 'gru' },
  'Minion menaje':         { icon: '🧹', badgeClass: '',             slug: 'menaje' },
  'Minion fundador':       { icon: '⭐', badgeClass: 'rank-fundador', slug: 'fundador' },
  'Amo de segundo nivel':  { icon: '⚔️', badgeClass: 'rank-segundo',  slug: 'segundo' },
  'Minion supremo':        { icon: '🔥', badgeClass: 'rank-supremo',  slug: 'supremo' }
};
var ROLE_HIERARCHY = {
  role: 'Gru',
  children: [
    { role: 'Amo de segundo nivel', children: [
      { role: 'Minion supremo', children: [
        { role: 'Minion menaje', children: [] }
      ] }
    ] },
    { role: 'Minion fundador', children: [] }
  ]
};

function isGru(u) { return !!u && u.role === 'Gru'; }
function roleMeta(u) { return ROLE_META[u.role] || ROLE_META['Minion menaje']; }
function roleLabel(u) { return roleMeta(u).icon + ' ' + u.role; }
function initialsOf(alias) { return (alias || '?').split(' ').map(function(w){return w[0];}).slice(0,2).join('').toUpperCase(); }

var DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
var MONTH_NAMES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/* ---- Cliente API ---- */
async function api(path, opts) {
  opts = opts || {};
  var fetchOpts = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
  if (opts.body !== undefined) {
    fetchOpts.headers['Content-Type'] = 'application/json';
    fetchOpts.body = JSON.stringify(opts.body);
  }
  var res = await fetch('/api' + path, fetchOpts);
  var data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) {
    var err = new Error((data && data.error) || ('Error ' + res.status));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/* ---- Toasts (avisos elegantes en vez de showToast() del navegador) ---- */
function showToast(message, type) {
  type = type || 'error';
  var stack = document.getElementById('toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    stack.id = 'toast-stack';
    document.body.appendChild(stack);
  }
  var t = document.createElement('div');
  t.className = 'toast is-' + type;
  t.setAttribute('role', type === 'error' ? 'alert' : 'status');
  var icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.textContent = type === 'success' ? '✅' : (type === 'info' ? '💡' : '⚠️');
  var txt = document.createElement('span');
  txt.textContent = message;
  t.appendChild(icon);
  t.appendChild(txt);
  stack.appendChild(t);
  setTimeout(function(){
    t.classList.add('leaving');
    setTimeout(function(){ t.remove(); }, 220);
  }, 3800);
}

/* ---- Estado local (espejo de lo que hay en el servidor) ---- */
var loginScreen = document.getElementById('login-screen');
var appShell = document.getElementById('app-shell');
var errorBox = document.getElementById('login-error');
var currentUser = null;
var USERS = [];
var boardNotes = [];
var wipeSignups = {};
var raidList = [];
var enemiesList = [];
var enemyTeamsList = [];

/* ============================================================
   MIEMBROS
   ============================================================ */
async function fetchUsers() {
  var data = await api('/users');
  USERS = data.users;
  return USERS;
}

function renderMembers() {
  var grid = document.getElementById('members-grid');
  grid.innerHTML = '';
  var sorted = USERS.slice().sort(function(a,b){
    if (isGru(a) !== isGru(b)) return isGru(a) ? -1 : 1;
    return a.alias.localeCompare(b.alias);
  });
  sorted.forEach(function(u){
    var canEdit = currentUser && isGru(currentUser);
    var card = document.createElement('div');
    card.className = 'member-card' + (isGru(u) ? ' is-leader' : '') + (canEdit ? ' is-editable' : '');
    var avatar = document.createElement('div');
    avatar.className = 'member-avatar';
    if (u.avatar) {
      var img = document.createElement('img');
      img.src = u.avatar; img.alt = u.alias;
      avatar.appendChild(img);
    } else {
      avatar.textContent = initialsOf(u.alias);
    }
    var alias = document.createElement('div');
    alias.className = 'member-alias';
    alias.textContent = u.alias;
    var tag = document.createElement('div');
    tag.className = 'member-tag';
    tag.textContent = roleLabel(u);
    card.appendChild(avatar); card.appendChild(alias); card.appendChild(tag);
    if (canEdit) {
      var hint = document.createElement('div');
      hint.className = 'member-edit-hint';
      hint.textContent = '✏️';
      card.appendChild(hint);
      card.title = 'Cambiar rango de ' + u.alias;
      card.addEventListener('click', function(){ openRoleModal(u); });
    }
    grid.appendChild(card);
  });
}

/* ---- Modal de cambio de rango (solo Gru) ---- */
var roleModalUser = null;

function openRoleModal(u) {
  if (!currentUser || !isGru(currentUser)) return;
  roleModalUser = u;

  var avatarEl = document.getElementById('role-modal-avatar');
  avatarEl.innerHTML = '';
  if (u.avatar) {
    var img = document.createElement('img');
    img.src = u.avatar; img.alt = u.alias;
    avatarEl.appendChild(img);
  } else {
    avatarEl.textContent = initialsOf(u.alias);
  }
  document.getElementById('role-modal-name').textContent = u.alias;

  var optionsWrap = document.getElementById('role-modal-options');
  optionsWrap.innerHTML = '';
  ROLES.forEach(function(r){
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'role-option-btn' + (u.role === r ? ' is-current' : '');
    btn.textContent = ROLE_META[r].icon + ' ' + r + (u.role === r ? ' · actual' : '');
    btn.addEventListener('click', function(){ setUserRole(u, r); });
    optionsWrap.appendChild(btn);
  });

  document.getElementById('role-modal-overlay').classList.add('visible');
}

function closeRoleModal() {
  roleModalUser = null;
  document.getElementById('role-modal-overlay').classList.remove('visible');
}

async function setUserRole(u, newRole) {
  try {
    await api('/users/' + encodeURIComponent(u.username) + '/role', { method: 'PATCH', body: { role: newRole } });
  } catch (e) {
    showToast(e.message);
    return;
  }
  closeRoleModal();
  await fetchUsers();
  renderMembers();
  renderBoard();
  if (document.getElementById('view-zerg').classList.contains('active')) renderOrgchart();
  if (currentUser && u.username === currentUser.username) {
    currentUser.role = newRole;
    document.getElementById('user-role').textContent = isGru(currentUser) ? 'Líder · Gru' : currentUser.role;
  }
  if (document.getElementById('view-taquilla').classList.contains('active')) renderLocker();
}

function setupRoleModal() {
  document.getElementById('role-modal-cancel').addEventListener('click', closeRoleModal);
  document.getElementById('role-modal-overlay').addEventListener('click', function(e){
    if (e.target === this) closeRoleModal();
  });
}

/* ============================================================
   TABLÓN DE ANUNCIOS
   ============================================================ */
function fmtNoteTime(ts) {
  var d = new Date(ts);
  var now = new Date();
  var sameDay = d.toDateString() === now.toDateString();
  var hh = String(d.getHours()).padStart(2, '0');
  var mm = String(d.getMinutes()).padStart(2, '0');
  if (sameDay) return 'Hoy · ' + hh + ':' + mm;
  return d.getDate() + ' ' + MONTH_NAMES[d.getMonth()] + ' · ' + hh + ':' + mm;
}

async function fetchBoard() {
  var data = await api('/board');
  boardNotes = data.notes;
}

function renderBoardComposerAvatar() {
  var el = document.getElementById('board-form-avatar');
  if (!el || !currentUser) return;
  el.innerHTML = '';
  if (currentUser.avatar) {
    var img = document.createElement('img');
    img.src = currentUser.avatar; img.alt = currentUser.alias;
    el.appendChild(img);
  } else {
    el.textContent = initialsOf(currentUser.alias);
  }
}

function renderBoard() {
  renderBoardComposerAvatar();
  var list = document.getElementById('board-list');
  if (!list) return;
  list.innerHTML = '';

  if (!boardNotes.length) {
    var empty = document.createElement('div');
    empty.className = 'board-empty';
    empty.textContent = 'Todavía no hay notas. ¡Sé el primero en dejar una!';
    list.appendChild(empty);
    return;
  }

  var sorted = boardNotes.slice().sort(function(a,b){ return b.ts - a.ts; });
  sorted.forEach(function(note){
    var author = USERS.find(function(u){ return u.username === note.username; });
    if (!author) return;
    var meta = roleMeta(author);

    var card = document.createElement('div');
    card.className = 'board-note role-' + meta.slug;

    var head = document.createElement('div');
    head.className = 'board-note-head';

    var authorEl = document.createElement('div');
    authorEl.className = 'board-note-author';
    var noteAvatar = document.createElement('div');
    noteAvatar.className = 'board-note-avatar';
    if (author.avatar) {
      var avImg = document.createElement('img');
      avImg.src = author.avatar; avImg.alt = author.alias;
      noteAvatar.appendChild(avImg);
    } else {
      noteAvatar.textContent = initialsOf(author.alias);
    }
    var icon = document.createElement('span');
    icon.className = 'role-icon';
    icon.textContent = meta.icon;
    authorEl.appendChild(noteAvatar);
    authorEl.appendChild(icon);
    authorEl.appendChild(document.createTextNode(author.alias));

    var metaWrap = document.createElement('div');
    metaWrap.className = 'board-note-meta';
    if (Date.now() - note.ts < 10 * 60 * 1000) {
      var newBadge = document.createElement('span');
      newBadge.className = 'board-note-new';
      newBadge.textContent = 'Nuevo';
      metaWrap.appendChild(newBadge);
    }
    var time = document.createElement('span');
    time.className = 'board-note-time';
    time.textContent = fmtNoteTime(note.ts);
    metaWrap.appendChild(time);

    var canDelete = currentUser && (currentUser.username === note.username || isGru(currentUser));
    if (canDelete) {
      var del = document.createElement('button');
      del.className = 'board-note-delete';
      del.type = 'button';
      del.title = 'Borrar nota';
      del.setAttribute('aria-label', 'Borrar nota');
      del.textContent = '✕';
      del.addEventListener('click', function(){ deleteBoardNote(note.id); });
      metaWrap.appendChild(del);
    }

    head.appendChild(authorEl);
    head.appendChild(metaWrap);

    var text = document.createElement('div');
    text.className = 'board-note-text';
    text.textContent = note.text;

    card.appendChild(head);
    card.appendChild(text);
    list.appendChild(card);
  });
}

async function deleteBoardNote(id) {
  try {
    await api('/board/' + id, { method: 'DELETE' });
  } catch (e) { showToast(e.message); return; }
  await fetchBoard();
  renderBoard();
}

function setupBoard() {
  var input = document.getElementById('board-input');
  var counter = document.getElementById('board-char-count');
  function updateCounter() {
    var remaining = 280 - input.value.length;
    counter.textContent = remaining;
    counter.classList.toggle('is-low', remaining <= 30);
  }
  input.addEventListener('input', updateCounter);
  updateCounter();

  document.getElementById('board-form').addEventListener('submit', async function(e){
    e.preventDefault();
    if (!currentUser) return;
    var text = input.value.trim();
    if (!text) return;
    try {
      await api('/board', { method: 'POST', body: { text: text } });
    } catch (err) { showToast(err.message); return; }
    input.value = '';
    updateCounter();
    await fetchBoard();
    renderBoard();
    showToast('Nota publicada en el tablón', 'success');
  });
}

/* ============================================================
   ESTADÍSTICAS POR SERVIDOR (placeholders, sin fuente real todavía)
   ============================================================ */
var SERVERS = [
  { id: 'rusticated-trio', platform: 'Rusticated', name: 'Thursday Trio' },
  { id: 'rusticated-main', platform: 'Rusticated', name: 'Thursday Main' },
  { id: 'rustafied-friday', platform: 'Rustafied', name: 'Friday' },
  { id: 'reddit-trio',     platform: 'Reddit',     name: 'Thursday Trio' },
  { id: 'reddit-main',     platform: 'Reddit',     name: 'Thursday Main' }
];
var statsSelectedServerId = SERVERS[0].id;

function renderStatsServerPicker() {
  var picker = document.getElementById('stats-server-picker');
  picker.innerHTML = '';
  SERVERS.forEach(function(s){
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stats-server-btn' + (s.id === statsSelectedServerId ? ' active' : '');
    var community = document.createElement('span');
    community.className = 'stats-server-community';
    community.textContent = s.platform;
    var name = document.createElement('span');
    name.className = 'stats-server-name';
    name.textContent = s.name;
    btn.appendChild(community);
    btn.appendChild(name);
    btn.addEventListener('click', function(){
      statsSelectedServerId = s.id;
      renderStatsServerPicker();
      renderStatsPanel();
    });
    picker.appendChild(btn);
  });
}

function renderStatsPanel() {
  var panel = document.getElementById('stats-panel');
  if (!panel) return;
  panel.innerHTML = '';

  var server = SERVERS.find(function(s){ return s.id === statsSelectedServerId; }) || SERVERS[0];

  var head = document.createElement('div');
  head.className = 'stats-panel-head';
  var title = document.createElement('div');
  title.className = 'stats-panel-title';
  title.textContent = server.platform + ' · ' + server.name;
  var badge = document.createElement('span');
  badge.className = 'stats-panel-badge';
  badge.textContent = 'Sin conectar';
  head.appendChild(title);
  head.appendChild(badge);
  panel.appendChild(head);

  var table = document.createElement('table');
  table.className = 'stats-table';
  var thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Miembro</th><th>SteamID64</th><th>Tiempo jugado</th><th>Kills</th><th>Muertes</th></tr>';
  table.appendChild(thead);

  var tbody = document.createElement('tbody');
  var sorted = USERS.slice().sort(function(a,b){ return a.alias.localeCompare(b.alias); });
  sorted.forEach(function(u){
    var tr = document.createElement('tr');
    var tdName = document.createElement('td');
    tdName.className = 'stats-member-name';
    tdName.textContent = u.alias;
    var tdSteam = document.createElement('td');
    if (u.steamId) {
      tdSteam.textContent = u.steamId;
    } else {
      tdSteam.className = 'stats-steamid-missing';
      tdSteam.textContent = 'Sin SteamID (añádela en tu Taquilla)';
    }
    var tdTime = document.createElement('td');
    tdTime.className = 'stats-placeholder-value';
    tdTime.textContent = '—';
    var tdKills = document.createElement('td');
    tdKills.className = 'stats-placeholder-value';
    tdKills.textContent = '—';
    var tdDeaths = document.createElement('td');
    tdDeaths.className = 'stats-placeholder-value';
    tdDeaths.textContent = '—';
    tr.appendChild(tdName); tr.appendChild(tdSteam); tr.appendChild(tdTime); tr.appendChild(tdKills); tr.appendChild(tdDeaths);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  panel.appendChild(table);

  var note = document.createElement('div');
  note.className = 'stats-panel-note';
  note.textContent = 'Todavía no estamos conectados a ninguna fuente de datos real (BattleMetrics u otra). Cuando lo montemos, estas columnas se rellenarán solas.';
  panel.appendChild(note);
}

function setupStats() {
  renderStatsServerPicker();
  renderStatsPanel();
}

/* ============================================================
   ENEMIGOS — por servidor, agrupados por equipo
   (persistidos en el servidor; sin fuente externa todavía)
   ============================================================ */
var enemiesSelectedServerId = SERVERS[0].id;
var serverSettings = {};        // serverId -> ID de BattleMetrics (o '')
var enemiesStatus = null;       // último /enemies/status del servidor actual
var enemiesStatusError = null;  // mensaje de error de BattleMetrics, si lo hubo
var enemiesStatusTimer = null;  // intervalo de auto-refresco (60 s)
var enemiesBmEditing = false;   // ¿está abierto el campo para (re)vincular?

async function fetchEnemies() {
  var data = await api('/enemies');
  enemiesList = data.enemies;
}

async function fetchEnemyTeams() {
  var data = await api('/enemy-teams');
  enemyTeamsList = data.teams;
}

async function fetchServerSettings() {
  var data = await api('/server-settings');
  serverSettings = data.settings || {};
}

async function fetchEnemiesStatus() {
  var sid = enemiesSelectedServerId;
  enemiesStatusError = null;
  if (!serverSettings[sid]) { enemiesStatus = null; return; }
  try {
    var data = await api('/enemies/status?serverId=' + encodeURIComponent(sid));
    if (sid !== enemiesSelectedServerId) return; // el usuario cambió de servidor mientras cargaba
    enemiesStatus = data.linked ? data : null;
  } catch (err) {
    if (sid !== enemiesSelectedServerId) return;
    enemiesStatus = null;
    enemiesStatusError = err.message;
  }
}

// Refresca el estado online y repinta. Se llama al entrar en la
// pestaña, al cambiar de servidor, al pulsar "Actualizar" y cada
// 60 segundos en segundo plano.
async function refreshEnemiesStatus() {
  await fetchEnemiesStatus();
  try { await fetchEnemies(); } catch (e) { /* mantenemos la lista que ya teníamos */ }
  renderEnemiesBmBox();
  renderEnemiesPanel();
}

function startEnemiesAutoRefresh() {
  stopEnemiesAutoRefresh();
  enemiesStatusTimer = setInterval(function(){
    var v = document.getElementById('view-enemigos');
    // Solo refrescamos si la pestaña Enemigos está a la vista y la
    // ventana no está en segundo plano (para no gastar peticiones).
    if (!v || !v.classList.contains('active') || document.hidden) return;
    refreshEnemiesStatus();
  }, 60000);
}

function stopEnemiesAutoRefresh() {
  if (enemiesStatusTimer) { clearInterval(enemiesStatusTimer); enemiesStatusTimer = null; }
}

function bmTimeAgo(ts) {
  var diff = Math.max(0, Date.now() - ts);
  var mins = Math.floor(diff / 60000);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return 'hace ' + mins + ' min';
  var hours = Math.floor(mins / 60);
  if (hours < 24) return 'hace ' + hours + ' h';
  var days = Math.floor(hours / 24);
  return 'hace ' + days + ' día' + (days === 1 ? '' : 's');
}

function renderEnemiesBmBox() {
  var box = document.getElementById('enemy-bm-box');
  if (!box) return;
  box.innerHTML = '';

  var sid = enemiesSelectedServerId;
  var linked = !!serverSettings[sid];
  var row = document.createElement('div');
  row.className = 'enemy-bm-row';

  // --- Modo edición: pegar la URL/ID de BattleMetrics ---
  if (!linked || enemiesBmEditing) {
    var text = document.createElement('span');
    text.className = 'enemy-bm-text';
    text.textContent = linked
      ? 'Cambiar el vínculo de BattleMetrics de este servidor:'
      : '🔗 Vincula este servidor con BattleMetrics para ver quién está online:';
    row.appendChild(text);

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'enemy-bm-input';
    input.placeholder = 'Pega la URL: battlemetrics.com/servers/rust/1234567';
    if (linked) input.value = serverSettings[sid];
    row.appendChild(input);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn enemy-bm-btn';
    btn.textContent = 'Vincular';
    btn.addEventListener('click', async function(){
      var value = input.value.trim();
      if (!value) return;
      btn.disabled = true;
      btn.textContent = 'Comprobando…';
      try {
        var resp = await api('/server-settings', { method: 'POST', body: { serverId: sid, bmServerId: value } });
        serverSettings[sid] = resp.bmServerId;
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Vincular';
        showToast(err.message);
        return;
      }
      enemiesBmEditing = false;
      showToast('Servidor vinculado con BattleMetrics', 'success');
      refreshEnemiesStatus();
    });
    row.appendChild(btn);

    if (linked) {
      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'enemy-bm-link';
      cancel.textContent = 'Cancelar';
      cancel.addEventListener('click', function(){
        enemiesBmEditing = false;
        renderEnemiesBmBox();
      });
      row.appendChild(cancel);
    }

    box.appendChild(row);
    return;
  }

  // --- Modo estado: vinculado, mostramos qué sabemos ---
  var dot = document.createElement('span');
  dot.className = 'enemy-bm-dot';
  var text = document.createElement('span');
  text.className = 'enemy-bm-text';

  if (enemiesStatusError) {
    dot.classList.add('err');
    text.textContent = enemiesStatusError;
  } else if (!enemiesStatus) {
    dot.classList.add('offline');
    text.textContent = 'Consultando BattleMetrics…';
  } else {
    var s = enemiesStatus;
    dot.classList.add(s.status === 'online' ? 'online' : 'err');
    var name = document.createElement('strong');
    name.textContent = s.serverName || 'Servidor';
    text.appendChild(name);
    var rest = ' · ' + s.playersOnline + (s.maxPlayers ? '/' + s.maxPlayers : '') + ' jugadores';
    if (s.status !== 'online') rest += ' · ⚠️ servidor ' + (s.status === 'offline' ? 'caído' : s.status);
    text.appendChild(document.createTextNode(rest));
  }

  row.appendChild(dot);
  row.appendChild(text);

  if (enemiesStatus && enemiesStatus.fetchedAt) {
    var meta = document.createElement('span');
    meta.className = 'enemy-bm-meta';
    meta.textContent = 'actualizado ' + bmTimeAgo(enemiesStatus.fetchedAt);
    row.appendChild(meta);
  }

  var spacer = document.createElement('span');
  spacer.className = 'enemy-bm-spacer';
  row.appendChild(spacer);

  var refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'enemy-bm-link';
  refreshBtn.textContent = '↻ Actualizar';
  refreshBtn.addEventListener('click', function(){ refreshEnemiesStatus(); });
  row.appendChild(refreshBtn);

  var editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'enemy-bm-link';
  editBtn.textContent = 'Cambiar vínculo';
  editBtn.addEventListener('click', function(){
    enemiesBmEditing = true;
    renderEnemiesBmBox();
  });
  row.appendChild(editBtn);

  box.appendChild(row);
}

function renderEnemiesServerPicker() {
  var picker = document.getElementById('enemies-server-picker');
  if (!picker) return;
  picker.innerHTML = '';
  SERVERS.forEach(function(s){
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stats-server-btn' + (s.id === enemiesSelectedServerId ? ' active' : '');
    var community = document.createElement('span');
    community.className = 'stats-server-community';
    community.textContent = s.platform;
    var name = document.createElement('span');
    name.className = 'stats-server-name';
    name.textContent = s.name;
    btn.appendChild(community);
    btn.appendChild(name);
    btn.addEventListener('click', function(){
      enemiesSelectedServerId = s.id;
      enemiesStatus = null;
      enemiesStatusError = null;
      enemiesBmEditing = false;
      renderEnemiesServerPicker();
      renderEnemyTeamSelect();
      renderEnemiesBmBox();
      renderEnemiesPanel();
      refreshEnemiesStatus();
    });
    picker.appendChild(btn);
  });
}

function enemiesForServer() {
  return enemiesList.filter(function(e){ return e.serverId === enemiesSelectedServerId; });
}

// Equipos registrados (tabla enemy_teams) del servidor seleccionado.
function enemyTeamsForServer() {
  return enemyTeamsList
    .filter(function(t){ return t.serverId === enemiesSelectedServerId; })
    .sort(function(a,b){ return a.name.localeCompare(b.name); });
}

// Nombres de equipo a mostrar: los registrados + los que aún vivan
// solo como texto en algún enemigo (datos de antes de esta mejora).
function enemyTeams() {
  var teams = enemyTeamsForServer().map(function(t){ return t.name; });
  enemiesForServer().forEach(function(e){
    var t = e.team || '';
    if (t && teams.indexOf(t) === -1) teams.push(t);
  });
  teams.sort(function(a,b){ return a.localeCompare(b); });
  return teams;
}

function findEnemyTeam(name) {
  return enemyTeamsForServer().find(function(t){ return t.name === name; }) || null;
}

function renderEnemyTeamSelect() {
  var select = document.getElementById('enemy-team-select');
  if (!select) return;
  var prevValue = select.value;
  select.innerHTML = '';

  var noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = 'Sin equipo';
  select.appendChild(noneOpt);

  enemyTeams().forEach(function(t){
    var opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    select.appendChild(opt);
  });

  var values = Array.prototype.map.call(select.options, function(o){ return o.value; });
  if (values.indexOf(prevValue) !== -1) select.value = prevValue;
}

function makeEnemyTeamSelect(currentTeam, onChange) {
  var select = document.createElement('select');
  select.className = 'enemy-card-team-select';

  var noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = 'Sin equipo';
  if (!currentTeam) noneOpt.selected = true;
  select.appendChild(noneOpt);

  enemyTeams().forEach(function(t){
    var opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    if (t === currentTeam) opt.selected = true;
    select.appendChild(opt);
  });

  select.addEventListener('change', function(){ onChange(select.value); });
  return select;
}

function renderEnemiesPanel() {
  var panel = document.getElementById('enemy-list');
  if (!panel) return;
  panel.innerHTML = '';

  var server = SERVERS.find(function(s){ return s.id === enemiesSelectedServerId; }) || SERVERS[0];

  var head = document.createElement('div');
  head.className = 'stats-panel-head';
  var title = document.createElement('div');
  title.className = 'stats-panel-title';
  title.textContent = server.platform + ' · ' + server.name;
  head.appendChild(title);
  panel.appendChild(head);

  var list = enemiesForServer();
  var teamNames = enemyTeams();

  if (!list.length && !teamNames.length) {
    var empty = document.createElement('div');
    empty.className = 'enemy-empty';
    empty.textContent = 'Todavía no hay enemigos ni equipos apuntados en este servidor. ¡Añade el primero arriba!';
    panel.appendChild(empty);
    return;
  }

  var teams = teamNames.concat(['']);
  teams.forEach(function(team){
    var teamEnemies = list.filter(function(e){ return (e.team || '') === team; })
                           .sort(function(a,b){ return a.name.localeCompare(b.name); });
    var teamInfo = team === '' ? null : findEnemyTeam(team);
    // "Sin equipo" (y los equipos heredados solo-texto) se muestran
    // únicamente si tienen enemigos; los equipos registrados se
    // muestran siempre, aunque estén vacíos.
    if (!teamEnemies.length && !teamInfo) return;

    var group = document.createElement('div');
    group.className = 'enemy-team-group';

    var groupHead = document.createElement('div');
    groupHead.className = 'enemy-team-head';

    var groupTitle = document.createElement('span');
    groupTitle.textContent = team === '' ? '🎯 Sin equipo' : '⚔️ ' + team;
    groupHead.appendChild(groupTitle);

    // Tamaño y cuadrante del equipo (si está registrado con ficha)
    if (teamInfo) {
      var metaBits = [];
      if (teamInfo.size) metaBits.push('👥 ' + teamInfo.size + ' jugador' + (teamInfo.size === 1 ? '' : 'es'));
      if (teamInfo.quadrant) metaBits.push('📍 Viven en ' + teamInfo.quadrant);
      if (metaBits.length) {
        var meta = document.createElement('span');
        meta.className = 'enemy-team-meta';
        meta.textContent = metaBits.join(' · ');
        groupHead.appendChild(meta);
      }
    }

    // Si BattleMetrics está vinculado, mostramos cuántos del equipo
    // están conectados ahora mismo.
    if (enemiesStatus && enemiesStatus.onlineIds) {
      var teamOnline = teamEnemies.filter(function(e){
        return enemiesStatus.onlineIds.indexOf(e.id) !== -1;
      }).length;
      if (teamOnline > 0) {
        var onlineTag = document.createElement('span');
        onlineTag.className = 'enemy-team-online';
        onlineTag.textContent = '🟢 ' + teamOnline + '/' + teamEnemies.length + ' en línea';
        groupHead.appendChild(onlineTag);
      }
    }

    if (teamInfo) {
      var teamDelBtn = document.createElement('button');
      teamDelBtn.className = 'enemy-team-delete';
      teamDelBtn.type = 'button';
      teamDelBtn.title = 'Eliminar equipo (sus enemigos pasan a "Sin equipo")';
      teamDelBtn.setAttribute('aria-label', 'Eliminar equipo');
      teamDelBtn.textContent = '✕';
      teamDelBtn.addEventListener('click', async function(){
        if (!confirm('¿Eliminar el equipo "' + teamInfo.name + '"? Sus enemigos pasarán a "Sin equipo".')) return;
        try {
          await api('/enemy-teams/' + teamInfo.id, { method: 'DELETE' });
        } catch (err) { showToast(err.message); return; }
        await Promise.all([fetchEnemyTeams(), fetchEnemies()]);
        renderEnemyTeamSelect();
        renderEnemiesPanel();
        showToast('Equipo "' + teamInfo.name + '" eliminado', 'success');
      });
      groupHead.appendChild(teamDelBtn);
    }

    group.appendChild(groupHead);

    if (!teamEnemies.length) {
      var emptyTeam = document.createElement('div');
      emptyTeam.className = 'enemy-team-empty';
      emptyTeam.textContent = 'Sin enemigos fichados todavía en este equipo. Añádelos con el formulario de arriba.';
      group.appendChild(emptyTeam);
      panel.appendChild(group);
      return;
    }

    var grid = document.createElement('div');
    grid.className = 'enemy-cards-grid';

    teamEnemies.forEach(function(en){
      var card = document.createElement('div');
      card.className = 'enemy-card';

      var name = document.createElement('div');
      name.className = 'enemy-card-name';
      name.textContent = en.name;

      var steam = document.createElement('div');
      steam.className = 'enemy-card-steam';
      steam.textContent = en.steamId ? en.steamId : 'Sin SteamID';

      // Badge de estado (solo si el servidor está vinculado a BM)
      var statusEl = null;
      if (enemiesStatus && enemiesStatus.onlineIds) {
        statusEl = document.createElement('div');
        statusEl.className = 'enemy-card-status';
        if (enemiesStatus.onlineIds.indexOf(en.id) !== -1) {
          statusEl.classList.add('online');
          statusEl.textContent = '🟢 En línea ahora';
          card.classList.add('is-online');
        } else {
          statusEl.classList.add('offline');
          statusEl.textContent = en.lastSeen
            ? '⚫ Desconectado · visto ' + bmTimeAgo(en.lastSeen)
            : '⚫ Desconectado';
        }
      }

      var actions = document.createElement('div');
      actions.className = 'enemy-card-actions';

      var teamSelect = makeEnemyTeamSelect(en.team, async function(newTeam){
        try {
          await api('/enemies/' + en.id, { method: 'PATCH', body: { team: newTeam } });
        } catch (err) { showToast(err.message); return; }
        await fetchEnemies();
        renderEnemyTeamSelect();
        renderEnemiesPanel();
      });

      var delBtn = document.createElement('button');
      delBtn.className = 'enemy-card-delete';
      delBtn.type = 'button';
      delBtn.title = 'Eliminar enemigo';
      delBtn.setAttribute('aria-label', 'Eliminar enemigo');
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', async function(){
        try {
          await api('/enemies/' + en.id, { method: 'DELETE' });
        } catch (err) { showToast(err.message); return; }
        await fetchEnemies();
        renderEnemyTeamSelect();
        renderEnemiesPanel();
      });

      actions.appendChild(teamSelect);
      actions.appendChild(delBtn);

      card.appendChild(name);
      card.appendChild(steam);
      if (statusEl) card.appendChild(statusEl);
      card.appendChild(actions);
      grid.appendChild(card);
    });

    group.appendChild(grid);
    panel.appendChild(group);
  });
}

function setupEnemies() {
  renderEnemiesServerPicker();
  renderEnemyTeamSelect();
  renderEnemiesBmBox();
  renderEnemiesPanel();

  // ---- Formulario: añadir enemigo ----
  document.getElementById('enemy-add-form-el').addEventListener('submit', async function(e){
    e.preventDefault();
    var nameInput = document.getElementById('enemy-name-input');
    var steamInput = document.getElementById('enemy-steamid-input');
    var teamSelect = document.getElementById('enemy-team-select');

    var name = nameInput.value.trim();
    if (!name) return;
    var steamId = steamInput.value.trim();
    if (steamId && !/^\d{15,20}$/.test(steamId)) {
      showToast('La SteamID64 debe ser un número de entre 15 y 20 dígitos. Puedes dejarla vacía si no la tienes a mano.');
      return;
    }

    try {
      await api('/enemies', { method: 'POST', body: {
        serverId: enemiesSelectedServerId, name: name, steamId: steamId, team: teamSelect.value
      } });
    } catch (err) { showToast(err.message); return; }

    nameInput.value = '';
    steamInput.value = '';
    await fetchEnemies();
    renderEnemyTeamSelect();
    renderEnemiesPanel();
    showToast('Enemigo "' + name + '" fichado', 'success');
    // Refrescamos el estado online para que el recién fichado ya
    // salga con su 🟢/⚫ sin esperar al siguiente ciclo.
    refreshEnemiesStatus();
  });

  // ---- Formulario: crear equipo ----
  document.getElementById('enemy-team-form-el').addEventListener('submit', async function(e){
    e.preventDefault();
    var nameInput = document.getElementById('team-name-input');
    var sizeInput = document.getElementById('team-size-input');
    var quadInput = document.getElementById('team-quadrant-input');

    var name = nameInput.value.trim();
    if (!name) return;
    var size = parseInt(sizeInput.value, 10);
    if (sizeInput.value && (!size || size < 1)) {
      showToast('El número de jugadores debe ser un número mayor que 0 (o déjalo vacío).');
      return;
    }
    var quadrant = quadInput.value.trim().toUpperCase();

    try {
      await api('/enemy-teams', { method: 'POST', body: {
        serverId: enemiesSelectedServerId, name: name, size: size || null, quadrant: quadrant
      } });
    } catch (err) { showToast(err.message); return; }

    nameInput.value = '';
    sizeInput.value = '';
    quadInput.value = '';
    await fetchEnemyTeams();
    renderEnemyTeamSelect();
    renderEnemiesPanel();
    showToast('Equipo "' + name + '" creado', 'success');
  });
}

/* ============================================================
   CALCULADORA DE RAIDEO
   ============================================================ */
var EXPLOSIVES = {
  exploAmmo: { name: 'Explosivo 5.56', icon: '🔫', craft: { sulfur: 25,  metalFrag: 5,  charcoal: 30 } },
  beancan:   { name: 'Beancan Grenade', icon: '🧨', craft: { sulfur: 120, metalFrag: 20, charcoal: 180 } },
  satchel:   { name: 'Satchel Charge',  icon: '💣', craft: { sulfur: 480, cloth: 10, metalFrag: 80, charcoal: 720, rope: 1 } },
  rocket:    { name: 'Rocket',          icon: '🚀', craft: { sulfur: 1400, hqm: 4, scrap: 40, charcoal: 1950, metalFrag: 100, cloth: 7.5, animalFat: 22.5 } },
  c4:        { name: 'C4 (Timed Explosive Charge)', icon: '🧪', craft: { sulfur: 2200, cloth: 20, techTrash: 2, metalFrag: 200, charcoal: 3000, animalFat: 45 } }
};
var EXPLOSIVE_ORDER = ['exploAmmo', 'beancan', 'satchel', 'rocket', 'c4'];

var RESOURCE_META = {
  sulfur:    { label: 'Azufre',              icon: '🟡' },
  metalFrag: { label: 'Frag. de Metal',      icon: '⚙️' },
  charcoal:  { label: 'Carbón',               icon: '⚫' },
  cloth:     { label: 'Tela',                 icon: '🧵' },
  rope:      { label: 'Cuerda',               icon: '🪢' },
  hqm:       { label: 'Metal de Alta Calidad', icon: '🔩' },
  scrap:     { label: 'Chatarra',             icon: '♻️' },
  animalFat: { label: 'Grasa Animal',         icon: '🥩' },
  techTrash: { label: 'Basura Tecnológica',   icon: '🔧' }
};

var STRUCTURES = [
  { id: 'twig-wall',     name: 'Muro de Ramas',        category: 'Muro',       hp: 10,   needs: { exploAmmo: 1,   beancan: 1,   satchel: 1,  rocket: 1,  c4: 1 } },
  { id: 'wood-wall',     name: 'Muro de Madera',       category: 'Muro',       hp: 250,  needs: { exploAmmo: 49,  beancan: 4,   satchel: 1,  rocket: 1,  c4: 1 } },
  { id: 'wood-door',     name: 'Puerta de Madera',     category: 'Puerta',     hp: 200,  needs: { exploAmmo: 39,  beancan: 3,   satchel: 1,  rocket: 1,  c4: 1 } },
  { id: 'stone-wall',    name: 'Muro de Piedra',       category: 'Muro',       hp: 500,  needs: { exploAmmo: 182, beancan: 46,  satchel: 10, rocket: 4,  c4: 2 } },
  { id: 'metal-wall',    name: 'Muro de Chapa (Metal)',category: 'Muro',       hp: 500,  needs: { exploAmmo: 182, beancan: 46,  satchel: 10, rocket: 4,  c4: 2 } },
  { id: 'metal-door',    name: 'Puerta de Chapa',      category: 'Puerta',     hp: 250,  needs: { exploAmmo: 42,  beancan: 10,  satchel: 3,  rocket: 2,  c4: 1 } },
  { id: 'garage-door',   name: 'Puerta de Garaje',     category: 'Puerta',     hp: 600,  needs: { exploAmmo: 96,  beancan: 24,  satchel: 7,  rocket: 3,  c4: 2 } },
  { id: 'tool-cupboard', name: 'Armario TC',           category: 'Deployable', hp: 300,  needs: { exploAmmo: 110, beancan: 28,  satchel: 6,  rocket: 3,  c4: 2 } },
  { id: 'armored-wall',  name: 'Muro Blindado',        category: 'Muro',       hp: 1000, needs: { exploAmmo: 440, beancan: 180, satchel: 40, rocket: 15, c4: 4 }, approx: true },
  { id: 'armored-door',  name: 'Puerta Blindada',      category: 'Puerta',     hp: 1000, needs: { exploAmmo: 440, beancan: 180, satchel: 40, rocket: 15, c4: 4 }, approx: true }
];

function structureById(id) { return STRUCTURES.find(function(s){ return s.id === id; }); }

function raidRowResources(structureId, explosiveKey, qty) {
  var structure = structureById(structureId);
  var explosive = EXPLOSIVES[explosiveKey];
  var explosiveAmount = Math.ceil(structure.needs[explosiveKey]) * qty;
  var resources = {};
  Object.keys(explosive.craft).forEach(function(res){
    resources[res] = explosive.craft[res] * explosiveAmount;
  });
  return { explosiveAmount: explosiveAmount, resources: resources };
}

function renderRaidStructurePicker() {
  var select = document.getElementById('raid-structure-select');
  select.innerHTML = '';
  STRUCTURES.forEach(function(s){
    var opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name + (s.approx ? ' ⚠️' : '');
    select.appendChild(opt);
  });
}

function renderRaidExplosivePicker() {
  var select = document.getElementById('raid-explosive-select');
  select.innerHTML = '';
  EXPLOSIVE_ORDER.forEach(function(key){
    var opt = document.createElement('option');
    opt.value = key;
    opt.textContent = EXPLOSIVES[key].icon + ' ' + EXPLOSIVES[key].name;
    select.appendChild(opt);
  });
}

function renderRaidCompare() {
  var wrap = document.getElementById('raid-compare');
  wrap.innerHTML = '';
  var structureId = document.getElementById('raid-structure-select').value;
  var structure = structureById(structureId);
  if (!structure) return;

  var costs = EXPLOSIVE_ORDER.map(function(key){
    var r = raidRowResources(structureId, key, 1);
    return { key: key, sulfur: r.resources.sulfur || 0 };
  });
  var minSulfur = Math.min.apply(null, costs.map(function(c){ return c.sulfur; }));

  costs.forEach(function(c){
    var chip = document.createElement('span');
    chip.className = 'raid-compare-chip' + (c.sulfur === minSulfur ? ' is-cheapest' : '');
    chip.innerHTML = EXPLOSIVES[c.key].icon + ' ' + EXPLOSIVES[c.key].name + ': <span class="n">' + structure.needs[c.key] + '</span> uds · <span class="n">' + c.sulfur.toLocaleString('es-ES') + '</span> azufre';
    wrap.appendChild(chip);
  });
}

async function fetchRaid() {
  var data = await api('/raid');
  raidList = data.list;
}

function renderRaidList() {
  var listEl = document.getElementById('raid-list');
  listEl.innerHTML = '';

  if (!raidList.length) {
    var empty = document.createElement('div');
    empty.className = 'raid-empty';
    empty.textContent = 'Tu lista está vacía. Añade arriba lo que necesites reventar.';
    listEl.appendChild(empty);
    renderRaidTotals();
    return;
  }

  raidList.forEach(function(row){
    var structure = structureById(row.structureId);
    var explosive = EXPLOSIVES[row.explosiveKey];
    if (!structure || !explosive) return;
    var calc = raidRowResources(row.structureId, row.explosiveKey, row.qty);

    var rowEl = document.createElement('div');
    rowEl.className = 'raid-row';

    var main = document.createElement('div');
    main.className = 'raid-row-main';
    var amountBadge = document.createElement('span');
    amountBadge.className = 'raid-row-amount';
    amountBadge.textContent = 'x' + row.qty;
    var nameWrap = document.createElement('div');
    var name = document.createElement('div');
    name.className = 'raid-row-name';
    name.innerHTML = structure.name + (structure.approx ? ' <span class="raid-row-approx">⚠️ estimado</span>' : '');
    var method = document.createElement('div');
    method.className = 'raid-row-method';
    method.textContent = explosive.icon + ' ' + explosive.name;
    nameWrap.appendChild(name);
    nameWrap.appendChild(method);
    main.appendChild(amountBadge);
    main.appendChild(nameWrap);

    var explosiveAmount = document.createElement('div');
    explosiveAmount.className = 'raid-row-explosive-amount';
    explosiveAmount.textContent = calc.explosiveAmount + ' × ' + explosive.name;

    var removeBtn = document.createElement('button');
    removeBtn.className = 'raid-row-remove';
    removeBtn.type = 'button';
    removeBtn.title = 'Quitar de la lista';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', async function(){
      try { await api('/raid/' + row.id, { method: 'DELETE' }); } catch (e) { showToast(e.message); return; }
      await fetchRaid();
      renderRaidList();
    });

    rowEl.appendChild(main);
    rowEl.appendChild(explosiveAmount);
    rowEl.appendChild(removeBtn);
    listEl.appendChild(rowEl);
  });

  renderRaidTotals();
}

function renderRaidTotals() {
  var wrap = document.getElementById('raid-totals');
  wrap.innerHTML = '';

  var title = document.createElement('div');
  title.className = 'raid-totals-title';
  title.textContent = '🧮 Recursos totales para fabricar todo';
  wrap.appendChild(title);

  if (!raidList.length) {
    var empty = document.createElement('div');
    empty.className = 'raid-empty';
    empty.style.padding = '0.5rem 0';
    empty.textContent = 'Añade objetivos a la lista para ver el total.';
    wrap.appendChild(empty);
    return;
  }

  var totals = {};
  raidList.forEach(function(row){
    var structure = structureById(row.structureId);
    if (!structure) return;
    var calc = raidRowResources(row.structureId, row.explosiveKey, row.qty);
    Object.keys(calc.resources).forEach(function(res){
      totals[res] = (totals[res] || 0) + calc.resources[res];
    });
  });

  var grid = document.createElement('div');
  grid.className = 'raid-totals-grid';
  Object.keys(totals).forEach(function(res){
    var meta = RESOURCE_META[res];
    var chip = document.createElement('div');
    chip.className = 'raid-resource-chip';
    var amount = document.createElement('div');
    amount.className = 'raid-resource-amount';
    amount.textContent = meta.icon + ' ' + Math.ceil(totals[res]).toLocaleString('es-ES');
    var label = document.createElement('div');
    label.className = 'raid-resource-label';
    label.textContent = meta.label;
    chip.appendChild(amount);
    chip.appendChild(label);
    grid.appendChild(chip);
  });
  wrap.appendChild(grid);
}

function setupRaidCalc() {
  renderRaidStructurePicker();
  renderRaidExplosivePicker();
  renderRaidCompare();
  renderRaidList();

  document.getElementById('raid-structure-select').addEventListener('change', renderRaidCompare);

  document.getElementById('raid-add-btn').addEventListener('click', async function(){
    var structureId = document.getElementById('raid-structure-select').value;
    var explosiveKey = document.getElementById('raid-explosive-select').value;
    var qty = parseInt(document.getElementById('raid-qty-input').value, 10);
    if (!qty || qty < 1) qty = 1;

    try {
      await api('/raid', { method: 'POST', body: { structureId: structureId, explosiveKey: explosiveKey, qty: qty } });
    } catch (e) { showToast(e.message); return; }
    document.getElementById('raid-qty-input').value = 1;
    await fetchRaid();
    renderRaidList();
  });

  document.getElementById('raid-clear-btn').addEventListener('click', async function(){
    try { await api('/raid', { method: 'DELETE' }); } catch (e) { showToast(e.message); return; }
    await fetchRaid();
    renderRaidList();
  });
}

/* ============================================================
   RULETA DE ROLES (solo cliente, no necesita backend)
   ============================================================ */
var ROLE_WHEELS = [
  { id: 'constructor',  label: 'Constructor',  icon: '🔨', accent: '#e6007e' },
  { id: 'electricista', label: 'Electricista', icon: '⚡', accent: '#ffd400' },
  { id: 'huertista',    label: 'Huertista',    icon: '🌱', accent: '#4c9a4c' }
];
// Solo dos colores, alternados: el rosa y el amarillo de la casa.
// Si el número de jugadores es impar, el último gajo usa un rosa
// oscuro para que no queden dos gajos iguales pegados en la unión.
var WHEEL_COLORS = ['#e6007e', '#ffd400'];
var WHEEL_ODD_COLOR = '#9e0057';
var wheelState = {};
// Quién entra en el sorteo (no todos juegan todos los wipes).
// null = aún sin inicializar; se rellena con todos al construir.
var wheelParticipants = null;
var SVG_NS = 'http://www.w3.org/2000/svg';

function wheelMembers() {
  if (!wheelParticipants) return [];
  return USERS
    .filter(function(u){ return wheelParticipants[u.username]; })
    .sort(function(a, b){ return a.alias.localeCompare(b.alias); });
}

function polarToCartesian(cx, cy, r, angleDeg) {
  var rad = (angleDeg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeWheelSlice(cx, cy, r, startAngle, endAngle) {
  var start = polarToCartesian(cx, cy, r, endAngle);
  var end = polarToCartesian(cx, cy, r, startAngle);
  var largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return ['M', cx, cy, 'L', start.x, start.y, 'A', r, r, 0, largeArc, 0, end.x, end.y, 'Z'].join(' ');
}

function drawWheelSlices(roleId) {
  var svg = document.getElementById('wheel-svg-' + roleId);
  if (!svg) return;
  svg.innerHTML = '';

  var members = wheelMembers();
  wheelState[roleId].members = members;
  var n = members.length;
  if (!n) return;

  var sliceAngle = 360 / n;
  var cx = 150, cy = 150, r = 140;

  var group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('id', 'wheel-group-' + roleId);

  members.forEach(function(u, i){
    var startAngle = i * sliceAngle;
    var endAngle = (i + 1) * sliceAngle;

    // Alternamos rosa/amarillo; si el total es impar, el último gajo
    // va en rosa oscuro para que no se junten dos rosas en la costura.
    var fill = WHEEL_COLORS[i % 2];
    if (n % 2 === 1 && n > 1 && i === n - 1) fill = WHEEL_ODD_COLOR;

    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', describeWheelSlice(cx, cy, r, startAngle, endAngle));
    path.setAttribute('fill', fill);
    path.setAttribute('stroke', '#0e0e0f');
    path.setAttribute('stroke-width', '2.5');
    group.appendChild(path);

    // Texto RADIAL (del centro hacia el borde, como las ruletas de
    // verdad): así los nombres no se amontonan y caben más largos.
    var midAngle = startAngle + sliceAngle / 2;
    var labelPos = polarToCartesian(cx, cy, r * 0.93, midAngle);
    var text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', labelPos.x);
    text.setAttribute('y', labelPos.y);
    // Sobre amarillo, texto oscuro; sobre rosa, texto blanco.
    var onYellow = fill === '#ffd400';
    text.setAttribute('fill', onYellow ? '#1c1607' : '#ffffff');
    if (!onYellow) {
      text.setAttribute('stroke', 'rgba(0,0,0,0.45)');
      text.setAttribute('stroke-width', '2');
      text.setAttribute('paint-order', 'stroke');
    }
    text.setAttribute('font-size', n > 10 ? '11' : (n > 6 ? '12.5' : '14'));
    text.setAttribute('font-weight', '700');
    text.setAttribute('text-anchor', 'end');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('letter-spacing', '0.4');
    // Rotamos el texto para que corra a lo largo del radio del gajo.
    text.setAttribute('transform', 'rotate(' + (midAngle - 90) + ' ' + labelPos.x + ' ' + labelPos.y + ')');
    text.textContent = u.alias.length > 16 ? u.alias.slice(0, 15) + '…' : u.alias;
    group.appendChild(text);
  });

  group.style.transformOrigin = '150px 150px';
  group.style.transform = 'rotate(' + wheelState[roleId].rotation + 'deg)';
  svg.appendChild(group);

  // Hub central: va FUERA del grupo que gira, para que el icono
  // del rol se quede siempre derecho y legible.
  var hub = document.createElementNS(SVG_NS, 'circle');
  hub.setAttribute('cx', cx); hub.setAttribute('cy', cy); hub.setAttribute('r', 22);
  hub.setAttribute('fill', '#18171a');
  hub.setAttribute('stroke', 'var(--wheel-accent, #ffd400)');
  hub.setAttribute('stroke-width', '3');
  svg.appendChild(hub);

  var hubIcon = document.createElementNS(SVG_NS, 'text');
  hubIcon.setAttribute('x', cx);
  hubIcon.setAttribute('y', cy);
  hubIcon.setAttribute('text-anchor', 'middle');
  hubIcon.setAttribute('dominant-baseline', 'central');
  hubIcon.setAttribute('font-size', '20');
  hubIcon.textContent = wheelState[roleId].icon || '🎯';
  svg.appendChild(hubIcon);
}

function burstConfetti(container, accent) {
  if (!container) return;
  container.innerHTML = '';
  var colors = [accent, '#ffd400', '#ffffff', '#e6007e'];
  var count = 20;
  for (var i = 0; i < count; i++) {
    var piece = document.createElement('span');
    piece.className = 'confetti-piece';
    var angle = Math.random() * Math.PI * 2;
    var dist = 55 + Math.random() * 65;
    var tx = Math.cos(angle) * dist;
    var ty = Math.sin(angle) * dist - 25; // sesgo hacia arriba, más "explosión"
    piece.style.setProperty('--tx', tx.toFixed(0) + 'px');
    piece.style.setProperty('--ty', ty.toFixed(0) + 'px');
    piece.style.setProperty('--rot', (Math.random() * 540 - 270).toFixed(0) + 'deg');
    piece.style.background = colors[i % colors.length];
    piece.style.animationDelay = (Math.random() * 0.12).toFixed(2) + 's';
    container.appendChild(piece);
  }
  clearTimeout(container._cleanupTimeout);
  container._cleanupTimeout = setTimeout(function(){ container.innerHTML = ''; }, 1300);
}

function spinWheel(roleId) {
  var state = wheelState[roleId];
  if (!state || state.spinning) return;
  var members = state.members;
  var n = members.length;
  if (n < 2) {
    showToast('Marca al menos a 2 jugadores en "¿Quién juega este wipe?" para poder sortear.');
    return;
  }

  state.spinning = true;
  var spinBtn = document.getElementById('spin-btn-' + roleId);
  if (spinBtn) spinBtn.disabled = true;

  var wheelWrapEl = document.getElementById('wheel-wrap-' + roleId);
  if (wheelWrapEl) wheelWrapEl.classList.add('is-spinning');

  var resultEl = document.getElementById('wheel-result-' + roleId);
  resultEl.textContent = 'Girando…';
  resultEl.classList.remove('has-winner');

  var winnerIndex = Math.floor(Math.random() * n);
  var sliceAngle = 360 / n;
  var targetCenterAngle = winnerIndex * sliceAngle + sliceAngle / 2;
  var neededAngleInTurn = (360 - targetCenterAngle) % 360;

  var baseFullTurns = Math.floor(state.rotation / 360) * 360;
  var newRotation = baseFullTurns + 360 * 5 + neededAngleInTurn;
  while (newRotation <= state.rotation) newRotation += 360;
  state.rotation = newRotation;

  var group = document.getElementById('wheel-group-' + roleId);
  group.style.transition = 'transform 4.2s cubic-bezier(0.15, 0.75, 0.15, 1)';
  group.style.transform = 'rotate(' + newRotation + 'deg)';

  clearTimeout(state.timeoutId);
  state.timeoutId = setTimeout(function(){
    state.spinning = false;
    if (spinBtn) spinBtn.disabled = false;
    if (wheelWrapEl) wheelWrapEl.classList.remove('is-spinning');
    var winner = members[winnerIndex];
    resultEl.textContent = '🏆 ' + winner.alias;
    resultEl.classList.add('has-winner');
    burstConfetti(document.getElementById('confetti-' + roleId), state.accent);
  }, 4300);
}

// Selector de "¿quién juega este wipe?": chips con cada miembro.
// Al tocar un chip entra/sale de todas las ruletas a la vez.
function renderWheelRoster() {
  var box = document.getElementById('roles-roster');
  if (!box) return;

  // Primera vez (o si han aparecido miembros nuevos): todos dentro.
  if (!wheelParticipants) wheelParticipants = {};
  USERS.forEach(function(u){
    if (!(u.username in wheelParticipants)) wheelParticipants[u.username] = true;
  });

  box.innerHTML = '';

  var label = document.createElement('div');
  label.className = 'roles-roster-label';
  label.textContent = '👥 ¿Quién juega este wipe?';
  box.appendChild(label);

  var chips = document.createElement('div');
  chips.className = 'roles-roster-chips';

  USERS.slice().sort(function(a,b){ return a.alias.localeCompare(b.alias); }).forEach(function(u){
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'roster-chip' + (wheelParticipants[u.username] ? ' active' : '');
    chip.textContent = u.alias;
    chip.setAttribute('aria-pressed', wheelParticipants[u.username] ? 'true' : 'false');
    chip.addEventListener('click', function(){
      wheelParticipants[u.username] = !wheelParticipants[u.username];
      chip.classList.toggle('active', wheelParticipants[u.username]);
      chip.setAttribute('aria-pressed', wheelParticipants[u.username] ? 'true' : 'false');
      redrawIdleWheels();
      renderWheelRosterCount();
    });
    chips.appendChild(chip);
  });

  box.appendChild(chips);

  var count = document.createElement('div');
  count.className = 'roles-roster-count';
  count.id = 'roles-roster-count';
  box.appendChild(count);
  renderWheelRosterCount();
}

function renderWheelRosterCount() {
  var el = document.getElementById('roles-roster-count');
  if (!el) return;
  var n = wheelMembers().length;
  if (n === 0) el.textContent = 'Nadie en la ruleta — marca a los que jueguen.';
  else if (n === 1) el.textContent = 'Solo 1 en la ruleta — hacen falta al menos 2 para sortear.';
  else el.textContent = n + ' jugadores en la ruleta.';
}

function buildWheelsUI() {
  var wrap = document.getElementById('roles-wheels');
  if (!wrap) return;
  wrap.innerHTML = '';

  ROLE_WHEELS.forEach(function(role){
    wheelState[role.id] = { rotation: 0, spinning: false, members: [], timeoutId: null, icon: role.icon, accent: role.accent };

    var card = document.createElement('div');
    card.className = 'wheel-card';
    card.style.setProperty('--wheel-accent', role.accent);

    var title = document.createElement('h2');
    title.className = 'wheel-title';
    title.textContent = role.icon + ' ' + role.label;

    var wheelWrap = document.createElement('div');
    wheelWrap.className = 'wheel-wrap';
    wheelWrap.id = 'wheel-wrap-' + role.id;

    var glow = document.createElement('div');
    glow.className = 'wheel-glow';

    var pointer = document.createElement('div');
    pointer.className = 'wheel-pointer';

    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('id', 'wheel-svg-' + role.id);
    svg.setAttribute('class', 'wheel-svg');
    svg.setAttribute('viewBox', '0 0 300 300');

    wheelWrap.appendChild(glow);
    wheelWrap.appendChild(svg);
    wheelWrap.appendChild(pointer);

    var btn = document.createElement('button');
    btn.className = 'btn wheel-spin-btn';
    btn.type = 'button';
    btn.id = 'spin-btn-' + role.id;
    btn.textContent = '🎲 Girar';
    btn.addEventListener('click', function(){ spinWheel(role.id); });

    var result = document.createElement('div');
    result.className = 'wheel-result';
    result.id = 'wheel-result-' + role.id;
    result.textContent = 'Pulsa girar para elegir';

    var confetti = document.createElement('div');
    confetti.className = 'confetti-layer';
    confetti.id = 'confetti-' + role.id;

    card.appendChild(title);
    card.appendChild(wheelWrap);
    card.appendChild(btn);
    card.appendChild(result);
    card.appendChild(confetti);
    wrap.appendChild(card);

    drawWheelSlices(role.id);
  });
}

function redrawIdleWheels() {
  ROLE_WHEELS.forEach(function(role){
    if (wheelState[role.id] && !wheelState[role.id].spinning) drawWheelSlices(role.id);
  });
}

function refreshWheelsIfIdle() {
  renderWheelRoster();
  redrawIdleWheels();
}

function setupRoles() {
  renderWheelRoster();
  buildWheelsUI();
}

/* ============================================================
   TAQUILLA (perfil propio)
   ============================================================ */
function renderLocker() {
  if (!currentUser) return;
  var card = document.getElementById('locker-card');
  card.className = 'locker-card' + (isGru(currentUser) ? ' is-leader' : '');

  var avatarEl = document.getElementById('locker-avatar');
  avatarEl.innerHTML = '';
  if (currentUser.avatar) {
    var img = document.createElement('img');
    img.src = currentUser.avatar; img.alt = currentUser.alias;
    avatarEl.appendChild(img);
  } else {
    avatarEl.textContent = initialsOf(currentUser.alias);
  }

  document.getElementById('locker-alias-display').textContent = currentUser.alias;

  var badge = document.getElementById('rank-badge');
  var meta = roleMeta(currentUser);
  badge.textContent = roleLabel(currentUser);
  badge.className = 'rank-badge' + (meta.badgeClass ? ' ' + meta.badgeClass : '');

  document.getElementById('edit-alias').value = currentUser.alias;
  document.getElementById('edit-username').value = currentUser.username;
  document.getElementById('edit-password').value = '';
  document.getElementById('edit-steamid').value = currentUser.steamId || '';
  document.getElementById('edit-email').value = currentUser.email || '';
}

function setupLocker() {
  var avatarInput = document.getElementById('avatar-input');
  document.getElementById('avatar-edit-btn').addEventListener('click', function(){
    avatarInput.click();
  });
  avatarInput.addEventListener('change', function(e){
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = async function(ev){
      try {
        await api('/users/me', { method: 'PATCH', body: {
          alias: currentUser.alias, username: currentUser.username, steamId: currentUser.steamId || '', email: currentUser.email || '', avatar: ev.target.result
        } });
      } catch (err) { showToast(err.message); return; }
      currentUser.avatar = ev.target.result;
      renderLocker();
      await fetchUsers();
      if (document.getElementById('view-inicio').classList.contains('active')) renderMembers();
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('save-locker-btn').addEventListener('click', async function(){
    var newAlias = document.getElementById('edit-alias').value.trim();
    var newUsername = document.getElementById('edit-username').value.trim();
    var newPassword = document.getElementById('edit-password').value;
    var newSteamId = document.getElementById('edit-steamid').value.trim();
    var newEmail = document.getElementById('edit-email').value.trim();

    if (!newAlias) { showToast('El alias no puede estar vacío.'); return; }
    if (!newUsername) { showToast('El usuario no puede estar vacío.'); return; }
    if (newSteamId && !/^\d{15,20}$/.test(newSteamId)) {
      showToast('La SteamID64 debe ser un número de entre 15 y 20 dígitos (ej: 76561198012345678). Puedes dejarla vacía si no la tienes a mano.');
      return;
    }
    if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      showToast('Ese email no parece válido.');
      return;
    }

    var body = { alias: newAlias, username: newUsername, steamId: newSteamId, email: newEmail };
    if (newPassword) body.password = newPassword;

    try {
      var data = await api('/users/me', { method: 'PATCH', body: body });
      currentUser = data.user;
    } catch (err) { showToast(err.message); return; }

    document.getElementById('user-alias').textContent = currentUser.alias;
    document.getElementById('user-role').textContent = isGru(currentUser) ? 'Líder · Gru' : currentUser.role;
    renderLocker();
    await fetchUsers();
    renderMembers();
    if (document.getElementById('view-zerg').classList.contains('active')) renderOrgchart();
    if (document.getElementById('view-stats').classList.contains('active')) renderStatsPanel();

    var fb = document.getElementById('save-feedback');
    fb.classList.add('visible');
    setTimeout(function(){ fb.classList.remove('visible'); }, 2500);
  });
}

/* ============================================================
   NAVEGACIÓN DE PESTAÑAS
   ============================================================ */
function setupNav() {
  var tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(function(tab){
    tab.addEventListener('click', async function(){
      var view = tab.getAttribute('data-view');
      tabs.forEach(function(t){ t.classList.remove('active'); });
      tab.classList.add('active');
      document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('active'); });
      document.getElementById('view-' + view).classList.add('active');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

      if (view === 'inicio') { await fetchWipeSignups(); await fetchPoints(); renderFaults(); }
      if (view === 'taquilla') renderLocker();
      if (view === 'zerg') renderOrgchart();
      if (view === 'wipes') { wipeWeekOffset = 0; await fetchWipeSignups(); renderWipes(); }
      if (view === 'stats') renderStatsPanel();
      if (view === 'enemigos') {
        await Promise.all([fetchEnemies(), fetchEnemyTeams(), fetchServerSettings()]);
        renderEnemyTeamSelect();
        renderEnemiesBmBox();
        renderEnemiesPanel();
        refreshEnemiesStatus();
        startEnemiesAutoRefresh();
      } else {
        stopEnemiesAutoRefresh();
      }
      if (view === 'roles') refreshWheelsIfIdle();
    });
  });
}

/* ============================================================
   ORGANIGRAMA ZERG
   ============================================================ */
function makeTierMember(u) {
  var wrap = document.createElement('div');
  wrap.className = 'org-tier-member';

  var avatar = document.createElement('div');
  avatar.className = 'org-tier-avatar';
  if (u.avatar) {
    var img = document.createElement('img');
    img.src = u.avatar; img.alt = u.alias;
    avatar.appendChild(img);
  } else {
    avatar.textContent = initialsOf(u.alias);
  }

  var name = document.createElement('div');
  name.className = 'org-tier-name';
  name.textContent = u.alias;

  wrap.appendChild(avatar);
  wrap.appendChild(name);
  return wrap;
}

function buildTierNodes(def) {
  var users = USERS.filter(function(u){ return u.role === def.role; })
                    .sort(function(a,b){ return a.alias.localeCompare(b.alias); });

  var childLis = [];
  def.children.forEach(function(childDef){
    childLis = childLis.concat(buildTierNodes(childDef));
  });

  if (users.length === 0) return childLis;

  var meta = ROLE_META[def.role] || ROLE_META['Minion menaje'];
  var li = document.createElement('li');

  var tier = document.createElement('div');
  tier.className = 'org-tier role-' + meta.slug;

  var label = document.createElement('div');
  label.className = 'org-tier-label';
  label.textContent = meta.icon + ' ' + def.role;
  tier.appendChild(label);

  var membersWrap = document.createElement('div');
  membersWrap.className = 'org-tier-members';
  users.forEach(function(u){ membersWrap.appendChild(makeTierMember(u)); });
  tier.appendChild(membersWrap);

  li.appendChild(tier);

  if (childLis.length) {
    var ul = document.createElement('ul');
    childLis.forEach(function(cli){ ul.appendChild(cli); });
    li.appendChild(ul);
  }

  return [li];
}

function renderOrgchart() {
  var chart = document.getElementById('orgchart');
  chart.innerHTML = '';

  var rootLis = buildTierNodes(ROLE_HIERARCHY);

  if (!rootLis.length) {
    var empty = document.createElement('div');
    empty.className = 'org-empty-note';
    empty.textContent = 'Todavía no hay nadie con rango asignado.';
    chart.appendChild(empty);
    return;
  }

  var tree = document.createElement('ul');
  tree.className = 'org-tree';
  rootLis.forEach(function(li){ tree.appendChild(li); });
  chart.appendChild(tree);
}

/* ============================================================
   WIPES — calendario + apuntes (persistidos en el servidor)
   ============================================================ */
var WIPE_TYPES = {
  monday:  { label: 'Monday',  icon: '🌙', startDow: 1, days: 3, accent: '#8a5a3a' },
  normal:  { label: 'Thursday', icon: '🔥', startDow: 4, days: 4, accent: '#e6007e' },
  friday:  { label: 'Friday',  icon: '🌅', startDow: 5, days: 3, accent: '#ffd400' },
  forzado: { label: 'Forzado', icon: '⭐', startDow: 4, days: 4, accent: '#ff4d4d' }
};

var wipeWeekOffset = 0;
var MAX_WEEKS_AHEAD = 2;

function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
function isFirstThursdayOfMonth(date) { return date.getDay() === 4 && date.getDate() <= 7; }
function wipeId(typeKey, startDate) { return typeKey + '_' + startDate.toISOString().slice(0, 10); }

function wipesForWeek(monday) {
  var wipes = [];
  var dayConfigs = [
    { offset: 0, typeKey: 'monday' },
    { offset: 3, typeKey: null },
    { offset: 4, typeKey: 'friday' }
  ];

  dayConfigs.forEach(function(dc){
    var start = addDays(monday, dc.offset);
    var typeKey = dc.typeKey;
    if (typeKey === null) {
      typeKey = isFirstThursdayOfMonth(start) ? 'forzado' : 'normal';
    }
    var cfg = WIPE_TYPES[typeKey];
    var end = addDays(start, cfg.days - 1);
    wipes.push({ id: wipeId(typeKey, start), typeKey: typeKey, label: cfg.label, icon: cfg.icon, accent: cfg.accent, days: cfg.days, start: start, end: end });
  });

  return wipes;
}

function fmtDate(d) { return DAY_NAMES[d.getDay()] + ' ' + d.getDate() + ' ' + MONTH_NAMES[d.getMonth()]; }

function mondayOfWeek(d) {
  var x = startOfDay(d);
  var dow = x.getDay();
  var diff = (dow === 0 ? -6 : 1 - dow);
  return addDays(x, diff);
}

async function fetchWipeSignups() {
  var data = await api('/wipes/signups');
  wipeSignups = data.signups || {};
}

function getSignups(id) {
  if (!wipeSignups[id]) wipeSignups[id] = { trios: [], main: [] };
  return wipeSignups[id];
}

function userByUsername(username) {
  return USERS.find(function(u){ return u.username === username; });
}

async function toggleSignup(id, modality) {
  if (!currentUser) return;
  try {
    var data = await api('/wipes/' + encodeURIComponent(id) + '/signup', { method: 'POST', body: { modality: modality } });
    wipeSignups[id] = data.signups;
  } catch (e) {
    if (e.data && e.data.signups) wipeSignups[id] = e.data.signups;
    else { showToast(e.message); return; }
  }
  renderWipes();
  renderFaults(); // los apuntados cambian → el tribunal también
}

function makeMiniAvatar(u) {
  var av = document.createElement('span');
  av.className = 'mini-avatar';
  if (u && u.avatar) {
    var img = document.createElement('img');
    img.src = u.avatar; img.alt = u.alias;
    av.appendChild(img);
  } else {
    av.textContent = u ? initialsOf(u.alias) : '?';
  }
  return av;
}

function buildModality(wipe, modality, isFinished) {
  var s = getSignups(wipe.id);
  var list = s[modality];
  var isTrios = modality === 'trios';
  var me = currentUser ? currentUser.username : null;
  var iAmIn = me && list.indexOf(me) !== -1;

  var box = document.createElement('div');
  box.className = 'modality' + (isTrios && list.length >= 3 ? ' is-full' : '');

  var head = document.createElement('div');
  head.className = 'modality-head';
  var name = document.createElement('div');
  name.className = 'modality-name';
  name.innerHTML = (isTrios ? '👥 Tríos' : '🌍 Main');
  var count = document.createElement('div');
  count.className = 'modality-count' + (isTrios && list.length >= 3 ? ' full' : '');
  count.textContent = isTrios ? (list.length + '/3') : (list.length + ' apuntados');
  head.appendChild(name); head.appendChild(count);
  box.appendChild(head);

  var listEl = document.createElement('div');
  listEl.className = 'signup-list';
  if (list.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'signup-empty';
    empty.textContent = 'Nadie todavía · ¡sé el primero! 🙋';
    listEl.appendChild(empty);
  } else {
    list.forEach(function(username, i){
      var u = userByUsername(username);
      var row = document.createElement('div');
      row.className = 'signup-row' + (username === me ? ' is-me' : '');
      row.appendChild(makeMiniAvatar(u));
      var nm = document.createElement('span');
      nm.textContent = u ? u.alias : username;
      row.appendChild(nm);
      if (isTrios) {
        var num = document.createElement('span');
        num.className = 'trio-num';
        num.textContent = '#' + (i + 1);
        row.appendChild(num);
      }
      listEl.appendChild(row);
    });
  }
  box.appendChild(listEl);

  var btn = document.createElement('button');
  btn.className = 'modality-btn' + (iAmIn ? ' joined' : '');
  if (isFinished) {
    btn.textContent = iAmIn ? 'Jugado' : 'Finalizado';
    btn.disabled = true;
  } else if (iAmIn) {
    btn.textContent = 'Quitarme';
  } else if (isTrios && list.length >= 3) {
    btn.textContent = 'Trío completo';
    btn.disabled = true;
  } else {
    btn.textContent = 'Apuntarme';
  }
  if (!isFinished) {
    btn.addEventListener('click', function(){ toggleSignup(wipe.id, modality); });
  }
  box.appendChild(btn);

  return box;
}

function buildWipeCard(wipe) {
  var today = startOfDay(new Date());
  var isActive = wipe.start <= today && today <= wipe.end;
  var isFinished = today > wipe.end;
  var msPerDay = 24 * 60 * 60 * 1000;

  var card = document.createElement('div');
  card.className = 'wipe-card' + (isFinished ? ' is-finished' : '') + (isActive ? ' is-active' : '');
  card.style.setProperty('--wipe-accent', wipe.accent);

  var head = document.createElement('div');
  head.className = 'wipe-card-head';

  var left = document.createElement('div');
  var titleRow = document.createElement('div');
  titleRow.className = 'wipe-title-row';
  var type = document.createElement('span');
  type.className = 'wipe-type';
  type.textContent = (wipe.icon ? wipe.icon + ' ' : '') + wipe.label;
  titleRow.appendChild(type);
  if (wipe.typeKey === 'forzado') {
    var star = document.createElement('span');
    star.className = 'wipe-forzado-star';
    star.textContent = 'Mensual';
    star.style.color = wipe.accent;
    star.style.fontFamily = 'var(--font-mono)';
    star.style.fontSize = '0.62rem';
    star.style.letterSpacing = '0.08em';
    titleRow.appendChild(star);
  }
  left.appendChild(titleRow);

  var dates = document.createElement('div');
  dates.className = 'wipe-dates';
  dates.innerHTML = fmtDate(wipe.start) + ' → ' + fmtDate(wipe.end) +
    ' <span class="duration">· ' + wipe.days + ' días</span>';
  left.appendChild(dates);

  var countdown = document.createElement('div');
  countdown.className = 'wipe-countdown';
  if (isActive) {
    var daysLeft = Math.round((wipe.end - today) / msPerDay);
    countdown.textContent = daysLeft <= 0 ? 'Termina hoy' : ('Termina en ' + daysLeft + ' día' + (daysLeft === 1 ? '' : 's'));
  } else if (!isFinished) {
    var daysToStart = Math.round((wipe.start - today) / msPerDay);
    countdown.textContent = daysToStart <= 0 ? 'Empieza hoy' : ('Empieza en ' + daysToStart + ' día' + (daysToStart === 1 ? '' : 's'));
  }
  if (countdown.textContent) left.appendChild(countdown);

  head.appendChild(left);

  var status = document.createElement('span');
  var statusClass = isFinished ? 'finished' : (isActive ? 'active' : 'upcoming');
  status.className = 'wipe-status ' + statusClass;
  status.textContent = isFinished ? 'Finalizado' : (isActive ? 'En curso' : 'Próximo');
  head.appendChild(status);
  card.appendChild(head);

  var modalities = document.createElement('div');
  modalities.className = 'wipe-modalities';
  modalities.appendChild(buildModality(wipe, 'trios', isFinished));
  modalities.appendChild(buildModality(wipe, 'main', isFinished));
  card.appendChild(modalities);

  return card;
}

function renderWipesLegend() {
  var legend = document.getElementById('wipes-legend');
  legend.innerHTML = '';
  Object.keys(WIPE_TYPES).forEach(function(k){
    var cfg = WIPE_TYPES[k];
    var item = document.createElement('div');
    item.className = 'legend-item';
    var dot = document.createElement('span');
    dot.className = 'legend-dot';
    dot.style.background = cfg.accent;
    item.appendChild(dot);
    var txt = document.createElement('span');
    txt.textContent = cfg.icon + ' ' + cfg.label + ' (' + cfg.days + 'd)';
    item.appendChild(txt);
    legend.appendChild(item);
  });
}

function changeWipeWeek(delta) {
  var next = wipeWeekOffset + delta;
  if (next < 0) next = 0;
  if (next > MAX_WEEKS_AHEAD) next = MAX_WEEKS_AHEAD;
  wipeWeekOffset = next;
  renderWipes();
}

function renderWipes() {
  renderWipesLegend();
  var listEl = document.getElementById('wipes-list');
  listEl.innerHTML = '';

  var currentMonday = mondayOfWeek(new Date());
  if (wipeWeekOffset < 0) wipeWeekOffset = 0;
  if (wipeWeekOffset > MAX_WEEKS_AHEAD) wipeWeekOffset = MAX_WEEKS_AHEAD;
  var targetMonday = addDays(currentMonday, wipeWeekOffset * 7);
  var sunday = addDays(targetMonday, 6);

  var nav = document.createElement('div');
  nav.className = 'week-nav';

  var prevBtn = document.createElement('button');
  prevBtn.className = 'week-nav-btn';
  prevBtn.innerHTML = '‹';
  prevBtn.title = 'Semana anterior';
  prevBtn.disabled = (wipeWeekOffset === 0);
  prevBtn.addEventListener('click', function(){ changeWipeWeek(-1); });

  var info = document.createElement('div');
  info.className = 'week-nav-info';
  var weekTag = wipeWeekOffset === 0 ? 'Semana en curso'
    : (wipeWeekOffset === 1 ? 'Semana que viene' : 'En ' + wipeWeekOffset + ' semanas');
  info.innerHTML = '<span class="week-nav-tag">' + weekTag + '</span>' +
    '<span class="week-nav-range">' + targetMonday.getDate() + ' ' + MONTH_NAMES[targetMonday.getMonth()] +
    ' – ' + sunday.getDate() + ' ' + MONTH_NAMES[sunday.getMonth()] + '</span>';

  var nextBtn = document.createElement('button');
  nextBtn.className = 'week-nav-btn';
  nextBtn.innerHTML = '›';
  nextBtn.title = 'Semana siguiente';
  nextBtn.disabled = (wipeWeekOffset >= MAX_WEEKS_AHEAD);
  nextBtn.addEventListener('click', function(){ changeWipeWeek(1); });

  nav.appendChild(prevBtn);
  nav.appendChild(info);
  nav.appendChild(nextBtn);
  listEl.appendChild(nav);

  var dots = document.createElement('div');
  dots.className = 'week-dots';
  for (var i = 0; i <= MAX_WEEKS_AHEAD; i++) {
    var dot = document.createElement('span');
    dot.className = 'week-dot' + (i === wipeWeekOffset ? ' active' : '');
    (function(idx){ dot.addEventListener('click', function(){ wipeWeekOffset = idx; renderWipes(); }); })(i);
    dots.appendChild(dot);
  }
  listEl.appendChild(dots);

  var wipes = wipesForWeek(targetMonday);
  var weekBlock = document.createElement('div');
  weekBlock.className = 'wipes-week';
  wipes.forEach(function(w){ weekBlock.appendChild(buildWipeCard(w)); });
  listEl.appendChild(weekBlock);
}

/* ============================================================
   AMONESTACIONES Y MÉRITOS — puntos por wipe, en Inicio
   ============================================================ */
var FAULT_LIMIT = 10;
var MERIT_LIMIT = 10;
var pointRows = []; // {id, wipeId, username, kind, weight, reportedBy, appealStatus, appealText, ts}

async function fetchPoints() {
  try {
    var data = await api('/points');
    pointRows = data.points || [];
  } catch (e) {
    pointRows = [];
  }
}

// Lista (sin repetidos) de apuntados a un wipe, sumando tríos y main.
function signedUpUsers(wipeIdVal) {
  var s = wipeSignups[wipeIdVal];
  if (!s) return [];
  var seen = {};
  var out = [];
  (s.trios || []).concat(s.main || []).forEach(function(u){
    if (!seen[u]) { seen[u] = true; out.push(u); }
  });
  return out;
}

// Elige el wipe que se está "valorando":
//  1º el wipe EN CURSO con gente apuntada,
//  2º si no hay ninguno en curso, el próximo con MÁS gente apuntada
//     (en caso de empate, el más cercano en el calendario).
function pickSanctionWipe() {
  var today = startOfDay(new Date());
  var monday = mondayOfWeek(new Date());
  var candidates = [];
  for (var w = 0; w <= MAX_WEEKS_AHEAD; w++) {
    wipesForWeek(addDays(monday, w * 7)).forEach(function(wipe){
      if (today > wipe.end) return; // finalizado: ya no se valora
      var people = signedUpUsers(wipe.id);
      if (!people.length) return;
      candidates.push({
        wipe: wipe,
        people: people,
        active: (wipe.start <= today && today <= wipe.end)
      });
    });
  }
  if (!candidates.length) return null;
  candidates.sort(function(a, b){
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (b.people.length !== a.people.length) return b.people.length - a.people.length;
    return a.wipe.start - b.wipe.start;
  });
  return candidates[0];
}

var POINT_LABELS = {
  falta:  { 1: 'falta leve', 2: 'falta GRAVE' },
  merito: { 1: 'mérito', 2: 'HAZAÑA' }
};

async function afterPointsMutation(data) {
  pointRows = data.points || [];
  var change = data.demoted || data.promoted;
  if (change) {
    var isUp = !!data.promoted;
    showToast((isUp ? '🏅 ' : '⚖️ ') + change.alias + (isUp
      ? ' ha acumulado ' + MERIT_LIMIT + ' méritos: ¡asciende a ' + change.to + '!'
      : ' ha llegado a ' + FAULT_LIMIT + ' faltas: degradado a ' + change.to), 'success');
    await fetchUsers();
    renderMembers();
    await fetchBoard();
    renderBoard();
    if (currentUser && change.username === currentUser.username) {
      currentUser.role = change.to;
      document.getElementById('user-role').textContent = currentUser.role;
    }
    if (document.getElementById('view-zerg').classList.contains('active')) renderOrgchart();
  }
  renderFaults();
}

async function addPoint(wipeIdVal, username, kind, weight) {
  var u = userByUsername(username);
  var who = u ? u.alias : username;
  var label = POINT_LABELS[kind][weight];
  if (weight === 2 && !window.confirm('¿Poner una ' + label + ' (2 puntos) a ' + who + '?')) return;
  try {
    var data = await api('/points', { method: 'POST', body: { wipeId: wipeIdVal, username: username, kind: kind, weight: weight } });
    await afterPointsMutation(data);
  } catch (e) {
    showToast(e.message);
  }
}

async function removePoint(pointId) {
  try {
    var data = await api('/points/' + pointId, { method: 'DELETE' });
    pointRows = data.points || [];
    renderFaults();
  } catch (e) { showToast(e.message); }
}

async function clearPoints(wipeIdVal, username, kind) {
  var u = userByUsername(username);
  var who = u ? u.alias : username;
  var what = kind === 'falta' ? 'las faltas' : 'los méritos';
  if (!window.confirm('¿Quitar TODOS ' + what + ' de ' + who + ' en este wipe?')) return;
  try {
    var data = await api('/wipes/' + encodeURIComponent(wipeIdVal) + '/points/' + encodeURIComponent(username) + '/' + kind, { method: 'DELETE' });
    pointRows = data.points || [];
    renderFaults();
  } catch (e) { showToast(e.message); }
}

async function appealFault(p) {
  if (p.appealStatus === 'pendiente') { showToast('Esa falta ya tiene una apelación pendiente.', 'success'); return; }
  if (p.appealStatus === 'rechazada') { showToast('Esa apelación ya fue rechazada: no hay segunda oportunidad.'); return; }
  var text = window.prompt('⚖️ Apelación ante Gru — ¿por qué es injusta esta falta? (máx. 280 caracteres)');
  if (text === null) return;
  text = text.trim();
  if (!text) { showToast('Tienes que dar un motivo para apelar.'); return; }
  try {
    var data = await api('/points/' + p.id + '/appeal', { method: 'POST', body: { text: text } });
    pointRows = data.points || [];
    showToast('Apelación enviada. Gru dictará sentencia. ⚖️', 'success');
    renderFaults();
  } catch (e) { showToast(e.message); }
}

async function resolveAppeal(pointId, accept) {
  try {
    var data = await api('/points/' + pointId + '/appeal/resolve', { method: 'POST', body: { accept: accept } });
    pointRows = data.points || [];
    showToast(accept ? 'Apelación aceptada: falta retirada.' : 'Apelación rechazada. La ley es la ley.', 'success');
    renderFaults();
  } catch (e) { showToast(e.message); }
}

function pointChipFace(p) {
  if (p.kind === 'merito') return p.weight === 2 ? '🌟' : '🟩';
  return p.weight === 2 ? '🟥' : '🟨';
}

function buildPointsMeter(total, limit, kind) {
  var meter = document.createElement('div');
  meter.className = 'fault-meter';
  var icon = document.createElement('span');
  icon.className = 'fault-meter-icon';
  icon.textContent = kind === 'falta' ? '⚖️' : '🏅';
  icon.title = kind === 'falta' ? 'Faltas (a ' + limit + ' se baja de rango)' : 'Méritos (a ' + limit + ' se sube de rango)';
  var count = document.createElement('span');
  count.className = 'fault-count';
  count.textContent = total + '/' + limit;
  var barWrap = document.createElement('span');
  barWrap.className = 'fault-bar';
  var bar = document.createElement('span');
  bar.className = 'fault-bar-fill' + (kind === 'merito' ? ' is-merit' : '');
  bar.style.width = Math.min(100, (total / limit) * 100) + '%';
  barWrap.appendChild(bar);
  meter.appendChild(icon);
  meter.appendChild(count);
  meter.appendChild(barWrap);
  return meter;
}

function buildPointChips(points, iAmGru, isMine) {
  var chips = document.createElement('div');
  chips.className = 'fault-chips';
  points.forEach(function(p){
    var clickable = iAmGru || (isMine && p.kind === 'falta');
    var chip = document.createElement(clickable ? 'button' : 'span');
    chip.className = 'fault-chip is-' + p.kind + (p.appealStatus === 'pendiente' ? ' is-appealed' : '');
    var by = p.reportedBy ? (userByUsername(p.reportedBy) || { alias: p.reportedBy }).alias : '?';
    chip.textContent = pointChipFace(p) + (p.appealStatus === 'pendiente' ? '⚖️' : '');
    var label = POINT_LABELS[p.kind][p.weight] + ' · puesta por ' + by;
    if (p.appealStatus === 'pendiente') label += ' · APELADA (pendiente de Gru)';
    if (p.appealStatus === 'rechazada') label += ' · apelación rechazada';
    if (iAmGru) label += ' · pulsa para quitarla';
    else if (isMine && p.kind === 'falta' && !p.appealStatus) label += ' · pulsa para APELAR';
    chip.title = label;
    if (clickable) {
      chip.type = 'button';
      if (iAmGru) chip.addEventListener('click', function(){ removePoint(p.id); });
      else chip.addEventListener('click', function(){ appealFault(p); });
    }
    chips.appendChild(chip);
  });
  return chips;
}

function renderFaults() {
  var panel = document.getElementById('faults-panel');
  if (!panel) return;
  panel.innerHTML = '';

  var pick = pickSanctionWipe();
  if (!pick) {
    var empty = document.createElement('div');
    empty.className = 'faults-empty';
    empty.textContent = 'No hay ningún wipe con gente apuntada. Apuntaos en la pestaña Wipes para activar el tribunal. ⚖️';
    panel.appendChild(empty);
    return;
  }

  var wipe = pick.wipe;
  var iAmGru = currentUser && isGru(currentUser);

  // Cabecera: qué wipe se está valorando (para que no haya confusión)
  var head = document.createElement('div');
  head.className = 'faults-head';
  head.style.setProperty('--wipe-accent', wipe.accent);
  var headTitle = document.createElement('div');
  headTitle.className = 'faults-wipe-name';
  headTitle.textContent = (wipe.icon ? wipe.icon + ' ' : '') + 'Wipe ' + wipe.label;
  var headDates = document.createElement('div');
  headDates.className = 'faults-wipe-dates';
  headDates.textContent = fmtDate(wipe.start) + ' → ' + fmtDate(wipe.end) + (pick.active ? ' · En curso' : ' · Próximo');
  head.appendChild(headTitle);
  head.appendChild(headDates);
  panel.appendChild(head);

  // Apelaciones pendientes (solo las ve y resuelve Gru)
  if (iAmGru) {
    var pending = pointRows.filter(function(p){ return p.wipeId === wipe.id && p.appealStatus === 'pendiente'; });
    if (pending.length) {
      var appealsBox = document.createElement('div');
      appealsBox.className = 'appeals-box';
      var appealsTitle = document.createElement('div');
      appealsTitle.className = 'appeals-title';
      appealsTitle.textContent = '⚖️ Apelaciones pendientes de tu sentencia (' + pending.length + ')';
      appealsBox.appendChild(appealsTitle);
      pending.forEach(function(p){
        var u = userByUsername(p.username);
        var by = p.reportedBy ? (userByUsername(p.reportedBy) || { alias: p.reportedBy }).alias : '?';
        var item = document.createElement('div');
        item.className = 'appeal-item';
        var txt = document.createElement('div');
        txt.className = 'appeal-text';
        txt.innerHTML = '<strong>' + (u ? u.alias : p.username) + '</strong> apela una ' +
          POINT_LABELS.falta[p.weight] + ' (puesta por ' + by + '): «' + p.appealText + '»';
        var btns = document.createElement('div');
        btns.className = 'appeal-btns';
        var ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'fault-btn is-clear';
        ok.textContent = '✓ Aceptar';
        ok.title = 'La falta se retira';
        ok.addEventListener('click', function(){ resolveAppeal(p.id, true); });
        var no = document.createElement('button');
        no.type = 'button';
        no.className = 'fault-btn is-grave';
        no.textContent = '✕ Rechazar';
        no.title = 'La falta se queda y ya no podrá volver a apelarla';
        no.addEventListener('click', function(){ resolveAppeal(p.id, false); });
        btns.appendChild(ok);
        btns.appendChild(no);
        item.appendChild(txt);
        item.appendChild(btns);
        appealsBox.appendChild(item);
      });
      panel.appendChild(appealsBox);
    }
  }

  pick.people.forEach(function(username){
    var u = userByUsername(username);
    var isMine = currentUser && username === currentUser.username;
    var mine = pointRows.filter(function(p){ return p.wipeId === wipe.id && p.username === username; });
    var faults = mine.filter(function(p){ return p.kind === 'falta'; });
    var merits = mine.filter(function(p){ return p.kind === 'merito'; });
    var faultTotal = faults.reduce(function(s, p){ return s + p.weight; }, 0);
    var meritTotal = merits.reduce(function(s, p){ return s + p.weight; }, 0);

    var row = document.createElement('div');
    row.className = 'fault-row' + (faultTotal >= FAULT_LIMIT - 2 ? ' is-danger' : '');

    // Identidad
    var ident = document.createElement('div');
    ident.className = 'fault-ident';
    ident.appendChild(makeMiniAvatar(u));
    var nm = document.createElement('span');
    nm.className = 'fault-name';
    nm.textContent = u ? u.alias : username;
    ident.appendChild(nm);
    row.appendChild(ident);

    // Contadores: faltas y méritos, cada uno con su barra
    var meters = document.createElement('div');
    meters.className = 'fault-meters';
    meters.appendChild(buildPointsMeter(faultTotal, FAULT_LIMIT, 'falta'));
    meters.appendChild(buildPointsMeter(meritTotal, MERIT_LIMIT, 'merito'));
    row.appendChild(meters);

    // Chips de cada punto
    if (mine.length) row.appendChild(buildPointChips(mine, iAmGru, isMine));

    // Botones de acción
    var actions = document.createElement('div');
    actions.className = 'fault-actions';
    [
      { kind: 'falta',  weight: 1, cls: 'is-leve',  txt: '+ Leve',   tip: 'Falta leve · 1 punto' },
      { kind: 'falta',  weight: 2, cls: 'is-grave', txt: '+ Grave',  tip: 'Falta grave · 2 puntos' },
      { kind: 'merito', weight: 1, cls: 'is-merit', txt: '+ Mérito', tip: 'Mérito · 1 punto' },
      { kind: 'merito', weight: 2, cls: 'is-merit', txt: '+ Hazaña', tip: 'Hazaña · 2 puntos' }
    ].forEach(function(cfg){
      if (isMine) return; // no puedes votarte a ti mismo
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'fault-btn ' + cfg.cls;
      b.textContent = cfg.txt;
      b.title = cfg.tip;
      b.addEventListener('click', function(){ addPoint(wipe.id, username, cfg.kind, cfg.weight); });
      actions.appendChild(b);
    });
    if (iAmGru && faults.length) {
      var btnClear = document.createElement('button');
      btnClear.type = 'button';
      btnClear.className = 'fault-btn is-clear';
      btnClear.textContent = 'Perdonar';
      btnClear.title = 'Quitar todas sus faltas de este wipe (solo Gru)';
      btnClear.addEventListener('click', function(){ clearPoints(wipe.id, username, 'falta'); });
      actions.appendChild(btnClear);
    }
    row.appendChild(actions);

    panel.appendChild(row);
  });

  var legend = document.createElement('div');
  legend.className = 'faults-legend';
  legend.textContent = '🟨 Leve 1 pt · 🟥 Grave 2 pts → a los ' + FAULT_LIMIT + ' se baja de rango · ' +
    '🟩 Mérito 1 pt · 🌟 Hazaña 2 pts → a los ' + MERIT_LIMIT + ' se sube · ' +
    '1 voto cada 3 h por persona · pulsa tus faltas para apelar ante Gru.';
  panel.appendChild(legend);
}

/* ============================================================
   LOGIN / LOGOUT / ARRANQUE
   ============================================================ */
async function showApp(user) {
  currentUser = user;
  document.getElementById('user-alias').textContent = user.alias;
  document.getElementById('user-role').textContent = isGru(user) ? 'Líder · Gru' : user.role;
  document.getElementById('welcome-name').textContent = user.alias;

  document.querySelectorAll('.nav-tab').forEach(function(t){ t.classList.remove('active'); });
  document.querySelector('.nav-tab[data-view="inicio"]').classList.add('active');
  document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('active'); });
  document.getElementById('view-inicio').classList.add('active');

  await fetchUsers();
  await fetchBoard();
  await fetchWipeSignups();
  await fetchPoints();
  renderMembers();
  renderBoard();
  renderFaults();

  loginScreen.style.display = 'none';
  appShell.style.display = 'flex';
}

function backToLogin() {
  currentUser = null;
  appShell.style.display = 'none';
  loginScreen.style.display = 'flex';
  document.getElementById('username').value = '';
  document.getElementById('password').value = '';
}

document.getElementById('login-form').addEventListener('submit', async function(e){
  e.preventDefault();
  errorBox.classList.remove('visible');
  var username = document.getElementById('username').value.trim();
  var password = document.getElementById('password').value.trim();
  try {
    var data = await api('/auth/login', { method: 'POST', body: { username: username, password: password } });
    await showApp(data.user);
  } catch (err) {
    errorBox.textContent = err.message || 'Usuario o contraseña incorrectos.';
    errorBox.classList.add('visible');
  }
});

document.getElementById('logout-btn').addEventListener('click', async function(){
  try { await api('/auth/logout', { method: 'POST' }); } catch (e) { /* no pasa nada */ }
  backToLogin();
});

/* ---- Login con Google (opcional: solo aparece si el servidor tiene GOOGLE_CLIENT_ID) ---- */
function loadGoogleScript(cb) {
  if (window.google && google.accounts && google.accounts.id) { cb(); return; }
  var s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.defer = true;
  s.onload = cb;
  s.onerror = function () { /* bloqueado o sin red: simplemente no aparece el botón */ };
  document.head.appendChild(s);
}

async function onGoogleCredential(response) {
  errorBox.classList.remove('visible');
  try {
    var data = await api('/auth/google', { method: 'POST', body: { credential: response.credential } });
    await showApp(data.user);
  } catch (err) {
    errorBox.textContent = err.message || 'No se pudo iniciar sesión con Google.';
    errorBox.classList.add('visible');
  }
}

function setupGoogleLogin() {
  api('/config').then(function (cfg) {
    if (!cfg || !cfg.googleClientId) return;
    loadGoogleScript(function () {
      if (!window.google || !google.accounts || !google.accounts.id) return;
      google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: onGoogleCredential });
      google.accounts.id.renderButton(document.getElementById('google-signin-container'), {
        theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', width: 320
      });
      document.getElementById('google-login-wrap').classList.remove('is-hidden');
    });
  }).catch(function () { /* si falla, se queda solo el login normal */ });
}

setupGoogleLogin();
setupNav();
setupLocker();
setupRoleModal();
setupBoard();
setupStats();
setupEnemies();
// La calculadora de raideo ahora vive dentro de la pestaña "Intel"
// (intel.js), con un diseño renovado. Se elimina la inicialización
// antigua para no chocar con los elementos ya retirados de esta vista.
setupRoles();

// Si ya había una sesión activa (cookie), entra directo sin pedir login otra vez.
(async function init(){
  try {
    var data = await api('/auth/me');
    await showApp(data.user);
  } catch (e) {
    // no había sesión: se queda en la pantalla de login
  }
})();
