/* Generates the PWA icon set with no image dependencies — a minimal PNG encoder
   over Node's built-in zlib. Deterministic, so re-running never churns the repo.

   Mark: chalk-yellow checkered flag on the asphalt-dark background. */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const BG = [17, 20, 25];        // --bg  #111419
const CHALK = [255, 212, 71];   // --chalk #FFD447
const DARK = [13, 16, 20];      // flag's dark squares

/* ---------- minimal PNG writer ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;  // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- the mark ---------- */
/**
 * @param size    icon edge in px
 * @param padding fraction of the edge kept clear around the flag
 *                (maskable icons need the mark inside the safe zone)
 */
function drawIcon(size, padding) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, [r, g, b]) => {
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  };

  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) set(x, y, BG);

  const inset = Math.round(size * padding);
  const fx0 = inset, fy0 = inset;
  const fw = size - inset * 2, fh = size - inset * 2;

  // pole down the left edge
  const poleW = Math.max(2, Math.round(size * 0.055));
  for (let y = fy0; y < fy0 + fh; y++)
    for (let x = fx0; x < fx0 + poleW; x++) set(x, y, CHALK);

  // 4x4 checker to the right of the pole, with a slight wave along the fly
  const bx0 = fx0 + poleW + Math.max(1, Math.round(size * 0.02));
  const bw = fx0 + fw - bx0;
  const bh = Math.round(fh * 0.78);
  const by0 = fy0 + Math.round((fh - bh) / 2);
  const cell = bw / 4;
  const amp = size * 0.035;

  for (let y = 0; y < bh; y++) {
    // wave increases toward the fly so the flag reads as flying, not as a grid
    for (let x = 0; x < bw; x++) {
      const wave = Math.round(Math.sin((x / bw) * Math.PI * 1.6) * amp * (x / bw));
      const ty = by0 + y + wave;
      if (ty < 0 || ty >= size) continue;
      const col = Math.min(3, Math.floor(x / cell));
      const row = Math.min(3, Math.floor(y / (bh / 4)));
      set(bx0 + x, ty, (col + row) % 2 === 0 ? CHALK : DARK);
    }
  }
  return png(size, size, px);
}

mkdirSync(OUT, { recursive: true });

const targets = [
  ['icon-192.png', 192, 0.12],
  ['icon-512.png', 512, 0.12],
  ['apple-touch-icon-180.png', 180, 0.14],
  // maskable: mark pulled well inside the 80% safe zone so launcher crops don't clip it
  ['maskable-512.png', 512, 0.22]
];

for (const [name, size, pad] of targets) {
  writeFileSync(join(OUT, name), drawIcon(size, pad));
  console.log(`icons: ${name} (${size}px)`);
}
