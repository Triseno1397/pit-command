/* Crew panel. Joining is deliberately a two-step, explicit act: the log on this
   phone is a season of work, and "which crew am I in" should never be something
   that happened by accident. */

import { crew, pendingCount, makeCode } from '../sync.js';
import { esc } from './esc.js';

function ago(ts) {
  if (!ts) return 'not yet';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return s + 's ago';
  const m = Math.round(s / 60);
  if (m < 60) return m + 'm ago';
  return Math.round(m / 60) + 'h ago';
}

/** One line the crew chief can read at a glance across a hot pit box. */
export function crewStatusLine() {
  if (!crew.code) return '';
  const pend = pendingCount();
  if (crew.error) return pend ? `${pend} change${pend === 1 ? '' : 's'} waiting for signal` : crew.error;
  if (crew.syncing) return 'Syncing…';
  if (pend) return `${pend} change${pend === 1 ? '' : 's'} waiting for signal`;
  return 'Crew synced · ' + ago(crew.lastSyncAt);
}

export function crewHTML() {
  const pend = pendingCount();

  if (!crew.code) {
    return `<div class="modal-card">
      <h2>Crew</h2>
      <p class="sum-note">Right now this log lives on this phone only. Start a crew and every phone that
      enters the same code works from the same log — readings appear on the other phones as they land.
      You can still log a whole race day with no signal; it syncs when there is service.</p>

      <div class="crew-row">
        <button class="sum-btn" onclick="crewCreate()">Start a new crew</button>
      </div>
      <p class="sum-note">This device's log becomes the crew's starting point. Nothing is lost.</p>

      <div class="crew-sep">or join one</div>
      <div class="crew-row">
        <input id="crew-input" class="crew-input" placeholder="ABCD-2345" maxlength="9"
          autocapitalize="characters" autocorrect="off" spellcheck="false"
          oninput="this.value=this.value.toUpperCase()" onkeydown="crewKey(event)">
        <button class="mini-btn" onclick="crewJoin()">Join</button>
      </div>
      ${crew.error ? `<div class="crew-msg bad">${esc(crew.error)}</div>` : ''}
      <p class="sum-note">Joining pulls the crew's log onto this phone and merges in anything already here.</p>
    </div>`;
  }

  return `<div class="modal-card">
    <h2>Crew</h2>
    <div class="crew-code">${esc(crew.code)}</div>
    <p class="sum-note">Read this to anyone who should be on the sheet. They open
    the same link, tap Crew, and enter it.</p>

    <div class="store-line">
      <div class="store-sub ${!pend && !crew.error ? 'good' : ''}">${esc(crewStatusLine())}</div>
    </div>
    ${pend ? `<p class="sum-note">Your work is saved on this phone either way — waiting only means the
      other phones have not seen it yet.</p>` : ''}

    <div class="crew-row">
      <button class="mini-btn" onclick="crewSync()">Sync now</button>
      <button class="mini-btn danger" onclick="crewLeave()">Leave crew</button>
    </div>
    <p class="sum-note">Leaving keeps everything currently on this phone — it only stops the sharing.
    The crew's log stays put for everyone else.</p>
  </div>`;
}

export { makeCode };
