# S-05 Canales de venta — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear, editar y desactivar canales de venta con su comisión desde *Hotel y tarifas*.

**Architecture:** Mismo patrón que los tipos de habitación: reglas puras en `hospedaje/domain/canal-venta.ts`, casos de uso en `ConfiguracionService`, endpoints en `ConfiguracionController`, pestaña con tabla y panel lateral en `ConfiguracionHotelPage`. Sin cambios de esquema.

**Tech Stack:** NestJS 11, Prisma 6, Zod, Jest; React 19, TanStack Query 5.

**Spec:** `docs/superpowers/specs/2026-11-12-s05-canales-venta-design.md`

## Global Constraints

- Rama `s05-tablero-en-vivo`; un commit por tarea, en español, con `Co-Authored-By`.
- Empresa siempre del token (`c.empresaId`).
- Escribir: permiso `tarifa.editar`. Ver la lista de configuración: `habitacion.gestionar`.
- Códigos de auditoría nuevos: `canal_venta.crear`, `canal_venta.editar`.
- Nombre recortado, 2–60 caracteres. Comisión 0–100, máximo dos decimales.

## Review Focus

1. Comisión enviada como texto (`"15"`) o con 3 decimales → 400, no 500. (Task 2, e2e.)
2. Desactivar el último canal activo → 409 y el canal sigue activo. (Task 2, e2e.)
3. Canal de otra empresa por id → 404. (Task 2, e2e, con id inexistente.)
4. Renombrar a un nombre que ya existe → 409. (Task 2, e2e.)
5. Usuario con `habitacion.gestionar` sin `tarifa.editar` ve la pestaña sin botones de edición. (Task 3, revisión manual del código.)

---

### Task 1: Reglas del canal

**Files:** Create `api/src/modules/hospedaje/domain/canal-venta.ts` y `canal-venta.spec.ts`.

**Produces:**
```ts
export class ReglaCanalError extends Error {}
export function normalizarNombreCanal(nombre: string): string;   // recorta; lanza si < 2 o > 60
export function validarComision(valor: number): void;            // lanza si no es finito, < 0, > 100 o > 2 decimales
```

- [ ] Pruebas: `normalizarNombreCanal('  Expedia ')` → `'Expedia'`; `'B'` y 61 caracteres lanzan `ReglaCanalError`. `validarComision` acepta 0, 100, 15.5, 12.25; rechaza −1, 100.01, 12.345, NaN.
- [ ] Verlas fallar (`jest canal-venta`), implementar, verlas pasar, commit `feat(hospedaje): reglas del canal de venta`.

### Task 2: API de canales

**Files:** Modify `configuracion.service.ts`, `configuracion.controller.ts`, `auditoria/domain/acciones.ts`. Create `api/test/canales.e2e-spec.ts`.

**Produces:**
- `ConfiguracionService.canalesConfig(c)` → `Array<{ id; nombre; comisionPorcentaje: string /* '15.00' */; esOta: boolean; activo: boolean; tarifas: number }>` (tarifas activas de la sucursal con `vigente_hasta` nulo o ≥ hoy).
- `crearCanal(c, { nombre, comisionPorcentaje, esOta })`, `editarCanal(c, id, { nombre?, comisionPorcentaje?, esOta?, activo? })`: auditados en su transacción; `ReglaCanalError` → 400 vía `traducir`; P2002 → 409 «Ya existe el canal «X»»; otra empresa → 404; desactivar el último activo → 409.
- Endpoints: `GET /hospedaje/config/canales`, `POST /hospedaje/canales` (201), `PATCH /hospedaje/canales/:id`. Zod: `comisionPorcentaje: z.number()`, `esOta: z.boolean().default(false)` al crear; al editar, parcial con al menos un campo.

- [ ] e2e (escrita antes; corre en el CI): crear y verlo en `GET /canales` y en `config/canales` con `comisionPorcentaje: '12.50'`; duplicado 409 (crear y renombrar); comisión 100.01, 12.345 y `"15"` → 400; editar comisión; desactivar → ya no está en `GET /canales`; desactivar todos menos uno y luego ese → 409 (restaurar en `finally`); id inexistente → 404; sin `tarifa.editar` → 403 en POST y PATCH; una fila de auditoría `canal_venta.crear`.
- [ ] Implementar; `tsc` y `jest` unitario en verde; commit `feat(hospedaje): administración de canales de venta`.

### Task 3: Pestaña Canales

**Files:** Modify `web/src/pages/ConfiguracionHotelPage.tsx`.

- [ ] `PestanaCanales` y `EditorCanal` siguiendo `PestanaTipos`/`EditorTipo`: tabla (nombre, comisión con `%`, `OTA`, tarifas, estado); `+ Nuevo canal` y la fila abren el panel (nombre, comisión numérica con paso 0.01, casilla «Agencia online (OTA)», botón activar/desactivar). Sin `tarifa.editar`: sin botón de alta y el panel no se abre; aviso como en Tarifas. Pestaña entre *Tipos* y *Tarifas*.
- [ ] `tsc`, `vitest`, `vite build` en verde; commit `feat(web): pestaña de canales de venta`.

### Task 4: Documentación

- [ ] README: S-05 completo salvo turnos y la prueba manual; recuento de pruebas real. Spec: estado. Commit, push, actualizar título y descripción del PR #3, revisar CI.
