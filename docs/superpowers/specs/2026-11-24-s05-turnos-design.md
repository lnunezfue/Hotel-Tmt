# S-05 — Administración de turnos

| | |
|---|---|
| Sprint | S-05 (F2) del DT-001, última parte pendiente |
| Fecha | 2026-11-24 |
| Estado | Aprobado por el usuario («sí» a la pantalla de turnos, con el patrón de canales) |
| Requerimiento | RF-RES-08: definir turnos de 3, 6, 12 y 24 horas con su duración en horas y su descripción comercial |
| Rama | `s05-tablero-en-vivo` (PR #3) |

## Objetivo

Crear, editar y desactivar turnos desde *Hotel y tarifas*. Hoy existen los de 24, 12, 6 y 3 horas (migración inicial), pero solo se pueden ver (`GET /hospedaje/turnos`).

## Enfoque

El mismo de los canales de venta (spec 2026-11-12): reglas puras en el dominio, casos de uso en `ConfiguracionService`, endpoints en `ConfiguracionController` y una pestaña con tabla y panel lateral. Sin cambios de esquema.

## Diseño

- **Datos:** `turno` es común a todo el sistema (sin empresa). `nombre` (la descripción comercial, máx. 30), `duracion_horas` (1–24, única) y `activo`. Lo usan `tarifa`, `reserva_habitacion` y `estancia`.
- **Endpoints:**
  - `GET /hospedaje/config/turnos`: todos, incluidos los inactivos, con la cantidad de tarifas vigentes o futuras de la sucursal y si el turno ya se usó. Permiso `habitacion.gestionar`.
  - `POST /hospedaje/turnos` `{ nombre, duracionHoras }` → 201. Permiso `tarifa.editar`. Auditado `turno.crear`.
  - `PATCH /hospedaje/turnos/:id` con al menos uno de `{ nombre, duracionHoras, activo }` → 200. Permiso `tarifa.editar`. Auditado `turno.editar`.
  - `GET /hospedaje/turnos` no cambia (solo activos, ordenados de mayor a menor duración).
- **Reglas:**
  - Nombre recortado, de 2 a 30 caracteres.
  - Duración entera de 1 a 24 horas; repetida → 409.
  - **No se cambia la duración de un turno ya usado** por alguna tarifa, reserva o estancia → 409 «crea un turno nuevo». Los precios se fijaron para esa duración y los cobros se calculan con ella (decisión de Claude).
  - Desactivar el último turno activo → 409.
  - Inexistente → 404.
- **Permiso para escribir:** `tarifa.editar`, igual que los canales: el turno define qué se vende y a qué precio.
- **Pantalla:** pestaña *Turnos* entre *Canales* y *Tarifas*. Tabla con nombre, duración, tarifas y estado; panel lateral para crear o editar. La duración queda bloqueada en el panel cuando el turno ya se usó.
- **Tablero en vivo:** no se avisa; el tablero no muestra turnos.

## Pruebas

- Unitarias: nombre (recorte, 1 y 31 caracteres) y duración (0, 25, 2.5 y valores válidos).
- Integración: crear y verlo en `GET /turnos`; duración repetida 409; editar nombre; cambiar la duración de un turno sin uso → 200; cambiar la de uno con tarifas → 409; desactivar el último activo → 409; inexistente 404; sin `tarifa.editar` 403; auditoría.
