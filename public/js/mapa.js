// Mapa coroplético por entidad federativa: un solo tono (carmesí institucional) de claro a
// oscuro, clases por quintiles y gris para "sin dato". Todo el estilo va como atributos SVG
// para que la descarga (SVG/PNG) se vea igual que en pantalla.
import { ENTIDADES } from './core/entidades.js';
import { mostrarTooltip, ocultarTooltip, numero } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const RAMPA = ['#f6d5df', '#eb9bb3', '#dc5a82', '#c81045', '#6e1739'];
const SIN_DATO = '#d9dadc';
const TINTA = '#191b1f';
const TENUE = '#5c5f64';
const FUENTE = 'Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif';
const MARGEN_SUP = 78;
const MARGEN_INF = 40;

let geometria;
const cargarGeometria = async () => (geometria ??= await (await fetch('data/mexico-estados.json')).json());

const nodo = (etiqueta, atributos = {}, texto) => {
  const n = document.createElementNS(NS, etiqueta);
  for (const [k, v] of Object.entries(atributos)) n.setAttribute(k, v);
  if (texto != null) n.textContent = texto;
  return n;
};

/** Clases por cuantiles: devuelve { clase(v), rangos: [[min, max], …] }. */
export function clasificar(valores, k = RAMPA.length) {
  const orden = [...valores].sort((a, b) => a - b);
  const limites = [...new Set(Array.from({ length: k - 1 }, (_, i) => orden[Math.floor(((i + 1) * orden.length) / k)]))]
    .filter((l) => l > orden[0]);
  const clase = (v) => limites.filter((l) => v >= l).length;
  const rangos = Array.from({ length: limites.length + 1 }, () => [Infinity, -Infinity]);
  for (const v of orden) {
    const r = rangos[clase(v)];
    r[0] = Math.min(r[0], v);
    r[1] = Math.max(r[1], v);
  }
  return { clase, rangos };
}

const colorDeClase = (i, n) => (n === 1 ? RAMPA[3] : RAMPA[Math.round((i * (RAMPA.length - 1)) / (n - 1))]);

/**
 * Dibuja el mapa en el contenedor y devuelve el elemento <svg>.
 * @param valores Map(cve_ent → celda {v, c})
 */
export async function dibujarMapa(contenedor, { titulo, subtitulo, fuente, valores }) {
  const geo = await cargarGeometria();
  const alto = geo.alto + MARGEN_SUP + MARGEN_INF;
  const svg = nodo('svg', {
    xmlns: NS, viewBox: `0 0 ${geo.ancho} ${alto}`, width: geo.ancho, height: alto,
    'font-family': FUENTE, role: 'img', 'aria-label': `Mapa de ${titulo}`,
  });
  svg.append(nodo('rect', { width: geo.ancho, height: alto, fill: '#ffffff' }));
  svg.append(nodo('text', { x: 16, y: 30, 'font-size': 22, fill: TINTA }, titulo.length > 95 ? `${titulo.slice(0, 94)}…` : titulo));
  svg.append(nodo('text', { x: 16, y: 56, 'font-size': 15, fill: TENUE }, subtitulo));

  const numeros = [...valores.values()].filter((c) => c?.v != null).map((c) => c.v);
  const { clase, rangos } = numeros.length ? clasificar(numeros) : { clase: () => 0, rangos: [] };
  const mapa = nodo('g', { transform: `translate(0 ${MARGEN_SUP})` });
  for (const [clave, d] of Object.entries(geo.estados)) {
    const celda = valores.get(clave);
    const texto = celda?.v != null ? numero(celda.v) + (celda.p ? ' (suma parcial)' : '') : (celda?.c ?? 'Sin dato');
    const path = nodo('path', {
      d, class: 'estado', fill: celda?.v != null ? colorDeClase(clase(celda.v), rangos.length) : SIN_DATO,
      stroke: '#ffffff', 'stroke-width': 0.8, tabindex: 0, 'aria-label': `${ENTIDADES[clave]}: ${texto}`,
    });
    path.addEventListener('pointermove', (e) => mostrarTooltip(`${ENTIDADES[clave]}: ${texto}`, e.clientX, e.clientY));
    path.addEventListener('pointerleave', ocultarTooltip);
    path.addEventListener('focus', () => { const r = path.getBoundingClientRect(); mostrarTooltip(`${ENTIDADES[clave]}: ${texto}`, r.right, r.top + r.height / 2); });
    path.addEventListener('blur', ocultarTooltip);
    mapa.append(path);
  }
  svg.append(mapa);

  // Leyenda en el océano Pacífico (esquina inferior izquierda), donde no hay territorio.
  const leyenda = nodo('g', { transform: `translate(24 ${MARGEN_SUP + geo.alto - 30 - (rangos.length + 1) * 26})` });
  const filas = [...rangos.map(([a, b], i) => [colorDeClase(i, rangos.length), a === b ? numero(a) : `${numero(a)} – ${numero(b)}`]), [SIN_DATO, 'Sin dato']];
  filas.forEach(([color, etiqueta], i) => {
    leyenda.append(nodo('rect', { x: 0, y: i * 26, width: 22, height: 18, rx: 3, fill: color }));
    leyenda.append(nodo('text', { x: 32, y: i * 26 + 14, 'font-size': 14, fill: TINTA }, etiqueta));
  });
  svg.append(leyenda);
  svg.append(nodo('text', { x: 16, y: alto - 14, 'font-size': 12, fill: TENUE }, `Fuente: ${fuente}`.slice(0, 160)));

  contenedor.replaceChildren(svg);
  return svg;
}

export const svgComoTexto = (svg) => new XMLSerializer().serializeToString(svg);

export function svgComoPng(svg, escala = 2) {
  return new Promise((resolver, rechazar) => {
    const url = URL.createObjectURL(new Blob([svgComoTexto(svg)], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      const lienzo = document.createElement('canvas');
      lienzo.width = svg.viewBox.baseVal.width * escala;
      lienzo.height = svg.viewBox.baseVal.height * escala;
      lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
      URL.revokeObjectURL(url);
      lienzo.toBlob((b) => (b ? resolver(b) : rechazar(new Error('No se pudo generar la imagen.'))), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); rechazar(new Error('No se pudo generar la imagen.')); };
    img.src = url;
  });
}
