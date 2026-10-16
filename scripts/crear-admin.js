// Crea una cuenta de administración en Supabase Auth, o promueve una existente.
// Uso: npm run admin:crear -- correo@dominio.mx
// La contraseña temporal se genera al azar y se muestra una sola vez.
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const email = process.argv[2]?.trim();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Uso: npm run admin:crear -- correo@dominio.mx');
  process.exit(1);
}
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (revisa tu .env).');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let existente = null;
for (let page = 1; ; page++) {
  const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  existente = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
  if (existente || data.users.length < 1000) break;
}

if (existente) {
  const { error } = await sb.auth.admin.updateUserById(existente.id, { app_metadata: { ...existente.app_metadata, role: 'admin' } });
  if (error) throw error;
  console.log(`La cuenta ${email} ya existía; ahora tiene rol de administración.`);
} else {
  const password = crypto.randomBytes(18).toString('base64url');
  const { error } = await sb.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: 'admin' } });
  if (error) throw error;
  console.log(`Cuenta creada: ${email}`);
  console.log('Contraseña temporal (guárdala en tu gestor de contraseñas; no se volverá a mostrar):');
  console.log(`  ${password}`);
}
