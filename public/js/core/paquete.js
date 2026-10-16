// Un paquete INEGI abierto: conserva el ZIP comprimido y descomprime cada tabla de datos
// solo cuando se necesita, con una caché LRU pequeña de tablas ya parseadas.
import { abrirZip } from './zip.js';
import { leerEstructura } from './inegi.js';
import { parseCsv } from './csv.js';
import { agregarTabla } from './agregacion.js';

const TABLAS_EN_CACHE = 4;

export class Paquete {
  #zip;
  #cache = new Map();

  constructor(bytes, unzipSync) {
    this.#zip = abrirZip(bytes, unzipSync);
    this.estructura = leerEstructura(this.#zip.rutas, (rutas) => this.#zip.leerVarias(rutas));
  }

  #filas(tabla) {
    let filas = this.#cache.get(tabla.clave);
    if (filas) {
      this.#cache.delete(tabla.clave); // se reinserta al final: más reciente
    } else {
      filas = parseCsv(this.#zip.leerVarias([tabla.rutaDatos])[tabla.rutaDatos]);
    }
    this.#cache.set(tabla.clave, filas);
    if (this.#cache.size > TABLAS_EN_CACHE) this.#cache.delete(this.#cache.keys().next().value);
    return filas;
  }

  /** Calcula las variables pedidas de una tabla. */
  calcular(claveTabla, idsVariables, desagregarPor = null) {
    const tabla = this.estructura.tablas.find((t) => t.clave === claveTabla);
    if (!tabla) throw new Error(`No existe la tabla ${claveTabla}.`);
    const variables = idsVariables.map((id) => {
      const v = tabla.variables.find((x) => x.id === id);
      if (!v) throw new Error(`No existe la variable ${id}.`);
      return v;
    });
    if (desagregarPor && !tabla.dimensiones.some((d) => d.columna === desagregarPor)) {
      throw new Error(`La tabla ${claveTabla} no se puede desagregar por ${desagregarPor}.`);
    }
    return agregarTabla(tabla, this.#filas(tabla), variables, this.estructura.catalogos, desagregarPor);
  }
}
