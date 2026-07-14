# Escáner de genéticas — cómo montarlo

Tres cambios pequeños en ficheros que ya existen, más el fichero nuevo
`public/gene-scanner.js`.

---

## 1. `public/intel.js` — abrir la calculadora al escáner

El escáner necesita poder meter genéticas en la lista. Dentro de `setupGenetics()`,
justo antes de la llave de cierre de la función, añade:

```js
    // Puente para el escáner (gene-scanner.js): le deja añadir
    // genéticas leídas de la pantalla a esta misma lista.
    window.GeneCalc = {
      add: function (seq) {
        var val = normalizeGeneInput(seq);
        if (val.length !== 6) return false;
        genePlants.push(val);      // los duplicados cuentan: dos plantas iguales pesan doble
        renderGeneList();
        renderGeneResults(null);
        return true;
      },
      count: function () { return genePlants.length; }
    };
```

---

## 2. `index.html` — el panel del escáner

### 2a. Bloque HTML

Pégalo dentro de `<div class="intel-section" id="intel-genetics">`, **justo antes**
de `<div class="gene-input-panel">` (línea 1233), para que quede encima del
formulario manual:

```html
        <!-- ESCÁNER DE PANTALLA -->
        <div class="scan-panel" id="scan-panel">
          <div class="scan-head">
            <span class="scan-title">📷 Leer las genéticas de la pantalla</span>
            <span class="scan-badge">Sólo en PC</span>
          </div>
          <div class="scan-help">
            Comparte la ventana de Rust, abre el inventario con las semillas a la vista
            y pulsa <strong>Escanear ahora</strong>. Esto sólo mira la imagen de tu
            pantalla, igual que OBS: no toca el juego ni sus ficheros.
            <br>Truco: <strong>arrastra sobre la vista previa</strong> para marcar sólo la
            zona del inventario. Acierta mucho más.
          </div>

          <div class="scan-controls">
            <button class="btn" id="scan-share-btn" type="button">Compartir pantalla</button>
            <button class="btn is-hidden" id="scan-shot-btn" type="button">🔍 Escanear ahora</button>
            <button class="gene-clear-btn is-hidden" id="scan-stop-btn" type="button">Dejar de compartir</button>

            <label class="scan-file-btn">
              🖼️ Subir captura
              <input type="file" id="scan-file" accept="image/*" hidden />
            </label>

            <label class="scan-auto-wrap is-hidden" id="scan-auto-wrap">
              <input type="checkbox" id="scan-auto" /> Escanear solo cada 2,5 s
            </label>

            <button class="gene-clear-btn is-hidden" id="scan-region-clear" type="button">Quitar zona</button>
          </div>

          <div class="scan-drop-zone" id="scan-drop-zone">
            <div class="scan-stage" id="scan-stage">
              <video id="scan-video" muted playsinline></video>
              <img id="scan-image" alt="" />
              <div class="scan-region is-hidden" id="scan-region"></div>
              <div class="scan-placeholder">
                Arrastra aquí una captura, pégala con <kbd>Ctrl</kbd>+<kbd>V</kbd>,
                o comparte la pantalla para leerla en directo.
              </div>
            </div>
          </div>

          <div class="scan-status" id="scan-status"></div>
          <div class="scan-detected" id="scan-detected"></div>
          <button class="gene-clear-btn" id="scan-clear-btn" type="button">Borrar lecturas</button>
        </div>
```

### 2b. Script

Al final, junto a los otros (línea ~1470):

```html
<script src="/gene-scanner.js"></script>
```

Va **después** de `/intel.js`, que es quien crea `window.GeneCalc`.

### 2c. CSS

Dentro del `<style>` que ya tienes, al lado de las reglas `.gene-*`:

```css
/* --- Escáner de genéticas --- */
.scan-panel { background: var(--color-bg-raised); border: 1px solid var(--color-metal); border-radius: var(--radius-md); padding: 1.1rem 1.2rem; margin-bottom: 1rem; }
.scan-head { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.5rem; }
.scan-title { font-family: var(--font-display); font-size: 1.05rem; letter-spacing: 0.04em; }
.scan-badge { font-family: var(--font-mono); font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; padding: 0.2rem 0.45rem; border-radius: 999px; background: rgba(230,0,126,0.15); color: var(--color-fucsia-glow); border: 1px solid rgba(230,0,126,0.4); }
.scan-help { font-size: 0.82rem; color: var(--color-text-faint); line-height: 1.5; margin-bottom: 0.9rem; }
.scan-help kbd { font-family: var(--font-mono); font-size: 0.72rem; background: rgba(255,255,255,0.08); border: 1px solid var(--color-metal); border-radius: 3px; padding: 0.05rem 0.25rem; }

.scan-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-bottom: 0.9rem; }
.scan-file-btn { font-family: var(--font-mono); font-size: 0.75rem; padding: 0.5rem 0.8rem; border: 1px solid var(--color-metal); border-radius: var(--radius-sm, 6px); cursor: pointer; color: var(--color-text-faint); }
.scan-file-btn:hover { border-color: var(--color-fucsia); color: #fff; }
.scan-auto-wrap { font-size: 0.78rem; color: var(--color-text-faint); display: flex; align-items: center; gap: 0.35rem; cursor: pointer; }

.scan-drop-zone { border: 1px dashed var(--color-metal); border-radius: var(--radius-md); padding: 0.4rem; transition: border-color 0.15s; }
.scan-drop-zone.is-over { border-color: var(--color-fucsia); background: rgba(230,0,126,0.06); }

.scan-stage { position: relative; aspect-ratio: 16 / 9; background: #000; border-radius: 6px; overflow: hidden; display: flex; align-items: center; justify-content: center; cursor: crosshair; touch-action: none; }
.scan-stage video, .scan-stage img { width: 100%; height: 100%; object-fit: contain; display: none; }
.scan-stage.is-live video { display: block; }
.scan-stage.is-image img { display: block; }
.scan-stage.is-live .scan-placeholder,
.scan-stage.is-image .scan-placeholder { display: none; }
.scan-placeholder { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; padding: 1.5rem; font-size: 0.82rem; color: var(--color-text-faint); pointer-events: none; }

.scan-region { position: absolute; border: 2px solid var(--color-fucsia); background: rgba(230,0,126,0.12); pointer-events: none; }

.scan-status { font-family: var(--font-mono); font-size: 0.75rem; margin: 0.8rem 0 0.4rem; min-height: 1.1em; color: var(--color-text-faint); }
.scan-status.is-ok { color: #7ed67e; }
.scan-status.is-warn { color: #ffd400; }
.scan-status.is-work { color: var(--color-fucsia-glow); }

.scan-detected { display: flex; flex-direction: column; gap: 0.45rem; margin-bottom: 0.7rem; }
.scan-detected-head { font-family: var(--font-mono); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-faint); }
.scan-empty { font-size: 0.8rem; color: var(--color-text-faint); }
.scan-chip { display: flex; align-items: center; gap: 0.6rem; background: rgba(255,255,255,0.03); border: 1px solid var(--color-metal); border-radius: var(--radius-sm, 6px); padding: 0.4rem 0.6rem; }
.scan-conf { font-family: var(--font-mono); font-size: 0.7rem; padding: 0.15rem 0.4rem; border-radius: 999px; }
.scan-conf.is-high { color: #7ed67e; background: rgba(76,154,76,0.15); }
.scan-conf.is-mid { color: #ffd400; background: rgba(255,212,0,0.12); }
.scan-conf.is-low { color: #ff8a8a; background: rgba(255,77,77,0.12); }
.scan-add { font-family: var(--font-mono); font-size: 0.72rem; background: none; border: 1px solid var(--color-fucsia); color: var(--color-fucsia-glow); border-radius: 999px; padding: 0.25rem 0.6rem; cursor: pointer; }
.scan-add:hover { background: var(--color-fucsia); color: #fff; }
.scan-drop { background: none; border: none; color: var(--color-text-faint); cursor: pointer; padding: 0.2rem 0.35rem; }
.scan-drop:hover { color: var(--color-danger); }
.scan-add-all { margin-top: 0.3rem; }

.is-hidden { display: none !important; }

@media (max-width: 640px) {
  .scan-panel { display: none; } /* compartir pantalla no existe en móvil */
}
```

> Si `.is-hidden` ya está definido en tu CSS, borra esa línea de aquí.

---

## 3. Fichero nuevo

Copia `gene-scanner.js` a `public/gene-scanner.js`. No hay que instalar nada:
Tesseract.js se descarga del CDN la primera vez que alguien pulsa Escanear
(unos 2-4 MB, luego queda en caché del navegador).

---

## Cómo se usa

1. Rust en **ventana o ventana sin bordes** (en pantalla completa exclusiva el
   navegador a veces no puede capturarla).
2. Pestaña Intel → Genéticas → **Compartir pantalla** → elige la ventana de Rust.
3. Abre el inventario con las semillas visibles.
4. Arrastra sobre la vista previa para marcar la zona del inventario.
5. **Escanear ahora** (o marca el escaneo automático y ve moviendo las semillas).
6. Revisa las lecturas y pulsa **Añadir**.

## Qué esperar del MVP

- Acierta bien con el inventario acotado y el juego a 1080p o más.
- El % de confianza avisa de lecturas dudosas: por debajo de 65 %, compruébala.
- Falsos positivos filtrados: sólo pasan palabras de 6 letras con 4+ genes válidos.
