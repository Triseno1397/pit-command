import { TIRES, num, f1, f2 } from '../num.js';
import { analyze } from '../analyze.js';
import { esc } from './esc.js';

/* Corner heat, rank-ordered — never by absolute temperature. The four corner
   temps are sorted hottest→coldest and painted --pc-heat-1..4 in that order; a
   corner with no reading gets the neutral panel-head tone. The tire grid on the
   card is painted from this. The readout below no longer colours by heat: every
   reading on the car is the same size and the same white, so nothing on it wins
   the eye by accident. */
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
const tempTxt = v => v == null ? 'TEMP —' : 'TEMP ' + Math.round(v) + '°';
const gainTxt = v => v == null ? '—' : (v > 0 ? '+' : '') + f1(v);

/** The Crew Chief Readout body — the car seen from above in the crew's own
 *  livery, with the four corner readings hung off it on plates and the two hot
 *  stagger numbers down the centre line. The plates sit outside the bodywork on
 *  purpose: at arm's length in a hot pit box the numbers have to clear the car,
 *  not sit on top of it. Metric tiles and the Calls & Flags list live in the Day
 *  Summary, not on the card. */
export function readoutHTML(s, d) {
  const A = analyze(s, d);
  /* Gradient ids are per-session: every open card paints this same car, and two
     elements sharing an id in one document is a coin flip on which one wins. */
  const u = s.id;

  /* Plate: corner name, hot temp, pressure gain. Same box, same type, same
     colour on all four — the eye compares numbers, not decoration. */
  const plate = (k, x, y) => {
    const cx = x + 64;
    return `<g>
      <rect x="${x}" y="${y}" width="128" height="104" rx="6" fill="#0B0C0E" stroke="#79828F" stroke-width="1.5"></rect>
      <text x="${cx}" y="${y + 22}" text-anchor="middle" font-weight="700" font-size="20" fill="#FFFFFF" letter-spacing="1">${k}</text>
      <text x="${cx}" y="${y + 48}" text-anchor="middle" font-weight="700" font-size="20" fill="#FFFFFF">${tempTxt(A.temps[k])}</text>
      <text x="${cx}" y="${y + 74}" text-anchor="middle" font-weight="700" font-size="20" fill="#FFFFFF">PSI GAIN</text>
      <text x="${cx}" y="${y + 96}" text-anchor="middle" font-weight="700" font-size="20" fill="#FFFFFF">${gainTxt(A.gains[k])}</text>
    </g>`;
  };

  /* Stagger, on the axle it belongs to, down the middle of the car. */
  const stagPlate = (label, val, y) => `<g>
    <rect x="108" y="${y}" width="104" height="54" rx="5" fill="rgba(6,7,9,.82)" stroke="#79828F" stroke-width="1"></rect>
    <text x="160" y="${y + 22}" text-anchor="middle" font-weight="700" font-size="20" fill="#FFFFFF">${label}</text>
    <text x="160" y="${y + 46}" text-anchor="middle" font-weight="700" font-size="20" fill="#FFFFFF">${val}</text>
  </g>`;

  const laps = String(s.post.laps || '').trim();
  const metaL = ['Hot sheet', esc(s.name), laps ? esc(laps) + ' laps' : ''].filter(Boolean).join(' · ');

  /* The strip under the car carries the run's context — the balance call and the
     conditions it was made in. A temperature reading means one thing on a green
     track and another on a slick one, and the two belong on the same glance. */
  const track = num(s.post.trackTemp) ?? num(s.pre.trackTemp);
  const life = String(s.pre.tireLife || '').trim();
  const foot = [A.balLabel || 'no temps', track != null ? 'track ' + f1(track) + '°F' : '', life ? 'tires: ' + esc(life) : '']
    .filter(Boolean).map(t => `<span>${t}</span>`).join('<span>·</span>');

  const car = `<div class="ccr-meta">
      <span>${metaL}</span>
      <span>Front &#9650;</span>
    </div>
    <svg viewBox="-126 0 572 486" class="ccr-svg" role="img"
      aria-label="Car from above, front at top, with hot temperature and pressure gain on all four corners and hot stagger front and rear">
      <defs>
        <linearGradient id="hxBody-${u}" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#020304"></stop><stop offset=".14" stop-color="#101216"></stop>
          <stop offset=".36" stop-color="#23262C"></stop><stop offset=".5" stop-color="#31353D"></stop>
          <stop offset=".64" stop-color="#23262C"></stop><stop offset=".86" stop-color="#101216"></stop>
          <stop offset="1" stop-color="#020304"></stop>
        </linearGradient>
        <radialGradient id="hxRoof-${u}" cx=".5" cy=".38" r=".85">
          <stop offset="0" stop-color="#FFFFFF"></stop><stop offset=".62" stop-color="#DEE2E8"></stop><stop offset="1" stop-color="#AEB6C1"></stop>
        </radialGradient>
        <linearGradient id="hxGlass-${u}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#0A0E14"></stop><stop offset=".55" stop-color="#1D2733"></stop><stop offset="1" stop-color="#3D4F63"></stop>
        </linearGradient>
        <linearGradient id="hxWhite-${u}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#FFFFFF"></stop><stop offset=".55" stop-color="#E3E6EB"></stop><stop offset="1" stop-color="#B9C0CA"></stop>
        </linearGradient>
        <linearGradient id="hxChrome-${u}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#F4F6F9"></stop><stop offset=".45" stop-color="#AEB6C1"></stop><stop offset=".55" stop-color="#79828F"></stop><stop offset="1" stop-color="#C9CFD8"></stop>
        </linearGradient>
        <linearGradient id="hxTire-${u}" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#060708"></stop><stop offset=".5" stop-color="#23252A"></stop><stop offset="1" stop-color="#060708"></stop>
        </linearGradient>
        <linearGradient id="hxSweep-${u}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#FFF" stop-opacity=".26"></stop><stop offset="1" stop-color="#FFF" stop-opacity="0"></stop>
        </linearGradient>
        <filter id="hxBlur-${u}" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="9"></feGaussianBlur></filter>
      </defs>
      <ellipse cx="160" cy="250" rx="126" ry="218" fill="#000" opacity=".45" filter="url(#hxBlur-${u})"></ellipse>
      <!-- tires -->
      <g>
        <g><rect x="58" y="86" width="32" height="64" rx="9" fill="url(#hxTire-${u})" stroke="#050608" stroke-width="2.5"></rect><path d="M69 90 V146 M79 90 V146" stroke="#050608" stroke-width="2.2" opacity=".9"></path><path d="M62 100 H86 M62 112 H86 M62 124 H86 M62 136 H86" stroke="#000" stroke-width="1" opacity=".4"></path><rect x="61" y="89" width="26" height="58" rx="7" fill="none" stroke="#8B93A0" stroke-width="1" opacity=".6"></rect></g>
        <rect x="230" y="86" width="32" height="64" rx="9" fill="url(#hxTire-${u})" stroke="#050608" stroke-width="2.5"></rect><rect x="233" y="89" width="26" height="58" rx="7" fill="none" stroke="#8B93A0" stroke-width="1" opacity=".6"></rect>
        <path d="M241 90 V146 M251 90 V146" stroke="#050608" stroke-width="2.2" opacity=".9"></path><path d="M234 100 H258 M234 112 H258 M234 124 H258 M234 136 H258" stroke="#000" stroke-width="1" opacity=".4"></path>
        <g><rect x="52" y="330" width="36" height="74" rx="10" fill="url(#hxTire-${u})" stroke="#050608" stroke-width="2.5"></rect><path d="M64 334 V400 M76 334 V400" stroke="#050608" stroke-width="2.2" opacity=".9"></path><path d="M56 346 H84 M56 360 H84 M56 374 H84 M56 388 H84" stroke="#000" stroke-width="1" opacity=".4"></path><rect x="55" y="333" width="30" height="68" rx="8" fill="none" stroke="#8B93A0" stroke-width="1" opacity=".6"></rect></g>
        <g><rect x="232" y="330" width="36" height="74" rx="10" fill="url(#hxTire-${u})" stroke="#050608" stroke-width="2.5"></rect><path d="M244 334 V400 M256 334 V400" stroke="#050608" stroke-width="2.2" opacity=".9"></path><path d="M236 346 H264 M236 360 H264 M236 374 H264 M236 388 H264" stroke="#000" stroke-width="1" opacity=".4"></path><rect x="235" y="333" width="30" height="68" rx="8" fill="none" stroke="#8B93A0" stroke-width="1" opacity=".6"></rect></g>
        <rect x="86" y="108" width="18" height="16" fill="url(#hxChrome-${u})"></rect><rect x="216" y="108" width="18" height="16" fill="url(#hxChrome-${u})"></rect>
        <rect x="84" y="356" width="18" height="18" fill="url(#hxChrome-${u})"></rect><rect x="218" y="356" width="18" height="18" fill="url(#hxChrome-${u})"></rect>
      </g>
      <!-- body: black paint -->
      <path d="M160 14 C134 14 118 22 110 36 L102 72 C93 110 91 148 93 186 L94 240 C90 284 86 316 88 356 L92 412 C94 440 102 452 120 456 L160 460 L200 456 C218 452 226 440 228 412 L232 356 C234 316 230 284 226 240 L227 186 C229 148 227 110 218 72 L210 36 C202 22 186 14 160 14 Z" fill="url(#hxBody-${u})" stroke="#5E6673" stroke-width="1.6"></path>
      <!-- nose: white with chrome splitter -->
      <path d="M160 14 C134 14 118 22 110 36 L103 66 L217 66 L210 36 C202 22 186 14 160 14 Z" fill="url(#hxWhite-${u})"></path>
      <path d="M160 15.5 C138 15.5 124 21 116 30 L204 30 C196 21 182 15.5 160 15.5 Z" fill="#FFF" opacity=".65"></path>
      <path d="M112 20 L208 20" stroke="url(#hxChrome-${u})" stroke-width="4" opacity=".9"></path>
      <rect x="128" y="34" width="64" height="15" rx="7.5" fill="#0B0C0E"></rect>
      <path d="M132 39 H188 M132 44 H188" stroke="#79828F" stroke-width="1.6"></path>
      <!-- hood: black with twin white stripes, chrome pins -->
      <path d="M104 68 L216 68 M112 68 L106 150 M208 68 L214 150" stroke="#5E6673" stroke-width="1" opacity=".6"></path>
      <rect x="144" y="66" width="9" height="86" fill="url(#hxWhite-${u})"></rect>
      <rect x="167" y="66" width="9" height="86" fill="url(#hxWhite-${u})"></rect>
      <circle cx="118" cy="80" r="3" fill="url(#hxChrome-${u})" stroke="#0B0C0F"></circle><circle cx="202" cy="80" r="3" fill="url(#hxChrome-${u})" stroke="#0B0C0F"></circle>
      <circle cx="112" cy="142" r="3" fill="url(#hxChrome-${u})" stroke="#0B0C0F"></circle><circle cx="208" cy="142" r="3" fill="url(#hxChrome-${u})" stroke="#0B0C0F"></circle>
      <!-- windshield + cage -->
      <path d="M108 154 L212 154 L204 194 L116 194 Z" fill="url(#hxGlass-${u})" stroke="#5E6673" stroke-width="1.6"></path>
      <path d="M126 154 L142 154 L124 194 L112 194 Z" fill="#FFF" opacity=".14"></path>
      <path d="M160 154 V194" stroke="#0D1218" stroke-width="4" opacity=".9"></path>
      <!-- roof: white with chrome rails, black car number -->
      <path d="M116 196 L204 196 L208 288 L112 288 Z" fill="url(#hxRoof-${u})" stroke="#5E6673" stroke-width="1.4"></path>
      <path d="M118 198 L121 286 M202 198 L199 286" stroke="url(#hxChrome-${u})" stroke-width="3"></path>
      ${(d.car || '').trim()
      ? `<text x="160" y="262" text-anchor="middle" font-family="Oswald,sans-serif" font-weight="700" font-style="italic" font-size="58" fill="#0B0C0F">${esc(String(d.car).trim())}</text>`
      : ''}
      <!-- rear window + deck -->
      <path d="M112 290 L208 290 L214 318 L106 318 Z" fill="url(#hxGlass-${u})" stroke="#5E6673" stroke-width="1.4"></path>
      <path d="M106 320 L214 320 L218 424 L102 424 Z" fill="url(#hxBody-${u})" stroke="#5E6673" stroke-width="1"></path>
      <rect x="138" y="340" width="44" height="32" rx="8" fill="#1B1E24" stroke="#79828F" stroke-width="1.5"></rect>
      <path d="M142 344 H178" stroke="#8B93A0" stroke-width="1.5" opacity=".8"></path>
      <path d="M104 398 H216" stroke="#5E6673" stroke-width="1" opacity=".5"></path>
      <!-- specular sweep -->
      <path d="M100 84 L152 66 L126 300 L92 320 Z" fill="url(#hxSweep-${u})"></path>
      <!-- spoiler: chrome with black end plates -->
      <path d="M116 426 L124 434 L112 434 Z M204 426 L208 434 L196 434 Z" fill="#0D0F13"></path>
      <rect x="90" y="432" width="140" height="17" rx="2" fill="url(#hxChrome-${u})" stroke="#0B0C0F" stroke-width="1.6"></rect>
      <rect x="82" y="427" width="9" height="27" rx="2" fill="#0B0C0F" stroke="#79828F" stroke-width="1"></rect>
      <rect x="229" y="427" width="9" height="27" rx="2" fill="#0B0C0F" stroke="#79828F" stroke-width="1"></rect>
      <path d="M120 436 V446 M160 436 V446 M200 436 V446" stroke="#0B0C0F" stroke-width="1.4"></path>
      <path d="M104 452 Q112 458 124 459 L160 462 L196 459 Q208 458 216 452 L214 450 L106 450 Z" fill="url(#hxWhite-${u})"></path>
      <!-- readings: same box, same size, same colour on every corner -->
      <g font-family="Oswald,sans-serif">
        ${plate('LF', -122, 74)}${plate('RF', 314, 74)}
        ${plate('LR', -122, 322)}${plate('RR', 314, 322)}
        <line x1="6" y1="118" x2="58" y2="118" stroke="#79828F" stroke-width="1.5"></line>
        <line x1="262" y1="118" x2="314" y2="118" stroke="#79828F" stroke-width="1.5"></line>
        <line x1="6" y1="367" x2="52" y2="367" stroke="#79828F" stroke-width="1.5"></line>
        <line x1="268" y1="367" x2="314" y2="367" stroke="#79828F" stroke-width="1.5"></line>
        ${stagPlate('F-STAG', stagTxt(A.stagHotFront), 86)}
        ${stagPlate('R-STAG', stagTxt(A.stagHotRear), 372)}
      </g>
    </svg>
    <div class="ccr-foot">${foot}</div>`;

  if (!A.hasPost && A.mets.length === 0) {
    return `<div class="empty-anal">Log the AFTER · HOT readings when the car comes off the track — pressures and 3-point temps on all four corners. The analysis lights up automatically.</div>${car}`;
  }
  return car;
}
