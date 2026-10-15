import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';

const source = new URL('../web/', import.meta.url);
const target = new URL('../_site/', import.meta.url);
await rm(target, {recursive: true, force: true});
await mkdir(target, {recursive: true});
await cp(source, target, {recursive: true});
const index = new URL('index.html', target);
const html = await readFile(index, 'utf8');
await writeFile(index, html.replace('<head>', '<head>\n  <meta name="hosting-mode" content="static">').replace('<body>', '<body>\n<p role="note" style="margin:0;padding:12px 20px;background:#123d32;color:white;text-align:center">Versión de demostración: rutas y mapas disponibles. Los camiones y tiempos son simulados; el GPS compartido requiere un servidor.</p>'));
await writeFile(new URL('.nojekyll', target), '');
console.log('GitHub Pages: _site/ preparado, sin dependencias externas.');
