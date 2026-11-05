import { describe, expect, it } from 'vitest';
import { mensajeCierre } from './motivos';

describe('mensajes de cierre de sesión', () => {
  it.each([
    ['INACTIVIDAD', 'Tu sesión se cerró por inactividad. Vuelve a ingresar.'],
    ['EXPIRADA', 'Tu turno de sesión terminó. Vuelve a ingresar.'],
    ['REUSO', 'Cerramos tu sesión por seguridad. Vuelve a ingresar.'],
    ['USUARIO_INACTIVO', 'Tu usuario fue desactivado. Consulta con un administrador.'],
    ['ADMIN', 'Un administrador cerró tu sesión.'],
  ])('%s devuelve su texto', (motivo, texto) => {
    expect(mensajeCierre(motivo)).toBe(texto);
  });

  it('null y motivos desconocidos no muestran mensaje', () => {
    expect(mensajeCierre(null)).toBeNull();
    expect(mensajeCierre('OTRO')).toBeNull();
  });
});
