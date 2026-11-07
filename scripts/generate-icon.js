/** 从 icon.png / icon.jpg 生成 icon.ico 与 tray 图（打包前运行：node scripts/generate-icon.js） */
const fs = require('fs');
const path = require('path');
const pngToIco = require('png-to-ico').default || require('png-to-ico');
const { Jimp } = require('jimp');

async function main() {
  const root = path.join(__dirname, '..');
  const pngPath = path.join(root, 'icon.png');
  const jpgPath = path.join(root, 'icon.jpg');
  const source = fs.existsSync(pngPath) ? pngPath : jpgPath;
  if (!fs.existsSync(source)) {
    throw new Error('需要 icon.png 或 icon.jpg 作为图标源');
  }

  const img = await Jimp.read(source);
  const sizes = [16, 32, 48, 64, 128, 256];
  const bufs = await Promise.all(
    sizes.map(async (s) => {
      const clone = img.clone();
      clone.cover({ w: s, h: s });
      return clone.getBuffer('image/png');
    })
  );

  const icoOut = path.join(root, 'icon.ico');
  fs.writeFileSync(icoOut, await pngToIco(bufs));

  const png256 = img.clone();
  png256.cover({ w: 256, h: 256 });
  await png256.write(pngPath);

  const jpg256 = img.clone();
  jpg256.cover({ w: 256, h: 256 });
  await jpg256.write(jpgPath);

  const tray = img.clone();
  tray.cover({ w: 32, h: 32 });
  await tray.write(path.join(root, 'icon-tray.png'));

  console.log('Generated icon.ico / icon.png / icon.jpg / icon-tray.png from', path.basename(source));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
