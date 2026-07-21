/* Data safety: everything lives on one phone, so a one-tap backup out and a
   one-tap restore in are not optional. */

import { TIRES } from './num.js';
import { state, replaceState, saveState, normalize } from './state.js';
import { hooks } from './hooks.js';

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportJSON() {
  const payload = { app: 'pit-command', version: 2, exportedAt: new Date().toISOString(), days: state.days };
  download(`pit-command-backup-${stamp()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  hooks.toast(`Backed up ${state.days.length} race day${state.days.length === 1 ? '' : 's'}.`);
}

export function importJSON() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.onchange = async () => {
    const file = inp.files && inp.files[0]; if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const days = Array.isArray(parsed) ? parsed : parsed.days;
      if (!Array.isArray(days)) throw new Error('no days array');
      const merged = mergeDays(state.days, normalize({ days }).days);
      replaceState({ days: merged });
      await saveState();
      hooks.render();
      hooks.toast(`Imported ${days.length} race day${days.length === 1 ? '' : 's'}.`);
    } catch (e) {
      hooks.toast('That file isn’t a Pit Command backup.', true);
    }
  };
  inp.click();
}

/** Existing days win on id collision, so a re-import is idempotent rather than duplicating. */
function mergeDays(current, incoming) {
  const seen = new Set(current.map(d => d.id));
  return current.concat(incoming.filter(d => !seen.has(d.id)));
}

/* ---------- per-day CSV: sessions × readings, flat ---------- */
const CSV_HEAD = [
  'day', 'date', 'track', 'driver', 'car', 'class',
  'session', 'type', 'reading', 'track_temp',
  ...TIRES.flatMap(k => [`${k}_psi`, `${k}_size`, `${k}_in`, `${k}_mid`, `${k}_out`]),
  'driver_notes', 'day_notes'
];

function cell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function dayRows(d, rows) {
  d.sessions.forEach(s => {
    ['pre', 'post'].forEach(tab => {
      const rd = s[tab];
      rows.push([
        d.name, d.dateISO || d.date, d.track, d.driver, d.car, d.carClass,
        s.name, s.type,
        tab === 'pre' ? 'before (cold)' : 'after (hot)', rd.trackTemp,
        ...TIRES.flatMap(k => {
          const t = rd.tires[k];
          return [t.psi, t.size, t.ti, t.tm, t.to];
        }),
        tab === 'pre' ? (s.notes || '') : '',
        tab === 'pre' ? (d.notes || '') : ''
      ]);
    });
  });
}

function writeCSV(filename, rows) {
  download(filename, rows.map(r => r.map(cell).join(',')).join('\r\n'), 'text/csv');
}

export function exportCSV(dayId) {
  const d = state.days.find(x => x.id === dayId);
  if (!d) return;
  const rows = [CSV_HEAD];
  dayRows(d, rows);
  const slug = (d.name || 'race-day').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'race-day';
  writeCSV(`pit-command-${slug}-${stamp()}.csv`, rows);
  hooks.toast(`Exported ${d.sessions.length} session${d.sessions.length === 1 ? '' : 's'} to CSV.`);
}

/** Every day, every session, one flat table — for looking back across a season. */
export function exportAllCSV() {
  if (!state.days.length) { hooks.toast('Nothing logged yet.', true); return }
  const rows = [CSV_HEAD];
  state.days.forEach(d => dayRows(d, rows));
  writeCSV(`pit-command-season-${stamp()}.csv`, rows);
  const sessions = state.days.reduce((n, d) => n + d.sessions.length, 0);
  hooks.toast(`Exported ${state.days.length} day${state.days.length === 1 ? '' : 's'} · ${sessions} session${sessions === 1 ? '' : 's'}.`);
}
