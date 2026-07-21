import { TIRES, TIRE_COLORS, num, f1, f2 } from '../num.js';
import { analyze } from '../analyze.js';
import { lineChart, cellNum } from './chart.js';
import { esc } from './esc.js';

export function summaryHTML(d) {
  const S = d.sessions;
  const labels = S.map((s, i) => 'S' + (i + 1));
  const AA = S.map(s => analyze(s, d));
  const who = [d.car ? '#' + d.car : '', d.driver].filter(Boolean).join(' ');
  const meta = [esc(d.track) || 'no track', who ? esc(who) : '', esc(d.carClass), esc(d.date), 'full-day readout']
    .filter(Boolean).join(' · ');
  let h = `<div class="hub-hd"><h1>${esc(d.name)}</h1>
    <p>${meta}</p>
    <div class="hub-tools"><button class="mini-btn" onclick="exportCSV('${d.id}')">Export CSV</button></div></div>`;
  if ((d.notes || '').trim()) {
    h += `<div class="sum-sec"><h3>Day Notes</h3><div class="notecard">${esc(d.notes.trim())}</div></div>`;
  }
  if (!S.length) return h + `<div class="zero"><h2>No sessions logged.</h2><p>Go back and add sessions with data — the summary builds itself.</p></div>`;

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

  /* avg tire temps chart */
  h += `<div class="sum-sec"><h3>Average Tire Temps by Session</h3>` +
    lineChart(TIRES.map(k => ({ name: k, color: TIRE_COLORS[k], vals: AA.map(A => A.temps[k]) })), labels, '°F') +
    `<div class="sum-note">Hotter tires are the ones doing the work. Watch which line climbs session over session — that corner is carrying the car.</div></div>`;

  /* pressure gains chart */
  h += `<div class="sum-sec"><h3>Pressure Gain by Session (hot − cold)</h3>` +
    lineChart(TIRES.map(k => ({ name: k, color: TIRE_COLORS[k], vals: AA.map(A => A.gains[k]) })), labels, 'psi') +
    `<div class="sum-note">Typical asphalt build is roughly 3–7 psi. A line above the pack is an overworked corner; a flat line near zero isn’t coming up to temp; below zero is a leak.</div></div>`;

  /* stagger chart */
  h += `<div class="sum-sec"><h3>Rear Stagger — Cold vs Hot</h3>` +
    lineChart([
      { name: 'Cold (before)', color: '#4C8DFF', vals: AA.map(A => A.stagColdRear) },
      { name: 'Hot (after)', color: '#F0524F', vals: AA.map(A => A.stagHotRear) }], labels, 'in') +
    `<div class="sum-note">The gap between the lines is heat growth. Set your cold stagger so the HOT line lands on your target for the Main — that’s the number the car actually races on.</div></div>`;

  /* track temp chart */
  h += `<div class="sum-sec"><h3>Track Temp Through the Day</h3>` +
    lineChart([{
      name: 'Track °F', color: '#FFD447',
      vals: S.map(s => num(s.post.trackTemp) ?? num(s.pre.trackTemp))
    }], labels, '°F') +
    `<div class="sum-note">Rule of thumb: trim ~0.5–1 psi cold for every 10–15°F the track comes up, and expect grip to fall off as it heats.</div></div>`;

  /* per-tire day averages */
  const avgOf = arr => { const a = arr.filter(v => v != null); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null };
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

  /* size differentials per session */
  h += `<div class="sum-sec"><h3>Size &amp; Stagger Detail</h3><div class="tblscroll"><table class="sumtbl">
    <tr><th>Session</th><th>Rear Stag Cold</th><th>Rear Stag Hot</th><th>Δ Stagger</th><th>Front Stag Cold</th>
    <th>LF Δ</th><th>RF Δ</th><th>LR Δ</th><th>RR Δ</th></tr>`;
  S.forEach((s, i) => {
    const A = AA[i];
    const dstag = (A.stagColdRear != null && A.stagHotRear != null) ? A.stagHotRear - A.stagColdRear : null;
    h += `<tr><td>${esc(s.name)}</td>
      <td>${A.stagColdRear != null ? f2(A.stagColdRear) + '"' : '—'}</td>
      <td>${A.stagHotRear != null ? f2(A.stagHotRear) + '"' : '—'}</td>
      ${cellNum(dstag, '"', true)}
      <td>${A.stagColdFront != null ? f2(A.stagColdFront) + '"' : '—'}</td>
      ${cellNum(A.growth.LF, '"', true)}${cellNum(A.growth.RF, '"', true)}
      ${cellNum(A.growth.LR, '"', true)}${cellNum(A.growth.RR, '"', true)}</tr>`;
  });
  h += `</table></div><div class="sum-note">Tire Δ columns are individual size growth hot vs cold. A RR that keeps growing frees the car late in runs; a corner that shrinks is losing air.</div></div>`;

  /* driver notes of the day */
  const noted = S.filter(s => (s.notes || '').trim());
  if (noted.length) {
    h += `<div class="sum-sec"><h3>Driver Notes</h3>`;
    noted.forEach(s => { h += `<div class="notecard"><b>${esc(s.name)}.</b> ${esc(s.notes.trim())}</div>` });
    h += `<div class="sum-note">What the driver felt, next to what the tires measured. When the two disagree, believe the tires and ask again.</div></div>`;
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
  return h;
}
