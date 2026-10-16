import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp } from '../src/app.js';
import { leerConfig } from '../src/config.js';
import { firmar, verificar } from '../src/sesion.js';

const SECRETO = 'x'.repeat(40);
const ADMIN = { id: '11111111-1111-1111-1111-111111111111', email: 'admin@ejemplo.mx' };
let esAdmin = true;
const guardadas = [];
const servicios = {
  auth: {
    async iniciarSesion(email, password) {
      if (password !== 'correcta') return null;
      return { ...ADMIN, email, admin: email === ADMIN.email };
    },
    esAdmin: async () => esAdmin,
  },
  almacen: {
    listar: async () => guardadas.map(({ filas, ...s }) => s),
    obtener: async (id) => guardadas.find((s) => s.id === id) ?? null,
    guardar: async (series) => series.map((s, i) => { guardadas.push({ ...s, id: `22222222-2222-2222-2222-22222222222${i}` }); return { id: guardadas.at(-1).id, nombre: s.nombre }; }),
    eliminar: async (id) => { const i = guardadas.findIndex((s) => s.id === id); if (i >= 0) guardadas.splice(i, 1); return i >= 0; },
  },
};

let base;
let servidor;
before(async () => {
  servidor = crearApp({ config: { produccion: false, proxies: 0, secreto: SECRETO }, servicios }).listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

const pedir = (ruta, { metodo = 'GET', cuerpo, cookie, origen } = {}) =>
  fetch(base + ruta, {
    method: metodo,
    headers: { ...(cuerpo ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(origen ? { origin: origen } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
const iniciar = async () => {
  const r = await pedir('/api/sesion', { metodo: 'POST', cuerpo: { email: ADMIN.email, password: 'correcta' } });
  return r.headers.get('set-cookie').split(';')[0];
};
const serie = { tipo: 'variable', nombre: 'Personal', nivel: 'Estatal', anio: 2025, filas: [{ clave: '01', unidad: 'Aguascalientes', total: { v: 10, c: null, p: false }, hombres: null, mujeres: { v: null, c: 'NA' } }] };

test('sirve el portal y fflate con cabeceras de seguridad', async () => {
  const r = await pedir('/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null);
  const f = await pedir('/vendor/fflate.js');
  assert.equal(f.status, 200);
  assert.match(await f.text(), /unzipSync/);
  assert.equal((await pedir('/../.env')).status, 404);
});

test('sesión: usuario por defecto, credenciales malas, cuenta sin rol y cookie segura', async () => {
  assert.deepEqual(await (await pedir('/api/sesion')).json(), { rol: 'usuario', bd: true });
  assert.equal((await pedir('/api/sesion', { metodo: 'POST', cuerpo: { email: ADMIN.email, password: 'mala' } })).status, 401);
  assert.equal((await pedir('/api/sesion', { metodo: 'POST', cuerpo: { email: 'otro@ejemplo.mx', password: 'correcta' } })).status, 403);
  assert.equal((await pedir('/api/sesion', { metodo: 'POST', cuerpo: { email: 1 } })).status, 400);
  const r = await pedir('/api/sesion', { metodo: 'POST', cuerpo: { email: ADMIN.email, password: 'correcta' } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /HttpOnly/);
  assert.match(r.headers.get('set-cookie'), /SameSite=Strict/);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  assert.deepEqual(await (await pedir('/api/sesion', { cookie })).json(), { rol: 'admin', email: ADMIN.email, bd: true });
  assert.deepEqual(await (await pedir('/api/sesion', { cookie: cookie.slice(0, -2) + 'xx' })).json(), { rol: 'usuario', bd: true });
});

test('guardar series exige administrador vigente, mismo origen y datos válidos', async () => {
  assert.equal((await pedir('/api/series', { metodo: 'POST', cuerpo: { series: [serie] } })).status, 401);
  const cookie = await iniciar();
  assert.equal((await pedir('/api/series', { metodo: 'POST', cuerpo: { series: [serie] }, cookie, origen: 'https://malicioso.example' })).status, 403);
  const invalida = await pedir('/api/series', { metodo: 'POST', cuerpo: { series: [{ ...serie, nivel: 'Galáctico' }] }, cookie });
  assert.equal(invalida.status, 400);
  assert.match((await invalida.json()).error, /nivel/);
  const ok = await pedir('/api/series', { metodo: 'POST', cuerpo: { series: [{ ...serie, extra: 'se ignora' }] }, cookie, origen: base });
  assert.equal(ok.status, 201);
  const { guardadas: [g] } = await ok.json();
  assert.equal(guardadas[0].extra, undefined);
  assert.deepEqual(guardadas[0].filas[0].mujeres, { v: null, c: 'NA', p: false });
  // Lectura pública
  assert.equal((await (await pedir('/api/series')).json()).length, 1);
  assert.equal((await (await pedir(`/api/series/${g.id}`)).json()).nombre, 'Personal');
  assert.equal((await pedir('/api/series/no-es-uuid')).status, 404);
  // Si se revoca el rol, la cookie deja de servir para escribir
  esAdmin = false;
  assert.equal((await pedir(`/api/series/${g.id}`, { metodo: 'DELETE', cookie })).status, 403);
  esAdmin = true;
  assert.equal((await pedir(`/api/series/${g.id}`, { metodo: 'DELETE', cookie })).status, 204);
});

test('rechaza JSON mal formado, tipo de contenido incorrecto y envíos demasiado grandes', async () => {
  const cookie = await iniciar();
  const mal = await fetch(`${base}/api/series`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{' });
  assert.equal(mal.status, 400);
  const texto = await fetch(`${base}/api/series`, { method: 'POST', headers: { 'content-type': 'text/plain', cookie }, body: 'x' });
  assert.equal(texto.status, 415);
  const grande = await fetch(`${base}/api/series`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ x: 'a'.repeat(11 * 1024 * 1024) }) });
  assert.equal(grande.status, 413);
});

test('limita intentos fallidos de inicio de sesión', async () => {
  let ultimo;
  for (let i = 0; i < 12; i++) ultimo = await pedir('/api/sesion', { metodo: 'POST', cuerpo: { email: 'x@ejemplo.mx', password: 'mala' } });
  assert.equal(ultimo.status, 429);
});

test('firmas de sesión: caducidad y manipulación', () => {
  const t = firmar({ sub: 'a' }, SECRETO, 0);
  assert.equal(verificar(t, SECRETO, 1000).sub, 'a');
  assert.equal(verificar(t, SECRETO, 9 * 3600 * 1000), null);
  assert.equal(verificar(t, 'y'.repeat(40), 1000), null);
  assert.equal(verificar('basura', SECRETO), null);
});

test('config exige SESSION_SECRET largo si hay Supabase', () => {
  const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'p', SUPABASE_SERVICE_ROLE_KEY: 's' };
  assert.throws(() => leerConfig({ ...env, SESSION_SECRET: 'corto' }), /SESSION_SECRET/);
  assert.equal(leerConfig({}).supabase, null);
});

test('sin base de datos la API responde 503 y el portal sigue disponible', async () => {
  const s = crearApp({ config: { produccion: false, proxies: 0, secreto: '' }, servicios: null }).listen(0);
  await new Promise((r) => s.once('listening', r));
  const url = `http://127.0.0.1:${s.address().port}`;
  assert.deepEqual(await (await fetch(`${url}/api/sesion`)).json(), { rol: 'usuario', bd: false });
  assert.equal((await fetch(`${url}/api/series`)).status, 503);
  assert.equal((await fetch(url)).status, 200);
  s.close();
});
