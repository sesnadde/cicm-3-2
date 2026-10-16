// Creador de indicadores: fórmulas sobre variables A, B, C… evaluadas sin eval().
// Gramática: expr := term (('+'|'-') term)* ; term := unario (('*'|'/') unario)* ;
// unario := ('-'|'+') unario | potencia ; potencia := primario ('^' unario)? ;
// primario := número | LETRA ('.' componente)? | función '(' args ')' | '(' expr ')'
import { COMPONENTES } from './agregacion.js';

export class ErrorFormula extends Error {
  constructor(mensaje, posicion) {
    super(mensaje);
    this.posicion = posicion;
  }
}

const redondear = (x, d = 0) => {
  const f = 10 ** Math.max(0, Math.min(10, Math.trunc(d)));
  return Math.round(x * f) / f;
};
/** Funciones por fila: [mínimo de argumentos, máximo, implementación]. */
const POR_FILA = {
  abs: [1, 1, Math.abs],
  raiz: [1, 1, Math.sqrt],
  ln: [1, 1, Math.log],
  log: [1, 1, Math.log10],
  redondear: [1, 2, redondear],
};
/** Funciones sobre todas las unidades (columna): devuelven un solo valor. */
const POR_COLUMNA = {
  suma: (xs) => xs.reduce((s, x) => s + x, 0),
  promedio: (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN),
  min: (xs) => (xs.length ? Math.min(...xs) : NaN),
  max: (xs) => (xs.length ? Math.max(...xs) : NaN),
};
export const FUNCIONES = [...Object.keys(POR_FILA), ...Object.keys(POR_COLUMNA)];
const MAX_LONGITUD = 500;
const MAX_PROFUNDIDAD = 40;

function tokenizar(texto) {
  const tokens = [];
  let i = 0;
  while (i < texto.length) {
    const resto = texto.slice(i);
    const espacio = /^\s+/.exec(resto);
    if (espacio) { i += espacio[0].length; continue; }
    const num = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(resto);
    if (num) { tokens.push({ t: 'num', v: Number(num[0]), pos: i }); i += num[0].length; continue; }
    const id = /^[A-Za-z_]\w*/.exec(resto);
    if (id) { tokens.push({ t: 'id', v: id[0], pos: i }); i += id[0].length; continue; }
    if ('+-*/^(),.'.includes(texto[i])) { tokens.push({ t: texto[i], pos: i }); i++; continue; }
    throw new ErrorFormula(`Carácter no permitido «${texto[i]}» en la posición ${i + 1}.`, i);
  }
  tokens.push({ t: 'fin', pos: texto.length });
  return tokens;
}

/** Analiza una fórmula y devuelve su árbol, las letras que usa y si fija componentes (A.mujeres). */
export function compilarFormula(texto, letrasDisponibles) {
  if (!texto?.trim()) throw new ErrorFormula('Escribe una fórmula.', 0);
  if (texto.length > MAX_LONGITUD) throw new ErrorFormula(`La fórmula excede ${MAX_LONGITUD} caracteres.`, MAX_LONGITUD);
  const tokens = tokenizar(texto);
  const letras = new Set();
  let explicitos = false;
  let k = 0;
  let profundidad = 0;
  const ver = () => tokens[k];
  const tomar = (t) => {
    if (tokens[k].t !== t) throw new ErrorFormula(`Se esperaba «${t}» en la posición ${tokens[k].pos + 1}.`, tokens[k].pos);
    return tokens[k++];
  };
  const anidar = (fn) => {
    if (++profundidad > MAX_PROFUNDIDAD) throw new ErrorFormula('La fórmula tiene demasiados niveles de anidación.', ver().pos);
    const r = fn();
    profundidad--;
    return r;
  };

  const expr = () => anidar(() => {
    let a = term();
    while (ver().t === '+' || ver().t === '-') a = { k: 'op', op: tokens[k++].t, a, b: term() };
    return a;
  });
  const term = () => {
    let a = unario();
    while (ver().t === '*' || ver().t === '/') a = { k: 'op', op: tokens[k++].t, a, b: unario() };
    return a;
  };
  const unario = () => anidar(() => {
    if (ver().t === '-') { k++; return { k: 'neg', a: unario() }; }
    if (ver().t === '+') { k++; return unario(); }
    const base = primario();
    if (ver().t === '^') { k++; return { k: 'op', op: '^', a: base, b: unario() }; }
    return base;
  });
  const primario = () => {
    const tok = ver();
    if (tok.t === 'num') { k++; return { k: 'num', v: tok.v }; }
    if (tok.t === '(') { k++; const e = expr(); tomar(')'); return e; }
    if (tok.t === 'id') {
      k++;
      if (ver().t === '(') {
        const nombre = tok.v.toLowerCase();
        if (!FUNCIONES.includes(nombre)) throw new ErrorFormula(`Función desconocida «${tok.v}». Disponibles: ${FUNCIONES.join(', ')}.`, tok.pos);
        k++;
        const args = [];
        if (ver().t !== ')') {
          args.push(expr());
          while (ver().t === ',') { k++; args.push(expr()); }
        }
        tomar(')');
        const [min, max] = POR_FILA[nombre] ?? [1, 1];
        if (args.length < min || args.length > max) throw new ErrorFormula(`«${nombre}» recibe ${min === max ? min : `${min} o ${max}`} argumento(s).`, tok.pos);
        return { k: 'fn', nombre, args };
      }
      if (!/^[A-Z]$/.test(tok.v) || !letrasDisponibles.includes(tok.v)) {
        throw new ErrorFormula(`«${tok.v}» no es una variable seleccionada. Usa: ${letrasDisponibles.join(', ')}.`, tok.pos);
      }
      letras.add(tok.v);
      if (ver().t !== '.') return { k: 'var', letra: tok.v, comp: null };
      k++;
      const comp = ver();
      if (comp.t !== 'id' || !COMPONENTES.includes(comp.v.toLowerCase())) {
        throw new ErrorFormula(`Después de «${tok.v}.» escribe total, hombres o mujeres.`, comp.pos);
      }
      k++;
      explicitos = true;
      return { k: 'var', letra: tok.v, comp: comp.v.toLowerCase() };
    }
    throw new ErrorFormula(tok.t === 'fin' ? 'La fórmula está incompleta.' : `Símbolo inesperado «${tok.t}» en la posición ${tok.pos + 1}.`, tok.pos);
  };

  const arbol = expr();
  if (ver().t !== 'fin') throw new ErrorFormula(`Símbolo inesperado en la posición ${ver().pos + 1}.`, ver().pos);
  if (!letras.size) throw new ErrorFormula('La fórmula debe usar al menos una variable.', 0);
  return { arbol, letras: [...letras], explicitos };
}

const VACIA = { v: null, c: null, p: false };
const operar = (a, b, f) => {
  if (a.v === null || b.v === null) return { v: null, c: a.c ?? b.c ?? null, p: a.p || b.p };
  const v = f(a.v, b.v);
  return Number.isFinite(v) ? { v, c: null, p: a.p || b.p } : { v: null, c: null, p: a.p || b.p };
};
const OPERADORES = { '+': (x, y) => x + y, '-': (x, y) => x - y, '*': (x, y) => x * y, '/': (x, y) => x / y, '^': (x, y) => x ** y };

/** Evalúa el árbol; obtener(letra, componente) devuelve el vector de celdas de esa variable. */
function evaluar(nodo, obtener, n) {
  switch (nodo.k) {
    case 'num': return Array.from({ length: n }, () => ({ v: nodo.v, c: null, p: false }));
    case 'var': return obtener(nodo.letra, nodo.comp);
    case 'neg': return evaluar(nodo.a, obtener, n).map((x) => (x.v === null ? x : { ...x, v: -x.v }));
    case 'op': {
      const a = evaluar(nodo.a, obtener, n);
      const b = evaluar(nodo.b, obtener, n);
      return a.map((x, i) => operar(x, b[i], OPERADORES[nodo.op]));
    }
    case 'fn': {
      const args = nodo.args.map((a) => evaluar(a, obtener, n));
      if (POR_COLUMNA[nodo.nombre]) {
        const validos = args[0].filter((x) => x.v !== null);
        const v = POR_COLUMNA[nodo.nombre](validos.map((x) => x.v));
        const p = args[0].some((x) => x.p || (x.v === null && x.c && x.c !== 'NA'));
        const celda = Number.isFinite(v) ? { v, c: null, p } : { v: null, c: null, p };
        return Array.from({ length: n }, () => celda);
      }
      const f = POR_FILA[nodo.nombre][2];
      return args[0].map((x, i) => {
        const fila = args.map((a) => a[i]);
        const faltante = fila.find((y) => y.v === null);
        if (faltante) return { v: null, c: faltante.c, p: fila.some((y) => y.p) };
        const v = f(...fila.map((y) => y.v));
        return Number.isFinite(v) ? { v, c: null, p: fila.some((y) => y.p) } : { v: null, c: null, p: x.p };
      });
    }
  }
  throw new Error(`Nodo desconocido ${nodo.k}`);
}

const referencias = (nodo) =>
  nodo.k === 'var' ? [nodo] : [nodo.a, nodo.b, ...(nodo.args ?? [])].filter(Boolean).flatMap(referencias);

/**
 * Calcula un indicador fila por fila (misma unidad y categoría). Sin componentes explícitos se
 * calcula por separado para total, hombres y mujeres; con A.total, A.hombres o A.mujeres el
 * resultado es un solo valor y va en la columna Total (p. ej. A.mujeres / A.total * 100).
 * @param formula texto de la fórmula
 * @param entradas { A: serie, B: serie, … } con serie.filas = [{clave, unidad, categoria, total, hombres, mujeres}]
 */
export function calcularIndicador(formula, entradas) {
  const { arbol, letras, explicitos } = compilarFormula(formula, Object.keys(entradas));
  const llave = (f) => `${f.clave}\u0000${f.categoria ?? ''}`;
  const filas = new Map();
  const indices = {};
  for (const letra of letras) {
    indices[letra] = new Map();
    for (const f of entradas[letra].filas) {
      indices[letra].set(llave(f), f);
      if (!filas.has(llave(f))) filas.set(llave(f), { clave: f.clave, unidad: f.unidad, categoria: f.categoria ?? '' });
    }
  }
  const base = [...filas.entries()];
  const refs = referencias(arbol);
  const resultado = base.map(([, f]) => ({ ...f, total: null, hombres: null, mujeres: null }));
  for (const comp of explicitos ? ['total'] : COMPONENTES) {
    const usado = (ref) => ref.comp ?? comp;
    // null = la fuente no tiene ese componente; se distingue de un valor faltante.
    const estructural = base.map(([k]) => refs.some((r) => indices[r.letra].get(k)?.[usado(r)] === null));
    const obtener = (letra, c) => base.map(([k]) => indices[letra].get(k)?.[c ?? comp] ?? VACIA);
    evaluar(arbol, obtener, base.length).forEach((celda, i) => { resultado[i][comp] = estructural[i] ? null : celda; });
  }
  return resultado;
}
