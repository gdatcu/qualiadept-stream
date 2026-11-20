import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SIZE = 512;

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function inRoundedRect(x, y, x0, y0, w, h, r) {
  if (x < x0 || x > x0 + w || y < y0 || y > y0 + h) return false;
  const cx = x < x0 + r ? x0 + r : x > x0 + w - r ? x0 + w - r : x;
  const cy = y < y0 + r ? y0 + r : y > y0 + h - r ? y0 + h - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function inPlayTriangle(x, y) {
  // Triangle vertices: (204, 152), (372, 256), (204, 360)
  const x1 = 204, y1 = 152;
  const x2 = 372, y2 = 256;
  const x3 = 204, y3 = 360;
  const d1 = (x - x2) * (y1 - y2) - (x1 - x2) * (y - y2);
  const d2 = (x - x3) * (y2 - y3) - (x2 - x3) * (y - y3);
  const d3 = (x - x1) * (y3 - y1) - (x3 - x1) * (y - y1);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (1 + SIZE * 4);
  raw[rowStart] = 0; // filter type None
  for (let x = 0; x < SIZE; x++) {
    const idx = rowStart + 1 + x * 4;
    let r = 6, g = 7, b = 13, a = 255; // #06070d obsidian background

    if (inRoundedRect(x, y, 36, 36, 440, 440, 88)) {
      const t = (x + y) / (SIZE * 2);
      // Gradient #7c3aed (124, 58, 237) -> #3730a3 (55, 48, 163)
      r = Math.round(124 + (55 - 124) * t);
      g = Math.round(58 + (48 - 58) * t);
      b = Math.round(237 + (163 - 237) * t);
    }

    if (inPlayTriangle(x, y)) {
      r = 255; g = 255; b = 255;
    }

    raw[idx] = r;
    raw[idx + 1] = g;
    raw[idx + 2] = b;
    raw[idx + 3] = a;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  makeChunk('IHDR', ihdr),
  makeChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  makeChunk('IEND', Buffer.alloc(0)),
]);

const root = path.resolve(import.meta.dirname, '..');
fs.mkdirSync(path.join(root, 'tizen'), { recursive: true });
fs.writeFileSync(path.join(root, 'public', 'icon-512.png'), png);
fs.writeFileSync(path.join(root, 'tizen', 'icon.png'), png);
console.log('Generated 512x512 PNG icons in public/icon-512.png and tizen/icon.png');
