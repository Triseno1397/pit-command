import { state, pendingDel } from '../state.js';
import { analyze } from '../analyze.js';
import { esc } from './esc.js';

export function hubHTML() {
  let h = `<div class="hub-hd"><h1>Race Days</h1><p>Every event, every session, saved. Tap a day to open it.</p>
    <div class="hub-tools">
      <button class="mini-btn" onclick="openBackups()">Backups</button>
      <button class="sum-btn" onclick="addDay()">+ New Race Day</button>
    </div></div>`;
  if (!state.days.length)
    return h + `<div class="zero"><h2>Nothing in the trailer yet.</h2>
      <p>Start a new race day above. Each day holds its own sessions, readings, and summary — so you can flip back through the season and compare notes track to track.</p></div>`;
  [...state.days].reverse().forEach(d => {
    const chips = d.sessions.map(s => {
      const A = analyze(s, d); let cls = '';
      if (A.balLabel.includes('TIGHT')) cls = 't'; else if (A.balLabel.includes('LOOSE')) cls = 'l';
      else if (A.balLabel === 'BALANCED') cls = 'b';
      return `<span class="chip ${cls}">${esc(s.name)}${A.balLabel ? ' · ' + A.balLabel : ''}</span>`
    }).join('');
    const who = [d.car ? '#' + d.car : '', d.driver].filter(Boolean).join(' ');
    const sub = [
      esc(d.track) || 'no track set',
      who ? esc(who) : '',
      esc(d.date),
      `${d.sessions.length} session${d.sessions.length === 1 ? '' : 's'}`
    ].filter(Boolean).join(' · ');
    h += `<div class="daycard" onclick="go({page:'day',dayId:'${d.id}'})">
      <div class="dc-main"><h3>${esc(d.name) || 'Untitled Day'}</h3>
        <div class="sub">${sub}</div>
        <div class="chips" style="margin-top:8px">${chips}</div></div>
      <div class="dc-actions" onclick="event.stopPropagation()">
        <button class="mini-btn" onclick="go({page:'summary',dayId:'${d.id}'})">Summary</button>
        <button class="mini-btn" onclick="exportCSV('${d.id}')">CSV</button>
        <button class="mini-btn${pendingDel === d.id ? ' arm' : ''}" onclick="delDay('${d.id}')">${pendingDel === d.id ? 'Tap again' : 'Delete'}</button>
      </div></div>`;
  });
  return h;
}
