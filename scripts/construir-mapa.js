// Genera public/data/mexico-estados.json (trazos SVG ya proyectados y simplificados) a partir de
// Natural Earth 1:10m "admin 1 – states, provinces" (dominio público):
// https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_admin_1_states_provinces.geojson
// Uso: node scripts/construir-mapa.js ruta/ne_10m_admin_1_states_provinces.geojson
import fs from 'node:fs';

const ISO_A_CVE = {
  AGU: '01', BCN: '02', BCS: '03', CAM: '04', COA: '05', COL: '06', CHP: '07', CHH: '08', DIF: '09', CMX: '09',
  DUR: '10', GUA: '11', GRO: '12', HID: '13', JAL: '14', MEX: '15', MIC: '16', MOR: '17', NAY: '18', NLE: '19',
  OAX: '20', PUE: '21', QUE: '22', ROO: '23', SLP: '24', SIN: '25', SON: '26', TAB: '27', TAM: '28', TLA: '29',
  VER: '30', YUC: '31', ZAC: '32',
};
const ANCHO = 1000;
const TOLERANCIA = 0.6; // px
const AREA_MINIMA = 4; // px²: descarta islotes imperceptibles

const geo = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const estados = geo.features.filter((f) => f.properties.adm0_a3 === 'MEX' && ISO_A_CVE[f.properties.iso_3166_2?.slice(3)]);
if (estados.length !== 32) throw new Error(`Se esperaban 32 entidades y hay ${estados.length}`);

const poligonos = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
const puntos = estados.flatMap((f) => poligonos(f.geometry).flat(1).flat(1));
const rango = (i) => puntos.reduce(([mn, mx], p) => [Math.min(mn, p[i]), Math.max(mx, p[i])], [Infinity, -Infinity]);
const [[minLon, maxLon], [minLat, maxLat]] = [rango(0), rango(1)];
const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180); // equirectangular ajustada a la latitud media
const escala = ANCHO / ((maxLon - minLon) * k);
const alto = Math.ceil((maxLat - minLat) * escala);
const proyectar = ([x, y]) => [(x - minLon) * k * escala, (maxLat - y) * escala];

function douglasPeucker(pts, tol) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts.at(-1)];
  let max = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const d = dx || dy ? Math.abs(dy * px - dx * py + b[0] * a[1] - b[1] * a[0]) / Math.hypot(dx, dy) : Math.hypot(px - a[0], py - a[1]);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= tol) return [a, b];
  return [...douglasPeucker(pts.slice(0, idx + 1), tol).slice(0, -1), ...douglasPeucker(pts.slice(idx), tol)];
}
const area = (pts) => Math.abs(pts.reduce((s, [x, y], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; return s + x * y2 - x2 * y; }, 0)) / 2;
const r1 = (n) => Math.round(n * 10) / 10;

const salida = { ancho: ANCHO, alto, fuente: 'Natural Earth 1:10m (dominio público)', estados: {} };
for (const f of estados) {
  const anillos = poligonos(f.geometry)
    .flatMap((p) => p.map((anillo) => douglasPeucker(anillo.map(proyectar), TOLERANCIA)))
    .filter((a) => a.length >= 3)
    .sort((a, b) => area(b) - area(a));
  const visibles = anillos.filter((a, i) => i === 0 || area(a) >= AREA_MINIMA);
  salida.estados[ISO_A_CVE[f.properties.iso_3166_2.slice(3)]] = visibles
    .map((a) => `M${a.map(([x, y]) => `${r1(x)},${r1(y)}`).join('L')}Z`)
    .join('');
}
fs.writeFileSync(new URL('../public/data/mexico-estados.json', import.meta.url), JSON.stringify(salida));
console.log(`OK: 32 entidades, ${ANCHO}×${alto}`);
