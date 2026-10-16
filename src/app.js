// Aplicación Express: sirve el portal estático y la API mínima (sesión de administrador y series).
// El procesamiento de los ZIP ocurre en el navegador; el servidor nunca recibe esos archivos.
import express from 'express';
import compression from 'compression';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COOKIE, DURACION_SEG, firmar, leerCookie, verificar } from './sesion.js';
import { ErrorValidacion, validarSeries } from './validacion.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FFLATE = path.join(path.dirname(fileURLToPath(import.meta.resolve('fflate'))), 'browser.js');
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: blob:",
  "connect-src 'self'", "worker-src 'self'", "object-src 'none'", "base-uri 'none'",
  "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

/** Limita intentos fallidos de inicio de sesión por IP (ventana fija, en memoria). */
function crearLimitador({ maximo = 10, ventanaMs = 15 * 60 * 1000 } = {}) {
  const intentos = new Map();
  const vigente = (ip, ahora) => {
    const r = intentos.get(ip);
    return r && ahora - r.inicio < ventanaMs ? r : null;
  };
  return {
    bloqueado: (ip, ahora = Date.now()) => (vigente(ip, ahora)?.n ?? 0) >= maximo,
    fallo(ip, ahora = Date.now()) {
      const r = vigente(ip, ahora) ?? { inicio: ahora, n: 0 };
      r.n++;
      intentos.set(ip, r);
      if (intentos.size > 10_000) for (const [k] of intentos) if (!vigente(k, ahora)) intentos.delete(k);
    },
    exito: (ip) => intentos.delete(ip),
  };
}

export function crearApp({ config, servicios }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.proxies) app.set('trust proxy', config.proxies);

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    if (config.produccion) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  app.use(compression());

  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.use('/api', crearApi({ config, servicios }));

  app.get('/vendor/fflate.js', (req, res) => res.sendFile(FFLATE, { headers: { 'Cache-Control': 'public, max-age=86400' } }));
  app.use(express.static(path.join(RAIZ, 'public'), { setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));
  app.use((req, res) => res.status(404).type('text').send('No encontrado'));
  return app;
}

function crearApi({ config, servicios }) {
  const api = express.Router();
  const limitador = crearLimitador();
  const opcionesCookie = { httpOnly: true, sameSite: 'strict', secure: config.produccion, path: '/' };
  const sesion = (req) => verificar(leerCookie(req, COOKIE), config.secreto);

  api.use(express.json({ limit: '10mb' }));
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.method === 'GET') return next();
    // Defensa CSRF adicional a SameSite=Strict: el origen debe ser este mismo sitio.
    const origen = req.get('origin');
    if (origen && (() => { try { return new URL(origen).host !== req.get('host'); } catch { return true; } })()) {
      return res.status(403).json({ error: 'Origen no permitido.' });
    }
    if (req.method === 'POST' && !req.is('application/json')) return res.status(415).json({ error: 'Se esperaba JSON.' });
    next();
  });
  const requiereBd = (req, res, next) =>
    servicios ? next() : res.status(503).json({ error: 'La base de datos no está configurada en este servidor.' });

  api.get('/sesion', (req, res) => {
    const s = servicios && sesion(req);
    res.json(s ? { rol: 'admin', email: s.email, bd: true } : { rol: 'usuario', bd: Boolean(servicios) });
  });

  api.post('/sesion', requiereBd, async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password || email.length > 320 || password.length > 200) {
      return res.status(400).json({ error: 'Escribe tu correo y contraseña.' });
    }
    if (limitador.bloqueado(req.ip)) return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
    const usuario = await servicios.auth.iniciarSesion(email.trim(), password);
    if (!usuario) {
      limitador.fallo(req.ip);
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }
    if (!usuario.admin) return res.status(403).json({ error: 'Esta cuenta no tiene permisos de administrador.' });
    limitador.exito(req.ip);
    res.cookie(COOKIE, firmar({ sub: usuario.id, email: usuario.email }, config.secreto), { ...opcionesCookie, maxAge: DURACION_SEG * 1000 });
    res.json({ rol: 'admin', email: usuario.email, bd: true });
  });

  api.delete('/sesion', (req, res) => {
    res.clearCookie(COOKIE, opcionesCookie);
    res.status(204).end();
  });

  const requiereAdmin = async (req, res, next) => {
    const s = sesion(req);
    if (!s) return res.status(401).json({ error: 'Inicia sesión como administrador.' });
    if (!(await servicios.auth.esAdmin(s.sub))) {
      res.clearCookie(COOKIE, opcionesCookie);
      return res.status(403).json({ error: 'La cuenta ya no tiene permisos de administrador.' });
    }
    req.usuario = s;
    next();
  };

  // Lectura pública de las series guardadas por los administradores.
  api.get('/series', requiereBd, async (req, res) => res.json(await servicios.almacen.listar()));
  api.get('/series/:id', requiereBd, async (req, res) => {
    if (!RE_UUID.test(req.params.id)) return res.status(404).json({ error: 'Serie no encontrada.' });
    const serie = await servicios.almacen.obtener(req.params.id);
    return serie ? res.json(serie) : res.status(404).json({ error: 'Serie no encontrada.' });
  });
  api.post('/series', requiereBd, requiereAdmin, async (req, res) => {
    const series = validarSeries(req.body);
    res.status(201).json({ guardadas: await servicios.almacen.guardar(series, req.usuario.sub) });
  });
  api.delete('/series/:id', requiereBd, requiereAdmin, async (req, res) => {
    if (!RE_UUID.test(req.params.id)) return res.status(404).json({ error: 'Serie no encontrada.' });
    return (await servicios.almacen.eliminar(req.params.id)) ? res.status(204).end() : res.status(404).json({ error: 'Serie no encontrada.' });
  });

  api.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
  api.use((err, req, res, _next) => {
    if (err instanceof ErrorValidacion) return res.status(400).json({ error: err.message });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'El envío es demasiado grande.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON mal formado.' });
    console.error('[api]', req.method, req.path, err);
    res.status(500).json({ error: 'Error interno. Intenta de nuevo más tarde.' });
  });
  return api;
}
