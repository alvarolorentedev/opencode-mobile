const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const assetsDir = path.join(__dirname, '..', 'assets', 'images');

const colors = {
  background: [31, 29, 28, 255],
  white: [255, 255, 255, 255],
  lightGray: [214, 214, 218, 255],
  darkGray: [53, 53, 56, 255],
  transparent: [0, 0, 0, 0],
};

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function writePng(filePath, width, height, pixelFn) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixelOffset = rowOffset + 1 + x * 4;
      const [r, g, b, a] = pixelFn(x, y);
      raw[pixelOffset] = r;
      raw[pixelOffset + 1] = g;
      raw[pixelOffset + 2] = b;
      raw[pixelOffset + 3] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);

  fs.writeFileSync(filePath, png);
}

function withinBox(x, y, box) {
  return x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
}

function buildLogoBoxes(size, padding) {
  const unit = Math.floor((size - padding * 2) / 14);
  const logoWidth = unit * 14;
  const logoHeight = unit * 14;
  const offsetX = Math.floor((size - logoWidth) / 2);
  const offsetY = Math.floor((size - logoHeight) / 2);
  const box = (x, y, w, h, color) => ({
    x: offsetX + x * unit,
    y: offsetY + y * unit,
    w: w * unit,
    h: h * unit,
    color,
  });

  return {
    white: [
      box(1, 1, 2, 10, colors.white),
      box(11, 1, 2, 10, colors.white),
      box(3, 2, 1, 1, colors.white),
      box(10, 2, 1, 1, colors.white),
      box(4, 3, 1, 1, colors.white),
      box(9, 3, 1, 1, colors.white),
      box(4, 4, 1, 2, colors.white),
      box(9, 4, 1, 2, colors.white),
      box(5, 5, 1, 2, colors.white),
      box(8, 5, 1, 2, colors.white),
      box(6, 6, 2, 1, colors.white),
      box(6, 7, 1, 1, colors.white),
      box(7, 7, 1, 2, colors.white),
      box(6, 8, 1, 1, colors.white),
      box(3, 5, 1, 2, colors.white),
      box(10, 5, 1, 2, colors.white),
    ],
    lightGray: [
      box(1, 6, 2, 5, colors.lightGray),
      box(11, 6, 2, 5, colors.lightGray),
      box(3, 6, 1, 1, colors.lightGray),
      box(10, 6, 1, 1, colors.lightGray),
    ],
    darkGray: [box(4, 9, 6, 2, colors.darkGray)],
  };
}

function logoPixel(size, padding, background, monochrome) {
  const boxes = buildLogoBoxes(size, padding);
  const layers = monochrome
    ? [...boxes.white, ...boxes.lightGray, ...boxes.darkGray].map((item) => ({ ...item, color: colors.white }))
    : [...boxes.lightGray, ...boxes.darkGray, ...boxes.white];

  return (x, y) => {
    for (let i = layers.length - 1; i >= 0; i -= 1) {
      const item = layers[i];
      if (withinBox(x, y, item)) {
        return item.color;
      }
    }
    return background;
  };
}

function solidPixel(color) {
  return () => color;
}

writePng(path.join(assetsDir, 'icon.png'), 1024, 1024, logoPixel(1024, 96, colors.background, false));
writePng(path.join(assetsDir, 'android-icon-foreground.png'), 432, 432, logoPixel(432, 64, colors.transparent, false));
writePng(path.join(assetsDir, 'android-icon-background.png'), 432, 432, solidPixel(colors.background));
writePng(path.join(assetsDir, 'android-icon-monochrome.png'), 432, 432, logoPixel(432, 64, colors.transparent, true));
writePng(path.join(assetsDir, 'favicon.png'), 256, 256, logoPixel(256, 24, colors.background, false));
