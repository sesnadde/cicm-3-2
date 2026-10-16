// Web Worker: abre y procesa los ZIP fuera del hilo principal para no congelar la página.
// Solo conserva el ZIP comprimido de cada paquete; las tablas se descomprimen bajo demanda.
import { unzipSync } from '../vendor/fflate.js';
import { Paquete } from './core/paquete.js';

const MAX_BYTES = 250 * 1024 * 1024; // suma de ZIP abiertos en la sesión
const paquetes = new Map();
const ocupado = () => [...paquetes.values()].reduce((s, p) => s + p.bytes, 0);

self.onmessage = ({ data: m }) => {
  try {
    if (m.tipo === 'cargar') {
      if (ocupado() + m.buffer.byteLength > MAX_BYTES) {
        throw new Error('Se alcanzó el límite de memoria de la sesión. Quita paquetes que ya no uses o recarga la página.');
      }
      self.postMessage({ tipo: 'progreso', id: m.id, pct: 40, texto: 'Leyendo índice, diccionarios y catálogos…' });
      const paquete = new Paquete(new Uint8Array(m.buffer), unzipSync);
      paquetes.set(m.paqueteId, { paquete, bytes: m.buffer.byteLength });
      const { catalogos, ...estructura } = paquete.estructura; // los catálogos no viajan al hilo principal
      estructura.tablas = estructura.tablas.map(({ rutaDatos, ...t }) => t);
      self.postMessage({ tipo: 'listo', id: m.id, estructura });
    } else if (m.tipo === 'calcular') {
      const p = paquetes.get(m.paqueteId);
      if (!p) throw new Error('El paquete ya no está en memoria; vuelve a cargar el ZIP.');
      const series = m.peticiones.flatMap((x) => p.paquete.calcular(x.tabla, x.variables, x.desagregarPor)
        .map((s) => ({ ...s, tabla: x.tabla, desagregarPor: x.desagregarPor })));
      self.postMessage({ tipo: 'resultado', id: m.id, series });
    }
  } catch (e) {
    self.postMessage({ tipo: 'error', id: m.id, mensaje: e.message || 'No se pudo procesar el archivo.' });
  }
};
