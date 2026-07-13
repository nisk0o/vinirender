// ============================================================
// VINICUS Y AMIGOS — Pestaña "In-Game Intel"
//   1) Códigos de cámaras CCTV de los monumentos (copiar 1 a 1)
//   2) Calculadora de genéticas (crossbreeding estilo rustbreeder)
// Todo es cliente puro: no toca el backend.
// ============================================================
(function () {
  'use strict';

  /* ============================================================
     1) CÁMARAS CCTV
     Códigos por defecto (servidores vanilla). La Base Militar
     Abandonada y los Laboratorios Submarinos NO se incluyen
     porque sus códigos se generan al azar en cada servidor.
     ============================================================ */
  var CCTV = [
    { monument: 'Dome', icon: '🔵', codes: ['DOME1', 'DOMETOP'] },
    { monument: 'Silo Nuclear', icon: '🚀', codes: ['SILOEXIT1', 'SILOEXIT2', 'SILOMISSILE', 'SILOSHIPPING', 'SILOTOWER'] },
    { monument: 'Oil Rig Grande', icon: '🛢️', codes: [
      'OILRIG2HELI', 'OILRIG2DOCK', 'OILRIG2EXHAUST',
      'OILRIG2L1', 'OILRIG2L2', 'OILRIG2L3A', 'OILRIG2L3B', 'OILRIG2L4',
      'OILRIG2L5', 'OILRIG2L6A', 'OILRIG2L6B', 'OILRIG2L6C', 'OILRIG2L6D'
    ] },
    { monument: 'Oil Rig Pequeña', icon: '⛽', codes: [
      'OILRIG1HELI', 'OILRIG1DOCK', 'OILRIG1L1', 'OILRIG1L2', 'OILRIG1L3', 'OILRIG1L4'
    ] },
    { monument: 'Cargo Ship', icon: '🚢', codes: ['CARGODECK', 'CARGOBRIDGE', 'CARGOSTERN', 'CARGOHOLD1', 'CARGOHOLD2'] },
    { monument: 'Ferry Terminal', icon: '⚓', codes: ['FERRYDOCK', 'FERRYPARKING', 'FERRYUTILITIES', 'FERRYLOGISTICS'] },
    { monument: 'Outpost / Compound', icon: '🏪', codes: ['COMPOUNDSTREET', 'COMPOUNDMUSIC', 'COMPOUNDCRUDE', 'COMPOUNDCHILL'] },
    { monument: 'Bandit Camp', icon: '🎰', codes: ['CASINO', 'TOWNWEAPONS'] },
    { monument: 'Radtown', icon: '☢️', codes: ['RADTOWNHOUSE', 'RADTOWNSBL', 'RADTOWNAPARTMENTS'] },
    { monument: 'Airfield', icon: '✈️', codes: ['AIRFIELDHELIPAD'] }
  ];

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // Fallback para navegadores viejos / contextos sin clipboard API
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        resolve();
      } catch (e) { reject(e); }
    });
  }

  function renderCCTV(filter) {
    var grid = document.getElementById('cctv-grid');
    if (!grid) return;
    grid.innerHTML = '';
    var q = (filter || '').trim().toLowerCase();

    var shown = 0;
    CCTV.forEach(function (mon) {
      var matchMon = mon.monument.toLowerCase().indexOf(q) !== -1;
      var codes = q ? mon.codes.filter(function (c) { return matchMon || c.toLowerCase().indexOf(q) !== -1; }) : mon.codes;
      if (!codes.length) return;
      shown++;

      var card = document.createElement('div');
      card.className = 'cctv-monument';

      var head = document.createElement('div');
      head.className = 'cctv-monument-head';
      head.textContent = mon.icon + ' ' + mon.monument;
      card.appendChild(head);

      var count = document.createElement('div');
      count.className = 'cctv-monument-count';
      count.textContent = codes.length + (codes.length === 1 ? ' cámara' : ' cámaras');
      card.appendChild(count);

      codes.forEach(function (code) {
        var row = document.createElement('div');
        row.className = 'cctv-code';
        row.title = 'Copiar "' + code + '"';

        var txt = document.createElement('span');
        txt.className = 'cctv-code-text';
        txt.textContent = code;

        var copy = document.createElement('span');
        copy.className = 'cctv-code-copy';
        copy.textContent = '📋 copiar';

        row.appendChild(txt);
        row.appendChild(copy);

        row.addEventListener('click', function () {
          copyToClipboard(code).then(function () {
            row.classList.add('copied');
            copy.textContent = '✅ copiado';
            if (typeof showToast === 'function') showToast('Código "' + code + '" copiado', 'success');
            clearTimeout(row._resetTimer);
            row._resetTimer = setTimeout(function () {
              row.classList.remove('copied');
              copy.textContent = '📋 copiar';
            }, 1600);
          }).catch(function () {
            if (typeof showToast === 'function') showToast('No se pudo copiar. Cópialo a mano: ' + code);
          });
        });

        card.appendChild(row);
      });

      grid.appendChild(card);
    });

    if (!shown) {
      var empty = document.createElement('div');
      empty.className = 'cctv-empty';
      empty.textContent = 'Ninguna cámara coincide con "' + filter + '".';
      grid.appendChild(empty);
    }
  }

  /* ============================================================
     2) CALCULADORA DE GENÉTICAS
     Cada gen tiene un peso; en cada una de las 6 posiciones se
     suma el peso de cada tipo de gen presente entre las plantas.
     Gana el de mayor peso total; si empatan, es 50/50 (o 1/n).
       G, Y, H = 0.6   (genes "buenos")
       W, X    = 1.0   (genes "malos")
     ============================================================ */
  var GENE_WEIGHTS = { G: 0.6, Y: 0.6, H: 0.6, W: 1.0, X: 1.0 };
  var VALID_GENES = ['G', 'Y', 'H', 'W', 'X'];
  var genePlants = []; // array de strings de 6 letras

  function geneCellHtml(letter) {
    return '<span class="gene-cell g-' + letter + '">' + letter + '</span>';
  }

  // Calidad de una genética: cada G/Y/H suma, cada W/X resta.
  // Sirve solo para ordenar los resultados (mejor arriba).
  function geneQuality(seq) {
    var s = 0;
    for (var i = 0; i < seq.length; i++) {
      var c = seq[i];
      if (c === 'G' || c === 'Y' || c === 'H') s += 1;
      else s -= 1;
    }
    return s;
  }

  function qualityLabel(seq) {
    var good = 0;
    for (var i = 0; i < seq.length; i++) {
      if (seq[i] === 'G' || seq[i] === 'Y' || seq[i] === 'H') good++;
    }
    return good + '/6 buenos';
  }

  // Para una posición concreta, devuelve los genes ganadores
  // (uno, o varios si hay empate) mirando todas las plantas.
  function winnersAtPosition(pos) {
    var totals = {};
    genePlants.forEach(function (seq) {
      var g = seq[pos];
      totals[g] = (totals[g] || 0) + GENE_WEIGHTS[g];
    });
    var keys = Object.keys(totals);
    if (!keys.length) return [];
    var max = -Infinity;
    keys.forEach(function (k) { if (totals[k] > max) max = totals[k]; });
    // Pequeña tolerancia por si acaso (0.6+0.6 vs 1.2 en coma flotante)
    return keys.filter(function (k) { return Math.abs(totals[k] - max) < 1e-9; }).sort();
  }

  // Calcula todas las genéticas posibles resultantes y su probabilidad.
  function computeCross() {
    var perPosition = [];
    for (var pos = 0; pos < 6; pos++) perPosition.push(winnersAtPosition(pos));

    // Producto cartesiano de los ganadores de cada posición.
    var outcomes = [{ seq: '', prob: 1 }];
    for (var p = 0; p < 6; p++) {
      var winners = perPosition[p];
      var next = [];
      var share = 1 / winners.length;
      outcomes.forEach(function (o) {
        winners.forEach(function (w) {
          next.push({ seq: o.seq + w, prob: o.prob * share });
        });
      });
      outcomes = next;
    }

    // Agrupamos genéticas idénticas (por si dos caminos dan lo mismo).
    var map = {};
    outcomes.forEach(function (o) {
      map[o.seq] = (map[o.seq] || 0) + o.prob;
    });
    var list = Object.keys(map).map(function (seq) {
      return { seq: seq, prob: map[seq] };
    });
    list.sort(function (a, b) {
      if (b.prob !== a.prob) return b.prob - a.prob;
      return geneQuality(b.seq) - geneQuality(a.seq);
    });

    return { list: list, perPosition: perPosition };
  }

  function renderGeneList() {
    var box = document.getElementById('gene-list');
    if (!box) return;
    box.innerHTML = '';
    if (!genePlants.length) {
      var empty = document.createElement('div');
      empty.className = 'gene-list-empty';
      empty.textContent = 'Todavía no has añadido ninguna planta. Mete al menos 2 para cruzarlas.';
      box.appendChild(empty);
      return;
    }
    genePlants.forEach(function (seq, idx) {
      var row = document.createElement('div');
      row.className = 'gene-chip-row';

      var index = document.createElement('span');
      index.className = 'gene-chip-index';
      index.textContent = '#' + (idx + 1);
      row.appendChild(index);

      var seqEl = document.createElement('div');
      seqEl.className = 'gene-seq';
      seqEl.innerHTML = seq.split('').map(geneCellHtml).join('');
      row.appendChild(seqEl);

      var rm = document.createElement('button');
      rm.className = 'gene-chip-remove';
      rm.type = 'button';
      rm.title = 'Quitar esta planta';
      rm.textContent = '✕';
      rm.addEventListener('click', function () {
        genePlants.splice(idx, 1);
        renderGeneList();
        renderGeneResults(null); // limpiar resultado al cambiar entradas
      });
      row.appendChild(rm);

      box.appendChild(row);
    });
  }

  function renderGeneResults(data) {
    var box = document.getElementById('gene-results');
    if (!box) return;
    box.innerHTML = '';
    if (!data) return;

    if (data.error) {
      var err = document.createElement('div');
      err.className = 'gene-error';
      err.textContent = data.error;
      box.appendChild(err);
      return;
    }

    var result = data.result;
    var best = result.list[0];

    // --- Bloque: mejor semilla probable ---
    var bestBlock = document.createElement('div');
    bestBlock.className = 'gene-result-block';
    var bestTitle = document.createElement('div');
    bestTitle.className = 'gene-result-title';
    bestTitle.textContent = '🌟 Mejor resultado posible';
    bestBlock.appendChild(bestTitle);

    var bestCard = document.createElement('div');
    bestCard.className = 'gene-best-card';
    var bestSeq = document.createElement('div');
    bestSeq.className = 'gene-seq';
    bestSeq.innerHTML = best.seq.split('').map(geneCellHtml).join('');
    bestCard.appendChild(bestSeq);
    var badge = document.createElement('span');
    badge.className = 'gene-best-badge';
    badge.textContent = qualityLabel(best.seq) + ' · ' + Math.round(best.prob * 100) + '% prob.';
    bestCard.appendChild(badge);
    bestBlock.appendChild(bestCard);
    box.appendChild(bestBlock);

    // --- Bloque: por posición ---
    var posBlock = document.createElement('div');
    posBlock.className = 'gene-result-block';
    var posTitle = document.createElement('div');
    posTitle.className = 'gene-result-title';
    posTitle.textContent = '📍 Qué gana en cada posición';
    posBlock.appendChild(posTitle);

    var posSeq = document.createElement('div');
    posSeq.className = 'gene-seq';
    result.perPosition.forEach(function (winners) {
      var cell;
      if (winners.length === 1) {
        cell = geneCellHtml(winners[0]);
      } else {
        // Posición disputada: mostramos el primero con marca de "a suerte".
        cell = '<span class="gene-cell g-' + winners[0] + ' is-contested" title="A suerte entre: ' + winners.join(', ') + '">' + winners.join('/') + '</span>';
      }
      posSeq.innerHTML += cell;
    });
    posBlock.appendChild(posSeq);
    var posNote = document.createElement('div');
    posNote.className = 'cctv-monument-count';
    posNote.style.marginTop = '0.6rem';
    posNote.textContent = 'Las posiciones con borde discontinuo salen a suerte entre los genes indicados.';
    posBlock.appendChild(posNote);
    box.appendChild(posBlock);

    // --- Bloque: todas las posibilidades ---
    var allBlock = document.createElement('div');
    allBlock.className = 'gene-result-block';
    var allTitle = document.createElement('div');
    allTitle.className = 'gene-result-title';
    allTitle.textContent = '🎲 Todas las semillas posibles (' + result.list.length + ')';
    allBlock.appendChild(allTitle);

    var maxProb = result.list[0].prob;
    var LIMIT = 24; // no reventamos la pantalla si hay cientos
    result.list.slice(0, LIMIT).forEach(function (o) {
      var row = document.createElement('div');
      row.className = 'gene-outcome-row';

      var prob = document.createElement('span');
      prob.className = 'gene-prob' + (o.prob >= 0.999 ? ' is-guaranteed' : '');
      prob.textContent = (o.prob >= 0.999 ? '100%' : (o.prob * 100).toFixed(o.prob < 0.1 ? 1 : 0) + '%');
      row.appendChild(prob);

      var seqEl = document.createElement('div');
      seqEl.className = 'gene-seq';
      seqEl.innerHTML = o.seq.split('').map(geneCellHtml).join('');
      row.appendChild(seqEl);

      var bar = document.createElement('div');
      bar.className = 'gene-bar';
      var fill = document.createElement('div');
      fill.className = 'gene-bar-fill';
      fill.style.width = Math.max(4, (o.prob / maxProb) * 100) + '%';
      bar.appendChild(fill);
      row.appendChild(bar);

      var qual = document.createElement('span');
      qual.className = 'gene-outcome-quality';
      qual.textContent = qualityLabel(o.seq);
      row.appendChild(qual);

      allBlock.appendChild(row);
    });

    if (result.list.length > LIMIT) {
      var more = document.createElement('div');
      more.className = 'cctv-monument-count';
      more.style.marginTop = '0.7rem';
      more.textContent = '… y ' + (result.list.length - LIMIT) + ' combinaciones más con probabilidad menor.';
      allBlock.appendChild(more);
    }
    box.appendChild(allBlock);
  }

  function normalizeGeneInput(raw) {
    return (raw || '').toUpperCase().replace(/[^GYHWX]/g, '').slice(0, 6);
  }

  function addGenePlant() {
    var input = document.getElementById('gene-input');
    var val = normalizeGeneInput(input.value);
    if (val.length !== 6) {
      if (typeof showToast === 'function') showToast('La genética debe tener exactamente 6 letras (G, Y, H, W o X).');
      return;
    }
    genePlants.push(val);
    input.value = '';
    renderGeneList();
    renderGeneResults(null);
    input.focus();
  }

  function renderGeneQuickPad() {
    var pad = document.getElementById('gene-quick');
    if (!pad) return;
    pad.innerHTML = '';
    var input = document.getElementById('gene-input');
    VALID_GENES.forEach(function (g) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gene-quick-btn gene-quick-' + g;
      btn.textContent = g;
      btn.addEventListener('click', function () {
        if (input.value.length < 6) input.value = normalizeGeneInput(input.value + g);
        input.focus();
      });
      pad.appendChild(btn);
    });
    var back = document.createElement('button');
    back.type = 'button';
    back.className = 'gene-quick-btn gene-quick-back';
    back.textContent = '⌫';
    back.title = 'Borrar última letra';
    back.addEventListener('click', function () {
      input.value = input.value.slice(0, -1);
      input.focus();
    });
    pad.appendChild(back);
  }

  function setupGenetics() {
    renderGeneQuickPad();
    renderGeneList();

    var input = document.getElementById('gene-input');
    input.addEventListener('input', function () {
      var caret = normalizeGeneInput(input.value);
      if (input.value !== caret) input.value = caret;
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addGenePlant(); }
    });

    document.getElementById('gene-add-btn').addEventListener('click', addGenePlant);

    document.getElementById('gene-calc-btn').addEventListener('click', function () {
      if (genePlants.length < 2) {
        renderGeneResults({ error: 'Añade al menos 2 plantas para calcular el cruce.' });
        return;
      }
      renderGeneResults({ result: computeCross() });
    });

    document.getElementById('gene-clear-btn').addEventListener('click', function () {
      genePlants = [];
      renderGeneList();
      renderGeneResults(null);
    });
  }

  /* ============================================================
     3) CALCULADORA DE RAIDEO (rediseño con fotos de items)
     La lista se guarda en el backend (/api/raid) igual que antes,
     así que la ve toda la Zerg. Usa api() y showToast() de app.js.
     ============================================================ */

  // --- Fotos de items (mismas imágenes que usa rustexplore.com) ---
  // Su CDN permite enlazado directo y usa los shortnames estándar de
  // Rust. Si alguna imagen fallara, cae a un monograma limpio para no
  // romper el diseño.
  var ITEM_IMG_BASE = 'https://rustexplore.com/images/40/';

  function itemImg(shortname, monogram) {
    var wrap = document.createElement('span');
    wrap.className = 'item-img';
    if (!shortname) {
      wrap.classList.add('fallback');
      wrap.textContent = monogram || '?';
      return wrap;
    }
    var img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = '';
    img.src = ITEM_IMG_BASE + shortname + '.webp';
    img.addEventListener('error', function () {
      wrap.classList.add('fallback');
      wrap.textContent = monogram || '?';
      if (img.parentNode === wrap) wrap.removeChild(img);
    });
    wrap.appendChild(img);
    return wrap;
  }

  // Icono SVG para los muros (no existe foto de item para los bloques
  // de construcción): un ladrillo estilizado tintado según el tier.
  function wallSvg(color) {
    var wrap = document.createElement('span');
    wrap.className = 'item-img';
    wrap.innerHTML =
      '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">' +
      '<g fill="' + color + '" stroke="rgba(0,0,0,0.35)" stroke-width="1">' +
      '<rect x="4" y="8" width="18" height="9" rx="1"/><rect x="26" y="8" width="18" height="9" rx="1"/>' +
      '<rect x="-6" y="19" width="18" height="9" rx="1" transform="translate(21 0)"/>' +
      '<rect x="4" y="19" width="11" height="9" rx="1"/><rect x="37" y="19" width="7" height="9" rx="1"/>' +
      '<rect x="4" y="30" width="18" height="9" rx="1"/><rect x="26" y="30" width="18" height="9" rx="1"/>' +
      '</g></svg>';
    return wrap;
  }

  // --- Datos de raideo (idénticos a los que ya usabas) ---
  var R_EXPLOSIVES = {
    exploAmmo: { name: 'Explosivo 5.56', img: 'ammo.rifle.explosive', mono: '5.56', craft: { sulfur: 25, metalFrag: 5, charcoal: 30 } },
    beancan:   { name: 'Beancan',        img: 'grenade.beancan',      mono: 'BC',   craft: { sulfur: 120, metalFrag: 20, charcoal: 180 } },
    satchel:   { name: 'Satchel',        img: 'explosive.satchel',    mono: 'ST',   craft: { sulfur: 480, cloth: 10, metalFrag: 80, charcoal: 720, rope: 1 } },
    rocket:    { name: 'Cohete',         img: 'ammo.rocket.basic',    mono: 'RK',   craft: { sulfur: 1400, hqm: 4, scrap: 40, charcoal: 1950, metalFrag: 100, cloth: 7.5, animalFat: 22.5 } },
    c4:        { name: 'C4',             img: 'explosive.timed',      mono: 'C4',   craft: { sulfur: 2200, cloth: 20, techTrash: 2, metalFrag: 200, charcoal: 3000, animalFat: 45 } }
  };
  var R_EXPLOSIVE_ORDER = ['exploAmmo', 'beancan', 'satchel', 'rocket', 'c4'];

  var R_RESOURCE_META = {
    sulfur:    { label: 'Azufre',        img: 'sulfur' },
    metalFrag: { label: 'Frag. Metal',   img: 'metal.fragments' },
    charcoal:  { label: 'Carbón',        img: 'charcoal' },
    cloth:     { label: 'Tela',          img: 'cloth' },
    rope:      { label: 'Cuerda',        img: 'rope' },
    hqm:       { label: 'Metal AC',      img: 'metal.refined' },
    scrap:     { label: 'Chatarra',      img: 'scrap' },
    animalFat: { label: 'Grasa Animal',  img: 'fat.animal' },
    techTrash: { label: 'Basura Tec.',   img: 'techparts' }
  };

  // img: foto de item; wall: color del tier (usa SVG en vez de foto).
  var R_STRUCTURES = [
    { id: 'wood-door',     name: 'Puerta Madera',  category: 'Puerta', hp: 200,  img: 'door.hinged.wood',      needs: { exploAmmo: 39,  beancan: 3,   satchel: 1,  rocket: 1,  c4: 1 } },
    { id: 'metal-door',    name: 'Puerta Chapa',   category: 'Puerta', hp: 250,  img: 'door.hinged.metal',     needs: { exploAmmo: 42,  beancan: 10,  satchel: 3,  rocket: 2,  c4: 1 } },
    { id: 'garage-door',   name: 'Puerta Garaje',  category: 'Puerta', hp: 600,  img: 'wall.frame.garagedoor', needs: { exploAmmo: 96,  beancan: 24,  satchel: 7,  rocket: 3,  c4: 2 } },
    { id: 'armored-door',  name: 'Puerta Blindada',category: 'Puerta', hp: 1000, img: 'door.hinged.toptier',   needs: { exploAmmo: 440, beancan: 180, satchel: 40, rocket: 15, c4: 4 }, approx: true },
    { id: 'tool-cupboard', name: 'Armario TC',     category: 'Deploy', hp: 300,  img: 'cupboard.tool',         needs: { exploAmmo: 110, beancan: 28,  satchel: 6,  rocket: 3,  c4: 2 } },
    { id: 'twig-wall',     name: 'Muro Ramas',     category: 'Muro',   hp: 10,   wall: '#c7a76a', needs: { exploAmmo: 1,   beancan: 1,   satchel: 1,  rocket: 1,  c4: 1 } },
    { id: 'wood-wall',     name: 'Muro Madera',    category: 'Muro',   hp: 250,  wall: '#8a5a3a', needs: { exploAmmo: 49,  beancan: 4,   satchel: 1,  rocket: 1,  c4: 1 } },
    { id: 'stone-wall',    name: 'Muro Piedra',    category: 'Muro',   hp: 500,  wall: '#8f8d88', needs: { exploAmmo: 182, beancan: 46,  satchel: 10, rocket: 4,  c4: 2 } },
    { id: 'metal-wall',    name: 'Muro Chapa',     category: 'Muro',   hp: 500,  wall: '#5f6a72', needs: { exploAmmo: 182, beancan: 46,  satchel: 10, rocket: 4,  c4: 2 } },
    { id: 'armored-wall',  name: 'Muro Blindado',  category: 'Muro',   hp: 1000, wall: '#3a4048', needs: { exploAmmo: 440, beancan: 180, satchel: 40, rocket: 15, c4: 4 }, approx: true }
  ];

  var rStructById = {};
  R_STRUCTURES.forEach(function (s) { rStructById[s.id] = s; });

  var raidState = { list: [], structId: 'metal-door', exploKey: 'rocket', qty: 1, loaded: false };

  function structImg(s) {
    return s.wall ? wallSvg(s.wall) : itemImg(s.img, s.name.slice(0, 2).toUpperCase());
  }

  function rowResources(structureId, explosiveKey, qty) {
    var s = rStructById[structureId];
    var e = R_EXPLOSIVES[explosiveKey];
    var amount = Math.ceil(s.needs[explosiveKey]) * qty;
    var resources = {};
    Object.keys(e.craft).forEach(function (res) { resources[res] = e.craft[res] * amount; });
    return { amount: amount, resources: resources };
  }

  // El explosivo más barato (por azufre) para la estructura elegida.
  function cheapestExplosiveFor(structId) {
    var best = null, bestSulfur = Infinity;
    R_EXPLOSIVE_ORDER.forEach(function (key) {
      var r = rowResources(structId, key, 1);
      var sulfur = r.resources.sulfur || 0;
      if (sulfur < bestSulfur) { bestSulfur = sulfur; best = key; }
    });
    return best;
  }

  function renderStructGrid() {
    var grid = document.getElementById('raid2-struct-grid');
    if (!grid) return;
    grid.innerHTML = '';
    R_STRUCTURES.forEach(function (s) {
      var tile = document.createElement('div');
      tile.className = 'raid2-tile' + (s.id === raidState.structId ? ' selected' : '');
      tile.appendChild(structImg(s));
      var name = document.createElement('div');
      name.className = 'raid2-tile-name';
      name.textContent = s.name;
      tile.appendChild(name);
      var sub = document.createElement('div');
      sub.className = 'raid2-tile-sub';
      sub.textContent = s.hp + ' HP' + (s.approx ? ' · ~' : '');
      tile.appendChild(sub);
      tile.addEventListener('click', function () {
        raidState.structId = s.id;
        renderStructGrid();
        renderExploGrid();
      });
      grid.appendChild(tile);
    });
  }

  function renderExploGrid() {
    var grid = document.getElementById('raid2-explo-grid');
    if (!grid) return;
    grid.innerHTML = '';
    var cheapest = cheapestExplosiveFor(raidState.structId);
    var s = rStructById[raidState.structId];

    // Pista del más barato en la cabecera
    var hint = document.getElementById('raid2-cheapest-hint');
    if (hint) hint.textContent = '· más barato: ' + R_EXPLOSIVES[cheapest].name;

    R_EXPLOSIVE_ORDER.forEach(function (key) {
      var e = R_EXPLOSIVES[key];
      var needed = s.needs[key];
      var tile = document.createElement('div');
      tile.className = 'raid2-tile' + (key === raidState.exploKey ? ' selected' : '');
      tile.appendChild(itemImg(e.img, e.mono));
      var name = document.createElement('div');
      name.className = 'raid2-tile-name';
      name.textContent = e.name;
      tile.appendChild(name);
      var badge = document.createElement('div');
      badge.className = 'raid2-tile-badge' + (key === cheapest ? ' is-cheapest' : '');
      badge.textContent = '×' + needed + (key === cheapest ? ' · barato' : '');
      tile.appendChild(badge);
      tile.addEventListener('click', function () {
        raidState.exploKey = key;
        renderExploGrid();
      });
      grid.appendChild(tile);
    });
  }

  function renderRaidList() {
    var listEl = document.getElementById('raid2-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (!raidState.list.length) {
      var empty = document.createElement('div');
      empty.className = 'raid2-empty';
      empty.textContent = 'Tu plan está vacío. Elige un objetivo y un explosivo arriba, y añádelo.';
      listEl.appendChild(empty);
      renderRaidTotals();
      return;
    }

    raidState.list.forEach(function (row) {
      var s = rStructById[row.structureId];
      var e = R_EXPLOSIVES[row.explosiveKey];
      if (!s || !e) return;
      var calc = rowResources(row.structureId, row.explosiveKey, row.qty);

      var rowEl = document.createElement('div');
      rowEl.className = 'raid2-row';

      // Objetivo
      var target = document.createElement('div');
      target.className = 'raid2-row-target';
      var qty = document.createElement('span');
      qty.className = 'raid2-row-qty';
      qty.textContent = '×' + row.qty;
      target.appendChild(qty);
      target.appendChild(structImg(s));
      var nameWrap = document.createElement('div');
      var name = document.createElement('div');
      name.className = 'raid2-row-name';
      name.innerHTML = s.name + (s.approx ? '<span class="raid2-approx">estimado</span>' : '');
      nameWrap.appendChild(name);
      target.appendChild(nameWrap);
      rowEl.appendChild(target);

      // Método
      var method = document.createElement('div');
      method.className = 'raid2-row-method';
      var arrow = document.createElement('span');
      arrow.className = 'raid2-row-arrow';
      arrow.textContent = '→';
      method.appendChild(arrow);
      var count = document.createElement('span');
      count.className = 'raid2-row-method-count';
      count.textContent = calc.amount;
      method.appendChild(count);
      method.appendChild(itemImg(e.img, e.mono));
      var mname = document.createElement('span');
      mname.className = 'raid2-row-method-name';
      mname.textContent = e.name;
      method.appendChild(mname);
      rowEl.appendChild(method);

      // Quitar
      var rm = document.createElement('button');
      rm.className = 'raid2-row-remove';
      rm.type = 'button';
      rm.title = 'Quitar de la lista';
      rm.textContent = '✕';
      rm.addEventListener('click', function () {
        apiCall('/raid/' + row.id, { method: 'DELETE' }).then(function () {
          loadRaid();
        });
      });
      rowEl.appendChild(rm);

      listEl.appendChild(rowEl);
    });

    renderRaidTotals();
  }

  function renderRaidTotals() {
    var wrap = document.getElementById('raid2-totals');
    if (!wrap) return;
    wrap.innerHTML = '';

    var title = document.createElement('div');
    title.className = 'raid2-totals-title';
    title.textContent = 'Recursos totales';
    wrap.appendChild(title);

    if (!raidState.list.length) {
      var empty = document.createElement('div');
      empty.className = 'raid2-empty';
      empty.textContent = 'Añade objetivos para ver cuánto necesitas farmear.';
      wrap.appendChild(empty);
      return;
    }

    // Suma de explosivos por tipo + recursos totales
    var byExplosive = {};
    var totals = {};
    raidState.list.forEach(function (row) {
      var s = rStructById[row.structureId];
      if (!s) return;
      var calc = rowResources(row.structureId, row.explosiveKey, row.qty);
      byExplosive[row.explosiveKey] = (byExplosive[row.explosiveKey] || 0) + calc.amount;
      Object.keys(calc.resources).forEach(function (res) {
        totals[res] = (totals[res] || 0) + calc.resources[res];
      });
    });

    // Resumen de explosivos a fabricar
    var summary = document.createElement('div');
    summary.className = 'raid2-summary';
    R_EXPLOSIVE_ORDER.forEach(function (key) {
      if (!byExplosive[key]) return;
      var e = R_EXPLOSIVES[key];
      var chip = document.createElement('div');
      chip.className = 'raid2-summary-chip';
      chip.appendChild(itemImg(e.img, e.mono));
      var txt = document.createElement('div');
      var num = document.createElement('div');
      num.className = 'raid2-summary-num';
      num.textContent = byExplosive[key];
      var label = document.createElement('div');
      label.className = 'raid2-summary-label';
      label.textContent = e.name;
      txt.appendChild(num);
      txt.appendChild(label);
      chip.appendChild(txt);
      summary.appendChild(chip);
    });
    wrap.appendChild(summary);

    var resLabel = document.createElement('div');
    resLabel.className = 'raid2-res-label';
    resLabel.textContent = 'Materia prima para fabricarlos';
    wrap.appendChild(resLabel);

    // Recursos ordenados por cantidad (azufre casi siempre primero)
    var grid = document.createElement('div');
    grid.className = 'raid2-res-grid';
    Object.keys(totals).sort(function (a, b) { return totals[b] - totals[a]; }).forEach(function (res) {
      var meta = R_RESOURCE_META[res];
      if (!meta) return;
      var chip = document.createElement('div');
      chip.className = 'raid2-res-chip';
      chip.appendChild(itemImg(meta.img, meta.label.slice(0, 2)));
      var txt = document.createElement('div');
      var amount = document.createElement('div');
      amount.className = 'raid2-res-amount';
      amount.textContent = Math.ceil(totals[res]).toLocaleString('es-ES');
      var name = document.createElement('div');
      name.className = 'raid2-res-name';
      name.textContent = meta.label;
      txt.appendChild(amount);
      txt.appendChild(name);
      chip.appendChild(txt);
      grid.appendChild(chip);
    });
    wrap.appendChild(grid);
  }

  // Cliente API tolerante: usa el api() global de app.js si existe.
  function apiCall(path, opts) {
    if (typeof api === 'function') return api(path, opts);
    // Fallback mínimo por si intel.js corre aislado (tests).
    var fetchOpts = { method: (opts && opts.method) || 'GET', credentials: 'same-origin', headers: {} };
    if (opts && opts.body !== undefined) {
      fetchOpts.headers['Content-Type'] = 'application/json';
      fetchOpts.body = JSON.stringify(opts.body);
    }
    return fetch('/api' + path, fetchOpts).then(function (r) { return r.json(); });
  }

  function loadRaid() {
    return apiCall('/raid').then(function (data) {
      raidState.list = (data && data.list) || [];
      raidState.loaded = true;
      renderRaidList();
    }).catch(function () {
      renderRaidList();
    });
  }

  function setupRaid() {
    if (!document.getElementById('intel-raid')) return;
    renderStructGrid();
    renderExploGrid();
    renderRaidList();

    var qtyInput = document.getElementById('raid2-qty-input');
    document.getElementById('raid2-qty-minus').addEventListener('click', function () {
      var v = parseInt(qtyInput.value, 10) || 1; qtyInput.value = Math.max(1, v - 1);
    });
    document.getElementById('raid2-qty-plus').addEventListener('click', function () {
      var v = parseInt(qtyInput.value, 10) || 1; qtyInput.value = v + 1;
    });

    document.getElementById('raid2-add-btn').addEventListener('click', function () {
      var qty = parseInt(qtyInput.value, 10);
      if (!qty || qty < 1) qty = 1;
      apiCall('/raid', { method: 'POST', body: { structureId: raidState.structId, explosiveKey: raidState.exploKey, qty: qty } })
        .then(function () {
          qtyInput.value = 1;
          if (typeof showToast === 'function') showToast(rStructById[raidState.structId].name + ' añadido al plan', 'success');
          return loadRaid();
        })
        .catch(function (e) { if (typeof showToast === 'function') showToast(e.message || 'No se pudo añadir'); });
    });

    document.getElementById('raid2-clear-btn').addEventListener('click', function () {
      if (!raidState.list.length) return;
      apiCall('/raid', { method: 'DELETE' }).then(function () { return loadRaid(); })
        .catch(function (e) { if (typeof showToast === 'function') showToast(e.message || 'No se pudo vaciar'); });
    });
  }

  /* ============================================================
     SUB-PESTAÑAS (Cámaras / Genéticas / Raideo)
     ============================================================ */
  function setupSubtabs() {
    var tabs = document.querySelectorAll('.intel-subtab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var target = tab.getAttribute('data-intel');
        tabs.forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        document.querySelectorAll('.intel-section').forEach(function (s) { s.classList.remove('active'); });
        var section = document.getElementById('intel-' + target);
        if (section) section.classList.add('active');
        // Al abrir Raideo por primera vez, traemos la lista del servidor.
        if (target === 'raid' && !raidState.loaded) loadRaid();
      });
    });
  }

  function init() {
    if (!document.getElementById('view-intel')) return; // por si el HTML no está
    renderCCTV('');
    var search = document.getElementById('cctv-search');
    if (search) search.addEventListener('input', function () { renderCCTV(search.value); });
    setupGenetics();
    setupRaid();
    setupSubtabs();
    // Si hay sesión iniciada, precargamos la lista de raideo en segundo plano.
    if (typeof api === 'function') loadRaid();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Exponemos la lógica de cálculo para poder testearla desde Node.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GENE_WEIGHTS: GENE_WEIGHTS };
  }
})();
