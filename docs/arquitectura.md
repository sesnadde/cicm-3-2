# Arquitectura, decisiones y supuestos

## Objetivo y restricción principal

Portal público para que la ciudadanía procese paquetes de datos abiertos del INEGI **sin una
infraestructura costosa de almacenamiento**. Por eso el procesamiento ocurre en el navegador de
quien usa el portal y el servidor queda reducido a servir archivos estáticos y una API mínima.

```
Navegador (perfil usuario y administrador)                 Servidor Node.js (Express)
┌──────────────────────────────────────────────┐            ┌──────────────────────────────┐
│ app.js (interfaz)                            │  estáticos │ public/ (HTML, CSS, JS, mapa) │
│   ├─ procesador.js ──► Web Worker            │◄───────────│ /vendor/fflate.js             │
│   │     └─ core/: zip, csv, inegi, agregación │            │                              │
│   ├─ core/indicadores.js, exportar.js        │  JSON      │ /api/sesion  (Supabase Auth)  │
│   ├─ mapa.js (SVG coroplético)               │───────────►│ /api/series  (tabla series)   │
│   └─ caché temporal: sessionStorage          │            └──────────────┬───────────────┘
└──────────────────────────────────────────────┘                           │ HTTPS (service_role)
          El ZIP nunca sale del navegador                          ┌───────▼────────┐
                                                                   │    Supabase     │
                                                                   └────────────────┘
```

## Decisiones

| Tema | Decisión | Por qué |
|---|---|---|
| Dónde se procesa | En el navegador, dentro de un Web Worker | Costo de servidor casi nulo, escala con el número de personas, privacidad (el archivo no se sube) y sin exposición del servidor a ZIP maliciosos. La página no se congela. |
| Núcleo | Módulos ES puros en `public/js/core/` | El mismo código corre en el navegador y en Node (pruebas). Sin paso de compilación. |
| Memoria | El worker conserva solo el ZIP comprimido (≈1–6 MB por paquete) y descomprime cada tabla bajo demanda; caché LRU de 4 tablas parseadas; límite de 250 MB por sesión | Un paquete descomprimido pesa hasta ~60 MB; mantenerlo entero no es necesario. |
| ZIP | fflate 0.8.3 (≈ 22 kB comprimido) con límites de entradas, tamaño y razón de compresión | 0.8.0–0.8.2 tienen un bucle infinito con ZIP64 malformados (GHSA-px8p-9vwx-vf98). |
| Caché del perfil usuario | `sessionStorage` (se borra al cerrar la pestaña) | "Procesar temporalmente sin persistir": nada se guarda en el servidor. |
| Persistencia del administrador | Tabla `series` en Supabase, valores en JSONB, `upsert` por nombre+nivel+año+desagregación | Cada serie se guarda y lee completa, de forma atómica; volumen pequeño (agregados, no microdatos). |
| Acceso a Supabase | `supabase-js` por HTTPS con `service_role` solo en el servidor; RLS activado sin políticas | El host directo de la BD es solo IPv6 y muchas redes bloquean el 5432; HTTPS funciona en cualquier hosting. Las llaves públicas no pueden leer ni escribir la tabla. |
| Autenticación | Supabase Auth valida la contraseña; el servidor emite su propia cookie HttpOnly, SameSite=Strict, firmada (HMAC, 8 h) y vuelve a comprobar el rol en cada escritura | No se almacenan contraseñas; la revocación del rol es inmediata para escribir. |
| Rol de administración | `app_metadata.role = "admin"` (solo modificable con `service_role`) | `user_metadata` lo puede cambiar el propio usuario; `app_metadata` no. |
| Lectura de series guardadas | Pública (solo lectura) | La única diferencia entre perfiles es poder **guardar** (y eliminar). |
| Mapa | SVG pre-proyectado de Natural Earth (dominio público), 39 kB | Sin librerías de mapas ni teselas externas; descarga SVG/PNG idéntica a la pantalla. |
| Exportación | CSV (UTF-8 con BOM) y XLSX generado a mano (OOXML mínimo) | Sin dependencias pesadas; textos como cadenas en línea, nunca como fórmulas. |
| Fórmulas | Analizador descendente recursivo propio, sin `eval` | Seguridad (sin ejecución de código) y mensajes de error en español. |

## Supuestos (revisar si no aplican)

1. **Año** = edición del censo (p. ej. 2025, como en la maqueta). El **periodo de referencia**
   (2024) se conserva aparte y se incluye en las descargas.
2. **Nivel**: tablas con `cve_ent` → Estatal (unidad: entidad, se suman instituciones); sin
   `cve_ent` → Federal (unidad: institución del catálogo `instadmi_*` o "Total federal").
   Solo se validaron CNGE y CNGF 2025; otros censos con la misma estructura deberían funcionar,
   pero el municipal (CNGMD) se agregaría por entidad.
3. **Total sin publicar**: si la fuente solo trae hombres y mujeres, el total se muestra "—"; no
   se calcula H+M porque puede haber registros "no identificado". Se puede obtener con un
   indicador (`A.hombres + A.mujeres`).
4. **Crear tabla** (botón de la maqueta) = tabla ancha (una fila por unidad, una columna por
   variable y componente) de las variables seleccionadas, descargable.
5. **Total agregado**: cada tarjeta muestra en Total/Hombres/Mujeres la suma de todas sus
   observaciones (entidades o instituciones), con la misma regla de códigos y sumas parciales.
   Se rotula "Estados Unidos Mexicanos" (estatal) o "Total federal", y encabeza las descargas
   (clave `TOTAL`).
6. **Indicadores**: se calculan sobre el **total agregado** de cada variable y, por separado, con
   los subtotales de hombres y de mujeres (no observación por observación). Con `A.mujeres`,
   `A.total`… el resultado es un solo valor (columna Total). Si todas las variables son
   estatales se puede marcar «Calcular también por entidad federativa»: se emparejan filas por
   entidad y categoría, lo que habilita el mapa; la tarjeta sigue mostrando el valor calculado
   sobre los totales (se guarda en `resumen`, porque sumar porcentajes o tasas por entidad no
   tendría sentido).
7. **Captura manual**: a nivel estatal se reconocen nombres (con o sin acentos, alias como CDMX)
   o claves 01–32; a nivel federal la unidad es el texto escrito.
8. Las **series guardadas** se pueden consultar públicamente; solo el administrador guarda y elimina.

## Revisión crítica de `ArieBrito/gestor_variables`

| Componente | Decisión |
|---|---|
| RLS activado sin políticas + `service_role` solo en el backend | **Reutilizado** (concepto). |
| Cookie de sesión firmada, límite de intentos de login, cabeceras de seguridad | **Reutilizado** (concepto), reescrito sin dependencias. |
| Extracción del ZIP a disco y búsqueda heurística de carpetas con múltiples respaldos | **Descartado**: la estructura del INEGI es uniforme; se lee en memoria (sin rutas largas en Windows ni archivos temporales). |
| Procesamiento en el servidor con tareas en memoria y sondeo de progreso | **Descartado**: el procesamiento pasa al navegador. |
| Clasificador ML (TF-IDF + Naive Bayes) para eje/tema | **Descartado**: fuera del alcance solicitado. |
| Tabla `variables` EAV con `valor` como texto y jerarquía `parent_id` | **Rediseñado**: series con valores numéricos tipados y códigos del INEGI separados. |
| Usuarios propios con hashes de Werkzeug y admin por defecto `admin/admin123` | **Descartado**: Supabase Auth, sin contraseñas por defecto. |
| Despliegue en Netlify Functions | **Reconsiderado y adoptado**: se había descartado por el límite de ~6 MB por petición (los ZIP de muestra llegan a 6,2 MB), pero los ZIP ya se procesan en el navegador y nunca se suben. El portal se publica en el CDN (`dist/`, con las cabeceras de seguridad en `_headers`) y la API corre como función moderna en `/api/*`, que reenvía cada petición a la misma app Express escuchando en `127.0.0.1` dentro de la función: una sola implementación para Netlify, Docker y `npm start`, sin dependencias extra. Costos: 6 MB por envío al guardar series y límite de intentos de inicio de sesión por instancia. No se usa el modo Lambda (`exports.handler`, p. ej. con `serverless-http`) porque Netlify deja de aceptarlo el 1 de julio de 2027. |
| Frontend de 5 300 líneas en un archivo | **Rediseñado** en módulos pequeños. |

## Seguridad

- Llaves: `.env` fuera del repositorio (`.gitignore`); `service_role` nunca llega al navegador.
- CSP estricta (`default-src 'self'`, sin scripts en línea), `nosniff`, `frame-ancestors 'none'`,
  `Referrer-Policy: no-referrer`, HSTS en producción.
- CSRF: cookie SameSite=Strict, verificación de `Origin` y `Content-Type: application/json`.
- Validación estricta (lista blanca) del cuerpo al guardar; límites de tamaño (10 MB, 50 series,
  100 000 filas); errores internos sin detalles.
- XSS: la interfaz nunca usa `innerHTML` con datos; todo texto se inserta como nodo de texto.
- Inyección en hojas de cálculo: el CSV antepone `'` a textos que inician con `= + - @`.

## Costos y despliegue

El servidor necesita ~60 MB de RAM y casi nada de CPU (no procesa archivos). Cabe en el nivel
gratuito o más bajo de Cloud Run, Fly.io, Railway, Render o una VM pequeña; Supabase en su plan
gratuito alcanza para las series agregadas (cada serie estatal ocupa pocos kB). Ver README.
