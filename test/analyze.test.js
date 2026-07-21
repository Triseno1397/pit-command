import { describe, it, expect } from 'vitest';
import { analyze } from '../src/analyze.js';
import { TIRES } from '../src/num.js';

function reading(over = {}) {
  const tires = {};
  TIRES.forEach(k => { tires[k] = { psi: '', size: '', ti: '', tm: '', to: '' } });
  return { trackTemp: '', tires, ...over };
}
/** temps: {LF:[in,mid,out], ...}  psi: {LF: '22', ...}  size: {LF: '88', ...} */
function mk({ preTemps, postTemps, prePsi, postPsi, preSize, postSize, preTrack, postTrack } = {}) {
  const fill = (rd, temps, psi, size, track) => {
    if (track != null) rd.trackTemp = String(track);
    TIRES.forEach(k => {
      if (temps && temps[k]) { const [i, m, o] = temps[k]; rd.tires[k].ti = String(i); rd.tires[k].tm = String(m); rd.tires[k].to = String(o) }
      if (psi && psi[k] != null) rd.tires[k].psi = String(psi[k]);
      if (size && size[k] != null) rd.tires[k].size = String(size[k]);
    });
  };
  const pre = reading(), post = reading();
  fill(pre, preTemps, prePsi, preSize, preTrack);
  fill(post, postTemps, postPsi, postSize, postTrack);
  return { id: 's1', type: 'Practice', name: 'Practice 1', notes: '', pre, post };
}
const evenTemps = (front, rear) => ({
  LF: [front, front, front], RF: [front, front, front],
  LR: [rear, rear, rear], RR: [rear, rear, rear]
});
const titles = A => A.recs.map(r => r.title);

describe('balance call thresholds (front/rear temp split)', () => {
  it('flags TIGHT above +15°F front bias', () => {
    const A = analyze(mk({ postTemps: evenTemps(220, 200) }), null);   // +20
    expect(A.balLabel).toBe('TIGHT');
    expect(titles(A)).toContain('Car is tight (push)');
    expect(A.recs[0].body).toMatch(/soften front sway bar|round of cross/);
  });

  it('flags LOOSE below -15°F', () => {
    const A = analyze(mk({ postTemps: evenTemps(200, 220) }), null);   // -20
    expect(A.balLabel).toBe('LOOSE');
    expect(titles(A)).toContain('Car is loose');
  });

  it('flags SLIGHT TIGHT between 8 and 15', () => {
    const A = analyze(mk({ postTemps: evenTemps(212, 200) }), null);   // +12
    expect(A.balLabel).toBe('SLIGHT TIGHT');
  });

  it('flags SLIGHT LOOSE between -8 and -15', () => {
    const A = analyze(mk({ postTemps: evenTemps(200, 212) }), null);   // -12
    expect(A.balLabel).toBe('SLIGHT LOOSE');
  });

  it('calls BALANCED inside 8°F', () => {
    const A = analyze(mk({ postTemps: evenTemps(205, 200) }), null);   // +5
    expect(A.balLabel).toBe('BALANCED');
    expect(titles(A)).toContain('Balance is in the window');
  });

  it('is exclusive at the boundaries — exactly 15 is not TIGHT, exactly 8 is not SLIGHT', () => {
    expect(analyze(mk({ postTemps: evenTemps(215, 200) }), null).balLabel).toBe('SLIGHT TIGHT');
    expect(analyze(mk({ postTemps: evenTemps(208, 200) }), null).balLabel).toBe('BALANCED');
  });

  it('leaves the balance call empty when a corner has no temps', () => {
    const s = mk({ postTemps: evenTemps(220, 200) });
    s.post.tires.RF = { psi: '', size: '', ti: '', tm: '', to: '' };
    const A = analyze(s, null);
    expect(A.balLabel).toBe('');
    expect(A.balance).toBeNull();
  });

  it('clamps the needle value to [-1, 1]', () => {
    const hot = analyze(mk({ postTemps: evenTemps(300, 150) }), null);
    const cold = analyze(mk({ postTemps: evenTemps(150, 300) }), null);
    expect(hot.balance).toBe(1);
    expect(cold.balance).toBe(-1);
  });
});

describe('pressure gain flags', () => {
  const psiCase = (pre, post) => analyze(mk({
    prePsi: { LF: 20, RF: pre, LR: 20, RR: 20 },
    postPsi: { LF: 24, RF: post, LR: 24, RR: 24 }
  }), null);

  it('raises a red LOST-pressure flag when post psi is below pre psi', () => {
    const A = psiCase(24, 22);
    const rec = A.recs.find(r => r.title === 'RF LOST pressure');
    expect(rec).toBeDefined();
    expect(rec.lvl).toBe('crit');
    expect(rec.body).toMatch(/leak/);
    expect(A.gains.RF).toBe(-2);
  });

  it('flags excessive build above 9 psi as critical', () => {
    const rec = psiCase(20, 30).recs.find(r => r.title === 'RF building excessive pressure');
    expect(rec.lvl).toBe('crit');
  });

  it('flags a hot corner between 7 and 9 psi as an adjustment', () => {
    const rec = psiCase(20, 28).recs.find(r => r.title === 'RF running hot');
    expect(rec.lvl).toBe('adj');
  });

  it('notes a tire that never came in below 2 psi of gain', () => {
    const rec = psiCase(20, 21).recs.find(r => r.title === 'RF not building heat');
    expect(rec.lvl).toBe('info');
  });
});

describe('inflation and camber reads', () => {
  it('calls over-inflation when the center runs hotter than the edges', () => {
    const A = analyze(mk({ postTemps: { RF: [200, 210, 200], LF: [200, 200, 200], LR: [200, 200, 200], RR: [200, 200, 200] } }), null);
    expect(titles(A)).toContain('RF over-inflated');
  });
  it('calls under-inflation when the center runs cooler', () => {
    const A = analyze(mk({ postTemps: { RF: [210, 200, 210], LF: [200, 200, 200], LR: [200, 200, 200], RR: [200, 200, 200] } }), null);
    expect(titles(A)).toContain('RF under-inflated');
  });
  it('raises a camber flag past a 25°F inside-to-outside spread, with RF-specific copy', () => {
    const A = analyze(mk({ postTemps: { RF: [230, 215, 200], LF: [200, 200, 200], LR: [200, 200, 200], RR: [200, 200, 200] } }), null);
    const rec = A.recs.find(r => r.title === 'RF camber/alignment flag');
    expect(rec).toBeDefined();
    expect(rec.body).toMatch(/too much negative camber/);
  });
});

describe('stagger', () => {
  it('computes cold and hot rear stagger from fractional sizes', () => {
    const A = analyze(mk({
      preSize: { RR: '88 1/2', LR: '87 1/2', RF: '86 1/4', LF: '86' },
      postSize: { RR: '89', LR: '87 1/2' }
    }), null);
    expect(A.stagColdRear).toBe(1);
    expect(A.stagHotRear).toBe(1.5);
    expect(A.stagColdFront).toBe(0.25);
    expect(titles(A).some(t => t.startsWith('Stagger moved'))).toBe(true);
  });
});

describe('temperature window and track trend', () => {
  it('warns when the hottest tire is cooking', () => {
    const A = analyze(mk({ postTemps: evenTemps(250, 245) }), null);
    expect(titles(A).some(t => t.endsWith('is cooking'))).toBe(true);
  });
  it('notes that the tires never came in', () => {
    const A = analyze(mk({ postTemps: evenTemps(120, 118) }), null);
    expect(titles(A)).toContain('Tires never came in');
  });
  it('compares track temp against the previous session in the day', () => {
    const s1 = mk({ postTemps: evenTemps(200, 200), postTrack: 100 }); s1.id = 'a';
    const s2 = mk({ postTemps: evenTemps(200, 200), postTrack: 125 }); s2.id = 'b';
    const day = { sessions: [s1, s2] };
    expect(titles(analyze(s2, day)).some(t => t.startsWith('Track is heating up'))).toBe(true);
    const s3 = mk({ postTemps: evenTemps(200, 200), postTrack: 80 }); s3.id = 'c';
    expect(titles(analyze(s3, { sessions: [s1, s3] })).some(t => t.startsWith('Track is cooling'))).toBe(true);
  });
});

describe('empty state', () => {
  it('reports hasPost=false with no readings at all', () => {
    const A = analyze(mk(), null);
    expect(A.hasPost).toBe(false);
    expect(A.recs).toHaveLength(0);
    expect(A.mets).toHaveLength(0);
  });
});

describe('recommendation ordering', () => {
  it('sorts Fix before Adjust before Good/Note', () => {
    const A = analyze(mk({
      postTemps: evenTemps(220, 200),
      prePsi: { LF: 20, RF: 20, LR: 20, RR: 20 },
      postPsi: { LF: 24, RF: 18, LR: 24, RR: 24 }
    }), null);
    const lvls = A.recs.map(r => r.lvl);
    const rank = { crit: 0, adj: 1, ok: 2, info: 3 };
    expect(lvls.map(l => rank[l])).toEqual([...lvls.map(l => rank[l])].sort((a, b) => a - b));
    expect(lvls[0]).toBe('crit');
  });
});
