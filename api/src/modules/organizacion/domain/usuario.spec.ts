import { cambiaronSucursales, estadoUsuario, politicaClave, ReglaUsuarioError, validarSucursales, validarUsername } from './usuario';

describe('estadoUsuario', () => {
  it('inactivo manda sobre bloqueado', () => {
    expect(estadoUsuario({ activo: false, intentos_fallidos: 5 })).toBe('INACTIVO');
  });
  it('bloqueado desde el tercer intento fallido', () => {
    expect(estadoUsuario({ activo: true, intentos_fallidos: 2 })).toBe('ACTIVO');
    expect(estadoUsuario({ activo: true, intentos_fallidos: 3 })).toBe('BLOQUEADO');
  });
});

describe('validarUsername', () => {
  it('normaliza a minúsculas y recorta', () => {
    expect(validarUsername('  Recepcion.Noche ')).toBe('recepcion.noche');
  });
  it.each(['ab', 'con espacio', 'ñandu', 'x'.repeat(51), 'a@b'])('rechaza %p', (u) => {
    expect(() => validarUsername(u)).toThrow(ReglaUsuarioError);
  });
});

describe('politicaClave', () => {
  it('acepta una clave con letras y números de 8 o más', () => {
    expect(politicaClave('Hotel2026!', 'admin')).toEqual([]);
  });
  it('lista cada problema', () => {
    expect(politicaClave('corta')).toEqual(['Debe tener al menos 8 caracteres', 'Debe tener al menos un número']);
    expect(politicaClave('12345678')).toEqual(['Debe tener al menos una letra']);
  });
  it('no permite contener el usuario', () => {
    expect(politicaClave('Recepcion1-2026', 'recepcion1')).toContain('No debe contener el nombre de usuario');
  });
});

describe('validarSucursales', () => {
  const empresa = [1, 2];
  it('exige al menos una', () => {
    expect(() => validarSucursales([], empresa)).toThrow('al menos una');
  });
  it('exige exactamente una principal', () => {
    expect(() => validarSucursales([{ id: 1, principal: false }], empresa)).toThrow('exactamente una');
    expect(() => validarSucursales([{ id: 1, principal: true }, { id: 2, principal: true }], empresa)).toThrow('exactamente una');
  });
  it('rechaza repetidas y ajenas', () => {
    expect(() => validarSucursales([{ id: 1, principal: true }, { id: 1, principal: false }], empresa)).toThrow('repetidas');
    expect(() => validarSucursales([{ id: 9, principal: true }], empresa)).toThrow('no pertenecen');
  });
  it('acepta una asignación válida', () => {
    expect(() => validarSucursales([{ id: 2, principal: true }, { id: 1, principal: false }], empresa)).not.toThrow();
  });
});

describe('cambiaronSucursales', () => {
  it('ignora el orden', () => {
    expect(cambiaronSucursales([{ id: 1, principal: true }, { id: 2, principal: false }], [{ id: 2, principal: false }, { id: 1, principal: true }])).toBe(false);
  });
  it('detecta cambio de principal o de lista', () => {
    expect(cambiaronSucursales([{ id: 1, principal: true }, { id: 2, principal: false }], [{ id: 1, principal: false }, { id: 2, principal: true }])).toBe(true);
    expect(cambiaronSucursales([{ id: 1, principal: true }], [{ id: 1, principal: true }, { id: 2, principal: false }])).toBe(true);
  });
});
