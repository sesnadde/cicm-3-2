import { leerConfig } from './config.js';
import { crearApp } from './app.js';
import { crearServicios } from './supabase.js';

const config = leerConfig();
const servicios = config.supabase ? crearServicios(config.supabase) : null;
if (!servicios) console.warn('Supabase no está configurado: el portal funciona, pero sin perfil de administrador ni series guardadas.');

const servidor = crearApp({ config, servicios }).listen(config.puerto, config.host, () => {
  console.log(`Portal disponible en http://localhost:${config.puerto}`);
});
const cerrar = () => servidor.close(() => process.exit(0));
process.on('SIGTERM', cerrar);
process.on('SIGINT', cerrar);
