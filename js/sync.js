// Synkronisering med Supabase (opgave 4).
//
// Offline-first: appen skriver altid først til localStorage og en kø (store.js).
// Når der er net og man er logget ind:
//   1. køen sendes op (upsert pr. tabel)
//   2. alt, der er ændret i databasen siden sidst, hentes ned og flettes ind
// Konflikter: nyeste updated_at vinder pr. række – både her (store.mergeRows) og i
// databasen (trigger i supabase/schema.sql).
//
// Login: e-mail + adgangskode (Supabase Auth). Man logger ind én gang pr. enhed;
// adgangskoden gemmes ikke af appen – kun Supabase' login-token.
import * as S from './store.js';
import * as Diag from './diag.js';

// Supabase-biblioteket ligger i appen selv (vendor/supabase.js, version 2.117.3) – ingen tredjeparts-server i drift
function loadLib() {
  return new Promise((resolve, reject) => {
    if (window.supabase) { resolve(window.supabase); return; }
    const sc = document.createElement('script');
    sc.src = 'vendor/supabase.js';
    sc.onload = () => (window.supabase ? resolve(window.supabase) : reject(new Error('Synkroniseringsmodulet mangler')));
    sc.onerror = () => reject(new Error('Kunne ikke indlæse synkroniseringsmodulet'));
    document.head.appendChild(sc);
  });
}
const cfg = window.TP_CONFIG || {};
export const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);

// Kolonner pr. tabel – præcis som i supabase/schema.sql. Andre felter sendes ikke.
const COLUMNS = {
  strength_logs: ['item_key', 'date', 'session', 'ex_index', 'exercise', 'set_no', 'kg', 'reps', 'load_type'],
  run_logs: ['item_key', 'date', 'km', 'time_sec', 'hr', 'elev', 'rpe', 'note', 'source'],
  session_status: ['item_key', 'date', 'item_index', 'status'],
  overrides: ['item_key', 'from_date', 'item_index', 'to_date'],
  checklists: ['list_id', 'done'],
  goals: ['name', 'category', 'status', 'event', 'date', 'linked_to_plan', 'result', 'completed_date', 'note', 'sort'],
  favorite_quotes: ['quote_id'],
  custom_quotes: ['text', 'tags'],
  exercise_overrides: ['action', 'scope', 'date', 'item_key', 'session', 'original', 'exercise', 'sets', 'reps', 'rir'],
  custom_exercises: ['name', 'muscle_group', 'pattern', 'body', 'step_kg', 'equipment', 'primary_muscles', 'secondary_muscles'],
  exercise_settings: ['load_type', 'start_confirmed', 'start_kg', 'next_kg', 'next_set_on', 'rest_sec'],
  settings: ['value'],
  garmin_activities: ['activity_id', 'date', 'start_time', 'type', 'garmin_type', 'name', 'km', 'duration_sec',
    'avg_hr', 'max_hr', 'elev_gain', 'pace_sec_km', 'planned_key', 'splits', 'hr_zone_secs', 'fetched_at'],
  push_subscriptions: ['subscription', 'device'],
  daily_log: ['date', 'weight_kg', 'protein_g', 'sleep_h', 'note'],
  garmin_daily: ['date', 'hrv_status', 'hrv_avg', 'sleep_score', 'resting_hr', 'hrv_weekly_avg', 'hrv_baseline_low',
    'hrv_baseline_high', 'sleep_seconds', 'body_battery_high', 'body_battery_low', 'body_battery_wake',
    'body_battery_charged', 'body_battery_drained', 'stress_avg', 'stress_max', 'vo2max', 'recovery_hours'],
};
// Felter, der hedder noget andet i databasen end i appen
const RENAME = { custom_exercises: { group: 'muscle_group' } };
const DATE_COLS = new Set(['date', 'from_date', 'to_date', 'completed_date', 'next_set_on']);
// Tekstkolonner, der kan komme ind som tal i appen (reps/rir er kun tekst i øvelsesskift, f.eks. "8-12")
const TEXT_COLS = new Set(['ex_index', 'item_key', 'quote_id']);
const TEXT_COLS_BY_TABLE = { exercise_overrides: new Set(['reps', 'rir']) };

let client = null;
let lastOk = null;
let user = null;
let running = false;
let again = false;
let syncing = false;
let lastError = null;
let retryTimer = null;
let pushTimer = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());
export const onStatus = (fn) => listeners.add(fn);
export const currentUser = () => user;

function toDb(table, row) {
  const out = { id: String(row.id), deleted: !!row.deleted, updated_at: row.updated_at || new Date().toISOString() };
  const back = Object.fromEntries(Object.entries(RENAME[table] || {}).map(([a, b]) => [b, a]));
  for (const col of COLUMNS[table]) {
    let v = row[back[col] || col];
    if (v === undefined || v === '') v = null;
    if (v != null && (TEXT_COLS.has(col) || (TEXT_COLS_BY_TABLE[table] && TEXT_COLS_BY_TABLE[table].has(col)))) v = String(v);
    if (v != null && DATE_COLS.has(col)) v = String(v).slice(0, 10);
    out[col] = v;
  }
  return out;
}

function fromDb(table, row) {
  const out = { ...row };
  delete out.user_id;
  delete out.synced_at;
  for (const [app, db] of Object.entries(RENAME[table] || {})) { out[app] = out[db]; delete out[db]; }
  out.updated_at = new Date(row.updated_at).toISOString(); // ens format, så tidsstempler kan sammenlignes
  if (out.ex_index != null && /^\d+$/.test(out.ex_index)) out.ex_index = String(out.ex_index);
  return out;
}

async function getClient() {
  if (client) return client;
  const { createClient } = await loadLib();
  client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'tp.auth' },
  });
  const { data } = await client.auth.getSession();
  user = data.session ? data.session.user : null;
  client.auth.onAuthStateChange((_event, session) => {
    const was = user && user.id;
    user = session ? session.user : null;
    emit();
    if (user && user.id !== was) syncNow();
  });
  return client;
}

export async function init() {
  if (!configured) return;
  try {
    await getClient();
  } catch (e) {
    lastError = 'Kunne ikke hente login-modulet (er du offline?)';
    Diag.log('synk', lastError);
  }
  emit();
  if (user) syncNow();
  // Send ændringer kort efter de er lavet
  S.onChange(() => {
    if (!user || !S.pendingCount()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(syncNow, 1500);
  });
  // Ingen faste tjek i baggrunden: der hentes ved start, når appen kommer frem, når nettet vender tilbage og når du trykker.
}

// Kald en Supabase Edge Function med dit login (bruges til notifikationer)
export async function callFunction(name, body) {
  const c = await getClient();
  const { data, error } = await c.functions.invoke(name, { body });
  if (error) {
    const status = error.context && error.context.status;
    // Hent funktionens egen fejltekst, hvis den findes (fx "nøglerne mangler")
    let detail = '';
    try { const t = await error.context.text(); try { const j = JSON.parse(t); detail = j.message || j.error || t; } catch { detail = t; } } catch { /* ingen svartekst */ }
    const e = new Error(status === 404 ? 'Funktionen er ikke oprettet i Supabase endnu.' : (`${error.message || 'Kunne ikke kontakte Supabase.'}${status ? ` (kode ${status})` : ''}${detail ? ` – ${String(detail).slice(0, 160)}` : ''}`));
    e.code = status === 404 ? 'not_deployed' : status === 401 ? 'not_logged_in' : 'network';
    throw e;
  }
  return data;
}

// ---------- Login ----------
export async function signIn(email, password) {
  const c = await getClient();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(danish(error));
  user = data.user;
  emit();
  await syncNow();
}
// Første gang: opret kontoen (kræver at "Confirm email" er slået fra i Supabase)
export async function signUp(email, password) {
  const c = await getClient();
  const { data, error } = await c.auth.signUp({ email, password });
  if (error) throw new Error(danish(error));
  if (!data.session) throw new Error('Kontoen er oprettet, men kræver bekræftelse på e-mail. Slå "Confirm email" fra i Supabase, og log ind.');
  user = data.user;
  emit();
  await syncNow();
}
export async function signOut() {
  const c = await getClient();
  await c.auth.signOut();
  user = null;
  emit();
}
function danish(error) {
  const m = String(error.message || error);
  if (/rate limit|too many/i.test(m)) return 'For mange forsøg. Vent et par minutter, og prøv igen.';
  if (/invalid login credentials/i.test(m)) return 'Forkert e-mail eller adgangskode.';
  if (/already registered|already exists/i.test(m)) return 'Der findes allerede en konto med den e-mail. Tryk "Log ind" i stedet.';
  if (/password.*(6|characters|short|weak)/i.test(m)) return 'Adgangskoden er for kort eller for svag. Brug mindst 8 tegn.';
  if (/signups not allowed|signup.*disabled/i.test(m)) return 'Der kan ikke oprettes nye konti. Tryk "Log ind" med din eksisterende konto.';
  if (/email not confirmed/i.test(m)) return 'E-mailen er ikke bekræftet. Slå "Confirm email" fra i Supabase, eller bekræft via mailen.';
  if (/fetch|network/i.test(m)) return 'Ingen forbindelse. Tjek internettet.';
  return m;
}

// ---------- Synkronisering ----------
export async function syncNow() {
  if (!configured || !user || !navigator.onLine) { emit(); return; }
  if (running) { again = true; return; }
  running = true;
  syncing = true;
  emit();
  try {
    const c = await getClient();
    const meta = S.syncMeta();
    if (!meta.migrated[user.id]) {
      // Første login på denne enhed: send alt, der allerede ligger lokalt, op
      S.queueAll();
      S.setSyncMeta({ migrated: { ...meta.migrated, [user.id]: true } });
    }
    schemaOutdated = false;
    await push(c);
    await pull(c);
    lastError = null;
    lastOk = new Date().toISOString();
    clearTimeout(retryTimer);
  } catch (e) {
    lastError = e && e.message ? e.message : String(e);
    Diag.log('synk', lastError);
    console.warn('Synkronisering fejlede', e);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(syncNow, 30000);
  } finally {
    running = false;
    syncing = false;
    emit();
    if (again) { again = false; syncNow(); }
  }
}

async function push(c) {
  const q = S.takeQueue();
  if (!q.length) return;
  const byTable = {};
  for (const { table, id } of q) {
    const row = S.rawRow(table, id);
    if (row && COLUMNS[table]) (byTable[table] ||= new Map()).set(String(id), row);
  }
  const failed = new Set();
  const resend = [];  // rækker, hvor en kolonne mangler i databasen – sendes igen, når den er oprettet
  for (const [table, rows] of Object.entries(byTable)) {
    const list = [...rows.values()].map((r) => toDb(table, r));
    for (let i = 0; i < list.length; i += 500) {
      try {
        const dropped = await upsertTolerant(c, table, list.slice(i, i + 500));
        if (dropped.length) {
          schemaOutdated = true;
          for (const r of list.slice(i, i + 500)) resend.push({ table, id: r.id });
        }
      } catch (error) {
        if (error.schema) { failed.add(table); break; }  // tabellen findes ikke endnu
        throw new Error(`${table}: ${error.message}`);
      }
    }
  }
  S.clearQueued(q.length);
  // Ændringer til tabeller/kolonner, databasen ikke har endnu, bliver i køen til næste gang
  S.requeue([...q.filter((x) => failed.has(x.table)), ...resend]);
  if (failed.size) schemaOutdated = true;
}

// Upsert, der springer en kolonne over, hvis databasen endnu ikke har den (så resten stadig synkroniseres).
// Returnerer listen over kolonner, der blev sprunget over.
async function upsertTolerant(c, table, rows) {
  let list = rows;
  const dropped = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    const { error } = await c.from(table).upsert(list, { onConflict: 'user_id,id' });
    if (!error) return dropped;
    const msg = String(error.message || '');
    const m = /Could not find the '([^']+)' column/i.exec(msg) || /column "([^"]+)" of relation/i.exec(msg);
    if (m && list[0] && m[1] in list[0]) {
      dropped.push(m[1]);
      list = list.map((r) => { const { [m[1]]: _gone, ...rest } = r; return rest; });
      continue;
    }
    const err = new Error(msg);
    err.schema = isSchemaError(error);
    throw err;
  }
  throw new Error('For mange manglende kolonner');
}
// Tabel eller kolonne findes ikke endnu → databasen mangler opdateringen (schema.sql)
function isSchemaError(error) {
  const code = String(error.code || ''), msg = String(error.message || '');
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /does not exist|could not find the .* (column|table)/i.test(msg);
}
let schemaOutdated = false;

async function pull(c) {
  const lastPull = { ...S.syncMeta().lastPull };
  for (const table of Object.keys(COLUMNS)) {
    let from = lastPull[table] || null;
    for (;;) {
      let query = c.from(table).select('*').order('synced_at', { ascending: true }).limit(1000);
      if (from) query = query.gt('synced_at', from);
      const { data, error } = await query;
      if (error && isSchemaError(error)) { schemaOutdated = true; break; }
      if (error) throw new Error(`${table}: ${error.message}`);
      if (!data.length) break;
      S.mergeRows(table, data.map((r) => fromDb(table, r)));
      from = data[data.length - 1].synced_at;
      if (data.length < 1000) break;
    }
    if (from) lastPull[table] = from;
  }
  S.setSyncMeta({ lastPull });
}

// Kun til test: synkroniseringen kan køres mod en falsk database
export const _test = { toDb, fromDb, push, pull };

// Hvornår appen sidst hentede/sendte data ("for 2 min siden", "i dag kl. 07:31")
export function lastSyncText() {
  const t = lastOk || S.lastSync();
  if (!t) return '';
  const d = new Date(t), mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'lige nu';
  if (mins < 60) return `for ${mins} min siden`;
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
  return d.toDateString() === new Date().toDateString() ? `i dag kl. ${hh}.${mm}` : `${d.getDate()}/${d.getMonth() + 1} kl. ${hh}.${mm}`;
}

// ---------- Status til appen ----------
export function status() {
  const n = S.pendingCount();
  const changes = `${n} ændring${n === 1 ? '' : 'er'} venter`;
  if (!configured) return { icon: 'cloud', text: 'Gemt på denne enhed', detail: 'Synkronisering mellem iPhone og Mac er ikke sat op endnu.' };
  if (!client && lastError) return { icon: 'warn', text: 'Synkronisering utilgængelig', detail: lastError };
  if (!user) return { icon: 'cloud', text: n ? `Ikke logget ind – ${changes}` : 'Ikke logget ind', detail: 'Log ind under Mere → Konto og synkronisering.' };
  if (!navigator.onLine) return { icon: 'cloud', text: `Offline – ${changes}` };
  if (syncing) return { icon: 'cloud', text: 'Synkroniserer …' };
  if (lastError) return { icon: 'warn', text: 'Synkronisering fejlede – prøver igen', detail: lastError };
  if (schemaOutdated) return { icon: 'warn', text: n ? `Databasen skal opdateres – ${changes}` : 'Databasen skal opdateres', detail: 'Nogle nye data gemmes kun på denne enhed, indtil databasen er opdateret. Dine data er ikke væk.' };
  if (n) return { icon: 'cloud', text: changes };
  return { icon: 'check', text: 'Synkroniseret ✓' };
}
