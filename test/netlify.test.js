// Función de Netlify (netlify/functions/api.mjs): reenvío de peticiones web a la app Express.
// Sin variables de Supabase: la API responde como servidor sin base de datos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import api, { config } from '../netlify/functions/api.mjs';

const SITIO = 'https://portal.example';
const invocar = (ruta, init = {}) => api(new Request(SITIO + ruta, init), { ip: '203.0.113.7' });

test('atiende /api/* con las cabeceras de seguridad y HSTS', async () => {
  assert.equal(config.path, '/api/*');
  const r = await invocar('/api/sesion');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { rol: 'usuario', bd: false });
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(r.headers.get('strict-transport-security'), /max-age=/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal((await invocar('/api/series')).status, 503);
  assert.deepEqual(await (await invocar('/api/nada')).json(), { error: 'Ruta no encontrada.' });
});

test('reenvía el cuerpo, el origen y las cookies', async () => {
  const malFormado = await invocar('/api/sesion', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(malFormado.status, 400);
  assert.deepEqual(await malFormado.json(), { error: 'JSON mal formado.' });

  const ajeno = await invocar('/api/sesion', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://otro.example' }, body: '{}' });
  assert.equal(ajeno.status, 403);
  const propio = await invocar('/api/sesion', { method: 'POST', headers: { 'content-type': 'application/json', origin: SITIO }, body: '{}' });
  assert.equal(propio.status, 503);

  const salir = await invocar('/api/sesion', { method: 'DELETE', headers: { origin: SITIO } });
  assert.equal(salir.status, 204);
  assert.match(salir.headers.get('set-cookie'), /Secure/);
});
