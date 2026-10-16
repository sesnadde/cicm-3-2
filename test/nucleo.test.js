import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { parseCsv } from '../public/js/core/csv.js';
import { abrirZip, ErrorZip } from '../public/js/core/zip.js';
import { ErrorPaquete, construirVariables, tituloCorto } from '../public/js/core/inegi.js';
import { Paquete } from '../public/js/core/paquete.js';
import { claveEntidad } from '../public/js/core/entidades.js';
import { interpretarManual } from '../public/js/core/manual.js';
import { paqueteEstatal, paqueteFederal } from './fixtures.js';

const celda = (v, c = null, p = false) => ({ v, c, p });

test('parseCsv: comillas, comillas escapadas, CRLF, BOM y líneas vacías', () => {
  const t = '﻿a,b,c\r\n1,"x, y","di ""hola"""\r\n\r\n2,,\n3,"multi\nlínea",z';
  assert.deepEqual(parseCsv(t), [['a', 'b', 'c'], ['1', 'x, y', 'di "hola"'], ['2', '', ''], ['3', 'multi\nlínea', 'z']]);
});

test('tituloCorto quita el periodo y conserva «según» (distingue tablas)', () => {
  assert.equal(tituloCorto('Personal adscrito a las instituciones, según sexo, al cierre del año 2024.'), 'Personal adscrito a las instituciones, según sexo');
  assert.equal(tituloCorto('Solicitudes, según tipo, durante el año 2024.'), 'Solicitudes, según tipo');
  assert.equal(tituloCorto('Existencia de algún área.'), 'Existencia de algún área');
});

test('estructura CNGE: metadatos, tablas, nivel, periodo y advertencia por tabla faltante', () => {
  const { estructura: e } = new Paquete(paqueteEstatal(), unzipSync);
  assert.equal(e.censo, 'CNGE');
  assert.equal(e.anio, 2025);
  assert.equal(e.titulo, 'Censo Nacional de Gobiernos Estatales 2025');
  assert.deepEqual(e.tablas.map((t) => t.clave), ['m1s1p9', 'm1s2p1']);
  assert.equal(e.advertencias.length, 1);
  const t = e.tablas[0];
  assert.equal(t.nivel, 'Estatal');
  assert.equal(t.periodo, '2024');
  assert.deepEqual(t.unidad, { tipo: 'estado', columna: 'cve_ent' });
  assert.deepEqual(t.dimensiones.map((d) => d.columna), ['nombre1']);
});

test('agrupa columnas por sexo según la descripción del diccionario', () => {
  const { estructura: e } = new Paquete(paqueteEstatal(), unzipSync);
  const vars = e.tablas[0].variables;
  const por = Object.fromEntries(vars.map((v) => [v.etiqueta, v.columnas]));
  assert.deepEqual(por.Total, { total: 'regtt', hombres: 'reg1', mujeres: 'reg2' });
  assert.deepEqual(por.Confianza, { total: 'regs1', hombres: 'reg3', mujeres: 'reg4' });
  assert.deepEqual(por.Ocupadas, { hombres: 'reg5', mujeres: 'reg6' });
  assert.ok(por['Número de registros']);
  const marcas = e.tablas[1].variables.find((v) => v.columnas.total === 'medpre1');
  assert.match(marcas.etiqueta, /registros marcados/);
});

test('en columnas de marca, «Mujeres» es una categoría y no un sexo', () => {
  const marca = '1, NA, NSS, ND, NP, NULL';
  const vars = construirVariables('m1s3p7', 'Programas', [
    { columna: 'gpovul1', descripcion: 'Grupo vulnerable - Mujeres', codigo: marca },
    { columna: 'gpovul2', descripcion: 'Grupo vulnerable - Juventudes', codigo: marca },
  ]);
  assert.deepEqual(vars.slice(0, 2).map((v) => [v.etiqueta, v.columnas]), [
    ['Grupo vulnerable - Mujeres (registros marcados)', { total: 'gpovul1' }],
    ['Grupo vulnerable - Juventudes (registros marcados)', { total: 'gpovul2' }],
  ]);
});

test('agrega por entidad: orden de columnas distinto, fila TOTAL excluida, códigos y sumas parciales', () => {
  const p = new Paquete(paqueteEstatal(), unzipSync);
  const [total, confianza, ocupadas, registros] = p.calcular('m1s1p9', ['m1s1p9:regtt', 'm1s1p9:regs1', 'm1s1p9:reg5', 'm1s1p9:#registros']);
  assert.deepEqual(total.filas.map((f) => [f.clave, f.unidad]), [['01', 'Aguascalientes'], ['02', 'Baja California'], ['09', 'Ciudad de México']]);
  assert.deepEqual(total.filas[0].total, celda(138));
  assert.deepEqual(total.filas[0].hombres, celda(76));
  assert.deepEqual(total.filas[1].total, celda(null, 'NA')); // solo NA
  assert.deepEqual(total.filas[2].total, celda(10)); // la fila TOTAL no se duplica
  assert.deepEqual(confianza.filas[0].total, celda(51, null, true)); // 51 + NSS → parcial
  assert.equal(ocupadas.filas[0].total, null); // la fuente no trae total
  assert.deepEqual(ocupadas.filas[0].mujeres, celda(6));
  assert.deepEqual(ocupadas.filas[2].hombres, celda(null)); // vacío
  assert.deepEqual(registros.filas.map((f) => f.total.v), [2, 1, 1]);
});

test('desagrega por categoría de catálogo y suma marcas', () => {
  const p = new Paquete(paqueteEstatal(), unzipSync);
  const [sol] = p.calcular('m1s2p1', ['m1s2p1:esturett'], 'tramitse_r');
  assert.deepEqual(sol.filas.map((f) => [f.unidad, f.categoria, f.total.v ?? f.total.c]), [
    ['Aguascalientes', 'Pago de impuestos', 100],
    ['Aguascalientes', 'Licencia de construcción, obra', 50],
    ['Baja California', 'Pago de impuestos', 'NSS'],
    ['Baja California', 'Licencia de construcción, obra', 'NA'],
  ]);
  const [marcas] = p.calcular('m1s2p1', ['m1s2p1:medpre1']);
  assert.deepEqual(marcas.filas.map((f) => f.total.v), [1, 1]);
  assert.throws(() => p.calcular('m1s2p1', ['m1s2p1:esturett'], 'no_existe'), /no se puede desagregar/);
});

test('CNGF: unidad por institución (catálogo) o total federal', () => {
  const p = new Paquete(paqueteFederal(), unzipSync);
  const [t3, t20] = p.estructura.tablas;
  assert.equal(t3.nivel, 'Federal');
  assert.deepEqual(t3.unidad, { tipo: 'institucion', columna: 'instadmi_j' });
  const [inst] = p.calcular('m1s2p3', ['m1s2p3:sexostt']);
  assert.deepEqual(inst.filas.map((f) => [f.unidad, f.total.v, f.hombres.v, f.mujeres.v]), [
    ['OFICINA DE LA PRESIDENCIA', 510, 275, 235],
    ['SECRETARIA DE GOBERNACION', 3327, 1627, 1700],
  ]);
  assert.equal(t20.unidad.tipo, 'nacional');
  const [nac] = p.calcular('m1s2p20', ['m1s2p20:acfoic1']);
  assert.deepEqual(nac.filas.map((f) => [f.unidad, f.total.v]), [['Total federal', 1660]]);
});

test('acepta ZIP con carpeta contenedora y archivos en Windows-1252', () => {
  const latin1 = (s) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));
  const p = new Paquete(paqueteEstatal({ prefijo: 'descarga/', codificar: latin1 }), unzipSync);
  assert.equal(p.estructura.tablas[0].unidad.tipo, 'estado');
  assert.equal(p.estructura.catalogos.cve_ent['9'], 'Ciudad de México');
});

test('rechaza ZIP ajenos, dañados o con compresión anómala', () => {
  assert.throws(() => new Paquete(zipSync({ 'a.csv': strToU8('x') }), unzipSync), ErrorPaquete);
  assert.throws(() => new Paquete(strToU8('no soy un zip'), unzipSync), ErrorZip);
  const bomba = zipSync({ 'x.csv': new Uint8Array(3 * 1024 * 1024) }, { level: 9 });
  assert.throws(() => abrirZip(bomba, unzipSync), /compresión anómala/);
  assert.throws(() => abrirZip(paqueteEstatal(), unzipSync, { entradas: 3, bytesPorArchivo: 1e9, bytesTotales: 1e9, razonCompresion: 1e9 }), /más de 3 archivos/);
});

test('captura manual: coma o tabulador, nombres con comas, códigos, plantilla vacía y errores', () => {
  const { filas, errores } = interpretarManual('Jalisco, 100, 40, 60\n14 Jalisco, 1\nCDMX, NSS\nColima, \n\tx\nAtlantis, 5', 'Estatal');
  assert.deepEqual(filas.map((f) => [f.clave, f.unidad, f.total.v ?? f.total.c, f.hombres?.v]), [['14', 'Jalisco', 100, 40], ['09', 'Ciudad de México', 'NSS', null]]);
  assert.equal(errores.length, 3); // repetido, sin valores, entidad desconocida
  const fed = interpretarManual('SECRETARIA DE FINANZAS, ADMINISTRACION, 7\nOTRA\t1,234.5', 'Federal');
  assert.deepEqual(fed.filas.map((f) => [f.unidad, f.total.v, f.hombres]), [['SECRETARIA DE FINANZAS, ADMINISTRACION', 7, null], ['OTRA', 1234.5, null]]);
});

test('claveEntidad reconoce claves, nombres y alias', () => {
  assert.equal(claveEntidad('14'), '14');
  assert.equal(claveEntidad('9 Ciudad de México'), '09');
  assert.equal(claveEntidad('michoacán'), '16');
  assert.equal(claveEntidad('CDMX'), '09');
  assert.equal(claveEntidad('Estado de México'), '15');
  assert.equal(claveEntidad('Atlantis'), null);
});
