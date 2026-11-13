# S-05 — Administración de canales de venta

| | |
|---|---|
| Sprint | S-05 (F2) del DT-001, parte pendiente tras el tablero en vivo |
| Fecha | 2026-11-12 |
| Estado | Diseño aprobado |
| Requerimiento | RF-RES-07: administrar canales de venta (mostrador, Booking, Expedia, teléfono, convenio corporativo) y registrar la comisión aplicable |
| Rama | `s05-tablero-en-vivo` (mismo PR #3, que pasa a cubrir todo el S-05) |

## Objetivo

Que el administrador cree y edite los canales de venta de la empresa desde *Hotel y tarifas*, con su comisión, sin tocar la base. Hoy son de solo lectura (`GET /hospedaje/canales`).

## Alcance

**Dentro:** crear, editar (nombre, comisión, agencia online) y activar/desactivar canales; pestaña *Canales* en la pantalla; auditoría; pruebas.

**Fuera:**
- Turnos: siguen de solo lectura.
- Borrar canales: tarifas, reservas y estancias apuntan a ellos; se desactivan.
- Guardar la comisión en cada reserva: va en S-06. Hoy la comisión solo vive en el canal, así que cambiarla alteraría reportes futuros calculados sobre reservas viejas; S-06 debe copiar la comisión vigente en la reserva.

## Enfoques

Un solo enfoque sensato: el patrón ya usado para tipos de habitación (servicio en `ConfiguracionService`, endpoints en `ConfiguracionController`, pestaña con tabla y panel lateral). Una pantalla aparte o un módulo nuevo no aportan: el canal es configuración comercial de la empresa, como los tipos. Aprobado por el usuario.

## Diseño

- **Sin cambios de esquema.** `canal_venta` ya tiene `empresa_id`, `nombre` (único por empresa, máx. 60), `comision_porcentaje` DECIMAL(5,2) con CHECK 0–100, `es_ota` y `activo`.
- **Endpoints** (empresa del token):
  - `GET /hospedaje/config/canales` — todos, incluidos los inactivos, con la cantidad de tarifas vigentes o futuras de la sucursal activa. Permiso `habitacion.gestionar` (el de la pantalla).
  - `POST /hospedaje/canales` `{ nombre, comisionPorcentaje, esOta }` → 201. Permiso `tarifa.editar`. Auditado `canal_venta.crear`.
  - `PATCH /hospedaje/canales/:id` con al menos uno de `{ nombre, comisionPorcentaje, esOta, activo }` → 200. Permiso `tarifa.editar`. Auditado `canal_venta.editar`.
  - `GET /hospedaje/canales` no cambia (solo activos, lo usa la matriz de tarifas).
- **Reglas:**
  - Nombre recortado, de 2 a 60 caracteres; repetido en la empresa → 409.
  - Comisión de 0 a 100 con dos decimales como máximo → si no, 400.
  - Desactivar el último canal activo de la empresa → 409.
  - Un canal de otra empresa → 404.
- **Permiso para escribir:** `tarifa.editar` (decisión de Claude): la comisión es una condición comercial, como el precio. Quien solo tiene `habitacion.gestionar` ve la pestaña sin botones de edición.
- **Pantalla:** pestaña *Canales* entre *Tipos* y *Tarifas*. Tabla con nombre, comisión, *OTA*, tarifas y estado; *+ Nuevo canal* y *Editar* abren el panel lateral (nombre, comisión, casilla «Agencia online», activo). Al guardar se invalida la configuración, de modo que la matriz de tarifas refleja el canal nuevo o desactivado.
- **Tablero en vivo:** no se avisa; el tablero no muestra canales.

## Pruebas

- Unitarias de dominio: validación de comisión (0, 100, 15.5, −1, 100.01, 12.345) y de nombre.
- Integración: crear y verlo en `GET /canales`; nombre repetido 409; editar comisión; comisión inválida 400; desactivar y que desaparezca de `GET /canales`; desactivar el último activo 409; sin `tarifa.editar` 403 al escribir; auditoría registrada.
- Cliente: tipos y build.
