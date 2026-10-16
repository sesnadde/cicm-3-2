// Aplica db/schema.sql con una conexión Postgres directa (DATABASE_URL).
// Si tu red bloquea el puerto 5432 (frecuente en redes institucionales), pega db/schema.sql
// en Supabase > SQL Editor y ejecútalo: el resultado es el mismo.
import fs from 'node:fs';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL (revisa tu .env).');
  process.exit(1);
}
const sql = fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
// El certificado de Supabase lo firma su propia CA, que Node no trae: se cifra sin verificarla.
const cliente = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
try {
  await cliente.connect();
  await cliente.query(sql);
  console.log('Esquema aplicado correctamente.');
} catch (e) {
  console.error(`No se pudo aplicar el esquema: ${e.message}`);
  console.error('Alternativa: copia el contenido de db/schema.sql en Supabase > SQL Editor y ejecútalo.');
  process.exitCode = 1;
} finally {
  await cliente.end().catch(() => {});
}
