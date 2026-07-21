/* ================================ CREW SYNC ================================
   A shared log for one crew. Phones stay local-first — IndexedDB is still the
   source of truth on each device and a full race day can be logged with no
   signal at all. This endpoint is only a meeting point they reconcile against
   when a bar of service shows up.

   Merge is per-field last-write-wins, keyed by a path like
   `r:<sessionId>:post:RF:psi`. Syncing whole documents would mean two people
   logging different corners of the same session silently overwrite each other —
   which is exactly what a second set of hands is for during a hot session. Per
   path, that cannot happen; the only thing that can be lost is the older of two
   edits to the *same* field, which is the honest answer anyway.

   Storage is Upstash Redis over its REST API, called with plain fetch. No SDK
   dependency: this file runs in a serverless function where a fetch and three
   commands beat a package that has to be installed, bundled, and kept current.

     crew:<code>:seq   INCR  server-assigned change number
     crew:<code>:val   HASH  path -> {"v":<value>,"t":<clientMs>,"d":<deviceId>}
     crew:<code>:log   ZSET  path scored by seq — "everything since N" is one range read

   The ZSET scores a path by the seq of its most recent write, so a client that
   has been offline for a weekend pulls each changed field once, not once per
   edit it missed.
   ========================================================================== */

export const config = { maxDuration: 15 };

/* A crew code is a shared secret in a public URL's clothing, so it has to be
   unguessable — tire data is competitive intel. Generated client-side from a
   32-symbol alphabet; this only has to agree on the shape. */
const CODE_RE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

const MAX_OPS = 2000;          // a whole season of first-sync fits well inside this
const MAX_VALUE_CHARS = 2000;  // a notes field; anything larger is not a tire reading
const TTL_SECONDS = 60 * 60 * 24 * 400;   // idle crews expire after ~13 months

function env(...names) {
  for (const n of names) if (process.env[n]) return process.env[n];
  return null;
}

/** Upstash REST. Pass one command, or an array of commands to pipeline. */
async function redis(commands) {
  const url = env('KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL', 'REDIS_REST_API_URL');
  const token = env('KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN', 'REDIS_REST_API_TOKEN');
  if (!url || !token) { const e = new Error('no-store'); e.noStore = true; throw e }

  const pipelined = Array.isArray(commands[0]);
  const res = await fetch(pipelined ? url.replace(/\/$/, '') + '/pipeline' : url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands)
  });
  if (!res.ok) throw new Error('store ' + res.status);
  const body = await res.json();
  if (pipelined) return body.map(r => r.result);
  return body.result;
}

/** Ops are the wire format: { p: path, v: value (null = tombstone), t: client ms }. */
function validOps(raw) {
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_OPS) return null;
  const out = [];
  for (const o of raw) {
    if (!o || typeof o.p !== 'string' || !o.p || o.p.length > 200) return null;
    if (!Number.isFinite(o.t)) return null;
    const v = o.v;
    if (v !== null && typeof v !== 'string' && typeof v !== 'number') return null;
    if (typeof v === 'string' && v.length > MAX_VALUE_CHARS) return null;
    out.push({ p: o.p, v: v === undefined ? null : v, t: o.t });
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Use POST.' });
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : (req.body || {});
  const crew = String((body && body.crew) || '').toUpperCase();
  if (!CODE_RE.test(crew)) {
    return res.status(400).json({ ok: false, error: 'Bad crew code.' });
  }
  const device = String((body && body.device) || '').slice(0, 40) || 'anon';
  const since = Number.isFinite(body && body.since) ? body.since : 0;
  const ops = validOps((body && body.ops) || []);
  if (!ops) return res.status(400).json({ ok: false, error: 'Bad ops payload.' });

  const kVal = `crew:${crew}:val`;
  const kLog = `crew:${crew}:log`;
  const kSeq = `crew:${crew}:seq`;

  try {
    let seq = 0;

    if (ops.length) {
      /* Only accept an op that is newer than what we already hold for that path.
         A phone that spent the weekend offline must not walk back edits made
         since — its clock says "now" but its data is from Friday. Ties break on
         device id purely so every replica lands on the same winner. */
      const existing = await redis(['HMGET', kVal, ...ops.map(o => o.p)]);
      const winners = [];
      ops.forEach((o, i) => {
        const cur = existing && existing[i] ? safeJson(existing[i]) : null;
        if (cur && (cur.t > o.t || (cur.t === o.t && String(cur.d) >= device))) return;
        winners.push(o);
      });

      if (winners.length) {
        seq = await redis(['INCR', kSeq]);
        const hset = ['HSET', kVal];
        const zadd = ['ZADD', kLog];
        winners.forEach(o => {
          hset.push(o.p, JSON.stringify({ v: o.v, t: o.t, d: device }));
          zadd.push(seq, o.p);
        });
        await redis([hset, zadd, ['EXPIRE', kVal, TTL_SECONDS], ['EXPIRE', kLog, TTL_SECONDS], ['EXPIRE', kSeq, TTL_SECONDS]]);
      }
    }

    /* Everything changed since the caller's cursor. `since` of 0 is a first
       sync and pulls the whole crew log. Scores come back too — they are what
       the caller's next cursor is built from. */
    const rows = await redis(['ZRANGEBYSCORE', kLog, '(' + since, '+inf', 'WITHSCORES']);
    const paths = [], scores = [];
    for (let i = 0; Array.isArray(rows) && i < rows.length; i += 2) {
      paths.push(rows[i]); scores.push(Number(rows[i + 1]));
    }

    let out = [];
    if (paths.length) {
      const vals = await redis(['HMGET', kVal, ...paths]);
      out = paths.map((p, i) => {
        const rec = vals && vals[i] ? safeJson(vals[i]) : null;
        return rec ? { p, v: rec.v, t: rec.t } : null;
      }).filter(Boolean);
    }

    return res.status(200).json({ ok: true, cursor: nextCursor(since, scores), ops: out });
  } catch (err) {
    if (err && err.noStore) {
      return res.status(503).json({ ok: false, error: 'Crew sync is not configured on the server.' });
    }
    console.error('[crew] ', err && err.message ? err.message : err);
    return res.status(502).json({ ok: false, error: 'Crew sync unavailable.' });
  }
}

/** Advance the caller's cursor to cover exactly what we handed them, and not one
 *  change further.
 *
 *  It is tempting to return the crew's current sequence number, since that is
 *  "where the log is now". That silently loses data. Upstash serves reads from a
 *  replica, so a phone can ask a beat after someone else's write and get an empty
 *  page that the counter already counts. Hand back the counter and that phone
 *  advances past three readings it never received and never asks for them again —
 *  no error, no retry, the sheet is just wrong on one device.
 *
 *  Only ever moving to the highest score actually delivered makes a lagging read
 *  a no-op instead: the cursor stays put and the next poll, twenty seconds later,
 *  picks the same changes up. Re-delivering is free — the client applies an op
 *  only when it is newer than what it holds. */
export function nextCursor(since, scores) {
  let c = Number(since) || 0;
  (scores || []).forEach(s => { const n = Number(s); if (Number.isFinite(n) && n > c) c = n });
  return c;
}

export function safeJson(s) {
  try { return JSON.parse(s) } catch (e) { return null }
}
