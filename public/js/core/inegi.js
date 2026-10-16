// Lectura de la estructura de un paquete de datos abiertos del INEGI (censos de gobierno).
// Los patrones en que se basa están documentados en docs/analisis-inegi.md.
import { parseCsv } from './csv.js';

export class ErrorPaquete extends Error {}

const RE_INDICE = /(^|\/)conjunto_de_datos\/0_indice_([a-z]+)(\d{4})\.csv$/i;
const RE_SUFIJO = /_[a-z]+\d{4}\.csv$/i;
const ROLES = { Total: 'total', Subtotal: 'total', Hombres: 'hombres', Mujeres: 'mujeres' };

/** Convierte filas CSV (con encabezado) en objetos. */
export function comoObjetos(filas) {
  const [enc = [], ...resto] = filas;
  const claves = enc.map((c) => c.trim());
  return resto.map((f) => Object.fromEntries(claves.map((c, i) => [c, (f[i] ?? '').trim()])));
}

/** Columnas con conteos (0-999999999999999) o marcas (1) admiten suma. */
const esMarca = (codigo) => /^1\s*,/.test(codigo);
const esSumable = (codigo) => codigo.startsWith('0-999999999999999') || esMarca(codigo);

/**
 * Quita el periodo: "Personal adscrito …, según sexo, al cierre del año 2024." → "Personal adscrito …, según sexo".
 * Se conserva "según …" porque distingue tablas con el mismo sujeto (m1s1p8 vs m1s1p9).
 */
export function tituloCorto(contenido) {
  const corte = contenido.search(/,\s+(al cierre|durante)\b/i);
  return (corte > 0 ? contenido.slice(0, corte) : contenido).replace(/\.\s*$/, '').trim();
}

/**
 * Agrupa las columnas sumables de una tabla en variables con total, hombres y mujeres,
 * a partir de la DESCRIPCION del diccionario ("X - Hombres", "X - Subtotal", "Total - Mujeres"…).
 */
export function construirVariables(tabla, titulo, columnas) {
  const grupos = new Map();
  for (const c of columnas.filter((x) => esSumable(x.codigo))) {
    const partes = c.descripcion.split(' - ').map((s) => s.trim());
    // En las marcas (0/1) "Mujeres" es una categoría (p. ej. "Grupo vulnerable - Mujeres"), no un sexo.
    const rolFinal = esMarca(c.codigo) ? undefined : ROLES[partes.at(-1)];
    const base = rolFinal ? partes.slice(0, -1) : partes;
    const rol = rolFinal ?? 'total';
    while (base.at(-1) === 'Total') base.pop(); // "X - Total - Hombres" pertenece a X
    let clave = base.join(' - ');
    if (grupos.get(clave)?.columnas[rol]) clave = `${c.descripcion} (${c.columna})`; // colisión: variable propia
    const g = grupos.get(clave) ?? { columnas: {}, marca: false };
    g.columnas[rol] = c.columna;
    g.marca ||= esMarca(c.codigo);
    grupos.set(clave, g);
  }
  const variables = [...grupos].map(([base, g]) => {
    const etiqueta = (base || 'Total') + (g.marca ? ' (registros marcados)' : '');
    const primera = g.columnas.total ?? g.columnas.hombres ?? g.columnas.mujeres;
    return { id: `${tabla}:${primera}`, tabla, etiqueta, nombre: `${titulo} – ${etiqueta}`, medida: 'suma', columnas: g.columnas };
  });
  variables.push({ id: `${tabla}:#registros`, tabla, etiqueta: 'Número de registros', nombre: `${titulo} – Número de registros`, medida: 'registros', columnas: {} });
  return variables;
}

function leerCatalogo(filas, nombre) {
  const [enc = []] = filas;
  const h = enc.map((c) => c.trim());
  const iClave = Math.max(0, h.indexOf(nombre));
  let iDesc = h.indexOf('descrip');
  if (iDesc < 0) iDesc = h.indexOf('nom_ent');
  if (iDesc < 0) iDesc = h.length - 1;
  const mapa = {};
  for (const f of filas.slice(1)) mapa[normalizarClave(f[iClave])] = (f[iDesc] ?? '').trim();
  return mapa;
}

/** Claves de catálogo comparables: "01" y "1" son la misma clave. */
export const normalizarClave = (v) => {
  const s = String(v ?? '').trim();
  return /^\d+$/.test(s) ? String(Number(s)) : s;
};

function leerMetadatos(texto) {
  const campo = (nombre) => texto?.match(new RegExp(`^${nombre}:\\s*(.+)$`, 'mi'))?.[1].trim() ?? null;
  return { identificador: campo('Identifier'), titulo: campo('Title') };
}

function describirTabla({ clave, contenido, rutaDatos, columnas, catalogos }) {
  const nombres = new Set(columnas.map((c) => c.columna));
  const colInst = columnas.find((c) => c.columna.startsWith('instadmi_') && catalogos[c.columna]);
  const unidad = nombres.has('cve_ent')
    ? { tipo: 'estado', columna: 'cve_ent' }
    : colInst ? { tipo: 'institucion', columna: colInst.columna } : { tipo: 'nacional', columna: null };
  const dimensiones = columnas
    .filter((c) => !['cve_ent', 'cvegeo', unidad.columna].includes(c.columna))
    .filter((c) => catalogos[c.columna] || c.columna === 'nombre1')
    .map((c) => ({ columna: c.columna, etiqueta: c.descripcion || c.columna }));
  const titulo = tituloCorto(contenido || clave);
  return {
    clave,
    contenido,
    titulo,
    periodo: (contenido.match(/\b(?:19|20)\d{2}\b/g) ?? []).pop() ?? null,
    nivel: unidad.tipo === 'estado' ? 'Estatal' : 'Federal',
    unidad,
    dimensiones,
    variables: construirVariables(clave, titulo, columnas),
    rutaDatos,
  };
}

/**
 * Lee índice, diccionarios, catálogos y metadatos (no los datos).
 * @param {string[]} rutas  rutas dentro del ZIP
 * @param {(rutas:string[]) => Record<string,string>} leerVarias  devuelve el texto de varias rutas
 */
export function leerEstructura(rutas, leerVarias) {
  const indice = rutas.find((r) => RE_INDICE.test(r));
  if (!indice) {
    throw new ErrorPaquete('El ZIP no tiene la estructura de datos abiertos del INEGI (falta conjunto_de_datos/0_indice_*.csv).');
  }
  const m = indice.match(RE_INDICE);
  const raiz = indice.slice(0, m.index + m[1].length);
  const censo = m[2].toLowerCase();
  const anio = Number(m[3]);
  const sufijo = `_${censo}${anio}.csv`;
  const porMinusculas = new Map(rutas.map((r) => [r.toLowerCase(), r]));
  const real = (ruta) => porMinusculas.get(ruta.toLowerCase());
  const enCarpeta = (carpeta, ext) =>
    rutas.filter((r) => r.toLowerCase().startsWith(`${raiz}${carpeta}/`.toLowerCase()) && r.toLowerCase().endsWith(ext));

  const rutasCatalogos = enCarpeta('catalogos', '.csv');
  const rutaMeta = enCarpeta('metadatos', '.txt')[0];
  const base = leerVarias([indice, ...rutasCatalogos, ...(rutaMeta ? [rutaMeta] : [])]);

  const catalogos = {};
  for (const ruta of rutasCatalogos) {
    const nombre = ruta.split('/').pop().replace(RE_SUFIJO, '');
    catalogos[nombre] = leerCatalogo(parseCsv(base[ruta]), nombre);
  }

  const advertencias = [];
  const pendientes = [];
  for (const { ARCHIVO: clave, CONTENIDO: contenido = '' } of comoObjetos(parseCsv(base[indice]))) {
    if (!clave) continue;
    const rutaDatos = real(`${raiz}conjunto_de_datos/${clave}${sufijo}`);
    const rutaDicc = real(`${raiz}diccionario_de_datos/diccionario_de_datos_${clave}${sufijo}`);
    if (!rutaDatos || !rutaDicc) {
      advertencias.push(`La tabla ${clave} aparece en el índice pero falta su archivo de datos o su diccionario; se omitió.`);
      continue;
    }
    pendientes.push({ clave, contenido, rutaDatos, rutaDicc });
  }
  const diccionarios = leerVarias(pendientes.map((p) => p.rutaDicc));

  const tablas = [];
  for (const p of pendientes) {
    const columnas = comoObjetos(parseCsv(diccionarios[p.rutaDicc])).map((r) => ({
      columna: r.COLUMNA,
      descripcion: r.DESCRIPCION ?? '',
      codigo: r.CODIGO_VALIDO ?? '',
    }));
    if (!columnas.length || !columnas[0].columna) {
      advertencias.push(`El diccionario de ${p.clave} no tiene el formato esperado (COLUMNA, DESCRIPCION, CODIGO_VALIDO); se omitió.`);
      continue;
    }
    tablas.push(describirTabla({ ...p, columnas, catalogos }));
  }
  if (!tablas.length) throw new ErrorPaquete('El paquete no contiene tablas utilizables.');

  const meta = leerMetadatos(rutaMeta && base[rutaMeta]);
  return {
    censo: censo.toUpperCase(),
    anio,
    titulo: meta.titulo ?? `${censo.toUpperCase()} ${anio}`,
    identificador: meta.identificador,
    tablas,
    catalogos,
    advertencias,
  };
}
