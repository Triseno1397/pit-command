/* One-time Smart Fill setup, shown in the app instead of making anyone hand-edit
   a dotfile. The key is POSTed to the LOCAL dev server, which verifies it against
   Anthropic and writes it to .env.local. It is never stored in the browser.

   These routes come from a Vite dev plugin, so they do not exist in the built
   app: on a real deploy the panel simply never appears and the key lives in the
   host's environment variables. */

import { hooks } from './hooks.js';

export const devKey = { checked: false, isDev: false, hasKey: false, busy: false, msg: '' };

export async function checkDevKey() {
  try {
    const res = await fetch('/api/dev/key-status');
    if (!res.ok) throw new Error('not dev');
    const body = await res.json();
    devKey.isDev = !!body.dev;
    devKey.hasKey = !!body.hasKey;
  } catch (e) {
    devKey.isDev = false;      // deployed build, or no dev route — no panel
    devKey.hasKey = true;      // assume the host has it; a real failure will say so
  }
  devKey.checked = true;
  hooks.render();
}

/** True when we should offer the setup panel: local dev, no key yet. */
export function needsKey() {
  return devKey.checked && devKey.isDev && !devKey.hasKey;
}

export async function saveDevKey(sid) {
  const input = document.getElementById('devkey-input');
  const key = input ? input.value.trim() : '';
  if (!key) { devKey.msg = '!Paste the key first.'; hooks.render(); return }

  devKey.busy = true; devKey.msg = ''; hooks.render();
  try {
    const res = await fetch('/api/dev/set-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || !body.ok) {
      devKey.msg = '!' + ((body && body.error) || 'Could not save the key.');
    } else {
      devKey.hasKey = true;
      devKey.msg = '✓ Key saved and verified. Smart Fill is on.';
      hooks.toast('Smart Fill is on. Talk or type your readings.');
    }
  } catch (e) {
    devKey.msg = '!Could not reach the dev server.';
  }
  devKey.busy = false; hooks.render();
}
