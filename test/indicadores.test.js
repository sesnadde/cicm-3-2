import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { calcularIndicador, compilarFormula, ErrorFormula } from '../public/js/core/indicadores.js';
import { aCsv, aXlsx, filasAnchas, filasLargas } from '../public/js/core/exportar.js';
import { zipSync } from 'fflate';

const c = (v, codigo = null, p = false) => ({ v, c: codigo, p });
const serie = (filas) => ({ filas: filas.map(([clave, t, h = null, m = null, categoria = '']) => ({ clave, unidad: `U${clave}`, categoria, total: t, hombres: h, mujeres: m })) });

test('respeta precedencia, paréntesis, potencias y signo', () => {
  const A = serie([['01', c(2)]]);
  const r = (f) => calcularIndicador(f, { A })[0].total.v;
  assert.equal(r('A + 3 * 4'), 14);
  assert.equal(r('(A + 3) * 4'), 20);
  assert.equal(r('-A ^ 2'), -4);
  assert.equal(r('2 ^ 3 ^ 2 + A - A'), 512);
  assert.equal(r('redondear(A / 3, 2)'), 0.67);
  assert.equal(r('raiz(A * 8) + abs(-1) + log(100) + ln(1)'), 7);
});

test('calcula por unidad y componente, con funciones de columna', () => {
  const A = serie([['01', c(10), c(4), c(6)], ['02', c(30), c(10), c(20)]]);
  const B = serie([['01', c(100), c(50), c(50)], ['02', c(200), c(100), c(100)]]);
  const r = calcularIndicador('A / B * 100', { A, B });
  assert.deepEqual(r.map((f) => [f.clave, f.total.v, f.hombres.v, f.mujeres.v]), [['01', 10, 8, 12], ['02', 15, 10, 20]]);
  const prop = calcularIndicador('A / suma(A) * 100', { A });
  assert.deepEqual(prop.map((f) => f.total.v), [25, 75]);
  const norm = calcularIndicador('(A - min(A)) / (max(A) - min(A))', { A });
  assert.deepEqual(norm.map((f) => f.total.v), [0, 1]);
  assert.equal(calcularIndicador('promedio(A)', { A })[1].total.v, 20);
});

test('componentes explícitos: porcentaje de mujeres en una sola columna', () => {
  const A = serie([['01', c(10), c(4), c(6)], ['02', c(20), c(null, 'NSS'), c(5)]]);
  const r = calcularIndicador('A.mujeres / A.total * 100', { A });
  assert.deepEqual(r.map((f) => [f.total.v, f.hombres, f.mujeres]), [[60, null, null], [25, null, null]]);
  assert.deepEqual(calcularIndicador('A.hombres - A.mujeres', { A })[1].total, c(null, 'NSS'));
  const sinSexo = serie([['01', c(10)]]);
  assert.equal(calcularIndicador('A.mujeres / A.total', { A: sinSexo })[0].total, null); // la fuente no trae mujeres
  assert.throws(() => compilarFormula('A.edad', ['A']), /total, hombres o mujeres/);
});

test('propaga códigos, sumas parciales, faltantes y división entre cero', () => {
  const A = serie([['01', c(null, 'NSS')], ['02', c(5, null, true)], ['03', c(1)], ['04', c(1)]]);
  const B = serie([['01', c(1)], ['02', c(1)], ['03', c(0)]]);
  const r = calcularIndicador('A / B', { A, B });
  assert.deepEqual(r[0].total, c(null, 'NSS'));
  assert.deepEqual(r[1].total, c(5, null, true));
  assert.deepEqual(r[2].total, c(null)); // ÷0
  assert.deepEqual(r[3].total, c(null)); // la unidad 04 no existe en B
  assert.equal(r[0].hombres, null); // la fuente no tiene hombres
});

test('rechaza fórmulas inválidas o inseguras con mensajes claros', () => {
  const letras = ['A', 'B'];
  for (const [f, re] of [
    ['', /Escribe/], ['A +', /incompleta/], ['A + C', /no es una variable/], ['alert(A)', /desconocida/],
    ['A; B', /no permitido/], ['constructor', /no es una variable/], ['3 + 4', /al menos una variable/],
    ['redondear(A, 1, 2)', /argumento/], ['(A', /Se esperaba/], ['A'.padEnd(501, '+'), /excede/],
    ['('.repeat(60) + 'A' + ')'.repeat(60), /anidación/],
  ]) {
    assert.throws(() => compilarFormula(f, letras), (e) => e instanceof ErrorFormula && re.test(e.message), f);
  }
});

test('exporta CSV (BOM, comillas, neutraliza fórmulas) y formatos largo/ancho', () => {
  const s = { nombre: '=HIPERVINCULO("x")', tipo: 'variable', nivel: 'Estatal', anio: 2025, filas: [{ clave: '01', unidad: 'Ags, México', categoria: '', total: c(-3), hombres: c(null, 'NA'), mujeres: null }] };
  const csv = aCsv(filasLargas([s]));
  assert.ok(csv.startsWith('﻿Variable,'));
  assert.match(csv, /"'=HIPERVINCULO\(""x""\)",variable,Estatal,2025/);
  assert.match(csv, /"Ags, México",,-3,NA,,/);
  const ancha = filasAnchas([s]);
  assert.deepEqual(ancha[0], ['Clave', 'Estado/Institución', 'Categoría', '=HIPERVINCULO("x") (Total)', '=HIPERVINCULO("x") (Hombres)']);
  assert.deepEqual(ancha[1], ['01', 'Ags, México', '', -3, 'NA']);
});

test('genera un XLSX válido (ZIP con hoja y cadenas escapadas)', () => {
  const bytes = aXlsx([['Nombre', 'Valor'], ['a<b>&"c"', 1.5]], zipSync, 'Hoja:1');
  const partes = unzipSync(bytes);
  const hoja = new TextDecoder().decode(partes['xl/worksheets/sheet1.xml']);
  assert.match(hoja, /a&lt;b&gt;&amp;&quot;c&quot;/);
  assert.match(hoja, /<c r="B2"><v>1.5<\/v><\/c>/);
  assert.match(new TextDecoder().decode(partes['xl/workbook.xml']), /name="Hoja 1"/);
});
