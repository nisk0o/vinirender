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
// El OCR lo hace Tesseract.js, cargado bajo demanda desde CDN
// (no se descarga nada hasta que el usuario pulsa "Escanear").
//
// Depende de window.GeneCalc (lo expone intel.js) para añadir
// las genéticas detectadas a la calculadora.
// ============================================================
(function () {
  'use strict';

  var TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  var VALID = 'GYHWX';

  // Confusiones típicas del OCR con la tipografía de Rust.
  // Sólo se aplican a caracteres que NO son ya un gen válido.
  var FIXES = {
    V: 'Y', U: 'Y', T: 'Y', '4': 'Y', '7': 'Y', '¥': 'Y',
    M: 'W', N: 'W', VV: 'W',
    K: 'X', '×': 'X', '%': 'X', '*': 'X',
    '6': 'G', C: 'G', O: 'G', '0': 'G', Q: 'G', '9': 'G',
    R: 'H', A: 'H', '#': 'H'
  };

  var state = {
    tesseractReady: false,
    worker: null,
    stream: null,
    video: null,
    loopTimer: null,
    busy: false,
    region: null,      // {x,y,w,h} en % del vídeo, o null = pantalla entera
    detected: {},      // seq -> { conf, seen }
    mode: null         // 'screen' | 'image' | null
  };

  /* ---------- utilidades ---------- */

  function $(id) { return document.getElementById(id); }

  function toast(msg, kind) {
    if (typeof showToast === 'function') showToast(msg, kind);
  }

  function setStatus(text, kind) {
    var el = $('scan-status');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'scan-status' + (kind ? ' is-' + kind : '');
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
      // Charset amplio: si sólo permitiéramos GYHWX, cualquier texto de la
      // pantalla se "convertiría" en genes y saldrían falsos positivos.
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      tessedit_pageseg_mode: '11' // sparse text: busca texto suelto por toda la imagen
    });

    state.worker = worker;
    state.tesseractReady = true;
    return worker;
  }

  /* ---------- preprocesado de imagen ---------- */

  // Recorta la región elegida, escala x2 y sube el contraste.
  // Las letras de Rust son claras sobre fondo oscuro, así que
  // binarizamos a blanco/negro para que el OCR lo tenga fácil.
  function preprocess(source, sw, sh) {
    var r = state.region;
    var sx = 0, sy = 0, cw = sw, ch = sh;
    if (r) {
      sx = Math.round(r.x * sw);
      sy = Math.round(r.y * sh);
      cw = Math.round(r.w * sw);
      ch = Math.round(r.h * sh);
    }
    if (cw < 8 || ch < 8) { sx = 0; sy = 0; cw = sw; ch = sh; }

    var scale = cw < 900 ? 3 : 2; // recortes pequeños necesitan más zoom
    var canvas = document.createElement('canvas');
    canvas.width = cw * scale;
    canvas.height = ch * scale;

    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height);

    var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      // Texto claro sobre HUD oscuro → todo lo que pase el umbral es texto.
      var v = lum > 140 ? 0 : 255; // negro sobre blanco (lo que mejor lee Tesseract)
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  /* ---------- parseo de resultados ---------- */

  function correct(token) {
    var out = '';
    for (var i = 0; i < token.length; i++) {
      var c = token[i];
      if (VALID.indexOf(c) !== -1) { out += c; continue; }
      var fix = FIXES[c];
      if (!fix) return null; // carácter irrecuperable → no es una genética
      out += fix;
    }
    return out;
  }

  // Un token es candidato si mide 6 y al menos 4 de sus letras ya eran
  // genes válidos antes de corregir. Así "MOSCOW" no se cuela como genética.
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
      if (conf < 40) return; // demasiado dudoso
      found++;
      var prev = state.detected[gene];
      if (!prev || conf > prev.conf) state.detected[gene] = { conf: conf };
    });

    renderDetected();
    return found;
  }

  /* ---------- lista de detectadas ---------- */

  function confClass(c) {
    if (c >= 85) return 'is-high';
    if (c >= 65) return 'is-mid';
    return 'is-low';
  }

  function renderDetected() {
    var box = $('scan-detected');
    if (!box) return;
    box.innerHTML = '';

    var keys = Object.keys(state.detected).sort(function (a, b) {
      return state.detected[b].conf - state.detected[a].conf;
    });

    var head = document.createElement('div');
    head.className = 'scan-detected-head';
    head.textContent = keys.length
      ? 'Detectadas (' + keys.length + ')'
      : 'Aún no hay genéticas detectadas';
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
      add.type = 'button';
      add.className = 'scan-add';
      add.textContent = '+ Añadir';
      add.title = 'Púlsalo una vez por cada planta que tengas con esta genética';
      add.addEventListener('click', function () {
        if (window.GeneCalc && window.GeneCalc.add(seq)) {
          toast('Genética ' + seq + ' añadida', 'success');
        }
      });
      row.appendChild(add);

      var drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'scan-drop';
      drop.textContent = '✕';
      drop.title = 'Descartar esta lectura';
      drop.addEventListener('click', function () {
        delete state.detected[seq];
        renderDetected();
      });
      row.appendChild(drop);

      box.appendChild(row);
    });

    var all = document.createElement('button');
    all.type = 'button';
    all.className = 'btn scan-add-all';
    all.textContent = '+ Añadir las ' + keys.length + ' a la calculadora';
    all.addEventListener('click', function () {
      var n = 0;
      keys.forEach(function (seq) {
        if (window.GeneCalc && window.GeneCalc.add(seq)) n++;
      });
      toast(n + ' genéticas añadidas a la calculadora', 'success');
    });
    box.appendChild(all);
  }

  /* ---------- modo A: compartir pantalla ---------- */

  async function startScreen() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      toast('Tu navegador no permite compartir pantalla. Usa la pestaña "Subir captura".');
      return;
    }
    try {
      state.stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5 },
        audio: false
      });
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
    setStatus('Compartiendo pantalla. Abre el inventario en Rust y pulsa "Escanear ahora".', 'ok');

    state.stream.getVideoTracks()[0].addEventListener('ended', stopScreen);
  }

  function stopScreen() {
    if (state.stream) {
      state.stream.getTracks().forEach(function (t) { t.stop(); });
      state.stream = null;
    }
    stopAuto();
    var video = $('scan-video');
    if (video) video.srcObject = null;
    state.mode = null;
    $('scan-stage').classList.remove('is-live');
    $('scan-share-btn').classList.remove('is-hidden');
    $('scan-stop-btn').classList.add('is-hidden');
    $('scan-shot-btn').classList.add('is-hidden');
    $('scan-auto-wrap').classList.add('is-hidden');
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
      setStatus(n ? 'Lectura hecha: ' + n + ' genéticas encontradas en este fotograma.'
                  : 'No he encontrado genéticas. Prueba a acercar el inventario o a marcar una zona.',
                n ? 'ok' : 'warn');
    } catch (e) {
      setStatus(e.message || 'Fallo al leer la pantalla.', 'warn');
    } finally {
      state.busy = false;
    }
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

  /* ---------- modo B: imagen (subir / pegar / arrastrar) ---------- */

  async function handleImage(file) {
    if (!file || !/^image\//.test(file.type)) {
      toast('Eso no es una imagen.');
      return;
    }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = async function () {
      var preview = $('scan-image');
      preview.src = url;
      $('scan-stage').classList.add('is-image');
      state.mode = 'image';
      state.busy = true;
      try {
        var canvas = preprocess(img, img.naturalWidth, img.naturalHeight);
        var n = await scanCanvas(canvas);
        setStatus(n ? 'Lectura hecha: ' + n + ' genéticas encontradas en la captura.'
                    : 'No he encontrado genéticas. Recorta la zona del inventario y vuelve a probar.',
                  n ? 'ok' : 'warn');
      } catch (e) {
        setStatus(e.message || 'Fallo al leer la imagen.', 'warn');
      } finally {
        state.busy = false;
      }
    };
    img.onerror = function () { toast('No he podido abrir esa imagen.'); };
    img.src = url;
  }

  /* ---------- selección de zona ---------- */

  // Arrastrando sobre la previsualización se acota la zona a leer.
  // Acotar mejora muchísimo la precisión y la velocidad.
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
      box.style.left = (x * 100) + '%';
      box.style.top = (y * 100) + '%';
      box.style.width = (w * 100) + '%';
      box.style.height = (h * 100) + '%';
      box.classList.remove('is-hidden');
      return { x: x, y: y, w: w, h: h };
    }

    stage.addEventListener('pointerdown', function (e) {
      if (!state.mode) return;
      dragging = true;
      start = pt(e);
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      draw(start, pt(e));
    });
    stage.addEventListener('pointerup', function (e) {
      if (!dragging) return;
      dragging = false;
      var r = draw(start, pt(e));
      if (r.w < 0.02 || r.h < 0.02) {
        state.region = null;
        box.classList.add('is-hidden');
        setStatus('Zona quitada: se leerá la pantalla entera.', 'idle');
      } else {
        state.region = r;
        $('scan-region-clear').classList.remove('is-hidden');
        setStatus('Zona marcada. Sólo se leerá ese recuadro.', 'ok');
      }
    });

    $('scan-region-clear').addEventListener('click', function () {
      state.region = null;
      box.classList.add('is-hidden');
      $('scan-region-clear').classList.add('is-hidden');
      setStatus('Zona quitada: se leerá la pantalla entera.', 'idle');
    });
  }

  /* ---------- arranque ---------- */

  function init() {
    if (!$('scan-panel')) return;

    setupRegion();
    renderDetected();

    $('scan-share-btn').addEventListener('click', startScreen);
    $('scan-stop-btn').addEventListener('click', stopScreen);
    $('scan-shot-btn').addEventListener('click', shootScreen);

    $('scan-auto').addEventListener('change', function (e) {
      if (e.target.checked) startAuto(); else stopAuto();
    });

    $('scan-file').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) handleImage(e.target.files[0]);
      e.target.value = '';
    });

    // Pegar con Ctrl+V
    document.addEventListener('paste', function (e) {
      var panel = $('scan-panel');
      if (!panel || panel.offsetParent === null) return; // panel no visible
      var items = (e.clipboardData || {}).items || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') === 0) {
          handleImage(items[i].getAsFile());
          e.preventDefault();
          return;
        }
      }
    });

    // Arrastrar y soltar
    var drop = $('scan-drop-zone');
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        drop.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        drop.classList.remove('is-over');
      });
    });
    drop.addEventListener('drop', function (e) {
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleImage(f);
    });

    $('scan-clear-btn').addEventListener('click', function () {
      state.detected = {};
      renderDetected();
      setStatus('Lecturas borradas.', 'idle');
    });

    // Si el usuario cambia de pestaña, cortamos la captura para no
    // dejar la pantalla compartida de fondo.
    window.addEventListener('beforeunload', stopScreen);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
