import { listSnapshots, storageReport, state } from '../state.js';
import { esc } from './esc.js';

function when(ts) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}

const REASON = {
  manual: 'You hit Save',
  auto: 'Autosave',
  'before-restore': 'Before a restore'
};

function bytes(n) {
  if (n == null) return null;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

export async function backupsHTML() {
  const snaps = await listSnapshots();
  const store = await storageReport();
  const sessions = state.days.reduce((n, d) => n + d.sessions.length, 0);

  let storeLine;
  if (store.persisted === true) {
    storeLine = 'Protected — this browser will not evict your data to reclaim space.';
  } else if (store.persisted === false) {
    storeLine = 'Best-effort storage. Install to the home screen to make it permanent, and keep exporting backups.';
  } else {
    storeLine = 'Stored on this device.';
  }
  const used = bytes(store.usage);

  let h = `<div class="modal-hd">
      <h3>Backups &amp; Storage</h3>
      <button class="mini-btn" onclick="closeModal()">Close</button>
    </div>
    <div class="store-line">
      <div><b>${state.days.length}</b> race day${state.days.length === 1 ? '' : 's'} · <b>${sessions}</b> session${sessions === 1 ? '' : 's'} on this device${used ? ' · ' + used + ' used' : ''}</div>
      <div class="store-sub ${store.persisted === true ? 'good' : ''}">${storeLine}</div>
    </div>
    <div class="modal-row">
      <button class="sum-btn" onclick="exportJSON()">Export Backup File</button>
      <button class="mini-btn" onclick="exportAllCSV()">Export Season CSV</button>
      <button class="mini-btn" onclick="importJSON()">Import Backup</button>
    </div>
    <h4 class="modal-sub">Restore Points</h4>`;

  if (!snaps.length) {
    h += `<div class="empty-anal">No restore points yet. One is kept every time you hit Save, and hourly while you work.</div>`;
    return h;
  }

  h += `<div class="snap-list">`;
  snaps.forEach(s => {
    h += `<div class="snap">
      <div class="snap-main">
        <div class="snap-when">${esc(when(s.ts))}</div>
        <div class="snap-meta">${s.days} day${s.days === 1 ? '' : 's'} · ${s.sessions} session${s.sessions === 1 ? '' : 's'} · ${esc(REASON[s.reason] || s.reason)}</div>
      </div>
      <button class="mini-btn" onclick="restorePoint(${s.ts})">Restore</button>
    </div>`;
  });
  h += `</div><div class="sum-note">Restoring replaces everything currently on the device — but the current state is saved as its own restore point first, so it is never a one-way door.</div>`;
  return h;
}
