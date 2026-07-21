/* ============================== SMART FILL ==============================
   Photo + dictation extraction. The Anthropic call happens server-side in
   /api/parse so the API key never ships to the phone. This is the ONLY part
   of the app that needs a connection — everything else works in airplane mode.
   ======================================================================== */

import { TIRES } from './num.js';
import { findS, smartBusy, smartMsg, dictDraft, activeTab, queueSave } from './state.js';
import { hooks } from './hooks.js';

const MAX_EDGE = 1568;          // longest edge Claude uses for images
const JPEG_QUALITY = 0.82;

export function canSmartFill() {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

/* ---------- server proxy ---------- */
async function smartParse(payload) {
  let res;
  try {
    res = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    const err = new Error('Could not reach the server.'); err.kind = 'network'; throw err;
  }
  let body = null;
  try { body = await res.json() } catch (e) { /* non-JSON error page */ }
  if (!res.ok || !body || body.ok === false) {
    const err = new Error((body && body.error) || `Request failed (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return body.data;
}

/** Say what actually went wrong. "Check your connection" is the wrong advice when
 *  the route is missing or the server has no API key, and it sends people hunting
 *  for a signal problem that isn't there. */
export function explain(e) {
  if (!canSmartFill()) return 'No signal. Type the numbers in by hand — everything else works offline.';
  if (e && e.kind === 'network') return 'Could not reach the server. Check your connection.';
  const msg = (e && e.message) || '';
  if (e && e.status === 404) {
    return 'Smart Fill is not running on this server. It needs the /api/parse function — run `npx vercel dev`, or restart `npm run dev` to pick up the local API route.';
  }
  if (/ANTHROPIC_API_KEY/i.test(msg)) {
    return 'Smart Fill needs an Anthropic API key on the server. Add ANTHROPIC_API_KEY to .env.local (local) or the Vercel project settings (deployed).';
  }
  if (e && e.status === 429) return 'Rate limited. Wait a moment and try again.';
  if (e && e.status === 413) return 'That photo is too large. Retake it a bit further back.';
  return msg || 'Extraction failed. Try again.';
}

const FIELD_LABEL = { psi: 'psi', size: 'size', ti: 'in', tm: 'mid', to: 'out' };

/* Tread temps are only ever taken hot, so a temperature the model heard while
   the cold sheet was open is a misread — writing it would put a number in a box
   the crew cannot see to correct. */
const WRITABLE = { pre: ['psi', 'size'], post: ['psi', 'size', 'ti', 'tm', 'to'] };

/** Writes the extraction into the reading and reports exactly what landed where,
 *  so the crew can eyeball it against what they said instead of trusting a count. */
export function applyParsed(sess, tab, parsed) {
  let n = 0; const rd = sess[tab]; const parts = [];
  const fields = WRITABLE[tab] || WRITABLE.post;
  if (parsed.trackTemp != null) {
    rd.trackTemp = String(parsed.trackTemp); n++; parts.push('track temp ' + parsed.trackTemp);
    // same carry-over the typed box does — one reading, both sheets
    if (tab === 'pre') sess.post.trackTemp = rd.trackTemp;
  }
  if (parsed.tires) TIRES.forEach(k => {
    const src = parsed.tires[k]; if (!src) return;
    const got = [];
    fields.forEach(f => {
      if (src[f] != null && src[f] !== '') {
        rd.tires[k][f] = String(src[f]); n++;
        got.push(FIELD_LABEL[f] + ' ' + src[f]);
      }
    });
    if (got.length) parts.push(`${k} ${got.join(' · ')}`);
  });
  return { n, summary: parts.join('   ') };
}

/* ---------- photo ---------- */
/** Downscale to <=1568px on the longest edge before upload — a raw phone photo
 *  is several MB and the track's cell service will not carry it. */
async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = () => bad(new Error('decode failed'));
      im.src = url;
    });
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    const dataUrl = cv.toDataURL('image/jpeg', JPEG_QUALITY);
    return { imageBase64: dataUrl.split(',')[1], mediaType: 'image/jpeg' };
  } finally { URL.revokeObjectURL(url) }
}

function readAsBase64(file) {
  return new Promise((ok, bad) => {
    const r = new FileReader();
    r.onload = () => ok(r.result.split(',')[1]);
    r.onerror = () => bad(new Error('read failed'));
    r.readAsDataURL(file);
  });
}

export function smartPhoto(sid, tab) {
  if (!canSmartFill()) return;
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
  inp.onchange = async () => {
    const file = inp.files && inp.files[0]; if (!file) return;
    const sess = findS(sid); if (!sess) return;
    smartBusy[sid] = true; smartMsg[sid] = ''; hooks.render();
    try {
      let payload;
      try { payload = await compressImage(file) }
      catch (e) { payload = { imageBase64: await readAsBase64(file), mediaType: file.type || 'image/jpeg' } }
      payload.tab = tab;
      const parsed = await smartParse(payload);
      const { n, summary } = applyParsed(sess, tab, parsed);
      smartMsg[sid] = n
        ? `✓ ${n} value${n === 1 ? '' : 's'} into ${tab === 'pre' ? 'BEFORE · COLD' : 'AFTER · HOT'} — ${summary}`
        : 'Couldn’t find values in that photo. Try a clearer shot.';
      queueSave();
    } catch (e) { smartMsg[sid] = '!' + explain(e) }
    smartBusy[sid] = false; hooks.render();
  };
  inp.click();
}

/* ---------- typed / dictated text ---------- */
export async function smartText(sid) {
  if (!canSmartFill()) return;
  const sess = findS(sid); if (!sess) return;
  const tab = activeTab[sid] || 'pre';
  const ta = document.getElementById('dict-' + sid);
  const txt = ta ? ta.value.trim() : (dictDraft[sid] || '').trim();
  if (!txt) { smartMsg[sid] = '!Nothing to read — dictate or type the numbers first.'; hooks.render(); return }
  dictDraft[sid] = txt;
  smartBusy[sid] = true; smartMsg[sid] = ''; hooks.render();
  try {
    const parsed = await smartParse({ text: txt, tab });
    const { n, summary } = applyParsed(sess, tab, parsed);
    if (n) {
      smartMsg[sid] = `✓ ${n} value${n === 1 ? '' : 's'} into ${tab === 'pre' ? 'BEFORE · COLD' : 'AFTER · HOT'} — ${summary}`;
      dictDraft[sid] = '';         // it landed on the sheet; clear the scratch pad
    } else {
      smartMsg[sid] = 'Couldn’t pull numbers out of that. Try naming each corner, e.g. “right front 22 psi, 88 and a quarter, temps 210 195 180”.';
    }
    queueSave();
  } catch (e) { smartMsg[sid] = '!' + explain(e) }
  smartBusy[sid] = false; hooks.render();
}

/* ---------- Web Speech dictation ----------
   Speech recognition is fussy: browsers end the session after a few seconds of
   silence even with continuous=true, and a denied mic permission surfaces only
   as an error event. Both used to leave the button stuck on "Stop" with nothing
   happening, so this tracks *intent* (wantSid) separately from the live
   recogniser and restarts underneath the user. */

const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
let rec = null;          // the live SpeechRecognition, if any
let wantSid = null;      // the session the user wants to be dictating into
let finalTxt = '';       // committed transcript for the active session
let startedAt = 0, fastFails = 0;   // guards the auto-restart against a hot loop

export function speechSupported() { return !!SR }
export function isListening(sid) { return wantSid === sid }

const MIC_ERRORS = {
  'not-allowed': 'Microphone blocked. Allow mic access for this site, then tap Talk again.',
  'service-not-allowed': 'Microphone blocked by the browser or OS. Check its mic permissions.',
  'audio-capture': 'No microphone found.',
  'network': 'Speech service unreachable — type the numbers instead.'
};

function setDraft(sid, committed, interim) {
  dictDraft[sid] = committed.trim();
  const el = document.getElementById('dict-' + sid);
  if (el) {
    el.value = (committed + (interim ? ' ' + interim : '')).trim();
    el.scrollTop = el.scrollHeight;
  }
}

function spinUp(sid) {
  rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = 'en-US';

  rec.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const chunk = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalTxt = (finalTxt ? finalTxt.trimEnd() + ' ' : '') + chunk.trim();
      else interim += chunk;
    }
    setDraft(sid, finalTxt, interim);
  };

  rec.onerror = e => {
    const code = e && e.error;
    if (code === 'no-speech' || code === 'aborted') return;   // benign; onend will restart
    wantSid = null; rec = null;
    smartMsg[sid] = '!' + (MIC_ERRORS[code] || 'Could not start the microphone.');
    hooks.render();
  };

  // Browsers cut the session on silence. If the user has not tapped Stop, resume —
  // but if it keeps dying instantly, something is wrong; stop instead of spinning.
  rec.onend = () => {
    rec = null;
    if (wantSid !== sid) return;
    fastFails = (Date.now() - startedAt < 300) ? fastFails + 1 : 0;
    if (fastFails >= 3) {
      wantSid = null;
      smartMsg[sid] = '!Microphone keeps dropping. Type the numbers instead.';
      hooks.render();
      return;
    }
    try { spinUp(sid) } catch (e) { wantSid = null; hooks.render() }
  };

  startedAt = Date.now();
  rec.start();
}

export function startDictate(sid) {
  if (!SR) return;
  stopDictate();
  finalTxt = (dictDraft[sid] || '');
  wantSid = sid;
  fastFails = 0;
  smartMsg[sid] = '';
  try { spinUp(sid) }
  catch (e) {
    wantSid = null; rec = null;
    smartMsg[sid] = '!Could not start the microphone.';
  }
  hooks.render();
}

/** Stop listening. Tapping Stop means "I'm done talking" — so unless told
 *  otherwise, send what was heard straight to the sheet. */
export function endDictate(sid, autoFill = true) {
  const had = (dictDraft[sid] || '').trim();
  stopDictate();
  hooks.render();
  if (autoFill && had) smartText(sid);
}

export function toggleDictate(sid) {
  if (wantSid === sid) endDictate(sid, true);
  else startDictate(sid);
}

/** Tear down without re-rendering — for navigation and teardown paths. */
export function stopDictate() {
  wantSid = null;
  if (rec) {
    try { rec.onend = null; rec.onresult = null; rec.onerror = null; rec.abort() } catch (e) { }
  }
  rec = null;
}

export function clearDraft(sid) {
  dictDraft[sid] = '';
  smartMsg[sid] = '';
  const el = document.getElementById('dict-' + sid);
  if (el) el.value = '';
  hooks.render();
}
