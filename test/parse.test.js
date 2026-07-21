/* Covers the request validation and response sanitising in the Smart Fill proxy.
   The Anthropic call itself needs a live key, so it is not exercised here — but
   everything that decides what we send and what we hand back to the UI is. */

import { describe, it, expect } from 'vitest';
import { normalize, buildContent, safeJson, SCHEMA, MODEL } from '../api/parse.js';

describe('buildContent — request validation', () => {
  it('rejects a request with neither text nor image', () => {
    expect(buildContent({})).toMatchObject({ status: 400 });
    expect(buildContent({ text: '   ' })).toMatchObject({ status: 400 });
    expect(buildContent(undefined)).toMatchObject({ status: 400 });
  });

  it('builds a text prompt naming the tab being filled', () => {
    const pre = buildContent({ text: 'right front 24 psi', tab: 'pre' });
    expect(pre.content).toHaveLength(1);
    expect(pre.content[0].text).toContain('before session (cold)');
    expect(pre.content[0].text).toContain('right front 24 psi');

    const post = buildContent({ text: 'right front 28 psi', tab: 'post' });
    expect(post.content[0].text).toContain('after session (hot)');
  });

  it('defaults to the cold tab when none is given', () => {
    expect(buildContent({ text: 'x' }).content[0].text).toContain('before session (cold)');
  });

  it('builds an image block plus an instruction', () => {
    const r = buildContent({ imageBase64: 'AAAA', mediaType: 'image/png', tab: 'post' });
    expect(r.content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' }
    });
    expect(r.content[1].text).toContain('after session (hot)');
  });

  it('defaults an unspecified media type to jpeg', () => {
    const r = buildContent({ imageBase64: 'AAAA' });
    expect(r.content[0].source.media_type).toBe('image/jpeg');
  });

  it('rejects media types Claude will not accept', () => {
    expect(buildContent({ imageBase64: 'AAAA', mediaType: 'image/heic' })).toMatchObject({ status: 400 });
    expect(buildContent({ imageBase64: 'AAAA', mediaType: 'application/pdf' })).toMatchObject({ status: 400 });
  });

  it('rejects an oversized photo before spending a request on it', () => {
    const huge = 'A'.repeat(6_000_000);   // ~4.5 MB decoded
    expect(buildContent({ imageBase64: huge })).toMatchObject({ status: 413 });
  });

  it('truncates a runaway dictation instead of sending it whole', () => {
    const r = buildContent({ text: 'x'.repeat(20000) });
    expect(r.content[0].text.length).toBeLessThan(7000);
  });

  it('prefers the image when both are sent', () => {
    const r = buildContent({ imageBase64: 'AAAA', text: 'ignore me' });
    expect(r.content[0].type).toBe('image');
  });
});

describe('normalize — never hand the UI a shape it cannot write to state', () => {
  it('always returns all four corners with all five fields', () => {
    const out = normalize({});
    expect(Object.keys(out.tires).sort()).toEqual(['LF', 'LR', 'RF', 'RR']);
    ['LF', 'RF', 'LR', 'RR'].forEach(k => {
      expect(Object.keys(out.tires[k]).sort()).toEqual(['psi', 'size', 'ti', 'tm', 'to']);
    });
    expect(out.trackTemp).toBeNull();
  });

  it('survives null, junk, and missing tires', () => {
    expect(() => normalize(null)).not.toThrow();
    expect(normalize({ tires: 'nope' }).tires.LF.psi).toBeNull();
    expect(normalize({ tires: { RF: null } }).tires.RF.tm).toBeNull();
  });

  it('keeps real numbers and drops everything else', () => {
    const out = normalize({
      trackTemp: 118,
      tires: { RF: { psi: 24.5, size: '88.25', ti: 'hot', tm: null, to: NaN } }
    });
    expect(out.trackTemp).toBe(118);
    expect(out.tires.RF.psi).toBe(24.5);
    expect(out.tires.RF.size).toBe(88.25);   // numeric string coerced
    expect(out.tires.RF.ti).toBeNull();      // unparseable -> null, not NaN
    expect(out.tires.RF.tm).toBeNull();
    expect(out.tires.RF.to).toBeNull();
  });

  it('never emits NaN or Infinity, which would poison the analysis', () => {
    const out = normalize({ trackTemp: Infinity, tires: { LF: { psi: NaN, size: -Infinity } } });
    const all = [out.trackTemp, out.tires.LF.psi, out.tires.LF.size];
    all.forEach(v => expect(v === null || Number.isFinite(v)).toBe(true));
  });

  it('ignores extra keys the model might invent', () => {
    const out = normalize({ tires: { RF: { psi: 20, bogus: 5 } }, extra: 1 });
    expect(out.tires.RF).not.toHaveProperty('bogus');
    expect(out).not.toHaveProperty('extra');
  });
});

describe('safeJson', () => {
  it('parses clean JSON', () => {
    expect(safeJson('{"a":1}')).toEqual({ a: 1 });
  });
  it('digs the object out of a chatty response', () => {
    expect(safeJson('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('returns null when there is nothing to parse', () => {
    expect(safeJson('no json here')).toBeNull();
    expect(safeJson('')).toBeNull();
  });
});

describe('model + schema contract', () => {
  it('targets a model that supports structured outputs', () => {
    expect(MODEL).toBe('claude-sonnet-5');
  });

  it('locks the schema down so the model cannot return a surprise shape', () => {
    expect(SCHEMA.additionalProperties).toBe(false);
    expect(SCHEMA.required).toEqual(['tires']);
    expect(SCHEMA.properties.tires.required).toEqual(['LF', 'RF', 'LR', 'RR']);
    ['LF', 'RF', 'LR', 'RR'].forEach(k => {
      const t = SCHEMA.properties.tires.properties[k];
      expect(t.additionalProperties).toBe(false);
      expect(Object.keys(t.properties).sort()).toEqual(['psi', 'size', 'ti', 'tm', 'to']);
      // Blank boxes are normal, so every field is optional — the model omits
      // what wasn't stated and normalize() turns the gap back into null.
      expect(t.required).toEqual([]);
    });
  });

  /* The whole schema must stay under the structured-outputs union cap (16
     union-typed parameters). The original anyOf:[number,null] encoding sat at
     21 and every request 400'd, which no mocked test could have caught. */
  it('stays under the union-type limit that made every live call fail', () => {
    let unions = 0;
    (function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (node.anyOf || Array.isArray(node.type)) unions++;
      Object.values(node.properties || {}).forEach(walk);
    })(SCHEMA);
    expect(unions).toBeLessThanOrEqual(16);
  });
});
