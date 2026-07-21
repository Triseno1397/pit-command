/* Where the log lives. Three states, and the app is in the first one unless
   somebody deliberately moved it:

     shared   — the default. Every phone that opens this app works the same log.
     private  — a crew code, for a team that wants its own separate season.
     solo     — this phone only. An explicit opt-out, remembered across reloads.

   Joining is still an explicit act in the private case: the log on this phone is
   a season of work, and "which crew am I in" should never be something that
   happened by accident. */

import { crew, pendingCount, confirmedCount, makeCode, onSharedLog } from '../sync.js';
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

/** The hub button. Says where the data is going, not what the panel is called. */
export function crewButtonLabel() {
  if (!crew.code) return 'This Phone Only';
  if (onSharedLog()) return 'Shared';
  return 'Crew ' + crew.code;
}

/** One line the crew chief can read at a glance across a hot pit box.
 *
 *  It carries a count now. "Up to date" is not an answer to the only question
 *  that matters — *is my sheet actually up there* — because a phone that has
 *  never sent a single reading is also, technically, up to date. The number is
 *  what separates those two, and zero is the one worth shouting about. */
export function crewStatusLine() {
  if (!crew.code) return 'Saved on this phone only — other phones will not see these days.';
  const where = onSharedLog() ? 'Shared with every phone' : 'Shared with crew ' + crew.code;
  /* "Not configured" is a different animal from "no signal" and has to read that
     way: one clears when a bar of service shows up, the other never will. */
  if (crew.unconfigured) return 'Not syncing — sharing is not set up on the server yet.';

  const pend = pendingCount();
  const up = confirmedCount();
  const held = `${up} value${up === 1 ? '' : 's'} on the crew log`;

  if (pend) return `${where} · ${held} · ${pend} waiting for signal`;
  if (crew.error) return `${where} · ${crew.error}`;
  if (crew.syncing) return where + ' · syncing…';
  if (!crew.lastSyncAt) return where + ' · not synced yet';
  if (!up) return `${where} · nothing from this phone is on the crew log yet`;
  return `${where} · ${held} · confirmed ${ago(crew.lastSyncAt)}`;
}

export function crewHTML() {
  const pend = pendingCount();
  const shared = onSharedLog();

  /* ---- opted out ---- */
  if (!crew.code) {
    return `<p class="sum-note">This phone is logging on its own right now. Days entered here stay
      here — nobody else's phone will see them, and this phone will not see theirs.</p>
      ${crew.error ? `<div class="crew-msg bad">${esc(crew.error)}</div>` : ''}
      <div class="crew-row">
        <button class="sum-btn" onclick="crewShared()">Share with everyone</button>
      </div>
      <p class="sum-note">Everything already on this phone is uploaded when you do — nothing is lost,
        and nothing is overwritten.</p>

      <div class="crew-sep">or join a private crew</div>
      ${joinRowHTML()}`;
  }

  /* ---- on a log ---- */
  return `<div class="crew-code">${shared ? 'SHARED' : esc(crew.code)}</div>
    <p class="sum-note">${shared
      ? `Every phone that opens this app is on this log. Add a race day here and it shows up
         on the other phones; readings they enter show up here. No code to pass around.`
      : `Only phones that enter <b>${esc(crew.code)}</b> see this log. Read the code to anyone
         who should be on the sheet — they open the same link, tap Shared, and enter it.`}</p>

    <div class="store-line">
      <div class="store-sub ${!pend && !crew.error && !crew.unconfigured ? 'good' : ''}">${esc(crewStatusLine())}</div>
    </div>
    ${pend ? `<p class="sum-note">Your work is saved on this phone either way — waiting only means the
      other phones have not seen it yet.</p>` : ''}

    <div class="crew-row">
      <button class="mini-btn" onclick="crewSync()">Sync now</button>
      <button class="mini-btn" onclick="crewResend()">Send everything</button>
      ${shared ? '' : `<button class="mini-btn" onclick="crewShared()">Back to shared</button>`}
      <button class="mini-btn danger" onclick="crewLeave()">Stop sharing</button>
    </div>
    <p class="sum-note"><b>Sync now</b> sends what changed since last time. <b>Send everything</b>
      re-uploads this phone's whole season from scratch — use it if the count above looks too low,
      or if a day you logged here is missing on someone else's phone. It cannot overwrite newer
      work from another phone, and it never deletes anything.</p>
    <p class="sum-note">Stopping keeps everything currently on this phone — it only stops the sharing.
      The log stays put for everyone else.</p>

    ${shared ? `<div class="crew-sep">or use a private crew code</div>${joinRowHTML()}
      <p class="sum-note">A private code gives your team its own separate season, apart from the
        shared log. Days already on this phone come with you.</p>` : ''}`;
}

function joinRowHTML() {
  return `<div class="crew-row">
      <input id="crew-input" class="crew-input" placeholder="ABCD-2345" maxlength="9"
        autocapitalize="characters" autocorrect="off" spellcheck="false"
        oninput="this.value=this.value.toUpperCase()" onkeydown="crewKey(event)">
      <button class="mini-btn" onclick="crewJoin()">Join</button>
      <button class="mini-btn" onclick="crewCreate()">New code</button>
    </div>`;
}

export { makeCode };
