/**
 * 补全 icon.png / icon.jpg / icon-tray.png。
 * 优先从 icon.ico 内嵌 PNG 导出；若是旧式 BMP 图标则改用已有 png/jpg。
 * 纯 Node，不启动 Electron。
 */
const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

const root = path.join(__dirname, '..');
const icoPath = path.join(root, 'icon.ico');
const pngPath = path.join(root, 'icon.png');
const jpgPath = path.join(root, 'icon.jpg');
const trayPath = path.join(root, 'icon-tray.png');

function extractLargestPngFromIco(buf) {
  if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return null;
  const count = buf.readUInt16LE(4);
  let best = null;
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    if (entry + 16 > buf.length) break;
    const size = buf.readUInt32LE(entry + 8);
    const offset = buf.readUInt32LE(entry + 12);
    if (offset + size > buf.length) continue;
    const data = buf.subarray(offset, offset + size);
    const isPng = data.length > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
    if (isPng && (!best || data.length > best.length)) best = Buffer.from(data);
  }
  return best;
}

async function writeDerivatives(img) {
  const png256 = img.clone();
  png256.cover({ w: 256, h: 256 });
  await png256.write(pngPath);

  const jpg = img.clone();
  jpg.cover({ w: 256, h: 256 });
  await jpg.write(jpgPath);

  const tray = img.clone();
  tray.cover({ w: 32, h: 32 });
  await tray.write(trayPath);
}

async function main() {
  let img = null;

  if (fs.existsSync(icoPath)) {
    const pngBuf = extractLargestPngFromIco(fs.readFileSync(icoPath));
    if (pngBuf) img = await Jimp.read(pngBuf);
  }

  if (!img) {
    const fallback = [pngPath, jpgPath].find((p) => fs.existsSync(p) && fs.statSync(p).size > 0);
    if (!fallback) {
      throw new Error('无法从 icon.ico 导出 PNG，且没有可用的 icon.png / icon.jpg');
    }
    img = await Jimp.read(fallback);
  }

  await writeDerivatives(img);
  console.log('wrote icon.png / icon.jpg / icon-tray.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
