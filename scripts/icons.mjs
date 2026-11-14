// Render the app icons from the source images. Run: npm run icons
//   icons/icon.png     -> favicon.ico, pwa-*.png, apple-touch-icon (full bleed)
//   icons/maskable.png -> maskable icon (the S inside the 80 % safe circle)
// Both are made by icons/make-icon.html: an S in Rubik Moonrocks over a
// marbling from the app's demo.
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';

const ICON = 'icons/icon.png';
const MASKABLE = 'icons/maskable.png';

async function png(src, size) {
  return sharp(src).flatten({ background: '#ffffff' }).resize(size, size, { kernel: 'lanczos3' }).png({ palette: true, quality: 95, effort: 10 }).toBuffer();
}

/** ICO file with embedded PNG images */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e);
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4); // colour planes
    head.writeUInt16LE(32, e + 6); // bits per pixel
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...images.map(i => i.data)]);
}

const out = {
  'public/pwa-64x64.png': await png(ICON, 64),
  'public/pwa-192x192.png': await png(ICON, 192),
  'public/pwa-512x512.png': await png(ICON, 512),
  'public/apple-touch-icon-180x180.png': await png(ICON, 180),
  'public/maskable-icon-512x512.png': await png(MASKABLE, 512),
  'public/favicon.ico': ico([
    { size: 32, data: await png(ICON, 32) },
    { size: 48, data: await png(ICON, 48) },
  ]),
};
for (const [file, data] of Object.entries(out)) {
  await writeFile(file, data);
  console.log(file, data.length);
}
