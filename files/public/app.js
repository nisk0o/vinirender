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
    alert(e.message);
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

function renderBoard() {
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
    var icon = document.createElement('span');
    icon.className = 'role-icon';
    icon.textContent = meta.icon;
    authorEl.appendChild(icon);
    authorEl.appendChild(document.createTextNode(author.alias));

    var metaWrap = document.createElement('div');
    metaWrap.className = 'board-note-meta';
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
  } catch (e) { alert(e.message); return; }
  await fetchBoard();
  renderBoard();
}

function setupBoard() {
  document.getElementById('board-form').addEventListener('submit', async function(e){
    e.preventDefault();
    if (!currentUser) return;
    var input = document.getElementById('board-input');
    var text = input.value.trim();
    if (!text) return;
    try {
      await api('/board', { method: 'POST', body: { text: text } });
    } catch (err) { alert(err.message); return; }
    input.value = '';
    await fetchBoard();
    renderBoard();
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

async function fetchEnemies() {
  var data = await api('/enemies');
  enemiesList = data.enemies;
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
      renderEnemiesServerPicker();
      renderEnemyTeamSelect();
      renderEnemiesPanel();
    });
    picker.appendChild(btn);
  });
}

function enemiesForServer() {
  return enemiesList.filter(function(e){ return e.serverId === enemiesSelectedServerId; });
}

function enemyTeams() {
  var teams = [];
  enemiesForServer().forEach(function(e){
    var t = e.team || '';
    if (t && teams.indexOf(t) === -1) teams.push(t);
  });
  teams.sort(function(a,b){ return a.localeCompare(b); });
  return teams;
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

  var newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '➕ Nuevo equipo…';
  select.appendChild(newOpt);

  var values = Array.prototype.map.call(select.options, function(o){ return o.value; });
  if (values.indexOf(prevValue) !== -1) select.value = prevValue;

  toggleNewTeamField();
}

function toggleNewTeamField() {
  var select = document.getElementById('enemy-team-select');
  var field = document.getElementById('enemy-newteam-field');
  if (!select || !field) return;
  field.classList.toggle('is-hidden', select.value !== '__new__');
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
  if (!list.length) {
    var empty = document.createElement('div');
    empty.className = 'enemy-empty';
    empty.textContent = 'Todavía no hay enemigos apuntados en este servidor. ¡Añade el primero arriba!';
    panel.appendChild(empty);
    return;
  }

  var teams = enemyTeams().concat(['']);
  teams.forEach(function(team){
    var teamEnemies = list.filter(function(e){ return (e.team || '') === team; })
                           .sort(function(a,b){ return a.name.localeCompare(b.name); });
    if (!teamEnemies.length) return;

    var group = document.createElement('div');
    group.className = 'enemy-team-group';

    var groupHead = document.createElement('div');
    groupHead.className = 'enemy-team-head';
    groupHead.textContent = team === '' ? '🎯 Sin equipo' : '⚔️ ' + team;
    group.appendChild(groupHead);

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

      var actions = document.createElement('div');
      actions.className = 'enemy-card-actions';

      var teamSelect = makeEnemyTeamSelect(en.team, async function(newTeam){
        try {
          await api('/enemies/' + en.id, { method: 'PATCH', body: { team: newTeam } });
        } catch (err) { alert(err.message); return; }
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
        } catch (err) { alert(err.message); return; }
        await fetchEnemies();
        renderEnemyTeamSelect();
        renderEnemiesPanel();
      });

      actions.appendChild(teamSelect);
      actions.appendChild(delBtn);

      card.appendChild(name);
      card.appendChild(steam);
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
  renderEnemiesPanel();

  document.getElementById('enemy-team-select').addEventListener('change', toggleNewTeamField);

  document.getElementById('enemy-add-form-el').addEventListener('submit', async function(e){
    e.preventDefault();
    var nameInput = document.getElementById('enemy-name-input');
    var steamInput = document.getElementById('enemy-steamid-input');
    var teamSelect = document.getElementById('enemy-team-select');
    var newTeamInput = document.getElementById('enemy-newteam-input');

    var name = nameInput.value.trim();
    if (!name) return;
    var steamId = steamInput.value.trim();
    if (steamId && !/^\d{15,20}$/.test(steamId)) {
      alert('La SteamID64 debe ser un número de entre 15 y 20 dígitos. Puedes dejarla vacía si no la tienes a mano.');
      return;
    }

    var team = teamSelect.value === '__new__' ? newTeamInput.value.trim() : teamSelect.value;

    try {
      await api('/enemies', { method: 'POST', body: {
        serverId: enemiesSelectedServerId, name: name, steamId: steamId, team: team
      } });
    } catch (err) { alert(err.message); return; }

    nameInput.value = '';
    steamInput.value = '';
    newTeamInput.value = '';
    await fetchEnemies();
    renderEnemyTeamSelect();
    renderEnemiesPanel();
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
      try { await api('/raid/' + row.id, { method: 'DELETE' }); } catch (e) { alert(e.message); return; }
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
    } catch (e) { alert(e.message); return; }
    document.getElementById('raid-qty-input').value = 1;
    await fetchRaid();
    renderRaidList();
  });

  document.getElementById('raid-clear-btn').addEventListener('click', async function(){
    try { await api('/raid', { method: 'DELETE' }); } catch (e) { alert(e.message); return; }
    await fetchRaid();
    renderRaidList();
  });
}

/* ============================================================
   RULETA DE ROLES (solo cliente, no necesita backend)
   ============================================================ */
var ROLE_WHEELS = [
  { id: 'constructor',  label: 'Constructor',  icon: '🔨' },
  { id: 'electricista', label: 'Electricista', icon: '⚡' },
  { id: 'huertista',    label: 'Huertista',    icon: '🌱' }
];
var WHEEL_COLORS = ['#e6007e', '#c2410c', '#ffd400', '#166534', '#0f766e', '#7c3aed', '#b91c1c', '#0369a1', '#a16207', '#4b5563'];
var wheelState = {};
var SVG_NS = 'http://www.w3.org/2000/svg';

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

  var members = USERS.slice().sort(function(a, b){ return a.alias.localeCompare(b.alias); });
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

    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', describeWheelSlice(cx, cy, r, startAngle, endAngle));
    path.setAttribute('fill', WHEEL_COLORS[i % WHEEL_COLORS.length]);
    path.setAttribute('stroke', '#0e0e0f');
    path.setAttribute('stroke-width', '2');
    group.appendChild(path);

    var midAngle = startAngle + sliceAngle / 2;
    var labelPos = polarToCartesian(cx, cy, r * 0.62, midAngle);
    var text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', labelPos.x);
    text.setAttribute('y', labelPos.y);
    text.setAttribute('fill', '#ffffff');
    text.setAttribute('font-size', n > 9 ? '9.5' : '11.5');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('transform', 'rotate(' + midAngle + ' ' + labelPos.x + ' ' + labelPos.y + ')');
    text.textContent = u.alias.length > 13 ? u.alias.slice(0, 12) + '…' : u.alias;
    group.appendChild(text);
  });

  var hub = document.createElementNS(SVG_NS, 'circle');
  hub.setAttribute('cx', cx); hub.setAttribute('cy', cy); hub.setAttribute('r', 20);
  hub.setAttribute('fill', '#18171a');
  hub.setAttribute('stroke', '#ffd400');
  hub.setAttribute('stroke-width', '3');
  group.appendChild(hub);

  group.style.transformOrigin = '150px 150px';
  group.style.transform = 'rotate(' + wheelState[roleId].rotation + 'deg)';
  svg.appendChild(group);
}

function spinWheel(roleId) {
  var state = wheelState[roleId];
  if (!state || state.spinning) return;
  var members = state.members;
  var n = members.length;
  if (!n) return;

  state.spinning = true;
  var spinBtn = document.getElementById('spin-btn-' + roleId);
  if (spinBtn) spinBtn.disabled = true;

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
    var winner = members[winnerIndex];
    resultEl.textContent = '🎉 ' + winner.alias;
    resultEl.classList.add('has-winner');
  }, 4300);
}

function buildWheelsUI() {
  var wrap = document.getElementById('roles-wheels');
  if (!wrap) return;
  wrap.innerHTML = '';

  ROLE_WHEELS.forEach(function(role){
    wheelState[role.id] = { rotation: 0, spinning: false, members: [], timeoutId: null };

    var card = document.createElement('div');
    card.className = 'wheel-card';

    var title = document.createElement('h2');
    title.className = 'wheel-title';
    title.textContent = role.icon + ' ' + role.label;

    var wheelWrap = document.createElement('div');
    wheelWrap.className = 'wheel-wrap';

    var pointer = document.createElement('div');
    pointer.className = 'wheel-pointer';
    pointer.textContent = '▼';

    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('id', 'wheel-svg-' + role.id);
    svg.setAttribute('class', 'wheel-svg');
    svg.setAttribute('viewBox', '0 0 300 300');

    wheelWrap.appendChild(pointer);
    wheelWrap.appendChild(svg);

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

    card.appendChild(title);
    card.appendChild(wheelWrap);
    card.appendChild(btn);
    card.appendChild(result);
    wrap.appendChild(card);

    drawWheelSlices(role.id);
  });
}

function refreshWheelsIfIdle() {
  ROLE_WHEELS.forEach(function(role){
    if (wheelState[role.id] && !wheelState[role.id].spinning) drawWheelSlices(role.id);
  });
}

function setupRoles() {
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
      } catch (err) { alert(err.message); return; }
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

    if (!newAlias) { alert('El alias no puede estar vacío.'); return; }
    if (!newUsername) { alert('El usuario no puede estar vacío.'); return; }
    if (newSteamId && !/^\d{15,20}$/.test(newSteamId)) {
      alert('La SteamID64 debe ser un número de entre 15 y 20 dígitos (ej: 76561198012345678). Puedes dejarla vacía si no la tienes a mano.');
      return;
    }
    if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      alert('Ese email no parece válido.');
      return;
    }

    var body = { alias: newAlias, username: newUsername, steamId: newSteamId, email: newEmail };
    if (newPassword) body.password = newPassword;

    try {
      var data = await api('/users/me', { method: 'PATCH', body: body });
      currentUser = data.user;
    } catch (err) { alert(err.message); return; }

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

      if (view === 'taquilla') renderLocker();
      if (view === 'zerg') renderOrgchart();
      if (view === 'wipes') { wipeWeekOffset = 0; await fetchWipeSignups(); renderWipes(); }
      if (view === 'stats') renderStatsPanel();
      if (view === 'enemigos') { await fetchEnemies(); renderEnemyTeamSelect(); renderEnemiesPanel(); }
      if (view === 'raidcalc') { await fetchRaid(); renderRaidCompare(); renderRaidList(); }
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
  monday:  { label: 'Monday',  startDow: 1, days: 3, accent: '#8a5a3a' },
  normal:  { label: 'Thursday', startDow: 4, days: 4, accent: '#e6007e' },
  friday:  { label: 'Friday',  startDow: 5, days: 3, accent: '#ffd400' },
  forzado: { label: 'Forzado', startDow: 4, days: 4, accent: '#ff4d4d' }
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
    wipes.push({ id: wipeId(typeKey, start), typeKey: typeKey, label: cfg.label, accent: cfg.accent, days: cfg.days, start: start, end: end });
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
    else { alert(e.message); return; }
  }
  renderWipes();
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
  box.className = 'modality';

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
    empty.textContent = 'Nadie todavía';
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

  var card = document.createElement('div');
  card.className = 'wipe-card' + (isFinished ? ' is-finished' : '');
  card.style.setProperty('--wipe-accent', wipe.accent);

  var head = document.createElement('div');
  head.className = 'wipe-card-head';

  var left = document.createElement('div');
  var titleRow = document.createElement('div');
  titleRow.className = 'wipe-title-row';
  var type = document.createElement('span');
  type.className = 'wipe-type';
  type.textContent = wipe.label;
  titleRow.appendChild(type);
  if (wipe.typeKey === 'forzado') {
    var star = document.createElement('span');
    star.className = 'wipe-forzado-star';
    star.textContent = '⭐ Mensual';
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
    txt.textContent = cfg.label + ' (' + cfg.days + 'd)';
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
  renderMembers();
  renderBoard();

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
setupRaidCalc();
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
