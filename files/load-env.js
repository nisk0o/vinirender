// Carga variables desde un archivo .env (si existe) hacia process.env.
// Solo para comodidad en local: en Render (o cualquier host serio)
// las variables de entorno se configuran desde su panel, y este
// archivo no hace nada porque .env no existe ahí.
const fs = require('fs');
const path = require('path');

function loadEnv(file) {
  const envPath = path.join(__dirname, file || '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  });
}

module.exports = loadEnv;
