// Configuración a partir de variables de entorno (ver .env.example).

export function leerConfig(env = process.env) {
  const produccion = env.NODE_ENV === 'production';
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY } = env;
  const supabase = SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY && SUPABASE_SERVICE_ROLE_KEY
    ? { url: SUPABASE_URL, clavePublica: SUPABASE_PUBLISHABLE_KEY, claveServicio: SUPABASE_SERVICE_ROLE_KEY }
    : null;
  const secreto = env.SESSION_SECRET ?? '';
  if (supabase && secreto.length < 32) {
    throw new Error('SESSION_SECRET debe tener al menos 32 caracteres (genera uno con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))").');
  }
  return {
    produccion,
    puerto: Number(env.PORT) || 3000,
    host: env.HOST || '0.0.0.0',
    proxies: Number(env.TRUST_PROXY) || 0, // saltos de proxy inverso confiables (para IP real y HTTPS)
    supabase,
    secreto,
  };
}
