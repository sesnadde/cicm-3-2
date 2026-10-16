// Función de Netlify para /api/*: ejecuta la misma app Express del servidor (src/app.js).
// Netlify entrega un Request web; se reenvía por HTTP a la app, que escucha en 127.0.0.1 dentro de
// la propia función, para conservar intactos sus límites, cookies, validación y cabeceras.
import http from 'node:http';
import { leerConfig } from '../../src/config.js';
import { crearApp } from '../../src/app.js';
import { crearServicios } from '../../src/supabase.js';

// Cabeceras de un solo salto; accept-encoding se omite porque el CDN de Netlify ya comprime.
const OMITIR = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'content-length', 'accept-encoding']);
const SIN_CUERPO = new Set([204, 205, 304]);

let puerto;
const iniciar = () => (puerto ??= new Promise((resolver, rechazar) => {
  // Netlify siempre sirve por HTTPS (cookies Secure y HSTS) y antepone un salto de proxy.
  const config = { ...leerConfig(), produccion: true, proxies: 1 };
  const servicios = config.supabase ? crearServicios(config.supabase) : null;
  const servidor = crearApp({ config, servicios, estaticos: false })
    .listen(0, '127.0.0.1', () => resolver(servidor.address().port))
    .on('error', rechazar);
  servidor.unref();
}));

export default async (req, context) => {
  const url = new URL(req.url);
  const cuerpo = req.body ? Buffer.from(await req.arrayBuffer()) : null;
  const cabeceras = {};
  for (const [k, v] of req.headers) if (!OMITIR.has(k)) cabeceras[k] = v;
  Object.assign(cabeceras, {
    host: url.host,
    'x-forwarded-for': context.ip, // IP real del cliente según Netlify (límite de intentos de inicio de sesión)
    'x-forwarded-proto': url.protocol.slice(0, -1),
    ...(cuerpo && { 'content-length': String(cuerpo.length) }),
  });
  const p = await iniciar();
  return new Promise((resolver, rechazar) => {
    const peticion = http.request({ host: '127.0.0.1', port: p, method: req.method, path: url.pathname + url.search, headers: cabeceras, agent: false }, (r) => {
      const partes = [];
      r.on('data', (c) => partes.push(c));
      r.on('error', rechazar);
      r.on('end', () => {
        const salida = new Headers();
        for (const [k, v] of Object.entries(r.headers)) if (!OMITIR.has(k)) for (const x of [v].flat()) salida.append(k, x);
        resolver(new Response(SIN_CUERPO.has(r.statusCode) ? null : Buffer.concat(partes), { status: r.statusCode, headers: salida }));
      });
    });
    peticion.on('error', rechazar);
    peticion.end(cuerpo ?? undefined);
  });
};

export const config = { path: '/api/*' };
