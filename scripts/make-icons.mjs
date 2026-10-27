import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

function crc32(buf) {
  let c,
    crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const nx = x / size,
        ny = y / size;
      // triangle (nx between edges), glowing dot
      const inTri = ny > 0.2 && ny < 0.78 && Math.abs(nx - 0.5) < (ny - 0.2) * 0.72;
      const edge =
        inTri && !(ny > 0.26 && ny < 0.72 && Math.abs(nx - 0.5) < (ny - 0.26) * 0.72 - 0.03);
      const dot = Math.hypot(nx - 0.5, ny - 0.6) < 0.07;
      let r = 11,
        g = 18,
        b = 32;
      if (edge) {
        r = 94;
        g = 234;
        b = 212;
      }
      if (dot) {
        r = 245;
        g = 158;
        b = 11;
      }
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const out = new URL('../apps/console/public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const s of [192, 512]) writeFileSync(new URL(`icon-${s}.png`, out), png(s));
console.log('icons written');
