/**
 * Reglas del cliente y del huésped (RF-RES-17, spec S-06). El tipo de documento es el código del Catálogo 06 de
 * SUNAT (`tipo_documento_identidad.codigo_sunat`). Lógica pura: no conoce la base ni HTTP.
 */
export class ReglaClienteError extends Error {}

export type CodigoDocumento = '0' | '1' | '4' | '6' | '7' | 'A';

interface ReglaDocumento {
  nombre: string;
  patron: RegExp;
  formato: string;
}

const REGLAS: Record<CodigoDocumento, ReglaDocumento> = {
  '0': { nombre: 'Sin documento', patron: /^[A-Z0-9-]{1,15}$/, formato: 'hasta 15 letras, dígitos o guiones' },
  '1': { nombre: 'DNI', patron: /^\d{8}$/, formato: '8 dígitos' },
  '4': { nombre: 'Carnet de extranjería', patron: /^[A-Z0-9]{6,12}$/, formato: 'de 6 a 12 letras o dígitos' },
  '6': { nombre: 'RUC', patron: /^(10|15|16|17|20)\d{9}$/, formato: '11 dígitos que empiezan con 10, 15, 16, 17 o 20' },
  '7': { nombre: 'Pasaporte', patron: /^[A-Z0-9]{6,12}$/, formato: 'de 6 a 12 letras o dígitos' },
  A: { nombre: 'Cédula diplomática', patron: /^[A-Z0-9]{6,15}$/, formato: 'de 6 a 15 letras o dígitos' },
};

export function esCodigoDocumento(valor: string): valor is CodigoDocumento {
  return Object.prototype.hasOwnProperty.call(REGLAS, valor);
}

/** Dígito verificador del RUC: pesos 5,4,3,2,7,6,5,4,3,2 sobre los 10 primeros dígitos, módulo 11. */
export function rucValido(ruc: string): boolean {
  if (!/^\d{11}$/.test(ruc)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, p, i) => acc + p * Number(ruc[i]), 0);
  const digito = (11 - (suma % 11)) % 10;
  return digito === Number(ruc[10]);
}

/** Documento recortado y en mayúsculas; lanza si no tiene el formato del tipo. */
export function normalizarDocumento(tipo: CodigoDocumento, numero: string): string {
  const limpio = numero.replace(/\s+/g, '').toUpperCase();
  const regla = REGLAS[tipo];
  if (!regla.patron.test(limpio)) throw new ReglaClienteError(`El ${regla.nombre} debe tener ${regla.formato}`);
  if (tipo === '6' && !rucValido(limpio)) throw new ReglaClienteError('El RUC no es válido (dígito verificador)');
  return limpio;
}

/** Una persona natural puede alojarse; una empresa (RUC) o alguien sin documento, no. */
export function esPersona(tipo: CodigoDocumento): boolean {
  return tipo !== '6' && tipo !== '0';
}

export interface DatosNombre {
  razonSocial?: string | null;
  nombres?: string | null;
  apellidos?: string | null;
}

const recortar = (v: string | null | undefined): string | null => {
  const t = v?.trim().replace(/\s+/g, ' ');
  return t ? t : null;
};

function largo(valor: string | null, campo: string, min: number, max: number): void {
  if (valor === null || valor.length < min || valor.length > max) {
    throw new ReglaClienteError(`${campo} debe tener entre ${min} y ${max} caracteres`);
  }
}

/** Con RUC manda la razón social; con los demás documentos, nombres y apellidos. */
export function normalizarNombre(tipo: CodigoDocumento, d: DatosNombre): { razonSocial: string | null; nombres: string | null; apellidos: string | null } {
  if (tipo === '6') {
    const razonSocial = recortar(d.razonSocial);
    largo(razonSocial, 'La razón social', 2, 200);
    return { razonSocial, nombres: null, apellidos: null };
  }
  const nombres = recortar(d.nombres);
  const apellidos = recortar(d.apellidos);
  largo(nombres, 'Los nombres', 1, 100);
  largo(apellidos, 'Los apellidos', 1, 100);
  return { razonSocial: null, nombres, apellidos };
}

export function normalizarEmail(email: string | null | undefined): string | null {
  const t = recortar(email)?.toLowerCase() ?? null;
  if (t === null) return null;
  if (t.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) throw new ReglaClienteError('El correo no es válido');
  return t;
}

export function normalizarTelefono(telefono: string | null | undefined): string | null {
  const t = recortar(telefono);
  if (t === null) return null;
  if (!/^[\d +-]{6,20}$/.test(t)) throw new ReglaClienteError('El teléfono admite de 6 a 20 dígitos, espacios, + y -');
  return t;
}
