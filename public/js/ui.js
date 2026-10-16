// Utilidades de interfaz. Todo el texto se inserta como nodos de texto (nunca innerHTML con datos).

export const $ = (selector, raiz = document) => raiz.querySelector(selector);

/** Crea un elemento: el('button', { class: 'x', onclick }, 'texto', hijo…) */
export function el(etiqueta, atributos = {}, ...hijos) {
  const n = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(atributos)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const h of hijos.flat()) if (h != null && h !== false) n.append(h instanceof Node ? h : String(h));
  return n;
}

const formato = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });
export const numero = (v) => formato.format(v);

const DESCRIPCION_CODIGOS = {
  NA: 'No aplica', NSS: 'No cuenta con elementos para responder', ND: 'Información no disponible', NP: 'No publicable',
};

/** Celda de valores para la tabla: número, código del INEGI o guion. */
export function celdaValor(celda) {
  const td = el('td', { class: 'num' });
  if (celda == null) {
    td.append(el('span', { class: 'codigo', title: 'La fuente no trae este dato' }, '—'));
  } else if (celda.v != null) {
    td.append(numero(celda.v));
    if (celda.p) td.append(el('span', { class: 'parcial', title: 'Suma parcial: se omitieron registros NSS/ND/NP' }, '*'));
  } else {
    td.append(el('span', { class: 'codigo', title: DESCRIPCION_CODIGOS[celda.c] ?? 'Sin valor' }, celda.c ?? '—'));
  }
  return td;
}

export function aviso(texto, tipo = '') {
  const n = el('div', { class: `aviso ${tipo}` }, texto);
  $('#avisos').append(n);
  setTimeout(() => n.remove(), tipo === 'error' ? 9000 : 5000);
}

export function descargar(nombre, contenido, tipo) {
  const url = URL.createObjectURL(contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo }));
  const a = el('a', { href: url, download: nombre });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const fechaArchivo = () => new Date().toISOString().slice(0, 10);

/** Texto comparable sin acentos ni mayúsculas (búsquedas). */
export const normalizar = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const tooltip = () => $('#tooltip');
export function mostrarTooltip(texto, x, y) {
  const t = tooltip();
  t.textContent = texto;
  t.hidden = false;
  const { width, height } = t.getBoundingClientRect();
  t.style.left = `${Math.min(x + 14, innerWidth - width - 8)}px`;
  t.style.top = `${Math.max(8, y - height - 12)}px`;
}
export const ocultarTooltip = () => { tooltip().hidden = true; };
