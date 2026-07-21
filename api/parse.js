/* ============================== SMART FILL PROXY ==============================
   Vercel serverless function. Accepts { text } or { imageBase64, mediaType }
   from the phone, calls the Anthropic Messages API with the server-held key,
   and returns the extracted tire data as JSON.

   ANTHROPIC_API_KEY is read from the environment and never leaves this process.
   ============================================================================= */

import Anthropic from '@anthropic-ai/sdk';

export const config = { maxDuration: 30 };

/* Sonnet tier, per the build spec. Structured outputs require Sonnet 5 or newer
   in this family — claude-sonnet-4-6 does not support output_config.format. */
export const MODEL = 'claude-sonnet-5';

const SYSTEM = `You pull tire readings out of a race crew's notes for a Limited Late Model (asphalt oval, left turns only). The input is either a photo of a tire sheet or speech that has been transcribed, so expect it to be messy.

FIELDS
- psi  = tire pressure, psi. Realistic range roughly 8-45.
- size = tire circumference / rollout, inches. Realistic range roughly 80-95.
- ti / tm / to = tread temperature °F at Inside / Middle / Outside. Realistic range roughly 90-300.
- trackTemp = track surface temperature °F.
- Corners: LF = left front, RF = right front, LR = left rear, RR = right rear.

READING SPEECH
- Ignore anything that is not a tire reading: greetings, crew chatter, radio noise, weather talk, who is buying dinner, transcription garbage. Extract only the numbers that belong in the fields above.
- Accept any way a corner gets named: "right front", "RF", "R F", "passenger front", "right side front", "the right front tire". Same for the others; "driver" side = left, "passenger" side = right.
- Spoken numbers and fractions: "twenty four and a half" -> 24.5, "eighty eight and a quarter" -> 88.25, "eighty seven three quarters" -> 87.75, "88 1/4" -> 88.25, "a quarter" -> .25, "a half" -> .5, "three eighths" -> .375.
- In a temperature context "two ten" means 210 and "one eighteen" means 118.
- Three bare numbers after a corner are temperatures in Inside, Middle, Outside order. If only one temperature is given for a corner, put it in tm.
- Use the units and magnitudes to decide which field a bare number belongs to: ~20s is psi, ~80s-90s is size/rollout, three digits is a temperature.
- Corrections win: if a value is restated ("right front twenty two, no wait, twenty four"), keep the LAST one. Same for "scratch that" / "make that".
- A speaker may work through corners in any order and may skip some.

RULES
- Never invent or infer a number that was not stated. Omit anything not clearly given.
- Do not carry a value from one corner to another.
- If a number is ambiguous or you are not confident which field it belongs to, omit it rather than guessing.
- Return all four corners. Within a corner, include only the fields that were actually stated and leave the rest out — an empty corner is correct when nothing was said about it.`;

/* "No reading" is an ABSENT key, not an explicit null.

   The obvious encoding — anyOf: [number, null] on every field — is rejected by
   the API: 4 corners x 5 fields + trackTemp = 21 union-typed parameters, and
   the structured-outputs compiler caps unions at 16 ("exponential compilation
   cost"). Making the fields optional instead expresses the same thing with
   zero unions, and costs nothing downstream: normalize() below runs every
   field through clean(), which maps undefined to null exactly as it did an
   explicit null. The corners stay required so the model always returns the
   full four-corner shape. */
const NUM = { type: 'number' };
const TIRE = {
  type: 'object',
  properties: { psi: NUM, size: NUM, ti: NUM, tm: NUM, to: NUM },
  required: [],
  additionalProperties: false
};
export const SCHEMA = {
  type: 'object',
  properties: {
    trackTemp: NUM,
    tires: {
      type: 'object',
      properties: { LF: TIRE, RF: TIRE, LR: TIRE, RR: TIRE },
      required: ['LF', 'RF', 'LR', 'RR'],
      additionalProperties: false
    }
  },
  required: ['tires'],
  additionalProperties: false
};

const MAX_IMAGE_BYTES = 4_000_000;
const MAX_TEXT_CHARS = 6000;
const ALLOWED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const TIRES = ['LF', 'RF', 'LR', 'RR'];
const FIELDS = ['psi', 'size', 'ti', 'tm', 'to'];

function clean(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** Never trust the shape coming back — the UI writes these straight into state. */
export function normalize(raw) {
  const out = { trackTemp: clean(raw && raw.trackTemp), tires: {} };
  TIRES.forEach(k => {
    const src = (raw && raw.tires && raw.tires[k]) || {};
    const t = {};
    FIELDS.forEach(f => { t[f] = clean(src[f]) });
    out.tires[k] = t;
  });
  return out;
}

/** Validate the request and build the Claude content blocks.
 *  Returns { content } on success or { status, error } to send straight back. */
export function buildContent(body) {
  const { text, imageBase64, mediaType, tab } = body || {};
  const which = tab === 'post' ? 'after session (hot)' : 'before session (cold)';

  if (imageBase64) {
    if (typeof imageBase64 !== 'string') return { status: 400, error: 'Bad image payload.' };
    if (!ALLOWED_MEDIA.has(mediaType || 'image/jpeg')) {
      return { status: 400, error: 'Unsupported image type.' };
    }
    // base64 inflates by 4/3; check the decoded size
    if (imageBase64.length * 0.75 > MAX_IMAGE_BYTES) {
      return { status: 413, error: 'Photo too large — retake it smaller.' };
    }
    return {
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
        { type: 'text', text: `Extract the tire data from this photo of a tire sheet / notes. This fills the "${which}" reading.` }
      ]
    };
  }

  if (typeof text === 'string' && text.trim()) {
    return {
      content: [{
        type: 'text',
        text: `Parse this dictated/typed tire data. Fills the "${which}" reading:\n\n${text.slice(0, MAX_TEXT_CHARS)}`
      }]
    };
  }

  return { status: 400, error: 'Send either text or an image.' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Use POST.' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ ok: false, error: 'Server is missing ANTHROPIC_API_KEY.' });
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : (req.body || {});
  const built = buildContent(body);
  if (built.error) return res.status(built.status).json({ ok: false, error: built.error });
  const content = built.content;

  try {
    const client = new Anthropic();
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: SCHEMA }
      },
      messages: [{ role: 'user', content }]
    });

    if (message.stop_reason === 'refusal') {
      return res.status(422).json({ ok: false, error: 'That image could not be read.' });
    }
    const block = message.content.find(b => b.type === 'text');
    if (!block) return res.status(502).json({ ok: false, error: 'Empty response from the model.' });

    const parsed = safeJson(block.text);
    if (!parsed) return res.status(502).json({ ok: false, error: 'Could not read the extraction result.' });

    return res.status(200).json({ ok: true, data: normalize(parsed) });
  } catch (err) {
    const status = err && err.status;
    if (status === 429) return res.status(429).json({ ok: false, error: 'Rate limited — wait a moment and retry.' });
    if (status === 401 || status === 403) return res.status(500).json({ ok: false, error: 'Server API key rejected.' });
    console.error('[parse] ', err && err.message ? err.message : err);
    return res.status(502).json({ ok: false, error: 'Extraction service unavailable.' });
  }
}

export function safeJson(s) {
  try { return JSON.parse(s) } catch (e) { }
  // last-ditch: pull the outermost object out of a chatty response
  const a = String(s).indexOf('{'), b = String(s).lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(String(s).slice(a, b + 1)) } catch (e) { } }
  return null;
}
