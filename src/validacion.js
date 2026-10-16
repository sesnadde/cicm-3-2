// Validación estricta (lista blanca) de las series que un administrador envía para guardar.

export class ErrorValidacion extends Error {}

const TIPOS = ['variable', 'indicador', 'manual'];
const NIVELES = ['Estatal', 'Federal', 'Mixto'];
const CODIGOS = ['NA', 'NSS', 'ND', 'NP'];
export const MAX_SERIES = 50;
export const MAX_FILAS = 100_000;

const falla = (msg) => { throw new ErrorValidacion(msg); };

function texto(v, campo, max, { opcional = false } = {}) {
  if (v == null || v === '') return opcional ? null : falla(`Falta ${campo}.`);
  if (typeof v !== 'string' || v.length > max) falla(`${campo} no es válido (texto de hasta ${max} caracteres).`);
  return v.trim();
}

const opcion = (v, campo, opciones) => (opciones.includes(v) ? v : falla(`${campo} debe ser uno de: ${opciones.join(', ')}.`));

function celda(c, donde) {
  if (c === null || c === undefined) return null;
  if (typeof c !== 'object' || Array.isArray(c)) falla(`Celda no válida en ${donde}.`);
  const v = c.v ?? null;
  if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) falla(`Valor no numérico en ${donde}.`);
  const codigo = c.c ?? null;
  if (codigo !== null && !CODIGOS.includes(codigo)) falla(`Código no válido en ${donde}.`);
  return { v, c: codigo, p: c.p === true };
}

export function validarSeries(cuerpo) {
  const series = cuerpo?.series;
  if (!Array.isArray(series) || !series.length) falla('Envía al menos una serie.');
  if (series.length > MAX_SERIES) falla(`Se pueden guardar hasta ${MAX_SERIES} series a la vez.`);
  let total = 0;
  const vistas = new Set();
  return series.map((s, i) => {
    const donde = `la serie ${i + 1}`;
    if (!Array.isArray(s?.filas) || !s.filas.length) falla(`${donde} no tiene filas.`);
    total += s.filas.length;
    if (total > MAX_FILAS) falla(`El envío excede ${MAX_FILAS} filas.`);
    const anio = s.anio ?? null;
    if (anio !== null && !(Number.isInteger(anio) && anio >= 1900 && anio <= 2100)) falla(`Año no válido en ${donde}.`);
    const limpia = {
      tipo: opcion(s.tipo, 'tipo', TIPOS),
      nombre: texto(s.nombre, 'nombre', 500),
      nivel: opcion(s.nivel, 'nivel', NIVELES),
      anio,
      periodo: texto(s.periodo, 'periodo', 50, { opcional: true }),
      fuente: texto(s.fuente, 'fuente', 1000, { opcional: true }),
      formula: texto(s.formula, 'fórmula', 500, { opcional: true }),
      desagregacion: texto(s.desagregacion, 'desagregación', 300, { opcional: true }),
      filas: s.filas.map((f, j) => {
        const lugar = `${donde}, fila ${j + 1}`;
        if (typeof f !== 'object' || f === null) falla(`Fila no válida en ${lugar}.`);
        return {
          clave: texto(String(f.clave ?? ''), `clave (${lugar})`, 100),
          unidad: texto(f.unidad, `unidad (${lugar})`, 500),
          categoria: texto(f.categoria, `categoría (${lugar})`, 500, { opcional: true }) ?? '',
          total: celda(f.total, lugar),
          hombres: celda(f.hombres, lugar),
          mujeres: celda(f.mujeres, lugar),
        };
      }),
    };
    const llave = JSON.stringify([limpia.nombre, limpia.nivel, limpia.anio, limpia.desagregacion]);
    if (vistas.has(llave)) falla(`Hay dos series con el mismo nombre, nivel, año y desagregación («${limpia.nombre}»).`);
    vistas.add(llave);
    return limpia;
  });
}
