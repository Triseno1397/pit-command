import { state, view, setView, curDay, findS, disarmDelete, saveStatus, onStatus } from './state.js';
import { hubHTML } from './ui/hub.js';
import { dayHTML, overviewHTML, addBarHTML } from './ui/day.js';
import { summaryHTML } from './ui/summary.js';
import { analysisHTML } from './ui/analysis.js';
import { esc } from './ui/esc.js';
import { stopDictate } from './smartfill.js';

export function go(v) {
  setView(v); disarmDelete(); stopDictate();
  window.scrollTo(0, 0); render();
}

/* ---------- save indicator ----------
   Deliberately loud when there is unsaved work and quiet once it is down. The
   crew needs to know, at a glance across a hot pit box, whether it is safe to
   put the phone in a pocket. */

function agoText(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return s + 's ago';
  const m = Math.round(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.round(h / 24) + 'd ago';
}

export function saveButtonHTML() {
  const { dirty, saving, lastSavedAt, saveError } = saveStatus();
  if (saveError) {
    return `<button class="save-btn err" onclick="saveNow()" title="${esc(saveError)}">
      <span class="sb-dot"></span><span class="sb-label">Retry Save</span></button>`;
  }
  if (saving) {
    return `<button class="save-btn saving" disabled><span class="sb-dot"></span><span class="sb-label">Saving…</span></button>`;
  }
  if (dirty) {
    return `<button class="save-btn dirty" onclick="saveNow()">
      <span class="sb-dot"></span><span class="sb-label">Save</span></button>`;
  }
  const when = agoText(lastSavedAt);
  return `<button class="save-btn clean" onclick="saveNow()" title="Everything is written to this device">
    <span class="sb-dot"></span><span class="sb-label">Saved${when ? ' · ' + when : ''}</span></button>`;
}

export function paintSaveButton() {
  const slot = document.getElementById('saveSlot');
  if (slot) slot.innerHTML = saveButtonHTML();
}

/** Keep the "Saved · 2m ago" label honest without re-rendering the page. */
export function startSaveTicker() {
  onStatus(paintSaveButton);
  setInterval(() => { if (!saveStatus().dirty) paintSaveButton() }, 30000);
}

/* One button, same label and same place on every screen, for "show me every race
   day again". "All Days" read like a filter — something that widens the list you
   are looking at — when what it actually does is leave this event and go back to
   the season. It is named for the destination now, and it is the loudest thing in
   the header after the save state, because getting back to the list is the single
   most-used move in the app. */
const allDaysBtn = `<button class="back-btn home" onclick="go({page:'hub'})">
  <span class="flagicon"></span>All Race Days</button>`;

export function render() {
  const app = document.getElementById('app');
  const meta = document.getElementById('hdrMeta');
  const bar = document.getElementById('addBar');
  if (view.page === 'hub') {
    bar.style.display = 'none';
    meta.innerHTML = `<span id="saveSlot">${saveButtonHTML()}</span>`;
    app.innerHTML = hubHTML();
  }
  else if (view.page === 'day') {
    const d = curDay(); if (!d) { go({ page: 'hub' }); return }
    bar.style.display = 'flex';
    bar.innerHTML = addBarHTML(d);
    meta.innerHTML = `${allDaysBtn}<span id="saveSlot">${saveButtonHTML()}</span>`;
    app.innerHTML = dayHTML(d);
  }
  else if (view.page === 'summary') {
    bar.style.display = 'none';
    const d = curDay(); if (!d) { go({ page: 'hub' }); return }
    // Two steps back, both spelled out: this event, or the whole season. The
    // event name is clipped so a long one cannot push the save state off-screen.
    const name = (d.name || 'This Day').trim();
    const short = name.length > 16 ? name.slice(0, 15).trimEnd() + '…' : name;
    meta.innerHTML = `<button class="back-btn" onclick="go({page:'day',dayId:'${d.id}'})">← ${esc(short)}</button>
      ${allDaysBtn}<span id="saveSlot">${saveButtonHTML()}</span>`;
    app.innerHTML = summaryHTML(d);
  }
}

/** Targeted refresh after a field edit.
 *  A full re-render would tear down the inputs the crew is tabbing through and
 *  drop focus mid-entry — with gloves on, that loses a reading. */
export function refreshSession(sid) {
  if (view.page !== 'day') { render(); return }
  const d = curDay(); if (!d) return;
  const s = findS(sid);
  const slot = document.getElementById('anal-' + sid);
  if (s && slot) slot.innerHTML = analysisHTML(s, d);
  const ov = document.getElementById('overview');
  if (ov) ov.innerHTML = overviewHTML(d);
}

/* ---------- modal ---------- */
export function openModal(html) {
  const m = document.getElementById('modal');
  if (!m) return;
  m.innerHTML = `<div class="modal-back" onclick="closeModal(event)">
    <div class="modal-card" role="dialog" aria-modal="true" onclick="event.stopPropagation()">${html}</div>
  </div>`;
  m.style.display = 'block';
  document.body.style.overflow = 'hidden';
}

export function closeModal(e) {
  if (e && e.target && !e.target.classList.contains('modal-back')) return;
  const m = document.getElementById('modal');
  if (m) { m.innerHTML = ''; m.style.display = 'none' }
  document.body.style.overflow = '';
}

let toastTimer = null;
export function toast(msg, bad) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3200);
}
