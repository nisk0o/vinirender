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
     SUB-PESTAÑAS (Cámaras / Genéticas)
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
      });
    });
  }

  function init() {
    if (!document.getElementById('view-intel')) return; // por si el HTML no está
    renderCCTV('');
    var search = document.getElementById('cctv-search');
    if (search) search.addEventListener('input', function () { renderCCTV(search.value); });
    setupGenetics();
    setupSubtabs();
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
