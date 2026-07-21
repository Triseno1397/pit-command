/* ============================== NUMBERS & FRACTIONS ==============================
   Readings are kept in state as raw strings exactly as the crew typed them.
   Every math path goes through num(), which accepts what people actually write
   on a tire sheet: 87.25 | 87 1/4 | 87-1/4 | 1/2 | 12.5
   ================================================================================ */

export const TIRES = ['LF', 'RF', 'LR', 'RR'];
export const TIRE_NAMES = { LF: 'Left Front', RF: 'Right Front', LR: 'Left Rear', RR: 'Right Rear' };
export const TIRE_COLORS = { LF: '#4C8DFF', RF: '#FFD447', LR: '#43C966', RR: '#F0524F' };

export function num(v) {
  if (v == null) return null;
  const s = String(v).trim(); if (!s) return null;
  const m = s.match(/^(-?)(\d+(?:\.\d+)?)?(?:[\s-]+)?(?:(\d+)\s*\/\s*(\d+))?$/);
  if (!m) return isNaN(parseFloat(s)) ? null : parseFloat(s);
  let val = 0;
  if (m[2] != null) val += parseFloat(m[2]);
  if (m[3] != null && m[4] != null && parseFloat(m[4]) !== 0) val += parseFloat(m[3]) / parseFloat(m[4]);
  if (m[2] == null && m[3] == null) return null;
  return m[1] === '-' ? -val : val;
}

export const f1 = v => v == null ? '—' : (Math.round(v * 10) / 10).toString();
export const f2 = v => v == null ? '—' : (Math.round(v * 100) / 100).toString();

export function avgTemp(t) {
  const a = [num(t.ti), num(t.tm), num(t.to)].filter(v => v != null);
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
}

export function tempColor(v, min, max) {
  if (v == null) return '#2B3340';
  const span = Math.max(max - min, 1); let p = (v - min) / span; p = Math.max(0, Math.min(1, p));
  const stops = [[76, 141, 255], [67, 201, 102], [255, 212, 71], [240, 82, 79]];
  const seg = p * 3, i = Math.min(Math.floor(seg), 2), f = seg - i;
  const c = stops[i].map((s, k) => Math.round(s + (stops[i + 1][k] - s) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
