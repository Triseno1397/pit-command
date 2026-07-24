import { TIRES, TIRE_COLORS, num, f1, f2 } from '../num.js';
import { analyze } from '../analyze.js';
import { cellNum } from './chart.js';
import { esc } from './esc.js';

/* v5 ledger: the whole readout sits in a centred 980px column of bordered panels.
   Only the wrapper is new — every section, table, and explainer below is unchanged. */
const wrap = h => `<div class="sum-wrap">${h}</div>`;

export function summaryHTML(d) {
  const S = d.sessions;
  const AA = S.map(s => analyze(s, d));
  const who = [d.car ? '#' + d.car : '', d.driver].filter(Boolean).join(' ');
  const meta = [esc(d.track) || 'no track', who ? esc(who) : '', esc(d.carClass), esc(d.date), 'full-day readout']
    .filter(Boolean).join(' · ');
  let h = `<div class="hub-hd sum-head"><h1>${esc(d.name)}</h1>
    <p>${meta}</p>
    <div class="hub-tools"><button class="mini-btn" onclick="exportCSV('${d.id}')">Export CSV</button></div></div>`;
  if ((d.notes || '').trim()) {
    h += `<div class="sum-sec"><h3>Day Notes</h3><div class="notecard">${esc(d.notes.trim())}</div></div>`;
  }
  if (!S.length) return wrap(h + `<div class="zero"><h2>No sessions logged.</h2><p>Go back and add sessions with data — the summary builds itself.</p></div>`);

  const avgOf = arr => { const a = arr.filter(v => v != null); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null };
  const inches = v => v == null ? '—' : f2(v) + '"';
  const cornerHead = TIRES.map(k => `<th style="color:${TIRE_COLORS[k]}">${k}</th>`).join('');

  /* Size & stagger detail leads the page — the day-average, per-corner sizes the
     crew sets the car on. Sizes only here: pressures and temps get their own
     day-average table right below, and repeating them just buries the number
     this section is about. */
  h += `<div class="sum-sec"><h3>Size &amp; Stagger Detail</h3><div class="tblscroll"><table class="sumtbl">
    <tr><th>Tire</th><th>Avg Cold Size</th><th>Avg Hot Size</th><th>Avg Growth</th></tr>`;
  TIRES.forEach(k => {
    const cold = avgOf(S.map(s => num(s.pre.tires[k].size)));
    const hot = avgOf(S.map(s => num(s.post.tires[k].size)));
    h += `<tr><td style="color:${TIRE_COLORS[k]}">${k}</td>
      <td>${inches(cold)}</td><td>${inches(hot)}</td>
      ${cellNum(avgOf(AA.map(A => A.growth[k])), '"', true)}</tr>`;
  });
  h += `</table></div>`;

  h += `<div class="tblscroll"><table class="sumtbl">
    <tr><th>Stagger</th><th>Avg Cold</th><th>Avg Hot</th><th>Avg Change</th></tr>`;
  [['Rear', 'stagColdRear', 'stagHotRear'], ['Front', 'stagColdFront', 'stagHotFront']].forEach(([label, ck, hk]) => {
    const cold = avgOf(AA.map(A => A[ck]));
    const hot = avgOf(AA.map(A => A[hk]));
    const moved = avgOf(AA.map(A => (A[ck] != null && A[hk] != null) ? A[hk] - A[ck] : null));
    h += `<tr><td>${label}</td><td>${inches(cold)}</td><td>${inches(hot)}</td>
      ${cellNum(moved, '"', true)}</tr>`;
  });
  h += `</table></div><div class="sum-note">Growth is hot minus cold on that corner, averaged across every session with both readings. A RR that keeps growing frees the car late in runs; a corner that shrinks is losing air. Set cold stagger so the hot number lands on your target for the Main — that is the one the car actually races on.</div></div>`;

  /* Day averages by corner, second — temps and pressures collapsed to one number
     per corner for the whole day, the quick "where did the car live" read that
     sits under the size detail above. */
  h += `<div class="sum-sec"><h3>Day Averages by Corner</h3><div class="tblscroll"><table class="sumtbl">
    <tr><th>Tire</th><th>Avg Hot Temp</th><th>Avg Cold psi</th><th>Avg Hot psi</th><th>Avg Gain</th><th>Avg Size Growth</th></tr>`;
  TIRES.forEach(k => {
    const temps = avgOf(AA.map(A => A.temps[k]));
    const cold = avgOf(S.map(s => num(s.pre.tires[k].psi)));
    const hot = avgOf(S.map(s => num(s.post.tires[k].psi)));
    const gain = avgOf(AA.map(A => A.gains[k]));
    const grow = avgOf(AA.map(A => A.growth[k]));
    h += `<tr><td style="color:${TIRE_COLORS[k]}">${k}</td>
      <td>${temps != null ? f1(temps) + '°F' : '—'}</td>
      <td>${cold != null ? f1(cold) : '—'}</td>
      <td>${hot != null ? f1(hot) : '—'}</td>
      ${cellNum(gain, ' psi', true)}${cellNum(grow, '"', true)}</tr>`;
  });
  h += `</table></div><div class="sum-note">Gain and growth are hot minus cold, averaged across every session with both readings.</div></div>`;

  /* balance timeline */
  h += `<div class="sum-sec"><h3>How the Day Went</h3>
    <div class="chips" style="display:flex;gap:6px;flex-wrap:wrap">`;
  S.forEach((s, i) => {
    const A = AA[i]; let cls = '';
    if (A.balLabel.includes('TIGHT')) cls = 't'; else if (A.balLabel.includes('LOOSE')) cls = 'l';
    else if (A.balLabel === 'BALANCED') cls = 'b';
    h += `<span class="chip ${cls}" style="font-size:.75rem;padding:6px 10px">${esc(s.name)} · ${A.balLabel || 'no temps'}</span>`
  });
  h += `</div><div class="sum-note">Blue = tight, red = loose, green = balanced. Read left to right and you can see whether your changes walked the car toward the window as the track changed.</div></div>`;

  /* Per-session tables. These were hand-rolled line charts; a crew chief reading
     a phone in the pits wants the number in a row, not a trend line to eyeball.
     Sessions run down the page so a full day scrolls instead of crowding the width. */

  /* average temps by session — each session's average temp on each corner */
  h += `<div class="sum-sec"><h3>Average Temps by Session</h3><div class="tblscroll"><table class="sumtbl">
    <tr><th>Session</th>${cornerHead}</tr>`;
  S.forEach((s, i) => {
    h += `<tr><td>${esc(s.name)}</td>${TIRES.map(k => {
      const t = AA[i].temps[k]; return `<td>${t != null ? f1(t) + '°' : '—'}</td>`;
    }).join('')}</tr>`;
  });
  h += `</table></div><div class="sum-note">Hotter tires are the ones doing the work. Read a corner down the day and you can see which one is carrying the car as the track changes.</div></div>`;

  /* pressure gain by session (hot − cold) */
  h += `<div class="sum-sec"><h3>Pressure Gain by Session</h3><div class="tblscroll"><table class="sumtbl">
    <tr><th>Session</th>${cornerHead}</tr>`;
  S.forEach((s, i) => {
    h += `<tr><td>${esc(s.name)}</td>${TIRES.map(k => cellNum(AA[i].gains[k], '', true)).join('')}</tr>`;
  });
  h += `</table></div><div class="sum-note">Hot minus cold, in psi. Typical asphalt build is roughly 3–7. A number above the pack is an overworked corner; near zero isn’t coming up to temp; below zero is a leak.</div></div>`;

  /* rear stagger — cold vs hot, per session */
  h += `<div class="sum-sec"><h3>Rear Stagger — Cold vs Hot</h3><div class="tblscroll"><table class="sumtbl">
    <tr><th>Session</th><th>Cold</th><th>Hot</th><th>Change</th></tr>`;
  S.forEach((s, i) => {
    const A = AA[i];
    const moved = (A.stagColdRear != null && A.stagHotRear != null) ? A.stagHotRear - A.stagColdRear : null;
    h += `<tr><td>${esc(s.name)}</td>
      <td>${A.stagColdRear != null ? f2(A.stagColdRear) + '"' : '—'}</td>
      <td>${A.stagHotRear != null ? f2(A.stagHotRear) + '"' : '—'}</td>
      ${cellNum(moved, '"', true)}</tr>`;
  });
  h += `</table></div><div class="sum-note">The gap between cold and hot is heat growth. Set your cold stagger so the HOT number lands on your target for the Main — that’s the one the car actually races on.</div></div>`;

  /* driver notes of the day, each against what was turned before that run —
     a note about the car being free means nothing without the change that
     preceded it */
  const noted = S.filter(s => (s.notes || '').trim() || (s.pre.changes || '').trim());
  if (noted.length) {
    h += `<div class="sum-sec"><h3>Driver Notes &amp; Changes Made</h3>`;
    noted.forEach(s => {
      const chg = (s.pre.changes || '').trim();
      const note = (s.notes || '').trim();
      h += `<div class="notecard"><b>${esc(s.name)}.</b>
        ${chg ? `<span class="nc-chg">Changed: ${esc(chg)}</span>` : ''}
        ${note ? esc(note) : ''}</div>`;
    });
    h += `<div class="sum-note">What was turned, then what the driver felt, next to what the tires measured. When the note and the temps disagree, believe the tires and ask again.</div></div>`;
  }

  /* all flags of the day */
  const crits = [];
  S.forEach((s, i) => AA[i].recs.filter(r => r.lvl === 'crit' || r.lvl === 'adj')
    .forEach(r => crits.push({ sess: s.name, ...r })));
  h += `<div class="sum-sec"><h3>Every Call &amp; Flag Raised Today</h3>`;
  h += crits.length ? crits.map(r => `<div class="rec ${r.lvl}">
      <span class="tag">${{ crit: 'Fix', adj: 'Adjust' }[r.lvl]}</span>
      <div><b>${esc(r.sess)} — ${esc(r.title)}.</b> ${esc(r.body)}</div></div>`).join('')
    : '<div class="empty-anal">No critical flags or adjustment calls today — clean day.</div>';
  h += `</div>`;
  return wrap(h);
}
