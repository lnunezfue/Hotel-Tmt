# Sistema de Gestión Hotelera con Facturación Electrónica SUNAT

Repositorio único del proyecto descrito en el documento técnico **DT-001**: API en NestJS y cliente web en React, sobre MySQL 8.

| Paquete | Tecnología |
|---|---|
| `api/` | NestJS 11 · TypeScript estricto · Prisma 6 · MySQL 8 · JWT en cookie httpOnly · Argon2id · Swagger |
| `web/` | React 19 · Vite 6 · Tailwind CSS 4 · React Router 7 · TanStack Query |
| Infraestructura | Docker Compose (MySQL 8 + Redis 7) · GitHub Actions |

## Levantar el proyecto

Requisitos: Node 22, pnpm 10 y Docker Desktop abierto.

En Windows basta con hacer doble clic en `iniciar-demo.bat` (hace todo lo de abajo y abre el navegador).

```bash
cp api/.env.example api/.env
pnpm preparar   # instala, levanta MySQL y Redis, aplica migraciones y carga datos de ejemplo
pnpm dev        # API en http://localhost:3000/api · web en http://localhost:5173
```

- Documentación de la API: http://localhost:3000/api/docs
- Usuarios de ejemplo (clave `Hotel2026!`): `admin` (todas las sucursales), `recepcion1` (Hotel Centro), `recepcion2` (Hostal Alto Tacna), `caja1`, `limpieza1`.
- Los datos de empresa, sucursales, habitaciones, huéspedes y tarifas son **de ejemplo**.

Otros comandos: `pnpm test` (pruebas), `pnpm typecheck`, `pnpm build`, `pnpm infra:down`.

## Estructura

```
api/
  prisma/
    migrations/20261104000000_esquema_inicial/   Esquema v1.1 completo: 54 tablas, CHECK, triggers, procedimientos, vistas, catálogos SUNAT
    schema.prisma                                Generado desde la BD (scripts/gen-prisma-schema.py)
    seed.ts                                      Datos de ejemplo
  src/
    main.ts · worker.ts                          Arranque en modo API y en modo trabajador
    modules/
      auth/            Login, cookie de sesión, guard global de permisos (@RequierePermiso)
      organizacion/    Empresa, sucursales, usuarios y roles
      catalogos/       Catálogos SUNAT y tipos de movimiento
      hospedaje/
        domain/          Máquina de estados de la habitación, turnos, alertas (lógica pura + pruebas)
        application/     Casos de uso
        infrastructure/  Repositorio Prisma (filtra por sucursal del token)
      facturacion/
        domain/          Puerto ProveedorFacturacion
        infrastructure/pse/  Adaptador simulado (NubeFacT / FactuSmart irán aquí)
web/
  src/pages/          Login, tablero de habitaciones, reservas (maqueta), usuarios
  src/features/       Sesión y lógica de hospedaje
  src/components/ui/  Componentes base
```

## Avance (semana 1)

| Sprint (DT-001) | Alcance | Estado |
|---|---|---|
| S-01 Preparación | Repositorio único, Docker, NestJS, React + Vite, Prisma, migración del esquema, catálogos SUNAT, CI | **Completo** |
| S-02 Seguridad | Login con JWT en cookie httpOnly, Argon2id, bloqueo tras 3 intentos, guard de permisos por rol, rutas protegidas | **Avanzado**: falta token de renovación, cierre por inactividad e interceptor de auditoría |
| S-03 Organización | Empresa, sucursales, usuarios y roles (lectura), cambio de sucursal activa | **Iniciado**: falta crear/editar usuarios y el certificado digital |
| S-04 / S-05 Habitaciones y tablero | Tablero por piso con colores, cambio de estado con reglas y historial, alertas de salida, alta de habitaciones (API) | **Adelantado** |
| S-06 Reservas | Maqueta del calendario y del formulario de reserva para validar con recepción | **Maqueta** |
| F3 Facturación | Puerto del proveedor y adaptador simulado | **Diseño listo** |

Requerimientos cubiertos o iniciados: RF-SEG-01, 02, 03, 04, 05 (parcial); RF-RES-01 a 05, 08 y 15 (API); RNF-12, 14, 15, 19 (bloqueo de serie ya en BD), 30, 32, 34.

## Decisiones técnicas de esta semana

- **El esquema SQL es la fuente de verdad.** La migración inicial es el script v1.1 completo (triggers, procedimientos, vistas y CHECK que Prisma no modela). `schema.prisma` se genera desde la base con `python3 api/scripts/gen-prisma-schema.py hotel_dev` (equivalente a `prisma db pull`). Cambios futuros: nueva migración SQL y volver a generar. Sin cliente mysql local (p. ej. Windows con Docker): `MYSQL_CMD="docker exec -i hotel-mysql mysql -uroot -proot_dev_pass" python api/scripts/gen-prisma-schema.py hotel_dev`; `MYSQL_CMD` admite cualquier comando de cliente mysql.
- **Prisma sin binarios nativos.** Se usa `engineType = "client"` con el adaptador `@prisma/adapter-mariadb` (compatible con MySQL 8). La imagen Docker queda más liviana y no depende de descargar el motor de Prisma.
- **Fechas en UTC en la base**, mostradas en hora de Lima en la interfaz.
- **La sucursal activa sale del token**, nunca de un parámetro del navegador (DT-001 §4.4).

## Próximos pasos

1. Token de renovación, cierre por inactividad e interceptor de auditoría (S-02).
2. Alta y edición de usuarios con asignación de sucursales y series (S-03).
3. Pisos, tipos y tarifas en la interfaz; tablero en vivo con WebSocket (S-04 / S-05).
4. Reservas y check-in reales sobre la maqueta validada (S-06).
5. Pendiente de gerencia para F3: elegir proveedor (NubeFacT o FactuSmart) y volumen mensual de comprobantes (A-01, A-03).
