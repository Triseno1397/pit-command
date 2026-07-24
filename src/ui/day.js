import { TIRES, TIRE_NAMES } from '../num.js';
import { analyze } from '../analyze.js';
import {
  state, activeTab, detailsOpen, readoutOpen, pendingDel, smartBusy, smartMsg, dictDraft,
  SESSION_TYPES, canAddSession, limitReason
} from '../state.js';
import { canSmartFill, speechSupported, isListening } from '../smartfill.js';
import { devKey, needsKey } from '../devkey.js';
import { readoutHTML, heatMap } from './analysis.js';
import { esc } from './esc.js';

/* Balance → the card's chip class and the balance-strip marker position. Same
   mapping and same formula the readout used before — presentation only. */
export function balClass(label) {
  if (!label) return '';
  if (label.includes('TIGHT')) return 't';
  if (label.includes('LOOSE')) return 'l';
  if (label === 'BALANCED') return 'b';
  return '';
}
export function balPos(A) {
  return A.balance == null ? 50 : 50 - A.balance * 45;
}

const CLASSES = ['Limited Late Model', 'Late Model', 'Super Late Model', 'Crate Late Model',
  'Modified', 'Street Stock', 'Sportsman', 'Other'];

/** The one screen that asks before a whole event goes away.
 *
 *  Deleting a day used to be a two-tap arm on a small button. That was already
 *  thin for a night's work, and now that the log is shared it deletes that night
 *  off every phone on the crew — so it gets a real question, with the name and
 *  the session count in it, because "Race Day 3" and "Race Day 4" look identical
 *  on a small button and there is no undo button in a hot pit box. */
export function deleteDayHTML(d) {
  const n = d.sessions.length;
  const where = [d.track, d.date].filter(Boolean).join(' · ');
  return `<div class="modal-hd"><h3>Delete this race day?</h3></div>
    <div class="del-target">
      <b>${esc(d.name) || 'Untitled Day'}</b>
      <span>${esc(where) || 'no track or date set'}</span>
      <span>${n} session${n === 1 ? '' : 's'} of readings</span>
    </div>
    <p class="sum-note">This removes the day from every phone on the log, not just this one.
      A restore point is taken first, so you can still put it back from
      <b>Backups</b> if this turns out to be the wrong one.</p>
    <div class="crew-row">
      <button class="mini-btn" onclick="closeModal()">Keep it</button>
      <button class="mini-btn danger" onclick="reallyDelDay('${d.id}')">Delete the day</button>
    </div>`;
}

/* The strip below the header: every race day as a quick-switch button (the active
   one filled, with an orange sub-line), the primary way to start a new one, the
   add-a-session buttons (moved up here from a tile at the end of the board so the
   main in-day action rides the top bar), and the day-level actions. */
function dayStripHTML(d) {
  const days = state.days.map(x =>
    `<button class="ds-day${x.id === d.id ? ' on' : ''}" onclick="go({page:'day',dayId:'${x.id}'})">${esc(x.name) || 'Untitled'}</button>`
  ).join('');
  const addBtns = SESSION_TYPES.map(t => {
    const ok = canAddSession(d, t);
    const emph = t === 'Practice' ? ' ds-add-primary' : t === 'Main' ? ' ds-add-ghost' : '';
    return `<button class="ds-addbtn${emph}${ok ? '' : ' off'}" ${ok ? '' : 'disabled'}
      title="${ok ? '' : esc(limitReason(t))}" onclick="addSession('${t}')">+ ${t}</button>`;
  }).join('');
  return `<div class="pc-daystrip">
    <div class="ds-days">
      ${days}
      <button class="sum-btn" onclick="addDay()">+ New Race Day</button>
    </div>
    <div class="ds-add">
      <span class="ds-add-cap">Add session</span>
      ${addBtns}
    </div>
    <div class="ds-actions">
      <button class="mini-btn" onclick="toggleDetails('${d.id}')">Day Details</button>
      <button class="mini-btn" onclick="go({page:'summary',dayId:'${d.id}'})">Day Summary</button>
      <button class="mini-btn" onclick="exportCSV('${d.id}')">CSV</button>
      <button class="mini-btn danger" onclick="delDay('${d.id}')">Delete Day</button>
    </div>
  </div>`;
}

/** Everything that identifies the day: who drove it, what car, where, when.
 *  Folded away by default now — the Day Details button in the strip reveals it —
 *  but always in the DOM so a season's worth of entries stays labelled. */
function dayDetailsHTML(d) {
  const open = !!detailsOpen[d.id];
  const field = (label, html) => `<div class="dd-fld"><label>${label}</label>${html}</div>`;
  return `<section class="daydetails" id="daydetails"${open ? '' : ' hidden'}>
    <div class="dd-body">
      <div class="dd-grid">
        ${field('Event', `<input value="${esc(d.name)}" placeholder="Race Day 1" onchange="updDay('name',this.value)">`)}
        ${field('Track', `<input value="${esc(d.track)}" placeholder="e.g. Hickory Motor Speedway" onchange="updDay('track',this.value)">`)}
        ${field('Date', `<input type="date" value="${esc(d.dateISO || '')}" onchange="updDay('dateISO',this.value)">`)}
        ${field('Driver', `<input value="${esc(d.driver)}" placeholder="Driver name" autocomplete="name" onchange="updDay('driver',this.value)">`)}
        ${field('Class', `<select onchange="updDay('carClass',this.value)">
          ${CLASSES.map(c => `<option ${d.carClass === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>`)}
      </div>
      ${field('Day Notes', `<textarea rows="2" placeholder="Weather, track prep, baseline setup, anything worth remembering next year."
        onchange="updDay('notes',this.value)">${esc(d.notes || '')}</textarea>`)}
    </div>
  </section>`;
}

export function dayHTML(d) {
  let h = dayStripHTML(d);
  h += dayDetailsHTML(d);
  if (!d.sessions.length)
    h += `<div class="zero"><h2>Green track. No data yet.</h2>
      <p>Add your first session from the <b>Add session</b> buttons up top. Log pressures, temps, and tire sizes before and after each run — or snap a photo of your tire sheet and let the console read it.</p></div>`;
  h += `<div class="pc-board">`;
  d.sessions.forEach((s, i) => { h += cardHTML(s, d, i) });
  h += `</div>`;
  return h;
}

/* One horizontal card per session: header + balance strip, the run's context,
   what was changed, Smart Fill, the full cold/hot tire grid, driver notes, and a
   fold-away Crew Chief Readout. */
function cardHTML(s, d, i) {
  const A = analyze(s, d);
  const open = !!readoutOpen[s.id];
  return `<section class="pc-card sess pc-panel" id="card-${s.id}">
    <div class="pc-card__hd">
      <span class="sess-num">S${i + 1}</span>
      <input class="pc-sname" value="${esc(s.name)}" onchange="updS('${s.id}','name',this.value)">
      <span class="chip ${balClass(A.balLabel)}" id="chip-${s.id}">${esc(A.balLabel) || '—'}</span>
    </div>
    <div class="pc-bstrip"><span class="pc-bmark" id="bmark-${s.id}" style="left:${balPos(A)}%"></span></div>
    <div class="pc-ctx">
      <div class="pc-fld"><label>Track °F</label>
        <input type="text" inputmode="decimal" autocomplete="off" value="${esc(s.pre.trackTemp)}" placeholder="—"
          onchange="updTT('${s.id}','pre',this.value)"></div>
      <div class="pc-fld"><label>Laps Run</label>
        <input type="text" inputmode="numeric" autocomplete="off" value="${esc(s.post.laps || '')}" placeholder="—"
          onchange="updRd('${s.id}','post','laps',this.value)"></div>
    </div>
    <div class="pc-fld pc-life"><label>Tire Life</label>
      <input type="text" autocomplete="off" value="${esc(s.pre.tireLife || '')}" placeholder="e.g. 2 runs"
        onchange="updRd('${s.id}','pre','tireLife',this.value)"></div>
    <div class="pc-changes">
      <label for="chg-${s.id}">Changes Made</label>
      <textarea id="chg-${s.id}" rows="2" placeholder="What was turned since the last run: air, wedge, track bar, springs, stagger, tires."
        onchange="updRd('${s.id}','pre','changes',this.value)">${esc(s.pre.changes || '')}</textarea>
    </div>
    ${smartHTML(s, activeTab[s.id] || 'pre')}
    ${tireGridHTML(s, heatMap(A))}
    <div class="pc-dnotes">
      <label for="notes-${s.id}">Driver Notes</label>
      <textarea id="notes-${s.id}" rows="2" placeholder="What the driver said: entry, center, off — and what you changed."
        onchange="updS('${s.id}','notes',this.value)">${esc(s.notes || '')}</textarea>
    </div>
    <button class="pc-rotoggle${open ? ' open' : ''}" id="rotoggle-${s.id}" onclick="toggleReadout('${s.id}')">${open ? '▲ Hide Crew Chief Readout' : '▼ Crew Chief Readout'}</button>
    <div class="pc-readout" id="anal-${s.id}"${open ? '' : ' hidden'}>${readoutHTML(s, d)}</div>
    <div class="pc-cardft">
      <button onclick="dupSession('${s.id}')">Duplicate</button>
      <button class="rm${pendingDel === s.id ? ' arm' : ''}" onclick="delSession('${s.id}')">${pendingDel === s.id ? 'Tap again to delete' : 'Remove'}</button>
    </div>
  </section>`;
}

/* The whole cold/hot sheet for one session as a single grid: corner, cold psi,
   cold size, hot psi, hot size, and the 3-point hot temps. Cold cells are white,
   hot cells carry the warm fill. Every input keeps the field name and handler it
   had when it lived on a tab. */
function tireGridHTML(s, hm) {
  const row = k => {
    const cold = s.pre.tires[k], hot = s.post.tires[k];
    const temp = (f, lab) => `<div class="t3"><label>${lab}</label>
      <input type="text" inputmode="decimal" autocomplete="off" value="${esc(hot[f])}" placeholder="—"
        onchange="updT('${s.id}','post','${k}','${f}',this.value)"></div>`;
    return `<tr>
      <td class="pc-corner" title="${esc(TIRE_NAMES[k])}" style="background:${hm[k]}">${k}</td>
      <td class="cold"><input type="text" inputmode="decimal" autocomplete="off" value="${esc(cold.psi)}" placeholder="—"
        onchange="updT('${s.id}','pre','${k}','psi',this.value)"></td>
      <td class="cold"><input type="text" autocomplete="off" value="${esc(cold.size)}" placeholder="88 1/4"
        onchange="updT('${s.id}','pre','${k}','size',this.value)"></td>
      <td class="hot"><input type="text" inputmode="decimal" autocomplete="off" value="${esc(hot.psi)}" placeholder="—"
        onchange="updT('${s.id}','post','${k}','psi',this.value)"></td>
      <td class="hot"><input type="text" autocomplete="off" value="${esc(hot.size)}" placeholder="88 1/4"
        onchange="updT('${s.id}','post','${k}','size',this.value)"></td>
      <td class="hot"><div class="pc-temps3">${temp('ti', 'Inside')}${temp('tm', 'Middle')}${temp('to', 'Outside')}</div></td>
    </tr>`;
  };
  return `<table class="pc-tiregrid">
    <thead>
      <tr class="grp"><th></th><th class="g-cold" colspan="2">Before · Cold</th><th class="g-hot" colspan="3">After · Hot</th></tr>
      <tr class="sub"><th style="width:14%"></th><th style="width:14%">psi</th><th style="width:17%">size / rollout</th>
        <th style="width:14%">psi</th><th style="width:17%">size / rollout</th><th style="width:27%">Tire Temps °F</th></tr>
    </thead>
    <tbody>${TIRES.map(row).join('')}</tbody>
  </table>`;
}

export function smartHTML(s, tab) {
  const busy = smartBusy[s.id];
  const msg = smartMsg[s.id] || '';
  const online = canSmartFill();
  const listening = isListening(s.id);
  const draft = dictDraft[s.id] || '';
  const hasText = !!draft.trim();

  const talkBtn = speechSupported()
    ? `<button class="sf-talk${listening ? ' live' : ''}" onclick="toggleDictate('${s.id}')"
         aria-pressed="${listening}">
         <span class="sf-mic">${listening ? '■' : '🎤'}</span>
         <span>${listening ? 'Listening… tap to fill' : 'Talk it in'}</span>
       </button>`
    : '';

  // one-time local setup, in the app rather than in a dotfile
  if (needsKey()) {
    const m = devKey.msg || '';
    return `<div class="smart setup">
      <div class="smart-hd"><span>Turn on Smart Fill</span></div>
      <p class="sf-setup-copy">Paste your Anthropic API key once and Smart Fill can read your
        photos and dictation. It is saved to <code>.env.local</code> on this computer and
        never stored in the browser.</p>
      <div class="sf-setup-row">
        <input id="devkey-input" type="password" autocomplete="off" spellcheck="false"
          placeholder="sk-ant-api03-…" onkeydown="devKeyKey(event)">
        <button class="sf-go" ${devKey.busy ? 'disabled' : ''} onclick="saveDevKey()">
          ${devKey.busy ? 'Checking…' : 'Turn On'}
        </button>
      </div>
      <div class="note">Get one at <b>console.anthropic.com → API Keys</b>. The key is checked
        against Anthropic before it is saved, so a bad paste fails now rather than at the track.
        Everything else in the app works without it.</div>
      ${m ? (m.startsWith('!') ? `<div class="err">${esc(m.slice(1))}</div>` : `<div class="oknote">${esc(m)}</div>`) : ''}
    </div>`;
  }

  return `<div class="smart${listening ? ' listening' : ''}">
    <div class="smart-hd">
      <span>Smart Fill</span>
      <span class="sf-target">→
        <button class="sf-seg${tab === 'pre' ? ' on' : ''}" onclick="setTab('${s.id}','pre')">Before · Cold</button>
        <button class="sf-seg${tab === 'post' ? ' on' : ''}" onclick="setTab('${s.id}','post')">After · Hot</button>
      </span>
      ${online ? '' : '<span class="offline">No signal — manual entry</span>'}
    </div>

    <div class="sf-actions">
      ${talkBtn}
      <button class="sf-scan${online ? '' : ' off'}" ${busy || !online ? 'disabled' : ''}
        onclick="smartPhoto('${s.id}','${tab}')">
        <span class="sf-mic">📷</span><span>${busy ? 'Reading…' : 'Scan a photo'}</span>
      </button>
    </div>

    <textarea id="dict-${s.id}" rows="3"
      oninput="saveDraft('${s.id}',this.value)"
      onkeydown="draftKey(event,'${s.id}')"
      placeholder="${tab === 'pre'
      ? '…or type it: “Track temp 118. Right front 24 and a half psi, 88 and a quarter.”'
      : '…or type it: “Right front 28 psi, 88 and a half, temps 210 195 180.”'}">${esc(draft)}</textarea>

    <div class="sf-submit">
      <button class="sf-go" ${(!hasText || busy || !online) ? 'disabled' : ''} onclick="smartText('${s.id}')">
        ${busy ? 'Reading…' : `Fill the ${tab === 'pre' ? 'Cold' : 'Hot'} Sheet →`}
      </button>
      ${hasText ? `<button class="sf-clear" onclick="clearDraft('${s.id}')">Clear</button>` : ''}
      <span class="sf-hint">${listening
      ? 'Say it however it comes out — filler is ignored.'
      : hasText ? 'Enter to fill' : 'Talk, type, or photograph the sheet'}</span>
    </div>

    ${msg ? (msg.startsWith('!')
      ? `<div class="err">${esc(msg.slice(1))}</div>`
      : `<div class="oknote">${esc(msg)}</div>`) : ''}
  </div>`;
}
