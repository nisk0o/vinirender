// ============================================================
// VINICUS Y AMIGOS — Escáner de genéticas (estilo rustbreeder)
//
// Lee las genéticas de las semillas/clones directamente de la
// pantalla del juego. NO toca Rust: sólo "mira" la imagen, igual
// que haría OBS. Dos formas de usarlo:
//
//   A) Compartir pantalla (Screen Capture API) → escaneo en vivo
//   B) Subir / pegar / arrastrar una captura
//
// AUTÓNOMO: este fichero se monta solo. Inyecta su propio HTML y
// su propio CSS dentro de la sección de genéticas, y añade las
// lecturas usando el campo (#gene-input) y el botón (#gene-add-btn)
// que ya existen. No hace falta tocar index.html (salvo cargar este
// script) ni intel.js.
//
// Único requisito en index.html, junto a los otros scripts:
//   <script src="/gene-scanner.js"></script>   (después de /intel.js)
// ============================================================
(function () {
  'use strict';

  var TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  var VALID = 'GYHWX';

  // Confusiones típicas del OCR con la tipografía de Rust.
  var FIXES = {
    V: 'Y', U: 'Y', T: 'Y', '4': 'Y', '7': 'Y', '¥': 'Y',
    M: 'W', N: 'W',
    K: 'X', '×': 'X', '%': 'X', '*': 'X',
    '6': 'G', C: 'G', O: 'G', '0': 'G', Q: 'G', '9': 'G',
    R: 'H', A: 'H', '#': 'H'
  };

  var state = {
    worker: null,
    stream: null,
    loopTimer: null,
    busy: false,
    region: null,   // {x,y,w,h} en fracción del vídeo, o null = todo
    detected: {},   // seq -> { conf }
    mode: null      // 'screen' | 'image' | null
  };

  /* ---------- CSS inyectado ---------- */

  var CSS = [
    '.scan-panel{background:var(--color-bg-raised,#1a1a1f);border:1px solid var(--color-metal,#333);border-radius:var(--radius-md,10px);padding:1.1rem 1.2rem;margin-bottom:1rem}',
    '.scan-head{display:flex;align-items:center;gap:.6rem;margin-bottom:.5rem}',
    '.scan-title{font-family:var(--font-display,inherit);font-size:1.05rem;letter-spacing:.04em}',
    '.scan-badge{font-family:var(--font-mono,monospace);font-size:.6rem;text-transform:uppercase;letter-spacing:.08em;padding:.2rem .45rem;border-radius:999px;background:rgba(230,0,126,.15);color:var(--color-fucsia-glow,#ff4fb0);border:1px solid rgba(230,0,126,.4)}',
    '.scan-help{font-size:.82rem;color:var(--color-text-faint,#8a8a92);line-height:1.5;margin-bottom:.9rem}',
    '.scan-help kbd{font-family:var(--font-mono,monospace);font-size:.72rem;background:rgba(255,255,255,.08);border:1px solid var(--color-metal,#333);border-radius:3px;padding:.05rem .25rem}',
    '.scan-controls{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin-bottom:.9rem}',
    '.scan-file-btn{font-family:var(--font-mono,monospace);font-size:.75rem;padding:.5rem .8rem;border:1px solid var(--color-metal,#333);border-radius:6px;cursor:pointer;color:var(--color-text-faint,#8a8a92)}',
    '.scan-file-btn:hover{border-color:var(--color-fucsia,#e6007e);color:#fff}',
    '.scan-auto-wrap{font-size:.78rem;color:var(--color-text-faint,#8a8a92);display:flex;align-items:center;gap:.35rem;cursor:pointer}',
    '.scan-drop-zone{border:1px dashed var(--color-metal,#333);border-radius:var(--radius-md,10px);padding:.4rem;transition:border-color .15s}',
    '.scan-drop-zone.is-over{border-color:var(--color-fucsia,#e6007e);background:rgba(230,0,126,.06)}',
    '.scan-stage{position:relative;aspect-ratio:16/9;background:#000;border-radius:6px;overflow:hidden;display:flex;align-items:center;justify-content:center;cursor:crosshair;touch-action:none}',
    '.scan-stage video,.scan-stage img{width:100%;height:100%;object-fit:contain;display:none}',
    '.scan-stage.is-live video{display:block}',
    '.scan-stage.is-image img{display:block}',
    '.scan-stage.is-live .scan-placeholder,.scan-stage.is-image .scan-placeholder{display:none}',
    '.scan-placeholder{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:1.5rem;font-size:.82rem;color:var(--color-text-faint,#8a8a92);pointer-events:none}',
    '.scan-region{position:absolute;border:2px solid var(--color-fucsia,#e6007e);background:rgba(230,0,126,.12);pointer-events:none}',
    '.scan-status{font-family:var(--font-mono,monospace);font-size:.75rem;margin:.8rem 0 .4rem;min-height:1.1em;color:var(--color-text-faint,#8a8a92)}',
    '.scan-status.is-ok{color:#7ed67e}.scan-status.is-warn{color:#ffd400}.scan-status.is-work{color:var(--color-fucsia-glow,#ff4fb0)}',
    '.scan-detected{display:flex;flex-direction:column;gap:.45rem;margin-bottom:.7rem}',
    '.scan-detected-head{font-family:var(--font-mono,monospace);font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-faint,#8a8a92)}',
    '.scan-empty{font-size:.8rem;color:var(--color-text-faint,#8a8a92)}',
    '.scan-chip{display:flex;align-items:center;gap:.6rem;background:rgba(255,255,255,.03);border:1px solid var(--color-metal,#333);border-radius:6px;padding:.4rem .6rem}',
    '.scan-conf{font-family:var(--font-mono,monospace);font-size:.7rem;padding:.15rem .4rem;border-radius:999px}',
    '.scan-conf.is-high{color:#7ed67e;background:rgba(76,154,76,.15)}.scan-conf.is-mid{color:#ffd400;background:rgba(255,212,0,.12)}.scan-conf.is-low{color:#ff8a8a;background:rgba(255,77,77,.12)}',
    '.scan-add{font-family:var(--font-mono,monospace);font-size:.72rem;background:none;border:1px solid var(--color-fucsia,#e6007e);color:var(--color-fucsia-glow,#ff4fb0);border-radius:999px;padding:.25rem .6rem;cursor:pointer}',
    '.scan-add:hover{background:var(--color-fucsia,#e6007e);color:#fff}',
    '.scan-drop{background:none;border:none;color:var(--color-text-faint,#8a8a92);cursor:pointer;padding:.2rem .35rem}',
    '.scan-drop:hover{color:var(--color-danger,#ff4d4d)}',
    '.scan-add-all{margin-top:.3rem}',
    '.scan-panel .is-hidden{display:none!important}',
    '@media(max-width:640px){.scan-panel{display:none}}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('scan-css')) return;
    var st = document.createElement('style');
    st.id = 'scan-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ---------- HTML inyectado ---------- */

  var PANEL_HTML =
    '<div class="scan-head">' +
      '<span class="scan-title">📷 Leer las genéticas de la pantalla</span>' +
      '<span class="scan-badge">Sólo en PC</span>' +
    '</div>' +
    '<div class="scan-help">' +
      'Comparte la ventana de Rust, abre el inventario con las semillas a la vista y pulsa ' +
      '<strong>Escanear ahora</strong>. Esto sólo mira la imagen de tu pantalla, igual que OBS: ' +
      'no toca el juego ni sus ficheros.<br>Truco: <strong>arrastra sobre la vista previa</strong> ' +
      'para marcar sólo la zona del inventario. Acierta mucho más.' +
    '</div>' +
    '<div class="scan-controls">' +
      '<button class="btn" id="scan-share-btn" type="button">Compartir pantalla</button>' +
      '<button class="btn is-hidden" id="scan-shot-btn" type="button">🔍 Escanear ahora</button>' +
      '<button class="gene-clear-btn is-hidden" id="scan-stop-btn" type="button">Dejar de compartir</button>' +
      '<label class="scan-file-btn">🖼️ Subir captura<input type="file" id="scan-file" accept="image/*" hidden></label>' +
      '<label class="scan-auto-wrap is-hidden" id="scan-auto-wrap"><input type="checkbox" id="scan-auto"> Escanear solo cada 2,5 s</label>' +
      '<button class="gene-clear-btn is-hidden" id="scan-region-clear" type="button">Quitar zona</button>' +
    '</div>' +
    '<div class="scan-drop-zone" id="scan-drop-zone">' +
      '<div class="scan-stage" id="scan-stage">' +
        '<video id="scan-video" muted playsinline></video>' +
        '<img id="scan-image" alt="">' +
        '<div class="scan-region is-hidden" id="scan-region"></div>' +
        '<div class="scan-placeholder">Arrastra aquí una captura, pégala con <kbd>Ctrl</kbd>+<kbd>V</kbd>, o comparte la pantalla para leerla en directo.</div>' +
      '</div>' +
    '</div>' +
    '<div class="scan-status" id="scan-status"></div>' +
    '<div class="scan-detected" id="scan-detected"></div>' +
    '<button class="gene-clear-btn" id="scan-clear-btn" type="button">Borrar lecturas</button>';

  function buildPanel() {
    if (document.getElementById('scan-panel')) return true;
    var section = document.getElementById('intel-genetics');
    if (!section) return false; // la sección aún no existe

    var panel = document.createElement('div');
    panel.className = 'scan-panel';
    panel.id = 'scan-panel';
    panel.innerHTML = PANEL_HTML;

    // Lo colocamos justo encima del formulario manual de genéticas.
    var anchor = section.querySelector('.gene-input-panel');
    if (anchor) section.insertBefore(panel, anchor);
    else section.appendChild(panel);
    return true;
  }

  /* ---------- utilidades ---------- */

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

  // Añade una genética a la calculadora reutilizando el input + botón
  // que ya existen en intel.js. Así no dependemos de ningún puente.
  function addGeneToCalc(seq) {
    var input = $('gene-input');
    var btn = $('gene-add-btn');
    if (!input || !btn) {
      toast('No encuentro la calculadora de genéticas en esta página.');
      return false;
    }
    input.value = seq;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    btn.click();
    return true;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('No se pudo cargar el motor de lectura.')); };
      document.head.appendChild(s);
    });
  }

  /* ---------- motor OCR ---------- */

  async function getWorker() {
    if (state.worker) return state.worker;
    if (!window.Tesseract) {
      setStatus('Descargando el motor de lectura (una sola vez)…', 'work');
      await loadScript(TESSERACT_CDN);
    }
    setStatus('Preparando el motor de lectura…', 'work');
    var worker = await window.Tesseract.createWorker('eng', 1, { legacyCore: false });
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      tessedit_pageseg_mode: '11'
    });
    state.worker = worker;
    return worker;
  }

  /* ---------- preprocesado ---------- */

  function preprocess(source, sw, sh) {
    var r = state.region;
    var sx = 0, sy = 0, cw = sw, ch = sh;
    if (r) {
      sx = Math.round(r.x * sw); sy = Math.round(r.y * sh);
      cw = Math.round(r.w * sw); ch = Math.round(r.h * sh);
    }
    if (cw < 8 || ch < 8) { sx = 0; sy = 0; cw = sw; ch = sh; }

    var scale = cw < 900 ? 3 : 2;
    var canvas = document.createElement('canvas');
    canvas.width = cw * scale; canvas.height = ch * scale;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height);

    var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      var v = lum > 140 ? 0 : 255; // texto claro → negro sobre blanco
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  /* ---------- parseo ---------- */

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

  function tokenToGene(raw) {
    var t = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (t.length !== 6) return null;
    var already = 0;
    for (var i = 0; i < 6; i++) if (VALID.indexOf(t[i]) !== -1) already++;
    if (already < 4) return null;
    return correct(t);
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

  async function scanCanvas(canvas) {
    var worker = await getWorker();
    setStatus('Leyendo la pantalla…', 'work');
    var res = await worker.recognize(canvas);
    var words = extractWords(res.data);
    var found = 0;
    words.forEach(function (w) {
      var gene = tokenToGene(w.text);
      if (!gene) return;
      var conf = typeof w.confidence === 'number' ? w.confidence : 0;
      if (conf < 40) return;
      found++;
      var prev = state.detected[gene];
      if (!prev || conf > prev.conf) state.detected[gene] = { conf: conf };
    });
    renderDetected();
    return found;
  }

  /* ---------- lista detectadas ---------- */

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
      hint.textContent = 'Abre el inventario en Rust con las semillas a la vista y pulsa Escanear.';
      box.appendChild(hint);
      return;
    }

    keys.forEach(function (seq) {
      var conf = state.detected[seq].conf;
      var row = document.createElement('div');
      row.className = 'scan-chip';

      var seqEl = document.createElement('div');
      seqEl.className = 'gene-seq';
      seqEl.innerHTML = seq.split('').map(function (l) {
        return '<span class="gene-cell g-' + l + '">' + l + '</span>';
      }).join('');
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

      var drop = document.createElement('button');
      drop.type = 'button'; drop.className = 'scan-drop'; drop.textContent = '✕';
      drop.title = 'Descartar esta lectura';
      drop.addEventListener('click', function () { delete state.detected[seq]; renderDetected(); });
      row.appendChild(drop);

      box.appendChild(row);
    });

    var all = document.createElement('button');
    all.type = 'button'; all.className = 'btn scan-add-all';
    all.textContent = '+ Añadir las ' + keys.length + ' a la calculadora';
    all.addEventListener('click', function () {
      var n = 0;
      keys.forEach(function (seq) { if (addGeneToCalc(seq)) n++; });
      toast(n + ' genéticas añadidas a la calculadora', 'success');
    });
    box.appendChild(all);
  }

  /* ---------- modo A: pantalla ---------- */

  async function startScreen() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      toast('Tu navegador no permite compartir pantalla. Usa "Subir captura".');
      return;
    }
    try {
      state.stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
    } catch (e) {
      setStatus('Has cancelado la captura de pantalla.', 'idle');
      return;
    }
    var video = $('scan-video');
    video.srcObject = state.stream;
    await video.play();
    state.mode = 'screen';
    $('scan-stage').classList.add('is-live');
    $('scan-share-btn').classList.add('is-hidden');
    $('scan-stop-btn').classList.remove('is-hidden');
    $('scan-shot-btn').classList.remove('is-hidden');
    $('scan-auto-wrap').classList.remove('is-hidden');
    setStatus('Compartiendo pantalla. Abre el inventario y pulsa "Escanear ahora".', 'ok');
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
    setStatus('Captura de pantalla detenida.', 'idle');
  }

  async function shootScreen() {
    if (!state.stream || state.busy) return;
    var video = $('scan-video');
    if (!video.videoWidth) return;
    state.busy = true;
    try {
      var canvas = preprocess(video, video.videoWidth, video.videoHeight);
      var n = await scanCanvas(canvas);
      setStatus(n ? 'Lectura hecha: ' + n + ' genéticas en este fotograma.'
                  : 'No he encontrado genéticas. Acerca el inventario o marca una zona.', n ? 'ok' : 'warn');
    } catch (e) {
      setStatus(e.message || 'Fallo al leer la pantalla.', 'warn');
    } finally { state.busy = false; }
  }

  function startAuto() {
    stopAuto();
    state.loopTimer = setInterval(function () {
      if (!state.busy && state.stream) shootScreen();
    }, 2500);
  }
  function stopAuto() {
    if (state.loopTimer) clearInterval(state.loopTimer);
    state.loopTimer = null;
    var chk = $('scan-auto');
    if (chk) chk.checked = false;
  }

  /* ---------- modo B: imagen ---------- */

  function handleImage(file) {
    if (!file || !/^image\//.test(file.type)) { toast('Eso no es una imagen.'); return; }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = async function () {
      $('scan-image').src = url;
      $('scan-stage').classList.add('is-image');
      state.mode = 'image';
      state.busy = true;
      try {
        var canvas = preprocess(img, img.naturalWidth, img.naturalHeight);
        var n = await scanCanvas(canvas);
        setStatus(n ? 'Lectura hecha: ' + n + ' genéticas en la captura.'
                    : 'No he encontrado genéticas. Recorta la zona del inventario y reintenta.', n ? 'ok' : 'warn');
      } catch (e) {
        setStatus(e.message || 'Fallo al leer la imagen.', 'warn');
      } finally { state.busy = false; }
    };
    img.onerror = function () { toast('No he podido abrir esa imagen.'); };
    img.src = url;
  }

  /* ---------- selección de zona ---------- */

  function setupRegion() {
    var stage = $('scan-stage');
    var box = $('scan-region');
    if (!stage || !box) return;
    var dragging = false, start = null;

    function pt(e) {
      var r = stage.getBoundingClientRect();
      return {
        x: Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1),
        y: Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1)
      };
    }
    function draw(a, b) {
      var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      var w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
      box.style.left = (x * 100) + '%'; box.style.top = (y * 100) + '%';
      box.style.width = (w * 100) + '%'; box.style.height = (h * 100) + '%';
      box.classList.remove('is-hidden');
      return { x: x, y: y, w: w, h: h };
    }
    stage.addEventListener('pointerdown', function (e) {
      if (!state.mode) return;
      dragging = true; start = pt(e); stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', function (e) { if (dragging) draw(start, pt(e)); });
    stage.addEventListener('pointerup', function (e) {
      if (!dragging) return;
      dragging = false;
      var r = draw(start, pt(e));
      if (r.w < 0.02 || r.h < 0.02) {
        state.region = null; box.classList.add('is-hidden');
        setStatus('Zona quitada: se leerá la pantalla entera.', 'idle');
      } else {
        state.region = r; $('scan-region-clear').classList.remove('is-hidden');
        setStatus('Zona marcada. Sólo se leerá ese recuadro.', 'ok');
      }
    });
    $('scan-region-clear').addEventListener('click', function () {
      state.region = null; box.classList.add('is-hidden');
      $('scan-region-clear').classList.add('is-hidden');
      setStatus('Zona quitada: se leerá la pantalla entera.', 'idle');
    });
  }

  /* ---------- wiring ---------- */

  function wire() {
    setupRegion();
    renderDetected();

    $('scan-share-btn').addEventListener('click', startScreen);
    $('scan-stop-btn').addEventListener('click', stopScreen);
    $('scan-shot-btn').addEventListener('click', shootScreen);
    $('scan-auto').addEventListener('change', function (e) { e.target.checked ? startAuto() : stopAuto(); });
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

  /* ---------- arranque robusto ----------
     La sección de genéticas puede montarse después que este script
     (intel.js corre en DOMContentLoaded). Reintentamos hasta que
     exista #intel-genetics, con un tope para no quedar en bucle.  */

  function boot() {
    injectCSS();
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (buildPanel()) {
        clearInterval(timer);
        wire();
      } else if (tries > 40) { // ~10 s
        clearInterval(timer);
      }
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
