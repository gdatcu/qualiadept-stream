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

// Stamp build version into <widget ... version="..."> (NOT <?xml version="1.0"?>!)
let configXml = fs.readFileSync(path.join(tizenDir, 'config.xml'), 'utf-8');
const version = process.env.VITE_APP_VERSION;
if (version && /^\d+\.\d+\.\d+$/.test(version)) {
  configXml = configXml.replace(/(<widget[\s\S]*?\bversion=")[^"]+(")/, `$1${version}$2`);
}
fs.writeFileSync(path.join(outDir, 'config.xml'), configXml, 'utf-8');
fs.copyFileSync(path.join(tizenDir, 'icon.png'), path.join(outDir, 'icon.png'));

// Remove web-only PWA files not used inside the Tizen .wgt package
for (const file of fs.readdirSync(outDir)) {
  if (
    file === '.htaccess' ||
    file === 'sw.js' ||
    file === 'registerSW.js' ||
    file === 'manifest.webmanifest' ||
    file.startsWith('workbox-')
  ) {
    fs.rmSync(path.join(outDir, file), { force: true });
  }
}

// Strip PWA service worker script & manifest links from index.html so Tizen logs zero 404s,
// and include Samsung's built-in $WEBAPIS/webapis/webapis.js for accurate Ethernet / Wi-Fi detection
const indexHtmlPath = path.join(outDir, 'index.html');
if (fs.existsSync(indexHtmlPath)) {
  let html = fs.readFileSync(indexHtmlPath, 'utf-8');
  html = html.replace(/<script[^>]*registerSW\.js[^>]*><\/script>\s*/g, '');
  html = html.replace(/<link[^>]*manifest\.webmanifest[^>]*>\s*/g, '');
  if (!html.includes('$WEBAPIS/webapis/webapis.js')) {
    html = html.replace(
      '</head>',
      '  <script src="$WEBAPIS/webapis/webapis.js"></script>\n  </head>'
    );
  }
  fs.writeFileSync(indexHtmlPath, html, 'utf-8');
}

console.log('Samsung Tizen TV app folder ready at: tizen-dist/');
