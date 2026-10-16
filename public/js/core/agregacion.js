// Agregación de una tabla INEGI por unidad: entidad federativa (CNGE), institución (CNGF)
// o total federal, con desagregación opcional por una columna de catálogo.
import { normalizarClave } from './inegi.js';

export const COMPONENTES = ['total', 'hombres', 'mujeres'];
/** Códigos del INEGI en orden de prioridad cuando ningún registro trae un número. */
export const CODIGOS = ['NP', 'ND', 'NSS', 'NA'];
const INFORMATIVOS = ['NP', 'ND', 'NSS'];

/** Número, código del INEGI (NA, NSS, ND, NP) o null (vacío / NULL). */
export function leerValor(texto) {
  const s = (texto ?? '').trim();
  if (s === '' || s.toUpperCase() === 'NULL') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s.toUpperCase();
}

/**
 * Celda de resultado: { v: número|null, c: código|null, p: true si la suma omitió registros NSS/ND/NP }.
 * null significa que la fuente no tiene ese componente (p. ej. sin desagregación por sexo).
 */
class Acumulador {
  suma = 0;
  n = 0;
  codigos = new Set();
  agregar(texto) {
    const x = leerValor(texto);
    if (x === null) return;
    if (typeof x === 'number') {
      this.suma += x;
      this.n++;
    } else this.codigos.add(x);
  }
  celda() {
    if (this.n) return { v: this.suma, c: null, p: INFORMATIVOS.some((k) => this.codigos.has(k)) };
    return { v: null, c: CODIGOS.find((k) => this.codigos.has(k)) ?? null, p: false };
  }
}

const colador = new Intl.Collator('es', { numeric: true });

/**
 * @param tabla      descripción de la tabla (leerEstructura)
 * @param filas      CSV de datos ya parseado (con encabezado)
 * @param variables  variables de la tabla a calcular
 * @param catalogos  catálogos del paquete
 * @param desagregarPor  columna de dimensión o null
 * @returns {{variableId:string, filas:object[]}[]}
 */
export function agregarTabla(tabla, filas, variables, catalogos, desagregarPor = null) {
  const [enc = [], ...datos] = filas;
  const idx = new Map(enc.map((h, i) => [h.trim(), i])); // por nombre: el orden puede diferir del diccionario
  const indice = (col) => {
    const i = idx.get(col);
    if (i === undefined) throw new Error(`La tabla ${tabla.clave} no tiene la columna ${col}.`);
    return i;
  };
  const { tipo, columna } = tabla.unidad;
  const iUnidad = columna ? indice(columna) : -1;
  const iDim = desagregarPor ? indice(desagregarPor) : -1;
  const iNombre = idx.get('nombre1') ?? -1;
  const catUnidad = tipo === 'estado' ? catalogos.cve_ent : catalogos[columna];
  const catDim = desagregarPor ? catalogos[desagregarPor] : null;

  const columnas = [...new Set(variables.flatMap((v) => Object.values(v.columnas)))].map((c) => [c, indice(c)]);
  const grupos = new Map();
  for (const f of datos) {
    // Algunas tablas incluyen una fila "TOTAL" que duplicaría la suma (p. ej. CDMX en m1s5p28a).
    if (iNombre >= 0 && (f[iNombre] ?? '').trim().toUpperCase() === 'TOTAL') continue;
    const bruta = iUnidad >= 0 ? (f[iUnidad] ?? '').trim() : '';
    const clave = tipo === 'estado' ? bruta.padStart(2, '0') : tipo === 'institucion' ? bruta : 'FED';
    const catBruta = iDim >= 0 ? (f[iDim] ?? '').trim() : '';
    const k = `${clave}\u0000${catBruta}`;
    let g = grupos.get(k);
    if (!g) {
      const unidad = tipo === 'nacional' ? 'Total federal' : (catUnidad?.[normalizarClave(bruta)] ?? bruta);
      const categoria = iDim >= 0 ? (catDim?.[normalizarClave(catBruta)] ?? catBruta) : '';
      g = { clave, unidad, categoria, catBruta, registros: 0, acum: new Map(columnas.map(([c]) => [c, new Acumulador()])) };
      grupos.set(k, g);
    }
    g.registros++;
    for (const [c, i] of columnas) g.acum.get(c).agregar(f[i]);
  }

  const orden = [...grupos.values()].sort((a, b) => colador.compare(a.clave, b.clave) || colador.compare(a.catBruta, b.catBruta));
  return variables.map((v) => ({
    variableId: v.id,
    filas: orden.map((g) => {
      const celda = (comp) => (v.columnas[comp] ? g.acum.get(v.columnas[comp]).celda() : null);
      return {
        clave: g.clave,
        unidad: g.unidad,
        categoria: g.categoria,
        total: v.medida === 'registros' ? { v: g.registros, c: null, p: false } : celda('total'),
        hombres: celda('hombres'),
        mujeres: celda('mujeres'),
      };
    }),
  }));
}
