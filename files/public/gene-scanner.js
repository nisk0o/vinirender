// ============================================================
// VINICUS Y AMIGOS — Escáner de genéticas por pantalla
// Método de rustbreeder.com (Screen Capture API + OCR con
// Tesseract.js). 100% en el navegador: NO toca Rust ni sus
// ficheros, sólo "mira" la imagen de la pantalla igual que OBS.
//
// v4 — CAMBIOS FRENTE A v3 (por qué antes no detectaba nada):
//  1. BINARIZACIÓN POR CANAL MÁXIMO. Antes se usaba luminancia
//     (0.299R + 0.587G + 0.114B). El azul pesa sólo 0.114, así que
//     una W azul (o una H roja) sobre fondo oscuro caía por debajo
//     del umbral y SE BORRABA: Tesseract recibía genéticas mutiladas
//     y no reconocía nada. Ahora se usa el canal más brillante, así
//     sobrevive cualquier letra clara sea del color que sea.
//  2. MULTIPASADA. Si la primera pasada no encuentra genes, reintenta
//     con otros umbrales y otro modo de segmentación (PSM) antes de
//     rendirse.
//  3. UMBRAL AJUSTABLE en el propio panel (por si tu gamma/brillo
//     de Rust es distinto).
//  4. MODO DIAGNÓSTICO: enseña la imagen exacta que recibe el OCR y
//     el texto crudo que ha leído. Con esto se ve al instante si el
//     fallo es de imagen o de parseo.
//
// Requisito único en index.html:
//   <script src="/gene-scanner.js"></script>   (después de /intel.js)
// ============================================================
(function () {
  'use strict';

  var VERSION = 'v4';

  try {
    console.log('%c[gene-scanner] Cargado ' + VERSION,
      'background:#e6007e;color:#fff;padding:2px 8px;border-radius:4px;font-weight:bold');
  } catch (e) {}

  var TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  var VALID = 'GYHWX';

  // Confusiones típicas del OCR con la fuente de Rust.
  var FIXES = {
    V: 'Y', U: 'Y', T: 'Y', '4': 'Y', '7': 'Y', '¥': 'Y', '\\': 'Y', I: 'Y', L: 'Y', J: 'Y',
    M: 'W', N: 'W',
    K: 'X', '×': 'X', '%': 'X', '*': 'X', '8': 'X',
    '6': 'G', C: 'G', O: 'G', '0': 'G', Q: 'G', '9': 'G', D: 'G', S: 'G', '5': 'G',
    R: 'H', A: 'H', '#': 'H', B: 'H', P: 'H', E: 'H'
  };

  // Pasadas de OCR: se van probando hasta encontrar algo.
  // psm 11 = texto disperso (busca palabras por toda la imagen)
  // psm 7  = una sola línea  (ideal si has recortado la zona del tooltip)
  // psm 6  = bloque uniforme (ideal para la rejilla de un planter)
  var PASSES = [
    { thr: null, psm: '11' },   // thr null = usa el umbral del slider
    { thr: null, psm: '6' },
    { thr: 90,   psm: '11' },
    { thr: 140,  psm: '11' },
    { thr: null, psm: '7' }
  ];

  var state = {
    worker: null,
    stream: null,
    loopTimer: null,
    busy: false,
    region: null,     // {x,y,w,h} fracción del vídeo, o null = todo
    detected: {},     // seq -> { conf }
    mode: null,       // 'screen' | 'image' | null
    mounted: false,
    threshold: 110,   // umbral de binarización (canal máximo)
    debug: false,
    lastPsm: null
  };

  /* ==========================================================
     CSS
     ========================================================== */
  var CSS = [
    '.scan-panel{background:var(--color-bg-raised,#17171c);border:1px solid var(--color-metal,#333);border-radius:var(--radius-md,10px);padding:1.1rem 1.2rem;margin-bottom:1.2rem}',
    '.scan-head{display:flex;align-items:center;gap:.6rem;margin-bottom:.5rem;flex-wrap:wrap}',
    '.scan-title{font-family:var(--font-display,inherit);font-size:1.1rem;letter-spacing:.04em}',
    '.scan-badge{font-family:var(--font-mono,monospace);font-size:.6rem;text-transform:uppercase;letter-spacing:.08em;padding:.2rem .45rem;border-radius:999px;background:rgba(230,0,126,.15);color:var(--color-fucsia-glow,#ff4fb0);border:1px solid rgba(230,0,126,.4)}',
    '.scan-ver{font-family:var(--font-mono,monospace);font-size:.58rem;color:var(--color-text-faint,#7a7a82);margin-left:auto}',
    '.scan-help{font-size:.82rem;color:var(--color-text-faint,#8a8a92);line-height:1.5;margin-bottom:.9rem}',
    '.scan-help strong{color:var(--color-text,#eee)}',
    '.scan-controls{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin-bottom:.7rem}',
    '.scan-btn{font-family:var(--font-mono,monospace);font-size:.78rem;font-weight:600;padding:.55rem .9rem;border-radius:8px;border:1px solid var(--color-fucsia,#e6007e);background:var(--color-fucsia,#e6007e);color:#fff;cursor:pointer;transition:.12s}',
    '.scan-btn:hover{filter:brightness(1.12)}',
    '.scan-btn.ghost{background:none;color:var(--color-text-dim,#bbb);border-color:var(--color-metal,#333)}',
    '.scan-btn.ghost:hover{border-color:var(--color-fucsia,#e6007e);color:#fff}',
    '.scan-file-btn{font-family:var(--font-mono,monospace);font-size:.78rem;font-weight:600;padding:.55rem .9rem;border:1px solid var(--color-metal,#333);border-radius:8px;cursor:pointer;color:var(--color-text-dim,#bbb)}',
    '.scan-file-btn:hover{border-color:var(--color-fucsia,#e6007e);color:#fff}',
    '.scan-auto-wrap{font-size:.78rem;color:var(--color-text-faint,#8a8a92);display:flex;align-items:center;gap:.35rem;cursor:pointer}',
    '.scan-tune{display:flex;flex-wrap:wrap;align-items:center;gap:.8rem;margin-bottom:.9rem;font-size:.75rem;color:var(--color-text-faint,#8a8a92);font-family:var(--font-mono,monospace)}',
    '.scan-tune input[type=range]{width:130px;accent-color:var(--color-fucsia,#e6007e)}',
    '.scan-tune label{display:flex;align-items:center;gap:.35rem;cursor:pointer}',
    '.scan-drop-zone{border:1px dashed var(--color-metal,#333);border-radius:var(--radius-md,10px);padding:.4rem;transition:border-color .15s}',
    '.scan-drop-zone.is-over{border-color:var(--color-fucsia,#e6007e);background:rgba(230,0,126,.06)}',
    '.scan-stage{position:relative;aspect-ratio:16/9;background:#000;border-radius:6px;overflow:hidden;display:flex;align-items:center;justify-content:center;cursor:crosshair;touch-action:none}',
    '.scan-stage video,.scan-stage img{width:100%;height:100%;object-fit:contain;display:none}',
    '.scan-stage.is-live video{display:block}',
    '.scan-stage.is-image img{display:block}',
    '.scan-stage.is-live .scan-placeholder,.scan-stage.is-image .scan-placeholder{display:none}',
    '.scan-placeholder{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:1.5rem;font-size:.82rem;color:var(--color-text-faint,#8a8a92);pointer-events:none}',
    '.scan-region{position:absolute;border:2px solid var(--color-fucsia,#e6007e);background:rgba(230,0,126,.12);pointer-events:none;box-shadow:0 0 0 9999px rgba(0,0,0,.35)}',
    '.scan-status{font-family:var(--font-mono,monospace);font-size:.75rem;margin:.8rem 0 .4rem;min-height:1.1em;color:var(--color-text-faint,#8a8a92)}',
    '.scan-status.is-ok{color:#7ed67e}.scan-status.is-warn{color:#ffd400}.scan-status.is-work{color:var(--color-fucsia-glow,#ff4fb0)}.scan-status.is-err{color:#ff7a7a}',
    '.scan-debug{border:1px solid var(--color-metal,#333);border-radius:8px;padding:.6rem;margin-bottom:.8rem;background:rgba(0,0,0,.25)}',
    '.scan-debug-head{font-family:var(--font-mono,monospace);font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-faint,#8a8a92);margin-bottom:.4rem}',
    '.scan-debug canvas{max-width:100%;border:1px solid var(--color-metal,#333);border-radius:4px;display:block;margin-bottom:.5rem;background:#fff}',
    '.scan-debug pre{font-family:var(--font-mono,monospace);font-size:.7rem;color:#9ad;white-space:pre-wrap;word-break:break-all;margin:0;max-height:120px;overflow:auto}',
    '.scan-detected{display:flex;flex-direction:column;gap:.45rem;margin-bottom:.7rem}',
    '.scan-detected-head{font-family:var(--font-mono,monospace);font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-faint,#8a8a92)}',
    '.scan-empty{font-size:.8rem;color:var(--color-text-faint,#8a8a92)}',
    '.scan-chip{display:flex;align-items:center;gap:.6rem;background:rgba(255,255,255,.03);border:1px solid var(--color-metal,#333);border-radius:8px;padding:.4rem .6rem;flex-wrap:wrap}',
    '.scan-chip .gene-seq{display:flex;gap:.2rem}',
    '.scan-chip .gene-cell{width:1.7rem;height:1.7rem;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono,monospace);font-weight:700;font-size:.9rem;border-radius:4px}',
    '.scan-cell-G{background:rgba(76,154,76,.22);color:#7ed67e}.scan-cell-Y{background:rgba(255,212,0,.2);color:#ffd400}.scan-cell-H{background:rgba(230,0,126,.2);color:var(--color-fucsia-glow,#ff4fb0)}.scan-cell-W{background:rgba(90,150,220,.2);color:#74b0e6}.scan-cell-X{background:rgba(120,120,120,.2);color:#9a9a9a}',
    '.scan-conf{font-family:var(--font-mono,monospace);font-size:.7rem;padding:.15rem .4rem;border-radius:999px}',
    '.scan-conf.is-high{color:#7ed67e;background:rgba(76,154,76,.15)}.scan-conf.is-mid{color:#ffd400;background:rgba(255,212,0,.12)}.scan-conf.is-low{color:#ff8a8a;background:rgba(255,77,77,.12)}',
    '.scan-add{font-family:var(--font-mono,monospace);font-size:.72rem;background:none;border:1px solid var(--color-fucsia,#e6007e);color:var(--color-fucsia-glow,#ff4fb0);border-radius:999px;padding:.25rem .6rem;cursor:pointer;margin-left:auto}',
    '.scan-add:hover{background:var(--color-fucsia,#e6007e);color:#fff}',
    '.scan-x{background:none;border:none;color:var(--color-text-faint,#8a8a92);cursor:pointer;padding:.2rem .35rem;font-size:.9rem}',
    '.scan-x:hover{color:#ff4d4d}',
    '.scan-add-all{margin-top:.3rem}',
    '.scan-panel .is-hidden{display:none!important}',
    '@media(max-width:640px){.scan-mobilehide{display:none}}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('scan-css')) return;
    var st = document.createElement('style');
    st.id = 'scan-css';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ==========================================================
     HTML del panel
     ========================================================== */
  function panelHTML() {
    return '' +
    '<div class="scan-head">' +
      '<span class="scan-title">📷 Leer genéticas de la pantalla</span>' +
      '<span class="scan-badge">Sólo en PC</span>' +
      '<span class="scan-ver">' + VERSION + '</span>' +
    '</div>' +
    '<div class="scan-help">' +
      'Comparte la ventana de Rust, deja las genéticas a la vista y pulsa <strong>Escanear ahora</strong>. ' +
      'Sólo mira la imagen de tu pantalla, como OBS: no toca el juego.' +
      '<br>Truco: <strong>arrastra sobre la vista previa</strong> para marcar sólo la zona de las genéticas. Acierta mucho más. ' +
      'También puedes <strong>subir, pegar (Ctrl+V) o arrastrar</strong> una captura.' +
      '<br><strong>Si vas esqueje a esqueje</strong> (el tooltip sólo se ve con el ratón encima): activa ' +
      '<strong>Escanear cada 2 s</strong> y ve pasando el ratón por los esquejes sin salir del juego.' +
    '</div>' +
    '<div class="scan-controls">' +
      '<button class="scan-btn scan-mobilehide" id="scan-share-btn" type="button">🖥️ Compartir pantalla</button>' +
      '<button class="scan-btn is-hidden" id="scan-shot-btn" type="button">🔍 Escanear ahora</button>' +
      '<button class="scan-btn ghost is-hidden" id="scan-stop-btn" type="button">Dejar de compartir</button>' +
      '<label class="scan-file-btn">🖼️ Subir captura<input type="file" id="scan-file" accept="image/*" hidden></label>' +
      '<label class="scan-auto-wrap is-hidden" id="scan-auto-wrap"><input type="checkbox" id="scan-auto"> Escanear cada 2 s</label>' +
      '<button class="scan-btn ghost is-hidden" id="scan-region-clear" type="button">Quitar zona</button>' +
    '</div>' +
    '<div class="scan-tune">' +
      '<label title="Sube o baja si el OCR no ve las letras. Míralo con el modo diagnóstico.">' +
        'Umbral <input type="range" id="scan-thr" min="60" max="200" step="5" value="110">' +
        '<span id="scan-thr-val">110</span>' +
      '</label>' +
      '<label title="Enseña la imagen exacta que recibe el OCR y el texto crudo que lee.">' +
        '<input type="checkbox" id="scan-debug"> 🔬 Modo diagnóstico' +
      '</label>' +
    '</div>' +
    '<div class="scan-drop-zone" id="scan-drop-zone">' +
      '<div class="scan-stage" id="scan-stage">' +
        '<video id="scan-video" muted playsinline></video>' +
        '<img id="scan-image" alt="">' +
        '<div class="scan-region is-hidden" id="scan-region"></div>' +
        '<div class="scan-placeholder">Comparte la pantalla, o arrastra/pega aquí una captura.</div>' +
      '</div>' +
    '</div>' +
    '<div class="scan-status" id="scan-status"></div>' +
    '<div class="scan-debug is-hidden" id="scan-debug-box">' +
      '<div class="scan-debug-head">Lo que ve el OCR (debe verse texto NEGRO sobre BLANCO, con las 6 letras enteras)</div>' +
      '<div id="scan-debug-canvas"></div>' +
      '<div class="scan-debug-head">Texto crudo leído</div>' +
      '<pre id="scan-debug-text">—</pre>' +
    '</div>' +
    '<div class="scan-detected" id="scan-detected"></div>' +
    '<button class="scan-btn ghost" id="scan-clear-btn" type="button">Borrar lecturas</button>';
  }

  /* ==========================================================
     Montaje
     ========================================================== */
  function mount() {
    if (state.mounted || document.getElementById('scan-panel')) { state.mounted = true; return true; }

    var section = document.getElementById('intel-genetics');
    if (!section) return false;

    injectCSS();
    var panel = document.createElement('div');
    panel.className = 'scan-panel';
    panel.id = 'scan-panel';
    panel.innerHTML = panelHTML();

    var anchor = section.querySelector('.gene-input-panel') || section.querySelector('.gene-legend');
    if (anchor) section.insertBefore(panel, anchor);
    else section.appendChild(panel);

    wire();
    state.mounted = true;
    try { console.log('[gene-scanner] Panel montado en #intel-genetics'); } catch (e) {}
    return true;
  }

  /* ==========================================================
     Utilidades
     ========================================================== */
  function $(id) { return document.getElementById(id); }

  function toast(msg, kind) {
    if (typeof window.showToast === 'function') window.showToast(msg, kind);
  }

  function setStatus(text, kind) {
    var el = $('scan-status');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'scan-status' + (kind ? ' is-' + kind : '');
  }

  // Mete la genética en la calculadora reutilizando el input + botón de intel.js.
  function addGeneToCalc(seq) {
    var input = $('gene-input');
    var btn = $('gene-add-btn');
    if (!input || !btn) { toast('No encuentro la calculadora de genéticas.'); return false; }
    input.value = seq;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    btn.click();
    return true;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.onload = resolve;
      s.onerror = function () { reject(new Error('No se pudo descargar el motor de lectura (¿sin internet o CDN bloqueado?).')); };
      document.head.appendChild(s);
    });
  }

  /* ==========================================================
     OCR
     ========================================================== */
  async function getWorker() {
    if (state.worker) return state.worker;
    if (!window.Tesseract) {
      setStatus('Descargando el motor de lectura (sólo la primera vez)…', 'work');
      await loadScript(TESSERACT_CDN);
    }
    if (!window.Tesseract) throw new Error('El motor de lectura no cargó.');
    setStatus('Preparando el motor de lectura…', 'work');
    var worker = await window.Tesseract.createWorker('eng', 1, { legacyCore: false });
    state.worker = worker;
    state.lastPsm = null;
    return worker;
  }

  async function setPsm(worker, psm) {
    if (state.lastPsm === psm) return;
    await worker.setParameters({
      tessedit_pageseg_mode: psm,
      preserve_interword_spaces: '0'
      // Nota: el whitelist NO se aplica con el motor LSTM (OEM 1), así que
      // no lo ponemos: la limpieza real la hace correct()/tokenToGene().
    });
    state.lastPsm = psm;
  }

  // Recorta la zona, escala y binariza.
  //
  // CLAVE: binarizamos por CANAL MÁXIMO, no por luminancia. En Rust las
  // letras son de colores (G verde, Y amarilla, H roja, W AZUL, X gris).
  // Con luminancia el azul pesa 0.114 y la W desaparecía del todo.
  function preprocess(source, sw, sh, threshold) {
    var thr = typeof threshold === 'number' ? threshold : state.threshold;
    var r = state.region;
    var sx = 0, sy = 0, cw = sw, ch = sh;
    if (r) {
      sx = Math.round(r.x * sw); sy = Math.round(r.y * sh);
      cw = Math.round(r.w * sw); ch = Math.round(r.h * sh);
    }
    if (cw < 8 || ch < 8) { sx = 0; sy = 0; cw = sw; ch = sh; }

    // Escalar: el OCR necesita letras grandes. Cuanto más pequeño el
    // recorte, más lo agrandamos (topamos para no petar memoria).
    var scale = cw < 400 ? 5 : cw < 800 ? 4 : cw < 1400 ? 3 : 2;
    var canvas = document.createElement('canvas');
    canvas.width = cw * scale; canvas.height = ch * scale;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height);

    var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var maxc = d[i] > d[i + 1] ? d[i] : d[i + 1];
      if (d[i + 2] > maxc) maxc = d[i + 2];
      var v = maxc > thr ? 0 : 255;   // letra clara -> negro; fondo -> blanco
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function correct(token) {
    var out = '';
    for (var i = 0; i < token.length; i++) {
      var c = token[i];
      if (VALID.indexOf(c) !== -1) { out += c; continue; }
      var fix = FIXES[c];
      if (!fix) return null;
      out += fix;
    }
    return out;
  }

  // Acepta un token si tiene 6 chars y al menos 4 ya eran genes válidos.
  function tokenToGene(raw) {
    var t = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    var candidates = [];
    if (t.length === 6) candidates.push(t);
    else if (t.length > 6 && t.length <= 14) {
      for (var s = 0; s + 6 <= t.length; s++) candidates.push(t.substr(s, 6));
    }
    for (var k = 0; k < candidates.length; k++) {
      var c = candidates[k], already = 0;
      for (var i = 0; i < 6; i++) if (VALID.indexOf(c[i]) !== -1) already++;
      if (already >= 4) { var g = correct(c); if (g) return g; }
    }
    return null;
  }

  function extractWords(data) {
    if (data.words && data.words.length) return data.words;
    var words = [];
    (data.blocks || []).forEach(function (b) {
      (b.paragraphs || []).forEach(function (p) {
        (p.lines || []).forEach(function (l) {
          (l.words || []).forEach(function (w) { words.push(w); });
        });
      });
    });
    if (words.length) return words;
    return (data.text || '').split(/\s+/).map(function (t) {
      return { text: t, confidence: data.confidence || 0 };
    });
  }

  function showDebug(canvas, rawText, info) {
    var box = $('scan-debug-box');
    if (!box || !state.debug) return;
    box.classList.remove('is-hidden');
    var holder = $('scan-debug-canvas');
    holder.innerHTML = '';
    // Copia reducida para no reventar el layout.
    var prev = document.createElement('canvas');
    var maxW = 900;
    var k = Math.min(1, maxW / canvas.width);
    prev.width = Math.round(canvas.width * k);
    prev.height = Math.round(canvas.height * k);
    prev.getContext('2d').drawImage(canvas, 0, 0, prev.width, prev.height);
    holder.appendChild(prev);
    $('scan-debug-text').textContent = (info ? '[' + info + ']\n' : '') + (rawText || '(vacío)');
  }

  // Una pasada de OCR sobre un canvas ya binarizado.
  async function ocrPass(canvas, psm) {
    var worker = await getWorker();
    await setPsm(worker, psm);
    var res = await worker.recognize(canvas);
    var words = extractWords(res.data);
    var hits = [];
    words.forEach(function (w) {
      var gene = tokenToGene(w.text);
      if (!gene) return;
      var conf = typeof w.confidence === 'number' ? w.confidence : 0;
      if (conf < 30) return;
      hits.push({ gene: gene, conf: conf });
    });
    return { hits: hits, raw: res.data.text || '' };
  }

  // Escanea una fuente (vídeo o imagen) probando varias pasadas hasta
  // que alguna encuentre genes.
  async function scanSource(source, sw, sh) {
    var found = 0, lastCanvas = null, lastRaw = '', usedInfo = '';

    for (var i = 0; i < PASSES.length; i++) {
      var p = PASSES[i];
      var thr = p.thr === null ? state.threshold : p.thr;
      var canvas = preprocess(source, sw, sh, thr);
      setStatus('Leyendo… (intento ' + (i + 1) + '/' + PASSES.length + ')', 'work');

      var out = await ocrPass(canvas, p.psm);
      lastCanvas = canvas; lastRaw = out.raw;
      usedInfo = 'umbral ' + thr + ' · psm ' + p.psm;

      if (out.hits.length) {
        out.hits.forEach(function (h) {
          found++;
          var prev = state.detected[h.gene];
          if (!prev || h.conf > prev.conf) state.detected[h.gene] = { conf: h.conf };
        });
        break; // esta pasada ha funcionado, no hace falta seguir
      }
    }

    showDebug(lastCanvas, lastRaw, usedInfo);
    try {
      console.log('[gene-scanner] ' + usedInfo + ' · genes=' + found + ' · OCR bruto:', JSON.stringify(lastRaw));
    } catch (e) {}

    renderDetected();
    return found;
  }

  /* ==========================================================
     Lista de detectadas
     ========================================================== */
  function cellHTML(l) { return '<span class="gene-cell scan-cell-' + l + '">' + l + '</span>'; }
  function confClass(c) { return c >= 85 ? 'is-high' : c >= 65 ? 'is-mid' : 'is-low'; }

  function renderDetected() {
    var box = $('scan-detected');
    if (!box) return;
    box.innerHTML = '';
    var keys = Object.keys(state.detected).sort(function (a, b) {
      return state.detected[b].conf - state.detected[a].conf;
    });

    var head = document.createElement('div');
    head.className = 'scan-detected-head';
    head.textContent = keys.length ? 'Detectadas (' + keys.length + ')' : 'Aún no hay genéticas detectadas';
    box.appendChild(head);

    if (!keys.length) {
      var hint = document.createElement('div');
      hint.className = 'scan-empty';
      hint.textContent = 'Deja las genéticas a la vista en Rust y escanea. Si no salen, activa el modo diagnóstico.';
      box.appendChild(hint);
      return;
    }

    keys.forEach(function (seq) {
      var conf = state.detected[seq].conf;
      var row = document.createElement('div');
      row.className = 'scan-chip';

      var seqEl = document.createElement('div');
      seqEl.className = 'gene-seq';
      seqEl.innerHTML = seq.split('').map(cellHTML).join('');
      row.appendChild(seqEl);

      var confEl = document.createElement('span');
      confEl.className = 'scan-conf ' + confClass(conf);
      confEl.textContent = Math.round(conf) + '%';
      confEl.title = 'Confianza de la lectura';
      row.appendChild(confEl);

      var add = document.createElement('button');
      add.type = 'button'; add.className = 'scan-add'; add.textContent = '+ Añadir';
      add.title = 'Púlsalo una vez por cada planta que tengas con esta genética';
      add.addEventListener('click', function () {
        if (addGeneToCalc(seq)) toast('Genética ' + seq + ' añadida', 'success');
      });
      row.appendChild(add);

      var x = document.createElement('button');
      x.type = 'button'; x.className = 'scan-x'; x.textContent = '✕';
      x.title = 'Descartar';
      x.addEventListener('click', function () { delete state.detected[seq]; renderDetected(); });
      row.appendChild(x);

      box.appendChild(row);
    });

    var all = document.createElement('button');
    all.type = 'button'; all.className = 'scan-btn scan-add-all';
    all.textContent = '+ Añadir las ' + keys.length + ' a la calculadora';
    all.addEventListener('click', function () {
      var n = 0;
      keys.forEach(function (seq) { if (addGeneToCalc(seq)) n++; });
      toast(n + ' genéticas añadidas', 'success');
    });
    box.appendChild(all);
  }

  /* ==========================================================
     Modo pantalla
     ========================================================== */
  async function startScreen() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      setStatus('Tu navegador no permite compartir pantalla aquí. ¿La web está en HTTPS o localhost? Usa "Subir captura".', 'err');
      return;
    }
    try {
      state.stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
    } catch (e) {
      setStatus('Captura de pantalla cancelada.', 'idle');
      return;
    }
    var video = $('scan-video');
    video.srcObject = state.stream;
    try { await video.play(); } catch (e) {}
    state.mode = 'screen';
    $('scan-stage').classList.add('is-live');
    $('scan-share-btn').classList.add('is-hidden');
    $('scan-stop-btn').classList.remove('is-hidden');
    $('scan-shot-btn').classList.remove('is-hidden');
    $('scan-auto-wrap').classList.remove('is-hidden');
    setStatus('Compartiendo. Marca la zona arrastrando y pulsa "Escanear ahora".', 'ok');
    state.stream.getVideoTracks()[0].addEventListener('ended', stopScreen);
  }

  function stopScreen() {
    if (state.stream) { state.stream.getTracks().forEach(function (t) { t.stop(); }); state.stream = null; }
    stopAuto();
    var video = $('scan-video');
    if (video) video.srcObject = null;
    state.mode = null;
    if ($('scan-stage')) $('scan-stage').classList.remove('is-live');
    if ($('scan-share-btn')) $('scan-share-btn').classList.remove('is-hidden');
    if ($('scan-stop-btn')) $('scan-stop-btn').classList.add('is-hidden');
    if ($('scan-shot-btn')) $('scan-shot-btn').classList.add('is-hidden');
    if ($('scan-auto-wrap')) $('scan-auto-wrap').classList.add('is-hidden');
    setStatus('Captura detenida.', 'idle');
  }

  async function shootScreen() {
    if (!state.stream || state.busy) return;
    var video = $('scan-video');
    if (!video.videoWidth) return;
    state.busy = true;
    try {
      var n = await scanSource(video, video.videoWidth, video.videoHeight);
      setStatus(n ? '✅ ' + n + ' genéticas leídas en este fotograma.'
                  : '❌ Sin genéticas. Marca la zona arrastrando, o mira el modo diagnóstico.', n ? 'ok' : 'warn');
    } catch (e) {
      setStatus(e.message || 'Fallo al leer la pantalla.', 'err');
      try { console.error('[gene-scanner]', e); } catch (er) {}
    } finally { state.busy = false; }
  }

  function startAuto() {
    stopAuto();
    state.loopTimer = setInterval(function () {
      if (!state.busy && state.stream) shootScreen();
    }, 2000);
  }
  function stopAuto() {
    if (state.loopTimer) clearInterval(state.loopTimer);
    state.loopTimer = null;
    var chk = $('scan-auto');
    if (chk) chk.checked = false;
  }

  /* ==========================================================
     Modo imagen
     ========================================================== */
  function handleImage(file) {
    if (!file || !/^image\//.test(file.type)) { toast('Eso no es una imagen.'); return; }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = async function () {
      $('scan-image').src = url;
      $('scan-stage').classList.add('is-image');
      state.mode = 'image';
      state.lastImage = img;
      if (state.busy) return;
      state.busy = true;
      try {
        var n = await scanSource(img, img.naturalWidth, img.naturalHeight);
        setStatus(n ? '✅ ' + n + ' genéticas leídas en la captura.'
                    : '❌ Sin genéticas. Marca la zona arrastrando sobre la vista previa y vuelve a escanear, o activa el modo diagnóstico.', n ? 'ok' : 'warn');
      } catch (e) {
        setStatus(e.message || 'Fallo al leer la imagen.', 'err');
        try { console.error('[gene-scanner]', e); } catch (er) {}
      } finally { state.busy = false; }
    };
    img.onerror = function () { toast('No he podido abrir esa imagen.'); };
    img.src = url;
  }

  // Re-escanear la imagen ya cargada (tras marcar zona o cambiar umbral).
  async function rescanImage() {
    if (!state.lastImage || state.busy) return;
    state.busy = true;
    try {
      var img = state.lastImage;
      var n = await scanSource(img, img.naturalWidth, img.naturalHeight);
      setStatus(n ? '✅ ' + n + ' genéticas leídas.' : '❌ Sin genéticas en esa zona.', n ? 'ok' : 'warn');
    } catch (e) {
      setStatus(e.message || 'Fallo al leer la imagen.', 'err');
    } finally { state.busy = false; }
  }

  /* ==========================================================
     Selección de zona (arrastrar)
     ========================================================== */
  function setupRegion() {
    var stage = $('scan-stage');
    var box = $('scan-region');
    if (!stage || !box) return;
    var dragging = false, start = null;

    // La imagen/vídeo usa object-fit:contain: hay bandas negras. Hay que
    // convertir las coordenadas del stage a coordenadas del contenido real,
    // o la zona marcada no se corresponde con lo que se recorta.
    function contentRect() {
      var r = stage.getBoundingClientRect();
      var nw = 0, nh = 0;
      if (state.mode === 'screen') {
        var v = $('scan-video'); nw = v.videoWidth; nh = v.videoHeight;
      } else if (state.mode === 'image' && state.lastImage) {
        nw = state.lastImage.naturalWidth; nh = state.lastImage.naturalHeight;
      }
      if (!nw || !nh) return { left: r.left, top: r.top, width: r.width, height: r.height };
      var k = Math.min(r.width / nw, r.height / nh);
      var w = nw * k, h = nh * k;
      return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
    }

    function pt(e) {
      var c = contentRect();
      return {
        x: Math.min(Math.max((e.clientX - c.left) / c.width, 0), 1),
        y: Math.min(Math.max((e.clientY - c.top) / c.height, 0), 1)
      };
    }
    function draw(a, b) {
      var c = contentRect();
      var sr = stage.getBoundingClientRect();
      var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      var w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
      // pasar de fracción-del-contenido a % del stage (para pintar el recuadro)
      var px = ((c.left - sr.left) + x * c.width) / sr.width;
      var py = ((c.top - sr.top) + y * c.height) / sr.height;
      box.style.left = (px * 100) + '%'; box.style.top = (py * 100) + '%';
      box.style.width = (w * c.width / sr.width * 100) + '%';
      box.style.height = (h * c.height / sr.height * 100) + '%';
      box.classList.remove('is-hidden');
      return { x: x, y: y, w: w, h: h };
    }

    stage.addEventListener('pointerdown', function (e) {
      if (!state.mode) return;
      dragging = true; start = pt(e);
      try { stage.setPointerCapture(e.pointerId); } catch (er) {}
    });
    stage.addEventListener('pointermove', function (e) { if (dragging) draw(start, pt(e)); });
    stage.addEventListener('pointerup', function (e) {
      if (!dragging) return;
      dragging = false;
      var r = draw(start, pt(e));
      if (r.w < 0.02 || r.h < 0.02) {
        state.region = null; box.classList.add('is-hidden');
        $('scan-region-clear').classList.add('is-hidden');
        setStatus('Zona quitada: se leerá la imagen entera.', 'idle');
      } else {
        state.region = r; $('scan-region-clear').classList.remove('is-hidden');
        setStatus('Zona marcada. Sólo se leerá ese recuadro.', 'ok');
        if (state.mode === 'image') rescanImage();
      }
    });
    $('scan-region-clear').addEventListener('click', function () {
      state.region = null; box.classList.add('is-hidden');
      $('scan-region-clear').classList.add('is-hidden');
      setStatus('Zona quitada: se leerá la imagen entera.', 'idle');
    });
  }

  /* ==========================================================
     Wiring
     ========================================================== */
  function wire() {
    setupRegion();
    renderDetected();
    setStatus('Listo. Comparte la pantalla o sube una captura.', 'idle');

    $('scan-share-btn').addEventListener('click', startScreen);
    $('scan-stop-btn').addEventListener('click', stopScreen);
    $('scan-shot-btn').addEventListener('click', shootScreen);
    $('scan-auto').addEventListener('change', function (e) { e.target.checked ? startAuto() : stopAuto(); });

    $('scan-thr').addEventListener('input', function (e) {
      state.threshold = parseInt(e.target.value, 10) || 110;
      $('scan-thr-val').textContent = state.threshold;
    });
    $('scan-thr').addEventListener('change', function () {
      if (state.mode === 'image') rescanImage();
    });

    $('scan-debug').addEventListener('change', function (e) {
      state.debug = e.target.checked;
      $('scan-debug-box').classList.toggle('is-hidden', !state.debug);
    });

    $('scan-file').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) handleImage(e.target.files[0]);
      e.target.value = '';
    });
    $('scan-clear-btn').addEventListener('click', function () {
      state.detected = {}; renderDetected(); setStatus('Lecturas borradas.', 'idle');
    });

    document.addEventListener('paste', function (e) {
      var panel = $('scan-panel');
      if (!panel || panel.offsetParent === null) return;
      var items = (e.clipboardData || {}).items || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') === 0) { handleImage(items[i].getAsFile()); e.preventDefault(); return; }
      }
    });

    var drop = $('scan-drop-zone');
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
    });
    drop.addEventListener('drop', function (e) {
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleImage(f);
    });

    window.addEventListener('beforeunload', stopScreen);
  }

  /* ==========================================================
     Arranque
     ========================================================== */
  function boot() {
    injectCSS();
    if (mount()) return;

    var obs = new MutationObserver(function () {
      if (mount()) obs.disconnect();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (mount() || tries > 60) { clearInterval(timer); if (state.mounted) obs.disconnect(); }
    }, 300);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
