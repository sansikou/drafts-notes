/**
 * 打包/启动前确保图标资源齐全。
 * 源文件优先 icon.png，其次 icon.jpg；都没有则从 icon.ico 导出（纯 Node，不启 Electron）。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const files = {
  ico: path.join(root, 'icon.ico'),
  png: path.join(root, 'icon.png'),
  jpg: path.join(root, 'icon.jpg'),
  tray: path.join(root, 'icon-tray.png'),
};

function exists(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).size > 0;
  } catch {
    return false;
  }
}

function runNode(script) {
  const r = spawnSync(process.execPath, [path.join(__dirname, script)], {
    cwd: root,
    stdio: 'inherit',
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

function main() {
  if (!exists(files.ico) && !exists(files.png) && !exists(files.jpg)) {
    console.error('[icons] 缺少 icon.ico / icon.png / icon.jpg，无法继续');
    process.exit(1);
  }

  const needExtract = !exists(files.png) || !exists(files.jpg) || !exists(files.tray);
  if (needExtract && exists(files.ico)) {
    console.log('[icons] 从 icon.ico 补全缺失的 png/jpg/tray…');
    runNode('extract-icons.js');
  }

  if (exists(files.png) && !exists(files.ico)) {
    console.log('[icons] 从源图生成 icon.ico…');
    runNode('generate-icon.js');
  }

  // 若仍缺 tray，但已有 png，直接再导出一次
  if (!exists(files.tray) && exists(files.png)) {
    runNode('extract-icons.js');
  }

  const missing = Object.entries(files)
    .filter(([, p]) => !exists(p))
    .map(([name]) => name);
  if (missing.length) {
    console.error('[icons] 仍缺失:', missing.join(', '));
    process.exit(1);
  }

  console.log('[icons] ok');
}

main();
