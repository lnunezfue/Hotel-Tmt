import { Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificadorTablero } from '../domain/notificador-tablero.port';
import { AvisosTablero } from './avisos-tablero.service';

describe('AvisosTablero', () => {
  let notificador: { publicar: jest.Mock; escuchar: jest.Mock };
  let prisma: { sucursal: { findMany: jest.Mock } };
  let svc: AvisosTablero;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    notificador = { publicar: jest.fn().mockResolvedValue(undefined), escuchar: jest.fn() };
    prisma = { sucursal: { findMany: jest.fn() } };
    svc = new AvisosTablero(notificador as unknown as NotificadorTablero, prisma as unknown as PrismaService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('publica el aviso de la sucursal', async () => {
    await svc.avisar(3, 'estado');
    expect(notificador.publicar).toHaveBeenCalledWith({ sucursalId: 3, motivo: 'estado' });
  });

  it('no rechaza si el notificador falla', async () => {
    notificador.publicar.mockRejectedValue(new Error('redis caído'));
    await expect(svc.avisar(3, 'estado')).resolves.toBeUndefined();
  });

  it('no rechaza si el notificador lanza de forma síncrona', async () => {
    notificador.publicar.mockImplementation(() => {
      throw new Error('sin conexión');
    });
    await expect(svc.avisar(3, 'estado')).resolves.toBeUndefined();
  });

  it('avisa a cada sucursal de la empresa', async () => {
    prisma.sucursal.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    await svc.avisarEmpresa(9, 'tipo');
    expect(prisma.sucursal.findMany).toHaveBeenCalledWith({ where: { empresa_id: 9 }, select: { id: true } });
    expect(notificador.publicar.mock.calls).toEqual([[{ sucursalId: 1, motivo: 'tipo' }], [{ sucursalId: 2, motivo: 'tipo' }]]);
  });

  it('avisarEmpresa sigue con las demás sucursales si una falla, y no rechaza', async () => {
    prisma.sucursal.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    notificador.publicar.mockRejectedValueOnce(new Error('x'));
    await expect(svc.avisarEmpresa(9, 'tipo')).resolves.toBeUndefined();
    expect(notificador.publicar).toHaveBeenCalledTimes(2);
  });

  it('avisarEmpresa no rechaza si falla la consulta de sucursales', async () => {
    prisma.sucursal.findMany.mockRejectedValue(new Error('bd'));
    await expect(svc.avisarEmpresa(9, 'tipo')).resolves.toBeUndefined();
    expect(notificador.publicar).not.toHaveBeenCalled();
  });
});
