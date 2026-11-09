# S-03 / S-04 — Gestión de usuarios y configuración del hotel

| | |
|---|---|
| Sprints | S-03 (F1 · usuarios, roles y permisos) y S-04 (F2 · configuración del hotel) del DT-001 |
| Fecha | 2026-11-09 |
| Estado | Implementado en la rama `s03-s04-organizacion-hotel` (parte de `s02-sesiones-auditoria`) |
| Requerimientos | RF-SEG-01, RF-SEG-02, RF-SEG-03, RF-SEG-05, RF-RES-01, RF-RES-02, RF-RES-03, RF-RES-04 · RNF-15, RNF-16 |
| Depende de | S-02 (sesiones revocables, auditoría `@Auditar`) |

## 1. Objetivo

Resultados verificables del DT-001:

- S-03: **"Un administrador crea un recepcionista, le asigna sucursales y lo desactiva; el usuario pierde el acceso"**.
- S-04: **"La sucursal tiene sus pisos, tipos, habitaciones y tarifas configurados desde la pantalla, sin tocar la base"**.

## 2. Alcance

**Dentro**
- Migración `20261109000000_usuarios_y_configuracion`: columna `usuario.debe_cambiar_clave`, motivo de revocación `CAMBIO_CLAVE`, permiso `usuario.gestionar` (y los de S-01 que solo creaba el seed).
- Usuarios: crear, editar (datos, rol, sucursales y principal), activar/desactivar, desbloquear, restablecer contraseña (temporal), cerrar sesiones. Todo auditado.
- Roles: crear rol y editar su matriz de permisos. `ADMINISTRADOR` no se edita (evita quedarse sin acceso).
- Cambio de la propia contraseña (`POST /auth/clave`) y bloqueo de la API mientras la contraseña sea temporal.
- Configuración de la sucursal activa: pisos, tipos de habitación (empresa), habitaciones (editar, activar/desactivar) y tarifas por tipo × canal × turno con vigencia.
- Consulta del precio vigente (`GET /hospedaje/tarifas/vigente`) que usará reservas en S-06.
- Pantallas: Usuarios y roles (funcional), Configuración del hotel (pestañas), Cambio de contraseña obligatorio.

**Fuera (y dónde va)**
- Series por usuario (`usuario_serie`) → S-08, cuando existan series operativas de emisión.
- Certificado digital y datos SUNAT de la empresa → S-09 (facturación).
- Alta de sucursales → se mantiene por migración/seed; la pantalla llega con la configuración de empresa (S-09).
- Política de contraseñas configurable por empresa → fija en esta versión (§4.3).

## 3. Decisiones

| # | Decisión | Motivo |
|---|---|---|
| D1 | Un solo permiso `usuario.gestionar` para usuarios y roles | Solo el administrador lo usa; separar no aporta en un hotel pequeño |
| D2 | Desactivar, restablecer contraseña y cambiar rol o sucursales **revocan las sesiones** del usuario (`USUARIO_INACTIVO` o `ADMIN`) | Sin revocar, el cambio tardaría hasta 12 h; con la revocación se acota a 15 min (vida del acceso, riesgo aceptado en S-02 §5.3) |
| D3 | Editar los permisos de un rol **no** revoca sesiones | La renovación relee permisos (S-02 §5.4 paso 3): el cambio aplica en ≤ 15 min sin expulsar a todo un turno |
| D4 | El administrador no puede desactivarse ni quitarse `usuario.gestionar` a sí mismo; el rol `ADMINISTRADOR` es de solo lectura | Evita dejar la empresa sin administrador |
| D5 | Contraseña temporal: `debe_cambiar_clave = 1`; el JWT lleva `debeCambiarClave` y el guard responde 403 `CAMBIO_CLAVE_REQUERIDO` salvo en rutas marcadas `@PermitidoConClaveTemporal` | La regla vive en el servidor; el cliente solo muestra la pantalla |
| D6 | Una tarifa nueva **cierra** la vigente (`vigente_hasta = desde − 1 día`); no se edita el precio de una tarifa con historia | Las estancias y reservas guardan el precio pactado, pero el historial de precios queda para reportes |
| D7 | Fechas de vigencia como `YYYY-MM-DD` en hora de Lima; la lógica de vigencia es una función pura del dominio | Testeable sin base; coincide con la columna `DATE` |
| D8 | No se borran pisos, tipos ni habitaciones: se desactivan | Tienen historial (estancias, comprobantes); el tablero solo muestra activos |

## 4. Usuarios y roles (S-03)

### 4.1 Endpoints (`/organizacion`)

| Método y ruta | Permiso | Auditoría | Notas |
|---|---|---|---|
| `GET usuarios` | `usuario.ver` | — | Agrega `rolId`, `sesionesActivas`, `debeCambiarClave` |
| `POST usuarios` | `usuario.gestionar` | `usuario.crear` | `{ username, nombres, apellidos, email?, rolId, sucursales: [{ id, principal }], clave }`; queda con `debe_cambiar_clave = 1` |
| `PATCH usuarios/:id` | `usuario.gestionar` | `usuario.editar` | Si cambian rol o sucursales → revoca sesiones (`ADMIN`) |
| `POST usuarios/:id/desactivar` | `usuario.gestionar` | `usuario.desactivar` | Revoca sesiones (`USUARIO_INACTIVO`). No a sí mismo |
| `POST usuarios/:id/activar` | `usuario.gestionar` | `usuario.activar` | Pone `intentos_fallidos = 0` |
| `POST usuarios/:id/desbloquear` | `usuario.gestionar` | `usuario.desbloquear` | 409 si no estaba bloqueado |
| `POST usuarios/:id/restablecer-clave` | `usuario.gestionar` | `usuario.restablecer_clave` | `{ clave }` temporal; desbloquea y revoca sesiones (`ADMIN`) |
| `POST usuarios/:id/cerrar-sesiones` | `usuario.gestionar` | `usuario.cerrar_sesiones` | Devuelve cuántas cerró |
| `GET permisos` | `usuario.ver` | — | Catálogo agrupado por módulo |
| `POST roles` | `usuario.gestionar` | `rol.crear` | `{ nombre, descripcion?, permisos: string[] }` |
| `PUT roles/:id/permisos` | `usuario.gestionar` | `rol.editar_permisos` | 409 para `ADMINISTRADOR` |

Cada revocación escribe además un `auth.sesion_revocada` por sesión, como en S-02.

### 4.2 Reglas de validación (dominio `organizacion/domain/usuario.ts`)
- `username`: 3–50, minúsculas, letras, dígitos, `.`, `_`, `-`; único por empresa (409).
- Sucursales: al menos una, de la empresa, sin repetir, **exactamente una principal**.
- El rol debe existir y estar activo.

### 4.3 Política de contraseña
Mínimo 8 caracteres, al menos una letra y un dígito, distinta del usuario. Se valida en el servidor (`politicaClave`) y se muestra en el cliente.

### 4.4 Cambio de la propia contraseña
`POST /auth/clave { actual, nueva }` (marcado `@PermitidoConClaveTemporal`). Verifica la actual (contando intentos como el login), aplica la política, exige que sea distinta, guarda el hash, pone `debe_cambiar_clave = 0`, revoca **las demás** sesiones del usuario con `CAMBIO_CLAVE`, registra `auth.cambio_clave` y reemite el acceso de la sesión actual sin prolongar su vencimiento.

## 5. Configuración del hotel (S-04)

### 5.1 Endpoints (`/hospedaje`, sucursal del token)

| Método y ruta | Permiso | Auditoría |
|---|---|---|
| `GET config/habitaciones` (incluye inactivas) | `habitacion.gestionar` | — |
| `PATCH habitaciones/:id` | `habitacion.gestionar` | `habitacion.editar` |
| `POST pisos` · `PATCH pisos/:id` | `habitacion.gestionar` | `piso.crear` · `piso.editar` |
| `POST tipos-habitacion` · `PATCH tipos-habitacion/:id` | `habitacion.gestionar` | `tipo_habitacion.crear` · `tipo_habitacion.editar` |
| `GET tarifas?fecha=` | — | — |
| `POST tarifas` | `tarifa.editar` | `tarifa.crear` |
| `GET tarifas/vigente?tipoId&canalId&turnoId&fecha` | — | — |
| `GET canales` · `GET turnos` | — | — |

### 5.2 Reglas
- Habitación: no se desactiva si está `OCUPADA` o tiene una estancia activa (409). Número único por sucursal.
- Piso: número único por sucursal; no se desactiva con habitaciones activas.
- Tipo: nombre único por empresa; no se desactiva si alguna habitación activa lo usa.
- Tarifa (`planificarTarifa`): precio > 0 y ≤ 99 999; `vigente_desde` no anterior a hoy (Lima). Si ya existe una tarifa con la misma clave y misma fecha → 409. Si existe una posterior a la fecha → 409 ("hay una tarifa programada"). La vigente que cubre la fecha se cierra el día anterior.

## 6. Cliente

- **Usuarios y roles**: tabla con acciones por fila (editar, desactivar/activar, desbloquear, restablecer, cerrar sesiones), panel lateral de alta/edición con sucursales y principal, pestaña de roles con matriz de permisos por módulo. Los botones se ocultan sin `usuario.gestionar`.
- **Configuración del hotel** (`/configuracion/hotel`, permiso `habitacion.gestionar`): pestañas Habitaciones, Pisos, Tipos y Tarifas. La matriz de tarifas muestra tipo × turno para el canal elegido, con el precio vigente y la fecha desde la que rige; editar una celda programa un precio nuevo.
- **Cambiar contraseña**: si la sesión trae `debeCambiarClave`, se muestra antes del layout.

## 7. Pruebas

- Unitarias: `usuario.ts` (validaciones y política), `tarifa.ts` (vigencia y plan de cambio), `motivos.ts` del cliente.
- Integración (`test:e2e`): `usuarios.e2e-spec.ts` (alta, permisos, desactivar revoca la sesión, autodesactivación prohibida, clave temporal bloquea la API hasta cambiarla, auditoría), `configuracion.e2e-spec.ts` (pisos, tipos, habitaciones, tarifa nueva cierra la anterior, vigente).
