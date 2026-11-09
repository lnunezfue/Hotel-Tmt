import { randomBytes } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { cookiesDe, crearApp, crearUsuarioPrueba, encabezadoCookies } from './utilidades';

/** Spec S-03 §4: alta, edición, desactivación, desbloqueo, clave temporal y roles. */
describe('Usuarios y roles (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: { cookie: string; id: number };
  let sucursales: number[];
  let rolRecepcion: number;

  const http = () => request(app.getHttpServer());
  const nombre = () => `e2e_${randomBytes(4).toString('hex')}`;

  async function ingresar(username: string, password: string) {
    const res = await http().post('/api/auth/login').send({ username, password });
    return { res, cookie: encabezadoCookies(cookiesDe(res)) };
  }

  async function crearPorApi(extra: Record<string, unknown> = {}) {
    const username = nombre();
    const res = await http()
      .post('/api/organizacion/usuarios')
      .set('Cookie', admin.cookie)
      .send({
        username,
        nombres: 'Rosa',
        apellidos: 'Prueba',
        rolId: rolRecepcion,
        sucursales: [{ id: sucursales[0], principal: true }],
        clave: 'Temporal-2026',
        ...extra,
      });
    return { res, username };
  }

  beforeAll(async () => {
    ({ app, prisma } = await crearApp());
    const u = await crearUsuarioPrueba(prisma, { permisos: ['usuario.ver', 'usuario.gestionar'] });
    const { res, cookie } = await ingresar(u.username, u.password);
    expect(res.status).toBe(200);
    admin = { cookie, id: u.id };
    sucursales = (await prisma.sucursal.findMany({ orderBy: { id: 'asc' } })).map((s) => s.id);
    rolRecepcion = (await prisma.rol.findUniqueOrThrow({ where: { nombre: 'RECEPCIONISTA' } })).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('sin usuario.gestionar no se crean usuarios', async () => {
    const lector = await crearUsuarioPrueba(prisma, { permisos: ['usuario.ver'] });
    const { cookie } = await ingresar(lector.username, lector.password);
    const res = await http().post('/api/organizacion/usuarios').set('Cookie', cookie).send({});
    expect(res.status).toBe(403);
  });

  it('crea un usuario con clave temporal y lo audita', async () => {
    const { res, username } = await crearPorApi();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ username, rol: 'RECEPCIONISTA', estado: 'ACTIVO', debeCambiarClave: true });
    expect(res.body).not.toHaveProperty('password_hash');

    const aud = await prisma.auditoria.findMany({ where: { accion: 'usuario.crear', registro_id: BigInt(res.body.id as number) } });
    expect(aud).toHaveLength(1);
    expect(aud[0].usuario_id).toBe(admin.id);
    expect(JSON.stringify(aud[0].datos_despues)).not.toContain('Temporal-2026');
  });

  it('rechaza username repetido, clave débil y sucursales sin principal', async () => {
    const { username } = await crearPorApi();
    expect((await crearPorApi({ username })).res.status).toBe(409);
    const debil = await crearPorApi({ clave: 'abc' });
    expect(debil.res.status).toBe(400);
    expect(debil.res.body.message).toMatch(/8 caracteres/);
    const sinPrincipal = await crearPorApi({ sucursales: [{ id: sucursales[0], principal: false }] });
    expect(sinPrincipal.res.status).toBe(400);
  });

  it('con clave temporal solo puede consultar su sesión y cambiar la contraseña', async () => {
    const { res, username } = await crearPorApi();
    expect(res.status).toBe(201);
    const s = await ingresar(username, 'Temporal-2026');
    expect(s.res.status).toBe(200);
    expect(s.res.body.debeCambiarClave).toBe(true);

    const bloqueada = await http().get('/api/hospedaje/tablero').set('Cookie', s.cookie);
    expect(bloqueada.status).toBe(403);
    expect(bloqueada.body.codigo).toBe('CAMBIO_CLAVE_REQUERIDO');
    expect((await http().get('/api/auth/me').set('Cookie', s.cookie)).status).toBe(200);

    const mal = await http().post('/api/auth/clave').set('Cookie', s.cookie).send({ actual: 'otra-cosa-1', nueva: 'NuevaClave-77' });
    expect(mal.status).toBe(400);

    const cambio = await http().post('/api/auth/clave').set('Cookie', s.cookie).send({ actual: 'Temporal-2026', nueva: 'NuevaClave-77' });
    expect(cambio.status).toBe(200);
    expect(cambio.body.debeCambiarClave).toBe(false);
    const nueva = encabezadoCookies({ ...cookiesDe(s.res), ...cookiesDe(cambio) });
    expect((await http().get('/api/hospedaje/tablero').set('Cookie', nueva)).status).toBe(200);
    expect((await ingresar(username, 'NuevaClave-77')).res.status).toBe(200);
    expect(await prisma.auditoria.count({ where: { accion: 'auth.cambio_clave', registro_id: BigInt(res.body.id as number) } })).toBe(1);
  });

  it('desactivar revoca sus sesiones y ya no puede renovar ni ingresar', async () => {
    const u = await crearUsuarioPrueba(prisma, { permisos: ['usuario.ver'] });
    const s = await ingresar(u.username, u.password);
    const res = await http().post(`/api/organizacion/usuarios/${u.id}/desactivar`).set('Cookie', admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ estado: 'INACTIVO', sesionesCerradas: 1 });

    const sesion = await prisma.sesion_usuario.findFirstOrThrow({ where: { usuario_id: u.id } });
    expect(sesion.motivo_revocacion).toBe('USUARIO_INACTIVO');
    const renovar = await http().post('/api/auth/refresh').set('Cookie', s.cookie);
    expect(renovar.status).toBe(401);
    expect(renovar.body.codigo).toBe('SESION_CERRADA');
    expect((await ingresar(u.username, u.password)).res.status).toBe(401);

    expect((await http().post(`/api/organizacion/usuarios/${u.id}/activar`).set('Cookie', admin.cookie)).status).toBe(200);
    expect((await ingresar(u.username, u.password)).res.status).toBe(200);
  });

  it('no permite desactivarse a sí mismo', async () => {
    const res = await http().post(`/api/organizacion/usuarios/${admin.id}/desactivar`).set('Cookie', admin.cookie);
    expect(res.status).toBe(403);
  });

  it('cambiar el rol cierra las sesiones del usuario editado', async () => {
    const u = await crearUsuarioPrueba(prisma, { permisos: ['usuario.ver'] });
    await ingresar(u.username, u.password);
    const res = await http().patch(`/api/organizacion/usuarios/${u.id}`).set('Cookie', admin.cookie).send({ rolId: rolRecepcion, nombres: 'Editado' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rol: 'RECEPCIONISTA', nombres: 'Editado', sesionesCerradas: 1 });
    const aud = await prisma.auditoria.findFirstOrThrow({ where: { accion: 'usuario.editar', registro_id: BigInt(u.id) } });
    expect(aud.datos_antes).toMatchObject({ rolId: u.rolId });
  });

  it('desbloquea tras tres intentos fallidos y restablece la clave', async () => {
    const u = await crearUsuarioPrueba(prisma, { permisos: ['usuario.ver'] });
    for (let i = 0; i < 3; i++) await ingresar(u.username, 'incorrecta');
    expect((await ingresar(u.username, u.password)).res.status).toBe(403);

    const lista = await http().get('/api/organizacion/usuarios').set('Cookie', admin.cookie);
    expect(lista.body.find((x: { id: number }) => x.id === u.id).estado).toBe('BLOQUEADO');
    expect((await http().post(`/api/organizacion/usuarios/${u.id}/desbloquear`).set('Cookie', admin.cookie)).status).toBe(200);
    expect((await ingresar(u.username, u.password)).res.status).toBe(200);
    expect((await http().post(`/api/organizacion/usuarios/${u.id}/desbloquear`).set('Cookie', admin.cookie)).status).toBe(409);

    const r = await http().post(`/api/organizacion/usuarios/${u.id}/restablecer-clave`).set('Cookie', admin.cookie).send({ clave: 'Reinicio-2026' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ debeCambiarClave: true, sesionesCerradas: 1 });
    expect((await ingresar(u.username, u.password)).res.status).toBe(401);
    expect((await ingresar(u.username, 'Reinicio-2026')).res.body.debeCambiarClave).toBe(true);
  });

  it('crea un rol, edita sus permisos y protege ADMINISTRADOR', async () => {
    const rol = await http()
      .post('/api/organizacion/roles')
      .set('Cookie', admin.cookie)
      .send({ nombre: `PRUEBA ${randomBytes(4).toString('hex').replace(/\d/g, (d) => 'ghijklmnop'[Number(d)])}`, permisos: ['reporte.ver'] });
    expect(rol.status).toBe(201);
    const editado = await http().put(`/api/organizacion/roles/${rol.body.id}/permisos`).set('Cookie', admin.cookie).send({ permisos: ['reporte.ver', 'caja.abrir'] });
    expect(editado.status).toBe(200);
    expect(editado.body.permisos).toEqual(['caja.abrir', 'reporte.ver']);
    const desconocido = await http().put(`/api/organizacion/roles/${rol.body.id}/permisos`).set('Cookie', admin.cookie).send({ permisos: ['no.existe'] });
    expect(desconocido.status).toBe(400);

    const adminRol = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'ADMINISTRADOR' } });
    expect((await http().put(`/api/organizacion/roles/${adminRol.id}/permisos`).set('Cookie', admin.cookie).send({ permisos: [] })).status).toBe(409);
  });
});
