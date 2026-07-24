import { TIRES, f1, f2 } from '../num.js';
import { analyze } from '../analyze.js';

/* Corner heat, rank-ordered — never by absolute temperature. The four corner
   temps are sorted hottest→coldest and painted --pc-heat-1..4 in that order; a
   corner with no reading gets the neutral panel-head tone. Shared by the tire
   grid and the car diagram so both tell the same story. */
const HEAT = ['#C9483C', '#DFA43C', '#5FA97E', '#4E79B8'];   // heat-1..4
const HEAT_NONE = '#EFEAE0';
export function heatMap(A) {
  const ranked = TIRES.filter(k => A.temps[k] != null).sort((a, b) => A.temps[b] - A.temps[a]);
  const map = {};
  TIRES.forEach(k => { map[k] = HEAT_NONE });
  ranked.forEach((k, i) => { map[k] = HEAT[Math.min(i, 3)] });
  return map;
}

const stagTxt = v => v == null ? '—' : f2(v) + '"';

/** The Crew Chief Readout body — the top-down car with four corner heat blocks
 *  and the two hot-stagger numbers, plus the heat legend. Metric tiles and the
 *  Calls & Flags list live in the Day Summary now, not on the card. */
export function readoutHTML(s, d) {
  const A = analyze(s, d);
  const hm = heatMap(A);

  const cornerBlock = (k, x, y) => {
    const t = A.temps[k], g = A.gains[k];
    return `<g>
      <rect x="${x}" y="${y}" width="52" height="86" rx="7" fill="${hm[k]}" stroke="#0B0C0F" stroke-width="2.5"></rect>
      <rect x="${x + 4}" y="${y + 4}" width="44" height="78" rx="5" fill="none" stroke="#fff" stroke-width="1" opacity="0.25"></rect>
      <text x="${x + 26}" y="${y + 24}" text-anchor="middle" font-family="'IBM Plex Mono',monospace" font-weight="700" font-size="17" fill="#17181A">${k}</text>
      <text x="${x + 26}" y="${y + 50}" text-anchor="middle" font-family="'IBM Plex Mono',monospace" font-weight="700" font-size="18" fill="#17181A">${t != null ? Math.round(t) + '°' : '—'}</text>
      <text x="${x + 26}" y="${y + 72}" text-anchor="middle" font-family="'IBM Plex Mono',monospace" font-weight="600" font-size="11" fill="#17181A">${g != null ? (g > 0 ? '+' : '') + f1(g) + ' psi' : ''}</text>
    </g>`;
  };

  const car = `<div class="pc-car">
    <svg viewBox="0 0 220 320" role="img" aria-label="Four corner tire heat map with hot stagger, front at top">
      <defs>
        <linearGradient id="pcBody" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#191C21"></stop>
          <stop offset="0.18" stop-color="#3C424D"></stop>
          <stop offset="0.5" stop-color="#4A5260"></stop>
          <stop offset="0.82" stop-color="#3C424D"></stop>
          <stop offset="1" stop-color="#191C21"></stop>
        </linearGradient>
        <linearGradient id="pcGlass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#141922"></stop>
          <stop offset="1" stop-color="#2C3644"></stop>
        </linearGradient>
      </defs>
      <ellipse cx="110" cy="302" rx="66" ry="8" fill="#000" opacity="0.45"></ellipse>
      <!-- pro late model: wedge body, narrow nose, wide rear, offset roof -->
      <path d="M110 14 Q92 15 82 22 Q72 30 68 46 L62 74 Q56 108 55 140 L53 196 Q52 240 54 266 Q55 284 62 290 L110 293 L158 290 Q165 284 166 266 Q168 240 167 196 L165 140 Q164 108 158 74 L152 46 Q148 30 138 22 Q128 15 110 14 Z" fill="url(#pcBody)" stroke="#6B7484" stroke-width="1.5"></path>
      <!-- nose cone + air dam -->
      <path d="M110 14 Q92 15 82 22 Q73 29 69 42 L151 42 Q147 29 138 22 Q128 15 110 14 Z" fill="#E8590C"></path>
      <rect x="78" y="22" width="64" height="7" rx="3" fill="#0F1216"></rect>
      <rect x="86" y="32" width="48" height="9" rx="2" fill="#12151A" opacity="0.9"></rect>
      <path d="M88 36 H132" stroke="#6B7484" stroke-width="1.3"></path>
      <!-- hood, low and wide with dual vents -->
      <path d="M67 46 H153 L159 106 Q110 114 61 106 Z" fill="#22262D" stroke="#6B7484" stroke-width="1"></path>
      <path d="M110 48 V104" stroke="#E8590C" stroke-width="2" opacity="0.5"></path>
      <path d="M76 96 h18 l-3 6 h-18 z" fill="#0F1216"></path>
      <path d="M144 96 h-18 l3 6 h18 z" fill="#0F1216"></path>
      <!-- offset cockpit: windshield, roof canted left, roof rails -->
      <path d="M62 110 H150 L142 136 H70 Z" fill="url(#pcGlass)" stroke="#6B7484" stroke-width="1"></path>
      <path d="M70 138 H142 L146 190 H66 Z" fill="#2A303A" stroke="#6B7484" stroke-width="1"></path>
      <path d="M74 140 V188 M138 140 V188" stroke="#E8590C" stroke-width="1.6" opacity="0.7"></path>
      <path d="M58 142 L66 141 L64 188 L56 186 Z" fill="#141922"></path>
      <path d="M162 142 L152 141 L154 188 L164 186 Z" fill="#141922"></path>
      <!-- rear window + wide quarter panels -->
      <path d="M66 192 H146 L156 216 H58 Z" fill="url(#pcGlass)" stroke="#6B7484" stroke-width="1"></path>
      <path d="M56 218 H158 L160 262 H54 Z" fill="#22262D" stroke="#6B7484" stroke-width="1"></path>
      <path d="M54 226 H160" stroke="#6B7484" stroke-width="0.8" opacity="0.5"></path>
      <!-- tall rear spoiler with end dams -->
      <rect x="50" y="262" width="114" height="13" rx="2" fill="#12151A" stroke="#E8590C" stroke-width="1.8"></rect>
      <rect x="46" y="258" width="7" height="21" rx="2" fill="#E8590C"></rect>
      <rect x="161" y="258" width="7" height="21" rx="2" fill="#E8590C"></rect>
      <path d="M70 264 V273 M110 264 V273 M144 264 V273" stroke="#6B7484" stroke-width="1.2"></path>
      <!-- tail panel -->
      <path d="M54 278 Q56 288 62 290 L110 293 L158 290 Q164 288 166 278 Z" fill="#E8590C" opacity="0.9"></path>
      <text x="110" y="72" text-anchor="middle" font-family="Oswald" font-weight="700" font-size="9" fill="#B4BCC9" letter-spacing="1.4">FRONT STAGGER HOT</text>
      <text x="108" y="234" text-anchor="middle" font-family="Oswald" font-weight="700" font-size="9" fill="#B4BCC9" letter-spacing="1.4">REAR STAGGER HOT</text>
      <path d="M32 158 q-13 8 0 16" stroke="#E8590C" stroke-width="2.5" fill="none"></path>
      <path d="M32 158 l-6 2 4 5z" fill="#E8590C"></path>
      <text x="18" y="152" font-family="Oswald" font-weight="700" font-size="7" fill="#E8590C" letter-spacing="1.2">TURN</text>
      <text x="110" y="93" text-anchor="middle" font-family="Oswald" font-weight="700" font-size="20" fill="#F2F0EB">${stagTxt(A.stagHotFront)}</text>
      <text x="108" y="255" text-anchor="middle" font-family="Oswald" font-weight="700" font-size="20" fill="#F2F0EB">${stagTxt(A.stagHotRear)}</text>
      ${cornerBlock('LF', 2, 62)}${cornerBlock('RF', 166, 62)}${cornerBlock('LR', 2, 206)}${cornerBlock('RR', 166, 206)}
    </svg>
    <div class="pc-legend">
      <span><i style="background:var(--pc-heat-4)"></i>Cold</span>
      <span><i style="background:var(--pc-heat-3)"></i>Working</span>
      <span><i style="background:var(--pc-heat-2)"></i>Hot</span>
      <span><i style="background:var(--pc-heat-1)"></i>Hottest</span>
    </div>
  </div>`;

  if (!A.hasPost && A.mets.length === 0) {
    return `<div class="empty-anal">Log the AFTER · HOT readings when the car comes off the track — pressures and 3-point temps on all four corners. The analysis lights up automatically.</div>${car}`;
  }
  return car;
}
