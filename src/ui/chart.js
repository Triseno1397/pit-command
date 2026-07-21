/* Hand-rolled SVG line chart. No chart library — this is a phone tool and the
   whole app shell has to precache small enough to open with no signal. */

import { f2 } from '../num.js';

export function lineChart(seriesArr, labels, unit) {
  /* seriesArr: [{name,color,vals:[num|null]}] */
  const W = 640, H = 240, PL = 44, PR = 12, PT = 14, PB = 34;
  const all = seriesArr.flatMap(s => s.vals).filter(v => v != null);
  if (!all.length) return `<div class="empty-anal">Not enough data yet for this chart.</div>`;
  let mn = Math.min(...all), mx = Math.max(...all);
  if (mn === mx) { mn -= 1; mx += 1 }
  const pad = (mx - mn) * 0.12; mn -= pad; mx += pad;
  const nx = labels.length;
  const X = i => nx === 1 ? (PL + (W - PL - PR) / 2) : PL + i * (W - PL - PR) / (nx - 1);
  const Y = v => PT + (1 - (v - mn) / (mx - mn)) * (H - PT - PB);
  let g = '';
  // gridlines
  for (let i = 0; i <= 4; i++) {
    const v = mn + (mx - mn) * i / 4; const y = Y(v);
    g += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="#2B3340" stroke-width="1"/>
    <text x="${PL - 6}" y="${y + 4}" text-anchor="end" font-family="JetBrains Mono" font-size="10" fill="#8A94A3">${Math.round(v * 10) / 10}</text>`;
  }
  labels.forEach((l, i) => { g += `<text x="${X(i)}" y="${H - 12}" text-anchor="middle" font-family="Barlow Condensed" font-weight="700" font-size="11" fill="#8A94A3" letter-spacing="1">${l}</text>` });
  seriesArr.forEach(s => {
    const pts = s.vals.map((v, i) => v == null ? null : [X(i), Y(v)]);
    let path = '', pen = false;
    pts.forEach(p => { if (!p) { pen = false; return } path += (pen ? 'L' : 'M') + p[0] + ' ' + p[1] + ' '; pen = true });
    g += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linecap="round"/>`;
    pts.forEach(p => { if (p) g += `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${s.color}" stroke="#111419" stroke-width="1.5"/>` });
  });
  g += `<text x="${PL - 32}" y="${PT + 2}" font-family="Barlow Condensed" font-size="10" fill="#8A94A3" letter-spacing="1">${unit || ''}</text>`;
  return `<div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}">${g}</svg></div>
  <div class="chart-legend">${seriesArr.map(s => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')}</div>`;
}

export function cellNum(v, suffix, colored) {
  if (v == null) return '<td>—</td>';
  const s = (v > 0 ? '+' : '') + f2(v) + (suffix || '');
  if (!colored) return `<td>${f2(v)}${suffix || ''}</td>`;
  return `<td class="${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${s}</td>`;
}
