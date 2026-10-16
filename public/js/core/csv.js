// Parser CSV (RFC 4180): comillas, comillas escapadas (""), saltos CRLF/LF y BOM.
// Se usa tanto en el navegador como en Node (pruebas), sin dependencias.

export function parseCsv(texto) {
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
  const filas = [];
  const n = texto.length;
  let fila = [];
  let i = 0;
  while (i < n) {
    let campo;
    if (texto[i] === '"') {
      // Campo entre comillas: termina en la comilla no duplicada.
      let fin = i + 1;
      campo = '';
      for (;;) {
        const q = texto.indexOf('"', fin);
        if (q === -1) { campo += texto.slice(fin); i = n; break; }
        campo += texto.slice(fin, q);
        if (texto[q + 1] === '"') { campo += '"'; fin = q + 2; continue; }
        i = q + 1;
        break;
      }
    } else {
      let fin = i;
      while (fin < n) {
        const c = texto.charCodeAt(fin);
        if (c === 44 || c === 10 || c === 13) break; // , \n \r
        fin++;
      }
      campo = texto.slice(i, fin);
      i = fin;
    }
    fila.push(campo);
    const c = texto[i];
    if (c === ',') { i++; if (i === n) fila.push(''); continue; }
    // Fin de registro (salto de línea o fin de texto)
    if (c === '\r' && texto[i + 1] === '\n') i += 2;
    else if (c === '\r' || c === '\n') i++;
    if (!(fila.length === 1 && fila[0] === '')) filas.push(fila); // ignora líneas vacías
    fila = [];
  }
  return filas;
}
