/* ============================== ANALYSIS ENGINE ==============================
   Ported verbatim from the track-validated reference implementation.
   Recommendation copy is deliberately word-for-word — do not reword it.
   ============================================================================= */

import { TIRES, num, f1, f2, avgTemp } from './num.js';

export function analyze(sess, day) {
  const pre = sess.pre, post = sess.post;
  const A = { hasPost: false, recs: [], mets: [], temps: {}, gains: {}, growth: {}, balance: null, balLabel: '' };
  let anyTemp = false;
  TIRES.forEach(k => { const a = avgTemp(post.tires[k]); A.temps[k] = a; if (a != null) anyTemp = true });
  let anyGain = false;
  TIRES.forEach(k => {
    const p1 = num(pre.tires[k].psi), p2 = num(post.tires[k].psi);
    A.gains[k] = (p1 != null && p2 != null) ? p2 - p1 : null; if (A.gains[k] != null) anyGain = true
  });
  TIRES.forEach(k => {
    const s1 = num(pre.tires[k].size), s2 = num(post.tires[k].size);
    A.growth[k] = (s1 != null && s2 != null) ? s2 - s1 : null
  });
  A.hasPost = anyTemp || anyGain;
  const push = (lvl, title, body) => A.recs.push({ lvl, title, body });
  const met = (k, v, s) => A.mets.push({ k, v, s });

  const fAvg = (A.temps.LF != null && A.temps.RF != null) ? (A.temps.LF + A.temps.RF) / 2 : null;
  const rAvg = (A.temps.LR != null && A.temps.RR != null) ? (A.temps.LR + A.temps.RR) / 2 : null;
  if (fAvg != null && rAvg != null) {
    const d = fAvg - rAvg;
    A.balance = Math.max(-1, Math.min(1, d / 25));
    if (d > 15) {
      A.balLabel = 'TIGHT'; push('adj', 'Car is tight (push)',
        `Fronts are running ${f1(d)}°F hotter than the rears — front tires are doing the work. Options: soften front sway bar or RF spring, add a round of cross (LR wedge), raise track bar slightly, or add rear stagger to help rotation.`);
    }
    else if (d < -15) {
      A.balLabel = 'LOOSE'; push('adj', 'Car is loose',
        `Rears are running ${f1(-d)}°F hotter than the fronts — rear tires are sliding. Options: take out a round of cross, reduce rear stagger, stiffen RR spring slightly, or lower track bar.`);
    }
    else if (Math.abs(d) > 8) {
      A.balLabel = d > 0 ? 'SLIGHT TIGHT' : 'SLIGHT LOOSE';
      push('info', d > 0 ? 'Trending tight' : 'Trending loose',
        `Front/rear temp split is ${f1(Math.abs(d))}°F ${d > 0 ? 'front' : 'rear'}-biased. Within working range — a small air or wedge adjustment covers it. Confirm with driver feedback before turning wrenches.`);
    }
    else {
      A.balLabel = 'BALANCED'; push('ok', 'Balance is in the window',
        `Front and rear average temps within ${f1(Math.abs(d))}°F. The chassis is working all four corners — protect this baseline and log everything.`);
    }
    met('F / R Split', (d > 0 ? '+' : '') + f1(d) + '°F', d > 0 ? 'front hotter → tight' : 'rear hotter → loose');
  }

  const lAvg = (A.temps.LF != null && A.temps.LR != null) ? (A.temps.LF + A.temps.LR) / 2 : null;
  const rtAvg = (A.temps.RF != null && A.temps.RR != null) ? (A.temps.RF + A.temps.RR) / 2 : null;
  if (lAvg != null && rtAvg != null) {
    const d = rtAvg - lAvg; met('R / L Split', (d > 0 ? '+' : '') + f1(d) + '°F', 'right side loading');
    if (d < 5) push('info', 'Right side isn’t loading',
      'On a left-turn oval the right side should run clearly hotter. If the split is this small, the car may be under-driven this session, the track is green, or weight transfer is being wasted. Watch it next run.');
  }

  TIRES.forEach(k => {
    const t = post.tires[k]; const ti = num(t.ti), tm = num(t.tm), to = num(t.to);
    if (ti != null && tm != null && to != null) {
      const edges = (ti + to) / 2, cd = tm - edges;
      if (cd > 6) push('adj', k + ' over-inflated',
        `${k} center is ${f1(cd)}°F hotter than the edges — tire is crowning. Drop ${k} cold pressure ~1 psi and re-check. Air changes move cross weight, so re-scale or offset if it matters tonight.`);
      else if (cd < -6) push('adj', k + ' under-inflated',
        `${k} center is ${f1(-cd)}°F cooler than the edges — contact patch is cupping. Add ~1 psi cold to ${k}.`);
      const spread = ti - to;
      if (Math.abs(spread) > 25) push('adj', k + ' camber/alignment flag',
        `${k} has a ${f1(Math.abs(spread))}°F inside-to-outside spread (${spread > 0 ? 'inside' : 'outside'} edge hotter). ` +
        ((k === 'RF')
          ? (spread > 0 ? 'RF inside edge working hard — likely too much negative camber for this track. Take a little out.' : 'RF outside edge hot — add negative camber, or the car is pushing and grinding the RF shoulder. Cross-check with the balance call above.')
          : (k === 'LF')
            ? (spread < 0 ? 'LF outside edge hot — check positive camber setting and toe.' : 'LF inside edge hot — reduce camber or check toe-out.')
            : 'On a rear tire this spread usually means rear alignment, a bent component, or excessive body roll loading one shoulder. Inspect it.'));
    }
  });

  TIRES.forEach(k => {
    const g = A.gains[k];
    if (g != null) {
      if (g > 9) push('crit', k + ' building excessive pressure',
        `${k} gained ${f1(g)} psi over the run — the tire is overworked or started too low. It will change size and handling late in a run. Address the load on that corner or start it higher.`);
      else if (g > 7) push('adj', k + ' running hot',
        `${k} gained ${f1(g)} psi. That corner is carrying the load — consistent with the balance call above. Consider a small cold-pressure drop or a chassis change to unload it.`);
      else if (g < 2 && g >= 0) push('info', k + ' not building heat',
        `${k} only gained ${f1(g)} psi — that tire isn’t working. Either it started too high, that corner is unloaded, or the run was short. A tire that never comes in never grips.`);
      else if (g < 0) push('crit', k + ' LOST pressure',
        `${k} came in ${f1(-g)} psi LOWER than it went out. That’s a leak — valve stem, bead seal, or puncture. Check it before the next session. Do not send it.`);
    }
  });

  const stag = rd => {
    const rr = num(rd.tires.RR.size), lr = num(rd.tires.LR.size),
      rf = num(rd.tires.RF.size), lf = num(rd.tires.LF.size);
    return { rear: (rr != null && lr != null) ? rr - lr : null, front: (rf != null && lf != null) ? rf - lf : null }
  };
  const sc = stag(pre), sh = stag(post);
  A.stagColdRear = sc.rear; A.stagHotRear = sh.rear; A.stagColdFront = sc.front;
  if (sc.rear != null) met('Rear Stagger (cold)', f2(sc.rear) + '"', 'RR − LR circumference');
  if (sh.rear != null) met('Rear Stagger (hot)', f2(sh.rear) + '"', 'after the run');
  if (sc.front != null) met('Front Stagger (cold)', f2(sc.front) + '"', 'RF − LF');
  if (sc.rear != null && sh.rear != null) {
    const d = sh.rear - sc.rear;
    if (Math.abs(d) >= 0.5) push('info', 'Stagger moved ' + (d > 0 ? '+' : '') + f2(d) + '" hot',
      d > 0 ? 'Rear stagger grew during the run (RR heat growth). The car will get freer the longer the run goes — plan cold stagger so the HOT number is your target for the Main.'
        : 'Rear stagger shrank during the run. If the LR is growing or RR lost air, verify pressures and valve stems. A shrinking stagger tightens the car late in a run.');
  }

  let hotK = null, hotV = -1; TIRES.forEach(k => { if (A.temps[k] != null && A.temps[k] > hotV) { hotV = A.temps[k]; hotK = k } });
  if (hotK) {
    met('Hottest Tire', hotK + ' ' + f1(hotV) + '°F', '');
    if (hotV > 240) push('crit', hotK + ' is cooking',
      `${hotK} averaged ${f1(hotV)}°F — past the happy zone for most short-track compounds. Grip falls off and blister risk climbs. Unload that corner or the tire won’t live through a long Main.`);
    else if (hotV < 130 && anyTemp) push('info', 'Tires never came in',
      `Peak average is only ${f1(hotV)}°F. Green track, short run, or pressures too high. Take the reading with a grain of salt — cold tires lie.`);
  }

  const idx = day ? day.sessions.findIndex(s => s.id === sess.id) : -1;
  const tNow = num(post.trackTemp) ?? num(pre.trackTemp);
  if (tNow != null) met('Track Temp', f1(tNow) + '°F', '');
  if (day && idx > 0 && tNow != null) {
    for (let i = idx - 1; i >= 0; i--) {
      const prev = day.sessions[i];
      const tPrev = num(prev.post.trackTemp) ?? num(prev.pre.trackTemp);
      if (tPrev != null) {
        const d = tNow - tPrev;
        if (d >= 10) push('info', 'Track is heating up (+' + f1(d) + '°F)',
          'Hotter asphalt = less grip and more pressure build. Trim cold pressures ~0.5–1 psi per 10–15°F of track temp rise, and expect the car to slide more.');
        else if (d <= -10) push('info', 'Track is cooling (' + f1(d) + '°F)',
          'Cooler surface = more grip coming. Tires will build less pressure — you can start them a touch higher and the car will take more aggressive entry.');
        break;
      }
    }
  }

  const order = { crit: 0, adj: 1, ok: 2, info: 3 };
  A.recs.sort((a, b) => order[a.lvl] - order[b.lvl]);
  return A;
}
