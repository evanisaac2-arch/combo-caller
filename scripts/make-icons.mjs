// Generates the PNG app icons (same target design as icons/icon.svg) with no dependencies.
// Run: npm run icons

import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const BG = [0x0e, 0x0f, 0x12];
const RED = [0xe5, 0x48, 0x4d];
const WHITE = [0xff, 0xff, 0xff];

// Colour at (x, y) in a unit square. scale shrinks the target (maskable icons need a safe zone).
function colourAt(x, y, scale) {
  const d = Math.hypot(x - 0.5, y - 0.5) / scale;
  if (d <= 36 / 512) return WHITE;
  if (Math.abs(d - 112 / 512) <= 14 / 512) return WHITE;
  if (d <= 184 / 512) return RED;
  return BG;
}

function render(size, scale) {
  const SS = 4; // supersampling for smooth edges
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3); // filter byte + RGB
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = colourAt((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, scale);
          for (let i = 0; i < 3; i++) acc[i] += c[i];
        }
      }
      for (let i = 0; i < 3; i++) row[1 + x * 3 + i] = Math.round(acc[i] / (SS * SS));
    }
    rows.push(row);
  }
  return png(size, size, Buffer.concat(rows));
}

function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tb));
  return Buffer.concat([len, tb, crc]);
}

function png(w, h, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = (name) => new URL(`../icons/${name}`, import.meta.url);
writeFileSync(out('icon-192.png'), render(192, 1));
writeFileSync(out('icon-512.png'), render(512, 1));
writeFileSync(out('icon-maskable-512.png'), render(512, 0.78));
console.log('Wrote icons/icon-192.png, icon-512.png, icon-maskable-512.png');
