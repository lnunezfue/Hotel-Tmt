# Plan — S-03 / S-04 usuarios y configuración del hotel

Spec: `docs/superpowers/specs/2026-11-09-s03-s04-usuarios-configuracion-design.md`. Rama `s03-s04-organizacion-hotel`, sobre `s02-sesiones-auditoria`.

Cada tarea termina con pruebas en verde y un commit convencional.

## Tarea 1 — Migración
- [x] `20261109000000_usuarios_y_configuracion` con `down.sql`; probado subir → bajar → subir.
- [x] `schema.prisma`: `usuario.debe_cambiar_clave`, valor `CAMBIO_CLAVE`.

## Tarea 2 — Dominio de usuarios
- [x] `organizacion/domain/usuario.ts`: `validarUsername`, `validarSucursales`, `politicaClave`, `estadoUsuario` + spec.
- [x] Códigos nuevos en `ACCIONES_AUDITORIA`.

## Tarea 3 — Sesiones
- [x] `SesionesService.revocarDeUsuario(tx, usuarioId, motivo, excepto?)` (audita cada sesión).
- [x] JWT con `debeCambiarClave`; guard con 403 `CAMBIO_CLAVE_REQUERIDO` y `@PermitidoConClaveTemporal`.
- [x] `POST /auth/clave`.

## Tarea 4 — API de usuarios y roles
- [x] `UsuariosService` + controlador; `usuarios.e2e-spec.ts`.

## Tarea 5 — Dominio de tarifas
- [x] `hospedaje/domain/tarifa.ts`: `tarifaVigente`, `planificarTarifa`, `hoyLima` + spec.

## Tarea 6 — API de configuración
- [x] `ConfiguracionService` + endpoints de pisos, tipos, habitaciones, tarifas, canales y turnos; `configuracion.e2e-spec.ts`.

## Tarea 7 — Cliente
- [x] Usuarios y roles funcional (panel de alta/edición, acciones, matriz de roles).
- [x] Configuración del hotel con pestañas.
- [x] Cambio de contraseña obligatorio; motivo `CAMBIO_CLAVE` en el aviso de ingreso.

## Tarea 8 — Cierre
- [x] README (avance y demo), CI sin cambios (la migración entra en `prisma:deploy`).
