// Exportación a CSV y XLSX. El XLSX se arma a mano (OOXML mínimo) para no depender de
// librerías pesadas; zipSync (fflate) se inyecta para funcionar en navegador y Node.
import { COMPONENTES, etiquetaTotal, resumenDe } from './agregacion.js';

const ETIQUETAS = { total: 'Total', hombres: 'Hombres', mujeres: 'Mujeres' };

/** Valor exportable de una celda: número, código del INEGI o vacío. */
export const valorExportable = (celda) => (celda == null ? '' : celda.v ?? celda.c ?? '');

/** Filas de la serie precedidas por su total agregado (clave TOTAL), sin duplicarlo. */
const conTotal = (s, unidad = etiquetaTotal(s.nivel)) => (s.filas.some((f) => f.clave === 'TOTAL')
  ? s.filas
  : [{ clave: 'TOTAL', unidad, categoria: '', ...resumenDe(s) }, ...s.filas]);

/** Formato largo: una fila por serie × unidad × categoría, empezando por el total de cada serie. */
export function filasLargas(series) {
  const filas = [['Variable', 'Tipo', 'Nivel', 'Año', 'Periodo de referencia', 'Fuente', 'Desagregación', 'Clave', 'Estado/Institución', 'Categoría', 'Total', 'Hombres', 'Mujeres', 'Observaciones']];
  for (const s of series) {
    for (const f of conTotal(s)) {
      const parcial = COMPONENTES.some((c) => f[c]?.p);
      filas.push([
        s.nombre, s.tipo, s.nivel, s.anio ?? '', s.periodo ?? '', s.fuente ?? '', s.desagregacion ?? '',
        f.clave, f.unidad, f.categoria ?? '',
        valorExportable(f.total), valorExportable(f.hombres), valorExportable(f.mujeres),
        parcial ? 'Suma parcial: hay registros NSS/ND/NP' : '',
      ]);
    }
  }
  return filas;
}

/** Formato ancho ("Crear tabla"): fila de total y una fila por unidad; una columna por serie y componente. */
export function filasAnchas(series) {
  const columnas = series.flatMap((s) =>
    COMPONENTES.filter((c) => s.filas.some((f) => f[c] != null)).map((c) => ({ s, c, titulo: `${s.nombre} (${ETIQUETAS[c]})` })),
  );
  const niveles = new Set(series.map((s) => s.nivel));
  const unidadTotal = etiquetaTotal(niveles.size === 1 ? series[0].nivel : null);
  const unidades = new Map();
  for (const s of series) {
    for (const f of conTotal(s, unidadTotal)) {
      const k = `${f.clave}\u0000${f.categoria ?? ''}`;
      if (!unidades.has(k)) unidades.set(k, { clave: f.clave, unidad: f.unidad, categoria: f.categoria ?? '', valores: new Map() });
      unidades.get(k).valores.set(s, f);
    }
  }
  const filas = [['Clave', 'Estado/Institución', 'Categoría', ...columnas.map((x) => x.titulo)]];
  for (const u of unidades.values()) {
    filas.push([u.clave, u.unidad, u.categoria, ...columnas.map(({ s, c }) => valorExportable(u.valores.get(s)?.[c]))]);
  }
  return filas;
}

/** Evita que hojas de cálculo interpreten texto como fórmula (inyección CSV). */
const neutralizar = (s) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

export function aCsv(filas) {
  const campo = (x) => {
    if (typeof x === 'number') return String(x);
    const s = neutralizar(String(x ?? ''));
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + filas.map((f) => f.map(campo).join(',')).join('\r\n') + '\r\n';
}

const xml = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); // caracteres inválidos en XML

const columnaExcel = (i) => {
  let s = '';
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
};

/** Genera un .xlsx de una hoja. */
export function aXlsx(filas, zipSync, nombreHoja = 'Datos') {
  const te = new TextEncoder();
  const hoja = nombreHoja.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31);
  const filasXml = filas.map((f, r) => `<row r="${r + 1}">${f.map((x, c) => {
    const ref = `${columnaExcel(c)}${r + 1}`;
    if (typeof x === 'number' && Number.isFinite(x)) return `<c r="${ref}"><v>${x}</v></c>`;
    if (x === '' || x == null) return '';
    return `<c r="${ref}" t="inlineStr"${r === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(x)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const archivos = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(hoja)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${filasXml}</sheetData></worksheet>`,
  };
  return zipSync(Object.fromEntries(Object.entries(archivos).map(([k, v]) => [k, te.encode(v)])));
}
