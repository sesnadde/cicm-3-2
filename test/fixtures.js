// Paquetes INEGI sintéticos que reproducen los patrones (y trampas) de los paquetes reales.
import { zipSync, strToU8 } from 'fflate';

const DIC = 'COLUMNA,DESCRIPCION,ORIGEN,TIPO_DATO,LONGITUD,CODIGO_VALIDO\n';
const CONTEO = 'SECC I. 1,Carácter,20,"0-999999999999999, NA, NSS, ND, NP, NULL"';

/** CNGE (estatal) con dos tablas. */
export function paqueteEstatal({ prefijo = '', codificar = strToU8 } = {}) {
  const a = {
    'readme.txt': 'readme',
    'metadatos/metadatos_cnge_2025.txt': 'Identifier: MEX-INEGI.40.1200.03-CNGE-2025\r\n\r\nTitle: Censo Nacional de Gobiernos Estatales 2025\r\n',
    'catalogos/cve_ent_cnge2025.csv': 'cvegeo,cve_ent,nom_ent\n01,01,Aguascalientes\n02,02,Baja California\n09,09,Ciudad de México\n',
    'catalogos/tramitse_r_cnge2025.csv': 'tramitse_r,descrip\n1,Pago de impuestos\n2,"Licencia de construcción, obra"\n',
    'conjunto_de_datos/0_indice_cnge2025.csv':
      'ARCHIVO,CONTENIDO\n' +
      'm1s1p9,"Personal adscrito a las instituciones de la Administración Pública, según régimen de contratación y sexo, al cierre del año 2024."\n' +
      'm1s2p1,"Solicitudes recibidas de trámites, según tipo de trámite, durante el año 2024."\n' +
      'm9s9p9,"Tabla del índice sin archivos"\n',
    'diccionario_de_datos/diccionario_de_datos_m1s1p9_cnge2025.csv':
      DIC +
      'cvegeo,Clave geoestadística concatenada,SECC I. 9,Carácter,2,01 al 99\n' +
      'cve_ent,Clave del AGEE,SECC I. 9,Carácter,2,01 al 99\n' +
      'numeral,Identificador,SECC I. 9,Carácter,4,0-5000\n' +
      'nombre1,Nombre de las instituciones,SECC I. 9,Carácter,2500,\n' +
      `regtt,Total,${CONTEO}\n` +
      `reg1,Total - Hombres,${CONTEO}\n` +
      `reg2,Total - Mujeres,${CONTEO}\n` +
      `regs1,Confianza - Subtotal,${CONTEO}\n` +
      `reg3,Confianza - Hombres,${CONTEO}\n` +
      `reg4,Confianza - Mujeres,${CONTEO}\n` +
      `reg5,Ocupadas - Hombres,${CONTEO}\n` +
      `reg6,Ocupadas - Mujeres,${CONTEO}\n`,
    // Columnas en distinto orden que el diccionario (como m1s1p6 real) y fila TOTAL (como CDMX en m1s5p28a)
    'conjunto_de_datos/m1s1p9_cnge2025.csv':
      'cvegeo,cve_ent,numeral,nombre1,reg1,reg2,regtt,regs1,reg3,reg4,reg5,reg6\n' +
      '01,01,1,DESPACHO,66,57,123,51,28,23,1,2\n' +
      '01,01,2,"SECRETARIA DE FINANZAS, ADMINISTRACION",10,5,15,NSS,NSS,NSS,3,4\n' +
      '02,02,1,DESPACHO,NA,NA,NA,NA,NA,NA,NA,NA\n' +
      '09,09,1,SECRETARIA,4,6,10,2,1,1,,\n' +
      '09,09,2,TOTAL,4,6,10,2,1,1,,\n',
    'diccionario_de_datos/diccionario_de_datos_m1s2p1_cnge2025.csv':
      DIC +
      'cvegeo,Clave geoestadística concatenada,SECC II 1,Carácter,2,01 al 99\n' +
      'cve_ent,Clave del AGEE,SECC II 1,Carácter,2,01 al 99\n' +
      'tramitse_r,Tipo de trámite o servicio,SECC II. 1,Numérico,2,1 al 99\n' +
      'medpre1,Medio de presentación - Presencial,SECC II. 1,Carácter,3,"1, NA, NSS, ND, NP, NULL"\n' +
      `esturett,Solicitudes recibidas - Total,${CONTEO}\n`,
    'conjunto_de_datos/m1s2p1_cnge2025.csv':
      'cvegeo,cve_ent,tramitse_r,medpre1,esturett\n01,01,1,1,100\n01,01,2,,50\n02,02,1,1,NSS\n02,02,2,NA,NA\n',
  };
  return zipSync(Object.fromEntries(Object.entries(a).map(([k, v]) => [prefijo + k, codificar(v)])));
}

/** CNGF (federal): una tabla por institución y otra sin clave de unidad. */
export function paqueteFederal() {
  const a = {
    'metadatos/metadatos_cngf_2025.txt': 'Identifier: X\nTitle: Censo Nacional de Gobierno Federal 2025\n',
    'catalogos/instadmi_j_cngf2025.csv': 'instadmi_j,descrip\n1,OFICINA DE LA PRESIDENCIA\n2,SECRETARIA DE GOBERNACION\n',
    'conjunto_de_datos/0_indice_cngf2025.csv': 'ARCHIVO,CONTENIDO\nm1s2p3,"Personal adscrito, según sexo, al cierre del año 2024."\nm1s2p20,"Acciones formativas, durante el año 2024."\n',
    'diccionario_de_datos/diccionario_de_datos_m1s2p3_cngf2025.csv':
      DIC + 'instadmi_j,Nombre de las instituciones,SECC II. 3,Numérico,3,1 al 999\n' +
      `sexostt,Total,${CONTEO}\nsexos1,Hombres,${CONTEO}\nsexos2,Mujeres,${CONTEO}\n`,
    'conjunto_de_datos/m1s2p3_cngf2025.csv': 'instadmi_j,sexostt,sexos1,sexos2\n1,510,275,235\n2,3327,1627,1700\n',
    'diccionario_de_datos/diccionario_de_datos_m1s2p20_cngf2025.csv': DIC + `acfoic1,Acciones formativas impartidas - Total,${CONTEO}\n`,
    'conjunto_de_datos/m1s2p20_cngf2025.csv': 'acfoic1\n1660\n',
  };
  return zipSync(Object.fromEntries(Object.entries(a).map(([k, v]) => [k, strToU8(v)])));
}
