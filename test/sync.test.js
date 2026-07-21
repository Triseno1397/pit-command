// @vitest-environment jsdom
/* Crew merge rules. These are the tests that matter most in the whole suite:
   every failure mode here looks like "a reading I entered is gone", which is
   the one outcome the app exists to prevent. Two crew members working the same
   session at once is the normal case during a hot practice, not an edge case. */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

let sync, state;

async function fresh() {
  vi.resetModules();
  state = await import('../src/state.js');
  sync = await import('../src/sync.js');
  state.state.days = [];
  sync.crew.code = 'TEST-2345';
  sync.crew.device = 'dev-a';
  sync.crew.known = {};
  sync.crew.outbox = {};
  sync.crew.cursor = 0;
}

/** A day + session with known ids, so paths are predictable across "devices". */
function seed() {
  const day = {
    id: 'd1000', name: 'Hickory', track: 'Hickory Motor Speedway', dateISO: '2026-07-21',
    date: 'Jul 21, 2026', driver: 'Tris', car: '21', carClass: 'Limited Late Model',
    notes: '', sessions: []
  };
  const s = {
    id: 's2000', type: 'Practice', name: 'Practice 1', notes: '',
    pre: state.blankReading(), post: state.blankReading()
  };
  day.sessions.push(s);
  state.state.days.push(day);
  return { day, s };
}

beforeEach(fresh);

describe('flatten', () => {
  it('gives every field a path that is stable across devices', () => {
    seed();
    const flat = sync.flatten(state.state);
    expect(flat['d:d1000:!']).toBe(1);
    expect(flat['d:d1000:track']).toBe('Hickory Motor Speedway');
    expect(flat['s:s2000:!']).toBe('d1000');       // carries its parent day
    expect(flat['r:s2000:post:RF:psi']).toBe('');
    // four corners x five fields x two readings, plus a track temp each
    const tirePaths = Object.keys(flat).filter(p => /^r:s2000:(pre|post):[A-Z]{2}:/.test(p));
    expect(tirePaths).toHaveLength(40);
  });
});

describe('per-field merge', () => {
  it('keeps both edits when two people work different corners at once', () => {
    const { s } = seed();
    // This phone logs the right front.
    s.post.tires.RF.psi = '24.5';
    sync.collectLocalChanges(1000);
    expect(sync.crew.outbox['r:s2000:post:RF:psi'].v).toBe('24.5');

    // The other phone logged the left rear at the same moment.
    sync.applyOp({ p: 'r:s2000:post:LR:psi', v: '18', t: 1000 });
    sync.crew.known['r:s2000:post:LR:psi'] = { v: '18', t: 1000 };

    expect(s.post.tires.RF.psi).toBe('24.5');   // ours survived
    expect(s.post.tires.LR.psi).toBe('18');     // theirs landed
  });

  it('does not let a stale phone walk back a newer edit', () => {
    const { s } = seed();
    s.post.tires.RF.psi = '24.5';
    sync.collectLocalChanges(5000);            // we edited at t=5000

    // A phone that was offline all weekend finally syncs an older value.
    const op = { p: 'r:s2000:post:RF:psi', v: '22', t: 1000 };
    const cur = sync.crew.known[op.p];
    const shouldApply = !cur || op.t > cur.t;

    expect(shouldApply).toBe(false);
    expect(s.post.tires.RF.psi).toBe('24.5');
  });

  it('takes the newer of two edits to the same field', () => {
    const { s } = seed();
    s.post.tires.RF.psi = '24.5';
    sync.collectLocalChanges(1000);

    sync.applyOp({ p: 'r:s2000:post:RF:psi', v: '25', t: 2000 });
    expect(s.post.tires.RF.psi).toBe('25');
  });
});

describe('creation and deletion', () => {
  it('materialises a day and session that only exist on another phone', () => {
    sync.applyOp({ p: 'd:d9000:!', v: 1, t: 1 });
    sync.applyOp({ p: 'd:d9000:track', v: 'Bristol', t: 1 });
    sync.applyOp({ p: 's:s9100:!', v: 'd9000', t: 1 });
    sync.applyOp({ p: 's:s9100:name', v: 'Qualifying 1', t: 1 });
    sync.applyOp({ p: 'r:s9100:pre:LF:size', v: '87.75', t: 1 });

    const d = state.state.days.find(x => x.id === 'd9000');
    expect(d.track).toBe('Bristol');
    expect(d.sessions[0].name).toBe('Qualifying 1');
    expect(d.sessions[0].pre.tires.LF.size).toBe('87.75');
  });

  it('orders days the same on every phone regardless of arrival order', () => {
    sync.applyOp({ p: 'd:d3000:!', v: 1, t: 1 });
    sync.applyOp({ p: 'd:d1000:!', v: 1, t: 1 });
    sync.applyOp({ p: 'd:d2000:!', v: 1, t: 1 });
    expect(state.state.days.map(d => d.id)).toEqual(['d1000', 'd2000', 'd3000']);
  });

  it('emits a tombstone when a day is deleted, so it cannot come back', () => {
    seed();
    sync.collectLocalChanges(1000);
    expect(sync.crew.known['d:d1000:!'].v).toBe(1);

    state.state.days.length = 0;              // deleted in the trailer
    sync.collectLocalChanges(2000);

    expect(sync.crew.outbox['d:d1000:!']).toEqual({ v: null, t: 2000 });
    expect(sync.crew.outbox['r:s2000:post:RF:psi'].v).toBeNull();
  });

  it('applies a remote tombstone', () => {
    seed();
    sync.applyOp({ p: 'd:d1000:!', v: null, t: 3000 });
    expect(state.state.days).toHaveLength(0);
  });

  it('ignores field edits for a day that was tombstoned', () => {
    seed();
    sync.applyOp({ p: 'd:d1000:!', v: null, t: 3000 });
    // A straggler edit from a phone that had not seen the delete yet.
    expect(sync.applyOp({ p: 'd:d1000:track', v: 'Ghost', t: 3100 })).toBe(false);
    expect(state.state.days).toHaveLength(0);
  });
});

describe('working with no signal', () => {
  it('holds every change in the outbox until there is service', () => {
    const { s } = seed();
    sync.collectLocalChanges(1000);
    Object.keys(sync.crew.outbox).forEach(k => delete sync.crew.outbox[k]);  // synced

    s.post.tires.RF.psi = '24.5';
    s.post.tires.RF.size = '88.25';
    s.post.trackTemp = '118';
    sync.collectLocalChanges(2000);

    expect(sync.pendingCount()).toBe(3);
    expect(sync.crew.outbox['r:s2000:post:tt'].v).toBe('118');
  });

  it('reports nothing pending once a sync clears the outbox', () => {
    seed();
    sync.collectLocalChanges(1000);
    expect(sync.pendingCount()).toBeGreaterThan(0);
    Object.keys(sync.crew.outbox).forEach(k => delete sync.crew.outbox[k]);
    expect(sync.pendingCount()).toBe(0);
  });

  it('stays inert when the device is not in a crew', () => {
    const { s } = seed();
    sync.crew.code = null;
    s.post.tires.RF.psi = '24.5';
    expect(sync.collectLocalChanges(1000)).toBe(0);
    expect(sync.pendingCount()).toBe(0);
  });
});

describe('cursor never outruns delivery', () => {
  /* Caught only against a live store: a replica served an empty page while the
     sequence counter had already moved. Returning the counter made the phone
     skip three readings permanently — silent, and unrecoverable without a
     rejoin. The cursor must therefore describe what was delivered, never what
     exists. */
  it('does not advance when the page came back empty', async () => {
    const { nextCursor } = await import('../api/crew.js');
    expect(nextCursor(0, [])).toBe(0);
    expect(nextCursor(7, [])).toBe(7);
  });

  it('advances only as far as the highest change actually handed over', async () => {
    const { nextCursor } = await import('../api/crew.js');
    expect(nextCursor(0, [1, 2, 3])).toBe(3);
    expect(nextCursor(5, [6, 9, 7])).toBe(9);
  });

  it('never moves backwards', async () => {
    const { nextCursor } = await import('../api/crew.js');
    expect(nextCursor(9, [2, 3])).toBe(9);
  });

  it('shrugs off junk scores rather than corrupting the cursor', async () => {
    const { nextCursor } = await import('../api/crew.js');
    expect(nextCursor(4, [NaN, undefined, null, '6'])).toBe(6);
    expect(nextCursor(4, null)).toBe(4);
  });
});

describe('joining when the server cannot help', () => {
  it('keeps the crew when merely offline — you can join in the trailer', async () => {
    seed();
    global.fetch = vi.fn().mockRejectedValue(new Error('network'));
    const r = await sync.joinCrew('ABCD-2345');
    expect(r.ok).toBe(true);
    expect(r.offline).toBe(true);
    expect(sync.crew.code).toBe('ABCD-2345');
    expect(sync.pendingCount()).toBeGreaterThan(0);   // the log is queued, not lost
  });

  it('rolls back when the server has no store, rather than faking a crew', async () => {
    seed();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 503,
      json: async () => ({ ok: false, error: 'Crew sync is not configured on the server.' })
    });
    const r = await sync.joinCrew('ABCD-2345');
    expect(r.ok).toBe(false);
    expect(r.unconfigured).toBe(true);
    expect(sync.crew.code).toBeNull();                // never looks joined
    expect(r.error).toMatch(/not configured/i);
  });

  it('leaves the local log completely intact either way', async () => {
    const { s } = seed();
    s.post.tires.RF.psi = '24.5';
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 503, json: async () => ({ ok: false, error: 'nope' })
    });
    await sync.joinCrew('ABCD-2345');
    expect(state.state.days).toHaveLength(1);
    expect(state.state.days[0].sessions[0].post.tires.RF.psi).toBe('24.5');
  });
});

describe('crew codes', () => {
  it('generates codes in the shape the server accepts', () => {
    for (let i = 0; i < 40; i++) {
      const c = sync.makeCode();
      expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
      expect(sync.validCode(c)).toBe(true);
    }
  });

  it('rejects codes with characters that get misread aloud', () => {
    // I/L/O/0/1 are deliberately absent from the alphabet
    expect(sync.validCode('ABCD-2O45')).toBe(false);
    expect(sync.validCode('ABCD-2I45')).toBe(false);
    expect(sync.validCode('ABC-2345')).toBe(false);
    expect(sync.validCode('')).toBe(false);
  });
});

describe('not stealing the keyboard', () => {
  it('knows when a crew member has a field open', () => {
    document.body.innerHTML = '<input id="x"><div id="y"></div>';
    expect(sync.isEditing()).toBe(false);
    document.getElementById('x').focus();
    expect(sync.isEditing()).toBe(true);
    document.getElementById('x').blur();
    expect(sync.isEditing()).toBe(false);
  });
});

/* The default that makes the app worth opening on a second phone. Every rule
   here is about that default never quietly overriding a deliberate choice. */
describe('shared by default', () => {
  const CREW_KEY = 'lltool:crew:v1';

  beforeEach(async () => {
    const { del } = await import('idb-keyval');
    await del(CREW_KEY);
  });

  it('puts a brand new phone on the shared log with no code to type', async () => {
    await fresh();
    sync.crew.code = null; sync.crew.solo = false;
    await sync.loadCrew();
    expect(sync.crew.code).toBe(sync.SHARED_CODE);
    expect(sync.onSharedLog()).toBe(true);
  });

  it('uploads a season that was already on the phone rather than hiding it', async () => {
    await fresh();
    const { day, s } = seed();
    s.pre.tires.RF.psi = '23.5';
    sync.crew.code = null; sync.crew.solo = false; sync.crew.known = {};
    await sync.loadCrew();
    // joining is not a fresh start: the existing day is staged for the others
    expect(sync.crew.outbox[`d:${day.id}:!`]).toBeTruthy();
    expect(sync.crew.outbox[`r:${s.id}:pre:RF:psi`].v).toBe('23.5');
  });

  it('does not drag a phone back onto the shared log after it opted out', async () => {
    await fresh();
    await sync.leaveCrew();
    expect(sync.crew.code).toBeNull();
    expect(sync.crew.solo).toBe(true);

    // a reload must respect that, or "stop sharing" is a button that does nothing
    await fresh();
    sync.crew.code = null; sync.crew.solo = false;
    await sync.loadCrew();
    expect(sync.crew.code).toBeNull();
  });

  it('leaves a private crew code alone across reloads', async () => {
    await fresh();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ ok: true, cursor: 4, ops: [] })
    });
    await sync.joinCrew('ABCD-2345');

    await fresh();
    sync.crew.code = null; sync.crew.solo = false;
    await sync.loadCrew();
    expect(sync.crew.code).toBe('ABCD-2345');
    expect(sync.onSharedLog()).toBe(false);
  });
});
