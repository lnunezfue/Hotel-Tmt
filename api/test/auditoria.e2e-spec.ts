import { Controller, INestApplication, Post } from '@nestjs/common';
import request from 'supertest';
import { Auditar } from '../src/modules/auditoria/auditar.decorator';
import { PrismaService } from '../src/prisma/prisma.service';
import { cookiesDe, crearApp, crearUsuarioPrueba, encabezadoCookies } from './utilidades';

@Controller('prueba-auditoria')
class ControladorPrueba {
  @Auditar('habitacion.crear')
  @Post()
  nada() {
    return { ok: true };
  }
}

describe('Auditoría (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await crearApp({ controllers: [ControladorPrueba] }));
  });

  afterAll(async () => {
    await app?.close();
  });

  const http = () => request(app.getHttpServer());

  async function sesionDe(permisos: string[]) {
    const u = await crearUsuarioPrueba(prisma, { permisos });
    const res = await http().post('/api/auth/login').send({ username: u.username, password: u.password });
    expect(res.status).toBe(200);
    return { u, cookie: encabezadoCookies(cookiesDe(res)) };
  }

  it('crear habitación queda auditado', async () => {
    const { u, cookie } = await sesionDe(['habitacion.gestionar']);
    const me = await http().get('/api/auth/me').set('Cookie', cookie);
    const sucursalId = me.body.sucursalId as number;

    const piso = await prisma.piso.findFirstOrThrow({ where: { sucursal_id: sucursalId } });
    const tipo = await prisma.tipo_habitacion.findFirstOrThrow({ where: { activo: true } });
    const numero = `E2E-${Math.random().toString(36).slice(2, 8)}`.slice(0, 10);

    const res = await http()
      .post('/api/hospedaje/habitaciones')
      .set('Cookie', cookie)
      .send({ numero, pisoId: piso.id, tipoHabitacionId: tipo.id });
    expect(res.status).toBe(201);

    const filas = await prisma.auditoria.findMany({
      where: { accion: 'habitacion.crear', registro_id: BigInt(res.body.id as number), usuario_id: u.id },
    });
    expect(filas).toHaveLength(1);
    expect(filas[0].tabla).toBe('habitacion');
    expect(filas[0].sucursal_id).toBe(sucursalId);

    await prisma.habitacion.delete({ where: { id: res.body.id as number } });
  });

  it('la bitácora no se modifica ni se borra', async () => {
    const fila = await prisma.auditoria.findFirst({ orderBy: { id: 'desc' } });
    expect(fila).not.toBeNull();
    const id = fila!.id;
    await expect(prisma.$executeRaw`UPDATE auditoria SET tabla = 'x' WHERE id = ${id}`).rejects.toThrow(
      'La bitácora de auditoría no se modifica',
    );
    await expect(prisma.$executeRaw`DELETE FROM auditoria WHERE id = ${id}`).rejects.toThrow(
      'La bitácora de auditoría no se elimina',
    );
  });

  it('un endpoint con @Auditar que no registra falla en pruebas', async () => {
    const { cookie } = await sesionDe(['usuario.ver']);
    const res = await http().post('/api/prueba-auditoria').set('Cookie', cookie).send({});
    expect(res.status).toBe(500);
  });
});
