const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');
const www = path.join(root, 'www');

fs.mkdirSync(www, { recursive: true });
fs.copyFileSync(path.join(src, 'index.html'), path.join(www, 'index.html'));
fs.copyFileSync(path.join(src, 'styles.css'), path.join(www, 'styles.css'));

esbuild.buildSync({
  entryPoints: [path.join(src, 'renderer.js')],
  bundle: true,
  outfile: path.join(www, 'renderer.bundle.js'),
  format: 'iife',
  platform: 'browser',
  target: ['es2019'],
  minify: true,
  legalComments: 'none',
});

console.log('[build:web] www/ ready');
