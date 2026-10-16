// Arma dist/, la carpeta que publica Netlify: el portal estático, fflate para el navegador y las
// cabeceras de seguridad en dist/_headers (las mismas que pone el servidor Express).
// Uso: npm run build
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CABECERAS, HSTS, rutaFflate } from '../src/app.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(RAIZ, 'dist');

const bloque = (ruta, cabeceras) => [ruta, ...Object.entries(cabeceras).map(([k, v]) => `  ${k}: ${v}`)].join('\n');

await rm(DIST, { recursive: true, force: true });
await cp(path.join(RAIZ, 'public'), DIST, { recursive: true });
await mkdir(path.join(DIST, 'vendor'), { recursive: true });
await cp(rutaFflate(), path.join(DIST, 'vendor', 'fflate.js'));
await writeFile(path.join(DIST, '_headers'), [
  bloque('/*', { ...CABECERAS, 'Strict-Transport-Security': HSTS }),
  bloque('/vendor/*', { 'Cache-Control': 'public, max-age=86400' }),
].join('\n\n') + '\n');
console.log(`Sitio listo en ${path.relative(RAIZ, DIST)}/`);
