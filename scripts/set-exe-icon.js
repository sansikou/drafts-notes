/**
 * 打包后强制把 icon.ico 写入 Drafts.exe，并刷新开始菜单快捷方式图标。
 * electron-builder 的 signAndEditExecutable 在本机经常静默跳过，故单独补这一步。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const ico = path.join(root, 'icon.ico');
const exe = path.join(root, 'release', 'win-unpacked', 'Drafts.exe');
const unpackedIco = path.join(root, 'release', 'win-unpacked', 'icon.ico');

function findRcedit() {
  const cacheRoot = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign');
  if (fs.existsSync(cacheRoot)) {
    const dirs = fs
      .readdirSync(cacheRoot)
      .map((name) => ({ name, full: path.join(cacheRoot, name) }))
      .filter((d) => {
        try {
          return fs.statSync(d.full).isDirectory();
        } catch {
          return false;
        }
      })
      .sort((a, b) => fs.statSync(b.full).mtimeMs - fs.statSync(a.full).mtimeMs);

    for (const d of dirs) {
      const candidate = path.join(d.full, 'rcedit-x64.exe');
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  try {
    const rceditPkg = require.resolve('rcedit/package.json');
    const bin = path.join(path.dirname(rceditPkg), 'bin', process.arch === 'ia32' ? 'rcedit.exe' : 'rcedit.exe');
    if (fs.existsSync(bin)) return bin;
    const x64 = path.join(path.dirname(rceditPkg), 'bin', 'rcedit-x64.exe');
    if (fs.existsSync(x64)) return x64;
  } catch {
    /* optional */
  }

  return null;
}

function updateStartMenuShortcut() {
  const lnk = path.join(
    process.env.APPDATA || '',
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Drafts.lnk'
  );
  if (!fs.existsSync(lnk)) {
    console.log('[icon] Start Menu shortcut not found, skip:', lnk);
    return;
  }

  const ps1 = path.join(os.tmpdir(), `drafts-set-icon-${Date.now()}.ps1`);
  const script = `
$ErrorActionPreference = 'Stop'
$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${JSON.stringify(lnk)})
$s.TargetPath = ${JSON.stringify(exe)}
$s.WorkingDirectory = ${JSON.stringify(path.dirname(exe))}
$s.IconLocation = ${JSON.stringify(`${unpackedIco},0`)}
$s.Save()
Write-Output $s.IconLocation
`;
  fs.writeFileSync(ps1, script, 'utf8');
  try {
    const result = spawnSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1],
      { encoding: 'utf8' }
    );
    if (result.status !== 0) {
      console.error('[icon] shortcut update failed:', result.stderr || result.stdout);
      return;
    }
    console.log('[icon] Start Menu shortcut ->', (result.stdout || '').trim());
  } finally {
    try {
      fs.unlinkSync(ps1);
    } catch {
      /* ignore */
    }
  }
}

function main() {
  if (!fs.existsSync(ico)) {
    console.error('[icon] missing icon.ico');
    process.exit(1);
  }
  if (!fs.existsSync(exe)) {
    console.error('[icon] missing Drafts.exe — run pack first');
    process.exit(1);
  }

  fs.copyFileSync(ico, unpackedIco);
  console.log('[icon] copied icon.ico -> release/win-unpacked/');

  const rcedit = findRcedit();
  if (!rcedit) {
    console.error('[icon] rcedit not found. Run electron-builder once to populate cache, or npm i -D rcedit');
    process.exit(1);
  }

  console.log('[icon] using', rcedit);
  const result = spawnSync(rcedit, [exe, '--set-icon', ico], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error('[icon] rcedit failed with status', result.status);
    process.exit(result.status || 1);
  }
  console.log('[icon] embedded into Drafts.exe');

  updateStartMenuShortcut();
  console.log('[icon] done');
}

main();
