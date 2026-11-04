import { Prisma } from '@prisma/client';
import { sanitizar } from './sanitizar';

describe('sanitizar', () => {
  it('oculta claves sensibles a cualquier profundidad', () => {
    expect(sanitizar({ username: 'ana', password_hash: 'x', datos: { refresh_hash: 'y', Token: 'z', sunat_clave_sol: 'w', secreto: 's' } }))
      .toEqual({ username: 'ana', password_hash: '[oculto]', datos: { refresh_hash: '[oculto]', Token: '[oculto]', sunat_clave_sol: '[oculto]', secreto: '[oculto]' } });
  });
  it('convierte bigint, Decimal y Date a texto', () => {
    expect(sanitizar({ id: 5n, precio: new Prisma.Decimal('12.50'), f: new Date('2026-11-05T14:00:00Z') }))
      .toEqual({ id: '5', precio: '12.5', f: '2026-11-05T14:00:00.000Z' });
  });
  it('respeta arreglos, null y undefined', () => {
    expect(sanitizar([{ clave: 1 }, null])).toEqual([{ clave: '[oculto]' }, null]);
    expect(sanitizar(undefined)).toBeUndefined();
  });
});
