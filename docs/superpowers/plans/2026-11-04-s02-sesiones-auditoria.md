# S-02 · Sesiones, inactividad y auditoría — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el sprint S-02 del DT-001 con sesiones revocables (token de acceso de 15 min + renovación rotativa), cierre por inactividad configurable por empresa, bitácora de auditoría inmutable y limitador de intentos.

**Architecture:** Sesiones con estado en la tabla `sesion_usuario`; el guard sigue validando solo el JWT y la renovación (`/auth/refresh`) concentra las comprobaciones contra la base. La lógica de decisión de renovación y el sanitizado de auditoría son funciones puras; los servicios orquestan transacciones Prisma y registran la auditoría dentro de ellas, con un `AsyncLocalStorage` que aporta usuario e IP. El cliente renueva de forma transparente y mide la inactividad real del usuario.

**Tech Stack:** NestJS 11, Prisma 6 (adaptador MariaDB, `engineType = "client"`), MySQL 8, `@nestjs/jwt`, `@nestjs/throttler` 6, Jest + Supertest, React 19, TanStack Query 5, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-11-04-s02-sesiones-auditoria-design.md` — leerla antes de cada tarea; las tablas de §5.4, §7.2, §9 y §10 son normativas.

## Global Constraints

- Rama de trabajo: `s02-sesiones-auditoria` creada desde `main`; un commit por tarea.
- El esquema SQL es la fuente de verdad: los cambios van en `api/prisma/migrations/20261105000000_sesiones_y_auditoria/migration.sql` y `schema.prisma` se regenera; nunca se edita a mano.
- TypeScript estricto en ambos paquetes; sin `any` implícito (RNF-30).
- Todo texto visible al usuario en español, sin códigos técnicos (RNF-27); los textos fijos de la spec se copian literalmente.
- Valores por defecto: `JWT_ACCESO_MIN=15`, `SESION_MAX_HORAS=12`, `REFRESH_GRACIA_SEG=30`, `TRUST_PROXY=false`, `LIMITE_AUTH_POR_MIN=10`, `empresa.sesion_inactividad_min=30` (CHECK 15–480).
- Cookies: `hotel_sesion` (ruta `/`) y `hotel_renovacion` (ruta `/api/auth`), ambas httpOnly, SameSite=Lax, Secure si `NODE_ENV=production`.
- Las pruebas de integración necesitan MySQL con migraciones y seed: `pnpm infra:up && pnpm db:migrate && pnpm db:seed`. Crean sus propios usuarios y roles (prefijo `e2e_`) y no modifican los usuarios de ejemplo.
- Ninguna dependencia nueva salvo `@nestjs/throttler`, `supertest` y `@types/supertest`.

## Review Focus

1. **Usuario sin sucursales asignadas** al iniciar sesión o al renovar: debe recibir un mensaje claro (403 al iniciar sesión, `USUARIO_INACTIVO` al renovar), no un 500 → pruebas en la Tarea 5.
2. **Cookie de renovación manipulada** (sin punto, id no numérico, id inexistente, cadena enorme): 401 `SIN_SESION`, nunca 500 → prueba en la Tarea 5.
3. **Zona horaria del proceso Node distinta de la de MySQL** (equipos en Lima, BD en UTC): una renovación justo después del login no debe dar `INACTIVIDAD` ni `EXPIRADA` → las e2e corren con `TZ=America/Lima` (Tarea 5).
4. **Sesión cerrada en otra pestaña o por inactividad** mientras esta pestaña sigue consultando el tablero: debe llevar al login, no quedarse mostrando errores → prueba en la Tarea 8.
5. **Cambio de sucursal sobre una sesión ya revocada** (el JWT de acceso aún no venció): 401 `SESION_CERRADA` sin modificar nada → prueba en la Tarea 5.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `api/src/config.ts` | Lee y valida la configuración de autenticación desde el entorno |
| `api/src/configurar-app.ts` | Configuración común de la app Nest (prefijo, cookies, helmet, trust proxy, contexto), compartida por `main.ts` y las e2e |
| `api/src/common/contexto-peticion.ts` | `AsyncLocalStorage` y middleware del contexto de petición |
| `api/src/modules/auth/domain/token-renovacion.ts` | Generar, formatear, parsear y comparar tokens de renovación |
| `api/src/modules/auth/domain/renovacion.ts` | `decidirRenovacion`, función pura |
| `api/src/modules/auth/cookies.ts` | Nombres y helpers de cookies |
| `api/src/modules/auth/errores.ts` | Construcción de los 401 con `codigo`/`motivo` |
| `api/src/modules/auth/infrastructure/usuario-sesion.repository.ts` | Carga usuario + rol + permisos + sucursales + inactividad |
| `api/src/modules/auth/application/sesiones.service.ts` | Crear, renovar, revocar sesiones y cambiar de sucursal |
| `api/src/modules/auth/auth.service.ts` | Login (credenciales, bloqueo, auditoría de fallos) |
| `api/src/modules/auditoria/**` | Acciones, sanitizado, servicio, decorador e interceptor |
| `api/test/**` | Configuración e2e, utilidades y pruebas de integración |
| `web/src/lib/api.ts` | Cliente HTTP con renovación única y manejador de cierre |
| `web/src/features/auth/motivos.ts` | Mensajes de cierre por motivo |
| `web/src/features/auth/reloj-inactividad.ts` | Temporizador de inactividad puro |
| `web/src/features/auth/useInactividad.ts` | Conecta el reloj con eventos del DOM y `BroadcastChannel` |
| `web/src/components/AvisoInactividad.tsx` | Diálogo de aviso |

---

### Task 1: Migración de sesiones y auditoría

**Files:**
- Create: `api/prisma/migrations/20261105000000_sesiones_y_auditoria/migration.sql`
- Create: `api/prisma/migrations/20261105000000_sesiones_y_auditoria/down.sql`
- Modify: `api/scripts/gen-prisma-schema.py:89-91` (función `q`)
- Modify: `api/prisma/schema.prisma` (regenerado)
- Modify: `README.md` (sección "Decisiones técnicas": cómo regenerar en Windows)

**Interfaces:**
- Produces: modelos Prisma `sesion_usuario` (enum `sesion_usuario_motivo_revocacion`), `empresa.sesion_inactividad_min: number`, `auditoria.accion: string`, `auditoria.registro_id: bigint | null`, `auditoria.sucursal_id: number | null`, `auditoria.user_agent: string | null`.

- [ ] **Step 1: Crear la rama**

```bash
git checkout -b s02-sesiones-auditoria
```

- [ ] **Step 2: Escribir `migration.sql`** con exactamente el SQL de la spec §4 (tabla, `ALTER TABLE empresa`, `ALTER TABLE auditoria`, dos triggers). Cada trigger es una sola sentencia `SIGNAL`, sin `BEGIN … END`, igual que el formato aceptado por la migración inicial.

- [ ] **Step 3: Escribir `down.sql`**, que revierte en orden inverso: `DROP TRIGGER` ×2; en `auditoria`, `DROP FOREIGN KEY fk_aud_sucursal`, `DROP KEY ix_aud_usuario_fecha`, `DROP COLUMN user_agent, sucursal_id`, `MODIFY registro_id BIGINT UNSIGNED NOT NULL`, `MODIFY accion ENUM('INSERT','UPDATE','DELETE','ANULAR','LOGIN') NOT NULL`; en `empresa`, `DROP CHECK ck_empresa_inactividad`, `DROP COLUMN sesion_inactividad_min`; `DROP TABLE sesion_usuario`. Comentario inicial: "Reversión manual: ejecutar con el cliente mysql y borrar la fila de _prisma_migrations".

- [ ] **Step 4: Aplicar la migración**

Run: `pnpm db:migrate`
Expected: `Applying migration 20261105000000_sesiones_y_auditoria` y `All migrations have been successfully applied.`

- [ ] **Step 5: Permitir ejecutar el generador sin cliente mysql local.** En `q(sql)`, el comando base se toma de la variable `MYSQL_CMD` (separada con `shlex.split`), con `mysql` como valor por defecto, y se le añaden `--default-character-set=utf8mb4 -B -N -e <sql> <DB>`. En README, el ejemplo para Windows con Docker es:

```bash
MYSQL_CMD="docker exec -i hotel-mysql mysql -uroot -proot_dev_pass" python api/scripts/gen-prisma-schema.py hotel_dev
```

- [ ] **Step 6: Regenerar el esquema y el cliente**

Run (desde `api/`): `MYSQL_CMD="docker exec -i hotel-mysql mysql -uroot -proot_dev_pass" python scripts/gen-prisma-schema.py hotel_dev && pnpm prisma:generate`
Expected: `55 modelos, …` y el cliente generado. `git diff api/prisma/schema.prisma` muestra solo: el modelo `sesion_usuario` (más sus relaciones inversas en `usuario` y `sucursal`), las columnas nuevas, `accion String @db.VarChar(40)`, `registro_id BigInt?` y el enum `auditoria_accion` eliminado.

- [ ] **Step 7: Verificar que todo compila y que la bitácora es inmutable**

Run: `pnpm typecheck && pnpm --filter api test`
Expected: PASS en ambos.
Run: `docker exec -i hotel-mysql mysql -uroot -proot_dev_pass hotel_dev -e "INSERT INTO auditoria (tabla, accion) VALUES ('x','prueba.manual'); UPDATE auditoria SET tabla='y';"`
Expected: `ERROR 1644 (45000): La bitácora de auditoría no se modifica`. (La fila de prueba queda; es inofensiva en desarrollo.)

- [ ] **Step 8: Commit**

```bash
git add api/prisma README.md api/scripts/gen-prisma-schema.py
git commit -m "feat(db): sesiones de usuario, inactividad por empresa y bitácora inmutable"
```

---

### Task 2: Configuración de autenticación y arranque común

**Files:**
- Create: `api/src/config.ts`, `api/src/config.spec.ts`, `api/src/configurar-app.ts`
- Modify: `api/src/main.ts` (usar `leerConfigAuth()` al inicio para fallar pronto y `configurarApp(app)`), `api/src/modules/auth/auth.module.ts` (`JwtModule.registerAsync`), `api/.env.example` (quitar `JWT_EXPIRES_IN`, añadir las variables de spec §11 con comentarios)

**Interfaces:**
- Produces:
  ```ts
  export interface ConfigAuth { jwtSecret: string; accesoMin: number; sesionMaxHoras: number; graciaSeg: number; limitePorMin: number; trustProxy: boolean | number }
  export function leerConfigAuth(env?: NodeJS.ProcessEnv): ConfigAuth   // api/src/config.ts
  export function configurarApp(app: NestExpressApplication): void      // api/src/configurar-app.ts
  ```
  `configurarApp` aplica: parche `BigInt.prototype.toJSON`, `setGlobalPrefix('api')`, `helmet()`, `cookieParser()`, `app.set('trust proxy', cfg.trustProxy)`. La Tarea 4 le añade el middleware de contexto.

- [ ] **Step 1: Escribir las pruebas que fallan** en `config.spec.ts`:

```ts
describe('leerConfigAuth', () => {
  it('usa los valores por defecto en desarrollo', () => {
    expect(leerConfigAuth({})).toEqual({ jwtSecret: 'solo-desarrollo', accesoMin: 15, sesionMaxHoras: 12, graciaSeg: 30, limitePorMin: 10, trustProxy: false });
  });
  it('exige JWT_SECRET en producción (vacía cuenta como ausente)', () => {
    expect(() => leerConfigAuth({ NODE_ENV: 'production' })).toThrow('JWT_SECRET es obligatoria en producción');
    expect(() => leerConfigAuth({ NODE_ENV: 'production', JWT_SECRET: '' })).toThrow('JWT_SECRET es obligatoria en producción');
  });
  it('lee TRUST_PROXY numérico y booleano', () => {
    expect(leerConfigAuth({ TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(leerConfigAuth({ TRUST_PROXY: 'true' }).trustProxy).toBe(true);
  });
  it('rechaza números inválidos', () => {
    expect(() => leerConfigAuth({ JWT_ACCESO_MIN: 'abc' })).toThrow('JWT_ACCESO_MIN debe ser un entero positivo');
    expect(() => leerConfigAuth({ SESION_MAX_HORAS: '0' })).toThrow('SESION_MAX_HORAS debe ser un entero positivo');
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `pnpm --filter api test -- config`
Expected: FAIL, "Cannot find module './config'".

- [ ] **Step 3: Implementar `leerConfigAuth`** y luego `configurarApp`; `main.ts` llama a `leerConfigAuth()` antes de `NestFactory.create`. En `AuthModule`, `JwtModule.registerAsync({ global: true, useFactory: () => ({ secret: leerConfigAuth().jwtSecret, signOptions: { expiresIn: leerConfigAuth().accesoMin * 60 } }) })`.

- [ ] **Step 4: Ejecutar las pruebas y el arranque**

Run: `pnpm --filter api test && pnpm typecheck`
Expected: PASS.
Run (desde `api/`): `NODE_ENV=production JWT_SECRET= node -r ts-node/register src/main.ts`
Expected: termina con `Error: JWT_SECRET es obligatoria en producción`.

- [ ] **Step 5: Commit**

```bash
git add api/src/config.ts api/src/config.spec.ts api/src/configurar-app.ts api/src/main.ts api/src/modules/auth/auth.module.ts api/.env.example
git commit -m "feat(auth): configuración validada y arranque común de la app"
```

---

### Task 3: Dominio de renovación

**Files:**
- Create: `api/src/modules/auth/domain/token-renovacion.ts`, `api/src/modules/auth/domain/token-renovacion.spec.ts`, `api/src/modules/auth/domain/renovacion.ts`, `api/src/modules/auth/domain/renovacion.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  // token-renovacion.ts
  export function generarSecreto(): string                         // 32 bytes aleatorios, base64url (43 caracteres)
  export function hashSecreto(secreto: string): string              // SHA-256 en hex (64 caracteres)
  export function formatearToken(sesionId: bigint, secreto: string): string   // `${id}.${secreto}`
  export function parsearToken(valor: string | undefined): { sesionId: bigint; secreto: string } | null
  export function hashesIguales(a: string, b: string): boolean      // timingSafeEqual; false si las longitudes difieren
  // renovacion.ts
  export type MotivoRevocacion = 'LOGOUT' | 'INACTIVIDAD' | 'REUSO' | 'USUARIO_INACTIVO' | 'EXPIRADA' | 'ADMIN';
  export interface EstadoSesion { revocadaAt: Date | null; motivoRevocacion: MotivoRevocacion | null; expiraAt: Date; ultimaRenovacionAt: Date; refreshHash: string; refreshHashAnterior: string | null; rotadaAt: Date | null }
  export interface ConfigRenovacion { inactividadMin: number; accesoMin: number; graciaSeg: number }
  export type DecisionRenovacion = { tipo: 'ROTAR' } | { tipo: 'CARRERA' } | { tipo: 'REVOCAR'; motivo: MotivoRevocacion } | { tipo: 'RECHAZAR'; motivo: MotivoRevocacion };
  export function decidirRenovacion(s: EstadoSesion, hashPresentado: string, ahora: Date, c: ConfigRenovacion): DecisionRenovacion
  ```

- [ ] **Step 1: Escribir las pruebas que fallan.** `token-renovacion.spec.ts`:
  - `parsearToken(formatearToken(42n, s))` devuelve `{ sesionId: 42n, secreto: s }`.
  - `parsearToken` devuelve `null` para `undefined`, `''`, `'abc'`, `'x.y'`, `'1.'`, `'.abc'`, `'-1.abc'` y una cadena de 5 000 caracteres (se rechaza todo valor de más de 200 caracteres o cuyo id no coincida con `/^[1-9]\d{0,18}$/`).
  - `hashSecreto('a')` es `'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'`.
  - `hashesIguales(h, h)` es `true`; con otro hash, `false`; con longitudes distintas, `false`, sin lanzar error.
  - `generarSecreto()` devuelve 43 caracteres de `[A-Za-z0-9_-]` y dos llamadas dan valores distintos.

  `renovacion.spec.ts`, con `base = { revocadaAt: null, motivoRevocacion: null, expiraAt: T0+12h, ultimaRenovacionAt: T0, refreshHash: H1, refreshHashAnterior: H0, rotadaAt: T0 }`, `cfg = { inactividadMin: 30, accesoMin: 15, graciaSeg: 30 }` y `T0 = new Date('2026-11-05T14:00:00Z')`:

```ts
it.each([
  ['revocada',                 { ...base, revocadaAt: T0, motivoRevocacion: 'LOGOUT' }, H1, min(1),  { tipo: 'RECHAZAR', motivo: 'LOGOUT' }],
  ['expirada',                 base, H1, horas(12) + seg(1),                                          { tipo: 'REVOCAR', motivo: 'EXPIRADA' }],
  ['inactividad en el borde',  base, H1, min(45),                                                    { tipo: 'ROTAR' }],
  ['inactividad superada',     base, H1, min(45) + seg(1),                                            { tipo: 'REVOCAR', motivo: 'INACTIVIDAD' }],
  ['token vigente',            base, H1, min(10),                                                    { tipo: 'ROTAR' }],
  ['carrera dentro de 30 s',   base, H0, seg(30),                                                    { tipo: 'CARRERA' }],
  ['anterior pasada la gracia',base, H0, seg(31),                                                    { tipo: 'REVOCAR', motivo: 'REUSO' }],
  ['anterior sin rotación',    { ...base, refreshHashAnterior: null, rotadaAt: null }, H0, seg(1),    { tipo: 'REVOCAR', motivo: 'REUSO' }],
  ['hash desconocido',         base, HX, seg(1),                                                     { tipo: 'REVOCAR', motivo: 'REUSO' }],
])('%s', (_n, s, hash, delta, esperado) => {
  expect(decidirRenovacion(s as EstadoSesion, hash, new Date(T0.getTime() + delta), cfg)).toEqual(esperado);
});
```

  (`min`, `seg` y `horas` convierten a milisegundos; `H0`, `H1` y `HX` son `hashSecreto` de tres secretos fijos.)

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `pnpm --filter api test -- renovacion`
Expected: FAIL, "Cannot find module".

- [ ] **Step 3: Implementar ambos módulos** con `node:crypto` (`randomBytes(32).toString('base64url')`, `createHash('sha256')`, `timingSafeEqual`). `decidirRenovacion` evalúa las condiciones en el orden exacto de la tabla de spec §5.4; el umbral de inactividad es `(inactividadMin + accesoMin) * 60_000` ms con comparación estricta `>`; la gracia es `≤ graciaSeg * 1000` ms.

- [ ] **Step 4: Ejecutar las pruebas**

Run: `pnpm --filter api test -- renovacion`
Expected: PASS (las dos suites).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/auth/domain
git commit -m "feat(auth): dominio de tokens de renovación y decisión de renovación"
```

---

### Task 4: Módulo de auditoría

**Files:**
- Create: `api/src/common/contexto-peticion.ts`, `api/src/modules/auditoria/domain/acciones.ts`, `api/src/modules/auditoria/domain/sanitizar.ts`, `api/src/modules/auditoria/domain/sanitizar.spec.ts`, `api/src/modules/auditoria/application/auditoria.service.ts`, `api/src/modules/auditoria/auditar.decorator.ts`, `api/src/modules/auditoria/auditoria.interceptor.ts`, `api/src/modules/auditoria/auditoria.module.ts`
- Modify: `api/src/configurar-app.ts` (registrar `middlewareContexto`), `api/src/modules/auth/auth.guard.ts` (tras verificar el JWT: `const ctx = contextoActual(); if (ctx) { ctx.usuarioId = usuario.sub; ctx.sucursalId = usuario.sucursalId; }`), `api/src/app.module.ts` (importar `AuditoriaModule`)

**Interfaces:**
- Consumes: `configurarApp` (Tarea 2).
- Produces:
  ```ts
  // common/contexto-peticion.ts
  export interface ContextoPeticion { usuarioId: number | null; sucursalId: number | null; ip: string | null; userAgent: string | null; registros: string[] }
  export function contextoActual(): ContextoPeticion | undefined
  export function middlewareContexto(req: Request, res: Response, next: NextFunction): void   // AsyncLocalStorage.run con { ip: req.ip, userAgent: req.get('user-agent')?.slice(0,255) }
  // auditoria/domain/acciones.ts
  export const ACCIONES_AUDITORIA = ['auth.login','auth.login_fallido','auth.logout','auth.sesion_revocada','auth.cambio_sucursal','habitacion.crear'] as const;
  export type AccionAuditoria = (typeof ACCIONES_AUDITORIA)[number];
  // auditoria/domain/sanitizar.ts
  export function sanitizar(valor: unknown): unknown
  // auditoria/application/auditoria.service.ts
  export interface RegistroAuditoria { accion: AccionAuditoria; tabla: string; registroId: bigint | number | null; antes?: unknown; despues?: unknown; usuarioId?: number | null }
  export class AuditoriaService { registrar(tx: Prisma.TransactionClient, r: RegistroAuditoria): Promise<void> }
  // auditoria/auditar.decorator.ts
  export const AUDITAR_KEY = 'auditar';
  export const Auditar = (accion: AccionAuditoria) => SetMetadata(AUDITAR_KEY, accion);
  ```
  `AuditoriaModule` es `@Global()`, exporta `AuditoriaService` y registra `AuditoriaInterceptor` como `APP_INTERCEPTOR`.

- [ ] **Step 1: Escribir las pruebas que fallan** en `sanitizar.spec.ts`:

```ts
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
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `pnpm --filter api test -- sanitizar`
Expected: FAIL, "Cannot find module".

- [ ] **Step 3: Implementar `sanitizar`** (las claves se comparan con `/password|hash|token|secreto|clave/i`; un `Decimal` se detecta con `Prisma.Decimal.isDecimal`).

- [ ] **Step 4: Ejecutar las pruebas**

Run: `pnpm --filter api test -- sanitizar`
Expected: PASS.

- [ ] **Step 5: Implementar contexto, servicio, decorador, interceptor y módulo.**
  - `registrar` inserta con `tx.auditoria.create`, completa `usuario_id` (prioridad: `r.usuarioId` si viene definido, luego el del contexto), `sucursal_id`, `ip` y `user_agent` desde el contexto, guarda `sanitizar(antes/despues)` (`Prisma.DbNull` si viene `undefined`) y hace `contextoActual()?.registros.push(r.accion)`.
  - El interceptor lee `AUDITAR_KEY` con `Reflector.getAllAndOverride`. Si la acción está declarada, aplica `tap` sobre `next.handle()` y, si `registros` no la contiene, lanza `InternalServerErrorException('Falta registrar la auditoría de <accion>')` cuando `NODE_ENV !== 'production'`; en producción, `Logger.error` con el mismo texto.

- [ ] **Step 6: Verificar que compila y que no hay regresiones**

Run: `pnpm typecheck && pnpm --filter api test`
Expected: PASS. (El comportamiento del interceptor y del servicio con la base se prueba en la Tarea 6.)

- [ ] **Step 7: Commit**

```bash
git add api/src/common/contexto-peticion.ts api/src/modules/auditoria api/src/configurar-app.ts api/src/modules/auth/auth.guard.ts api/src/app.module.ts
git commit -m "feat(auditoria): contexto de petición, servicio transaccional y verificación con @Auditar"
```

---

### Task 5: Sesiones con renovación en la API

**Files:**
- Create: `api/src/modules/auth/cookies.ts`, `api/src/modules/auth/errores.ts`, `api/src/modules/auth/infrastructure/usuario-sesion.repository.ts`, `api/src/modules/auth/application/sesiones.service.ts`
- Create: `api/test/jest-e2e.json`, `api/test/setup-e2e.ts`, `api/test/utilidades.ts`, `api/test/sesiones.e2e-spec.ts`
- Modify: `api/src/modules/auth/auth.service.ts`, `api/src/modules/auth/auth.controller.ts`, `api/src/modules/auth/auth.guard.ts`, `api/src/modules/auth/auth.module.ts`, `api/src/common/usuario-actual.decorator.ts`, `api/package.json` (devDeps `supertest@^7.1.0`, `@types/supertest@^6.0.2`; script `"test:e2e": "jest --config test/jest-e2e.json --runInBand"`), `api/tsconfig.json` (`include` añade `"test/**/*.ts"`), `api/tsconfig.build.json` (`exclude` añade `"test"`), `.github/workflows/ci.yml` (paso `pnpm --filter api test:e2e` después de "Datos de ejemplo")

**Interfaces:**
- Consumes: `leerConfigAuth`, `configurarApp` (T2); `parsearToken`, `formatearToken`, `generarSecreto`, `hashSecreto`, `decidirRenovacion`, `MotivoRevocacion` (T3); `AuditoriaService.registrar` (T4).
- Produces:
  ```ts
  // usuario-actual.decorator.ts — UsuarioSesion gana:
  sid: string; inactividadMin: number;
  // cookies.ts
  export const COOKIE_ACCESO = 'hotel_sesion'; export const COOKIE_RENOVACION = 'hotel_renovacion';
  export function fijarCookieAcceso(res: Response, jwt: string, accesoMin: number): void
  export function fijarCookieRenovacion(res: Response, valor: string, expiraAt: Date): void
  export function borrarCookies(res: Response): void
  // errores.ts
  export type CodigoSesion = 'SIN_SESION' | 'ACCESO_EXPIRADO' | 'SESION_CERRADA';
  export function errorSesion(codigo: CodigoSesion, motivo?: MotivoRevocacion): UnauthorizedException   // cuerpo { message, codigo, motivo? }
  // usuario-sesion.repository.ts
  export type CargaUsuario = { estado: 'OK'; datos: Omit<UsuarioSesion, 'sid'> } | { estado: 'INACTIVO' | 'SIN_SUCURSALES' };
  cargar(tx: Prisma.TransactionClient, usuarioId: number, sucursalPreferida?: number): Promise<CargaUsuario>
  // sesiones.service.ts
  export type ResultadoRenovacion =
    | { tipo: 'OK'; usuario: UsuarioSesion; renovacion?: { valor: string; expiraAt: Date } }
    | { tipo: 'DENEGADO'; codigo: 'SIN_SESION' | 'SESION_CERRADA'; motivo?: MotivoRevocacion };
  crear(tx, datos: Omit<UsuarioSesion,'sid'>): Promise<{ usuario: UsuarioSesion; renovacion: { valor: string; expiraAt: Date } }>
  renovar(cookie: string | undefined): Promise<ResultadoRenovacion>          // nunca lanza por resultados de negocio
  cerrar(cookie: string | undefined, motivo: 'LOGOUT' | 'INACTIVIDAD'): Promise<void>
  cambiarSucursal(actual: UsuarioSesion, sucursalId: number): Promise<UsuarioSesion>   // 403 si no está asignada; errorSesion('SESION_CERRADA', motivo) si la sesión está revocada
  // test/utilidades.ts
  export function crearApp(extra?: { controllers?: Type[] }): Promise<{ app: INestApplication; prisma: PrismaService }>
  export function crearUsuarioPrueba(prisma: PrismaService, o?: { permisos?: string[]; sucursales?: 'todas' | 'ninguna' }): Promise<{ id: number; username: string; password: string; rolId: number }>
  export function cookiesDe(res: request.Response): Record<string, string>
  export function encabezadoCookies(c: Record<string, string>): string
  ```
  `crear` guarda la fila con `sucursal_id`, `expira_at = ahora + sesionMaxHoras`, e `ip` y `user_agent` tomados de `contextoActual()`. `inactividadMin` sale de `empresa.sesion_inactividad_min`. Cada revocación se escribe y se audita (`auth.sesion_revocada`, `{ motivo }`) dentro de la transacción de `renovar`, que después devuelve `DENEGADO`; el controlador borra las cookies y lanza `errorSesion` fuera de la transacción.

- [ ] **Step 1: Preparar la infraestructura e2e.**
  - `jest-e2e.json`: `rootDir ".."`, `testRegex "test/.*\\.e2e-spec\\.ts$"`, `transform` ts-jest, `testEnvironment node`, `setupFiles ["<rootDir>/test/setup-e2e.ts"]`.
  - `setup-e2e.ts`: `import 'dotenv/config'`; fija `process.env.TZ = 'America/Lima'`, `NODE_ENV = 'test'` y `LIMITE_AUTH_POR_MIN ??= '1000'`.
  - `crearApp`: crea un `Test.createTestingModule({ imports: [AppModule], controllers: extra?.controllers ?? [] })`, aplica `configurarApp` y hace `init()`.
  - `crearUsuarioPrueba`: toma la empresa del seed, crea el rol `e2e_<aleatorio>` con los permisos indicados (por defecto `['usuario.ver']`) y un usuario `e2e_<aleatorio>` con clave `Clave-e2e-1` hasheada con Argon2id, asignado a todas las sucursales de la empresa (la primera como principal) o a ninguna.

- [ ] **Step 2: Escribir las pruebas que fallan** en `sesiones.e2e-spec.ts`. Cada `it` crea su propio usuario. Las manipulaciones de tiempo se hacen actualizando `sesion_usuario` con Prisma.
  1. `login crea una sesión, fija ambas cookies y registra auth.login`: 200; `cookiesDe` contiene `hotel_sesion` y `hotel_renovacion`; existe una fila `sesion_usuario` no revocada; existe `auditoria` con `accion='auth.login'`, `tabla='sesion_usuario'` y la IP no nula.
  2. `un acceso vencido responde ACCESO_EXPIRADO`: `GET /api/auth/me` con un JWT firmado por `new JwtService({ secret: leerConfigAuth().jwtSecret }).sign({ ...payloadDelLogin, exp: ahoraSeg - 60 })` (instancia propia, sin `expiresIn`, para no chocar con `exp`) → 401 `{ codigo: 'ACCESO_EXPIRADO' }`; sin cookie → 401 `{ codigo: 'SIN_SESION' }`.
  3. `refresh justo después del login rota el token` (cubre el punto 3 de Review Focus): 200, la cookie `hotel_renovacion` cambia y en la base `refresh_hash_anterior` tiene el hash anterior.
  4. `reusar un token rotado pasada la gracia revoca la sesión`: renovar; poner `rotada_at` 60 s en el pasado; renovar con el token viejo → 401 `{ codigo: 'SESION_CERRADA', motivo: 'REUSO' }`; la sesión queda con `motivo_revocacion = 'REUSO'`; el token nuevo también recibe 401 `SESION_CERRADA`; existe `auth.sesion_revocada`.
  5. `dos renovaciones con el mismo token dentro de 30 s no cierran la sesión`: dos `POST /refresh` con la misma cookie original → ambas 200; la segunda no trae `hotel_renovacion`; la sesión no está revocada.
  6. `sin renovar más allá del respaldo expira por inactividad`: `ultima_renovacion_at` = ahora − 46 min → 401 `motivo: 'INACTIVIDAD'`.
  7. `un usuario desactivado pierde el acceso al renovar`: `usuario.activo = false` → 401 `motivo: 'USUARIO_INACTIVO'`.
  8. `los permisos del rol se releen al renovar`: añadir `habitacion.gestionar` al rol del usuario y renovar → `GET /me` devuelve `permisos` que lo contienen.
  9. `logout revoca y funciona con el acceso vencido`: `POST /logout` solo con la cookie de renovación → 204, `set-cookie` borra ambas, sesión con `motivo_revocacion='LOGOUT'`, existe `auth.logout`; con cuerpo `{ motivo: 'INACTIVIDAD' }`, el motivo guardado es `INACTIVIDAD`.
  10. `login fallido queda auditado`: clave errónea → 401 y existe `auth.login_fallido` con `datos_despues.motivo = 'CLAVE_INCORRECTA'` e IP no nula; usuario inexistente → `registro_id` nulo y `motivo = 'NO_EXISTE'`.
  11. `usuario sin sucursales` (Review Focus 1): login → 403 con el mensaje literal de la spec §5.3 y `auth.login_fallido` con `motivo='SIN_SUCURSALES'`; además, un usuario con sesión al que se le quitan todas sus sucursales → refresh 401 `motivo: 'USUARIO_INACTIVO'`.
  12. `cookie de renovación manipulada` (Review Focus 2): para `'abc'`, `'1.'`, `'99999999999.x'` y `'1.' + 'a'.repeat(5000)` → 401 `{ codigo: 'SIN_SESION' }`.
  13. `cambiar de sucursal` (Review Focus 5): con dos sucursales → 200, `sesion_usuario.sucursal_id` actualizado y `auth.cambio_sucursal` con `datos_antes.sucursal_id` y `datos_despues.sucursal_id`; tras revocar la sesión en la base → 401 `codigo: 'SESION_CERRADA'` y `sucursal_id` sin cambios.
  14. `si se desasigna la sucursal activa, la renovación pasa a la principal`: cambiar a la segunda sucursal, borrar esa fila de `usuario_sucursal` y renovar → `GET /me` devuelve `sucursalId` igual a la principal y `sucursales` sin la eliminada.

- [ ] **Step 3: Ejecutar y verificar que fallan**

Run: `pnpm --filter api test:e2e -- sesiones`
Expected: FAIL; el 1 por la falta de la cookie `hotel_renovacion` y el resto por `/api/auth/refresh` en 404.

- [ ] **Step 4: Implementar `cookies.ts`, `errores.ts` y el repositorio de usuario de sesión.** Los mensajes de `errorSesion` son: `SIN_SESION` → "Inicia sesión para continuar"; `ACCESO_EXPIRADO` → "Tu sesión necesita renovarse"; `SESION_CERRADA` → "Tu sesión se cerró. Vuelve a iniciar sesión".

- [ ] **Step 5: Implementar `SesionesService`** siguiendo spec §5.3–§5.6. En `renovar`, la sesión se bloquea con `tx.$queryRaw\`SELECT id FROM sesion_usuario WHERE id = ${id} FOR UPDATE\`` antes del `findUnique`.

- [ ] **Step 6: Adaptar `AuthService`, el controlador y el guard.**
  - `login` audita `auth.login_fallido` con `prisma` (fuera de transacción), con los motivos `NO_EXISTE | INACTIVO | BLOQUEADO | CLAVE_INCORRECTA | SIN_SUCURSALES`; en el caso de éxito crea la sesión y audita `auth.login` en una transacción, pasando `usuarioId` explícito.
  - Endpoints: `refresh` y `logout` son `@Publico()`. El cuerpo de `logout` se valida con Zod `{ motivo: z.literal('INACTIVIDAD').optional() }`.
  - El guard lanza `errorSesion('ACCESO_EXPIRADO')` ante un `TokenExpiredError` y `errorSesion('SIN_SESION')` en los demás casos.
  - Se elimina `COOKIE_SESION` de `auth.guard.ts` y se usa `COOKIE_ACCESO`.

- [ ] **Step 7: Ejecutar todas las pruebas**

Run: `pnpm --filter api test:e2e && pnpm --filter api test && pnpm typecheck`
Expected: PASS (14 pruebas e2e).

- [ ] **Step 8: Commit**

```bash
git add api .github/workflows/ci.yml
git commit -m "feat(auth): sesiones revocables con renovación rotativa, logout auditado y pruebas e2e"
```

---

### Task 6: Auditoría conectada a habitaciones e inmutabilidad verificada

**Files:**
- Modify: `api/src/modules/hospedaje/application/hospedaje.service.ts:491-503` (`crearHabitacion` en `prisma.$transaction`, con `auditoria.registrar(tx, { accion: 'habitacion.crear', tabla: 'habitacion', registroId: hab.id, despues: hab })`), `api/src/modules/hospedaje/hospedaje.controller.ts` (`@Auditar('habitacion.crear')` en `crear`)
- Create: `api/test/auditoria.e2e-spec.ts`

**Interfaces:**
- Consumes: `AuditoriaService`, `Auditar` (T4); `crearApp`, `crearUsuarioPrueba`, `cookiesDe` (T5).

- [ ] **Step 1: Escribir las pruebas que fallan**:
  1. `crear habitación queda auditado`: un usuario con `habitacion.gestionar` hace `POST /api/hospedaje/habitaciones` con número `E2E-<aleatorio, máx. 10>` → 201; existe `auditoria` con `accion='habitacion.crear'`, `registro_id` igual al id creado, `usuario_id` igual al del usuario y `sucursal_id` igual a la sucursal activa.
  2. `la bitácora no se modifica ni se borra`: `prisma.$executeRaw\`UPDATE auditoria SET tabla = 'x' WHERE id = ${id}\`` rechaza con el mensaje "La bitácora de auditoría no se modifica"; el `DELETE` rechaza con "La bitácora de auditoría no se elimina".
  3. `un endpoint con @Auditar que no registra falla en pruebas`: un controlador definido en el propio archivo, `@Controller('prueba-auditoria')`, con `@Auditar('habitacion.crear') @Post() nada() { return { ok: true } }`, montado con `crearApp({ controllers: [ControladorPrueba] })` → `POST /api/prueba-auditoria` autenticado responde 500.

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `pnpm --filter api test:e2e -- auditoria`
Expected: el 1 falla (no existe el registro); el 3 falla con 201 en lugar de 500 si el interceptor no está activo; el 2 ya pasa por la Tarea 1 (sirve de regresión).

- [ ] **Step 3: Implementar el cambio en `crearHabitacion` y añadir el decorador.**

- [ ] **Step 4: Ejecutar todas las pruebas**

Run: `pnpm --filter api test:e2e && pnpm --filter api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/hospedaje api/test/auditoria.e2e-spec.ts
git commit -m "feat(auditoria): auditar alta de habitaciones y verificar bitácora inmutable"
```

---

### Task 7: Limitador de intentos

**Files:**
- Modify: `api/package.json` (dependencia `@nestjs/throttler@^6.4.0`), `api/src/modules/auth/auth.module.ts` (`ThrottlerModule.forRootAsync({ useFactory: () => ({ throttlers: [{ ttl: 60_000, limit: leerConfigAuth().limitePorMin }], errorMessage: 'Demasiados intentos. Espera un minuto e inténtalo de nuevo' }) })`), `api/src/modules/auth/auth.controller.ts` (`@UseGuards(ThrottlerGuard)` solo en `login` y `refresh`)
- Create: `api/test/limitador.e2e-spec.ts`

**Interfaces:**
- Consumes: `leerConfigAuth().limitePorMin` (T2), `crearApp` (T5).

- [ ] **Step 1: Escribir la prueba que falla**: en el `beforeAll`, `process.env.LIMITE_AUTH_POR_MIN = '10'` antes de `crearApp()`; se hacen 10 `POST /api/auth/login` con clave errónea, que responden 401, y la 11.ª responde 429 con `message` igual a "Demasiados intentos. Espera un minuto e inténtalo de nuevo". Además, `GET /api/health` sigue respondiendo 200 (el límite no es global).

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `pnpm --filter api test:e2e -- limitador`
Expected: FAIL, la 11.ª petición recibe 401.

- [ ] **Step 3: Instalar y configurar** con `pnpm --filter api add @nestjs/throttler@^6.4.0`, más los cambios en el módulo y el controlador.

- [ ] **Step 4: Ejecutar todas las pruebas**

Run: `pnpm --filter api test:e2e`
Expected: PASS en las tres suites.

- [ ] **Step 5: Commit**

```bash
git add api/package.json pnpm-lock.yaml api/src/modules/auth api/test/limitador.e2e-spec.ts
git commit -m "feat(auth): limitar intentos de login y renovación por IP"
```

---

### Task 8: Cliente — renovación transparente y mensajes de cierre

**Files:**
- Modify: `web/src/lib/api.ts` (además, la interfaz `Sesion` gana `sid: string` e `inactividadMin: number`), `web/src/main.tsx` (registrar el manejador de cierre), `web/src/pages/LoginPage.tsx` (mensaje según `?motivo=`)
- Create: `web/src/features/auth/motivos.ts`, `web/src/features/auth/motivos.test.ts`, `web/src/lib/api.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // lib/api.ts
  export class ApiError extends Error { constructor(public status: number, message: string, public codigo?: string, public motivo?: string) }
  export function alCerrarSesion(manejador: (motivo?: string) => void): void
  export function api<T>(ruta: string, init?: RequestInit): Promise<T>
  // features/auth/motivos.ts
  export function mensajeCierre(motivo: string | null): string | null
  ```
  Reglas de `api`:
  - En las rutas `/auth/login`, `/auth/refresh` y `/auth/logout` se lanza el error sin más lógica.
  - Ante 401 `ACCESO_EXPIRADO`: se espera una única promesa compartida de `POST /api/auth/refresh` y se reintenta una vez. Si la renovación falla, se llama al manejador con su `motivo` y se lanza `ApiError(401, …, 'SESION_CERRADA', motivo)`.
  - Ante 401 `SIN_SESION` o `SESION_CERRADA` en una ruta distinta de `/auth/me`: se llama al manejador con el `motivo`.

  El manejador de `main.tsx` hace `location.replace('/login' + (motivo ? '?motivo=' + motivo : ''))`, salvo que ya esté en `/login`.

- [ ] **Step 1: Escribir las pruebas que fallan.**
  - `motivos.test.ts`: cada motivo de la tabla de spec §9 devuelve su texto literal; `null` y `'OTRO'` devuelven `null`.
  - `api.test.ts`, con `vi.stubGlobal('fetch', …)`:
    1. `tres peticiones con acceso vencido hacen una sola renovación y se reintentan`: `fetch` responde 401 `{codigo:'ACCESO_EXPIRADO'}` a las tres llamadas a `/api/x`, luego 200 a `/api/auth/refresh` y después 200 a los reintentos; se esperan exactamente 1 llamada a refresh y 6 a `/api/x`, y las tres promesas resuelven.
    2. `si la renovación falla avisa al manejador con el motivo`: refresh responde 401 `{codigo:'SESION_CERRADA', motivo:'INACTIVIDAD'}`; el manejador se llama con `'INACTIVIDAD'` y la promesa rechaza con un `ApiError` de `codigo` `'SESION_CERRADA'`.
    3. `una sesión cerrada en otra pestaña lleva al login` (Review Focus 4): `/api/hospedaje/tablero` responde 401 `{codigo:'SIN_SESION'}`; el manejador se llama una vez y no se intenta refresh.
    4. `/auth/me sin sesión no dispara el manejador`.

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `pnpm --filter web test`
Expected: FAIL, falta `motivos` y `alCerrarSesion`.

- [ ] **Step 3: Implementar `motivos.ts` y `api.ts`**, conectar el manejador en `main.tsx` y mostrar en `LoginPage` el texto de `mensajeCierre(useSearchParams().get('motivo'))` en un aviso informativo encima del formulario (`role="status"`).

- [ ] **Step 4: Ejecutar las pruebas**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "feat(web): renovación transparente de sesión y mensajes de cierre"
```

---

### Task 9: Cliente — cierre por inactividad con aviso

**Files:**
- Create: `web/src/features/auth/reloj-inactividad.ts`, `web/src/features/auth/reloj-inactividad.test.ts`, `web/src/features/auth/useInactividad.ts`, `web/src/components/AvisoInactividad.tsx`
- Modify: `web/src/components/Layout.tsx` (usar `useInactividad(sesion.inactividadMin)` y renderizar `AvisoInactividad`)

**Interfaces:**
- Consumes: `api`, `Sesion.inactividadMin` (T8).
- Produces:
  ```ts
  // reloj-inactividad.ts
  export interface OpcionesReloj { limiteMs: number; avisoMs: number; alAvisar: (cierreEn: number) => void; alReanudar: () => void; alCerrar: () => void; ahora?: () => number }
  export function crearRelojInactividad(o: OpcionesReloj): { registrarActividad(): void; detener(): void }
  // useInactividad.ts
  export function useInactividad(minutos: number | undefined): { cierreEn: number | null; seguir: () => void }
  // AvisoInactividad.tsx
  export function AvisoInactividad(p: { cierreEn: number; onSeguir: () => void }): JSX.Element
  ```
  `useInactividad`:
  - Escucha `keydown`, `pointerdown`, `wheel` y `touchstart` (pasivos) en `window` y llama a `registrarActividad` como máximo una vez por segundo.
  - Usa el `BroadcastChannel('hotel-actividad')` con los mensajes `{ tipo: 'actividad' }` y `{ tipo: 'cierre' }`, todo dentro de try/catch.
  - Al cerrar: `api('/auth/logout', { method: 'POST', body: JSON.stringify({ motivo: 'INACTIVIDAD' }) })` (los errores se ignoran), avisa `cierre` a las demás pestañas y hace `location.replace('/login?motivo=INACTIVIDAD')`. Al recibir `cierre` de otra pestaña, solo hace la redirección.

- [ ] **Step 1: Escribir las pruebas que fallan** en `reloj-inactividad.test.ts`, con `vi.useFakeTimers()`, `limiteMs = 30 min` y `avisoMs = 60 s`:
  1. `avisa 60 s antes del límite`: tras 28 min 59 s, `alAvisar` no se ha llamado; tras 29 min, se ha llamado una vez con `cierreEn = inicio + 30 min`.
  2. `la actividad reinicia el conteo y oculta el aviso`: a los 29 min 30 s se llama `registrarActividad()` → `alReanudar` se llama una vez; `alCerrar` no se llama a los 30 min y sí a los 59 min 30 s.
  3. `cierra al llegar al límite`: a los 30 min, `alCerrar` se ha llamado exactamente una vez.
  4. `detener cancela todo`: `detener()` a los 10 min → ningún callback se llama después.

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `pnpm --filter web test -- reloj`
Expected: FAIL, "Failed to resolve import".

- [ ] **Step 3: Implementar el reloj, el hook y el aviso.**
  - `AvisoInactividad`: `role="alertdialog"`, `aria-modal="true"`, `aria-labelledby` apuntando al título "¿Sigues ahí?". El texto es "Tu sesión se cerrará en {n} s por inactividad." y se actualiza cada segundo. El botón "Seguir trabajando" recibe el foco al montarse.

- [ ] **Step 4: Ejecutar las pruebas**

Run: `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "feat(web): cierre por inactividad con aviso y sincronización entre pestañas"
```

---

### Task 10: Verificación final y documentación

**Files:**
- Modify: `README.md` (en la tabla de avance, S-02 pasa a **Completo** con su alcance real; añadir RF-SEG-04, RF-SEG-05, RNF-16 y RNF-27 a la cobertura; añadir las variables nuevas de `.env` a "Levantar el proyecto"; eliminar el punto 1 de "Próximos pasos")

- [ ] **Step 1: Ejecutar la batería completa como en CI**

Run: `pnpm typecheck && pnpm test && pnpm --filter api test:e2e && pnpm build`
Expected: todo en PASS.

- [ ] **Step 2: Verificación manual en la demo.** En `api/.env`, fijar `JWT_ACCESO_MIN=1` (solo para la prueba) y poner `sesion_inactividad_min = 15` en la empresa con SQL. Levantar con `pnpm dev` y comprobar:
  - (a) `recepcion1` no ve "Usuarios y roles" y `GET /api/organizacion/usuarios` le responde 403;
  - (b) pasados 2 min, el tablero sigue cargando y en la pestaña Red aparece `/api/auth/refresh` con 200;
  - (c) sin tocar nada, el aviso aparece a los 14 min y a los 15 se llega al login con "Tu sesión se cerró por inactividad. Vuelve a ingresar.";
  - (d) en `auditoria` aparecen `auth.login`, `auth.logout` y `auth.sesion_revocada` con su IP.

  Al terminar, restaurar `JWT_ACCESO_MIN=15` y el valor 30.

- [ ] **Step 3: Actualizar el README.**

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: S-02 completo"
```
