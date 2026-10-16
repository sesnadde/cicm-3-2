// Interpreta datos capturados a mano: una línea por unidad, «nombre, total, hombres, mujeres».
import { leerValor } from './agregacion.js';
import { ENTIDADES, claveEntidad } from './entidades.js';

const CODIGOS = ['NA', 'NSS', 'ND', 'NP'];
const celda = (v) => (v == null ? { v: null, c: null, p: false } : typeof v === 'number' ? { v, c: null, p: false } : { v: null, c: v, p: false });

/**
 * Separador: tabulador (lo que pega Excel; admite separador de miles «1,234») o coma.
 * Los últimos 1 a 3 campos que sean número, código del INEGI o vacío son los valores;
 * el resto es el nombre (puede contener comas).
 */
export function interpretarManual(texto, nivel) {
  const filas = [];
  const errores = [];
  const vistas = new Set();
  let columnas = 1;
  texto.split(/\r?\n/).forEach((linea, i) => {
    if (!linea.trim()) return;
    const tab = linea.includes('\t');
    const partes = linea.split(tab ? '\t' : ',').map((p) => p.trim());
    const valores = [];
    while (partes.length > 1 && valores.length < 3) {
      const v = leerValor(tab ? partes.at(-1).replace(/[,\s]/g, '') : partes.at(-1));
      if (!(v === null || typeof v === 'number' || CODIGOS.includes(v))) break;
      valores.unshift(v);
      partes.pop();
    }
    const nombre = partes.join(tab ? ' ' : ', ').trim();
    if (!nombre) return errores.push(`Línea ${i + 1}: falta el nombre.`);
    if (!valores.length) return errores.push(`Línea ${i + 1}: no tiene un valor numérico o código válido (NA, NSS, ND, NP).`);
    if (valores.every((v) => v === null)) return; // renglón de la plantilla sin llenar
    const clave = nivel === 'Estatal' ? claveEntidad(nombre) : nombre.slice(0, 100);
    if (!clave) return errores.push(`Línea ${i + 1}: «${nombre}» no es una entidad federativa reconocida.`);
    if (vistas.has(clave)) return errores.push(`Línea ${i + 1}: «${nombre}» está repetido.`);
    vistas.add(clave);
    columnas = Math.max(columnas, valores.length);
    filas.push({ clave, unidad: nivel === 'Estatal' ? ENTIDADES[clave] : nombre, valores });
  });
  return {
    errores,
    filas: filas.map(({ valores, ...f }) => ({
      ...f,
      categoria: '',
      total: celda(valores[0]),
      hombres: columnas >= 2 ? celda(valores[1]) : null,
      mujeres: columnas >= 3 ? celda(valores[2]) : null,
    })),
  };
}
