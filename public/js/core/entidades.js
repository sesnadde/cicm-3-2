// Entidades federativas (clave INEGI cve_ent) y reconocimiento de nombres escritos a mano.

export const ENTIDADES = {
  '01': 'Aguascalientes', '02': 'Baja California', '03': 'Baja California Sur', '04': 'Campeche',
  '05': 'Coahuila de Zaragoza', '06': 'Colima', '07': 'Chiapas', '08': 'Chihuahua',
  '09': 'Ciudad de México', '10': 'Durango', '11': 'Guanajuato', '12': 'Guerrero',
  '13': 'Hidalgo', '14': 'Jalisco', '15': 'México', '16': 'Michoacán de Ocampo',
  '17': 'Morelos', '18': 'Nayarit', '19': 'Nuevo León', '20': 'Oaxaca',
  '21': 'Puebla', '22': 'Querétaro', '23': 'Quintana Roo', '24': 'San Luis Potosí',
  '25': 'Sinaloa', '26': 'Sonora', '27': 'Tabasco', '28': 'Tamaulipas',
  '29': 'Tlaxcala', '30': 'Veracruz de Ignacio de la Llave', '31': 'Yucatán', '32': 'Zacatecas',
};

const simplificar = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const ALIAS = {
  coahuila: '05', michoacan: '16', veracruz: '30', cdmx: '09', 'distrito federal': '09', df: '09',
  'estado de mexico': '15', edomex: '15', 'edo mex': '15', queretaro: '22', 'queretaro de arteaga': '22',
};
const POR_NOMBRE = new Map([
  ...Object.entries(ENTIDADES).map(([k, v]) => [simplificar(v), k]),
  ...Object.entries(ALIAS),
]);

/** Devuelve la clave de entidad para "Jalisco", "14", "14 Jalisco", "CDMX"…, o null. */
export function claveEntidad(texto) {
  const s = simplificar(texto);
  const num = /^(\d{1,2})\b/.exec(s);
  if (num) {
    const k = num[1].padStart(2, '0');
    if (ENTIDADES[k]) return k;
  }
  return POR_NOMBRE.get(s) ?? null;
}
