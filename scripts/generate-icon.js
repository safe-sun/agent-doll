const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "assets");
const PNG_PATH = path.join(OUT_DIR, "icon.png");
const ICO_PATH = path.join(OUT_DIR, "icon.ico");
const SVG_PATH = path.join(OUT_DIR, "icon.svg");

const ICON_SIZE = 1024;
const ICO_SIZES = [256, 128, 64, 48, 32, 16];
const PROGRESS = 0.67;

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function mixColor(a, b, t) {
  return [
    mix(a[0], b[0], t),
    mix(a[1], b[1], t),
    mix(a[2], b[2], t),
  ];
}

function over(pixel, color, alpha) {
  const sourceAlpha = clamp(alpha);

  if (sourceAlpha <= 0) {
    return;
  }

  const targetAlpha = pixel[3];
  const outAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);

  pixel[0] =
    (color[0] * sourceAlpha + pixel[0] * targetAlpha * (1 - sourceAlpha)) /
    outAlpha;
  pixel[1] =
    (color[1] * sourceAlpha + pixel[1] * targetAlpha * (1 - sourceAlpha)) /
    outAlpha;
  pixel[2] =
    (color[2] * sourceAlpha + pixel[2] * targetAlpha * (1 - sourceAlpha)) /
    outAlpha;
  pixel[3] = outAlpha;
}

function ringCoverage(radius, ringRadius, thickness, antialias) {
  const delta = Math.abs(radius - ringRadius);
  return 1 - smoothstep(thickness / 2 - antialias, thickness / 2 + antialias, delta);
}

function ellipseCoverage(x, y, cx, cy, rx, ry, antialias) {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return 1 - smoothstep(1 - antialias, 1 + antialias, distance);
}

function arcProgress(x, y) {
  return ((Math.atan2(y, x) * 180) / Math.PI + 90 + 360) % 360;
}

function renderIcon(size) {
  const data = Buffer.alloc(size * size * 4);
  const center = (size - 1) / 2;
  const sphereRadius = size * 0.36;
  const ringRadius = size * 0.19;
  const ringThickness = size * 0.046;
  const antialias = Math.max(1, size / 512);
  const progressAngle = 360 * PROGRESS;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = x - center;
      const ny = y - center;
      const radius = Math.sqrt(nx * nx + ny * ny);
      const sphere = 1 - smoothstep(sphereRadius - antialias, sphereRadius + antialias, radius);
      const pixel = [0, 0, 0, 0];

      const glowDistance = Math.abs(radius - sphereRadius);
      const outerGlow =
        radius > sphereRadius
          ? (1 - smoothstep(0, size * 0.075, glowDistance)) * 0.18
          : 0;
      over(pixel, [202, 255, 235], outerGlow);

      if (sphere > 0) {
        const depth = clamp((ny / sphereRadius + 1) / 2);
        const edge = smoothstep(sphereRadius * 0.58, sphereRadius, radius);
        const base = mixColor([232, 255, 250], [116, 206, 255], depth * 0.55);
        over(pixel, base, sphere * 0.24);
        over(pixel, [255, 255, 255], sphere * edge * 0.22);
        over(pixel, [20, 120, 145], sphere * edge * 0.13);

        const lowerShade = smoothstep(-sphereRadius * 0.05, sphereRadius * 0.85, ny);
        over(pixel, [22, 92, 120], sphere * lowerShade * 0.1);

        const highlightA = ellipseCoverage(
          x,
          y,
          center - sphereRadius * 0.28,
          center - sphereRadius * 0.34,
          sphereRadius * 0.36,
          sphereRadius * 0.14,
          0.08,
        );
        over(pixel, [255, 255, 255], sphere * highlightA * 0.44);

        const highlightB = ellipseCoverage(
          x,
          y,
          center + sphereRadius * 0.23,
          center + sphereRadius * 0.2,
          sphereRadius * 0.24,
          sphereRadius * 0.08,
          0.08,
        );
        over(pixel, [255, 255, 255], sphere * highlightB * 0.12);
      }

      const track = ringCoverage(radius, ringRadius, ringThickness, antialias);
      if (track > 0 && radius < sphereRadius * 0.86) {
        over(pixel, [18, 46, 56], track * 0.22);
      }

      const angle = arcProgress(nx, ny);
      const onArc = angle <= progressAngle ? 1 : 0;
      const arc = track * onArc;
      if (arc > 0 && radius < sphereRadius * 0.86) {
        const gradient = clamp(angle / progressAngle);
        const color = mixColor([0, 212, 90], [124, 255, 111], gradient);
        over(pixel, color, arc * 0.96);
        over(pixel, [255, 255, 255], arc * 0.12);
      }

      const i = (y * size + x) * 4;
      data[i] = Math.round(clamp(pixel[0], 0, 255));
      data[i + 1] = Math.round(clamp(pixel[1], 0, 255));
      data[i + 2] = Math.round(clamp(pixel[2], 0, 255));
      data[i + 3] = Math.round(clamp(pixel[3]) * 255);
    }
  }

  return data;
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;

  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry[0] = image.size >= 256 ? 0 : image.size;
    entry[1] = image.size >= 256 ? 0 : image.size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += image.png.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

function writeSvg() {
  const progress = 2 * Math.PI * 98 * PROGRESS;
  const remaining = 2 * Math.PI * 98 - progress;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="glass" cx="34%" cy="28%" r="70%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity=".74"/>
      <stop offset="42%" stop-color="#d7fff7" stop-opacity=".22"/>
      <stop offset="100%" stop-color="#4ca6d6" stop-opacity=".38"/>
    </radialGradient>
    <linearGradient id="ring" x1="164" y1="120" x2="348" y2="360" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#00d45a"/>
      <stop offset="100%" stop-color="#7cff6f"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="9" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <circle cx="256" cy="256" r="184" fill="#cbfff0" opacity=".16" filter="url(#glow)"/>
  <circle cx="256" cy="256" r="184" fill="url(#glass)" stroke="#ffffff" stroke-opacity=".62" stroke-width="5"/>
  <ellipse cx="201" cy="166" rx="69" ry="27" fill="#ffffff" opacity=".52" transform="rotate(-24 201 166)"/>
  <ellipse cx="304" cy="297" rx="44" ry="16" fill="#ffffff" opacity=".13" transform="rotate(-24 304 297)"/>
  <circle cx="256" cy="256" r="98" fill="none" stroke="#102e38" stroke-opacity=".22" stroke-width="30"/>
  <circle cx="256" cy="256" r="98" fill="none" stroke="url(#ring)" stroke-width="30" stroke-linecap="butt" transform="rotate(-90 256 256)" stroke-dasharray="${progress.toFixed(2)} ${remaining.toFixed(2)}"/>
</svg>
`;
  fs.writeFileSync(SVG_PATH, svg);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
writeSvg();

const png = encodePng(ICON_SIZE, ICON_SIZE, renderIcon(ICON_SIZE));
fs.writeFileSync(PNG_PATH, png);

const icoImages = ICO_SIZES.map((size) => ({
  size,
  png: encodePng(size, size, renderIcon(size)),
}));
fs.writeFileSync(ICO_PATH, encodeIco(icoImages));

console.log(`Wrote ${path.relative(ROOT, PNG_PATH)}`);
console.log(`Wrote ${path.relative(ROOT, ICO_PATH)}`);
console.log(`Wrote ${path.relative(ROOT, SVG_PATH)}`);
