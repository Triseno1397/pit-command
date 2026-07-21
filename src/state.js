/* ============================== STATE + PERSISTENCE ==============================
   Data lives on-device in IndexedDB. Same state shape and key as the reference
   (`lltool:state:v2`), same debounced autosave, so an old export drops straight in.
   ================================================================================ */

import { get as idbGet, set as idbSet } from 'idb-keyval';
import { TIRES } from './num.js';
import { hooks } from './hooks.js';

const KEY = 'lltool:state:v2';
const LEGACY_KEY = 'lltool:state';
/* Written synchronously when the app is backgrounded, so an autosave that was
   still in flight survives the OS killing the tab. Cleared once IndexedDB confirms. */
const PENDING_KEY = 'lltool:state:v2:pending';
/* A save we could not parse is kept here rather than thrown away — the season log
   is the whole point of the app, so never overwrite it silently. */
const CORRUPT_KEY = 'lltool:state:v2:corrupt';
/* Rolling restore points. A season log is worth keeping more than one copy of. */
const SNAP_KEY = 'lltool:snapshots:v1';
const MAX_SNAPSHOTS = 12;
const AUTO_SNAPSHOT_EVERY = 60 * 60 * 1000;   // at most one automatic restore point an hour

export let state = { days: [] };
export let view = { page: 'hub' };

/* transient UI state — deliberately not persisted */
export const activeTab = {};
export const smartBusy = {};
export const smartMsg = {};
export const dictDraft = {};
export let pendingDel = null;
let pendingTimer = null, saveTimer = null;

/* save status, surfaced in the header */
export let dirty = false;
export let saving = false;
export let lastSavedAt = null;
export let saveError = null;
export function saveStatus() { return { dirty, saving, lastSavedAt, saveError } }

const statusListeners = [];
export function onStatus(fn) { statusListeners.push(fn) }
function notify() { statusListeners.forEach(f => { try { f() } catch (e) { } }) }

export function setView(v) { view = v }
export function setPendingDel(v) { pendingDel = v }

export function blankReading() {
  const t = {}; TIRES.forEach(k => t[k] = { psi: '', size: '', ti: '', tm: '', to: '' });
  return { trackTemp: '', tires: t };
}

export function newSession(type, day) {
  const n = day.sessions.filter(s => s.type === type).length + 1;
  return {
    id: 's' + Date.now() + Math.floor(Math.random() * 999), type,
    name: type + (type === 'Main' ? '' : ' ' + n), notes: '',
    pre: blankReading(), post: blankReading()
  };
}

/** ISO (YYYY-MM-DD) is what the date input speaks; `date` stays the human string
 *  the hub, summary, and exports display. */
export function isoToday() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isoToDisplay(iso) {
  if (!iso) return '';
  const [y, m, dd] = iso.split('-').map(Number);
  if (!y || !m || !dd) return iso;
  return new Date(y, m - 1, dd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function displayToIso(text) {
  if (!text) return '';
  const t = Date.parse(text);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function newDay() {
  const iso = isoToday();
  return {
    id: 'd' + Date.now() + Math.floor(Math.random() * 999),
    name: 'Race Day ' + (state.days.length + 1),
    track: '', dateISO: iso, date: isoToDisplay(iso),
    driver: '', car: '', carClass: 'Limited Late Model', notes: '',
    sessions: []
  };
}

export function curDay() { return state.days.find(d => d.id === view.dayId) }
export function findS(id) { const d = curDay(); return d ? d.sessions.find(s => s.id === id) : null }

/* ---------- persistence ---------- */
export async function saveState() {
  const json = JSON.stringify(state);
  saving = true; notify();
  try {
    await idbSet(KEY, json);
    saveError = null; dirty = false; lastSavedAt = Date.now();
    try { localStorage.removeItem(PENDING_KEY) } catch (e) { /* private mode */ }
  } catch (e) {
    saveError = e && e.message ? e.message : 'write failed';
  } finally {
    saving = false; notify();
  }
  return !saveError;
}

/** Any edit. Marks the work unsaved and starts the safety-net autosave. */
export function queueSave() {
  dirty = true; notify();
  try { hooks.changed() } catch (e) { /* sync must never block an edit */ }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; autoSave() }, 700);
}

async function autoSave() {
  const ok = await saveState();
  if (ok) maybeAutoSnapshot();
}

/** Explicit Save. Writes immediately, no debounce, and lays down a restore point. */
export async function saveNow() {
  clearTimeout(saveTimer); saveTimer = null;
  const ok = await saveState();
  if (ok) await pushSnapshot('manual');
  return ok;
}

/** Autosave is debounced 700ms. Switching apps or locking the phone inside that
 *  window would otherwise drop the last reading entered, so on hide we write a
 *  synchronous localStorage mirror (guaranteed durable) and kick off the real
 *  IndexedDB write, which clears the mirror when it lands. */
export function flushSave() {
  if (!saveTimer) return;   // nothing debounced — IndexedDB is already current
  clearTimeout(saveTimer); saveTimer = null;
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(state)) } catch (e) { /* quota / private mode */ }
  saveState();
}

export function installLifecycleFlush() {
  const onHide = () => { if (document.visibilityState === 'hidden') flushSave() };
  document.addEventListener('visibilitychange', onHide);
  // iOS Safari does not reliably fire visibilitychange on app switch
  window.addEventListener('pagehide', flushSave);
}

/* ---------- restore points ----------
   Every explicit Save keeps a dated copy, plus one an hour while you work. If a
   day gets deleted by accident in the trailer, the season is still recoverable. */

export async function listSnapshots() {
  try { return (await idbGet(SNAP_KEY)) || [] } catch (e) { return [] }
}

export function cancelPendingSave() { clearTimeout(saveTimer); saveTimer = null }

export async function pushSnapshot(reason = 'manual') {
  try {
    const json = JSON.stringify(state);
    const snaps = (await idbGet(SNAP_KEY)) || [];
    if (snaps.length && snaps[0].json === json) {
      // Same content as the newest point. Don't stack a duplicate — but if the
      // crew explicitly hit Save, relabel it so the Backups list credits the
      // action they actually took rather than the autosave that beat them to it.
      if (reason === 'manual' && snaps[0].reason !== 'manual') {
        snaps[0] = { ...snaps[0], reason: 'manual', ts: Date.now() };
        await idbSet(SNAP_KEY, snaps);
      }
      return snaps;
    }
    const sessions = state.days.reduce((n, d) => n + d.sessions.length, 0);
    snaps.unshift({ ts: Date.now(), reason, days: state.days.length, sessions, json });
    const trimmed = snaps.slice(0, MAX_SNAPSHOTS);
    await idbSet(SNAP_KEY, trimmed);
    return trimmed;
  } catch (e) { return [] }
}

async function maybeAutoSnapshot() {
  try {
    const snaps = (await idbGet(SNAP_KEY)) || [];
    if (snaps.length && Date.now() - snaps[0].ts < AUTO_SNAPSHOT_EVERY) return;
    await pushSnapshot('auto');
  } catch (e) { /* snapshots are a safety net, never a blocker */ }
}

export async function restoreSnapshot(ts) {
  const snaps = await listSnapshots();
  const snap = snaps.find(s => s.ts === ts);
  if (!snap) return false;
  await pushSnapshot('before-restore');      // the current state becomes recoverable too
  replaceState(JSON.parse(snap.json));
  return saveState();
}

/* ---------- keeping the data around ----------
   Browsers evict IndexedDB for "best effort" origins under storage pressure. For a
   log the crew expects to still be there next season, ask for persistent storage. */

export async function ensurePersistentStorage() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (e) { return null }
}

export async function storageReport() {
  const out = { persisted: null, usage: null, quota: null };
  try {
    if (navigator.storage && navigator.storage.persisted) out.persisted = await navigator.storage.persisted();
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      out.usage = est.usage; out.quota = est.quota;
    }
  } catch (e) { /* not supported */ }
  return out;
}

/** Fills in fields added after a save was written, so old data never crashes the UI. */
export function normalize(s) {
  if (!s || !Array.isArray(s.days)) return { days: [] };
  s.days.forEach(d => {
    // fields added after some saves were written
    ['driver', 'car', 'notes', 'track'].forEach(f => { if (typeof d[f] !== 'string') d[f] = '' });
    if (typeof d.carClass !== 'string') d.carClass = 'Limited Late Model';
    if (typeof d.date !== 'string') d.date = '';
    if (typeof d.dateISO !== 'string') d.dateISO = displayToIso(d.date);
    if (!d.date && d.dateISO) d.date = isoToDisplay(d.dateISO);
    d.sessions = d.sessions || [];
    d.sessions.forEach(ss => {
      if (typeof ss.notes !== 'string') ss.notes = '';
      ['pre', 'post'].forEach(tab => {
        if (!ss[tab]) ss[tab] = blankReading();
        if (typeof ss[tab].trackTemp !== 'string') ss[tab].trackTemp = ss[tab].trackTemp == null ? '' : String(ss[tab].trackTemp);
        ss[tab].tires = ss[tab].tires || {};
        TIRES.forEach(k => {
          const t = ss[tab].tires[k] || {};
          ss[tab].tires[k] = { psi: t.psi ?? '', size: t.size ?? '', ti: t.ti ?? '', tm: t.tm ?? '', to: t.to ?? '' };
        });
      });
    });
  });
  return s;
}

export async function loadState() {
  // 1. An autosave interrupted by the OS backgrounding us — newest copy there is.
  try {
    const pending = localStorage.getItem(PENDING_KEY);
    if (pending) {
      state = normalize(JSON.parse(pending));
      await saveState();          // promote it into IndexedDB and clear the mirror
      return;
    }
  } catch (e) { try { localStorage.removeItem(PENDING_KEY) } catch (e2) { } }

  // 2. The normal path.
  let raw = null;
  try { raw = await idbGet(KEY) } catch (e) { /* IndexedDB unavailable */ }
  if (raw) {
    try { state = normalize(JSON.parse(raw)); return }
    catch (e) {
      // Unreadable, but do not drop it: park a copy so the season can be recovered
      // by hand instead of being overwritten by the next autosave.
      try { localStorage.setItem(CORRUPT_KEY, String(raw).slice(0, 4_000_000)) } catch (e2) { }
      console.error('[pit-command] saved state was unreadable; parked under ' + CORRUPT_KEY);
      state = { days: [] };
      return;
    }
  }

  // 3. Migrate a v2 payload left behind in localStorage by the artifact build.
  try {
    const ls = localStorage.getItem(KEY);
    if (ls) { state = normalize(JSON.parse(ls)); await saveState(); return }
  } catch (e) { /* ignore */ }

  // migrate v1 (single event) into a day
  try {
    const old = localStorage.getItem(LEGACY_KEY);
    if (old) {
      const o = JSON.parse(old);
      if (o && o.sessions && o.sessions.length) {
        const d = newDay();
        d.name = o.event && o.event.name ? o.event.name : 'Race Day 1';
        d.track = o.event && o.event.track ? o.event.track : '';
        d.sessions = o.sessions;
        state.days.push(d); state = normalize(state); await saveState();
      }
    }
  } catch (e) { /* ignore */ }
}

export function replaceState(next) { state = normalize(next) }

/* ---------- two-tap delete arming ---------- */
export function armDelete(id, onTick) {
  pendingDel = id; onTick();
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => { pendingDel = null; onTick() }, 3500);
}
export function disarmDelete() { clearTimeout(pendingTimer); pendingDel = null }
