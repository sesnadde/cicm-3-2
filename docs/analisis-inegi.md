# Análisis de los paquetes de datos abiertos del INEGI

Base empírica: 8 paquetes CSV de los censos de gobierno 2025 (CNGE: estatal; CNGF: federal),
con 157 tablas y 1 079 variables detectadas. La prueba `test/paquetes-reales.test.js` vuelve a
leer y calcular todas las tablas cuando los ZIP están disponibles en `../INEGI` o `INEGI_DIR`.

| Paquete | Censo | Tablas |
|---|---|---|
| `ctrl_interno_anticorr_cnge2025` | CNGE | 47 |
| `ctrl_interno_anticorrup_cngf2025` | CNGF | 47 |
| `profesionaliz_personal_cnge2025` / `_cngf2025` | CNGE / CNGF | 12 / 12 |
| `programa_social_cnge2025` | CNGE | 9 |
| `rec_huma_cnge2025` / `_cngf2025` | CNGE / CNGF | 16 / 18 |
| `tramite_servicio_cnge2025` | CNGE | 4 |

## 1. Estructura (idéntica en los 8 ZIP)

```
readme.txt                                   descripción de las carpetas
catalogos/<columna>_<censo><año>.csv         un catálogo por columna codificada
conjunto_de_datos/0_indice_<censo><año>.csv  ARCHIVO, CONTENIDO (tabla → descripción)
conjunto_de_datos/<tabla>_<censo><año>.csv   datos (p. ej. m1s1p8_cnge2025.csv)
diccionario_de_datos/diccionario_de_datos_<tabla>_<censo><año>.csv
diccionario_de_datos/readme.txt              significado de NA, NSS, ND, NP
metadatos/metadatos_<censo>_<año>.txt        "Identifier:", "Title:", descripción
modelo_entidad_relacion/*.png                diagrama E-R (no se usa)
```

- **Nombre de tabla**: `m<módulo>s<sección>p<pregunta>` con variantes `cp<n>` (complementos) y
  sufijos de letra (`m1s5p28a`). El sufijo `_<censo><año>` es común a todo el paquete y se deduce
  del archivo índice.
- **Codificación**: UTF-8 (con y sin BOM) y fin de línea CRLF o LF. Los paquetes de años anteriores
  del INEGI usaban Windows-1252; el lector intenta UTF-8 estricto y, si falla, Windows-1252.
- **Rutas largas**: al extraer en Windows las rutas superan 260 caracteres. El portal nunca
  extrae a disco: lee el ZIP en memoria.

## 2. Diccionario de datos

Columnas: `COLUMNA, DESCRIPCION, ORIGEN, TIPO_DATO, LONGITUD, CODIGO_VALIDO`. El campo decisivo es
`CODIGO_VALIDO` (el `TIPO_DATO` de los conteos es "Carácter" porque admiten códigos de texto):

| CODIGO_VALIDO | Columnas | Tratamiento |
|---|---|---|
| `0-999999999999999, NA, NSS, ND, NP, NULL` | 1 353 | **conteo**: se suma |
| `1, NA, NSS, ND, NP, NULL` | 187 | **marca** (1 = sí): se suma = registros marcados |
| `0 al 98`, `1 al 999`… (Numérico) | 182 | **código de catálogo**: dimensión para desagregar |
| `01 al 99` | 166 | claves geográficas `cvegeo`, `cve_ent` |
| `0-5000`, `0-100`, `18-99`… | 91 | identificadores, años, edades: no se suman |
| vacío | 127 | texto libre (`nombre1`…) |

Todas las columnas numéricas tienen catálogo con el mismo nombre (`catalogos/<columna>_…csv`).

## 3. Unidad de análisis

| Patrón de columnas clave | Tablas | Unidad en el portal |
|---|---|---|
| `cvegeo, cve_ent[, numeral, nombre1]` | CNGE | entidad federativa (suma de instituciones) → **mapa** |
| `instadmi_j` / `instadmi_k` / `instadmi_n` (catálogo de instituciones) | CNGF | institución federal |
| sin clave de unidad (una fila o una fila por categoría) | CNGF | "Total federal" |

`cve_ent` usa claves 01–32 más 34 (No identificado) y 99 (No especificado); el mapa solo
dibuja 01–32. Otras columnas de catálogo (`autoinst_y`, `tramitse_r`, `puebindi_c`, `rnspni1`…) son
**dimensiones** por las que se puede desagregar; `nombre1` (texto) también.

## 4. Desagregación por sexo

Las columnas de una misma variable se reconocen por la DESCRIPCION, no por el nombre (los
prefijos varían: `sexostt/sexos1/sexos2`, `regcpftt/regcpf1…`, `edanis1/edani3…`). Regla:

1. Se divide la descripción por `" - "`; el último segmento define el rol:
   `Total`/`Subtotal` → total, `Hombres` → hombres, `Mujeres` → mujeres; cualquier otro → total.
2. El resto es la base de la variable; un segmento final `Total` se elimina
   (`"Total - Hombres"` y `"Confianza - Total - Hombres"` pertenecen a la variable sin "Total").
3. Si dos columnas compiten por el mismo rol de la misma base, la segunda se vuelve variable propia.
4. En las columnas de **marca** (0/1) no se buscan sexos: en `programa_social m1s3p7`,
   "Grupo vulnerable - Mujeres" es una categoría de población, no una desagregación por sexo.

Resultado en los 8 paquetes (1 079 variables): 302 con total, hombres y mujeres; 14 solo con
hombres y mujeres (p. ej. "Ocupadas": la fuente no publica su total y se muestra "—"); 419 conteos
sin desagregación por sexo; 187 marcas; y 157 **Número de registros** (una por tabla), que
combinado con una desagregación permite analizar las 17 tablas puramente categóricas
(p. ej. "Existencia de código de ética: Sí/No" por entidad).

## 5. Valores especiales y trampas detectadas

- **Códigos**: `NA` (no aplica), `NSS` (no cuenta con elementos), `ND` (no disponible),
  `NP` (no publicable) y celda vacía/`NULL`. Al sumar: si hay números, se suman y la celda se
  marca como **suma parcial** cuando algún registro era NSS/ND/NP; si no hay números, se conserva
  el código (prioridad NP > ND > NSS > NA).
- **Orden de columnas distinto al diccionario** (`rec_huma_cnge m1s1p6`: `partpoli_b` y
  `modalspc_a` intercambiadas) → siempre se indexa por nombre de columna, nunca por posición.
- **Fila "TOTAL" dentro de los datos** (`ctrl_interno_cnge m1s5p28a`, CDMX, numeral 84): su
  valor (397) es la suma de las demás filas → se excluyen las filas con `nombre1 = "TOTAL"`.
- **`numeral = 0`** significa "OTRA INSTITUCION" o la persona titular del Ejecutivo; no es total.
- **Comas dentro de campos** entre comillas (nombres de institución, catálogos).
- **Periodo de referencia**: el censo 2025 informa sobre 2024 ("al cierre del año 2024",
  "durante el año 2024"); se toma del texto del índice.

## 6. Verificación

Valores calculados por el portal y comparados con un cálculo independiente (Python, módulo `csv`):

| Caso | Esperado |
|---|---|
| CNGE m1s1p8, Jalisco: total / hombres / mujeres | 149 806 / 60 289 / 89 517 |
| CNGF m1s2p3, Secretaría de Gobernación | 3 327 / 1 627 / 1 700 |
| CNGE m1s5p28a, CDMX (sin duplicar fila TOTAL) | 397 |
| CNGE m1s2p1, solicitudes recibidas (32 entidades) | 288 739 825 |
