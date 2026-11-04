import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { leerConfigAuth } from '../src/config';
import { hashSecreto, parsearToken } from '../src/modules/auth/domain/token-renovacion';
import { PrismaService } from '../src/prisma/prisma.service';
import { cookiesDe, crearApp, crearUsuarioPrueba, encabezadoCookies } from './utilidades';

const ACCESO = 'hotel_sesion';
const RENOVACION = 'hotel_renovacion';
const MENSAJE_SIN_SUCURSALES = 'Tu usuario no tiene sucursales asignadas. Consulta con un administrador';

describe('Sesiones con renovación (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await crearApp());
  });

  afterAll(async () => {
    await app?.close();
  });

  const http = () => request(app.getHttpServer());

  async function login(u: { username: string; password: string }) {
    const res = await http().post('/api/auth/login').send({ username: u.username, password: u.password });
    expect(res.status).toBe(200);
    return { res, cookies: cookiesDe(res), sid: BigInt(res.body.sid as string) };
  }

  function refrescar(cookies: Record<string, string>) {
    return http().post('/api/auth/refresh').set('Cookie', encabezadoCookies(cookies));
  }

  function me(cookies: Record<string, string>) {
    return http().get('/api/auth/me').set('Cookie', encabezadoCookies(cookies));
  }

  const sesion = (id: bigint) => prisma.sesion_usuario.findUniqueOrThrow({ where: { id } });
  const auditoriaDe = (accion: string, registroId: bigint) =>
    prisma.auditoria.findMany({ where: { accion, registro_id: registroId }, orderBy: { id: 'asc' } });

  it('login crea una sesión, fija ambas cookies y registra auth.login', async () => {
    const u = await crearUsuarioPrueba(prisma);
    const { cookies, sid } = await login(u);

    expect(cookies[ACCESO]).toBeTruthy();
    expect(cookies[RENOVACION]).toBeTruthy();
    expect(parsearToken(cookies[RENOVACION])?.sesionId).toBe(sid);

    const s = await sesion(sid);
    expect(s.usuario_id).toBe(u.id);
    expect(s.revocada_at).toBeNull();
    expect(s.refresh_hash).toBe(hashSecreto(parsearToken(cookies[RENOVACION])!.secreto));

    const aud = await auditoriaDe('auth.login', sid);
    expect(aud).toHaveLength(1);
    expect(aud[0].tabla).toBe('sesion_usuario');
    expect(aud[0].usuario_id).toBe(u.id);
    expect(aud[0].ip).not.toBeNull();
  });

  it('un acceso vencido responde ACCESO_EXPIRADO', async () => {
    const u = await crearUsuarioPrueba(prisma);
    const { res } = await login(u);
    const ahoraSeg = Math.floor(Date.now() / 1000);
    const vencido = new JwtService({ secret: leerConfigAuth().jwtSecret }).sign({ ...res.body, exp: ahoraSeg - 60 });

    const r1 = await me({ [ACCESO]: vencido });
    expect(r1.status).toBe(401);
    expect(r1.body).toMatchObject({ codigo: 'ACCESO_EXPIRADO' });

    const r2 = await http().get('/api/auth/me');
    expect(r2.status).toBe(401);
    expect(r2.body).toMatchObject({ codigo: 'SIN_SESION' });
  });

  it('refresh justo después del login rota el token', async () => {
    // La prueba solo vale si el proceso corre con una zona distinta de la de MySQL (UTC).
    expect(new Date(Date.UTC(2026, 0, 1)).getTimezoneOffset()).toBe(300);

    const u = await crearUsuarioPrueba(prisma);
    const { cookies, sid } = await login(u);

    // Las fechas guardadas son UTC reales, medidas por el propio motor (no por el proceso).
    const [deriva] = await prisma.$queryRaw<{ creada: bigint; renovada: bigint; expira: bigint }[]>`
      SELECT TIMESTAMPDIFF(SECOND, creada_at, UTC_TIMESTAMP()) AS creada,
             TIMESTAMPDIFF(SECOND, ultima_renovacion_at, UTC_TIMESTAMP()) AS renovada,
             TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), expira_at) AS expira
      FROM sesion_usuario WHERE id = ${sid}`;
    expect(Math.abs(Number(deriva.creada))).toBeLessThan(60);
    expect(Math.abs(Number(deriva.renovada))).toBeLessThan(60);
    expect(Math.abs(Number(deriva.expira) - leerConfigAuth().sesionMaxHoras * 60)).toBeLessThanOrEqual(1);

    const anterior = await sesion(sid);
    const r = await refrescar(cookies);
    expect(r.status).toBe(200);
    const nuevas = cookiesDe(r);
    expect(nuevas[ACCESO]).toBeTruthy();
    expect(nuevas[RENOVACION]).toBeTruthy();
    expect(nuevas[RENOVACION]).not.toBe(cookies[RENOVACION]);

    const s = await sesion(sid);
    expect(s.refresh_hash_anterior).toBe(anterior.refresh_hash);
    expect(s.refresh_hash).toBe(hashSecreto(parsearToken(nuevas[RENOVACION])!.secreto));
    expect(s.rotada_at).not.toBeNull();
    expect(s.revocada_at).toBeNull();
  });

  it('reusar un token rotado pasada la gracia revoca la sesión', async () => {
    const u = await crearUsuarioPrueba(prisma);
    const { cookies: viejas, sid } = await login(u);
    const r1 = await refrescar(viejas);
    expect(r1.status).toBe(200);
    const nuevas = { ...viejas, ...cookiesDe(r1) };

    await prisma.sesion_usuario.update({ where: { id: sid }, data: { rotada_at: new Date(Date.now() - 60_000) } });

    const r2 = await refrescar(viejas);
    expect(r2.status).toBe(401);
    expect(r2.body).toMatchObject({ codigo: 'SESION_CERRADA', motivo: 'REUSO' });
    expect((await sesion(sid)).motivo_revocacion).toBe('REUSO');

    const r3 = await refrescar(nuevas);
    expect(r3.status).toBe(401);
    expect(r3.body).toMatchObject({ codigo: 'SESION_CERRADA', motivo: 'REUSO' });

    const aud = await auditoriaDe('auth.sesion_revocada', sid);
    expect(aud).toHaveLength(1);
    expect(aud[0].datos_despues).toEqual({ motivo: 'REUSO' });
    expect(aud[0].usuario_id).toBe(u.id);
  });

  it('dos renovaciones con el mismo token dentro de 30 s no cierran la sesión', async () => {
    const u = await crearUsuarioPrueba(prisma);
    const { cookies, sid } = await login(u);

    const r1 = await refrescar(cookies);
    const r2 = await refrescar(cookies);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(cookiesDe(r1)[RENOVACION]).toBeTruthy();
    expect(cookiesDe(r2)[ACCESO]).toBeTruthy();
    expect(cookiesDe(r2)[RENOVACION]).toBeUndefined();
    expect((await sesion(sid)).revocada_at).toBeNull();

    // Simultáneas: el bloqueo de fila hace que exactamente una rote y la otra entre por la tolerancia.
    const otra = await login(u);
    const [a, b] = await Promise.all([refrescar(otra.cookies), refrescar(otra.cookies)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const rotadas = [a, b].map((r) => cookiesDe(r)[RENOVACION]).filter((v): v is string => v !== undefined);
    expect(rotadas).toHaveLength(1);
    const s = await sesion(otra.sid);
    expect(s.revocada_at).toBeNull();
    expect(s.refresh_hash).toBe(hashSecreto(parsearToken(rotadas[0])!.secreto));
  });

  it('sin renovar más allá del respaldo expira por inactividad', async () => {
    const u = await crearUsuarioPrueba(prisma);
    const { cookies, sid } = await login(u);
    const empresa = await prisma.empresa.findFirstOrThrow({ where: { usuario: { some: { id: u.id } } } });
    const minutos = empresa.sesion_inactividad_min + leerConfigAuth().accesoMin + 1; // 46 con los valores por defecto
    await prisma.sesion_usuario.update({
      where: { id: sid },
      data: { ultima_renovacion_at: new Date(Date.now() - minutos * 60_000) },
    });

    const r = await refrescar(cookies);
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ codigo: 'SESION_CERRADA', motivo: 'INACTIVIDAD' });
    expect(cookiesDe(r)[RENOVACION]).toBe('');
    expect((await sesion(sid)).motivo_revocacion).toBe('INACTIVIDAD');
  });

  it('un usuario desactivado pierde el acceso al renovar', async () => {
    const u = await crearUsuarioPrueba(prisma);
    const { cookies, sid } = await login(u);
    await prisma.usuario.update({ where: { id: u.id }, data: { activo: false } });

    const r = await refrescar(cookies);
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ codigo: 'SESION_CERRADA', motivo: 'USUARIO_INACTIVO' });
    expect((await sesion(sid)).motivo_revocacion).toBe('USUARIO_INACTIVO');
  });

  it('los permisos del rol se releen al renovar', async () => {
    const u = await crearUsuarioPrueba(prisma);
    const { cookies } = await login(u);
    const permiso = await prisma.permiso.findUniqueOrThrow({ where: { codigo: 'habitacion.gestionar' } });
    await prisma.rol_permiso.create({ data: { rol_id: u.rolId, permiso_id: permiso.id } });

    const r = await refrescar(cookies);
    expect(r.status).toBe(200);
    const m = await me({ ...cookies, ...cookiesDe(r) });
    expect(m.status).toBe(200);
    expect(m.body.permisos).toEqual(expect.arrayContaining(['usuario.ver', 'habitacion.gestionar']));
  });

  it('logout revoca y funciona con el acceso vencido', async () => {
    const u = await crearUsuarioPrueba(prisma);
    const { cookies, sid } = await login(u);

    const r = await http()
      .post('/api/auth/logout')
      .set('Cookie', encabezadoCookies({ [RENOVACION]: cookies[RENOVACION] }));
    expect(r.status).toBe(204);
    const borradas = (r.headers['set-cookie'] as unknown as string[]) ?? [];
    for (const nombre of [ACCESO, RENOVACION]) {
      const linea = borradas.find((l) => l.startsWith(`${nombre}=`));
      expect(linea).toBeDefined();
      expect(linea).toMatch(new RegExp(`^${nombre}=;`));
      expect(linea).toMatch(/Expires=Thu, 01 Jan 1970/);
    }
    const s = await sesion(sid);
    expect(s.revocada_at).not.toBeNull();
    expect(s.motivo_revocacion).toBe('LOGOUT');
    const aud = await auditoriaDe('auth.logout', sid);
    expect(aud).toHaveLength(1);
    expect(aud[0].datos_despues).toEqual({ motivo: 'LOGOUT' });
    expect(aud[0].usuario_id).toBe(u.id);

    // La sesión cerrada ya no renueva.
    expect((await refrescar(cookies)).body).toMatchObject({ codigo: 'SESION_CERRADA', motivo: 'LOGOUT' });

    const otra = await login(u);
    const r2 = await http()
      .post('/api/auth/logout')
      .set('Cookie', encabezadoCookies({ [RENOVACION]: otra.cookies[RENOVACION] }))
      .send({ motivo: 'INACTIVIDAD' });
    expect(r2.status).toBe(204);
    expect((await sesion(otra.sid)).motivo_revocacion).toBe('INACTIVIDAD');
    expect((await auditoriaDe('auth.logout', otra.sid))[0].datos_despues).toEqual({ motivo: 'INACTIVIDAD' });

    // Sin cookie también responde 204.
    expect((await http().post('/api/auth/logout')).status).toBe(204);
  });

  it('login fallido queda auditado', async () => {
    const u = await crearUsuarioPrueba(prisma);
    const r = await http().post('/api/auth/login').send({ username: u.username, password: 'clave-erronea' });
    expect(r.status).toBe(401);
    const aud = await prisma.auditoria.findMany({ where: { accion: 'auth.login_fallido', registro_id: BigInt(u.id) } });
    expect(aud).toHaveLength(1);
    expect(aud[0].tabla).toBe('usuario');
    expect(aud[0].datos_despues).toEqual({ username: u.username, motivo: 'CLAVE_INCORRECTA' });
    expect(aud[0].ip).not.toBeNull();

    const fantasma = `e2e_no_existe_${Date.now()}`;
    const r2 = await http().post('/api/auth/login').send({ username: fantasma, password: 'lo-que-sea' });
    expect(r2.status).toBe(401);
    const aud2 = await prisma.auditoria.findMany({
      where: { accion: 'auth.login_fallido', datos_despues: { path: '$.username', equals: fantasma } },
    });
    expect(aud2).toHaveLength(1);
    expect(aud2[0].registro_id).toBeNull();
    expect(aud2[0].usuario_id).toBeNull();
    expect(aud2[0].datos_despues).toEqual({ username: fantasma, motivo: 'NO_EXISTE' });
  });

  it('usuario sin sucursales', async () => {
    const sin = await crearUsuarioPrueba(prisma, { sucursales: 'ninguna' });
    const r = await http().post('/api/auth/login').send({ username: sin.username, password: sin.password });
    expect(r.status).toBe(403);
    expect(r.body.message).toBe(MENSAJE_SIN_SUCURSALES);
    expect(cookiesDe(r)[RENOVACION]).toBeUndefined();
    const aud = await prisma.auditoria.findMany({ where: { accion: 'auth.login_fallido', registro_id: BigInt(sin.id) } });
    expect(aud).toHaveLength(1);
    expect(aud[0].datos_despues).toEqual({ username: sin.username, motivo: 'SIN_SUCURSALES' });
    expect(await prisma.sesion_usuario.count({ where: { usuario_id: sin.id } })).toBe(0);

    const u = await crearUsuarioPrueba(prisma);
    const { cookies, sid } = await login(u);
    await prisma.usuario_sucursal.deleteMany({ where: { usuario_id: u.id } });
    const r2 = await refrescar(cookies);
    expect(r2.status).toBe(401);
    expect(r2.body).toMatchObject({ codigo: 'SESION_CERRADA', motivo: 'USUARIO_INACTIVO' });
    expect((await sesion(sid)).motivo_revocacion).toBe('USUARIO_INACTIVO');
  });

  it('cookie de renovación manipulada', async () => {
    for (const valor of ['abc', '1.', '99999999999.x', '1.' + 'a'.repeat(5000), 'j:{"a":1}', '99999999999999999999.x']) {
      const r = await refrescar({ [RENOVACION]: valor });
      expect({ valor: valor.slice(0, 20), status: r.status, codigo: r.body.codigo }).toEqual({
        valor: valor.slice(0, 20),
        status: 401,
        codigo: 'SIN_SESION',
      });
    }
    const sinCookie = await http().post('/api/auth/refresh');
    expect(sinCookie.status).toBe(401);
    expect(sinCookie.body).toMatchObject({ codigo: 'SIN_SESION' });
  });

  it('cambiar de sucursal', async () => {
    const u = await crearUsuarioPrueba(prisma);
    const { res, cookies, sid } = await login(u);
    const [principal, segunda] = res.body.sucursales as number[];
    expect(segunda).toBeDefined();
    expect(res.body.sucursalId).toBe(principal);

    const r = await http().post('/api/auth/sucursal').set('Cookie', encabezadoCookies(cookies)).send({ sucursalId: segunda });
    expect(r.status).toBe(200);
    expect(r.body.sucursalId).toBe(segunda);
    expect(cookiesDe(r)[ACCESO]).toBeTruthy();
    expect((await sesion(sid)).sucursal_id).toBe(segunda);
    const aud = await auditoriaDe('auth.cambio_sucursal', sid);
    expect(aud).toHaveLength(1);
    expect(aud[0].datos_antes).toEqual({ sucursal_id: principal });
    expect(aud[0].datos_despues).toEqual({ sucursal_id: segunda });
    expect(aud[0].usuario_id).toBe(u.id);

    const ajena = await http().post('/api/auth/sucursal').set('Cookie', encabezadoCookies(cookies)).send({ sucursalId: 999999 });
    expect(ajena.status).toBe(403);

    await prisma.sesion_usuario.update({ where: { id: sid }, data: { revocada_at: new Date(), motivo_revocacion: 'ADMIN' } });
    const r2 = await http().post('/api/auth/sucursal').set('Cookie', encabezadoCookies(cookies)).send({ sucursalId: principal });
    expect(r2.status).toBe(401);
    expect(r2.body).toMatchObject({ codigo: 'SESION_CERRADA', motivo: 'ADMIN' });
    expect((await sesion(sid)).sucursal_id).toBe(segunda);
    expect(await auditoriaDe('auth.cambio_sucursal', sid)).toHaveLength(1);
  });

  it('si se desasigna la sucursal activa, la renovación pasa a la principal', async () => {
    const u = await crearUsuarioPrueba(prisma);
    const { res, cookies, sid } = await login(u);
    const [principal, segunda] = res.body.sucursales as number[];

    const c = await http().post('/api/auth/sucursal').set('Cookie', encabezadoCookies(cookies)).send({ sucursalId: segunda });
    expect(c.status).toBe(200);
    await prisma.usuario_sucursal.delete({ where: { usuario_id_sucursal_id: { usuario_id: u.id, sucursal_id: segunda } } });

    const r = await refrescar({ ...cookies, ...cookiesDe(c) });
    expect(r.status).toBe(200);
    const m = await me({ ...cookies, ...cookiesDe(r) });
    expect(m.status).toBe(200);
    expect(m.body.sucursalId).toBe(principal);
    expect(m.body.sucursales).not.toContain(segunda);
    expect((await sesion(sid)).sucursal_id).toBe(principal);
  });
});
