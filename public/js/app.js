// Controlador de la interfaz: carga de ZIP → selección de variables → espacio de trabajo
// (tabla, indicadores, mapa, descargas) → guardado en base de datos (solo administración).
import { $, el, aviso, celdaValor, descargar, fechaArchivo, normalizar, ocultarTooltip } from './ui.js';
import { cargarZip, calcular } from './procesador.js';
import { calcularIndicador, compilarFormula } from './core/indicadores.js';
import { COMPONENTES } from './core/agregacion.js';
import { aCsv, aXlsx, filasAnchas, filasLargas } from './core/exportar.js';
import { ENTIDADES } from './core/entidades.js';
import { interpretarManual } from './core/manual.js';
import { dibujarMapa, svgComoPng, svgComoTexto } from './mapa.js';
import { zipSync } from '../vendor/fflate.js';
import * as api from './api.js';

const ETIQUETAS = { total: 'Total', hombres: 'Hombres', mujeres: 'Mujeres' };
const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const FILAS_VISIBLES = 300;
const MAX_CATEGORIAS_MAPA = 60;
const CLAVE_CACHE = 'cicm.trabajo.v1';

const estado = {
  paquetes: [], // [{ id, nombre, estructura }] abiertos en el worker
  series: [], // espacio de trabajo
  seleccion: [], // ids de series, en orden de selección (define las letras A, B, C…)
  abiertas: new Set(), // series expandidas
  completas: new Set(), // series con todas sus filas visibles
  perfil: { rol: 'usuario', bd: false },
};

const nuevoId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const llaveSerie = (s) => JSON.stringify([s.nombre, s.nivel, s.anio ?? null, s.desagregacion ?? null]);
const seleccionadas = () => estado.seleccion.map((id) => estado.series.find((s) => s.id === id)).filter(Boolean);
const esAdmin = () => estado.perfil.rol === 'admin';

// ---------------------------------------------------------------------------
// Caché temporal del espacio de trabajo (sessionStorage: se borra al cerrar la pestaña)
// ---------------------------------------------------------------------------
let avisoCache = false;
function guardarCache() {
  try {
    sessionStorage.setItem(CLAVE_CACHE, JSON.stringify({ series: estado.series, seleccion: estado.seleccion }));
  } catch {
    try { sessionStorage.removeItem(CLAVE_CACHE); } catch { /* sin almacenamiento */ }
    if (!avisoCache) aviso('El espacio de trabajo es grande: no se conservará si recargas la página. Descarga tus resultados.');
    avisoCache = true;
  }
}
function leerCache() {
  try {
    const datos = JSON.parse(sessionStorage.getItem(CLAVE_CACHE) ?? 'null');
    if (Array.isArray(datos?.series)) {
      estado.series = datos.series;
      estado.seleccion = (datos.seleccion ?? []).filter((id) => datos.series.some((s) => s.id === id));
    }
  } catch { /* caché ilegible: se ignora */ }
}

function agregarSeries(nuevas) {
  const existentes = new Set(estado.series.map(llaveSerie));
  let omitidas = 0;
  for (const s of nuevas) {
    if (existentes.has(llaveSerie(s))) { omitidas++; continue; }
    existentes.add(llaveSerie(s));
    estado.series.push(s);
  }
  if (omitidas) aviso(`${omitidas} serie(s) ya estaban en el espacio de trabajo y no se duplicaron.`);
  guardarCache();
  pintarTrabajo();
  return nuevas.length - omitidas;
}

// ---------------------------------------------------------------------------
// Perfil y sesión
// ---------------------------------------------------------------------------
function pintarPerfil() {
  const admin = esAdmin();
  $('#btn-perfil').textContent = admin ? 'ADMINISTRADOR' : 'USUARIO';
  $('#perfil-info').textContent = admin
    ? `Sesión: ${estado.perfil.email}. Puedes guardar series en la base de datos.`
    : estado.perfil.bd
      ? 'Perfil público: procesas datos en tu navegador, sin guardarlos.'
      : 'Perfil público. El acceso de administración no está disponible en este servidor.';
  $('#btn-login').hidden = admin || !estado.perfil.bd;
  $('#btn-logout').hidden = !admin;
  $('#btn-guardar').hidden = !admin;
  $('#btn-guardadas').hidden = !estado.perfil.bd;
}

const menu = $('#menu-perfil');
const alternarMenu = (abrir = menu.hidden) => {
  menu.hidden = !abrir;
  $('#btn-perfil').setAttribute('aria-expanded', String(abrir));
};
$('#btn-perfil').addEventListener('click', () => alternarMenu());
document.addEventListener('click', (e) => { if (!e.target.closest('.perfil')) alternarMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') alternarMenu(false); });

$('#btn-login').addEventListener('click', () => {
  alternarMenu(false);
  $('#login-error').textContent = '';
  $('#form-login').reset();
  $('#dlg-login').showModal();
});
$('#form-login').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'entrar') return;
  e.preventDefault();
  try {
    estado.perfil = await api.entrar($('#login-email').value, $('#login-password').value);
    $('#form-login').reset(); // no dejar la contraseña en el DOM
    $('#dlg-login').close();
    pintarPerfil();
    aviso('Sesión iniciada como administrador.', 'exito');
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});
$('#btn-logout').addEventListener('click', async () => {
  alternarMenu(false);
  await api.salir().catch(() => {});
  estado.perfil = { rol: 'usuario', bd: estado.perfil.bd };
  pintarPerfil();
});

// ---------------------------------------------------------------------------
// Carga de ZIP y selección de variables
// ---------------------------------------------------------------------------
const dlgVariables = $('#dlg-variables');
const marcadas = new Map(); // `${paqueteId}|${variableId}` → { paqueteId, tabla, variableId }
const desagregaciones = new Map(); // `${paqueteId}|${tabla}` → columna

function progreso(pct, texto) {
  $('#carga').hidden = false;
  $('#carga-texto').textContent = texto;
  $('#progreso-barra').style.width = `${pct}%`;
  $('#progreso').setAttribute('aria-valuenow', String(Math.round(pct)));
}

async function cargarArchivos(archivos) {
  const zips = [...archivos].filter((a) => /\.zip$/i.test(a.name));
  if (!zips.length) return aviso('Selecciona un archivo .zip de datos abiertos del INEGI.', 'error');
  if (!dlgVariables.open) dlgVariables.showModal();
  $('#seleccion').hidden = !estado.paquetes.length;
  $('#btn-siguiente').disabled = true;
  let ultimo = null;
  for (const [i, archivo] of zips.entries()) {
    const prefijo = zips.length > 1 ? `Archivo ${i + 1} de ${zips.length}: ` : '';
    try {
      const { id, estructura } = await cargarZip(archivo, (pct, texto) => progreso(pct, prefijo + texto));
      estado.paquetes.push({ id, nombre: archivo.name, estructura });
      ultimo = id;
    } catch (err) {
      aviso(`${archivo.name}: ${err.message}`, 'error');
    }
  }
  if (!estado.paquetes.length) {
    progreso(0, 'No se pudo cargar el archivo. Revisa que sea un ZIP de datos abiertos del INEGI.');
    return;
  }
  progreso(100, ultimo ? 'Listo.' : 'No se pudo cargar el archivo; puedes usar los paquetes ya cargados.');
  pintarSeleccion(ultimo);
}

function pintarSeleccion(paqueteAbierto) {
  const lista = $('#lista-variables');
  lista.replaceChildren();
  const advertencias = [];
  for (const p of [...estado.paquetes].reverse()) {
    const e = p.estructura;
    advertencias.push(...e.advertencias.map((a) => `${e.censo} ${e.anio}: ${a}`));
    lista.append(el('h3', { class: 'sub' }, `${e.titulo} · ${p.nombre}`));
    for (const t of e.tablas) {
      const llaveTabla = `${p.id}|${t.clave}`;
      const cuenta = el('span', { class: 'cuenta' });
      const actualizarCuenta = () => {
        const n = t.variables.filter((v) => marcadas.has(`${p.id}|${v.id}`)).length;
        cuenta.textContent = n ? ` · ${n} seleccionada(s)` : '';
      };
      const detalles = el('details', { class: 'grupo-tabla', open: p.id === paqueteAbierto && e.tablas.length <= 3 },
        el('summary', {}, `${t.titulo} `, el('span', { class: 'clave' }, `(${t.clave} · ${t.nivel})`), cuenta));
      detalles.dataset.buscar = normalizar(`${t.titulo} ${t.clave} ${t.contenido}`);
      if (t.dimensiones.length) {
        const select = el('select', { class: 'campo', 'aria-label': `Desagregación de ${t.clave}` },
          el('option', { value: '' }, 'Sin desagregar (suma por estado o institución)'),
          t.dimensiones.map((d) => el('option', { value: d.columna, selected: desagregaciones.get(llaveTabla) === d.columna }, `Por ${d.etiqueta.toLowerCase()}`)));
        select.addEventListener('change', () => (select.value ? desagregaciones.set(llaveTabla, select.value) : desagregaciones.delete(llaveTabla)));
        detalles.append(el('label', { class: 'desagregar' }, 'Desagregar:', select));
      }
      for (const v of t.variables) {
        const llave = `${p.id}|${v.id}`;
        const check = el('input', { type: 'checkbox', checked: marcadas.has(llave) });
        check.addEventListener('change', () => {
          if (check.checked) marcadas.set(llave, { paqueteId: p.id, tabla: t.clave, variableId: v.id });
          else marcadas.delete(llave);
          actualizarCuenta();
          $('#btn-siguiente').disabled = !marcadas.size;
        });
        const opcion = el('label', { class: 'opcion-variable' }, check, el('span', {}, v.etiqueta));
        opcion.dataset.buscar = normalizar(v.etiqueta);
        detalles.append(opcion);
      }
      actualizarCuenta();
      lista.append(detalles);
    }
  }
  $('#advertencias').hidden = !advertencias.length;
  $('#advertencias').textContent = advertencias.join(' ');
  const total = estado.paquetes.reduce((s, p) => s + p.estructura.tablas.length, 0);
  $('#seleccion-paquete').textContent = `${estado.paquetes.length} paquete(s) · ${total} tablas. Abre una tabla para ver sus variables.`;
  $('#seleccion').hidden = false;
  $('#btn-siguiente').disabled = !marcadas.size;
  $('#buscar-variable').value = '';
}

$('#buscar-variable').addEventListener('input', (e) => {
  const q = normalizar(e.target.value.trim());
  for (const d of $('#lista-variables').querySelectorAll('details')) {
    const tablaCoincide = d.dataset.buscar.includes(q);
    let alguna = false;
    for (const o of d.querySelectorAll('.opcion-variable')) {
      const visible = !q || tablaCoincide || o.dataset.buscar.includes(q);
      o.hidden = !visible;
      alguna ||= visible;
    }
    d.hidden = Boolean(q) && !alguna;
    if (q) d.open = alguna;
  }
});

$('#btn-vaciar').addEventListener('click', () => {
  marcadas.clear();
  desagregaciones.clear();
  pintarSeleccion(null);
});

$('#btn-siguiente').addEventListener('click', async () => {
  const boton = $('#btn-siguiente');
  boton.disabled = true;
  progreso(60, 'Calculando variables…');
  try {
    const nuevas = [];
    for (const p of estado.paquetes) {
      const porTabla = new Map();
      for (const m of marcadas.values()) {
        if (m.paqueteId !== p.id) continue;
        if (!porTabla.has(m.tabla)) porTabla.set(m.tabla, []);
        porTabla.get(m.tabla).push(m.variableId);
      }
      if (!porTabla.size) continue;
      const peticiones = [...porTabla].map(([tabla, variables]) => ({ tabla, variables, desagregarPor: desagregaciones.get(`${p.id}|${tabla}`) ?? null }));
      for (const r of await calcular(p.id, peticiones)) nuevas.push(construirSerie(p.estructura, r));
    }
    const agregadas = agregarSeries(nuevas);
    marcadas.clear();
    dlgVariables.close();
    if (agregadas) aviso(`${agregadas} variable(s) agregadas al espacio de trabajo.`, 'exito');
  } catch (err) {
    aviso(err.message, 'error');
    progreso(0, 'No se pudieron calcular las variables.');
  } finally {
    boton.disabled = !marcadas.size;
  }
});

function construirSerie(estructura, resultado) {
  const tabla = estructura.tablas.find((t) => t.clave === resultado.tabla);
  const variable = tabla.variables.find((v) => v.id === resultado.variableId);
  const dim = tabla.dimensiones.find((d) => d.columna === resultado.desagregarPor);
  return {
    id: nuevoId(),
    tipo: 'variable',
    nombre: variable.nombre + (dim ? ` (por ${dim.etiqueta.toLowerCase()})` : ''),
    nivel: tabla.nivel,
    anio: estructura.anio,
    periodo: tabla.periodo,
    fuente: `INEGI. ${estructura.titulo}. Tabla ${tabla.clave}: ${tabla.contenido}`,
    desagregacion: dim?.etiqueta ?? null,
    filas: resultado.filas,
  };
}

const entrada = $('#entrada-zip');
entrada.addEventListener('change', () => { cargarArchivos(entrada.files); entrada.value = ''; });
$('#btn-otro-zip').addEventListener('click', () => entrada.click());
$('#btn-mas-variables').addEventListener('click', () => {
  pintarSeleccion(null);
  $('#carga').hidden = true;
  dlgVariables.showModal();
});
const zona = $('#zona-carga');
for (const ev of ['dragenter', 'dragover']) zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add('activa'); });
for (const ev of ['dragleave', 'drop']) zona.addEventListener(ev, () => zona.classList.remove('activa'));
zona.addEventListener('drop', (e) => { e.preventDefault(); cargarArchivos(e.dataTransfer.files); });
// Soltar un ZIP en cualquier parte de la página (también en el espacio de trabajo)
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { if (!e.target.closest('#zona-carga')) { e.preventDefault(); cargarArchivos(e.dataTransfer.files); } });

// ---------------------------------------------------------------------------
// Espacio de trabajo
// ---------------------------------------------------------------------------
function pintarTrabajo() {
  const hay = estado.series.length > 0;
  $('#vista-inicio').hidden = hay;
  $('#vista-trabajo').hidden = !hay;
  $('#btn-mas-variables').hidden = !estado.paquetes.length;
  const tabla = $('#tabla-trabajo');
  for (const tb of tabla.querySelectorAll('tbody')) tb.remove();
  estado.series.forEach((s) => tabla.append(cuerpoSerie(s)));
  const n = estado.seleccion.length;
  $('#check-todas').checked = hay && n === estado.series.length;
  $('#check-todas').indeterminate = n > 0 && n < estado.series.length;
  $('#ayuda-seleccion').textContent = n
    ? `${n} seleccionada(s). En «Crear indicador» se nombran con las letras que aparecen junto a cada variable.`
    : 'Selecciona variables con las casillas para crear tablas, indicadores, descargar o guardar.';
}

function cuerpoSerie(s) {
  const tbody = el('tbody');
  const pos = estado.seleccion.indexOf(s.id);
  const abierta = estado.abiertas.has(s.id);
  const check = el('input', { type: 'checkbox', checked: pos >= 0, 'aria-label': `Seleccionar ${s.nombre}` });
  check.addEventListener('change', () => {
    estado.seleccion = check.checked ? [...estado.seleccion, s.id] : estado.seleccion.filter((x) => x !== s.id);
    guardarCache();
    pintarTrabajo();
  });
  // Un mapa por categoría solo tiene sentido con pocas categorías (no, p. ej., una por institución).
  const tieneEntidades = s.nivel === 'Estatal' && s.filas.some((f) => ENTIDADES[f.clave])
    && new Set(s.filas.map((f) => f.categoria ?? '')).size <= MAX_CATEGORIAS_MAPA;
  const toggle = el('button', { type: 'button', class: 'mini', 'aria-expanded': String(abierta) }, `${abierta ? '▾ Ocultar' : '▸ Ver'} ${s.filas.length} valor(es)`);
  toggle.addEventListener('click', () => {
    abierta ? estado.abiertas.delete(s.id) : estado.abiertas.add(s.id);
    pintarTrabajo();
  });
  const quitar = el('button', { type: 'button', class: 'mini', title: 'Quitar del espacio de trabajo' }, 'Quitar');
  quitar.addEventListener('click', () => {
    estado.series = estado.series.filter((x) => x.id !== s.id);
    estado.seleccion = estado.seleccion.filter((x) => x !== s.id);
    guardarCache();
    pintarTrabajo();
  });
  const etiquetaTipo = s.origen === 'bd' ? ['guardada', 'Guardada'] : s.tipo === 'indicador' ? ['indicador', 'Indicador'] : s.tipo === 'manual' ? ['manual', 'Manual'] : null;
  // De la fuente se muestra hasta la clave de tabla; el texto completo va en el título y en las descargas.
  const fuenteCorta = s.tipo === 'variable' ? s.fuente?.split(':')[0] : s.fuente;
  const meta = [s.desagregacion && `Desagregada por ${s.desagregacion.toLowerCase()}`, s.formula && `Fórmula: ${s.formula}`, fuenteCorta].filter(Boolean).join(' · ');
  tbody.append(el('tr', { class: `serie-cabecera${pos >= 0 ? ' seleccionada' : ''}` },
    el('td', { class: 'col-check' }, check),
    el('td', {},
      pos >= 0 ? el('span', { class: 'letras' }, el('b', {}, LETRAS[pos] ?? '?')) : null,
      el('span', { class: 'serie-nombre' }, s.nombre),
      etiquetaTipo && el('span', { class: `etiqueta-tipo ${etiquetaTipo[0]}` }, etiquetaTipo[1]),
      el('span', { class: 'serie-meta', title: s.fuente ?? '' }, meta.length > 220 ? `${meta.slice(0, 219)}…` : meta)),
    el('td', {}, s.nivel),
    el('td', {}, s.anio ?? '—'),
    el('td', {}, toggle),
    el('td', { colspan: 3 }, el('div', { class: 'serie-acciones' },
      tieneEntidades && el('button', { type: 'button', class: 'mini', onclick: () => abrirMapa(s) }, 'Mapa'),
      quitar))));
  if (abierta) {
    const limite = estado.completas.has(s.id) ? Infinity : FILAS_VISIBLES;
    for (const f of s.filas.slice(0, limite)) {
      tbody.append(el('tr', { class: 'fila-valor' }, el('td'), el('td'), el('td'), el('td'),
        el('td', {}, f.unidad, f.categoria ? el('span', { class: 'serie-meta categoria' }, f.categoria) : null),
        celdaValor(f.total), celdaValor(f.hombres), celdaValor(f.mujeres)));
    }
    if (s.filas.length > limite) {
      const mas = el('button', { type: 'button', class: 'enlace' }, `Mostrar las ${s.filas.length} filas`);
      mas.addEventListener('click', () => { estado.completas.add(s.id); pintarTrabajo(); });
      tbody.append(el('tr', { class: 'mas-filas' }, el('td', { colspan: 8 }, `Se muestran ${limite} de ${s.filas.length}. `, mas)));
    }
  }
  return tbody;
}

$('#check-todas').addEventListener('change', (e) => {
  estado.seleccion = e.target.checked ? estado.series.map((s) => s.id) : [];
  guardarCache();
  pintarTrabajo();
});

function exigirSeleccion(minimo = 1) {
  if (estado.seleccion.length >= minimo) return seleccionadas();
  aviso('Primero selecciona al menos una variable con su casilla.', 'error');
  return null;
}

// ---------------------------------------------------------------------------
// Indicadores
// ---------------------------------------------------------------------------
const comun = (valores) => (new Set(valores).size === 1 ? valores[0] : null);

function previsualizarIndicador() {
  const series = seleccionadas().slice(0, LETRAS.length);
  const entradas = Object.fromEntries(series.map((s, i) => [LETRAS[i], s]));
  const formula = $('#indicador-formula').value;
  const previa = $('#indicador-previa');
  previa.replaceChildren();
  $('#indicador-error').textContent = '';
  if (!formula.trim()) return null;
  try {
    compilarFormula(formula, Object.keys(entradas));
    const filas = calcularIndicador(formula, entradas);
    const tabla = el('table', { class: 'tabla-datos' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Vista previa'), ...COMPONENTES.map((c) => el('th', { class: 'num' }, ETIQUETAS[c])))),
      el('tbody', {}, filas.slice(0, 6).map((f) => el('tr', {}, el('td', {}, f.unidad + (f.categoria ? ` · ${f.categoria}` : '')), ...COMPONENTES.map((c) => celdaValor(f[c]))))));
    previa.append(el('div', { class: 'tabla-contenedor tabla-modal' }, tabla));
    return filas;
  } catch (err) {
    $('#indicador-error').textContent = err.message;
    return null;
  }
}

$('#btn-indicador').addEventListener('click', () => {
  const series = exigirSeleccion();
  if (!series) return;
  if (series.length > LETRAS.length) return aviso(`Un indicador admite hasta ${LETRAS.length} variables.`, 'error');
  $('#indicador-letras').replaceChildren(...series.map((s, i) => el('li', {}, el('b', {}, LETRAS[i]), `${s.nombre} (${s.nivel}${s.anio ? `, ${s.anio}` : ''})`)));
  $('#form-indicador').reset();
  previsualizarIndicador();
  $('#dlg-indicador').showModal();
});
$('#indicador-formula').addEventListener('input', previsualizarIndicador);
$('#form-indicador').addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'crear') return;
  e.preventDefault();
  const filas = previsualizarIndicador();
  if (!filas) return void ($('#indicador-error').textContent ||= 'Escribe una fórmula.');
  const series = seleccionadas();
  const formula = $('#indicador-formula').value.trim();
  agregarSeries([{
    id: nuevoId(),
    tipo: 'indicador',
    nombre: $('#indicador-nombre').value.trim(),
    nivel: comun(series.map((s) => s.nivel)) ?? 'Mixto',
    anio: comun(series.map((s) => s.anio ?? null)),
    periodo: comun(series.map((s) => s.periodo ?? null)),
    fuente: `Indicador calculado con ${series.map((s, i) => `${LETRAS[i]} = ${s.nombre}`).join('; ')}`.slice(0, 1000),
    formula,
    desagregacion: comun(series.map((s) => s.desagregacion ?? null)),
    filas,
  }]);
  $('#dlg-indicador').close();
});

// ---------------------------------------------------------------------------
// Información capturada manualmente
// ---------------------------------------------------------------------------
$('#btn-manual').addEventListener('click', () => {
  $('#form-manual').reset();
  $('#manual-anio').value = new Date().getFullYear();
  $('#manual-error').textContent = '';
  $('#dlg-manual').showModal();
});
$('#btn-rellenar').addEventListener('click', () => {
  $('#manual-nivel').value = 'Estatal';
  $('#manual-valores').value = Object.values(ENTIDADES).map((n) => `${n}, `).join('\n');
  $('#manual-valores').focus();
});

$('#form-manual').addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'agregar') return;
  e.preventDefault();
  const nivel = $('#manual-nivel').value;
  const { filas, errores } = interpretarManual($('#manual-valores').value, nivel);
  if (errores.length || !filas.length) {
    $('#manual-error').textContent = errores.slice(0, 4).join(' ') || 'Captura al menos una fila con valores.';
    return;
  }
  const anio = Number($('#manual-anio').value) || null;
  agregarSeries([{
    id: nuevoId(), tipo: 'manual', nombre: $('#manual-nombre').value.trim(), nivel, anio, periodo: null,
    fuente: $('#manual-fuente').value.trim() || 'Captura manual', desagregacion: null, filas,
  }]);
  $('#dlg-manual').close();
});

// ---------------------------------------------------------------------------
// Tabla ancha y descargas
// ---------------------------------------------------------------------------
const nombreArchivo = (base, ext) => `${base}-${fechaArchivo()}.${ext}`;
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
let filasTabla = [];

$('#btn-tabla').addEventListener('click', () => {
  const series = exigirSeleccion();
  if (!series) return;
  filasTabla = filasAnchas(series);
  const [enc, ...cuerpo] = filasTabla;
  const tabla = el('table', { class: 'tabla-datos' },
    el('thead', {}, el('tr', {}, enc.map((h, i) => el('th', { class: i > 2 ? 'num' : '' }, h)))),
    el('tbody', {}, cuerpo.slice(0, 1000).map((f) => el('tr', { class: 'fila-valor' },
      f.map((v, i) => el('td', { class: i > 2 ? 'num' : '' }, typeof v === 'number' ? new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(v) : v))))));
  $('#tabla-ancha').replaceChildren(tabla);
  if (cuerpo.length > 1000) $('#tabla-ancha').append(el('p', { class: 'vacio' }, `Se muestran 1000 de ${cuerpo.length} filas; la descarga incluye todas.`));
  $('#dlg-tabla').showModal();
});
$('#btn-tabla-csv').addEventListener('click', () => descargar(nombreArchivo('tabla', 'csv'), aCsv(filasTabla), 'text/csv;charset=utf-8'));
$('#btn-tabla-xlsx').addEventListener('click', () => descargar(nombreArchivo('tabla', 'xlsx'), new Blob([aXlsx(filasTabla, zipSync, 'Tabla')], { type: MIME_XLSX })));

$('#btn-descargar').addEventListener('click', () => {
  $('#form-descargar').alcance.value = estado.seleccion.length ? 'seleccion' : 'todas';
  $('#dlg-descargar').showModal();
});
$('#form-descargar').addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'descargar') return;
  const f = e.target;
  const series = f.alcance.value === 'seleccion' ? seleccionadas() : estado.series;
  if (!series.length) {
    e.preventDefault();
    return aviso('No hay variables seleccionadas.', 'error');
  }
  const filas = filasLargas(series);
  if (f.formato.value === 'csv') descargar(nombreArchivo('resultados-inegi', 'csv'), aCsv(filas), 'text/csv;charset=utf-8');
  else descargar(nombreArchivo('resultados-inegi', 'xlsx'), new Blob([aXlsx(filas, zipSync, 'Resultados')], { type: MIME_XLSX }));
});

// ---------------------------------------------------------------------------
// Mapa coroplético
// ---------------------------------------------------------------------------
let mapaActual = null;

async function abrirMapa(serie) {
  const componentes = COMPONENTES.filter((c) => serie.filas.some((f) => f[c]?.v != null));
  if (!componentes.length) return aviso('Esta variable no tiene valores numéricos para mapear.', 'error');
  const categorias = [...new Set(serie.filas.map((f) => f.categoria ?? ''))];
  $('#mapa-componente').replaceChildren(...componentes.map((c) => el('option', { value: c }, ETIQUETAS[c])));
  $('#mapa-categoria').replaceChildren(...categorias.map((c) => el('option', { value: c }, c || '(sin categoría)')));
  $('#mapa-categoria-etiqueta').hidden = categorias.length < 2;
  mapaActual = { serie };
  $('#dlg-mapa').showModal();
  await redibujarMapa();
}

async function redibujarMapa() {
  const { serie } = mapaActual;
  const comp = $('#mapa-componente').value;
  const cat = $('#mapa-categoria').value;
  const valores = new Map(serie.filas.filter((f) => (f.categoria ?? '') === cat && ENTIDADES[f.clave]).map((f) => [f.clave, f[comp]]));
  const subtitulo = [ETIQUETAS[comp], cat, serie.anio].filter(Boolean).join(' · ');
  mapaActual.svg = await dibujarMapa($('#mapa'), { titulo: serie.nombre, subtitulo, fuente: serie.fuente ?? '', valores });
}
$('#mapa-componente').addEventListener('change', redibujarMapa);
$('#mapa-categoria').addEventListener('change', redibujarMapa);
$('#btn-mapa-svg').addEventListener('click', () => descargar(nombreArchivo('mapa', 'svg'), svgComoTexto(mapaActual.svg), 'image/svg+xml'));
$('#btn-mapa-png').addEventListener('click', async () => {
  try {
    descargar(nombreArchivo('mapa', 'png'), await svgComoPng(mapaActual.svg));
  } catch (err) {
    aviso(err.message, 'error');
  }
});

// ---------------------------------------------------------------------------
// Base de datos: guardar (administración) y consultar series guardadas
// ---------------------------------------------------------------------------
$('#btn-guardar').addEventListener('click', async () => {
  const series = exigirSeleccion();
  if (!series) return;
  const boton = $('#btn-guardar');
  boton.disabled = true;
  try {
    const cuerpo = series.map(({ id, origen, ...s }) => s);
    const { guardadas } = await api.guardarSeries(cuerpo);
    aviso(`${guardadas.length} serie(s) guardadas en la base de datos.`, 'exito');
  } catch (err) {
    aviso(`No se guardó: ${err.message}`, 'error');
    if (/administrador/i.test(err.message)) {
      estado.perfil = await api.sesion().catch(() => ({ rol: 'usuario', bd: true }));
      pintarPerfil();
    }
  } finally {
    boton.disabled = false;
  }
});

async function pintarGuardadas() {
  const contenedor = $('#lista-guardadas');
  contenedor.replaceChildren(el('p', { class: 'vacio' }, 'Cargando…'));
  try {
    const lista = await api.listarSeries();
    if (!lista.length) return contenedor.replaceChildren(el('p', { class: 'vacio' }, 'Aún no hay series guardadas.'));
    const fecha = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' });
    contenedor.replaceChildren(el('table', { class: 'tabla-datos' },
      el('thead', {}, el('tr', {}, ['Serie', 'Tipo', 'Nivel', 'Año', 'Filas', 'Actualizada', ''].map((h) => el('th', {}, h)))),
      el('tbody', {}, lista.map((s) => {
        const agregar = el('button', { type: 'button', class: 'mini' }, 'Agregar');
        agregar.addEventListener('click', async () => {
          agregar.disabled = true;
          try {
            const { id, guardado_por, actualizado_en, n_filas, ...completa } = await api.obtenerSerie(s.id);
            if (agregarSeries([{ ...completa, id: nuevoId(), origen: 'bd' }])) aviso('Serie agregada al espacio de trabajo.', 'exito');
          } catch (err) {
            aviso(err.message, 'error');
          } finally {
            agregar.disabled = false;
          }
        });
        let eliminar = null;
        if (esAdmin()) {
          eliminar = el('button', { type: 'button', class: 'mini' }, 'Eliminar');
          eliminar.addEventListener('click', async () => {
            if (eliminar.dataset.confirmar !== 'si') {
              eliminar.dataset.confirmar = 'si';
              eliminar.textContent = '¿Eliminar definitivamente?';
              return;
            }
            try {
              await api.eliminarSerie(s.id);
              aviso('Serie eliminada.', 'exito');
              pintarGuardadas();
            } catch (err) {
              aviso(err.message, 'error');
            }
          });
        }
        return el('tr', { class: 'fila-valor' },
          el('td', {}, s.nombre, s.desagregacion ? el('span', { class: 'serie-meta' }, `Desagregada por ${s.desagregacion.toLowerCase()}`) : null),
          el('td', {}, s.tipo), el('td', {}, s.nivel), el('td', {}, s.anio ?? '—'), el('td', { class: 'num' }, s.n_filas),
          el('td', {}, fecha.format(new Date(s.actualizado_en))),
          el('td', {}, el('div', { class: 'serie-acciones' }, agregar, eliminar)));
      }))));
  } catch (err) {
    contenedor.replaceChildren(el('p', { class: 'vacio' }, `No se pudieron consultar: ${err.message}`));
  }
}
$('#btn-guardadas').addEventListener('click', () => {
  $('#dlg-guardadas').showModal();
  pintarGuardadas();
});

// ---------------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------------
for (const b of document.querySelectorAll('[data-cerrar]')) b.addEventListener('click', () => b.closest('dialog').close());
for (const d of document.querySelectorAll('dialog')) d.addEventListener('close', ocultarTooltip);

leerCache();
pintarTrabajo();
pintarPerfil();
api.sesion().then((p) => { estado.perfil = p; pintarPerfil(); }).catch(() => {});
