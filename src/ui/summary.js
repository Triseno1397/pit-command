import { TIRES, TIRE_COLORS, num, f1, f2 } from '../num.js';
import { analyze } from '../analyze.js';
import { cellNum } from './chart.js';
import { esc } from './esc.js';

/* v5 ledger: the whole readout sits in a centred column of bordered panels.
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

  /* 1 — Day Notes lead the page. */
  if ((d.notes || '').trim()) {
    h += `<div class="sum-sec"><h3>Day Notes</h3><div class="notecard">${esc(d.notes.trim())}</div></div>`;
  }
  if (!S.length) return wrap(h + `<div class="zero"><h2>No sessions logged.</h2><p>Go back and add sessions with data — the summary builds itself.</p></div>`);

  const avgOf = arr => { const a = arr.filter(v => v != null); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null };
  const inches = v => v == null ? '—' : f2(v) + '"';
  const cornerHead = TIRES.map(k => `<th style="color:${TIRE_COLORS[k]}">${k}</th>`).join('');
  /* One session's cold and hot reading, side by side. Absolute numbers, not a
     day average — the actual value on the car that run. */
  const pair = (c, hv) => (c == null && hv == null) ? '—'
    : `${inches(c)}<span class="cell-arrow"> → </span>${inches(hv)}`;

  /* 2 — How the day went sits right under the notes: the whole day's balance,
     left to right, before any of the number tables. */
  h += `<div class="sum-sec"><h3>How the Day Went</h3>
    <div class="chips">`;
  S.forEach((s, i) => {
    const A = AA[i]; let cls = '';
    if (A.balLabel.includes('TIGHT')) cls = 't'; else if (A.balLabel.includes('LOOSE')) cls = 'l';
    else if (A.balLabel === 'BALANCED') cls = 'b';
    h += `<span class="chip ${cls}">${esc(s.name)} · ${A.balLabel || 'no temps'}</span>`
  });
  h += `</div><div class="sum-note">Blue = tight, red = loose, green = balanced. Read left to right and you can see whether your changes walked the car toward the window as the track changed.</div></div>`;

  /* 3 — Size & Stagger detail, per session, absolute. Every corner's tire size
     and each axle's stagger, cold → hot, one row per run — the numbers the crew
     set the car on, not a day average that buries the run-to-run story. */
  h += `<div class="sum-sec"><h3>Size &amp; Stagger Detail</h3><div class="tblscroll"><table class="sumtbl">
    <tr><th>Session</th>${cornerHead}<th>Front Stagger</th><th>Rear Stagger</th></tr>`;
  S.forEach((s, i) => {
    const A = AA[i];
    h += `<tr><td>${esc(s.name)}</td>
      ${TIRES.map(k => `<td>${pair(num(s.pre.tires[k].size), num(s.post.tires[k].size))}</td>`).join('')}
      <td>${pair(A.stagColdFront, A.stagHotFront)}</td>
      <td>${pair(A.stagColdRear, A.stagHotRear)}</td></tr>`;
  });
  h += `</table></div><div class="sum-note">Each cell is cold → hot, in inches. Stagger is the right-side size minus the left on that axle. Set your cold stagger so the HOT number lands on your target for the Main — that’s the one the car actually races on.</div></div>`;

  /* 4 — Pressure gain by session (hot − cold). */
  h += `<div class="sum-sec"><h3>Pressure Gain by Session</h3><div class="tblscroll"><table class="sumtbl">
    <tr><th>Session</th>${cornerHead}</tr>`;
  S.forEach((s, i) => {
    h += `<tr><td>${esc(s.name)}</td>${TIRES.map(k => cellNum(AA[i].gains[k], '', true)).join('')}</tr>`;
  });
  h += `</table></div><div class="sum-note">Hot minus cold, in psi. Typical asphalt build is roughly 3–7. A number above the pack is an overworked corner; near zero isn’t coming up to temp; below zero is a leak.</div></div>`;

  /* 5 — Day averages by corner: temps and pressures collapsed to one number per
     corner for the whole day, the quick "where did the car live" read. */
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

  /* 6 — Average temps by session — each session's average temp on each corner. */
  h += `<div class="sum-sec"><h3>Average Temps by Session</h3><div class="tblscroll"><table class="sumtbl">
    <tr><th>Session</th>${cornerHead}</tr>`;
  S.forEach((s, i) => {
    h += `<tr><td>${esc(s.name)}</td>${TIRES.map(k => {
      const t = AA[i].temps[k]; return `<td>${t != null ? f1(t) + '°' : '—'}</td>`;
    }).join('')}</tr>`;
  });
  h += `</table></div><div class="sum-note">Hotter tires are the ones doing the work. Read a corner down the day and you can see which one is carrying the car as the track changes.</div></div>`;

  /* 7 — Driver notes of the day, each against what was turned before that run —
     a note about the car being free means nothing without the change that
     preceded it. */
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

  return wrap(h);
}
