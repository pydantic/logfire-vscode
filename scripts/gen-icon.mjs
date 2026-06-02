// Generate the extension icon (assets/icon.png) as a real PNG: the Pydantic
// mark rendered in white on the Logfire brand gradient, matching the app icon
// style.
//
// Usage: node scripts/gen-icon.mjs
// The source mark is the vendored Pydantic logo (assets/pydantic.svg).
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../assets/pydantic.svg');
const OUT = resolve(here, '../assets/icon.png');

const SIZE = 256;
const PAD = 54; // padding around the mark
const VIEWBOX = 120; // pydantic.svg viewBox is 0 0 120 120
const scale = (SIZE - 2 * PAD) / VIEWBOX;

// Inner markup of pydantic.svg, recolored white (it uses fill="currentColor").
const mark = readFileSync(SRC, 'utf8')
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/currentColor/g, '#ffffff');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="${SIZE}" y2="${SIZE}" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FF3D71"/>
      <stop offset="1" stop-color="#A312E0"/>
    </linearGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" rx="56" fill="url(#bg)"/>
  <g transform="translate(${PAD},${PAD}) scale(${scale})">${mark}</g>
</svg>`;

const png = new Resvg(svg, { fitTo: { mode: 'width', value: SIZE } }).render().asPng();
writeFileSync(OUT, png);
console.log(`wrote ${OUT} (${png.length} bytes)`);
