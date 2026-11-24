import { esPersona, normalizarDocumento, normalizarEmail, normalizarNombre, normalizarTelefono, ReglaClienteError, rucValido } from './cliente';

describe('Documento del cliente', () => {
  it('acepta un DNI de 8 dígitos y quita espacios', () => {
    expect(normalizarDocumento('1', ' 4567 8912 ')).toBe('45678912');
  });

  it.each(['1234567', '123456789', '4567891A'])('rechaza el DNI %s', (dni) => {
    expect(() => normalizarDocumento('1', dni)).toThrow(ReglaClienteError);
  });

  it('valida el dígito verificador del RUC', () => {
    expect(rucValido('20100047218')).toBe(true);
    expect(rucValido('20100047219')).toBe(false);
    expect(normalizarDocumento('6', '20100047218')).toBe('20100047218');
    expect(() => normalizarDocumento('6', '20100047219')).toThrow('dígito verificador');
  });

  it('rechaza un RUC con un prefijo que no existe', () => {
    expect(() => normalizarDocumento('6', '30100047218')).toThrow('empiezan con 10, 15, 16, 17 o 20');
  });

  it('pasa el pasaporte a mayúsculas y exige de 6 a 12 caracteres', () => {
    expect(normalizarDocumento('7', 'cl8834521')).toBe('CL8834521');
    expect(() => normalizarDocumento('7', 'AB12')).toThrow(ReglaClienteError);
    expect(() => normalizarDocumento('7', 'AB-12345')).toThrow(ReglaClienteError);
  });

  it('solo una persona con documento puede alojarse', () => {
    expect(esPersona('1')).toBe(true);
    expect(esPersona('7')).toBe(true);
    expect(esPersona('6')).toBe(false);
    expect(esPersona('0')).toBe(false);
  });
});

describe('Nombre y contacto del cliente', () => {
  it('con RUC usa la razón social e ignora los nombres', () => {
    expect(normalizarNombre('6', { razonSocial: '  Minera   Sur SAC ', nombres: 'X' })).toEqual({ razonSocial: 'Minera Sur SAC', nombres: null, apellidos: null });
  });

  it('con DNI exige nombres y apellidos', () => {
    expect(normalizarNombre('1', { nombres: ' Carlos ', apellidos: 'Mendoza  Ríos' })).toEqual({ razonSocial: null, nombres: 'Carlos', apellidos: 'Mendoza Ríos' });
    expect(() => normalizarNombre('1', { nombres: 'Carlos', apellidos: '  ' })).toThrow('Los apellidos');
  });

  it('normaliza correo y teléfono, y los deja vacíos si no se dan', () => {
    expect(normalizarEmail(' Ana@Hotel.PE ')).toBe('ana@hotel.pe');
    expect(normalizarEmail('')).toBeNull();
    expect(() => normalizarEmail('ana@hotel')).toThrow('correo');
    expect(normalizarTelefono('+51 952 123 456')).toBe('+51 952 123 456');
    expect(() => normalizarTelefono('952-ABC')).toThrow('teléfono');
  });
});
