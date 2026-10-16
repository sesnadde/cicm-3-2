// Cliente de la API del servidor (sesión de administrador y series guardadas).

async function pedir(ruta, { metodo = 'GET', cuerpo } = {}) {
  const r = await fetch(ruta, {
    method: metodo,
    credentials: 'same-origin',
    headers: cuerpo ? { 'Content-Type': 'application/json' } : {},
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (r.status === 204) return null;
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error || `Error ${r.status}`);
  return datos;
}

export const sesion = () => pedir('api/sesion');
export const entrar = (email, password) => pedir('api/sesion', { metodo: 'POST', cuerpo: { email, password } });
export const salir = () => pedir('api/sesion', { metodo: 'DELETE' });
export const listarSeries = () => pedir('api/series');
export const obtenerSerie = (id) => pedir(`api/series/${encodeURIComponent(id)}`);
export const guardarSeries = (series) => pedir('api/series', { metodo: 'POST', cuerpo: { series } });
export const eliminarSerie = (id) => pedir(`api/series/${encodeURIComponent(id)}`, { metodo: 'DELETE' });
