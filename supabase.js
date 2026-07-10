// ============================================================
// Cliente mínimo para la API REST de Supabase (PostgREST).
// No usa el SDK oficial (@supabase/supabase-js) a propósito,
// para no depender de "npm install": solo usa fetch, que ya
// viene incluido en Node 18+.
//
// IMPORTANTE: usa la "service_role key" (no la "anon key"),
// porque el backend necesita saltarse RLS para leer/escribir
// libremente. Esa clave NUNCA debe llegar al navegador — por
// eso todas las llamadas a Supabase se hacen aquí, en el
// servidor, y el frontend solo habla con nuestra propia API.
// ============================================================

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Faltan SUPABASE_URL y/o SUPABASE_SERVICE_KEY en las variables de entorno.');
  console.error('   Revisa el README para saber cómo obtenerlas y configurarlas.');
  process.exit(1);
}

const BASE_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json'
};

async function request(method, table, { query = '', body, prefer } = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? '?' + query : ''}`;
  const headers = Object.assign({}, BASE_HEADERS);
  if (prefer) headers.Prefer = prefer;

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch (e) { /* nada */ }
    throw new Error(`Supabase ${method} ${table} → ${res.status}: ${detail}`);
  }

  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// SELECT — query en formato PostgREST, ej: "select=*&username=eq.julian"
function select(table, query) {
  return request('GET', table, { query });
}

// INSERT — rows puede ser un objeto o un array de objetos
function insert(table, rows) {
  return request('POST', table, { body: rows, prefer: 'return=representation' });
}

// UPSERT — inserta o actualiza si ya existe onConflict
function upsert(table, rows, onConflict) {
  return request('POST', table, {
    query: `on_conflict=${onConflict}`,
    body: rows,
    prefer: 'resolution=merge-duplicates,return=representation'
  });
}

// UPDATE — query debe incluir el filtro, ej: "username=eq.julian"
function update(table, query, patch) {
  return request('PATCH', table, { query, body: patch, prefer: 'return=representation' });
}

// DELETE — query debe incluir el filtro, ej: "id=eq.5"
function remove(table, query) {
  return request('DELETE', table, { query, prefer: 'return=representation' });
}

module.exports = { select, insert, upsert, update, remove };
