// Acceso a un ZIP en memoria con límites defensivos. La función de descompresión
// (unzipSync de fflate) se inyecta para que el módulo funcione igual en navegador y Node.

export const LIMITES = {
  entradas: 3000, // número máximo de archivos en el ZIP
  bytesPorArchivo: 200 * 1024 * 1024, // tamaño descomprimido máximo de un archivo
  bytesTotales: 1024 * 1024 * 1024, // tamaño descomprimido máximo del paquete
  razonCompresion: 500, // descomprimido / comprimido (protección contra "zip bombs")
};

export class ErrorZip extends Error {}

const decodUtf8 = new TextDecoder('utf-8', { fatal: true });
const decodWin = new TextDecoder('windows-1252');

/** Decodifica UTF-8 y, si el archivo no lo es (paquetes antiguos del INEGI), usa Windows-1252. */
export function decodificar(bytes) {
  try {
    return decodUtf8.decode(bytes);
  } catch {
    return decodWin.decode(bytes);
  }
}

/**
 * Abre un ZIP sin descomprimir su contenido. Devuelve la lista de rutas y una
 * función para leer bajo demanda el texto de una ruta.
 */
export function abrirZip(bytes, unzipSync, limites = LIMITES) {
  const entradas = new Map();
  let total = 0;
  try {
    unzipSync(bytes, {
      filter(e) {
        if (e.name.endsWith('/')) return false;
        if (entradas.size >= limites.entradas) throw new ErrorZip(`El ZIP tiene más de ${limites.entradas} archivos.`);
        if (e.originalSize > limites.bytesPorArchivo) throw new ErrorZip(`El archivo ${e.name} excede el tamaño permitido.`);
        if (e.size > 0 && e.originalSize / e.size > limites.razonCompresion && e.originalSize > 1024 * 1024) {
          throw new ErrorZip(`El archivo ${e.name} tiene una compresión anómala; se rechazó por seguridad.`);
        }
        total += e.originalSize;
        if (total > limites.bytesTotales) throw new ErrorZip('El contenido descomprimido del ZIP excede el tamaño permitido.');
        entradas.set(e.name, e.originalSize);
        return false; // solo se listan; nada se descomprime aún
      },
    });
  } catch (e) {
    if (e instanceof ErrorZip) throw e;
    throw new ErrorZip('El archivo no es un ZIP válido o está dañado.');
  }

  return {
    rutas: [...entradas.keys()],
    /** Lee varias rutas en una sola pasada. */
    leerVarias(rutas) {
      const buscadas = new Set(rutas);
      const r = unzipSync(bytes, { filter: (e) => buscadas.has(e.name) });
      const textos = {};
      for (const ruta of rutas) {
        if (!r[ruta]) throw new ErrorZip(`No se encontró ${ruta} en el ZIP.`);
        if (r[ruta].length > limites.bytesPorArchivo) throw new ErrorZip(`El archivo ${ruta} excede el tamaño permitido.`);
        textos[ruta] = decodificar(r[ruta]);
      }
      return textos;
    },
  };
}
