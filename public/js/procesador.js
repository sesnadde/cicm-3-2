// Interfaz con promesas sobre el Web Worker de procesamiento.

const worker = new Worker(new URL('./procesador.worker.js', import.meta.url), { type: 'module' });
const pendientes = new Map();
let contador = 0;

worker.onmessage = ({ data: m }) => {
  const p = pendientes.get(m.id);
  if (!p) return;
  if (m.tipo === 'progreso') return p.progreso?.(m.pct, m.texto);
  pendientes.delete(m.id);
  if (m.tipo === 'error') p.rechazar(new Error(m.mensaje));
  else p.resolver(m);
};
worker.onerror = (e) => {
  for (const p of pendientes.values()) p.rechazar(new Error(`Falló el procesador: ${e.message ?? 'error desconocido'}`));
  pendientes.clear();
};

function enviar(mensaje, transferir = [], progreso) {
  const id = `p${++contador}`;
  return new Promise((resolver, rechazar) => {
    pendientes.set(id, { resolver, rechazar, progreso });
    worker.postMessage({ ...mensaje, id }, transferir);
  });
}

/** Abre un ZIP; devuelve { id, estructura }. El buffer se transfiere (no se copia). */
export async function cargarZip(archivo, progreso) {
  progreso?.(10, `Leyendo ${archivo.name}…`);
  const buffer = await archivo.arrayBuffer();
  const paqueteId = `paq${++contador}`;
  const r = await enviar({ tipo: 'cargar', paqueteId, buffer }, [buffer], progreso);
  return { id: paqueteId, estructura: r.estructura };
}

/** peticiones: [{ tabla, variables: [ids], desagregarPor }] */
export async function calcular(paqueteId, peticiones) {
  return (await enviar({ tipo: 'calcular', paqueteId, peticiones })).series;
}
