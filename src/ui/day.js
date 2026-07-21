import { TIRE_NAMES, num, f1 } from '../num.js';
import { analyze } from '../analyze.js';
import { activeTab, pendingDel, smartBusy, smartMsg, dictDraft } from '../state.js';
import { canSmartFill, speechSupported, isListening } from '../smartfill.js';
import { devKey, needsKey } from '../devkey.js';
import { analysisHTML } from './analysis.js';
import { esc } from './esc.js';

export function overviewHTML(d) {
  let h = '';
  d.sessions.forEach((s, i) => {
    const A = analyze(s, d);
    const tt = num(s.post.trackTemp) ?? num(s.pre.trackTemp);
    let balColor = 'var(--dim)';
    if (A.balLabel.includes('TIGHT')) balColor = 'var(--tight)';
    else if (A.balLabel.includes('LOOSE')) balColor = 'var(--loose)';
    else if (A.balLabel === 'BALANCED') balColor = 'var(--good)';
    h += `<div class="ov-chip"><div class="t">${i + 1} · ${esc(s.name)}</div>
      <div class="v">${tt != null ? f1(tt) + '°F track' : 'no track temp'}</div>
      <div class="bal" style="color:${balColor}">${A.balLabel || '—'}</div></div>`;
  });
  return h;
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

export function dayHTML(d) {
  let h = dayDetailsHTML(d);
  h += `<div class="overview" id="overview">${overviewHTML(d)}</div>`;
  if (!d.sessions.length)
    h += `<div class="zero"><h2>Green track. No data yet.</h2>
      <p>Add your first session below. Log pressures, temps, and tire sizes before and after each run — or snap a photo of your tire sheet and let the console read it.</p></div>`;
  d.sessions.forEach((s, i) => {
    if (!activeTab[s.id]) activeTab[s.id] = 'pre';
    const tab = activeTab[s.id];
    h += `<div class="sess" id="card-${s.id}">
      <div class="sess-hd">
        <span class="sess-num">S${i + 1}</span>
        <input class="sname" value="${esc(s.name)}" onchange="updS('${s.id}','name',this.value)">
        <select onchange="updS('${s.id}','type',this.value)">
          ${['Practice', 'Qualifying', 'Main'].map(t => `<option ${s.type === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <div class="sess-actions">
          <button class="del-btn" onclick="dupSession('${s.id}')">Duplicate</button>
          <button class="del-btn${pendingDel === s.id ? ' arm' : ''}" onclick="delSession('${s.id}')">${pendingDel === s.id ? 'Tap again to delete' : 'Remove'}</button>
        </div>
      </div>
      <div class="rw-tabs">
        <button class="${tab === 'pre' ? 'on' : ''}" onclick="setTab('${s.id}','pre')">Before · Cold</button>
        <button class="${tab === 'post' ? 'on' : ''}" onclick="setTab('${s.id}','post')">After · Hot</button>
      </div>
      <div class="rw-body">${smartHTML(s, tab)}${readingHTML(s, tab)}${notesHTML(s)}</div>
      <div class="anal-slot" id="anal-${s.id}">${analysisHTML(s, d)}</div></div>`;
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
      placeholder="…or type it: “Track temp 118. Right front 24 and a half psi, 88 and a quarter, temps 210 195 180.”">${esc(draft)}</textarea>

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
  const tireBox = k => {
    const t = rd.tires[k];
    return `
    <div class="tirebox">
      <h4>${k}<span>${TIRE_NAMES[k]}</span></h4>
      <div class="fields">
        <div class="fld"><label>Pressure psi</label>
          <input type="text" inputmode="decimal" autocomplete="off" value="${esc(t.psi)}" placeholder="—"
            onchange="updT('${s.id}','${tab}','${k}','psi',this.value)"></div>
        <div class="fld"><label>Size / rollout in</label>
          <input type="text" autocomplete="off" value="${esc(t.size)}" placeholder="e.g. 88 1/4"
            onchange="updT('${s.id}','${tab}','${k}','size',this.value)"></div>
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
        </div>
      </div>
    </div>`
  };
  return `
    <div class="tt-row"><label>Track Temp °F</label>
      <input type="text" inputmode="decimal" autocomplete="off" value="${esc(rd.trackTemp)}" placeholder="—"
        onchange="updTT('${s.id}','${tab}',this.value)">
      <span class="hint">${tab === 'pre' ? 'taken before the session' : 'taken right after the run'}</span>
    </div>
    <div class="tires">${tireBox('LF')}${tireBox('RF')}${tireBox('LR')}${tireBox('RR')}</div>`;
}
