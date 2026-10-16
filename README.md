# Procesador de datos del INEGI

Portal público para procesar los **paquetes de datos abiertos (CSV/ZIP) de los censos de gobierno
del INEGI** (p. ej. CNGE y CNGF), crear indicadores, generar mapas coropléticos por entidad y
descargar los resultados. Los ZIP se procesan **en el navegador**: no se suben al servidor.

- **Perfil usuario** (público): carga ZIP, selecciona variables (con desagregación opcional),
  crea tablas e indicadores, ve mapas y descarga CSV/Excel/SVG/PNG. Todo queda en una caché
  temporal de la pestaña.
- **Perfil administrador**: lo mismo y, además, guarda y elimina series en la base de datos
  (Supabase). Las series guardadas se pueden consultar y reutilizar desde el portal.

Documentación técnica:
- [docs/analisis-inegi.md](docs/analisis-inegi.md): estructura de los ZIP, patrones, trampas y verificación.
- [docs/arquitectura.md](docs/arquitectura.md): arquitectura, decisiones, supuestos, seguridad y
  revisión crítica del prototipo anterior.

## Requisitos

- Node.js 22 o superior.
- Opcional, para el perfil administrador: un proyecto de [Supabase](https://supabase.com).

## Instalación y ejecución local

```bash
npm ci
cp .env.example .env      # y completa los valores (ver abajo)
npm run dev               # http://localhost:3000, con recarga automática
```

Sin variables de Supabase el portal funciona completo para el perfil usuario; el acceso de
administración y las series guardadas aparecen deshabilitados.

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo con recarga automática (lee `.env`) |
| `npm start` | Servidor de producción |
| `npm test` | Pruebas (núcleo, servidor y, si existen, paquetes reales en `../INEGI` o `INEGI_DIR`) |
| `npm run db:setup` | Aplica `db/schema.sql` por Postgres (requiere salida al puerto 5432) |
| `npm run admin:crear -- correo@dominio.mx` | Crea o promueve una cuenta de administración |

## Variables de entorno

| Variable | Uso |
|---|---|
| `NODE_ENV` | `production` en el servidor público (cookies `Secure`, HSTS) |
| `PORT`, `HOST` | Puerto (3000) e interfaz (`0.0.0.0`) |
| `TRUST_PROXY` | Número de proxies inversos confiables (normalmente `1` en hosting administrado) |
| `SUPABASE_URL` | URL del proyecto |
| `SUPABASE_PUBLISHABLE_KEY` | Llave publicable; el servidor la usa para verificar contraseñas |
| `SUPABASE_SERVICE_ROLE_KEY` | Llave `service_role`. **Solo servidor**; nunca en el navegador ni en git |
| `DATABASE_URL` | Solo para `npm run db:setup` |
| `SESSION_SECRET` | Obligatoria con Supabase (≥ 32 caracteres); firma la cookie de sesión |

## Base de datos y administradores (una sola vez)

1. **Esquema**: en Supabase → *SQL Editor*, pega y ejecuta [`db/schema.sql`](db/schema.sql)
   (es idempotente). Desde redes que permiten el puerto 5432 también sirve `npm run db:setup`.
2. **Cuenta de administración**: `npm run admin:crear -- correo@dominio.mx`. Si la cuenta no
   existe, se crea con una contraseña temporal aleatoria que se muestra una sola vez; si existe,
   solo se le asigna el rol. El rol vive en `app_metadata.role = "admin"`.
3. **Cambiar contraseña**: Supabase → *Authentication → Users* → enviar recuperación.
4. **Revocar el rol** (efecto inmediato para guardar o eliminar):
   ```sql
   update auth.users set raw_app_meta_data = raw_app_meta_data - 'role' where email = 'correo@dominio.mx';
   ```

## Despliegue público de bajo costo

El servidor no procesa archivos (≈ 60 MB de RAM, CPU mínima), así que basta la instancia más
pequeña de cualquier hosting de Node o contenedores:

- **Contenedor** (Google Cloud Run, Fly.io, Railway, Render): usa el `Dockerfile` incluido y define
  las variables de entorno en el panel del proveedor. Cloud Run escala a cero (paga por uso).
- **VM o servidor propio**: `npm ci --omit=dev && NODE_ENV=production npm start` detrás de nginx o
  Caddy con HTTPS, bajo un supervisor (systemd o pm2).

En todos los casos: sirve el portal por **HTTPS**, define `NODE_ENV=production`, un
`SESSION_SECRET` largo y `TRUST_PROXY=1` si hay un proxy delante. Comprobación de salud: `GET /healthz`.
No uses funciones *serverless* con límites de cuerpo pequeños para la API si vas a guardar series
grandes (hasta 10 MB por envío).

## Uso

1. Descarga de [inegi.org.mx/datosabiertos](https://www.inegi.org.mx/datosabiertos/) el ZIP en CSV
   de un censo de gobierno y arrástralo al recuadro (puedes cargar varios).
2. Selecciona variables. Cada tabla puede **desagregarse** por una columna de catálogo (tipo de
   trámite, pueblo indígena, institución…). "Número de registros" sirve para preguntas Sí/No.
3. En el espacio de trabajo cada tarjeta muestra el **total agregado** (suma de todas sus
   observaciones) y los subtotales de hombres y mujeres; «Ver valores» despliega el detalle.
   Acciones: **Crear tabla** (formato ancho), **Crear indicador** (se calcula sobre los totales;
   fórmulas con `+ - * / ^`, `redondear`, `raiz`, `ln`, `log`, `abs` y componentes `A.total`,
   `A.hombres`, `A.mujeres`; con variables estatales puede calcularse también por entidad, donde
   además funcionan `suma`, `promedio`, `min` y `max`), **Mapa** (variables estatales),
   **Descargar** (Excel o CSV) y **Agregar información manualmente** (p. ej. población para tasas).
4. Códigos del INEGI que se conservan: NA (no aplica), NSS (no cuenta con elementos para
   responder), ND (no disponible), NP (no publicable). `*` = suma parcial (se omitieron registros
   NSS/ND/NP); `—` = la fuente no trae ese dato.

## Estructura

```
src/            servidor: app.js (Express, seguridad, API), sesion.js, supabase.js, validacion.js, config.js
public/         portal estático
  js/core/      núcleo isomorfo: csv, zip, inegi, agregacion, paquete, indicadores, exportar, manual, entidades
  js/           interfaz: app.js, procesador(.worker).js, mapa.js, ui.js, api.js
  data/         mexico-estados.json (generado con scripts/construir-mapa.js desde Natural Earth)
db/schema.sql   esquema de Supabase
scripts/        db-setup, crear-admin, construir-mapa
test/           pruebas (node:test)
docs/           análisis y arquitectura
```

Mapa: Natural Earth 1:10m Admin 1 (dominio público).
