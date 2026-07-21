/* Self-hosted display + mono stacks. Bundled, not fetched from a CDN — the app
   has to render correctly on a phone with no signal. */
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-800.css';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow/latin-700.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import './styles.css';

import {
  state, activeTab, dictDraft, blankReading,
  newDay, newSession, curDay, findS, loadState, queueSave,
  setView, armDelete, disarmDelete, pendingDel, installLifecycleFlush,
  saveNow, restoreSnapshot, pushSnapshot, ensurePersistentStorage, isoToDisplay
} from './state.js';
import { go, render, refreshSession, toast, startSaveTicker, openModal, closeModal } from './render.js';
import { hooks } from './hooks.js';
import { smartPhoto, smartText, toggleDictate, stopDictate, clearDraft } from './smartfill.js';
import { exportJSON, importJSON, exportCSV, exportAllCSV } from './exportimport.js';
import { backupsHTML } from './ui/backups.js';
import { crewHTML } from './ui/crew.js';
import { deleteDayHTML } from './ui/day.js';
import {
  crew, loadCrew, joinCrew, leaveCrew, rejoinShared, syncNow,
  startAutoSync, makeCode, validCode, onSync
} from './sync.js';
import { checkDevKey, saveDevKey } from './devkey.js';

hooks.render = render;
hooks.refreshSession = refreshSession;
hooks.toast = toast;

/* ============================== EVENTS ============================== */
window.go = go;

window.addDay = () => { const d = newDay(); state.days.push(d); queueSave(); go({ page: 'day', dayId: d.id }) };

/* Deleting a whole race day is the only destructive act in the app that cannot
   be re-typed from a tire sheet, and on a shared log it takes the day off every
   phone. So it asks, by name, and lays down a restore point on the way out. */
window.delDay = id => {
  const d = state.days.find(x => x.id === id);
  if (!d) return;
  openModal(deleteDayHTML(d));
};

window.reallyDelDay = async id => {
  const d = state.days.find(x => x.id === id);
  if (!d) { closeModal(); return }
  const name = d.name || 'That day';
  await pushSnapshot('before-delete');       // recoverable from Backups
  state.days = state.days.filter(x => x.id !== id);
  queueSave();
  closeModal();
  go({ page: 'hub' });
  toast(name + ' deleted. Backups still has it if that was the wrong one.');
};

window.updDay = (f, v) => {
  const d = curDay(); if (!d) return;
  d[f] = v;
  // keep the human-readable date in step with the picker
  if (f === 'dateISO') d.date = isoToDisplay(v);
  queueSave();
};

/** Enter fills the sheet; Shift+Enter keeps a newline for multi-corner dictation. */
window.draftKey = (e, sid) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    dictDraft[sid] = e.target.value;
    smartText(sid);
  }
};

/** Scroll a freshly added card into view. Guarded: the card can be re-rendered
 *  away before this fires, and scrollIntoView is absent in some environments —
 *  an uncaught throw in here is invisible to the user but poisons the console. */
function revealCard(selector) {
  setTimeout(() => {
    try {
      const c = document.querySelector(selector);
      if (c && typeof c.scrollIntoView === 'function') {
        c.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (e) { /* scrolling is a nicety, never a failure */ }
  }, 50);
}

window.addSession = t => {
  const d = curDay(); if (!d) return;
  d.sessions.push(newSession(t, d)); queueSave(); render();
  revealCard('.sess:last-of-type');
};

/** "Copy cold pressures from last session" — the common case is that the crew
 *  rolls out on the same starting air, so pre-fill it and let them adjust. */
window.dupSession = id => {
  const d = curDay(); if (!d) return;
  const src = findS(id); if (!src) return;
  const copy = newSession(src.type, d);
  copy.name = src.name + ' copy';
  copy.pre = JSON.parse(JSON.stringify(src.pre));
  copy.post = blankReading();
  const at = d.sessions.findIndex(s => s.id === id);
  d.sessions.splice(at + 1, 0, copy);
  activeTab[copy.id] = 'pre';
  queueSave(); render();
  revealCard('#card-' + copy.id);
};

window.delSession = id => {
  const d = curDay(); if (!d) return;
  if (pendingDel === id) {
    disarmDelete();
    d.sessions = d.sessions.filter(s => s.id !== id);
    delete activeTab[id]; delete dictDraft[id];
    queueSave(); render(); return;
  }
  armDelete(id, render);
};

window.setTab = (id, t) => { activeTab[id] = t; render() };

window.updS = (id, f, v) => {
  const s = findS(id); if (!s) return;
  s[f] = v; queueSave();
  if (f === 'type') render(); else refreshSession(id);
};

window.updT = (id, tab, tire, f, v) => {
  const s = findS(id); if (!s) return;
  s[tab].tires[tire][f] = v; queueSave(); refreshSession(id);
};

window.updTT = (id, tab, v) => {
  const s = findS(id); if (!s) return;
  s[tab].trackTemp = v; queueSave(); refreshSession(id);
};

window.saveDraft = (id, v) => { dictDraft[id] = v };

window.smartPhoto = smartPhoto;
window.smartText = smartText;
window.toggleDictate = toggleDictate;
window.clearDraft = clearDraft;
window.saveDevKey = saveDevKey;
window.devKeyKey = e => { if (e.key === 'Enter') { e.preventDefault(); saveDevKey() } };
window.exportJSON = exportJSON;
window.importJSON = importJSON;
window.exportCSV = exportCSV;
window.exportAllCSV = exportAllCSV;
window.closeModal = closeModal;

/* ---------- save ---------- */
window.saveNow = async () => {
  const ok = await saveNow();
  toast(ok ? 'Saved to this device. Safe to close the app.' : 'Save failed — check device storage.', !ok);
};

/* ---------- backups ---------- */
window.openBackups = async () => {
  openModal('<div class="modal-hd"><h3>Backups &amp; Storage</h3></div><div class="empty-anal">Loading…</div>');
  const card = document.querySelector('.modal-card');
  if (card) card.innerHTML = await backupsHTML();
};

window.restorePoint = async ts => {
  const ok = await restoreSnapshot(ts);
  closeModal();
  if (ok) { go({ page: 'hub' }); toast('Restored. The previous state is still in your restore points.') }
  else toast('Could not restore that point.', true);
};

/* ---------- where the log lives ---------- */
const crewPanel = () => '<div class="modal-hd"><h3>Sharing</h3></div>' + crewHTML();

/** Marked so a repaint can find this panel and not, say, the delete confirmation
 *  that happens to be the open modal instead. */
window.openCrew = () => { openModal(`<div id="crewPanel">${crewPanel()}</div>`) };

function repaintCrew() {
  const panel = document.getElementById('crewPanel');
  if (panel) panel.innerHTML = crewPanel();
}

window.crewCreate = async () => {
  const code = makeCode();
  const r = await joinCrew(code);
  repaintCrew(); render();
  if (r.ok && r.offline) toast('Crew ' + code + ' started. It will sync when there is signal.');
  else if (r.ok) toast('Crew ' + code + ' started. Read that code to the rest of the crew.');
  else toast(r.error || 'Could not start the crew.', true);
};

window.crewShared = async () => {
  const r = await rejoinShared();
  repaintCrew(); render();
  if (r.ok && r.offline) toast('Sharing on. This phone uploads as soon as there is signal.');
  else if (r.ok) toast('Sharing on. Every phone on the app now works this log.');
  else toast(r.error || 'Could not turn sharing on.', true);
};

window.crewJoin = async () => {
  const el = document.getElementById('crew-input');
  const raw = el ? el.value.trim().toUpperCase() : '';
  if (!validCode(raw)) { toast('That code should look like ABCD-2345.', true); return }
  const r = await joinCrew(raw);
  repaintCrew(); render();
  if (r.ok && r.offline) toast('Joined ' + raw + '. It will pull the crew log when there is signal.');
  else if (r.ok) toast('Joined crew ' + raw + '.');
  else toast(r.error || 'Could not reach that crew.', true);
};

window.crewKey = e => { if (e.key === 'Enter') { e.preventDefault(); window.crewJoin() } };

window.crewSync = async () => {
  const ok = await syncNow();
  repaintCrew();
  toast(ok ? 'Synced.' : (crew.error || 'Could not sync.'), !ok);
};

window.crewLeave = async () => {
  await leaveCrew();
  repaintCrew(); render();
  toast('Sharing off. Everything on this phone stayed put.');
};

/* Smart Fill availability flips with the radio — repaint the buttons. */
window.addEventListener('online', () => render());
window.addEventListener('offline', () => { stopDictate(); render() });

/* ============================== INIT ============================== */
(async () => {
  await loadState();
  if (state.days.length === 1 && state.days[0].sessions.length) {
    setView({ page: 'day', dayId: state.days[0].id });
  }
  render();
  installLifecycleFlush();
  startSaveTicker();

  // Ask the browser not to evict the season log when the device runs low on space.
  ensurePersistentStorage();

  /* Crew sync. Loaded after the local state so a shared log never renders before
     the device's own work does — local-first is the whole contract. */
  await loadCrew();
  startAutoSync();
  /* Only the crew panel repaints on sync status. A full render here would tear
     down whatever input the crew is tabbing through and drop focus mid-reading —
     the same failure the targeted-refresh work exists to prevent. */
  onSync(repaintCrew);
  if (crew.code) syncNow({ silent: true });
  // Local dev with no API key yet? Offer the one-time Smart Fill setup in the app.
  checkDevKey();
  // A restore point from before this session's edits, so today can always be undone.
  if (state.days.length) pushSnapshot('auto');
})();
