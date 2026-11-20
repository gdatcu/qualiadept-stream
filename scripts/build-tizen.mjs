import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const distDir = path.join(root, 'dist');
const tizenDir = path.join(root, 'tizen');
const outDir = path.join(root, 'tizen-dist');

if (!fs.existsSync(distDir)) {
  console.error('dist/ not found. Run "npm run build" first.');
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.cpSync(distDir, outDir, { recursive: true });
fs.copyFileSync(path.join(tizenDir, 'config.xml'), path.join(outDir, 'config.xml'));
fs.copyFileSync(path.join(tizenDir, 'icon.png'), path.join(outDir, 'icon.png'));

// Remove web-only files not needed inside the Tizen .wgt package
for (const file of ['.htaccess', 'sw.js', 'registerSW.js']) {
  const p = path.join(outDir, file);
  if (fs.existsSync(p)) fs.rmSync(p, { force: true });
}

console.log('Samsung Tizen TV app folder ready at: tizen-dist/');
