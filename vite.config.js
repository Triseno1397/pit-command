import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/* Writes the key into .env.local for the developer so they never have to hunt for
   a dotfile. Local dev only — these routes live in a Vite plugin, so they do not
   exist in the built app and are never deployed. */
function writeEnvLocal(key) {
  const p = resolve(process.cwd(), '.env.local');
  let txt = existsSync(p) ? readFileSync(p, 'utf8') : '';
  const line = 'ANTHROPIC_API_KEY=' + key;
  if (/^ANTHROPIC_API_KEY=.*$/m.test(txt)) txt = txt.replace(/^ANTHROPIC_API_KEY=.*$/m, line);
  else txt += (txt && !txt.endsWith('\n') ? '\n' : '') + line + '\n';
  writeFileSync(p, txt, 'utf8');
  return p;
}

function readJsonBody(req) {
  return new Promise(async (ok, bad) => {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
    } catch (e) { bad(e) }
  });
}

function sendJson(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

/* Vercel serves everything in api/ as a function in production, but `vite dev`
   knows nothing about it — so Smart Fill used to 404 locally and the client
   reported it as a connection problem. Mount the same handler on the dev server
   so `npm run dev` behaves like the deploy. */
function apiDevServer(mode) {
  /* The functions read their config from process.env; mirror .env / .env.local
     into it. Re-read per request so adding a key doesn't mean restarting the dev
     server. The crew route needs the Upstash pair — without them it reports
     "no store" and every phone on the dev server looks permanently unshared. */
  const ENV_KEYS = [
    'ANTHROPIC_API_KEY',
    'KV_REST_API_URL', 'KV_REST_API_TOKEN',
    'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
    'REDIS_REST_API_URL', 'REDIS_REST_API_TOKEN'
  ];
  const pickUpKey = () => {
    if (ENV_KEYS.every(k => process.env[k])) return;
    const fresh = loadEnv(mode, process.cwd(), '');
    ENV_KEYS.forEach(k => { if (!process.env[k] && fresh[k]) process.env[k] = fresh[k] });
  };

  /* One adapter for every api/ handler: read the body, put the Express-ish
     shape the Vercel runtime provides onto `res`, and hand off. */
  const mount = (server, route) => {
    server.middlewares.use(route, async (req, res) => {
      try {
        pickUpKey();
        const chunks = [];
        for await (const c of req) chunks.push(c);
        req.body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};

        res.status = code => { res.statusCode = code; return res };
        res.json = obj => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(obj));
          return res;
        };

        const mod = await server.ssrLoadModule(route + '.js');
        await mod.default(req, res);
      } catch (err) {
        server.config.logger.error(`[${route.slice(1)} dev] ` + (err && err.stack || err));
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'Dev API route failed: ' + (err && err.message || err) }));
      }
    });
  };
  return {
    name: 'api-dev-server',
    apply: 'serve',
    configureServer(server) {
      pickUpKey();

      // Is this the local dev server, and does it have a key yet?
      server.middlewares.use('/api/dev/key-status', (req, res) => {
        pickUpKey();
        sendJson(res, 200, { ok: true, dev: true, hasKey: !!process.env.ANTHROPIC_API_KEY });
      });

      // Accept a key from the setup panel, store it, and prove it actually works.
      server.middlewares.use('/api/dev/set-key', async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Use POST.' });
        try {
          const { key } = await readJsonBody(req);
          const clean = String(key || '').trim().replace(/^['"]|['"]$/g, '');
          if (!clean) return sendJson(res, 400, { ok: false, error: 'No key provided.' });
          if (/\s/.test(clean)) return sendJson(res, 400, { ok: false, error: 'That key has a space in it — check the paste.' });
          if (!clean.startsWith('sk-ant-')) {
            return sendJson(res, 400, { ok: false, error: 'An Anthropic key starts with "sk-ant-". Check you copied the whole thing.' });
          }

          // verify before committing, so a bad paste fails here and not mid-session
          const { default: Anthropic } = await import('@anthropic-ai/sdk');
          try {
            await new Anthropic({ apiKey: clean }).models.retrieve('claude-sonnet-5');
          } catch (err) {
            const status = err && err.status;
            if (status === 401 || status === 403) {
              return sendJson(res, 400, { ok: false, error: 'Anthropic rejected that key. Check it was copied in full and is still active.' });
            }
            return sendJson(res, 502, { ok: false, error: 'Could not reach Anthropic to verify the key: ' + (err && err.message || err) });
          }

          const path = writeEnvLocal(clean);
          process.env.ANTHROPIC_API_KEY = clean;
          server.config.logger.info('[pit-command] API key saved to ' + path);
          sendJson(res, 200, { ok: true, verified: true });
        } catch (e) {
          sendJson(res, 500, { ok: false, error: 'Could not save the key: ' + (e && e.message || e) });
        }
      });

      /* Both deployed functions, so `npm run dev` behaves like the deploy.
         /api/crew was missing here, which made every local dev server report
         "sync failed" and show an empty log — the shared season is on the other
         side of that route. */
      mount(server, '/api/parse');
      mount(server, '/api/crew');
    }
  };
}

/* @fontsource ships a .woff fallback next to every .woff2. Every browser that can
   run a service worker supports woff2, so the fallback is ~190 KB of dead weight in
   the deploy — and being un-precached it would be a doomed network fetch offline.
   Strip the fallback src before Vite resolves the URL, so the asset is never emitted. */
function dropLegacyWoff() {
  return {
    name: 'drop-legacy-woff',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('@fontsource') || !id.split('?')[0].endsWith('.css')) return null;
      const out = code.replace(/,\s*url\([^)]+\.woff\)\s*format\((['"])woff\1\)/g, '');
      return out === code ? null : { code: out, map: null };
    }
  };
}

export default defineConfig(({ mode }) => ({
  build: {
    outDir: 'dist',
    // fonts inline poorly and we want them precached as discrete files
    assetsInlineLimit: 0
  },
  plugins: [
    apiDevServer(mode),
    dropLegacyWoff(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // icons are picked up by the png glob below — listing them here too would
      // duplicate them in the precache manifest
      manifest: {
        name: 'Pit Command',
        short_name: 'Pit Command',
        description: 'Race day tire data console for a Limited Late Model crew chief.',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#111419',
        theme_color: '#111419',
        categories: ['sports', 'utilities', 'productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // Precache the entire shell: at a race track there is no second chance to fetch.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/index.html',
        // Smart Fill must always hit the network — never serve it from cache.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true
      },
      devOptions: { enabled: false }
    })
  ]
}));
