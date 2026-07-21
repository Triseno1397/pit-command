import { TIRES, f1, tempColor } from '../num.js';
import { analyze } from '../analyze.js';
import { esc } from './esc.js';

export function analysisHTML(s, d) {
  const A = analyze(s, d);
  if (!A.hasPost && A.mets.length === 0)
    return `<div class="anal"><div class="anal-hd">Read the Tires</div>
      <div class="empty-anal">Log the AFTER · HOT readings when the car comes off the track — pressures and 3-point temps on all four corners. The analysis lights up automatically.</div></div>`;
  const vals = TIRES.map(k => A.temps[k]).filter(v => v != null);
  const mn = vals.length ? Math.min(...vals) : 0, mx = vals.length ? Math.max(...vals) : 1;
  const tireSVG = (k, x, y) => {
    const c = tempColor(A.temps[k], mn - 5, mx + 5); const g = A.gains[k];
    return `<g><rect x="${x}" y="${y}" width="52" height="78" rx="9" fill="${c}" stroke="#0009" stroke-width="1.5"/>
      <text x="${x + 26}" y="${y + 22}" text-anchor="middle" font-family="Barlow Condensed" font-weight="800" font-size="15" fill="#0D1014">${k}</text>
      <text x="${x + 26}" y="${y + 44}" text-anchor="middle" font-family="JetBrains Mono" font-weight="700" font-size="13" fill="#0D1014">${A.temps[k] != null ? Math.round(A.temps[k]) + '°' : '—'}</text>
      <text x="${x + 26}" y="${y + 63}" text-anchor="middle" font-family="JetBrains Mono" font-size="10.5" fill="#0D1014">${g != null ? (g > 0 ? '+' : '') + f1(g) + ' psi' : ''}</text></g>`
  };
  const pos = A.balance == null ? 50 : 50 - A.balance * 45;
  let callColor = 'var(--dim)';
  if (A.balLabel.includes('TIGHT')) callColor = 'var(--tight)';
  else if (A.balLabel.includes('LOOSE')) callColor = 'var(--loose)';
  else if (A.balLabel === 'BALANCED') callColor = 'var(--good)';
  return `<div class="anal">
    <div class="anal-hd">Crew Chief Readout</div>
    <div class="anal-grid">
      <div class="car-wrap">
        <svg viewBox="0 0 220 300" role="img" aria-label="Four corner tire heat map, nose up">
          <path d="M78 30 Q110 8 142 30 L152 60 L152 240 Q152 268 110 274 Q68 268 68 240 L68 60 Z"
            fill="#232A34" stroke="#39424f" stroke-width="1.5"/>
          <rect x="80" y="70" width="60" height="34" rx="4" fill="#161B22" stroke="#39424f"/>
          <text x="110" y="91" text-anchor="middle" font-family="Barlow Condensed" font-weight="700" font-size="12" fill="#8A94A3" letter-spacing="2">NOSE</text>
          <path d="M40 150 q-14 8 0 16" stroke="#FFD447" stroke-width="2.5" fill="none"/>
          <path d="M40 150 l-6 2 4 5z" fill="#FFD447"/>
          ${tireSVG('LF', 8, 52)}${tireSVG('RF', 160, 52)}${tireSVG('LR', 8, 182)}${tireSVG('RR', 160, 182)}
        </svg>
        <div class="legend">
          <span><i style="background:var(--tight)"></i>Cold</span>
          <span><i style="background:var(--good)"></i>Working</span>
          <span><i style="background:var(--chalk)"></i>Hot</span>
          <span><i style="background:var(--loose)"></i>Hottest</span>
        </div>
      </div>
      <div>
        <div class="balmeter">
          <div class="scale"><div class="needle" style="left:${pos}%"></div></div>
          <div class="labs"><span class="l">◀ TIGHT</span><span class="c">NEUTRAL</span><span class="r">LOOSE ▶</span></div>
          <div class="bal-call" style="color:${callColor}">${A.balLabel || 'NEED TEMPS'}</div>
        </div>
        <div class="metrics">
          ${A.mets.map(m => `<div class="met"><div class="k">${esc(m.k)}</div><div class="v">${esc(m.v)}</div>${m.s ? `<div class="s">${esc(m.s)}</div>` : ''}</div>`).join('')}
        </div>
        <div class="recs"><h5>Calls &amp; Flags</h5>
          ${A.recs.length ? A.recs.map(r => `<div class="rec ${r.lvl}">
              <span class="tag">${{ crit: 'Fix', adj: 'Adjust', info: 'Note', ok: 'Good' }[r.lvl]}</span>
              <div><b>${esc(r.title)}.</b> ${esc(r.body)}</div></div>`).join('')
      : '<div class="empty-anal">Add more data for the full readout — 3-point temps and pre/post pressures unlock every check.</div>'}
        </div>
      </div>
    </div>
  </div>`;
}
