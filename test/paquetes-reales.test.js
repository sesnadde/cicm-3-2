// Prueba de integración con paquetes reales del INEGI. Los ZIP no se versionan: se buscan en
// INEGI_DIR o en ../INEGI; si no existen, la prueba se omite. Los valores esperados se
// calcularon de forma independiente (Python, módulo csv) sobre los mismos archivos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { Paquete } from '../public/js/core/paquete.js';

const dir = process.env.INEGI_DIR ?? path.resolve(import.meta.dirname, '../../INEGI');
const zips = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.zip')) : [];
const abrir = (fragmento) => new Paquete(fs.readFileSync(path.join(dir, zips.find((z) => z.includes(fragmento)))), unzipSync);
const opciones = { skip: zips.length ? false : `sin paquetes en ${dir}` };

test('todas las tablas de todos los paquetes se leen y calculan', opciones, () => {
  for (const z of zips) {
    const p = new Paquete(fs.readFileSync(path.join(dir, z)), unzipSync);
    assert.deepEqual(p.estructura.advertencias, [], z);
    // Los nombres de variable deben ser únicos dentro del paquete (la deduplicación depende de ello)
    const nombres = p.estructura.tablas.flatMap((t) => t.variables.map((v) => v.nombre));
    assert.equal(new Set(nombres).size, nombres.length, `${z}: nombres de variable repetidos`);
    for (const t of p.estructura.tablas) {
      // Las tablas solo categóricas (p. ej. existencia Sí/No) se analizan con "Número de registros" desagregado.
      assert.ok(t.variables.length > 1 || t.dimensiones.length > 0, `${z} ${t.clave} sin variables ni dimensiones`);
      const series = p.calcular(t.clave, t.variables.map((v) => v.id));
      assert.ok(series.every((s) => s.filas.length > 0), `${z} ${t.clave} sin filas`);
      if (t.nivel === 'Estatal') assert.ok(series[0].filas.every((f) => /^\d{2}$/.test(f.clave)), `${z} ${t.clave} claves`);
    }
  }
});

test('valores coinciden con el cálculo independiente', opciones, () => {
  const rh = abrir('rec_huma_cnge');
  const [m8] = rh.calcular('m1s1p8', ['m1s1p8:sexostt']);
  const jal = m8.filas.find((f) => f.clave === '14');
  assert.equal(jal.unidad, 'Jalisco');
  assert.deepEqual([jal.total.v, jal.hombres.v, jal.mujeres.v], [149806, 60289, 89517]);

  const [m3] = abrir('rec_huma_cngf').calcular('m1s2p3', ['m1s2p3:sexostt']);
  const gob = m3.filas.find((f) => f.clave === '2');
  assert.deepEqual([gob.unidad, gob.total.v, gob.hombres.v, gob.mujeres.v], ['SECRETARIA DE GOBERNACION', 3327, 1627, 1700]);

  const [sanc] = abrir('ctrl_interno_anticorr_cnge').calcular('m1s5p28a', ['m1s5p28a:pasngtt']);
  assert.equal(sanc.filas.find((f) => f.clave === '09').total.v, 397); // sin duplicar la fila TOTAL

  const [tram] = abrir('tramite_servicio_cnge').calcular('m1s2p1', ['m1s2p1:esturett']);
  assert.equal(tram.filas.length, 32);
  assert.equal(tram.filas.reduce((s, f) => s + (f.total.v ?? 0), 0), 288739825);
});
