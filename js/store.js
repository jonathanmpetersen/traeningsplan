// Lokal datalager (offline-first).
// Alle ændringer skrives først til localStorage og lægges i en kø med udestående ændringer.
// sync.js sender køen til Supabase, når der er net, og henter nyeste data tilbage.
// Rækker slettes "blødt" (deleted: true), så sletninger også synkroniseres.

export const TABLES = [
  'strength_logs', 'run_logs', 'session_status', 'overrides',
  'checklists', 'goals', 'favorite_quotes', 'custom_quotes', 'exercise_overrides', 'custom_exercises',
  'exercise_settings', 'settings',
  'garmin_activities', 'garmin_daily', 'daily_log', 'push_subscriptions', 'plan_versions', 'week_edits', 'programs', 'custom_sessions', 'run_programs',
];

const KEY = 'traeningsplan.v1';
const listeners = new Set();
let state = load();

function empty() {
  return { tables: Object.fromEntries(TABLES.map((t) => [t, {}])), queue: [], lastSync: null, goalsSeeded: false, sync: { lastPull: {}, migrated: {} } };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const s = JSON.parse(raw);
    const base = empty();
    for (const t of TABLES) base.tables[t] = (s.tables && s.tables[t]) || {};
    base.queue = Array.isArray(s.queue) ? s.queue : [];
    base.lastSync = s.lastSync || null;
    base.goalsSeeded = !!s.goalsSeeded;
    base.sync = { lastPull: {}, migrated: {}, ...(s.sync || {}) };
    // Ryd op efter en tidligere version, der lagde uændrede startmål i køen ("5 ændringer venter")
    base.queue = base.queue.filter((q) => !(q.table === 'goals' && (base.tables.goals[q.id] || {}).updated_at === '1970-01-01T00:00:00.000Z'));
    return base;
  } catch {
    return empty();
  }
}

let saveError = null;
export const lastSaveError = () => saveError;
function save(table) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); saveError = null; } catch (e) { saveError = String(e && e.message ? e.message : e); console.warn('Kunne ikke gemme lokalt', e); }
  listeners.forEach((fn) => fn(table));
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function all(table) {
  return Object.values(state.tables[table]).filter((r) => !r.deleted);
}
export function get(table, id) {
  const r = state.tables[table][id];
  return r && !r.deleted ? r : null;
}

export function put(table, row) {
  const full = { ...row, updated_at: new Date().toISOString() };
  state.tables[table][row.id] = full;
  state.queue.push({ table, id: row.id });
  save(table);
  return full;
}

export function remove(table, id) {
  const r = state.tables[table][id];
  if (!r) return;
  put(table, { ...r, deleted: true });
}

export function pendingCount() { return new Set(state.queue.map((q) => `${q.table}:${q.id}`)).size; }
// Køen sendes i bidder: takeQueue() giver et øjebliksbillede, og clearQueued(n) fjerner kun
// de n første poster – ændringer, der kommer til imens, bliver liggende til næste runde.
export function takeQueue() { return state.queue.slice(); }
export function clearQueued(n) {
  state.queue = state.queue.slice(n);
  state.lastSync = new Date().toISOString();
  save();
}
export function requeue(items) { state.queue.push(...items); save(); }
// Læg alle lokale rækker i køen (første login: flyt eksisterende data op i Supabase)
export function queueAll() {
  for (const t of TABLES) for (const id of Object.keys(state.tables[t])) state.queue.push({ table: t, id });
  save();
}
export function syncMeta() { return state.sync; }
export function lastSync() { return state.lastSync; }
export function setSyncMeta(patch) { state.sync = { ...state.sync, ...patch }; save(); }
export function rawRow(table, id) { return state.tables[table][id] || null; }

// Flet rækker ind (fra Supabase eller en importeret backup).
// Nyeste updated_at vinder pr. række. Manuelle løbedata overskrives aldrig af Garmin.
export function mergeRows(table, rows) {
  const changed = [];
  for (const row of rows) {
    const cur = state.tables[table][row.id];
    if (table === 'run_logs' && cur && cur.source === 'manual' && !cur.deleted && row.source === 'garmin') continue;
    if (!cur || (row.updated_at || '') > (cur.updated_at || '')) {
      state.tables[table][row.id] = row;
      changed.push(row.id);
    }
  }
  if (changed.length) save();
  return changed;
}

// Første gang appen åbnes, lægges målene fra goals.json ind som startdata.
// Derefter er det tabellen "goals", der gælder (så mål kan redigeres i appen).
export function seedGoals(goalsFile) {
  if (state.goalsSeeded || !goalsFile || !Array.isArray(goalsFile.goals)) return;
  if (Object.keys(state.tables.goals).length === 0) {
    // Startdata får et gammelt tidsstempel, så mål redigeret på en anden enhed altid vinder
    const now = '1970-01-01T00:00:00.000Z';
    goalsFile.goals.forEach((g, i) => {
      state.tables.goals[g.id] = {
        id: g.id, name: g.name, category: g.category || '', status: g.status || 'Drøm',
        event: g.event || null, date: g.date || null, linked_to_plan: !!g.linked_to_plan,
        result: g.result || null, completed_date: null, note: g.note || '', sort: i, updated_at: now,
      };
      // Ikke i køen: startdata er ikke en ændring (de sendes op ved første login sammen med resten)
    });
  }
  state.goalsSeeded = true;
  save();
}

// ---------- Backup ----------
export function exportJSON() {
  return JSON.stringify({ app: 'traeningsplan', version: 1, exported_at: new Date().toISOString(), tables: state.tables }, null, 2);
}

// Kun gyldige rækker slipper ind: objekt med et almindeligt id, og et tidsstempel, der ikke ligger i fremtiden
export function cleanImportRows(rows, now = Date.now()) {
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const id = r.id;
    if (typeof id !== 'string' && typeof id !== 'number') continue;
    if (['__proto__', 'constructor', 'prototype'].includes(String(id)) || String(id).length > 200) continue;
    const row = { ...r };
    if (row.updated_at && !(Date.parse(row.updated_at) <= now + 10 * 60 * 1000)) row.updated_at = new Date(now).toISOString();
    out.push(row);
  }
  return out;
}
export function importJSON(text) {
  if (typeof text !== 'string' || text.length > 50 * 1024 * 1024) throw new Error('Filen er for stor til at være en backup.');
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !data.tables || typeof data.tables !== 'object') throw new Error('Filen ligner ikke en backup fra Træningsplan.');
  let n = 0;
  for (const t of TABLES) {
    const src = data.tables[t];
    const ids = mergeRows(t, cleanImportRows(src && typeof src === 'object' ? Object.values(src) : []));
    // Importerede rækker skal også sendes videre til Supabase, når synkronisering er sat op
    ids.forEach((id) => state.queue.push({ table: t, id }));
    n += ids.length;
  }
  save();
  return n;
}
