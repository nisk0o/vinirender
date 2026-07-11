// ============================================================
// VINICUS Y AMIGOS — backend Node.js + Supabase (Postgres)
// ============================================================
// Ejecutar con:  node server.js
// Necesita las variables de entorno SUPABASE_URL y
// SUPABASE_SERVICE_KEY (ver README para cómo obtenerlas).
//
// Los datos ya NO se guardan en un archivo local: viven en tu
// proyecto de Supabase, así que sobreviven a reinicios y
// despliegues, y no dependen de tu ordenador.
// ============================================================

require('./load-env')(); // en local carga .env si existe; en Render no hace nada

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./supabase');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const ROLES = ['Gru', 'Minion menaje', 'Minion fundador', 'Amo de segundo nivel', 'Minion supremo'];

// ---- Amonestaciones y méritos ----
// Faltas (leve = 1, grave = 2): con FAULT_LIMIT puntos en un wipe se
// degrada el rango según DEMOTION_MAP. Méritos (mérito = 1,
// hazaña = 2): con MERIT_LIMIT puntos se asciende según
// PROMOTION_MAP. Cooldown anti-spam: cada miembro (salvo Gru) solo
// puede poner UNA falta o mérito cada POINT_COOLDOWN_MS.
const FAULT_LIMIT = 10;
const MERIT_LIMIT = 10;
const POINT_COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 horas
const DEMOTION_MAP = {
  'Amo de segundo nivel': 'Minion supremo',
  'Minion fundador': 'Minion supremo',
  'Minion supremo': 'Minion menaje'
};
const PROMOTION_MAP = {
  'Minion menaje': 'Minion supremo',
  'Minion supremo': 'Amo de segundo nivel',
  'Minion fundador': 'Amo de segundo nivel'
};

// ------------------------------------------------------------
// Utilidades de contraseña (scrypt + salt, comparación insensible
// a mayúsculas/minúsculas para mantener el comportamiento original)
// ------------------------------------------------------------
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plain).toLowerCase(), salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(plain, salt, hash) {
  const check = crypto.scryptSync(String(plain).toLowerCase(), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(hash, 'hex'));
}

// ------------------------------------------------------------
// Login con Google ("Sign In With Google"). No usamos ninguna
// librería: el botón de Google nos da un JWT firmado (el
// "credential") y aquí lo verificamos a mano con las claves
// públicas de Google (JWKS) usando el módulo nativo "crypto".
// Solo hace falta el GOOGLE_CLIENT_ID (no es secreto, es público).
// ------------------------------------------------------------
let googleJwksCache = { keys: [], fetchedAt: 0 };
async function getGoogleJwks(forceRefresh) {
  const now = Date.now();
  if (!forceRefresh && googleJwksCache.keys.length && (now - googleJwksCache.fetchedAt) < 6 * 60 * 60 * 1000) {
    return googleJwksCache.keys;
  }
  const resp = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!resp.ok) throw new Error('No se pudieron obtener las claves públicas de Google.');
  const data = await resp.json();
  googleJwksCache = { keys: data.keys || [], fetchedAt: now };
  return googleJwksCache.keys;
}
function base64urlToBuffer(str) {
  str = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}
async function verifyGoogleIdToken(credential) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) { const e = new Error('GOOGLE_NOT_CONFIGURED'); throw e; }

  const parts = String(credential || '').split('.');
  if (parts.length !== 3) throw new Error('TOKEN_INVALIDO');
  const [headerB64, payloadB64, sigB64] = parts;

  let header, payload;
  try {
    header = JSON.parse(base64urlToBuffer(headerB64).toString('utf8'));
    payload = JSON.parse(base64urlToBuffer(payloadB64).toString('utf8'));
  } catch (e) { throw new Error('TOKEN_INVALIDO'); }
  if (header.alg !== 'RS256') throw new Error('TOKEN_INVALIDO');

  let keys = await getGoogleJwks();
  let jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) { keys = await getGoogleJwks(true); jwk = keys.find(k => k.kid === header.kid); }
  if (!jwk) throw new Error('TOKEN_INVALIDO');

  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const valid = crypto.verify('RSA-SHA256', Buffer.from(`${headerB64}.${payloadB64}`), publicKey, base64urlToBuffer(sigB64));
  if (!valid) throw new Error('FIRMA_INVALIDA');

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) throw new Error('TOKEN_CADUCADO');
  if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') throw new Error('EMISOR_INVALIDO');
  if (payload.aud !== clientId) throw new Error('AUD_INVALIDO');
  if (!payload.email || payload.email_verified !== true) throw new Error('EMAIL_NO_VERIFICADO');

  return payload; // incluye email, name, picture...
}

// ------------------------------------------------------------
// Semilla inicial de usuarios (solo se inserta si la tabla
// "users" está vacía, es decir, la primera vez que arrancas
// contra un proyecto de Supabase nuevo).
// ------------------------------------------------------------
const SEED_USERS = [
  { username: 'julian',  password: 'julian1997',  alias: 'Jose María',          role: 'Gru' },
  { username: 'gonzalo', password: 'gonzalo2001', alias: 'Bulcaçan Ben Hazuz',  role: 'Minion menaje' },
  { username: 'luciano', password: 'luciano1997', alias: 'Rober Wido',          role: 'Minion menaje' },
  { username: 'xavi',    password: 'xavi1999',    alias: 'Ansufatismo',         role: 'Minion menaje' },
  { username: 'javi',    password: 'javi1997',    alias: 'Antoñete',            role: 'Minion menaje' },
  { username: 'adri',    password: 'adri1997',    alias: 'Lorcon',              role: 'Minion menaje' },
  { username: 'joseca',  password: 'joseca1997',  alias: 'Jose Antonio',        role: 'Minion menaje' },
  { username: 'manu',    password: 'manu1999',    alias: 'Debembem',            role: 'Minion menaje' },
  { username: 'alvaro',  password: 'alvaro1997',  alias: 'Finn2012',            role: 'Minion menaje' }
];

async function ensureSeed() {
  const existing = await db.select('users', 'select=username&limit=1');
  if (existing && existing.length > 0) return;
  console.log('🌱 Tabla "users" vacía: sembrando los miembros iniciales…');
  const rows = SEED_USERS.map(u => {
    const { salt, hash } = hashPassword(u.password);
    return { username: u.username, alias: u.alias, role: u.role, steam_id: '', avatar: null, salt, hash };
  });
  await db.insert('users', rows);
  console.log('✅ Miembros iniciales creados.');
}

// ------------------------------------------------------------
// Mapeo entre columnas de Postgres (snake_case) y el formato
// que usa el resto del servidor / el frontend (camelCase).
// ------------------------------------------------------------
function rowToUser(row) {
  return {
    username: row.username, alias: row.alias, role: row.role,
    steamId: row.steam_id || '', email: row.email || '', avatar: row.avatar || null,
    salt: row.salt, hash: row.hash
  };
}
function publicUser(u) {
  if (!u) return null;
  return { username: u.username, alias: u.alias, role: u.role, steamId: u.steamId || '', email: u.email || '', avatar: u.avatar || null };
}
function rowToNote(row) { return { id: row.id, username: row.username, text: row.text, ts: Number(row.ts) }; }
function rowToImage(row) { return { id: row.id, username: row.username, dataUrl: row.data_url, ts: Number(row.ts) }; }
function rowToRaid(row) { return { id: row.id, structureId: row.structure_id, explosiveKey: row.explosive_key, qty: row.qty }; }
function rowToEnemy(row) { return { id: row.id, serverId: row.server_id, name: row.name, steamId: row.steam_id || '', team: row.team || '', ts: Number(row.ts) }; }
function rowToPoint(row) {
  return {
    id: row.id, wipeId: row.wipe_id, username: row.username,
    kind: row.kind, weight: row.weight, reportedBy: row.reported_by || '',
    appealStatus: row.appeal_status || null, appealText: row.appeal_text || '',
    ts: Number(row.ts)
  };
}

// ------------------------------------------------------------
// Acceso a datos (todo a través de Supabase)
// ------------------------------------------------------------
async function findUser(username) {
  const rows = await db.select('users', `select=*&username=eq.${encodeURIComponent(username)}`);
  return rows && rows[0] ? rowToUser(rows[0]) : null;
}
async function findUserCaseInsensitive(username) {
  const rows = await db.select('users', `select=*&username=ilike.${encodeURIComponent(username)}`);
  return rows && rows[0] ? rowToUser(rows[0]) : null;
}
async function findUserByEmail(email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean) return null;
  const rows = await db.select('users', `select=*&email=eq.${encodeURIComponent(clean)}`);
  return rows && rows[0] ? rowToUser(rows[0]) : null;
}
async function allUsers() {
  const rows = await db.select('users', 'select=*&order=alias.asc');
  return rows.map(rowToUser);
}

// ------------------------------------------------------------
// Sesiones en memoria: token -> username. Se pierden si el
// servidor se reinicia (p.ej. Render "duerme" el servicio en
// el plan gratis tras 15 min sin visitas). El usuario solo
// tiene que volver a iniciar sesión; los datos no se pierden.
// ------------------------------------------------------------
const sessions = new Map();

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

async function getCurrentUser(req) {
  const cookies = parseCookies(req);
  const token = cookies.session;
  if (!token || !sessions.has(token)) return null;
  const username = sessions.get(token);
  return findUser(username);
}

// ------------------------------------------------------------
// Helpers HTTP
// ------------------------------------------------------------
function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 25 * 1024 * 1024) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(new Error('BAD_JSON'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  const full = path.join(PUBLIC_DIR, filePath);
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(full, (err, data) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, data2) => {
        if (err2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(data2);
      });
      return;
    }
    const ext = path.extname(full);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ------------------------------------------------------------
// Rutas de la API
// ------------------------------------------------------------
async function handleApi(req, res, pathname) {
  const method = req.method;
  const user = await getCurrentUser(req);

  function requireAuth() {
    if (!user) { sendJSON(res, 401, { error: 'No has iniciado sesión.' }); return false; }
    return true;
  }
  function requireGru() {
    if (!user || user.role !== 'Gru') { sendJSON(res, 403, { error: 'Solo Gru puede hacer esto.' }); return false; }
    return true;
  }

  // ---- CONFIG (pública, sin login: la usa la pantalla de login) ----
  if (pathname === '/api/config' && method === 'GET') {
    return sendJSON(res, 200, { googleClientId: process.env.GOOGLE_CLIENT_ID || null });
  }

  // ---- AUTH ----
  if (pathname === '/api/auth/login' && method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: 'Petición inválida.' }); }
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const found = await findUserCaseInsensitive(username);
    if (!found || !verifyPassword(password, found.salt, found.hash)) {
      return sendJSON(res, 401, { error: 'Usuario o contraseña incorrectos.' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, found.username);
    res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`);
    return sendJSON(res, 200, { user: publicUser(found) });
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const cookies = parseCookies(req);
    if (cookies.session) sessions.delete(cookies.session);
    res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
    return sendJSON(res, 200, { ok: true });
  }

  if (pathname === '/api/auth/google' && method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: 'Petición inválida.' }); }
    let payload;
    try {
      payload = await verifyGoogleIdToken(body.credential);
    } catch (e) {
      if (e.message === 'GOOGLE_NOT_CONFIGURED') {
        return sendJSON(res, 500, { error: 'El login con Google no está configurado en este servidor todavía.' });
      }
      return sendJSON(res, 401, { error: 'No se pudo verificar el inicio de sesión con Google.' });
    }
    const found = await findUserByEmail(payload.email);
    if (!found) {
      return sendJSON(res, 403, {
        error: 'Ese email de Google (' + payload.email + ') no está vinculado a ningún miembro. Entra con tu usuario y contraseña, y añádelo en tu Taquilla.'
      });
    }
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, found.username);
    res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`);
    return sendJSON(res, 200, { user: publicUser(found) });
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    if (!user) return sendJSON(res, 401, { error: 'No has iniciado sesión.' });
    return sendJSON(res, 200, { user: publicUser(user) });
  }

  // ---- USERS ----
  if (pathname === '/api/users' && method === 'GET') {
    if (!requireAuth()) return;
    const users = await allUsers();
    return sendJSON(res, 200, { users: users.map(publicUser) });
  }

  let m;
  if ((m = pathname.match(/^\/api\/users\/([^/]+)\/role$/)) && method === 'PATCH') {
    if (!requireGru()) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: 'Petición inválida.' }); }
    const targetUsername = decodeURIComponent(m[1]);
    const target = await findUser(targetUsername);
    if (!target) return sendJSON(res, 404, { error: 'Usuario no encontrado.' });
    if (!ROLES.includes(body.role)) return sendJSON(res, 400, { error: 'Rango no válido.' });
    const rows = await db.update('users', `username=eq.${encodeURIComponent(targetUsername)}`, { role: body.role });
    return sendJSON(res, 200, { user: publicUser(rowToUser(rows[0])) });
  }

  if (pathname === '/api/users/me' && method === 'PATCH') {
    if (!requireAuth()) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: 'Petición inválida.' }); }
    const newAlias = String(body.alias || '').trim();
    const newUsername = String(body.username || '').trim();
    const newPassword = body.password ? String(body.password) : '';
    const newSteamId = String(body.steamId || '').trim();
    const newEmail = String(body.email || '').trim().toLowerCase();

    if (!newAlias) return sendJSON(res, 400, { error: 'El alias no puede estar vacío.' });
    if (!newUsername) return sendJSON(res, 400, { error: 'El usuario no puede estar vacío.' });
    if (newSteamId && !/^\d{15,20}$/.test(newSteamId)) {
      return sendJSON(res, 400, { error: 'La SteamID64 debe tener entre 15 y 20 dígitos.' });
    }
    if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      return sendJSON(res, 400, { error: 'Ese email no parece válido.' });
    }
    if (newUsername.toLowerCase() !== user.username.toLowerCase()) {
      const clash = await findUserCaseInsensitive(newUsername);
      if (clash) return sendJSON(res, 400, { error: 'Ese usuario ya lo tiene otro miembro.' });
    }
    if (newEmail) {
      const emailClash = await findUserByEmail(newEmail);
      if (emailClash && emailClash.username.toLowerCase() !== user.username.toLowerCase()) {
        return sendJSON(res, 400, { error: 'Ese email de Google ya lo tiene vinculado otro miembro.' });
      }
    }

    const patch = { alias: newAlias, steam_id: newSteamId, email: newEmail || null };
    if (typeof body.avatar === 'string') patch.avatar = body.avatar || null;
    if (newPassword) {
      const { salt, hash } = hashPassword(newPassword);
      patch.salt = salt; patch.hash = hash;
    }

    const oldUsername = user.username;
    const usernameChanged = oldUsername !== newUsername;

    if (usernameChanged) {
      // El username es la PK: hay que crear la fila nueva y migrar
      // las referencias antes de borrar la antigua (no hay ON UPDATE
      // CASCADE porque cambiamos la PK, así que lo hacemos a mano).
      const fresh = await findUser(oldUsername);
      const newRow = {
        username: newUsername,
        alias: patch.alias,
        role: fresh.role,
        steam_id: patch.steam_id,
        email: patch.email,
        avatar: 'avatar' in patch ? patch.avatar : fresh.avatar,
        salt: patch.salt || fresh.salt,
        hash: patch.hash || fresh.hash
      };
      await db.insert('users', newRow);
      await db.update('board_notes', `username=eq.${encodeURIComponent(oldUsername)}`, { username: newUsername });
      await db.update('hall_images', `username=eq.${encodeURIComponent(oldUsername)}`, { username: newUsername });

      const allSignups = await db.select('wipe_signups', 'select=*');
      for (const s of allSignups) {
        const trios = (s.trios || []).map(u => u === oldUsername ? newUsername : u);
        const main = (s.main || []).map(u => u === oldUsername ? newUsername : u);
        if (trios.join() !== (s.trios || []).join() || main.join() !== (s.main || []).join()) {
          await db.update('wipe_signups', `wipe_id=eq.${encodeURIComponent(s.wipe_id)}`, { trios, main });
        }
      }

      await db.update('wipe_points', `username=eq.${encodeURIComponent(oldUsername)}`, { username: newUsername });
      await db.update('wipe_points', `reported_by=eq.${encodeURIComponent(oldUsername)}`, { reported_by: newUsername });

      await db.remove('users', `username=eq.${encodeURIComponent(oldUsername)}`);

      for (const [tok, uname] of sessions.entries()) {
        if (uname === oldUsername) sessions.set(tok, newUsername);
      }
      return sendJSON(res, 200, { user: publicUser(rowToUser(newRow)) });
    }

    const rows = await db.update('users', `username=eq.${encodeURIComponent(oldUsername)}`, patch);
    return sendJSON(res, 200, { user: publicUser(rowToUser(rows[0])) });
  }

  // ---- TABLÓN ----
  if (pathname === '/api/board' && method === 'GET') {
    if (!requireAuth()) return;
    const rows = await db.select('board_notes', 'select=*&order=ts.desc');
    return sendJSON(res, 200, { notes: rows.map(rowToNote) });
  }
  if (pathname === '/api/board' && method === 'POST') {
    if (!requireAuth()) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: 'Petición inválida.' }); }
    const text = String(body.text || '').trim().slice(0, 280);
    if (!text) return sendJSON(res, 400, { error: 'La nota no puede estar vacía.' });
    const rows = await db.insert('board_notes', { username: user.username, text, ts: Date.now() });
    return sendJSON(res, 201, { note: rowToNote(rows[0]) });
  }
  if ((m = pathname.match(/^\/api\/board\/(\d+)$/)) && method === 'DELETE') {
    if (!requireAuth()) return;
    const id = Number(m[1]);
    const found = await db.select('board_notes', `select=*&id=eq.${id}`);
    if (!found || !found[0]) return sendJSON(res, 404, { error: 'Nota no encontrada.' });
    if (found[0].username !== user.username && user.role !== 'Gru') return sendJSON(res, 403, { error: 'No puedes borrar esta nota.' });
    await db.remove('board_notes', `id=eq.${id}`);
    return sendJSON(res, 200, { ok: true });
  }

  // ---- HALL OF FAME ----
  // (endpoint mantenido por compatibilidad; la pestaña de la app se
  // sustituyó por "Bases", pero los datos ya guardados no se tocan)
  if (pathname === '/api/hall' && method === 'GET') {
    if (!requireAuth()) return;
    const rows = await db.select('hall_images', 'select=*&order=ts.desc');
    return sendJSON(res, 200, { images: rows.map(rowToImage) });
  }
  if (pathname === '/api/hall' && method === 'POST') {
    if (!requireAuth()) return;
    let body;
    try { body = await readBody(req); } catch (e) {
      if (e.message === 'PAYLOAD_TOO_LARGE') return sendJSON(res, 413, { error: 'Las imágenes pesan demasiado.' });
      return sendJSON(res, 400, { error: 'Petición inválida.' });
    }
    const images = Array.isArray(body.images) ? body.images : (body.dataUrl ? [body.dataUrl] : []);
    const rowsToInsert = images
      .filter(d => typeof d === 'string' && d.startsWith('data:image/'))
      .map(dataUrl => ({ username: user.username, data_url: dataUrl, ts: Date.now() }));
    if (!rowsToInsert.length) return sendJSON(res, 400, { error: 'No se recibió ninguna imagen válida.' });
    const rows = await db.insert('hall_images', rowsToInsert);
    return sendJSON(res, 201, { images: rows.map(rowToImage) });
  }
  if ((m = pathname.match(/^\/api\/hall\/(\d+)$/)) && method === 'DELETE') {
    if (!requireAuth()) return;
    const id = Number(m[1]);
    const found = await db.select('hall_images', `select=*&id=eq.${id}`);
    if (!found || !found[0]) return sendJSON(res, 404, { error: 'Imagen no encontrada.' });
    if (found[0].username !== user.username && user.role !== 'Gru') return sendJSON(res, 403, { error: 'No puedes borrar esta imagen.' });
    await db.remove('hall_images', `id=eq.${id}`);
    return sendJSON(res, 200, { ok: true });
  }

  // ---- WIPES (apuntes) ----
  if (pathname === '/api/wipes/signups' && method === 'GET') {
    if (!requireAuth()) return;
    const rows = await db.select('wipe_signups', 'select=*');
    const signups = {};
    rows.forEach(r => { signups[r.wipe_id] = { trios: r.trios || [], main: r.main || [] }; });
    return sendJSON(res, 200, { signups });
  }
  if ((m = pathname.match(/^\/api\/wipes\/([^/]+)\/signup$/)) && method === 'POST') {
    if (!requireAuth()) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: 'Petición inválida.' }); }
    const wipeIdVal = decodeURIComponent(m[1]);
    const modality = body.modality === 'trios' ? 'trios' : (body.modality === 'main' ? 'main' : null);
    if (!modality) return sendJSON(res, 400, { error: 'Modalidad no válida.' });

    const existingRows = await db.select('wipe_signups', `select=*&wipe_id=eq.${encodeURIComponent(wipeIdVal)}`);
    const s = existingRows && existingRows[0] ? { trios: existingRows[0].trios || [], main: existingRows[0].main || [] } : { trios: [], main: [] };
    const me = user.username;
    const inThis = s[modality].indexOf(me) !== -1;

    if (inThis) {
      s[modality] = s[modality].filter(u => u !== me);
    } else {
      if (modality === 'trios' && s.trios.length >= 3) {
        return sendJSON(res, 409, { error: 'Ese trío ya está completo.', signups: s });
      }
      const other = modality === 'trios' ? 'main' : 'trios';
      s[other] = s[other].filter(u => u !== me);
      s[modality].push(me);
    }

    await db.upsert('wipe_signups', { wipe_id: wipeIdVal, trios: s.trios, main: s.main }, 'wipe_id');
    return sendJSON(res, 200, { signups: s });
  }

  // ---- AMONESTACIONES Y MÉRITOS (puntos por wipe) ----
  // Devuelve TODOS los puntos (faltas y méritos); el frontend agrupa.
  if (pathname === '/api/points' && method === 'GET') {
    if (!requireAuth()) return;
    const rows = await db.select('wipe_points', 'select=*&order=ts.asc');
    return sendJSON(res, 200, { points: rows.map(rowToPoint) });
  }

  // Añadir una falta o un mérito. Cualquier miembro puede, pero:
  //  - no a sí mismo, ni a Gru,
  //  - con un cooldown de 3 h entre votos (Gru está exento).
  // Si el afectado llega al límite: degradación (faltas) o ascenso
  // (méritos) automáticos, reseteo de ese contador y nota en tablón.
  if (pathname === '/api/points' && method === 'POST') {
    if (!requireAuth()) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: 'Petición inválida.' }); }
    const wipeIdVal = String(body.wipeId || '').trim();
    const targetUsername = String(body.username || '').trim();
    const kind = body.kind === 'merito' ? 'merito' : (body.kind === 'falta' ? 'falta' : null);
    const weight = Number(body.weight) === 2 ? 2 : 1;
    if (!wipeIdVal || !targetUsername) return sendJSON(res, 400, { error: 'Faltan datos.' });
    if (!kind) return sendJSON(res, 400, { error: 'Tipo no válido.' });

    const target = await findUser(targetUsername);
    if (!target) return sendJSON(res, 404, { error: 'Usuario no encontrado.' });
    if (target.username === user.username) {
      return sendJSON(res, 403, { error: kind === 'merito' ? 'Los méritos te los tienen que reconocer los demás. 😏' : 'No puedes ponerte faltas a ti mismo.' });
    }

    // Cooldown anti-spam (compartido entre faltas y méritos)
    if (user.role !== 'Gru') {
      const last = await db.select('wipe_points',
        `select=ts&reported_by=eq.${encodeURIComponent(user.username)}&order=ts.desc&limit=1`);
      if (last && last[0]) {
        const elapsed = Date.now() - Number(last[0].ts);
        if (elapsed < POINT_COOLDOWN_MS) {
          const mins = Math.ceil((POINT_COOLDOWN_MS - elapsed) / 60000);
          const hh = Math.floor(mins / 60), mm = mins % 60;
          const waitTxt = hh > 0 ? `${hh} h ${mm} min` : `${mm} min`;
          return sendJSON(res, 429, { error: `Solo puedes votar una vez cada 3 horas. Te quedan ${waitTxt}.` });
        }
      }
    }

    await db.insert('wipe_points', {
      wipe_id: wipeIdVal, username: target.username, kind, weight,
      reported_by: user.username, ts: Date.now()
    });

    // ¿Ha llegado al límite de faltas o de méritos en este wipe?
    const userPoints = await db.select('wipe_points',
      `select=*&wipe_id=eq.${encodeURIComponent(wipeIdVal)}&username=eq.${encodeURIComponent(target.username)}&kind=eq.${kind}`);
    const total = userPoints.reduce((sum, p) => sum + (p.weight || 1), 0);
    const limit = kind === 'falta' ? FAULT_LIMIT : MERIT_LIMIT;

    let demoted = null;
    let promoted = null;
    if (total >= limit) {
      if (kind === 'falta') {
        const newRole = DEMOTION_MAP[target.role];
        if (newRole) {
          await db.update('users', `username=eq.${encodeURIComponent(target.username)}`, { role: newRole });
          demoted = { username: target.username, alias: target.alias, from: target.role, to: newRole };
          await db.insert('board_notes', {
            username: target.username,
            text: `⚖️ Sanción automática: he acumulado ${FAULT_LIMIT} faltas en este wipe y he sido degradado de ${target.role} a ${newRole}. 😔`,
            ts: Date.now()
          });
        }
      } else {
        const newRole = PROMOTION_MAP[target.role];
        if (newRole) {
          await db.update('users', `username=eq.${encodeURIComponent(target.username)}`, { role: newRole });
          promoted = { username: target.username, alias: target.alias, from: target.role, to: newRole };
          await db.insert('board_notes', {
            username: target.username,
            text: `🏅 Ascenso automático: he acumulado ${MERIT_LIMIT} puntos de mérito en este wipe y asciendo de ${target.role} a ${newRole}. 💪`,
            ts: Date.now()
          });
        }
      }
      // Se resetea el contador correspondiente (haya o no cambio de rango).
      await db.remove('wipe_points', `wipe_id=eq.${encodeURIComponent(wipeIdVal)}&username=eq.${encodeURIComponent(target.username)}&kind=eq.${kind}`);
    }

    const rows = await db.select('wipe_points', 'select=*&order=ts.asc');
    return sendJSON(res, 201, { points: rows.map(rowToPoint), total, demoted, promoted });
  }

  // Quitar UN punto concreto, falta o mérito (solo Gru).
  if ((m = pathname.match(/^\/api\/points\/(\d+)$/)) && method === 'DELETE') {
    if (!requireGru()) return;
    await db.remove('wipe_points', `id=eq.${Number(m[1])}`);
    const rows = await db.select('wipe_points', 'select=*&order=ts.asc');
    return sendJSON(res, 200, { points: rows.map(rowToPoint) });
  }

  // Limpiar las faltas o los méritos de una persona en un wipe (solo Gru).
  if ((m = pathname.match(/^\/api\/wipes\/([^/]+)\/points\/([^/]+)\/(falta|merito)$/)) && method === 'DELETE') {
    if (!requireGru()) return;
    const wipeIdVal = decodeURIComponent(m[1]);
    const targetUsername = decodeURIComponent(m[2]);
    await db.remove('wipe_points', `wipe_id=eq.${encodeURIComponent(wipeIdVal)}&username=eq.${encodeURIComponent(targetUsername)}&kind=eq.${m[3]}`);
    const rows = await db.select('wipe_points', 'select=*&order=ts.asc');
    return sendJSON(res, 200, { points: rows.map(rowToPoint) });
  }

  // Apelar una falta propia (una sola vez, con motivo).
  if ((m = pathname.match(/^\/api\/points\/(\d+)\/appeal$/)) && method === 'POST') {
    if (!requireAuth()) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: 'Petición inválida.' }); }
    const id = Number(m[1]);
    const found = await db.select('wipe_points', `select=*&id=eq.${id}`);
    if (!found || !found[0]) return sendJSON(res, 404, { error: 'Falta no encontrada.' });
    const p = found[0];
    if (p.kind !== 'falta') return sendJSON(res, 400, { error: 'Los méritos no se apelan. 😄' });
    if (p.username !== user.username) return sendJSON(res, 403, { error: 'Solo puedes apelar tus propias faltas.' });
    if (p.appeal_status === 'pendiente') return sendJSON(res, 409, { error: 'Esa falta ya tiene una apelación pendiente.' });
    if (p.appeal_status === 'rechazada') return sendJSON(res, 409, { error: 'Esa apelación ya fue rechazada: no hay segunda oportunidad.' });
    const text = String(body.text || '').trim().slice(0, 280);
    if (!text) return sendJSON(res, 400, { error: 'Tienes que dar un motivo para apelar.' });
    await db.update('wipe_points', `id=eq.${id}`, { appeal_status: 'pendiente', appeal_text: text });
    const rows = await db.select('wipe_points', 'select=*&order=ts.asc');
    return sendJSON(res, 200, { points: rows.map(rowToPoint) });
  }

  // Resolver una apelación (solo Gru): aceptar borra la falta,
  // rechazar la deja fijada para siempre.
  if ((m = pathname.match(/^\/api\/points\/(\d+)\/appeal\/resolve$/)) && method === 'POST') {
    if (!requireGru()) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: 'Petición inválida.' }); }
    const id = Number(m[1]);
    const found = await db.select('wipe_points', `select=*&id=eq.${id}`);
    if (!found || !found[0]) return sendJSON(res, 404, { error: 'Falta no encontrada.' });
    if (found[0].appeal_status !== 'pendiente') return sendJSON(res, 409, { error: 'Esa falta no tiene apelación pendiente.' });
    if (body.accept === true) {
      await db.remove('wipe_points', `id=eq.${id}`);
    } else {
      await db.update('wipe_points', `id=eq.${id}`, { appeal_status: 'rechazada' });
    }
    const rows = await db.select('wipe_points', 'select=*&order=ts.asc');
    return sendJSON(res, 200, { points: rows.map(rowToPoint) });
  }

  // ---- CALCULADORA DE RAIDEO (lista compartida) ----
  if (pathname === '/api/raid' && method === 'GET') {
    if (!requireAuth()) return;
    const rows = await db.select('raid_list', 'select=*&order=id.asc');
    return sendJSON(res, 200, { list: rows.map(rowToRaid) });
  }
  if (pathname === '/api/raid' && method === 'POST') {
    if (!requireAuth()) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: 'Petición inválida.' }); }
    let qty = parseInt(body.qty, 10);
    if (!qty || qty < 1) qty = 1;
    if (!body.structureId || !body.explosiveKey) return sendJSON(res, 400, { error: 'Faltan datos.' });
    const rows = await db.insert('raid_list', { structure_id: String(body.structureId), explosive_key: String(body.explosiveKey), qty });
    return sendJSON(res, 201, { row: rowToRaid(rows[0]) });
  }
  if (pathname === '/api/raid' && method === 'DELETE') {
    if (!requireAuth()) return;
    await db.remove('raid_list', 'id=gt.0');
    return sendJSON(res, 200, { ok: true });
  }
  if ((m = pathname.match(/^\/api\/raid\/(\d+)$/)) && method === 'DELETE') {
    if (!requireAuth()) return;
    const id = Number(m[1]);
    await db.remove('raid_list', `id=eq.${id}`);
    return sendJSON(res, 200, { ok: true });
  }

  // ---- ENEMIGOS (por servidor, agrupados por equipo) ----
  if (pathname === '/api/enemies' && method === 'GET') {
    if (!requireAuth()) return;
    const rows = await db.select('enemies', 'select=*&order=team.asc,name.asc');
    return sendJSON(res, 200, { enemies: rows.map(rowToEnemy) });
  }
  if (pathname === '/api/enemies' && method === 'POST') {
    if (!requireAuth()) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: 'Petición inválida.' }); }
    const serverId = String(body.serverId || '').trim();
    const name = String(body.name || '').trim();
    const steamId = String(body.steamId || '').trim();
    const team = String(body.team || '').trim();
    if (!serverId) return sendJSON(res, 400, { error: 'Falta el servidor.' });
    if (!name) return sendJSON(res, 400, { error: 'El nombre del enemigo no puede estar vacío.' });
    if (steamId && !/^\d{15,20}$/.test(steamId)) {
      return sendJSON(res, 400, { error: 'La SteamID64 debe tener entre 15 y 20 dígitos.' });
    }
    const rows = await db.insert('enemies', { server_id: serverId, name, steam_id: steamId, team, ts: Date.now() });
    return sendJSON(res, 201, { enemy: rowToEnemy(rows[0]) });
  }
  if ((m = pathname.match(/^\/api\/enemies\/(\d+)$/)) && method === 'PATCH') {
    if (!requireAuth()) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: 'Petición inválida.' }); }
    const patch = {};
    if (typeof body.name === 'string') {
      const name = body.name.trim();
      if (!name) return sendJSON(res, 400, { error: 'El nombre del enemigo no puede estar vacío.' });
      patch.name = name;
    }
    if (typeof body.steamId === 'string') {
      const steamId = body.steamId.trim();
      if (steamId && !/^\d{15,20}$/.test(steamId)) {
        return sendJSON(res, 400, { error: 'La SteamID64 debe tener entre 15 y 20 dígitos.' });
      }
      patch.steam_id = steamId;
    }
    if (typeof body.team === 'string') patch.team = body.team.trim();
    const id = Number(m[1]);
    const rows = await db.update('enemies', `id=eq.${id}`, patch);
    if (!rows || !rows[0]) return sendJSON(res, 404, { error: 'Enemigo no encontrado.' });
    return sendJSON(res, 200, { enemy: rowToEnemy(rows[0]) });
  }
  if ((m = pathname.match(/^\/api\/enemies\/(\d+)$/)) && method === 'DELETE') {
    if (!requireAuth()) return;
    const id = Number(m[1]);
    await db.remove('enemies', `id=eq.${id}`);
    return sendJSON(res, 200, { ok: true });
  }

  sendJSON(res, 404, { error: 'Ruta de API no encontrada.' });
}

// ------------------------------------------------------------
// Servidor HTTP
// ------------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname).catch(err => {
      console.error(err);
      sendJSON(res, 500, { error: 'Error interno del servidor.' });
    });
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res, pathname);
    return;
  }

  res.writeHead(405);
  res.end('Method Not Allowed');
});

function supabaseHostSafe() {
  return (process.env.SUPABASE_URL || '').replace(/^https?:\/\//, '');
}

ensureSeed()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Vinicus y Amigos escuchando en http://localhost:${PORT}`);
      console.log(`Base de datos: Supabase (${supabaseHostSafe()})`);
    });
  })
  .catch(err => {
    console.error('❌ No se pudo conectar con Supabase para sembrar los datos iniciales:', err.message);
    process.exit(1);
  });
