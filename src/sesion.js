// Sesión de administrador en una cookie HttpOnly firmada con HMAC (sin estado en el servidor).
import crypto from 'node:crypto';

export const COOKIE = 'cicm_sesion';
export const DURACION_SEG = 8 * 60 * 60;

const hmac = (cuerpo, secreto) => crypto.createHmac('sha256', secreto).update(cuerpo).digest('base64url');

export function firmar(datos, secreto, ahora = Date.now()) {
  const cuerpo = Buffer.from(JSON.stringify({ ...datos, exp: Math.floor(ahora / 1000) + DURACION_SEG })).toString('base64url');
  return `${cuerpo}.${hmac(cuerpo, secreto)}`;
}

export function verificar(token, secreto, ahora = Date.now()) {
  const [cuerpo, firma] = String(token ?? '').split('.');
  if (!cuerpo || !firma) return null;
  const esperada = Buffer.from(hmac(cuerpo, secreto));
  const recibida = Buffer.from(firma);
  if (recibida.length !== esperada.length || !crypto.timingSafeEqual(recibida, esperada)) return null;
  try {
    const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
    return datos.exp > ahora / 1000 ? datos : null;
  } catch {
    return null;
  }
}

export function leerCookie(req, nombre) {
  for (const parte of (req.headers.cookie ?? '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nombre) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}
