// @vitest-environment jsdom
/* End-to-end smoke test: boots the real app against a DOM and drives it the way
   a crew would — new day, add session, enter fractional readings, read the
   analysis, open the summary, export and re-import. */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { del } from 'idb-keyval';

const SHELL = `
  <header class="hdr"><div class="hdr-top">
    <button class="logo" onclick="go({page:'hub'})"></button>
    <div class="hdr-meta" id="hdrMeta"></div>
  </div></header>
  <div class="wrap" id="app"></div>
  <div id="modal" style="display:none"></div>
  <div class="add-bar" id="addBar" style="display:none">
    <button class="main" onclick="addSession('Practice')">+ Practice</button>
  </div>`;

let prevState = null;
async function boot() {
  // a debounced autosave left running by the previous test would fire against the
  // shared fake IndexedDB and corrupt the next test's state
  if (prevState) prevState.cancelPendingSave();
  document.body.innerHTML = SHELL;
  window.scrollTo = () => { };            // jsdom has no layout
  vi.resetModules();
  await import('../src/main.js');
  prevState = await import('../src/state.js');
  // main.js kicks off an async init() (loadState -> IndexedDB); wait for first paint
  for (let i = 0; i < 50 && !document.getElementById('app').innerHTML; i++) {
    await new Promise(r => setTimeout(r, 5));
  }
}

beforeEach(async () => {
  // saves are immediate now, so every test must start from a genuinely empty device
  localStorage.clear();
  await del('lltool:state:v2');
  await del('lltool:snapshots:v1');
  await boot();
});

const app = () => document.getElementById('app');

describe('cold start', () => {
  it('renders the empty hub without throwing', () => {
    expect(app().innerHTML).toContain('Race Days');
    expect(app().innerHTML).toContain('Nothing in the trailer yet.');
    expect(document.getElementById('addBar').style.display).toBe('none');
  });
});

describe('a race day, start to finish', () => {
  it('adds a day, adds a session, and shows the empty analysis prompt', () => {
    window.addDay();
    expect(app().querySelector('.daydetails')).toBeTruthy();
    // the add-a-session controls live in the board's last column now
    expect(app().querySelector('.pc-addcol')).toBeTruthy();

    window.addSession('Practice');
    const card = app().querySelector('.sess');
    expect(card).toBeTruthy();
    expect(card.querySelector('.sess-num').textContent).toBe('S1');
    expect(app().innerHTML).toContain('Log the AFTER · HOT readings');
    // the cold/hot Smart Fill target and all four corners are on screen
    expect(app().innerHTML).toContain('Before · Cold');
    expect(app().innerHTML).toContain('After · Hot');
    ['LF', 'RF', 'LR', 'RR'].forEach(k => expect(app().innerHTML).toContain(k));
  });

  it('reads a tight car out of fractional temps and psi, and flags a leak', async () => {
    const S = await import('../src/state.js');
    window.addDay(); window.addSession('Practice');
    const sid = app().querySelector('.sess').id.replace('card-', '');

    // cold: 20 psi all round, RR a half-inch bigger than LR
    ['LF', 'RF', 'LR', 'RR'].forEach(k => window.updT(sid, 'pre', k, 'psi', '20'));
    window.updT(sid, 'pre', 'LR', 'size', '87 1/2');
    window.updT(sid, 'pre', 'RR', 'size', '88');

    // hot: fronts 20°F hotter than rears -> TIGHT; RF went DOWN 2 psi -> leak
    [['LF', 220], ['RF', 220], ['LR', 200], ['RR', 200]].forEach(([k, t]) => {
      window.updT(sid, 'post', k, 'ti', String(t));
      window.updT(sid, 'post', k, 'tm', String(t));
      window.updT(sid, 'post', k, 'to', String(t));
      window.updT(sid, 'post', k, 'psi', k === 'RF' ? '18' : '25');
    });

    // balance now reads on the card's header chip
    expect(document.getElementById('chip-' + sid).textContent).toContain('TIGHT');
    // the readout is the car diagram: hot stagger on the body, no metric tiles
    const anal = document.getElementById('anal-' + sid).innerHTML;
    expect(anal).toContain('REAR STAGGER HOT');
    expect(anal).not.toContain('psi (hot)');   // metric tiles moved off the card

    // the calls-and-flags list has been retired from the Day Summary, but the
    // analysis engine still reads the car — verify the tight call and the leak
    // straight off the recommendations it produces.
    const { findS } = await import('../src/state.js');
    const { analyze } = await import('../src/analyze.js');
    const recs = analyze(findS(sid), S.state.days[0]).recs;
    const titles = recs.map(r => r.title);
    expect(titles).toContain('Car is tight (push)');
    expect(titles).toContain('RF LOST pressure');
    expect(recs.find(r => r.title === 'RF LOST pressure').body)
      .toContain('valve stem, bead seal, or puncture');

    // and the summary no longer carries that section
    window.go({ page: 'summary', dayId: S.state.days[0].id });
    expect(app().innerHTML).not.toContain('Every Call');
  });

  it('keeps input focus while entering readings', () => {
    window.addDay(); window.addSession('Practice');
    const sid = app().querySelector('.sess').id.replace('card-', '');
    const input = app().querySelector('.pc-tiregrid input');
    input.focus();
    expect(document.activeElement).toBe(input);
    window.updT(sid, 'post', 'LF', 'tm', '210');   // triggers a targeted refresh
    expect(document.activeElement).toBe(input);    // ...which must not blow away the field
  });

  it('duplicates a session, carrying the cold pressures forward', async () => {
    const { findS } = await import('../src/state.js');
    window.addDay(); window.addSession('Practice');
    const sid = app().querySelector('.sess').id.replace('card-', '');
    window.updT(sid, 'pre', 'RF', 'psi', '22');
    window.updT(sid, 'post', 'RF', 'psi', '28');

    window.dupSession(sid);
    const cards = app().querySelectorAll('.sess');
    expect(cards).toHaveLength(2);

    const copyId = cards[1].id.replace('card-', '');
    const copy = findS(copyId);
    expect(copy.pre.tires.RF.psi).toBe('22');   // cold air copied
    expect(copy.post.tires.RF.psi).toBe('');    // hot reading starts empty
  });
});

describe('summary and export', () => {
  it('renders every summary section for a day with data', async () => {
    window.addDay();
    window.addSession('Practice');
    const sid = app().querySelector('.sess').id.replace('card-', '');
    ['LF', 'RF', 'LR', 'RR'].forEach(k => {
      window.updT(sid, 'pre', k, 'psi', '20');
      window.updT(sid, 'pre', k, 'size', k[0] === 'R' ? '88' : '87');
      window.updT(sid, 'post', k, 'psi', '25');
      window.updT(sid, 'post', k, 'size', k[0] === 'R' ? '88 1/4' : '87');
      window.updT(sid, 'post', k, 'tm', '210');
    });
    window.updS(sid, 'notes', 'Free on entry.');
    window.updTT(sid, 'post', '118');

    const S = await import('../src/state.js');
    window.go({ page: 'summary', dayId: S.state.days[0].id });

    const html = app().innerHTML;
    ['How the Day Went', 'Average Temps by Session', 'Pressure Gain by Session',
      'Size &amp; Stagger Detail', 'Day Averages by Corner', 'Driver Notes']
      .forEach(section => expect(html).toContain(section));
    expect(html).toContain('class="sumtbl"');  // the summary is table-driven now
    expect(html).not.toContain('Track Temp Through the Day');  // track temp dropped
    expect(html).not.toContain('Cold vs Hot');                 // rear stagger cold-vs-hot section dropped
    expect(html).not.toContain('Every Call');                  // flags list dropped
    // front and rear stagger now live per-session in the size & stagger table
    expect(html).toContain('Front Stagger');
    expect(html).toContain('Rear Stagger');
    // How the day went sits right under the notes, then size & stagger detail, then
    // the per-session number tables, with day averages after the pressure gains.
    expect(html.indexOf('How the Day Went')).toBeLessThan(html.indexOf('Size &amp; Stagger Detail'));
    expect(html.indexOf('Size &amp; Stagger Detail')).toBeLessThan(html.indexOf('Pressure Gain by Session'));
    expect(html.indexOf('Pressure Gain by Session')).toBeLessThan(html.indexOf('Day Averages by Corner'));
    expect(html.indexOf('Day Averages by Corner')).toBeLessThan(html.indexOf('Average Temps by Session'));
    expect(html).toContain('Free on entry.');  // driver notes carried through
  });

  it('round-trips through a JSON backup', async () => {
    // namespace import: `state` is reassigned by replaceState, so a destructured
    // local would snapshot the old object rather than follow the live binding
    const S = await import('../src/state.js');
    window.addDay(); window.addSession('Main');
    const sid = app().querySelector('.sess').id.replace('card-', '');
    window.updT(sid, 'pre', 'RF', 'size', '88 1/4');

    const backup = JSON.parse(JSON.stringify({ days: S.state.days }));
    S.replaceState({ days: [] });
    expect(S.state.days).toHaveLength(0);

    S.replaceState(S.normalize(backup));
    expect(S.state.days).toHaveLength(1);
    expect(S.state.days[0].sessions[0].pre.tires.RF.size).toBe('88 1/4');
    // and the restored day renders
    window.go({ page: 'hub' });
    expect(app().querySelectorAll('.daycard')).toHaveLength(1);
  });
});

describe('getting back to the list of days', () => {
  const hdr = () => document.getElementById('hdrMeta');

  it('offers the same named way out from a day and from a summary', async () => {
    const S = await import('../src/state.js');
    window.addDay();
    const dayId = S.state.days[0].id;

    // inside a day
    expect(hdr().innerHTML).toContain('All Race Days');
    expect(hdr().innerHTML).not.toContain('All Days<');

    // and one level deeper, where the old build only offered "back to the day"
    window.go({ page: 'summary', dayId });
    expect(hdr().innerHTML).toContain('All Race Days');

    // and it goes to the list of days, not back one step to the day itself
    const home = [...hdr().querySelectorAll('button')].find(b => b.textContent.includes('All Race Days'));
    expect(home.getAttribute('onclick')).toBe("go({page:'hub'})");
    window.go({ page: 'hub' });
    expect(app().querySelectorAll('.daycard')).toHaveLength(1);
  });

  it('clips a long event name so the save state stays on screen', async () => {
    const S = await import('../src/state.js');
    window.addDay();
    window.updDay('name', 'Thursday Night Thunder Championship Round');
    window.go({ page: 'summary', dayId: S.state.days[0].id });
    expect(hdr().innerHTML).not.toContain('Championship Round');
    expect(hdr().innerHTML).toContain('…');
    expect(hdr().querySelector('#saveSlot')).toBeTruthy();
  });
});

describe('deleting a whole race day', () => {
  const modal = () => document.getElementById('modal');

  function firstDayId() {
    return app().querySelector('.daycard').getAttribute('onclick').match(/dayId:'([^']+)'/)[1];
  }

  it('asks first, names the day, and keeps it if you back out', () => {
    window.addDay();
    window.updDay('name', 'Hickory 100');
    window.addSession('Practice');
    window.go({ page: 'hub' });
    const dayId = firstDayId();

    window.delDay(dayId);
    // the confirmation has to identify which day, not just say "are you sure"
    expect(modal().innerHTML).toContain('Hickory 100');
    expect(modal().innerHTML).toContain('1 session');
    expect(app().querySelectorAll('.daycard')).toHaveLength(1);

    window.closeModal();
    expect(app().querySelectorAll('.daycard')).toHaveLength(1);
  });

  it('removes the day on confirm and leaves it recoverable from Backups', async () => {
    const S = await import('../src/state.js');
    window.addDay();
    window.updDay('name', 'Hickory 100');
    window.go({ page: 'hub' });
    const dayId = firstDayId();

    window.delDay(dayId);
    await window.reallyDelDay(dayId);

    expect(S.state.days).toHaveLength(0);
    expect(app().querySelectorAll('.daycard')).toHaveLength(0);
    expect(modal().style.display).toBe('none');

    // a night's work does not vanish on one tap — the pre-delete point still has it
    const snaps = await S.listSnapshots();
    expect(snaps.some(s => s.reason === 'before-delete' && s.json.includes('Hickory 100'))).toBe(true);
  });

  it('is reachable from inside the day as well as from the list', () => {
    window.addDay();
    expect(app().innerHTML).toContain(`delDay('`);
  });
});

describe('data safety', () => {
  it('flushes the debounced autosave when the phone is backgrounded', async () => {
    const S = await import('../src/state.js');
    window.addDay(); window.addSession('Practice');
    const sid = app().querySelector('.sess').id.replace('card-', '');
    window.updT(sid, 'pre', 'RF', 'psi', '22');   // starts a 700ms debounce

    // switching apps inside the debounce window used to drop this reading
    expect(localStorage.getItem('lltool:state:v2:pending')).toBeNull();
    S.flushSave();

    const mirror = localStorage.getItem('lltool:state:v2:pending');
    // the mirror is written synchronously, then cleared once IndexedDB confirms
    if (mirror) {
      expect(JSON.parse(mirror).days[0].sessions[0].pre.tires.RF.psi).toBe('22');
    }
    await new Promise(r => setTimeout(r, 60));
    expect(localStorage.getItem('lltool:state:v2:pending')).toBeNull();  // durable now
  });

  it('recovers an interrupted save on the next launch', async () => {
    const rescued = {
      days: [{
        id: 'd-rescued', name: 'Bristol', track: 'Bristol', date: 'Aug 2, 2026',
        sessions: [{
          id: 's-1', type: 'Main', name: 'Main', notes: '',
          pre: { trackTemp: '110', tires: { LF: { psi: '20', size: '', ti: '', tm: '', to: '' }, RF: {}, LR: {}, RR: {} } },
          post: { trackTemp: '', tires: {} }
        }]
      }]
    };
    localStorage.setItem('lltool:state:v2:pending', JSON.stringify(rescued));

    await boot();   // cold start, as if the OS had killed the app mid-save

    expect(app().innerHTML).toContain('Bristol');
    // and it is promoted out of the mirror so it cannot be replayed twice
    expect(localStorage.getItem('lltool:state:v2:pending')).toBeNull();
  });

  it('parks an unreadable save instead of silently overwriting it', async () => {
    const { set } = await import('idb-keyval');
    await set('lltool:state:v2', '{ this is not json');

    await boot();

    const parked = localStorage.getItem('lltool:state:v2:corrupt');
    expect(parked).toBe('{ this is not json');   // recoverable by hand
    expect(app().innerHTML).toContain('Nothing in the trailer yet.');  // app still usable

    localStorage.removeItem('lltool:state:v2:corrupt');
    await set('lltool:state:v2', undefined);
  });
});

describe('the Save button', () => {
  const saveBtn = () => document.querySelector('#saveSlot .save-btn');

  it('goes loud the moment there is unsaved work, and quiet once it is down', async () => {
    const S = await import('../src/state.js');
    window.addDay(); window.addSession('Practice');
    const sid = app().querySelector('.sess').id.replace('card-', '');

    window.updT(sid, 'pre', 'RF', 'psi', '22');
    expect(saveBtn().className).toContain('dirty');
    expect(saveBtn().textContent).toContain('Save');

    await S.saveNow();
    expect(saveBtn().className).toContain('clean');
    expect(saveBtn().textContent).toContain('Saved');
    expect(S.saveStatus().dirty).toBe(false);
    expect(S.saveStatus().lastSavedAt).toBeGreaterThan(0);
  });

  it('writes immediately without waiting on the debounce', async () => {
    const S = await import('../src/state.js');
    const { get } = await import('idb-keyval');
    window.addDay(); window.addSession('Main');
    const sid = app().querySelector('.sess').id.replace('card-', '');
    window.updT(sid, 'pre', 'LR', 'size', '87 1/2');

    await S.saveNow();   // no 700ms wait

    const stored = JSON.parse(await get('lltool:state:v2'));
    expect(stored.days[0].sessions[0].pre.tires.LR.size).toBe('87 1/2');
  });
});

describe('restore points', () => {
  it('keeps a dated copy on every explicit save', async () => {
    const S = await import('../src/state.js');
    window.addDay();
    await S.saveNow();

    const snaps = await S.listSnapshots();
    expect(snaps.length).toBeGreaterThan(0);
    expect(snaps[0].reason).toBe('manual');
    expect(snaps[0].days).toBe(1);
    expect(typeof snaps[0].ts).toBe('number');
  });

  it('does not stack duplicate points when nothing changed', async () => {
    const S = await import('../src/state.js');
    window.addDay();
    await S.saveNow();
    const first = (await S.listSnapshots()).length;
    await S.saveNow();
    await S.saveNow();
    expect((await S.listSnapshots()).length).toBe(first);
  });

  it('brings back a deleted race day', async () => {
    const S = await import('../src/state.js');
    window.addDay(); window.addSession('Practice');
    const sid = app().querySelector('.sess').id.replace('card-', '');
    window.updT(sid, 'pre', 'RF', 'psi', '21');
    window.updDay('name', 'Hickory');
    await S.saveNow();
    const ts = (await S.listSnapshots())[0].ts;

    // wipe the season the way a mis-tap in the trailer would
    S.replaceState({ days: [] });
    await S.saveState();
    expect(S.state.days).toHaveLength(0);

    expect(await S.restoreSnapshot(ts)).toBe(true);
    expect(S.state.days).toHaveLength(1);
    expect(S.state.days[0].name).toBe('Hickory');
    expect(S.state.days[0].sessions[0].pre.tires.RF.psi).toBe('21');
  });

  it('is not a one-way door — the pre-restore state is itself recoverable', async () => {
    const S = await import('../src/state.js');
    window.addDay();
    await S.saveNow();
    const ts = (await S.listSnapshots())[0].ts;

    window.addDay();          // a second day exists only in the "now" state
    await S.saveNow();
    expect(S.state.days).toHaveLength(2);

    await S.restoreSnapshot(ts);
    expect(S.state.days).toHaveLength(1);

    // the invariant that matters: the pre-restore content is still reachable.
    // (it may be carried by the identical save that preceded it rather than by a
    // separate 'before-restore' entry — snapshots de-duplicate on content)
    const snaps = await S.listSnapshots();
    const undo = snaps.find(s => s.days === 2);
    expect(undo).toBeDefined();

    expect(await S.restoreSnapshot(undo.ts)).toBe(true);
    expect(S.state.days).toHaveLength(2);   // and going back actually works
  });

  it('reports a missing restore point instead of throwing', async () => {
    const S = await import('../src/state.js');
    expect(await S.restoreSnapshot(1)).toBe(false);
  });
});

describe('Race Day Details', () => {
  it('captures who drove it, what car, and when — all labelled', () => {
    window.addDay();
    const html = app().innerHTML;
    ['Event', 'Track', 'Date', 'Driver', 'Car #', 'Class', 'Day Notes']
      .forEach(label => expect(html).toContain(label));
    expect(html).toContain('type="date"');
  });

  it('keeps the display date in step with the date picker', async () => {
    const S = await import('../src/state.js');
    window.addDay();
    window.updDay('dateISO', '2026-08-14');
    const d = S.state.days[0];
    expect(d.dateISO).toBe('2026-08-14');
    expect(d.date).toBe('Aug 14, 2026');
  });

  it('defaults a new day to today and the right class', async () => {
    const S = await import('../src/state.js');
    window.addDay();
    expect(S.state.days[0].dateISO).toBe(S.isoToday());
    expect(S.state.days[0].carClass).toBe('Limited Late Model');
  });

  it('shows driver and car on the hub card and the summary', async () => {
    const S = await import('../src/state.js');
    window.addDay();
    window.updDay('driver', 'Tristan');
    window.updDay('car', '21');
    window.updDay('track', 'Hickory');
    window.updDay('notes', 'Green track all night.');
    window.addSession('Practice');

    window.go({ page: 'hub' });
    expect(app().querySelector('.daycard .sub').textContent).toContain('#21 Tristan');
    expect(app().querySelector('.daycard .sub').textContent).toContain('Hickory');

    window.go({ page: 'summary', dayId: S.state.days[0].id });
    expect(app().innerHTML).toContain('#21 Tristan');
    expect(app().innerHTML).toContain('Green track all night.');
  });

  it('backfills the new fields on data saved before they existed', async () => {
    const S = await import('../src/state.js');
    const legacy = { days: [{ id: 'd-old', name: 'Old Day', track: 'Hickory', date: 'Aug 2, 2025', sessions: [] }] };
    S.replaceState(legacy);
    const d = S.state.days[0];
    expect(d.driver).toBe('');
    expect(d.car).toBe('');
    expect(d.carClass).toBe('Limited Late Model');
    expect(d.dateISO).toBe('2025-08-02');    // derived from the old display string
    expect(() => { window.go({ page: 'hub' }) }).not.toThrow();
  });
});

describe('Smart Fill panel', () => {
  const sess = () => {
    window.addDay(); window.addSession('Practice');
    return app().querySelector('.sess').id.replace('card-', '');
  };

  it('offers a disabled Fill button until there is something to fill', () => {
    const sid = sess();
    expect(app().querySelector('.sf-go').disabled).toBe(true);

    window.saveDraft(sid, 'right front 24 psi');
    window.setTab(sid, 'pre');            // re-render
    expect(app().querySelector('.sf-go').disabled).toBe(false);
    expect(app().querySelector('.sf-go').textContent).toContain('Fill the Cold Sheet');
  });

  it('names the tab it is about to write into', () => {
    const sid = sess();
    expect(app().innerHTML).toContain('Before · Cold');
    window.setTab(sid, 'post');
    expect(app().querySelector('.sf-target').textContent).toContain('After · Hot');
    expect(app().querySelector('.sf-go').textContent).toContain('Fill the Hot Sheet');
  });

  it('clears the scratch pad on demand', () => {
    const sid = sess();
    window.saveDraft(sid, 'some words');
    window.setTab(sid, 'pre');
    expect(app().querySelector('.sf-clear')).toBeTruthy();
    window.clearDraft(sid);
    expect(app().querySelector('#dict-' + sid).value).toBe('');
    expect(app().querySelector('.sf-clear')).toBeFalsy();
  });

  it('reports exactly what it heard and where each number landed', async () => {
    const { applyParsed } = await import('../src/smartfill.js');
    const sid = sess();
    const { findS } = await import('../src/state.js');
    const s = findS(sid);

    const { n, summary } = applyParsed(s, 'post', {
      trackTemp: 118,
      tires: {
        RF: { psi: 24.5, size: 88.25, ti: 210, tm: 195, to: 180 },
        LF: { psi: null, size: null, ti: null, tm: null, to: null },
        LR: { psi: 20, size: null, ti: null, tm: null, to: null },
        RR: { psi: null, size: null, ti: null, tm: null, to: null }
      }
    });

    expect(n).toBe(7);
    expect(summary).toContain('track temp 118');
    expect(summary).toContain('RF psi 24.5');
    expect(summary).toContain('size 88.25');
    expect(summary).toContain('in 210');
    expect(summary).toContain('LR psi 20');
    expect(summary).not.toContain('LF');           // nothing heard for that corner
    expect(s.post.tires.RF.psi).toBe('24.5');      // stored as the string the sheet holds
    expect(s.post.trackTemp).toBe('118');
  });

  // A temperature heard while the cold sheet is open is a misread — there is no
  // box for it there, so writing it would hide a number nobody can correct.
  it('drops tread temps on the cold sheet and keeps psi and size', async () => {
    const { applyParsed } = await import('../src/smartfill.js');
    const { findS } = await import('../src/state.js');
    const s = findS(sess());

    const { n, summary } = applyParsed(s, 'pre', {
      trackTemp: 118,
      tires: { RF: { psi: 22, size: 88, ti: 210, tm: 195, to: 180 }, LF: {}, LR: {}, RR: {} }
    });

    expect(n).toBe(3);                          // track temp + psi + size, no temps
    expect(summary).not.toContain('in 210');
    expect(s.pre.tires.RF.psi).toBe('22');
    expect(s.pre.tires.RF.ti).toBe('');
    // and the one track reading lands on both sheets
    expect(s.pre.trackTemp).toBe('118');
    expect(s.post.trackTemp).toBe('118');
  });
});

describe('Smart Fill error messages', () => {
  // "check your connection" is the wrong advice for a missing route or a missing
  // key, and sends people hunting for a signal problem that isn't there
  it('names a missing API key instead of blaming the network', async () => {
    const { explain } = await import('../src/smartfill.js');
    const e = new Error('Server is missing ANTHROPIC_API_KEY.'); e.status = 500;
    const msg = explain(e);
    expect(msg).toContain('ANTHROPIC_API_KEY');
    expect(msg).toContain('.env.local');
    expect(msg).not.toMatch(/connection/i);
  });

  it('names a missing /api route instead of blaming the network', async () => {
    const { explain } = await import('../src/smartfill.js');
    const e = new Error('Request failed (404).'); e.status = 404;
    const msg = explain(e);
    expect(msg).toMatch(/vercel dev|api\/parse/);
    expect(msg).not.toMatch(/check your connection/i);
  });

  it('does blame the network when the fetch genuinely failed', async () => {
    const { explain } = await import('../src/smartfill.js');
    const e = new Error('Could not reach the server.'); e.kind = 'network';
    expect(explain(e)).toMatch(/connection/i);
  });

  it('leads with the offline case when there is no signal at all', async () => {
    const { explain } = await import('../src/smartfill.js');
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    expect(explain(new Error('whatever'))).toMatch(/No signal/i);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it('gives actionable text for rate limits and oversized photos', async () => {
    const { explain } = await import('../src/smartfill.js');
    const rate = new Error('x'); rate.status = 429;
    const big = new Error('x'); big.status = 413;
    expect(explain(rate)).toMatch(/Rate limited/i);
    expect(explain(big)).toMatch(/too large/i);
  });
});

describe('the cold sheet and the hot sheet on one grid', () => {
  const sess = () => {
    window.addDay(); window.addSession('Practice');
    return app().querySelector('.sess').id.replace('card-', '');
  };

  it('shows both sheets, with tread temps only on the hot side', () => {
    sess();
    const html = app().innerHTML;
    expect(html).toContain('Before · Cold');
    expect(html).toContain('After · Hot');
    expect(html).toContain('Tire Temps °F');
    ['Inside', 'Middle', 'Outside'].forEach(l => expect(html).toContain(`<label>${l}</label>`));

    // a cold tire has nothing to say — every tread-temp input is bound to 'post'
    const grid = app().querySelector('.pc-tiregrid');
    const temps = [...grid.querySelectorAll('input')]
      .filter(i => /,'(ti|tm|to)'/.test(i.getAttribute('onchange') || ''));
    expect(temps).toHaveLength(12);
    expect(temps.every(i => i.getAttribute('onchange').includes("'post'"))).toBe(true);
  });

  it('keeps the run context and Changes Made on every card, context first', () => {
    sess();
    const html = app().innerHTML;
    expect(html).toContain('Changes Made');
    expect(html).toContain('Track °F');
    // the run context (Track °F) sits above Changes Made in the new card
    expect(html.indexOf('Track °F')).toBeLessThan(html.indexOf('Changes Made'));
  });

  it('shows tire life going out and laps run coming back together', () => {
    sess();
    const html = app().innerHTML;
    expect(html).toContain('Tire Life');
    expect(html).toContain('Laps Run');
  });

  it('keeps what was typed into the three run-context boxes', async () => {
    const { findS } = await import('../src/state.js');
    const sid = sess();
    window.updRd(sid, 'pre', 'changes', 'Round of wedge out, 1/2 psi off the RF.');
    window.updRd(sid, 'pre', 'tireLife', '2 runs');
    window.updRd(sid, 'post', 'laps', '18');

    const s = findS(sid);
    expect(s.pre.changes).toContain('Round of wedge out');
    expect(s.pre.tireLife).toBe('2 runs');
    expect(s.post.laps).toBe('18');
    // all three have a labelled home on the card
    const html = app().innerHTML;
    expect(html).toContain('Changes Made');
    expect(html).toContain('Tire Life');
    expect(html).toContain('Laps Run');
  });

  it('carries the cold track temp onto the hot sheet by itself', async () => {
    const { findS } = await import('../src/state.js');
    const sid = sess();
    window.updTT(sid, 'pre', '118');

    // one cold reading, carried onto the hot sheet by updTT
    expect(findS(sid).post.trackTemp).toBe('118');

    // correcting it hot afterwards stays a hot-only edit
    window.updTT(sid, 'post', '121');
    expect(findS(sid).pre.trackTemp).toBe('118');
    expect(findS(sid).post.trackTemp).toBe('121');
  });
});

describe('what a race day can hold', () => {
  const btn = label => [...app().querySelectorAll('.pc-addcol button')].find(b => b.textContent.includes(label));

  it('runs practice all afternoon', async () => {
    const S = await import('../src/state.js');
    window.addDay();
    ['Practice', 'Practice', 'Practice', 'Practice'].forEach(t => window.addSession(t));
    expect(S.state.days[0].sessions).toHaveLength(4);
    expect(S.state.days[0].sessions.map(s => s.name)).toEqual(['Practice 1', 'Practice 2', 'Practice 3', 'Practice 4']);
    expect(btn('Practice').disabled).toBe(false);
  });

  it('qualifies once and no more', async () => {
    const S = await import('../src/state.js');
    window.addDay();
    window.addSession('Qualifying');
    expect(S.state.days[0].sessions[0].name).toBe('Qualifying');   // no number — there is only one
    expect(btn('Qualifying').disabled).toBe(true);

    window.addSession('Qualifying');                                // a stale screen, or a mis-tap
    expect(S.state.days[0].sessions).toHaveLength(1);
  });

  it('runs one main or two, never three', async () => {
    const S = await import('../src/state.js');
    window.addDay();
    window.addSession('Main');
    expect(btn('Main').disabled).toBe(false);                       // a twin-main night is legal
    window.addSession('Main');
    expect(S.state.days[0].sessions.map(s => s.name)).toEqual(['Main 1', 'Main 2']);
    expect(btn('Main').disabled).toBe(true);

    window.addSession('Main');
    expect(S.state.days[0].sessions).toHaveLength(2);
  });

  it('will not let a card be re-typed past the limit either', async () => {
    const S = await import('../src/state.js');
    window.addDay();
    window.addSession('Qualifying');
    window.addSession('Practice');
    const practiceId = S.state.days[0].sessions[1].id;

    window.updS(practiceId, 'type', 'Qualifying');
    expect(S.state.days[0].sessions[1].type).toBe('Practice');      // refused, card unchanged

    window.updS(practiceId, 'type', 'Main');                        // still room for a main
    expect(S.state.days[0].sessions[1].type).toBe('Main');
  });

  it('refuses to duplicate a session the day has no room for', async () => {
    const S = await import('../src/state.js');
    window.addDay();
    window.addSession('Qualifying');
    window.dupSession(S.state.days[0].sessions[0].id);
    expect(S.state.days[0].sessions).toHaveLength(1);
  });
});

/* The board keeps every session expanded side by side; what folds now is each
   card's Crew Chief Readout — the car diagram and heat legend. */
describe('the session board and the readout fold', () => {
  const cards = () => [...app().querySelectorAll('.sess')];

  it('leaves the session header without a type picker', () => {
    window.addDay();
    window.addSession('Practice');
    expect(app().querySelector('.pc-card__hd select')).toBeNull();
  });

  it('opens each run with its readout folded, and toggles it on demand', () => {
    window.addDay();
    window.addSession('Practice');
    const sid = cards()[0].id.replace('card-', '');
    const panel = () => document.getElementById('anal-' + sid);
    expect(panel().hidden).toBe(true);                 // folded on arrival

    window.toggleReadout(sid);
    expect(panel().hidden).toBe(false);
    expect(document.getElementById('rotoggle-' + sid).textContent).toContain('Hide Crew Chief Readout');

    window.toggleReadout(sid);
    expect(panel().hidden).toBe(true);
  });

  it('folds one card\'s readout without disturbing another', () => {
    window.addDay();
    window.addSession('Practice');
    window.addSession('Practice');
    const [a, b] = cards().map(c => c.id.replace('card-', ''));

    window.toggleReadout(a);
    expect(document.getElementById('anal-' + a).hidden).toBe(false);
    expect(document.getElementById('anal-' + b).hidden).toBe(true);
  });

  it('keeps a card typeable whether its readout is open or shut', async () => {
    const { findS } = await import('../src/state.js');
    window.addDay();
    window.addSession('Practice');
    const sid = cards()[0].id.replace('card-', '');
    window.updT(sid, 'pre', 'RF', 'psi', '24');
    window.toggleReadout(sid);

    expect(document.getElementById('anal-' + sid)).toBeTruthy();
    expect(findS(sid).pre.tires.RF.psi).toBe('24');
  });
});

/* Day Details folds away behind the Day strip button now, rather than sitting
   open at the top of every day. */
describe('folding the Race Day Details', () => {
  it('starts folded and toggles from the day strip', async () => {
    const S = await import('../src/state.js');
    window.addDay();
    const id = S.state.days[0].id;
    const panel = () => document.getElementById('daydetails');
    expect(panel()).toBeTruthy();                 // present in the DOM...
    expect(panel().hidden).toBe(true);            // ...but folded away

    window.toggleDetails(id);
    expect(panel().hidden).toBe(false);
    window.toggleDetails(id);
    expect(panel().hidden).toBe(true);
  });
});

describe('the crew chief readout', () => {
  it('reads front stagger hot on the car diagram, not a metric box', () => {
    window.addDay(); window.addSession('Practice');
    const sid = app().querySelector('.sess').id.replace('card-', '');
    window.updTT(sid, 'pre', '118');
    window.updT(sid, 'pre', 'RF', 'size', '88');
    window.updT(sid, 'pre', 'LF', 'size', '87 1/2');
    window.updT(sid, 'post', 'RF', 'size', '88 1/4');
    window.updT(sid, 'post', 'LF', 'size', '87 1/2');
    window.updT(sid, 'post', 'RF', 'tm', '210');

    const anal = document.getElementById('anal-' + sid).innerHTML;
    expect(anal).toContain('FRONT STAGGER HOT');
    expect(anal).toContain('0.75"');
    expect(anal).not.toContain('Track Temp');
  });
});

describe('offline behaviour', () => {
  it('disables Smart Fill and says so when there is no signal', async () => {
    const { canSmartFill } = await import('../src/smartfill.js');
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    expect(canSmartFill()).toBe(false);

    window.addDay(); window.addSession('Practice');
    const html = app().innerHTML;
    expect(html).toContain('No signal — manual entry');
    expect(html).toMatch(/class="sf-scan off"\s+disabled/);   // photo scan unavailable
    expect(html).toContain('sf-go');                          // manual entry still works

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });
});
