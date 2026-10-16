// Acceso a Supabase por HTTPS (Auth para administradores y tabla `series`).
// La llave service_role solo vive en el servidor; nunca se envía al navegador.
import { createClient } from '@supabase/supabase-js';

const SIN_SESION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const COLUMNAS_LISTA = 'id,tipo,nombre,nivel,anio,periodo,fuente,formula,desagregacion,n_filas,actualizado_en';

export function crearServicios({ url, clavePublica, claveServicio }) {
  const admin = createClient(url, claveServicio, SIN_SESION);

  const auth = {
    /** Verifica credenciales con Supabase Auth. Devuelve el usuario o null. */
    async iniciarSesion(email, password) {
      const cliente = createClient(url, clavePublica, SIN_SESION);
      const { data, error } = await cliente.auth.signInWithPassword({ email, password });
      if (error || !data.user) return null;
      // Solo se usa para validar credenciales: se revoca la sesión de Supabase y se emite la propia.
      await cliente.auth.signOut({ scope: 'local' }).catch(() => {});
      return { id: data.user.id, email: data.user.email, admin: data.user.app_metadata?.role === 'admin' };
    },
    /** Consulta en cada escritura si la cuenta sigue siendo administradora (revocación inmediata). */
    async esAdmin(id) {
      const { data, error } = await admin.auth.admin.getUserById(id);
      const u = data?.user;
      if (error || !u) return false;
      const suspendida = u.banned_until && new Date(u.banned_until) > new Date();
      return u.app_metadata?.role === 'admin' && !suspendida;
    },
  };

  const almacen = {
    async listar() {
      const { data, error } = await admin.from('series').select(COLUMNAS_LISTA).order('actualizado_en', { ascending: false }).limit(500);
      if (error) throw error;
      return data;
    },
    async obtener(id) {
      const { data, error } = await admin.from('series').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return data;
    },
    async guardar(series, usuarioId) {
      const filas = series.map((s) => ({ ...s, n_filas: s.filas.length, guardado_por: usuarioId, actualizado_en: new Date().toISOString() }));
      const { data, error } = await admin.from('series').upsert(filas, { onConflict: 'nombre,nivel,anio,desagregacion' }).select('id,nombre');
      if (error) throw error;
      return data;
    },
    async eliminar(id) {
      const { error, count } = await admin.from('series').delete({ count: 'exact' }).eq('id', id);
      if (error) throw error;
      return count > 0;
    },
  };

  return { auth, almacen };
}
