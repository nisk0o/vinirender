// ============================================================
// VINICUS Y AMIGOS — pestaña BASES
// Repositorio de diseños (con vídeo de YouTube y etiquetas),
// votación en bananas 🍌, hoja de servicio por wipe, cementerio
// de bases 💀 y draft para elegir la base del próximo wipe 🗳️.
//
// Este archivo se carga DESPUÉS de app.js y reutiliza sus
// helpers globales: api(), showToast(), currentUser, USERS,
// isGru(), initialsOf(), SERVERS, userByUsername(), makeMiniAvatar().
// ============================================================

/* ---- Estado local ---- */
var basesList = [];       // [{id, name, youtubeUrl, teamSize, bunker, costStone, costMetal, notes, createdBy, ts}]
var baseVotesList = [];   // [{id, baseId, username, bananas, ts}]
var baseUsagesList = [];  // [{id, baseId, wipeLabel, serverId, daysSurvived, outcome, notes, createdBy, ts}]
var baseDraftsData = { drafts: [], candidates: [], votes: [] };
var baseUsageModalBaseId = null;

var BASE_TEAM_META = {
  trio: { icon: '👥', label: 'Trío' },
  zerg: { icon: '🐝', label: 'Zerg' }
};

var BASE_OUTCOME_META = {
  sobrevivio:   { icon: '🏆', label: 'Sobrevivió al wipe', dead: false },
  raid_offline: { icon: '🌙', label: 'Raid offline',        dead: true },
  raid_online:  { icon: '⚔️', label: 'Raid online',         dead: true },
  decay:        { icon: '🍂', label: 'Decay (se cayó sola)', dead: true },
  abandonada:   { icon: '🏚️', label: 'Abandonada',          dead: true }
};
var BASE_OUTCOME_ORDER = ['sobrevivio', 'raid_offline', 'raid_online', 'decay', 'abandonada'];

/* ---- Helpers ---- */
function ytVideoId(url) {
  if (!url) return null;
  var m = String(url).match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
  return m ? m[1] : null;
}
function ytThumbUrl(videoId) {
  return 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg';
}
function fmtNumber(n) { return Number(n).toLocaleString('es-ES'); }
function aliasOf(username) {
  var u = userByUsername(username);
  return u ? u.alias : (username || '?');
}
function baseById(id) {
  return basesList.find(function(b){ return b.id === id; }) || null;
}
function votesForBase(baseId) {
  return baseVotesList.filter(function(v){ return v.baseId === baseId; });
}
function usagesForBase(baseId) {
  return baseUsagesList.filter(function(u){ return u.baseId === baseId; });
}
function baseVoteStats(baseId) {
  var votes = votesForBase(baseId);
  var mine = currentUser ? votes.find(function(v){ return v.username === currentUser.username; }) : null;
  var avg = votes.length ? votes.reduce(function(s, v){ return s + v.bananas; }, 0) / votes.length : 0;
  return { count: votes.length, avg: avg, mine: mine ? mine.bananas : 0 };
}
function fmtUsageDate(ts) {
  var d = new Date(ts);
  return d.getDate() + ' ' + MONTH_NAMES[d.getMonth()];
}

/* ---- Fetch ---- */
async function fetchBases() {
  var data = await api('/bases');
  basesList = data.bases || [];
  baseVotesList = data.votes || [];
  baseUsagesList = data.usages || [];
}
async function fetchBaseDrafts() {
  var data = await api('/base-drafts');
  baseDraftsData = {
    drafts: data.drafts || [],
    candidates: data.candidates || [],
    votes: data.votes || []
  };
}
async function refreshBasesView() {
  try {
    await Promise.all([fetchBases(), fetchBaseDrafts()]);
  } catch (e) { showToast(e.message); return; }
  renderBasesView();
}
function renderBasesView() {
  renderBasesDraft();
  renderBasesGrid();
  renderBasesCemetery();
}

/* ============================================================
   DRAFT DEL WIPE 🗳️
   ============================================================ */
function openBaseDraft() {
  return baseDraftsData.drafts.find(function(d){ return d.status === 'abierto'; }) || null;
}
function lastClosedDraft() {
  return baseDraftsData.drafts.find(function(d){ return d.status === 'cerrado'; }) || null;
}
function draftCandidates(draftId) {
  return baseDraftsData.candidates.filter(function(c){ return c.draftId === draftId; });
}
function draftVotes(draftId) {
  return baseDraftsData.votes.filter(function(v){ return v.draftId === draftId; });
}

function renderBasesDraft() {
  var box = document.getElementById('bases-draft');
  if (!box) return;
  box.innerHTML = '';

  var open = openBaseDraft();

  // --- Hay un draft abierto: candidatas + votación ---
  if (open) {
    var wrap = document.createElement('div');
    wrap.className = 'draft-box';

    var head = document.createElement('div');
    head.className = 'draft-head';
    var title = document.createElement('div');
    title.className = 'draft-title';
    title.textContent = '🗳️ Draft abierto · ' + open.wipeLabel;
    head.appendChild(title);

    var votes = draftVotes(open.id);
    var meta = document.createElement('span');
    meta.className = 'draft-meta';
    meta.textContent = votes.length + ' voto' + (votes.length === 1 ? '' : 's') + ' · abierto por ' + aliasOf(open.createdBy);
    head.appendChild(meta);

    var canManage = currentUser && (isGru(currentUser) || currentUser.username === open.createdBy);
    if (canManage) {
      var actions = document.createElement('div');
      actions.className = 'draft-actions';
      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'draft-action-btn is-close';
      closeBtn.textContent = '👑 Cerrar y elegir';
      closeBtn.title = 'Cierra la votación: gana la base con más votos';
      closeBtn.addEventListener('click', function(){ closeDraft(open.id); });
      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'draft-action-btn is-delete';
      delBtn.textContent = '✕ Anular';
      delBtn.title = 'Borra el draft sin elegir ganadora';
      delBtn.addEventListener('click', function(){ deleteDraft(open.id); });
      actions.appendChild(closeBtn);
      actions.appendChild(delBtn);
      head.appendChild(actions);
    }
    wrap.appendChild(head);

    var grid = document.createElement('div');
    grid.className = 'draft-candidates';
    var myVote = currentUser ? votes.find(function(v){ return v.username === currentUser.username; }) : null;

    draftCandidates(open.id).forEach(function(c){
      var base = baseById(c.baseId);
      if (!base) return;
      var candVotes = votes.filter(function(v){ return v.baseId === c.baseId; });
      var isMine = myVote && myVote.baseId === c.baseId;

      var card = document.createElement('div');
      card.className = 'draft-candidate' + (isMine ? ' is-my-vote' : '');

      var chead = document.createElement('div');
      chead.className = 'draft-candidate-head';
      var thumb = document.createElement('div');
      thumb.className = 'draft-candidate-thumb';
      var vid = ytVideoId(base.youtubeUrl);
      if (vid) {
        var img = document.createElement('img');
        img.src = ytThumbUrl(vid); img.alt = base.name;
        thumb.appendChild(img);
      } else {
        thumb.textContent = '🏰';
      }
      var cname = document.createElement('div');
      cname.className = 'draft-candidate-name';
      cname.textContent = base.name;
      chead.appendChild(thumb);
      chead.appendChild(cname);
      card.appendChild(chead);

      var vrow = document.createElement('div');
      vrow.className = 'draft-candidate-votes';
      var count = document.createElement('span');
      count.className = 'draft-vote-count';
      count.textContent = candVotes.length + ' voto' + (candVotes.length === 1 ? '' : 's');
      vrow.appendChild(count);
      if (candVotes.length) {
        var avatars = document.createElement('span');
        avatars.className = 'draft-voters';
        candVotes.slice(0, 6).forEach(function(v){
          avatars.appendChild(makeMiniAvatar(userByUsername(v.username)));
        });
        vrow.appendChild(avatars);
      }
      card.appendChild(vrow);

      var voteBtn = document.createElement('button');
      voteBtn.type = 'button';
      voteBtn.className = 'draft-vote-btn' + (isMine ? ' is-voted' : '');
      voteBtn.textContent = isMine ? '✓ Tu voto' : 'Votar esta';
      voteBtn.addEventListener('click', function(){ voteDraft(open.id, c.baseId); });
      card.appendChild(voteBtn);

      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    box.appendChild(wrap);
    return;
  }

  // --- Sin draft abierto: banner con la última ganadora + botón ---
  var closed = lastClosedDraft();
  if (closed && closed.winnerBaseId) {
    var wbase = baseById(closed.winnerBaseId);
    var cbox = document.createElement('div');
    cbox.className = 'draft-box is-closed';
    var chead2 = document.createElement('div');
    chead2.className = 'draft-head';
    var ctitle = document.createElement('div');
    ctitle.className = 'draft-title';
    ctitle.textContent = '👑 Base del wipe · ' + closed.wipeLabel;
    chead2.appendChild(ctitle);
    cbox.appendChild(chead2);

    var line = document.createElement('div');
    line.className = 'draft-winner-line';
    var cvotes = draftVotes(closed.id).filter(function(v){ return v.baseId === closed.winnerBaseId; });
    line.innerHTML = 'La Zerg eligió <strong>«' + (wbase ? wbase.name : 'una base que ya no existe') + '»</strong>' +
      (cvotes.length ? ' con ' + cvotes.length + ' voto' + (cvotes.length === 1 ? '' : 's') + '.' : '.');
    cbox.appendChild(line);

    var newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'btn draft-new-btn';
    newBtn.textContent = '🗳️ Nuevo draft';
    newBtn.addEventListener('click', openDraftModal);
    cbox.appendChild(newBtn);
    box.appendChild(cbox);
    return;
  }

  // --- Ni abierto ni cerrado: invitación a crear el primero ---
  var note = document.createElement('div');
  note.className = 'draft-empty-note';
  var txt = document.createElement('div');
  txt.className = 'draft-empty-text';
  txt.textContent = '🗳️ ¿Wipe a la vista? Abre un draft con 2 o más bases del repositorio y que la Zerg vote cuál se construye.';
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn draft-new-btn';
  btn.textContent = '🗳️ Nuevo draft';
  btn.addEventListener('click', openDraftModal);
  note.appendChild(txt);
  note.appendChild(btn);
  box.appendChild(note);
}

async function voteDraft(draftId, baseId) {
  try {
    await api('/base-drafts/' + draftId + '/vote', { method: 'POST', body: { baseId: baseId } });
    await fetchBaseDrafts();
  } catch (e) { showToast(e.message); return; }
  renderBasesDraft();
}

async function closeDraft(draftId) {
  if (!confirm('¿Cerrar el draft? Ganará la base con más votos y se anunciará en el tablón.')) return;
  try {
    await api('/base-drafts/' + draftId + '/close', { method: 'POST' });
    await fetchBaseDrafts();
  } catch (e) { showToast(e.message); return; }
  renderBasesView();
  showToast('Draft cerrado: ya tenéis base para el wipe 👑', 'success');
}

async function deleteDraft(draftId) {
  if (!confirm('¿Anular este draft? Se borran sus votos y no se elige ganadora.')) return;
  try {
    await api('/base-drafts/' + draftId, { method: 'DELETE' });
    await fetchBaseDrafts();
  } catch (e) { showToast(e.message); return; }
  renderBasesDraft();
}

/* ---- Modal: nuevo draft ---- */
function openDraftModal() {
  if (basesList.length < 2) {
    showToast('Necesitáis al menos 2 bases en el repositorio para montar un draft.');
    return;
  }
  var picker = document.getElementById('base-draft-candidates');
  picker.innerHTML = '';
  basesList.forEach(function(b){
    var label = document.createElement('label');
    label.className = 'draft-pick-option';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = String(b.id);
    cb.addEventListener('change', function(){
      label.classList.toggle('is-checked', cb.checked);
    });
    var txt = document.createElement('span');
    var meta = BASE_TEAM_META[b.teamSize];
    txt.textContent = b.name + (meta ? ' · ' + meta.icon + ' ' + meta.label : '');
    label.appendChild(cb);
    label.appendChild(txt);
    picker.appendChild(label);
  });
  document.getElementById('base-draft-wipe').value = '';
  document.getElementById('base-draft-modal-overlay').classList.add('visible');
}
function closeDraftModal() {
  document.getElementById('base-draft-modal-overlay').classList.remove('visible');
}

/* ============================================================
   REPOSITORIO DE BASES 🏰
   ============================================================ */
function renderBasesGrid() {
  var grid = document.getElementById('bases-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (!basesList.length) {
    var empty = document.createElement('div');
    empty.className = 'bases-empty';
    empty.textContent = 'El repositorio está vacío. Sube la primera base con el formulario de arriba. 🍌';
    grid.appendChild(empty);
    return;
  }

  var closed = lastClosedDraft();
  var currentWinnerId = (!openBaseDraft() && closed) ? closed.winnerBaseId : null;

  basesList.forEach(function(b){
    grid.appendChild(buildBaseCard(b, b.id === currentWinnerId));
  });
}

function buildBaseCard(base, isWinner) {
  var card = document.createElement('div');
  card.className = 'base-card' + (isWinner ? ' is-winner' : '');

  // --- Miniatura del vídeo (click → abre YouTube) ---
  var vid = ytVideoId(base.youtubeUrl);
  var thumb;
  if (base.youtubeUrl) {
    thumb = document.createElement('a');
    thumb.href = base.youtubeUrl;
    thumb.target = '_blank';
    thumb.rel = 'noopener noreferrer';
    thumb.title = 'Ver el tutorial en YouTube';
  } else {
    thumb = document.createElement('div');
  }
  thumb.className = 'base-thumb';
  if (vid) {
    var img = document.createElement('img');
    img.src = ytThumbUrl(vid);
    img.alt = base.name;
    img.loading = 'lazy';
    thumb.appendChild(img);
    var play = document.createElement('span');
    play.className = 'base-thumb-play';
    play.textContent = '▶️';
    thumb.appendChild(play);
  } else {
    var ph = document.createElement('span');
    ph.className = 'base-thumb-placeholder';
    ph.textContent = '🏰';
    thumb.appendChild(ph);
  }
  if (isWinner) {
    var ribbon = document.createElement('span');
    ribbon.className = 'base-winner-ribbon';
    ribbon.textContent = '👑 Base del wipe';
    thumb.appendChild(ribbon);
  }
  card.appendChild(thumb);

  var body = document.createElement('div');
  body.className = 'base-card-body';

  // --- Nombre + borrar ---
  var titleRow = document.createElement('div');
  titleRow.className = 'base-card-title-row';
  var name = document.createElement('div');
  name.className = 'base-card-name';
  name.textContent = base.name;
  titleRow.appendChild(name);
  if (currentUser && (isGru(currentUser) || currentUser.username === base.createdBy)) {
    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'base-card-delete';
    del.title = 'Borrar base (se pierden sus votos y su hoja de servicio)';
    del.setAttribute('aria-label', 'Borrar base');
    del.textContent = '✕';
    del.addEventListener('click', function(){ deleteBase(base); });
    titleRow.appendChild(del);
  }
  body.appendChild(titleRow);

  // --- Etiquetas: equipo, bunker, costes ---
  var chips = document.createElement('div');
  chips.className = 'base-chips';
  var tmeta = BASE_TEAM_META[base.teamSize];
  if (tmeta) {
    var teamChip = document.createElement('span');
    teamChip.className = 'base-chip is-team';
    teamChip.textContent = tmeta.icon + ' ' + tmeta.label;
    chips.appendChild(teamChip);
  }
  var bunkerChip = document.createElement('span');
  bunkerChip.className = 'base-chip' + (base.bunker ? ' is-bunker' : '');
  bunkerChip.textContent = base.bunker ? '🛡️ Con bunker' : 'Sin bunker';
  chips.appendChild(bunkerChip);
  if (base.costStone != null) {
    var stoneChip = document.createElement('span');
    stoneChip.className = 'base-chip';
    stoneChip.textContent = '🪨 ' + fmtNumber(base.costStone) + ' piedra';
    chips.appendChild(stoneChip);
  }
  if (base.costMetal != null) {
    var metalChip = document.createElement('span');
    metalChip.className = 'base-chip';
    metalChip.textContent = '⚙️ ' + fmtNumber(base.costMetal) + ' metal';
    chips.appendChild(metalChip);
  }
  body.appendChild(chips);

  // --- Notas ---
  if (base.notes) {
    var notes = document.createElement('div');
    notes.className = 'base-card-notes';
    notes.textContent = base.notes;
    body.appendChild(notes);
  }

  // --- Votación en bananas 🍌 ---
  body.appendChild(buildBananaBox(base));

  // --- Hoja de servicio ---
  body.appendChild(buildUsageBox(base));

  // --- Quién la subió ---
  var creator = document.createElement('div');
  creator.className = 'base-card-creator';
  creator.textContent = 'Subida por ' + aliasOf(base.createdBy);
  body.appendChild(creator);

  card.appendChild(body);
  return card;
}

function buildBananaBox(base) {
  var box = document.createElement('div');
  box.className = 'banana-box';
  var stats = baseVoteStats(base.id);

  var row = document.createElement('div');
  row.className = 'banana-row';
  var filled = Math.round(stats.avg);
  for (var i = 1; i <= 5; i++) {
    (function(n){
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'banana-btn' + (n <= filled ? ' is-filled' : '');
      btn.textContent = '🍌';
      btn.title = stats.mine === n
        ? 'Ya le diste ' + n + ' banana' + (n === 1 ? '' : 's') + ' · pulsa para retirar tu voto'
        : 'Darle ' + n + ' banana' + (n === 1 ? '' : 's');
      btn.addEventListener('click', function(){
        voteBase(base.id, stats.mine === n ? 0 : n);
      });
      row.appendChild(btn);
    })(i);
  }
  box.appendChild(row);

  var meta = document.createElement('div');
  meta.className = 'banana-meta';
  if (stats.count) {
    meta.innerHTML = '<strong>' + stats.avg.toFixed(1) + '</strong> · ' + stats.count + ' voto' + (stats.count === 1 ? '' : 's') +
      (stats.mine ? ' · tu voto: ' + stats.mine + ' 🍌' : ' · aún no has votado');
  } else {
    meta.textContent = 'Sin votos todavía · sé el primero en dar bananas';
  }
  box.appendChild(meta);
  return box;
}

async function voteBase(baseId, bananas) {
  try {
    await api('/bases/' + baseId + '/vote', { method: 'POST', body: { bananas: bananas } });
    await fetchBases();
  } catch (e) { showToast(e.message); return; }
  renderBasesGrid();
  if (bananas > 0) showToast(bananas + ' 🍌 para esta base. ¡Bello!', 'success');
}

function buildUsageBox(base) {
  var box = document.createElement('div');
  box.className = 'base-usage-box';
  var usages = usagesForBase(base.id);
  var survived = usages.filter(function(u){ return u.outcome === 'sobrevivio'; }).length;
  var deaths = usages.length - survived;

  var summary = document.createElement('div');
  summary.className = 'base-usage-summary';
  var stats = document.createElement('span');
  stats.className = 'base-usage-stats';
  stats.textContent = usages.length
    ? '⚔️ ' + usages.length + ' uso' + (usages.length === 1 ? '' : 's') + ' · 🏆 ' + survived + ' · 💀 ' + deaths
    : '📜 Sin historial: aún no la habéis usado en ningún wipe';
  summary.appendChild(stats);

  var addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'base-usage-add-btn';
  addBtn.textContent = '➕ Apuntar uso';
  addBtn.addEventListener('click', function(){ openUsageModal(base); });
  summary.appendChild(addBtn);
  box.appendChild(summary);

  if (usages.length) {
    var list = document.createElement('div');
    list.className = 'base-usage-list';
    usages.slice(0, 3).forEach(function(u){
      var item = document.createElement('div');
      item.className = 'base-usage-item';
      var meta = BASE_OUTCOME_META[u.outcome] || { icon: '❓', label: u.outcome };
      var icon = document.createElement('span');
      icon.className = 'usage-outcome';
      icon.textContent = meta.icon;
      icon.title = meta.label;
      var txt = document.createElement('span');
      txt.className = 'usage-text';
      var bits = ['<strong>' + escapeHtmlBase(u.wipeLabel) + '</strong>'];
      if (u.serverId) bits.push(escapeHtmlBase(serverLabelForBase(u.serverId)));
      if (u.daysSurvived != null) bits.push(u.daysSurvived + ' día' + (u.daysSurvived === 1 ? '' : 's'));
      bits.push(meta.label);
      txt.innerHTML = bits.join(' · ');
      if (u.notes) txt.title = u.notes;
      item.appendChild(icon);
      item.appendChild(txt);
      if (currentUser && (isGru(currentUser) || currentUser.username === u.createdBy)) {
        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'usage-delete';
        del.title = 'Borrar este registro';
        del.textContent = '✕';
        del.addEventListener('click', function(){ deleteUsage(u.id); });
        item.appendChild(del);
      }
      list.appendChild(item);
    });
    if (usages.length > 3) {
      var more = document.createElement('div');
      more.className = 'base-usage-item';
      more.textContent = '… y ' + (usages.length - 3) + ' uso' + (usages.length - 3 === 1 ? '' : 's') + ' más';
      list.appendChild(more);
    }
    box.appendChild(list);
  }
  return box;
}

// Los servidores fijos de la app (SERVERS, definido en app.js) se
// muestran bonitos; cualquier otro texto se muestra tal cual.
function serverLabelForBase(serverId) {
  var s = SERVERS.find(function(x){ return x.id === serverId; });
  return s ? (s.platform + ' ' + s.name) : serverId;
}
function escapeHtmlBase(str) {
  var div = document.createElement('div');
  div.textContent = String(str == null ? '' : str);
  return div.innerHTML;
}

async function deleteBase(base) {
  if (!confirm('¿Borrar «' + base.name + '» del repositorio? Se pierden sus votos y su hoja de servicio.')) return;
  try {
    await api('/bases/' + base.id, { method: 'DELETE' });
    await Promise.all([fetchBases(), fetchBaseDrafts()]);
  } catch (e) { showToast(e.message); return; }
  renderBasesView();
  showToast('Base «' + base.name + '» borrada', 'success');
}

async function deleteUsage(usageId) {
  if (!confirm('¿Borrar este registro de la hoja de servicio?')) return;
  try {
    await api('/base-usages/' + usageId, { method: 'DELETE' });
    await fetchBases();
  } catch (e) { showToast(e.message); return; }
  renderBasesGrid();
  renderBasesCemetery();
}

/* ---- Modal: apuntar uso (hoja de servicio) ---- */
function openUsageModal(base) {
  baseUsageModalBaseId = base.id;
  document.getElementById('base-usage-modal-name').textContent = base.name;
  document.getElementById('base-usage-wipe').value = '';
  document.getElementById('base-usage-days').value = '';
  document.getElementById('base-usage-notes').value = '';

  var serverSel = document.getElementById('base-usage-server');
  serverSel.innerHTML = '';
  var noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = '— Sin especificar —';
  serverSel.appendChild(noneOpt);
  SERVERS.forEach(function(s){
    var opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.platform + ' · ' + s.name;
    serverSel.appendChild(opt);
  });

  var outcomeSel = document.getElementById('base-usage-outcome');
  outcomeSel.innerHTML = '';
  BASE_OUTCOME_ORDER.forEach(function(key){
    var meta = BASE_OUTCOME_META[key];
    var opt = document.createElement('option');
    opt.value = key;
    opt.textContent = meta.icon + ' ' + meta.label;
    outcomeSel.appendChild(opt);
  });

  document.getElementById('base-usage-modal-overlay').classList.add('visible');
}
function closeUsageModal() {
  baseUsageModalBaseId = null;
  document.getElementById('base-usage-modal-overlay').classList.remove('visible');
}

/* ============================================================
   CEMENTERIO DE BASES 💀
   ============================================================ */
function renderBasesCemetery() {
  var panel = document.getElementById('bases-cemetery');
  if (!panel) return;
  panel.innerHTML = '';

  var deaths = baseUsagesList.filter(function(u){
    var meta = BASE_OUTCOME_META[u.outcome];
    return meta && meta.dead;
  });

  if (!deaths.length) {
    var empty = document.createElement('div');
    empty.className = 'cemetery-empty';
    empty.textContent = 'El cementerio está vacío… de momento. Ninguna base ha caído en combate. 🕊️';
    panel.appendChild(empty);
    return;
  }

  deaths.forEach(function(u){
    var base = baseById(u.baseId);
    var meta = BASE_OUTCOME_META[u.outcome];

    var row = document.createElement('div');
    row.className = 'cemetery-row';

    var skull = document.createElement('span');
    skull.className = 'cemetery-skull';
    skull.textContent = '💀';
    row.appendChild(skull);

    var name = document.createElement('span');
    name.className = 'cemetery-name';
    name.textContent = base ? base.name : 'Base desaparecida';
    row.appendChild(name);

    var detailBits = [u.wipeLabel];
    if (u.serverId) detailBits.push(serverLabelForBase(u.serverId));
    if (u.daysSurvived != null) detailBits.push('aguantó ' + u.daysSurvived + ' día' + (u.daysSurvived === 1 ? '' : 's'));
    var detail = document.createElement('span');
    detail.className = 'cemetery-detail';
    detail.textContent = detailBits.join(' · ');
    row.appendChild(detail);

    var cause = document.createElement('span');
    cause.className = 'cemetery-cause';
    cause.textContent = meta.icon + ' ' + meta.label;
    row.appendChild(cause);

    if (u.notes) {
      var notes = document.createElement('div');
      notes.className = 'cemetery-notes';
      notes.textContent = '«' + u.notes + '» — ' + aliasOf(u.createdBy) + ' · ' + fmtUsageDate(u.ts);
      row.appendChild(notes);
    }

    panel.appendChild(row);
  });
}

/* ============================================================
   SETUP (formularios, modales y navegación)
   ============================================================ */
function setupBases() {
  // Al entrar en la pestaña Bases, cargamos todo del servidor.
  var basesTab = document.querySelector('.nav-tab[data-view="bases"]');
  if (basesTab) basesTab.addEventListener('click', function(){ refreshBasesView(); });

  // ---- Formulario: añadir base ----
  document.getElementById('base-add-form-el').addEventListener('submit', async function(e){
    e.preventDefault();
    var nameInput = document.getElementById('base-name-input');
    var ytInput = document.getElementById('base-youtube-input');
    var stoneInput = document.getElementById('base-stone-input');
    var metalInput = document.getElementById('base-metal-input');
    var notesInput = document.getElementById('base-notes-input');

    var name = nameInput.value.trim();
    if (!name) return;
    var youtubeUrl = ytInput.value.trim();
    if (youtubeUrl && !/^https?:\/\//i.test(youtubeUrl)) {
      showToast('El link del vídeo no parece una URL. Pega la dirección completa de YouTube (o déjalo vacío).');
      return;
    }

    try {
      await api('/bases', { method: 'POST', body: {
        name: name,
        youtubeUrl: youtubeUrl,
        teamSize: document.getElementById('base-teamsize-select').value,
        bunker: document.getElementById('base-bunker-select').value === 'true',
        costStone: stoneInput.value === '' ? null : parseInt(stoneInput.value, 10),
        costMetal: metalInput.value === '' ? null : parseInt(metalInput.value, 10),
        notes: notesInput.value.trim()
      } });
    } catch (err) { showToast(err.message); return; }

    nameInput.value = '';
    ytInput.value = '';
    stoneInput.value = '';
    metalInput.value = '';
    notesInput.value = '';
    await fetchBases();
    renderBasesGrid();
    showToast('Base «' + name + '» añadida al repositorio 🏰', 'success');
  });

  // ---- Modal: apuntar uso ----
  document.getElementById('base-usage-form').addEventListener('submit', async function(e){
    e.preventDefault();
    if (baseUsageModalBaseId == null) return;
    var wipeLabel = document.getElementById('base-usage-wipe').value.trim();
    if (!wipeLabel) { showToast('Di en qué wipe se usó (ej. "Thursday 16 jul").'); return; }
    var daysRaw = document.getElementById('base-usage-days').value;

    try {
      await api('/bases/' + baseUsageModalBaseId + '/usages', { method: 'POST', body: {
        wipeLabel: wipeLabel,
        serverId: document.getElementById('base-usage-server').value,
        daysSurvived: daysRaw === '' ? null : parseInt(daysRaw, 10),
        outcome: document.getElementById('base-usage-outcome').value,
        notes: document.getElementById('base-usage-notes').value.trim()
      } });
      await fetchBases();
    } catch (err) { showToast(err.message); return; }

    closeUsageModal();
    renderBasesGrid();
    renderBasesCemetery();
    showToast('Uso apuntado en la hoja de servicio 📜', 'success');
  });
  document.getElementById('base-usage-cancel').addEventListener('click', closeUsageModal);
  document.getElementById('base-usage-modal-overlay').addEventListener('click', function(e){
    if (e.target === this) closeUsageModal();
  });

  // ---- Modal: nuevo draft ----
  document.getElementById('base-draft-form').addEventListener('submit', async function(e){
    e.preventDefault();
    var wipeLabel = document.getElementById('base-draft-wipe').value.trim();
    if (!wipeLabel) { showToast('Di para qué wipe es el draft.'); return; }
    var checked = Array.prototype.slice.call(
      document.querySelectorAll('#base-draft-candidates input[type="checkbox"]:checked')
    ).map(function(cb){ return Number(cb.value); });
    if (checked.length < 2) { showToast('Elige al menos 2 bases candidatas.'); return; }

    try {
      await api('/base-drafts', { method: 'POST', body: { wipeLabel: wipeLabel, baseIds: checked } });
      await fetchBaseDrafts();
    } catch (err) { showToast(err.message); return; }

    closeDraftModal();
    renderBasesView();
    showToast('Draft abierto: ¡que vote la Zerg! 🗳️', 'success');
  });
  document.getElementById('base-draft-cancel').addEventListener('click', closeDraftModal);
  document.getElementById('base-draft-modal-overlay').addEventListener('click', function(e){
    if (e.target === this) closeDraftModal();
  });
}

setupBases();
