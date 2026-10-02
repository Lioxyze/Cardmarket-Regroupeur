// Génère icons/icon-{16,32,48,128}.png (logo : deux cartes + coche). Usage : node scripts/make-icons.js
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// Même dessin que le logo SVG du panneau, dans un repère 32×32.
const SHAPES = [
  { type: 'card', x: 3, y: 8, w: 15, h: 20, r: 3, angle: -9, cx: 10, cy: 18, color: [31, 79, 209] },
  { type: 'card', x: 13, y: 4, w: 15, h: 20, r: 3, angle: 7, cx: 20, cy: 14, color: [240, 162, 58] },
  { type: 'stroke', points: [[15.5, 14.5], [18.5, 17.5], [24, 11]], width: 2.4, color: [255, 255, 255] },
];

function inRoundedRect(px, py, s) {
  const a = (-s.angle * Math.PI) / 180;
  const dx = px - s.cx;
  const dy = py - s.cy;
  const x = s.cx + dx * Math.cos(a) - dy * Math.sin(a);
  const y = s.cy + dx * Math.sin(a) + dy * Math.cos(a);
  const qx = Math.max(Math.abs(x - (s.x + s.w / 2)) - (s.w / 2 - s.r), 0);
  const qy = Math.max(Math.abs(y - (s.y + s.h / 2)) - (s.h / 2 - s.r), 0);
  return Math.hypot(qx, qy) <= s.r;
}

function nearPolyline(px, py, s) {
  for (let i = 0; i < s.points.length - 1; i++) {
    const [ax, ay] = s.points[i];
    const [bx, by] = s.points[i + 1];
    const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    if (Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay))) <= s.width / 2) return true;
  }
  return false;
}

function render(size) {
  const SS = 6;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = ((x + (sx + 0.5) / SS) / size) * 32;
          const v = ((y + (sy + 0.5) / SS) / size) * 32;
          let color = null;
          for (const s of SHAPES) {
            if (s.type === 'card' ? inRoundedRect(u, v, s) : nearPolyline(u, v, s)) color = s.color;
          }
          if (color) {
            r += color[0];
            g += color[1];
            b += color[2];
            a += 1;
          }
        }
      }
      const i = (y * size + x) * 4;
      px[i] = a ? Math.round(r / a) : 0;
      px[i + 1] = a ? Math.round(g / a) : 0;
      px[i + 2] = a ? Math.round(b / a) : 0;
      px[i + 3] = Math.round((255 * a) / (SS * SS));
    }
  }
  return png(size, px);
}

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
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
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(out, `icon-${size}.png`), render(size));
  console.log(`icons/icon-${size}.png`);
}
