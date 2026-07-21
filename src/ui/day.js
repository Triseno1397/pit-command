import { TIRE_NAMES, num, f1 } from '../num.js';
import { analyze } from '../analyze.js';
import {
  activeTab, sessOpen, pendingDel, smartBusy, smartMsg, dictDraft,
  SESSION_TYPES, canAddSession, limitReason
} from '../state.js';
import { canSmartFill, speechSupported, isListening } from '../smartfill.js';
import { devKey, needsKey } from '../devkey.js';
import { analysisHTML } from './analysis.js';
import { esc } from './esc.js';

function balColor(label) {
  if (!label) return 'var(--dim)';
  if (label.includes('TIGHT')) return 'var(--tight)';
  if (label.includes('LOOSE')) return 'var(--loose)';
  if (label === 'BALANCED') return 'var(--good)';
  return 'var(--dim)';
}

export function overviewHTML(d) {
  let h = '';
  d.sessions.forEach((s, i) => {
    const A = analyze(s, d);
    const tt = num(s.post.trackTemp) ?? num(s.pre.trackTemp);
    h += `<div class="ov-chip"><div class="t">${i + 1} · ${esc(s.name)}</div>
      <div class="v">${tt != null ? f1(tt) + '°F track' : 'no track temp'}</div>
      <div class="bal" style="color:${balColor(A.balLabel)}">${A.balLabel || '—'}</div></div>`;
  });
  return h;
}

/** What a shut card still has to say. Collapsed, a session is one strip in a list
 *  of eight, so it carries the two things that tell the crew which run this was:
 *  how hot the track was and what the car did on it. */
export function glanceHTML(s, d) {
  const A = analyze(s, d);
  const tt = num(s.post.trackTemp) ?? num(s.pre.trackTemp);
  return `<span class="g-temp">${tt != null ? f1(tt) + '°F' : '—'}</span>
    <span class="g-bal" style="color:${balColor(A.balLabel)}">${A.balLabel || '—'}</span>`;
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

/** Everything that identifies the day: who drove it, what car, where, when.
 *  Kept at the top of the day so a season's worth of entries stays labelled. */
function dayDetailsHTML(d) {
  const field = (label, html) => `<div class="dd-fld"><label>${label}</label>${html}</div>`;
  return `<section class="daydetails">
    <div class="dd-hd">
      <span>Race Day Details</span>
      <button class="mini-btn danger" onclick="delDay('${d.id}')">Delete Day</button>
      <button class="sum-btn" onclick="go({page:'summary',dayId:'${d.id}'})">Summary ▸</button>
    </div>
    <div class="dd-grid">
      ${field('Event', `<input value="${esc(d.name)}" placeholder="Race Day 1" onchange="updDay('name',this.value)">`)}
      ${field('Track', `<input value="${esc(d.track)}" placeholder="e.g. Hickory Motor Speedway" onchange="updDay('track',this.value)">`)}
      ${field('Date', `<input type="date" value="${esc(d.dateISO || '')}" onchange="updDay('dateISO',this.value)">`)}
      ${field('Driver', `<input value="${esc(d.driver)}" placeholder="Driver name" autocomplete="name" onchange="updDay('driver',this.value)">`)}
      ${field('Car #', `<input value="${esc(d.car)}" placeholder="e.g. 21" inputmode="numeric" onchange="updDay('car',this.value)">`)}
      ${field('Class', `<select onchange="updDay('carClass',this.value)">
        ${CLASSES.map(c => `<option ${d.carClass === c ? 'selected' : ''}>${c}</option>`).join('')}
      </select>`)}
    </div>
    ${field('Day Notes', `<textarea rows="2" placeholder="Weather, track prep, baseline setup, anything worth remembering next year."
      onchange="updDay('notes',this.value)">${esc(d.notes || '')}</textarea>`)}
  </section>`;
}

/* The bar is built per day rather than baked into the shell, because what a day
   can still take depends on what is already on it: practice runs all afternoon,
   qualifying happens once, and the night ends in one main or two. A button that
   would break that is greyed out and says why, rather than silently accepting a
   fifth "Main" that then skews every day-level average. */
export function addBarHTML(d) {
  return SESSION_TYPES.map(t => {
    const ok = canAddSession(d, t);
    const main = t === 'Practice' ? ' main' : '';
    return `<button class="${main.trim()}${ok ? '' : ' off'}" ${ok ? '' : 'disabled'}
      title="${ok ? '' : esc(limitReason(t))}" onclick="addSession('${t}')">+ ${t}</button>`;
  }).join('');
}

/* One line above the cards for the two questions a long day raises: how many runs
   are on this sheet, and can I see them all at once. Only earns its space once
   there is more than one session to fold. */
export function sessToolsHTML(d) {
  const n = d.sessions.length;
  if (n < 2) return '';
  const anyShut = d.sessions.some(s => !sessOpen[s.id]);
  return `<div class="sess-tools">
    <span>${n} sessions on this sheet</span>
    <button class="mini-btn" onclick="setAllSessions(${anyShut})">${anyShut ? 'Expand All' : 'Collapse All'}</button>
  </div>`;
}

export function dayHTML(d) {
  let h = dayDetailsHTML(d);
  h += `<div class="overview" id="overview">${overviewHTML(d)}</div>`;
  if (!d.sessions.length)
    h += `<div class="zero"><h2>Green track. No data yet.</h2>
      <p>Add your first session below. Log pressures, temps, and tire sizes before and after each run — or snap a photo of your tire sheet and let the console read it.</p></div>`;
  h += `<div id="sessTools">${sessToolsHTML(d)}</div>`;
  const last = d.sessions.length - 1;
  d.sessions.forEach((s, i) => {
    if (!activeTab[s.id]) activeTab[s.id] = 'pre';
    // First sight of a card: the run being worked is the last one on the sheet.
    if (sessOpen[s.id] === undefined) sessOpen[s.id] = i === last;
    const open = sessOpen[s.id];
    const tab = activeTab[s.id];
    h += `<div class="sess${open ? '' : ' shut'}" id="card-${s.id}">
      <div class="sess-hd" onclick="sessHdTap(event,'${s.id}')">
        <button class="sess-tog" aria-expanded="${open}" aria-controls="body-${s.id}"
          aria-label="${open ? 'Collapse' : 'Expand'} ${esc(s.name)}" onclick="toggleSess('${s.id}')"></button>
        <span class="sess-num">S${i + 1}</span>
        <input class="sname" value="${esc(s.name)}" onchange="updS('${s.id}','name',this.value)">
        <span class="sess-glance" id="glance-${s.id}">${glanceHTML(s, d)}</span>
        <div class="sess-actions">
          <button class="del-btn" onclick="dupSession('${s.id}')">Duplicate</button>
          <button class="del-btn${pendingDel === s.id ? ' arm' : ''}" onclick="delSession('${s.id}')">${pendingDel === s.id ? 'Tap again to delete' : 'Remove'}</button>
        </div>
      </div>
      <div class="sess-body" id="body-${s.id}">
        <div class="rw-tabs">
          <button class="${tab === 'pre' ? 'on' : ''}" onclick="setTab('${s.id}','pre')">Before · Cold</button>
          <button class="${tab === 'post' ? 'on' : ''}" onclick="setTab('${s.id}','post')">After · Hot</button>
        </div>
        <div class="rw-body">${smartHTML(s, tab)}${readingHTML(s, tab)}${notesHTML(s)}</div>
        <div class="anal-slot" id="anal-${s.id}">${analysisHTML(s, d)}</div>
      </div></div>`;
  });
  return h;
}

function notesHTML(s) {
  return `<div class="notes">
    <label for="notes-${s.id}">Driver Notes</label>
    <textarea id="notes-${s.id}" placeholder="What the driver said: entry, center, off — and what you changed."
      onchange="updS('${s.id}','notes',this.value)">${esc(s.notes || '')}</textarea>
  </div>`;
}

export function smartHTML(s, tab) {
  const busy = smartBusy[s.id];
  const msg = smartMsg[s.id] || '';
  const online = canSmartFill();
  const listening = isListening(s.id);
  const draft = dictDraft[s.id] || '';
  const hasText = !!draft.trim();
  const target = tab === 'pre' ? 'Before · Cold' : 'After · Hot';

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
      <span class="sf-target">→ ${target}</span>
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

export function readingHTML(s, tab) {
  const rd = s[tab];
  /* Tread temps are only ever pyrometered as the car comes off the track — a
     cold tire has nothing to say. So the cold sheet is pressures and sizes, and
     the three temp boxes exist on the hot sheet only. */
  const hot = tab === 'post';
  const tireBox = k => {
    const t = rd.tires[k];
    const temps = hot ? `
        <div class="tempslab">Tire Temps °F</div>
        <div class="fields temps3" style="grid-column:1/-1">
          <div class="fld"><label>Inside</label>
            <input type="text" inputmode="decimal" autocomplete="off" value="${esc(t.ti)}" placeholder="—"
              onchange="updT('${s.id}','${tab}','${k}','ti',this.value)"></div>
          <div class="fld"><label>Middle</label>
            <input type="text" inputmode="decimal" autocomplete="off" value="${esc(t.tm)}" placeholder="—"
              onchange="updT('${s.id}','${tab}','${k}','tm',this.value)"></div>
          <div class="fld"><label>Outside</label>
            <input type="text" inputmode="decimal" autocomplete="off" value="${esc(t.to)}" placeholder="—"
              onchange="updT('${s.id}','${tab}','${k}','to',this.value)"></div>
        </div>` : '';
    return `
    <div class="tirebox">
      <h4>${k}<span>${TIRE_NAMES[k]}</span></h4>
      <div class="fields">
        <div class="fld"><label>Pressure psi</label>
          <input type="text" inputmode="decimal" autocomplete="off" value="${esc(t.psi)}" placeholder="—"
            onchange="updT('${s.id}','${tab}','${k}','psi',this.value)"></div>
        <div class="fld"><label>Size / rollout in</label>
          <input type="text" autocomplete="off" value="${esc(t.size)}" placeholder="e.g. 88 1/4"
            onchange="updT('${s.id}','${tab}','${k}','size',this.value)"></div>${temps}
      </div>
    </div>`
  };

  /* What was turned since the last run, written down before the run rather than
     remembered after it. It sits above the readings because it is the reason the
     next set of numbers looks different from the last set. */
  const changes = hot ? '' : `
    <div class="notes changes">
      <label for="chg-${s.id}">Changes Made</label>
      <textarea id="chg-${s.id}" placeholder="What was turned since the last run: air, wedge, track bar, springs, stagger, tires."
        onchange="updRd('${s.id}','pre','changes',this.value)">${esc(rd.changes || '')}</textarea>
    </div>`;

  /* Tire life belongs to the cold sheet (it is what you rolled out on) and laps
     run to the hot one (it is what you did). Both sit beside the track temp
     because all three are the context every reading below has to be read in. */
  const second = hot
    ? `<div class="tt-fld"><label>Laps Run</label>
        <input type="text" inputmode="numeric" autocomplete="off" value="${esc(rd.laps || '')}" placeholder="—"
          onchange="updRd('${s.id}','post','laps',this.value)"></div>`
    : `<div class="tt-fld wide"><label>Tire Life</label>
        <input type="text" autocomplete="off" value="${esc(rd.tireLife || '')}" placeholder="e.g. 2 runs"
          onchange="updRd('${s.id}','pre','tireLife',this.value)"></div>`;

  return `${changes}
    <div class="tt-row">
      <div class="tt-fld"><label>Track Temp °F</label>
        <input type="text" inputmode="decimal" autocomplete="off" value="${esc(rd.trackTemp)}" placeholder="—"
          onchange="updTT('${s.id}','${tab}',this.value)"></div>
      ${second}
      <span class="hint">${hot
      ? 'track temp carried over from the cold sheet — laps are what the run actually was'
      : 'read the track once, cold; it carries straight to the hot sheet'}</span>
    </div>
    <div class="tires">${tireBox('LF')}${tireBox('RF')}${tireBox('LR')}${tireBox('RR')}</div>`;
}
