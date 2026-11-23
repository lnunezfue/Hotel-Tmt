# S-06 — Plano visual del hotel, comodidades y reservas

| | |
|---|---|
| Sprint | S-06 (F2 · reservas y check-in) del DT-001, más dos pedidos de gerencia del 23/11 |
| Fecha | 2026-11-23 |
| Estado | Implementado en la rama `s06-plano-reservas` (parte de `s05-tablero-en-vivo`) |
| Requerimientos | RF-RES-01 a RF-RES-04 (gestión visual), RF-RES-06 a RF-RES-12, RF-RES-15, RF-RES-18 |
| Depende de | S-04 (tarifas, precio vigente), S-05 (avisos al tablero) |

## 1. Pedidos que origina este sprint

1. **Gerencia (23/11)**: armar el hotel «como una interfaz gráfica»: agregar un piso, ver las habitaciones como dibujos y que sea intuitivo.
2. **Gerencia (23/11)**: cada habitación muestra datos extra, como aire acondicionado o internet. No estaba en el ERD v1.1.
3. **DT-001 S-06**: reservas reales sobre la maqueta validada, con check-in.

## 2. Decisiones

| # | Decisión | Motivo |
|---|---|---|
| D1 | El plano es una **cuadrícula por piso** (`piso.plano_columnas × plano_filas`); la habitación guarda `plano_x/y/ancho/alto` y los pasillos y escaleras van en `plano_elemento` | Simple de validar (rectángulos que no se superponen), de dibujar y de editar arrastrando. No se necesita CAD |
| D2 | Superposición y límites se validan en el dominio (`hospedaje/domain/plano.ts`) al guardar; el cliente repite la regla para avisar en vivo | El servidor manda; el cliente solo orienta |
| D3 | Una habitación sin posición se propone en el primer hueco libre al leer el plano | Las habitaciones creadas antes de S-06 (o desde Configuración) aparecen sin migrar datos |
| D4 | Los dibujos se eligen por el **nombre del tipo** (Simple, Doble, Matrimonial, Suite) y, si no se reconoce, por la capacidad; la puerta mira al pasillo más cercano | Ningún dato nuevo para dibujar |
| D5 | Comodidades: catálogo por empresa (`amenidad`) con un **dibujo de una lista fija** y asignación por habitación (`habitacion_amenidad`). Se puede aplicar a todas las del mismo tipo | La empresa crea las suyas («Vista al mar») sin subir imágenes |
| D6 | Un piso nuevo se crea con su distribución inicial (pasillo, escalera, habitaciones arriba y abajo, numeradas 401, 402…) y equipado como el resto de su tipo | «Agregar un piso» de un clic, luego se ajusta arrastrando |
| D7 | Reserva por noches: entra 14:00 y sale 12:00 (hora de Lima). Por horas: desde la hora indicada | Una salida y una entrada el mismo día no se cruzan |
| D8 | El precio es la tarifa vigente el día de llegada (S-04) y queda guardado en `reserva_habitacion` | Si la tarifa cambia, lo pactado no cambia |
| D9 | El solape lo impide el trigger `trg_rh_bi_solape` de la base; la API lo traduce a 409 con su mensaje | Una sola regla, válida también ante dos altas simultáneas |
| D10 | Si la llegada es hoy, la habitación libre pasa a RESERVADA (o CONFIRMADA); al cancelar o «no se presentó», vuelve a DESOCUPADA | Recepción ve las llegadas en el tablero |
| D11 | El check-in crea la estancia con el precio pactado y el titular, y pone la habitación OCUPADA, en una transacción. Exige que la transición a OCUPADA sea válida | La habitación en limpieza no se entrega |

## 3. Base de datos

Migración `20261123000000_plano_amenidades_reservas` (con `down.sql`, probada subir → bajar → subir):

- `piso.plano_columnas`, `piso.plano_filas` (CHECK de límites).
- `habitacion.plano_x`, `plano_y`, `plano_ancho`, `plano_alto` (CHECK: x e y son nulos a la vez).
- `plano_elemento` (PASILLO, ESCALERA, ASCENSOR, RECEPCION, AREA_COMUN, BANO_COMUN).
- `amenidad` y `habitacion_amenidad`, con 12 comodidades iniciales para cada empresa existente.
- El permiso `reserva.ver` para ADMINISTRADOR y RECEPCIONISTA.

## 4. API

| Método y ruta | Permiso | Auditoría |
|---|---|---|
| `GET /hospedaje/plano` | sesión | — |
| `PUT /hospedaje/plano/pisos/:id` | `habitacion.gestionar` | `plano.guardar` |
| `POST /hospedaje/plano/pisos` | `habitacion.gestionar` | `piso.crear` + `habitacion.crear` por habitación |
| `GET /hospedaje/amenidades` · `POST` · `PATCH :id` | sesión / `habitacion.gestionar` | `amenidad.crear` · `amenidad.editar` |
| `PUT /hospedaje/habitaciones/:id/amenidades` | `habitacion.gestionar` | `habitacion.amenidades` |
| `POST /hospedaje/habitaciones` (acepta `plano` y `amenidades`) | `habitacion.gestionar` | `habitacion.crear` |
| `GET /reservas?desde&hasta` · `GET /reservas/:id` · `GET /reservas/disponibilidad` | `reserva.ver` | — |
| `POST /reservas` · `POST /reservas/:id/confirmar` | `reserva.crear` | `reserva.crear` · `reserva.confirmar` |
| `POST /reservas/:id/cancelar` (motivo) · `POST /reservas/:id/no-show` | `reserva.cancelar` | `reserva.cancelar` · `reserva.no_show` |
| `POST /reservas/:id/checkin` | `estancia.checkin` | `estancia.checkin` |
| `GET /clientes?q=` · `GET /clientes/tipos-documento` · `POST /clientes` | `reserva.ver` / `reserva.crear` | `cliente.crear` |

Documentos de huésped: el DNI debe tener 8 dígitos; el RUC, 11 con dígito verificador; CE y pasaporte, de 4 a 15 caracteres alfanuméricos.

## 5. Cliente

- **Plano del hotel** (`/plano`), con tres modos:
  - **Ver estado**: la fachada muestra un piso por banda y una ventana por habitación, con el color de su estado. El plano dibuja cada habitación desde arriba (camas, baño, puerta y ventana) con sus íconos de comodidades. El panel muestra los datos y el huésped.
  - **Reservar**: se eligen fechas, personas y comodidades; las habitaciones libres se resaltan, y un clic abre la reserva.
  - **Diseñar plano**: se agregan pisos con vista previa y habitaciones desde la paleta. Habitaciones y elementos se arrastran y se redimensionan, y si chocan se marcan en rojo. También funcionan las flechas del teclado. Desde ahí se editan el número, el tipo y las comodidades, se crean comodidades nuevas y se guarda.
- **Reservas** (`/reservas`):
  - Calendario de 14 días por habitación. Muestra las estancias sin reserva previa.
  - Tarjetas con las llegadas y salidas de hoy.
  - Detalle de la reserva con confirmar, check-in, cancelar con motivo y «no se presentó».
  - Formulario compartido con el plano: búsqueda o alta de huésped, disponibilidad y precio vigente.
- **Demostración web**: `pnpm --filter web build:demo` genera el cliente con una API simulada en el navegador (`web/src/demo/`), a partir de una foto del seed. No forma parte del build normal.

## 6. Fuera de alcance

- Check-out con cobro y comprobante: S-07 y F3.
- Reservas con varias habitaciones a la vez: el modelo ya lo soporta (`reserva_habitacion`); la pantalla, en S-07.
- Plano en el tablero en vivo por SSE: el plano se refresca cada 30 s y con cada cambio propio.

## 7. Pruebas

- Unitarias de API: `plano.spec.ts` y `reserva.spec.ts`.
- Integración (`test:e2e`):
  - `plano.e2e-spec.ts`: piso con plano, superposición, comodidades y comodidades propias.
  - `reservas.e2e-spec.ts`: precio vigente, solape 409, entrada el mismo día de una salida, capacidad, cancelación, llegada de hoy hasta el check-in, permisos.
- Cliente: `plano.test.ts`, `fechas.test.ts`.
