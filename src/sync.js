/* ============================== CREW SYNC (CLIENT) ==============================
   Local-first. IndexedDB stays the source of truth and every edit lands there
   first, exactly as it did before crews existed — a race day logged in airplane
   mode is complete on the device the moment it is typed. Sync is reconciliation
   that happens afterwards, not a write path anything waits on.

   Change detection is a diff, not a call at each edit site. Every mutation in
   the app already funnels into queueSave(), so on each save we flatten the state
   to a path->value map and compare it with the last known map. That catches
   Smart Fill writing twenty fields at once and any edit site added later, which
   hand-placed record() calls would eventually miss.

   `known` is the merge state: path -> { v, t }, where t is when this device last
   saw that value change. It is what makes the merge per-field — a remote edit
   applies only if it is newer than what we hold for that exact path, so two
   people on different corners both survive, and a phone that was offline all
   weekend cannot walk back edits made while it was away.
   ============================================================================= */

import { get as idbGet, set as idbSet } from 'idb-keyval';
import { TIRES } from './num.js';
import { state, blankReading } from './state.js';
import { hooks } from './hooks.js';

const CREW_KEY = 'lltool:crew:v1';

/* The sheet is supposed to be the same sheet on every phone. A device that has
   never chosen anything therefore joins the shared team log on first run rather
   than starting a private one of its own — nobody should have to read a code
   across a loud pit box just to see the day everyone else is already logging.
   A crew that wants its own separate log can still enter a code, and a phone can
   still drop to local-only; both of those are deliberate acts, and both are
   remembered so this default never quietly overrides them.

   Set VITE_TEAM_CODE at build time to give a deployment its own shared log. */
export const SHARED_CODE =
  String((import.meta.env && import.meta.env.VITE_TEAM_CODE) || 'TEAM-BASE').toUpperCase();

const DAY_FIELDS = ['name', 'track', 'dateISO', 'date', 'driver', 'car', 'carClass', 'notes'];
const SESS_FIELDS = ['type', 'name', 'notes'];
const TIRE_FIELDS = ['psi', 'size', 'ti', 'tm', 'to'];
/* Reading-level fields, wire code -> state field. The codes are short because
   every one of them is a map key on every session on every sync, and `tt` is
   already in the wild — renaming it would orphan every phone's merge state. */
const READING_FIELDS = { tt: 'trackTemp', life: 'tireLife', laps: 'laps', chg: 'changes' };

/* Crockford-ish: no I, L, O, 0, 1 — these get read aloud across a loud pit box
   and written on tape. 8 symbols from a 32-char alphabet is ~40 bits, which is
   not brute-forceable against a rate-limited endpoint. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

export const crew = {
  code: null,          // null = solo, this device only
  solo: false,         // true only if someone explicitly left — stops the auto-join below
  device: null,
  cursor: 0,
  known: {},           // path -> { v, t }
  outbox: {},          // path -> { v, t }  — edits not yet accepted by the server
  syncing: false,
  lastSyncAt: null,
  error: null,
  loaded: false
};

const listeners = [];
export function onSync(fn) { listeners.push(fn) }
function notify() { listeners.forEach(f => { try { f() } catch (e) { } }) }

export function makeCode() {
  const pick = n => Array.from({ length: n }, () => {
    const a = new Uint32Array(1);
    (globalThis.crypto || {}).getRandomValues
      ? globalThis.crypto.getRandomValues(a)
      : (a[0] = Math.floor(Math.random() * 0xffffffff));
    return ALPHABET[a[0] % ALPHABET.length];
  }).join('');
  return pick(4) + '-' + pick(4);
}

export function validCode(s) { return CODE_RE.test(String(s || '').toUpperCase().trim()) }

function newDeviceId() {
  return 'dev-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/* ---------- flatten: state -> path map ---------- */

/** Every synced value in the log, keyed by a path that is stable across devices
 *  because day and session ids already are. `!` marks existence, so a created
 *  day and a deleted one are the same mechanism with a different value. */
export function flatten(st) {
  const out = {};
  (st.days || []).forEach(d => {
    out[`d:${d.id}:!`] = 1;
    DAY_FIELDS.forEach(f => { out[`d:${d.id}:${f}`] = d[f] == null ? '' : d[f] });
    (d.sessions || []).forEach(s => {
      out[`s:${s.id}:!`] = d.id;                 // value carries the parent day
      SESS_FIELDS.forEach(f => { out[`s:${s.id}:${f}`] = s[f] == null ? '' : s[f] });
      ['pre', 'post'].forEach(tab => {
        const r = s[tab] || blankReading();
        Object.keys(READING_FIELDS).forEach(code => {
          const v = r[READING_FIELDS[code]];
          out[`r:${s.id}:${tab}:${code}`] = v == null ? '' : v;
        });
        TIRES.forEach(k => {
          const t = (r.tires && r.tires[k]) || {};
          TIRE_FIELDS.forEach(f => {
            out[`r:${s.id}:${tab}:${k}:${f}`] = t[f] == null ? '' : t[f];
          });
        });
      });
    });
  });
  return out;
}

/* ---------- apply: path map -> state ---------- */

function dayOrder(id) { const n = parseInt(String(id).slice(1), 10); return Number.isFinite(n) ? n : 0 }

function findDay(id) { return state.days.find(d => d.id === id) }
function findSess(id) {
  for (const d of state.days) { const s = (d.sessions || []).find(x => x.id === id); if (s) return { d, s } }
  return null;
}

function ensureDay(id) {
  let d = findDay(id);
  if (d) return d;
  d = {
    id, name: '', track: '', dateISO: '', date: '', driver: '', car: '',
    carClass: 'Limited Late Model', notes: '', sessions: []
  };
  state.days.push(d);
  // Ids embed their creation time, so ordering by id agrees on every device.
  state.days.sort((a, b) => dayOrder(a.id) - dayOrder(b.id));
  return d;
}

function ensureSession(sid, dayId) {
  const found = findSess(sid);
  if (found) return found.s;
  const d = ensureDay(dayId);
  const s = { id: sid, type: 'Practice', name: '', notes: '', pre: blankReading(), post: blankReading() };
  d.sessions.push(s);
  d.sessions.sort((a, b) => dayOrder(a.id) - dayOrder(b.id));
  return s;
}

/** Apply one remote op to `state`. Returns true if anything actually changed. */
export function applyOp(op) {
  const parts = op.p.split(':');
  const kind = parts[0];

  if (kind === 'd') {
    const [, id, field] = parts;
    if (field === '!') {
      if (op.v === null) {
        const i = state.days.findIndex(d => d.id === id);
        if (i < 0) return false;
        state.days.splice(i, 1); return true;
      }
      ensureDay(id); return true;
    }
    if (!DAY_FIELDS.includes(field)) return false;
    const d = findDay(id); if (!d) return false;      // tombstoned day — ignore stragglers
    d[field] = op.v === null ? '' : op.v; return true;
  }

  if (kind === 's') {
    const [, id, field] = parts;
    if (field === '!') {
      if (op.v === null) {
        const f = findSess(id); if (!f) return false;
        f.d.sessions.splice(f.d.sessions.indexOf(f.s), 1); return true;
      }
      ensureSession(id, op.v); return true;
    }
    if (!SESS_FIELDS.includes(field)) return false;
    const f = findSess(id); if (!f) return false;
    f.s[field] = op.v === null ? '' : op.v; return true;
  }

  if (kind === 'r') {
    const [, id, tab] = parts;
    if (tab !== 'pre' && tab !== 'post') return false;
    const f = findSess(id); if (!f) return false;
    const r = f.s[tab] || (f.s[tab] = blankReading());
    // four parts is a reading-level field; five is a corner
    if (parts.length === 4) {
      const rf = READING_FIELDS[parts[3]];
      if (!rf) return false;
      r[rf] = op.v === null ? '' : op.v; return true;
    }
    const [, , , tire, field] = parts;
    if (!TIRES.includes(tire) || !TIRE_FIELDS.includes(field)) return false;
    if (!r.tires) r.tires = blankReading().tires;
    if (!r.tires[tire]) r.tires[tire] = { psi: '', size: '', ti: '', tm: '', to: '' };
    r.tires[tire][field] = op.v === null ? '' : op.v;
    return true;
  }
  return false;
}

/* ---------- change detection ---------- */

/** Diff current state against `known` and stage anything new for the server.
 *  Called after every save, including while offline — the outbox is what makes
 *  a weekend of dead signal land intact once there are bars again. */
export function collectLocalChanges(now = Date.now()) {
  if (!crew.code) return 0;
  const flat = flatten(state);
  let n = 0;

  for (const p in flat) {
    const cur = crew.known[p];
    if (!cur || cur.v !== flat[p]) {
      crew.known[p] = { v: flat[p], t: now };
      crew.outbox[p] = { v: flat[p], t: now };
      n++;
    }
  }
  // Anything we knew about that is gone from the state is a delete. Tombstones
  // must travel: without them a day deleted in the trailer comes back from the
  // next phone that syncs.
  for (const p in crew.known) {
    if (!(p in flat) && crew.known[p].v !== null) {
      crew.known[p] = { v: null, t: now };
      crew.outbox[p] = { v: null, t: now };
      n++;
    }
  }
  if (n) persist();
  return n;
}

/* ---------- the sync round trip ---------- */

export async function syncNow({ silent = false } = {}) {
  if (!crew.code || crew.syncing) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;

  crew.syncing = true; if (!silent) notify();
  const sending = Object.entries(crew.outbox).map(([p, o]) => ({ p, v: o.v, t: o.t }));

  try {
    const res = await fetch('/api/crew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ crew: crew.code, device: crew.device, since: crew.cursor, ops: sending })
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || !body.ok) {
      /* 503 means the server has no store wired up at all — a different thing
         from "no signal right now", and worth separating: one is waiting for a
         bar of service, the other will never succeed no matter how long you
         wait, so we must not let a crew look joined. */
      crew.unconfigured = res.status === 503;
      crew.error = (body && body.error) || 'Sync failed.';
      return false;
    }
    crew.unconfigured = false;

    // Ops we sent are accepted — drop them unless the field changed again while
    // the request was in flight.
    sending.forEach(o => {
      const still = crew.outbox[o.p];
      if (still && still.t === o.t) delete crew.outbox[o.p];
    });

    let touched = 0;
    (body.ops || []).forEach(op => {
      const cur = crew.known[op.p];
      if (cur && cur.t >= op.t) return;          // ours is newer or identical
      if (applyOp(op)) touched++;
      crew.known[op.p] = { v: op.v, t: op.t };
      const pend = crew.outbox[op.p];
      if (pend && pend.t <= op.t) delete crew.outbox[op.p];
    });

    crew.cursor = body.cursor || crew.cursor;
    crew.error = null;
    crew.lastSyncAt = Date.now();
    await persist();

    if (touched) {
      // Remote work landed. Persist it first so it survives a reload either way.
      const { saveState } = await import('./state.js');
      await saveState();
      /* Repaint only when nobody is mid-entry. Repainting under a crew member's
         hands destroys the field they are typing into and loses the reading —
         with gloves on, that reading is not coming back. The data is already
         saved; the screen catches up when they move off the field. */
      if (isEditing()) pendingRepaint = true; else hooks.render();
    }
    return true;
  } catch (e) {
    crew.error = 'Offline — will sync when there is signal.';
    return false;
  } finally {
    crew.syncing = false; notify();
  }
}

export function pendingCount() { return Object.keys(crew.outbox).length }

/* ---------- not stealing the keyboard ---------- */

let pendingRepaint = false;

/** True while a crew member has a field open. Remote data still lands in state
 *  and on disk during this; only the repaint waits. */
export function isEditing() {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement;
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
}

/** Flush a repaint that was held back while someone was typing. */
export function flushPendingRepaint() {
  if (!pendingRepaint || isEditing()) return;
  pendingRepaint = false;
  hooks.render();
}

/* ---------- joining, leaving, persistence ---------- */

/** True when this phone is on the log everyone else lands on by default. */
export function onSharedLog() { return crew.code === SHARED_CODE }

async function persist() {
  try {
    await idbSet(CREW_KEY, {
      code: crew.code, solo: crew.solo, device: crew.device, cursor: crew.cursor,
      known: crew.known, outbox: crew.outbox
    });
  } catch (e) { /* sync metadata is recoverable; never block an edit on it */ }
}

export async function loadCrew() {
  let stored = null;
  try {
    stored = await idbGet(CREW_KEY);
    if (stored) {
      crew.code = stored.code || null;
      crew.solo = !!stored.solo;
      crew.device = stored.device || newDeviceId();
      crew.cursor = stored.cursor || 0;
      crew.known = stored.known || {};
      crew.outbox = stored.outbox || {};
    }
  } catch (e) { /* fall through to a fresh device id */ }
  if (!crew.device) crew.device = newDeviceId();

  /* Nothing chosen on this phone — either it is brand new, or it predates shared
     logs and has a season sitting in IndexedDB. Both join the shared log, and in
     the second case collectLocalChanges() stages that whole season for upload,
     so upgrading publishes the existing work instead of hiding it. */
  if (!crew.code && !crew.solo) {
    crew.code = SHARED_CODE;
    crew.cursor = 0; crew.known = {}; crew.outbox = {};
    collectLocalChanges();
    await persist();
  }

  crew.loaded = true;
  notify();
}

/** Join or create. Everything already on this device is staged for upload, so
 *  starting a crew never means abandoning the log you already have. */
export async function joinCrew(code) {
  const c = String(code || '').toUpperCase().trim();
  if (!validCode(c)) return { ok: false, error: 'That code does not look right.' };
  crew.code = c;
  crew.solo = false;
  crew.cursor = 0;
  crew.known = {};
  crew.outbox = {};
  collectLocalChanges();
  await persist();
  notify();

  const ok = await syncNow();
  if (ok) return { ok: true };

  /* Offline is fine — you can join in the trailer and sync at the hotel, and
     the outbox already holds this device's log. A server with no store is not
     fine: that crew can never work, so roll it back rather than leave the crew
     chief believing the rest of the phones will see their sheet. */
  if (crew.unconfigured) {
    const why = crew.error;
    await leaveCrew();
    /* Not the same as choosing to work alone. leaveCrew() sets `solo` so a
       deliberate opt-out survives a reload; here the opt-out was the server's
       doing, so clear it — once sharing is set up, the next boot should pick the
       shared log back up on its own rather than needing to be asked again. */
    crew.solo = false;
    await persist();
    crew.error = why;
    notify();
    return { ok: false, error: why, unconfigured: true };
  }
  return { ok: true, offline: true };
}

/** Leave. The log stays on this device untouched — leaving is not deleting.
 *  `solo` is what makes it stick: without it the next boot would see no code and
 *  helpfully re-join the shared log, undoing the choice that was just made. */
export async function leaveCrew() {
  crew.code = null; crew.solo = true;
  crew.cursor = 0; crew.known = {}; crew.outbox = {};
  crew.error = null; crew.lastSyncAt = null;
  await persist();
  notify();
}

/** Back onto the log every other phone is on. */
export function rejoinShared() { return joinCrew(SHARED_CODE) }

/* Sync on the events that actually mean "we might have signal or news":
   coming back online, returning to the app, and a slow background tick. */
export function startAutoSync() {
  hooks.changed = () => { if (crew.code) { collectLocalChanges(); notify(); syncNow({ silent: true }) } };
  if (typeof window === 'undefined') return;
  window.addEventListener('online', () => syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
  });
  // Someone finished a field — safe to show whatever arrived while they typed.
  document.addEventListener('focusout', () => setTimeout(flushPendingRepaint, 0));
  setInterval(() => { flushPendingRepaint(); syncNow({ silent: true }) }, 20000);
}
