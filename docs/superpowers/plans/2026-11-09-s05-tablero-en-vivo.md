# S-05 Tablero en vivo — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el tablero de habitaciones refleje en menos de 1 s los cambios hechos desde otro navegador de la misma sucursal, sin recargar.

**Architecture:** Los cambios siguen entrando por REST. Tras confirmar cada cambio, el servicio publica un aviso sin datos en Redis (`tablero:sucursal:{id}`); cada réplica de la API lo reenvía por Server-Sent Events a los navegadores de esa sucursal, que vuelven a pedir `GET /hospedaje/tablero`. Una consulta cada 60 s queda como respaldo.

**Tech Stack:** NestJS 11 (`@Sse`, RxJS 7), `ioredis` 5, Redis 7, React 19 + TanStack Query 5, `EventSource` nativo, Jest (API), Vitest (web, sin DOM).

**Spec:** `docs/superpowers/specs/2026-11-09-s05-tablero-en-vivo-design.md`

## Global Constraints

- Rama `s05-tablero-en-vivo`. Un commit por tarea, mensajes en español con prefijo convencional (`feat(hospedaje): …`).
- Código, nombres y textos en español, como el resto del repo.
- La sucursal sale siempre del token (`u.sucursalId`), nunca de un parámetro.
- Canal de Redis: `tablero:sucursal:{id}`. Patrón de suscripción: `tablero:sucursal:*`.
- Motivos del aviso: `estado`, `habitacion`, `piso`, `tipo`. Ninguno más.
- Latido cada 25 000 ms. Respaldo del cliente cada 60 000 ms. Esperas de reconexión: 1, 2, 4, 8, 16 y 30 s.
- Publicar un aviso nunca hace fallar la operación que lo origina, y se publica después de confirmar la transacción.
- Única dependencia nueva: `ioredis` en `api`. Nada nuevo en `web` (no hay jsdom ni testing-library: la lógica del cliente se prueba como módulo puro).
- `argon2` sigue fijado en 0.44; no tocar otras versiones.
- Las pruebas e2e necesitan MySQL y Redis: `pnpm infra:up` antes de `pnpm --filter api test:e2e`.

## Review Focus

1. **Redis apagado al arrancar la API** → la API arranca y atiende REST; el cambio de estado responde 200. (Tarea 5, e2e.)
2. **Mensaje basura en el canal de Redis** (otro cliente publica texto no válido) → se descarta y el flujo sigue vivo y entrega el siguiente aviso válido. (Tarea 2 unitaria, Tarea 4 e2e.)
3. **El navegador cierra el flujo** → la API libera la suscripción de ese flujo; no se acumulan oyentes. (Tarea 4, e2e.)
4. **`detener()` con una reconexión pendiente** (el usuario sale del tablero o cierra sesión mientras se espera) → no se reabre el flujo ni se toca el estado. (Tarea 6.)
5. **Pestaña oculta más de 15 min** → al volver, el primer intento falla por token vencido y la conexión se recupera sola por la vía de `revalidar`. (Tarea 6.)

## Estructura de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `web/src/lib/api/cliente.ts`, `tipos.ts`, `index.ts`, `cliente.test.ts` | Crear (desde `lib/api.ts` y `lib/api.test.ts`) | Cliente HTTP, tipos y reexportación |
| `api/src/config.ts`, `config.spec.ts` | Modificar | `leerConfigRedis` |
| `api/src/modules/hospedaje/domain/aviso-tablero.ts` (+ `.spec.ts`) | Crear | Tipo del aviso, canal, lectura validada |
| `api/src/modules/hospedaje/domain/notificador-tablero.port.ts` | Crear | Puerto y token de inyección |
| `api/src/modules/hospedaje/application/flujo-tablero.ts` (+ `.spec.ts`) | Crear | Avisos + latido + corte al vencer |
| `api/src/modules/hospedaje/application/avisos-tablero.service.ts` (+ `.spec.ts`) | Crear | Publicar sin propagar errores; avisar a toda la empresa |
| `api/src/modules/hospedaje/infrastructure/notificador-tablero.redis.ts` | Crear | Adaptador `ioredis` |
| `api/src/modules/hospedaje/tablero-eventos.controller.ts` | Crear | `@Sse('tablero/eventos')` |
| `api/src/modules/hospedaje/hospedaje.module.ts`, `application/hospedaje.service.ts`, `application/configuracion.service.ts`, `api/src/main.ts` | Modificar | Registro y publicación |
| `api/test/utilidades.ts`, `api/test/tablero-en-vivo.e2e-spec.ts` | Modificar / Crear | `abrirFlujo`, sustitución de proveedores, pruebas e2e |
| `.github/workflows/ci.yml` | Modificar | Servicio Redis |
| `web/src/features/hospedaje/conexion-tablero.ts` (+ `.test.ts`), `useTableroEnVivo.ts` | Crear | Lógica de conexión pura y hook |
| `web/src/pages/TableroPage.tsx` | Modificar | Indicador y respaldo de 60 s |
| `README.md`, spec | Modificar | Árbol de carpetas y avance |

---

### Task 1: `lib/api` pasa a carpeta (preparación, spec §7)

**Files:**
- Create: `web/src/lib/api/cliente.ts`, `web/src/lib/api/tipos.ts`, `web/src/lib/api/index.ts`
- Move: `web/src/lib/api.test.ts` → `web/src/lib/api/cliente.test.ts`
- Delete: `web/src/lib/api.ts`

**Interfaces:**
- Produces: `import … from '../lib/api'` sigue resolviendo los mismos nombres: `api`, `ApiError`, `alCerrarSesion`, `Sesion`, `Estado`, `HabitacionTablero`, `Tablero`.

- [ ] **Step 1: Mover sin cambiar comportamiento.** `cliente.ts` recibe `ApiError`, `alCerrarSesion`, `api` y todo el estado de módulo (`alCerrar`, `renovando`); `tipos.ts` recibe las interfaces y `Estado`; `index.ts` contiene solo `export * from './cliente'; export * from './tipos';`. Usar `git mv` para conservar el historial. En `cliente.test.ts`, el import pasa a `./cliente`.
- [ ] **Step 2: Verificar.** Run: `pnpm --filter web test` y `pnpm --filter web typecheck`. Expected: las 29 pruebas pasan, sin errores de tipos, y ningún otro archivo de `web/src` cambió (`git status` muestra solo `lib/`).
- [ ] **Step 3: Commit** — `refactor(web): lib/api como carpeta (DT-001 §4.3)`.

---

### Task 2: Configuración de Redis y dominio del aviso

**Files:**
- Modify: `api/src/config.ts`, `api/src/config.spec.ts`, `api/src/main.ts`, `api/package.json`
- Create: `api/src/modules/hospedaje/domain/aviso-tablero.ts`, `aviso-tablero.spec.ts`, `notificador-tablero.port.ts`

**Interfaces:**
- Produces:
  ```ts
  // config.ts
  export interface ConfigRedis { url: string }
  export function leerConfigRedis(env?: NodeJS.ProcessEnv): ConfigRedis;

  // domain/aviso-tablero.ts
  export const MOTIVOS_AVISO = ['estado', 'habitacion', 'piso', 'tipo'] as const;
  export type MotivoAviso = (typeof MOTIVOS_AVISO)[number];
  export interface AvisoTablero { sucursalId: number; motivo: MotivoAviso }
  export const PATRON_CANALES = 'tablero:sucursal:*';
  export function canalDe(sucursalId: number): string;                 // 'tablero:sucursal:7'
  export function mensajeDe(aviso: AvisoTablero): string;              // '{"motivo":"estado"}'
  export function leerAviso(canal: string, mensaje: string): AvisoTablero | null;

  // domain/notificador-tablero.port.ts
  export const NOTIFICADOR_TABLERO = Symbol('NotificadorTablero');
  export interface NotificadorTablero {
    publicar(aviso: AvisoTablero): Promise<void>;                      // puede rechazar
    escuchar(sucursalId: number): Observable<AvisoTablero>;
  }
  ```

- [ ] **Step 1: Pruebas que fallan** en `config.spec.ts` y `aviso-tablero.spec.ts`:

```ts
describe('leerConfigRedis', () => {
  it('usa redis://localhost:6379 en desarrollo', () => {
    expect(leerConfigRedis({})).toEqual({ url: 'redis://localhost:6379' });
  });
  it('exige REDIS_URL en producción (vacía cuenta como ausente)', () => {
    expect(() => leerConfigRedis({ NODE_ENV: 'production' })).toThrow('REDIS_URL es obligatoria en producción');
    expect(() => leerConfigRedis({ NODE_ENV: 'production', REDIS_URL: ' ' })).toThrow('REDIS_URL es obligatoria en producción');
  });
  it('solo admite redis:// o rediss://', () => {
    expect(leerConfigRedis({ REDIS_URL: 'rediss://h:6380' }).url).toBe('rediss://h:6380');
    expect(() => leerConfigRedis({ REDIS_URL: 'http://h' })).toThrow('REDIS_URL debe empezar por redis:// o rediss://');
  });
});

describe('aviso-tablero', () => {
  it('arma el canal y el mensaje', () => {
    expect(canalDe(7)).toBe('tablero:sucursal:7');
    expect(mensajeDe({ sucursalId: 7, motivo: 'estado' })).toBe('{"motivo":"estado"}');
  });
  it('lee un aviso válido', () => {
    expect(leerAviso('tablero:sucursal:7', '{"motivo":"piso"}')).toEqual({ sucursalId: 7, motivo: 'piso' });
  });
  it.each([
    ['tablero:sucursal:7', 'no es json'],
    ['tablero:sucursal:7', '{"motivo":"otro"}'],
    ['tablero:sucursal:7', '{}'],
    ['tablero:sucursal:7', 'null'],
    ['tablero:sucursal:abc', '{"motivo":"estado"}'],
    ['tablero:sucursal:0', '{"motivo":"estado"}'],
    ['tablero:sucursal:7:x', '{"motivo":"estado"}'],
    ['otro:canal', '{"motivo":"estado"}'],
  ])('descarta %s %s', (canal, mensaje) => {
    expect(leerAviso(canal, mensaje)).toBeNull();
  });
});
```

- [ ] **Step 2:** Run: `pnpm --filter api test -- config aviso-tablero`. Expected: FAIL (funciones no definidas).
- [ ] **Step 3: Implementar** `leerConfigRedis` en `config.ts`, y los dos archivos de dominio con las firmas de arriba. `leerAviso` nunca lanza. El puerto solo declara tipos y el token.
- [ ] **Step 4:** Añadir `leerConfigRedis();` junto a `leerConfigAuth();` en `main.ts` (falla pronto). Instalar la dependencia: `pnpm --filter api add ioredis`.
- [ ] **Step 5:** Run: `pnpm --filter api test -- config aviso-tablero` y `pnpm --filter api typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** — `feat(hospedaje): dominio del aviso de tablero y configuración de Redis`.

---

### Task 3: Flujo de eventos y servicio de avisos (lógica sin Redis)

**Files:**
- Create: `api/src/modules/hospedaje/application/flujo-tablero.ts`, `flujo-tablero.spec.ts`, `avisos-tablero.service.ts`, `avisos-tablero.service.spec.ts`

**Interfaces:**
- Consumes: `AvisoTablero`, `MotivoAviso`, `NotificadorTablero`, `NOTIFICADOR_TABLERO` (Task 2); `PrismaService`.
- Produces:
  ```ts
  // flujo-tablero.ts
  export const LATIDO_MS = 25_000;
  export interface EventoFlujo { type: 'tablero' | 'latido'; data: { motivo: MotivoAviso } | '' }
  /** Avisos como eventos `tablero`, un `latido` cada LATIDO_MS, y fin a los `msHastaVencer`. */
  export function flujoTablero(avisos: Observable<AvisoTablero>, msHastaVencer: number): Observable<EventoFlujo>;

  // avisos-tablero.service.ts
  @Injectable() export class AvisosTablero {
    /** Nunca rechaza: un fallo del notificador se registra con Logger.warn. */
    avisar(sucursalId: number, motivo: MotivoAviso): Promise<void>;
    /** Avisa a todas las sucursales de la empresa. Nunca rechaza (tampoco si falla la consulta). */
    avisarEmpresa(empresaId: number, motivo: MotivoAviso): Promise<void>;
  }
  ```

- [ ] **Step 1: Pruebas que fallan.**

`flujo-tablero.spec.ts` (con `jest.useFakeTimers()` y un `Subject<AvisoTablero>`; recoger lo emitido en un arreglo y una bandera `terminado`):

```ts
it('convierte cada aviso en un evento tablero con su motivo', () => {
  avisos.next({ sucursalId: 1, motivo: 'estado' });
  expect(recibidos).toEqual([{ type: 'tablero', data: { motivo: 'estado' } }]);
});
it('emite un latido cada 25 s', () => {
  jest.advanceTimersByTime(50_000);
  expect(recibidos).toEqual([{ type: 'latido', data: '' }, { type: 'latido', data: '' }]);
});
it('termina al vencer el token y deja de escuchar los avisos', () => {
  // flujoTablero(avisos, 60_000)
  jest.advanceTimersByTime(60_000);
  expect(terminado).toBe(true);
  expect(avisos.observed).toBe(false);
});
it('termina de inmediato si el token ya venció', () => {
  // flujoTablero(avisos, 0) y flujoTablero(avisos, -5)
  expect(terminado).toBe(true);
  expect(recibidos).toEqual([]);
});
it('al cancelar la suscripción deja de escuchar y detiene el latido', () => {
  suscripcion.unsubscribe();
  expect(avisos.observed).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});
```

`avisos-tablero.service.spec.ts` (notificador falso `{ publicar: jest.fn(), escuchar: jest.fn() }` y Prisma falso `{ sucursal: { findMany: jest.fn() } }`, construidos a mano, sin `Test.createTestingModule`):

```ts
it('publica el aviso de la sucursal', async () => {
  await svc.avisar(3, 'estado');
  expect(notificador.publicar).toHaveBeenCalledWith({ sucursalId: 3, motivo: 'estado' });
});
it('no rechaza si el notificador falla', async () => {
  notificador.publicar.mockRejectedValue(new Error('redis caído'));
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
});
```

- [ ] **Step 2:** Run: `pnpm --filter api test -- flujo-tablero avisos-tablero`. Expected: FAIL.
- [ ] **Step 3: Implementar** ambos archivos. `flujoTablero` con `merge`, `interval`, `takeUntil(timer(...))`; con `msHastaVencer <= 0` devuelve `EMPTY`. `AvisosTablero` inyecta `@Inject(NOTIFICADOR_TABLERO)` y `PrismaService`.
- [ ] **Step 4:** Run: el mismo comando. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(hospedaje): flujo de eventos del tablero y servicio de avisos`.

---

### Task 4: Adaptador de Redis, endpoint SSE y CI

**Files:**
- Create: `api/src/modules/hospedaje/infrastructure/notificador-tablero.redis.ts`, `api/src/modules/hospedaje/tablero-eventos.controller.ts`, `api/test/tablero-en-vivo.e2e-spec.ts`
- Modify: `api/src/modules/hospedaje/hospedaje.module.ts`, `api/test/utilidades.ts`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: todo lo de Tasks 2 y 3; `UsuarioActual`, `UsuarioAutenticado` (`exp` en segundos).
- Produces:
  ```ts
  // infrastructure/notificador-tablero.redis.ts
  @Injectable() export class NotificadorTableroRedis implements NotificadorTablero, OnModuleDestroy {
    publicar(aviso: AvisoTablero): Promise<void>;
    escuchar(sucursalId: number): Observable<AvisoTablero>;
    /** Flujos suscritos ahora mismo en este proceso (para pruebas y diagnóstico). */
    get flujosAbiertos(): number;
  }

  // tablero-eventos.controller.ts
  @Controller('hospedaje') export class TableroEventosController {
    @Sse('tablero/eventos') eventos(@UsuarioActual() u: UsuarioAutenticado): Observable<EventoFlujo>;
  }

  // test/utilidades.ts
  export function crearApp(extra?: { controllers?: Type[]; sustituir?: Array<{ token: unknown; valor: unknown }> }): Promise<{ app; prisma }>;
  export interface EventoRecibido { tipo: string; datos: string }
  export interface Flujo {
    estado: number;                              // código HTTP de la respuesta
    cabeceras: IncomingHttpHeaders;
    /** Siguiente evento de ese tipo aún no entregado; rechaza si no llega en `ms` (2000 por defecto). */
    esperar(tipo: string, ms?: number): Promise<EventoRecibido>;
    cerrar(): void;
  }
  /** Abre GET /api/hospedaje/tablero/eventos con `http.request` contra el servidor de la app (lo pone a escuchar en un puerto libre si hace falta). */
  export function abrirFlujo(app: INestApplication, cookie?: string): Promise<Flujo>;
  ```
- `HospedajeModule` exporta nada nuevo; registra `{ provide: NOTIFICADOR_TABLERO, useExisting: NotificadorTableroRedis }`, `NotificadorTableroRedis`, `AvisosTablero` y el controlador nuevo.

**Decisiones del adaptador (spec §4.3):**
- Dos conexiones `ioredis` creadas con `leerConfigRedis().url`. Publicadora: `{ enableOfflineQueue: false, maxRetriesPerRequest: 1 }`. Suscriptora: `{ lazyConnect: true }`, y solo se conecta y hace `psubscribe(PATRON_CANALES)` en el primer `escuchar`.
- Ambas con `.on('error', …)` que registra con `Logger.warn` (sin ese manejador, `ioredis` tumba el proceso).
- `pmessage` → `leerAviso(canal, mensaje)`; si es `null`, se descarta. Los válidos van a un `Subject` interno; `escuchar` devuelve ese `Subject` filtrado por `sucursalId`. `flujosAbiertos` cuenta las suscripciones vivas de `escuchar`.
- `onModuleDestroy`: completa el `Subject` y llama a `disconnect()` en ambas conexiones (no `quit()`, que espera a un Redis que puede no estar).
- Controlador: `flujoTablero(notificador.escuchar(u.sucursalId), u.exp * 1000 - Date.now())`. Si las cabeceras por defecto de `@Sse` no incluyen `X-Accel-Buffering: no`, añadirla con `@Header`.

- [ ] **Step 1: Ampliar `test/utilidades.ts`** con `sustituir` (vía `overrideProvider(token).useValue(valor)`) y `abrirFlujo`. `abrirFlujo` resuelve al recibir las cabeceras; si el estado no es 200, `esperar` rechaza siempre.
- [ ] **Step 2: Pruebas e2e que fallan** en `tablero-en-vivo.e2e-spec.ts`. Preparación: dos apps (`a` y `b`) con `crearApp()`; un usuario con `habitacion.gestionar` y `habitacion.cambiar_estado` y todas las sucursales; `cookie` de su login (sucursal principal) y `cookieOtra` de un segundo login seguido de `POST /api/auth/sucursal` a la otra sucursal (cuerpo como en `sesiones.e2e-spec.ts`). Un cliente `ioredis` propio de la prueba (`redis`) para publicar. Cerrar flujos, apps y `redis` en `afterAll`/`finally`.

```ts
it('sin cookie responde 401 y no abre flujo', async () => {
  const f = await abrirFlujo(a);
  expect(f.estado).toBe(401);
});
it('abre un flujo de eventos que el proxy no retiene', async () => {
  const f = await abrirFlujo(a, cookie);
  expect(f.estado).toBe(200);
  expect(f.cabeceras['content-type']).toContain('text/event-stream');
  expect(f.cabeceras['cache-control']).toContain('no-cache');
  expect(f.cabeceras['cache-control']).toContain('no-transform');
  expect(f.cabeceras['x-accel-buffering']).toBe('no');
});
it('un aviso publicado en una réplica llega al flujo abierto en la otra', async () => {
  const f = await abrirFlujo(b, cookie);
  await a.get(AvisosTablero).avisar(sucursalId, 'estado');
  expect(await f.esperar('tablero')).toEqual({ tipo: 'tablero', datos: '{"motivo":"estado"}' });
});
it('una sucursal no recibe los avisos de otra', async () => {
  const f = await abrirFlujo(a, cookieOtra);
  await a.get(AvisosTablero).avisar(sucursalId, 'estado');
  await expect(f.esperar('tablero', 500)).rejects.toThrow();
});
it('descarta mensajes no válidos y sigue entregando los válidos', async () => {
  const f = await abrirFlujo(a, cookie);
  await redis.publish(canalDe(sucursalId), 'basura');
  await redis.publish(canalDe(sucursalId), '{"motivo":"otro"}');
  await redis.publish(canalDe(sucursalId), mensajeDe({ sucursalId, motivo: 'piso' }));
  expect((await f.esperar('tablero')).datos).toBe('{"motivo":"piso"}');
});
it('al cerrar el navegador se libera la suscripción del flujo', async () => {
  const n = a.get(NotificadorTableroRedis);
  const antes = n.flujosAbiertos;
  const f = await abrirFlujo(a, cookie);
  expect(n.flujosAbiertos).toBe(antes + 1);
  f.cerrar();
  // sondear hasta 2 s
  await esperarHasta(() => n.flujosAbiertos === antes);
});
```

- [ ] **Step 3:** Run: `pnpm infra:up` y `pnpm --filter api test:e2e -- tablero-en-vivo`. Expected: FAIL (404 en el endpoint / símbolos no definidos).
- [ ] **Step 4: Implementar** el adaptador, el controlador y el registro en `HospedajeModule`.
- [ ] **Step 5:** Run: `pnpm --filter api test:e2e`. Expected: PASS en la suite nueva y en las cinco existentes (ninguna queda colgada al cerrar: si Jest avisa de manejadores abiertos, falta un `disconnect()`).
- [ ] **Step 6: CI.** En `.github/workflows/ci.yml` añadir el servicio `redis` (`image: redis:7-alpine`, `ports: ["6379:6379"]`, `options: --health-cmd="redis-cli ping" --health-interval=5s --health-retries=20`) y `REDIS_URL: redis://127.0.0.1:6379` en `env`.
- [ ] **Step 7: Commit** — `feat(hospedaje): flujo SSE del tablero con reparto por Redis`.

---

### Task 5: Publicar el aviso desde cada operación (spec §4.2)

**Files:**
- Modify: `api/src/modules/hospedaje/application/hospedaje.service.ts`, `api/src/modules/hospedaje/application/configuracion.service.ts`
- Test: `api/test/tablero-en-vivo.e2e-spec.ts`

**Interfaces:**
- Consumes: `AvisosTablero.avisar(sucursalId, motivo)`, `AvisosTablero.avisarEmpresa(empresaId, motivo)` (Task 3); `abrirFlujo`, `crearApp({ sustituir })` (Task 4).

Tabla de publicación (siempre tras el `await` de la escritura confirmada, con `await` del aviso para que el orden sea determinista; el aviso no rechaza):

| Método | Llamada |
|---|---|
| `HospedajeService.cambiarEstado` | `avisar(sucursalId, 'estado')` |
| `HospedajeService.crearHabitacion` | `avisar(sucursalId, 'habitacion')` |
| `ConfiguracionService.editarHabitacion` | `avisar(c.sucursalId, 'habitacion')` |
| `ConfiguracionService.crearPiso`, `editarPiso` | `avisar(c.sucursalId, 'piso')` |
| `ConfiguracionService.editarTipo` | `avisarEmpresa(c.empresaId, 'tipo')` |

`crearTipo` y `crearTarifa` no publican.

- [ ] **Step 1: Pruebas e2e que fallan**, añadidas a `tablero-en-vivo.e2e-spec.ts`. Cada una abre un flujo en la app `b`, hace la petición HTTP contra la app `a` y limpia en `finally` lo que crea (patrón de `auditoria.e2e-spec.ts` y `configuracion.e2e-spec.ts`: habitación y piso con número libre).

```ts
it.each([
  ['crear habitación', 'habitacion'],
  ['cambiar su estado', 'estado'],
  ['editar la habitación', 'habitacion'],
  ['crear piso', 'piso'],
  ['editar piso', 'piso'],
])('%s avisa con motivo %s', async (_, motivo) => { /* petición → */ expect((await f.esperar('tablero')).datos).toBe(`{"motivo":"${motivo}"}`); });

it('editar un tipo de habitación avisa a todas las sucursales de la empresa', async () => {
  const f1 = await abrirFlujo(b, cookie); const f2 = await abrirFlujo(b, cookieOtra);
  // PATCH /api/hospedaje/tipos-habitacion/:id
  expect((await f1.esperar('tablero')).datos).toBe('{"motivo":"tipo"}');
  expect((await f2.esperar('tablero')).datos).toBe('{"motivo":"tipo"}');
});
it('crear un tipo y programar una tarifa no avisan', async () => {
  await expect(f.esperar('tablero', 500)).rejects.toThrow();
});
it('una transición no permitida responde 409 y no avisa', async () => {
  expect(res.status).toBe(409);
  await expect(f.esperar('tablero', 500)).rejects.toThrow();
});
it('si el notificador falla, el cambio de estado se guarda igual', async () => {
  // app propia: crearApp({ sustituir: [{ token: NOTIFICADOR_TABLERO, valor: { publicar: () => Promise.reject(new Error('caído')), escuchar: () => NEVER } }] })
  expect(res.status).toBe(200);
  expect((await prisma.habitacion.findUniqueOrThrow({ where: { id }, include: { estado_habitacion: true } })).estado_habitacion.codigo).toBe(nuevo);
});
it('con Redis apagado la API arranca y atiende', async () => {
  // process.env.REDIS_URL = 'redis://127.0.0.1:1' antes de crearApp(); restaurar y cerrar la app en finally
  expect((await http.get('/api/hospedaje/tablero').set('Cookie', cookie)).status).toBe(200);
  expect((await http.patch(`/api/hospedaje/habitaciones/${id}/estado`).set('Cookie', cookie).send({ estado: nuevo })).status).toBe(200);
});
```

Para el estado nuevo usar `transicionesPermitidas('DESOCUPADA')[0]`; para la transición no permitida, un estado que no esté en esa lista.

- [ ] **Step 2:** Run: `pnpm --filter api test:e2e -- tablero-en-vivo`. Expected: FAIL en las pruebas de aviso (tiempo agotado en `esperar`); las tres últimas pueden pasar ya.
- [ ] **Step 3: Implementar** las llamadas de la tabla, inyectando `AvisosTablero` en ambos servicios.
- [ ] **Step 4:** Run: `pnpm --filter api test:e2e` y `pnpm --filter api test`. Expected: PASS completo.
- [ ] **Step 5: Commit** — `feat(hospedaje): avisar al tablero en cada cambio de habitaciones, pisos y tipos`.

---

### Task 6: Lógica de conexión del cliente (módulo puro)

**Files:**
- Create: `web/src/features/hospedaje/conexion-tablero.ts`, `conexion-tablero.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type EstadoConexion = 'conectando' | 'en-vivo' | 'reconectando';
  export const ESPERAS_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;
  /** intento 0 → 1000 … intento ≥ 5 → 30000. */
  export function esperaReconexion(intento: number): number;

  export interface ManejadoresFlujo { alAbrir(): void; alAviso(): void; alFallar(): void }
  export interface DepsConexion {
    /** Abre el flujo y devuelve cómo cerrarlo. */
    abrir(m: ManejadoresFlujo): () => void;
    /** Hay que volver a pedir el tablero (y el historial visible). */
    alCambiar(): void;
    /** Pide el tablero por la vía normal (renueva la sesión si hace falta). false = la sesión terminó. Nunca rechaza. */
    revalidar(): Promise<boolean>;
    alEstado(e: EstadoConexion): void;
    /** setTimeout inyectable; devuelve cómo cancelarlo. */
    programar(fn: () => void, ms: number): () => void;
  }
  export function crearConexionTablero(d: DepsConexion): { iniciar(): void; detener(): void };
  ```

**Reglas (spec §5.1):**
- `iniciar()`: si ya está activa, no hace nada. Si no: estado `conectando`, intento 0, `abrir`.
- `alAbrir`: estado `en-vivo`, intento a 0, `alCambiar()`.
- `alAviso`: `alCambiar()`.
- `alFallar`: cierra el flujo, estado `reconectando`, `await revalidar()`. Si devuelve `false`, queda inactiva sin reabrir. Si `true`, `programar(abrir, esperaReconexion(intento))` e incrementa el intento.
- `detener()`: cierra el flujo, cancela el temporizador pendiente y deja la conexión inactiva. Cualquier `revalidar` o manejador que resuelva después se ignora (no reabre ni llama a `alEstado`).
- Un `alFallar` repetido del mismo flujo ya cerrado se ignora.

- [ ] **Step 1: Pruebas que fallan.** Arnés: `abrir` guarda los manejadores del último flujo y cuenta aperturas y cierres; `programar` guarda `{ fn, ms }` en una lista para dispararlos a mano; `revalidar` devuelve una promesa controlada por la prueba.

```ts
it('esperaReconexion: 1, 2, 4, 8, 16 y 30 s como tope', () => {
  expect([0, 1, 2, 3, 4, 5, 6, 50].map(esperaReconexion)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});
it('al iniciar queda conectando y abre un flujo; iniciar dos veces abre uno solo', …);   // estados: ['conectando'], aperturas: 1
it('al abrir pasa a en-vivo y pide el tablero', …);                                       // alCambiar 1 vez
it('cada aviso pide el tablero', …);
it('al fallar cierra, pasa a reconectando, revalida y reabre tras 1 s', …);               // cierres: 1, programados: [1000], al disparar → aperturas: 2
it('fallos seguidos esperan 1, 2, 4, 8, 16, 30, 30 s', …);
it('tras una apertura correcta la espera vuelve a 1 s', …);
it('si la sesión terminó no reabre', …);                                                  // revalidar → false; programados: []
it('detener cierra el flujo y cancela la reconexión programada', …);
it('detener mientras se revalida: al resolver no reabre ni cambia el estado', …);         // Review Focus 4
it('iniciar tras detener, con el primer intento fallido, se recupera', …);                // Review Focus 5: estados terminan en 'en-vivo'
it('un segundo fallo del mismo flujo no programa otra reconexión', …);
```

Cada título fija su aserción principal en el comentario; las demás comprueban las listas `estados`, `aperturas`, `cierres` y `programados` del arnés.

- [ ] **Step 2:** Run: `pnpm --filter web test -- conexion-tablero`. Expected: FAIL.
- [ ] **Step 3: Implementar** `conexion-tablero.ts` con un contador de generación (o equivalente) para ignorar lo que resuelva tras `detener()`.
- [ ] **Step 4:** Run: el mismo comando. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(web): lógica de conexión en vivo del tablero`.

---

### Task 7: Hook e indicador en el tablero

**Files:**
- Create: `web/src/features/hospedaje/useTableroEnVivo.ts`
- Modify: `web/src/pages/TableroPage.tsx`

**Interfaces:**
- Consumes: `crearConexionTablero`, `EstadoConexion` (Task 6); `api`, `ApiError`, `Tablero` de `lib/api`; `useSesion`.
- Produces: `export function useTableroEnVivo(): EstadoConexion`.

**Decisiones:**
- `abrir`: `new EventSource('/api/hospedaje/tablero/eventos', { withCredentials: true })`; `onopen` → `alAbrir`, `addEventListener('tablero', …)` → `alAviso`, `onerror` → `alFallar`; devuelve `() => es.close()`.
- `alCambiar`: `invalidateQueries({ queryKey: ['tablero'] })` e `invalidateQueries({ queryKey: ['historial'] })`.
- `revalidar`: `api<Tablero>('/hospedaje/tablero')`; si resuelve, `setQueryData(['tablero'], datos)` y `true`; si rechaza con `ApiError` de estado 401, `false`; con cualquier otro error, `true` (corte de red: se sigue reintentando).
- `programar`: `setTimeout` / `clearTimeout`.
- Un `useEffect` que depende de `sesion?.sucursalId`: crea la conexión, llama a `iniciar()` solo si `document.visibilityState === 'visible'`, escucha `visibilitychange` (visible → `iniciar`, oculto → `detener`) y en la limpieza llama a `detener()` y quita el oyente. Sin sesión no abre nada.
- `TableroPage`: `refetchInterval: 60_000`; actualizar el comentario de esa línea. Sustituir el texto "Se actualiza cada 15 s · última lectura …" por un indicador con `role="status"`: punto `bg-desocupada` (o el verde que ya use `ESTILO_ESTADO`) y "En vivo"; punto ámbar (`bg-limpieza`) y "Reconectando…" o "Conectando…"; seguido de "· última lectura HH:MM:SS". `PanelHabitacion` no cambia.

- [ ] **Step 1: Implementar** el hook y el cambio de `TableroPage`.
- [ ] **Step 2:** Run: `pnpm --filter web typecheck`, `pnpm --filter web test` y `pnpm --filter web build`. Expected: sin errores.
- [ ] **Step 3: Verificación manual** (spec §8). `pnpm infra:up`, `pnpm db:migrate`, `pnpm dev`. Dos navegadores con usuarios de la misma sucursal en el tablero:
  1. Cambiar un estado en uno: aparece en el otro en menos de 1 s y el indicador dice "En vivo".
  2. `docker stop hotel-redis`, cambiar otro estado: se guarda y el otro navegador lo ve en ≤ 60 s. `docker start hotel-redis`: los avisos vuelven sin recargar.
  3. Reiniciar la API: el indicador pasa a "Reconectando…" y vuelve a "En vivo".
  4. Cambiar de sucursal activa: en la pestaña de red se cierra un flujo y se abre otro.
  5. Con el tablero abierto y sin tocar nada, la sesión se cierra igual por inactividad.
- [ ] **Step 4: Commit** — `feat(web): tablero en vivo con indicador de conexión`.

---

### Task 8: Documentación

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-11-09-s05-tablero-en-vivo-design.md`

- [ ] **Step 1: README.** Árbol de carpetas: las tres migraciones, `modules/auditoria/`, `common/`, `prisma/`, `web/src/lib/api/` y los archivos nuevos de `hospedaje/`. Tabla de avance: S-05 pasa a **Completo** con una frase sobre SSE, Redis y el respaldo de 60 s, y nota de que canales y turnos (administración) quedan pendientes. Actualizar el recuento de pruebas con los números reales de `pnpm test` y `test:e2e`, y "Próximos pasos" (quitar el punto 1; añadir canales y turnos). En "Decisiones técnicas", una línea: SSE en lugar de WebSocket y por qué.
- [ ] **Step 2: Spec.** Cambiar "Estado" a "Implementado en la rama `s05-tablero-en-vivo`".
- [ ] **Step 3:** Run: `pnpm typecheck`, `pnpm test`, `pnpm --filter api test:e2e`, `pnpm build`. Expected: todo en verde.
- [ ] **Step 4: Commit** — `docs: S-05 completo`.
