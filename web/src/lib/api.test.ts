import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alCerrarSesion, api, ApiError } from './api';

const json = (status: number, cuerpo: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });

describe('cliente HTTP', () => {
  const manejador = vi.fn();

  beforeEach(() => {
    manejador.mockReset();
    alCerrarSesion(manejador);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tres peticiones con acceso vencido hacen una sola renovación y se reintentan', async () => {
    let renovado = false;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/refresh') {
        await new Promise((r) => setTimeout(r, 10));
        renovado = true;
        return json(200, { sub: 1 });
      }
      return renovado ? json(200, { ok: true }) : json(401, { message: 'Acceso vencido', codigo: 'ACCESO_EXPIRADO' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const r = await Promise.all([api('/x'), api('/x'), api('/x')]);

    expect(r).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls.filter((u) => u === '/api/auth/refresh')).toHaveLength(1);
    expect(urls.filter((u) => u === '/api/x')).toHaveLength(6);
    expect(manejador).not.toHaveBeenCalled();
  });

  it('si la renovación falla avisa al manejador con el motivo', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === '/api/auth/refresh'
        ? json(401, { message: 'Sesión cerrada', codigo: 'SESION_CERRADA', motivo: 'INACTIVIDAD' })
        : json(401, { message: 'Acceso vencido', codigo: 'ACCESO_EXPIRADO' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const error = (await api('/x').catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.codigo).toBe('SESION_CERRADA');
    expect(error.motivo).toBe('INACTIVIDAD');
    expect(manejador).toHaveBeenCalledTimes(1);
    expect(manejador).toHaveBeenCalledWith('INACTIVIDAD');
  });

  it('una sesión cerrada en otra pestaña lleva al login', async () => {
    const fetchMock = vi.fn(async () => json(401, { message: 'Sin sesión', codigo: 'SIN_SESION' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('/hospedaje/tablero')).rejects.toBeInstanceOf(ApiError);

    expect(manejador).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('/auth/me sin sesión no dispara el manejador', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { message: 'Sin sesión', codigo: 'SIN_SESION' })));

    await expect(api('/auth/me')).rejects.toBeInstanceOf(ApiError);

    expect(manejador).not.toHaveBeenCalled();
  });

  it('conserva el mensaje de los errores que no son 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(400, { message: ['Uno', 'Dos'] })));
    await expect(api('/x')).rejects.toMatchObject({ status: 400, message: 'Uno. Dos' });
  });
});
