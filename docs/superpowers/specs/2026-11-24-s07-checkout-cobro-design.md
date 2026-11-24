# S-07 — Check-out con cobro, caja, acompañantes y reservas de varias habitaciones

| | |
|---|---|
| Sprint | S-07 del DT-001 (cierre de F2: estadía completa) |
| Fecha | 2026-11-24 |
| Estado | Implementado en la rama `s07-checkout-cobro` (parte de `s06-plano-reservas`) |
| Requerimientos | RF-RES-13, RF-RES-14, RF-RES-16, RF-RES-17, RF-CAJ-01 a RF-CAJ-04, RF-FAC-01 (emisión local) |
| Pedido | Gerencia quiere ver el proceso completo funcionando: de la reserva al cierre de caja |

## 1. Alcance

- **Reservas de varias habitaciones**: una familia o un grupo en una sola reserva. Cada habitación tiene su precio por tipo y su propia capacidad.
- **Adelanto con método de pago**: entra a la caja abierta como `ADELANTO_RESERVA`.
- **Comisión del canal** fijada al reservar y al hacer check-in (`reserva.comision_porcentaje`, `estancia.comision_porcentaje`). Cambiarla después no altera ventas pasadas, tal como lo anotó S-05.
- **Huéspedes acompañantes**: se registran en el check-in (por habitación) o durante la estadía.
- **Check-in directo** para quien llega sin reserva: turno por noche o por horas, al precio de la tarifa de hoy.
- **Consumos y cargos** de la estadía (`estancia_cargo`): productos del frigobar y servicios, o cargos libres como la hora extra.
- **Check-out con cobro**, todo en una transacción:
  1. Calcula la cuenta: hospedaje + cargos − adelanto.
  2. Cobra en uno o varios métodos; el vuelto solo se da en efectivo.
  3. Emite BOLETA, FACTURA (solo a un RUC) o INTERNO, con detalle e IGV.
  4. Registra los pagos en caja.
  5. Deja las habitaciones en LIMPIEZA y la reserva FINALIZADA.
- **Caja**: apertura, gastos, retiros e ingresos de sencillo, y cierre con arqueo (`sp_cerrar_caja`).

**Fuera de alcance**: envío a SUNAT (F3), anulación de comprobantes y notas de crédito (F3), control de stock de productos (F4), crédito y cuotas (F3).

## 2. Decisiones

| # | Decisión | Motivo |
|---|---|---|
| D1 | Las habitaciones de una misma reserva **se cobran juntas** en un comprobante | Así paga una familia o un grupo; el adelanto es de la reserva, no de una habitación |
| D2 | Los precios incluyen IGV; la base y el IGV se calculan **por línea** con céntimos enteros (`cobro.ts`) | Los totales del comprobante cuadran exactamente con la suma de las líneas |
| D3 | El adelanto se registra en caja al reservar; en el comprobante figura como un pago con referencia «Adelanto R-…», pero no vuelve a entrar a la caja | No se duplica el efectivo en el arqueo |
| D4 | Sin caja abierta no se cobra (409 `CAJA_CERRADA`); una cuenta con saldo cero sí se cierra | El dinero siempre tiene una sesión responsable |
| D5 | El comprobante usa el correlativo de `sp_siguiente_correlativo` dentro de la misma transacción; la serie es la asignada al usuario o, si no tiene, la de la sucursal | Sin huecos ni números repetidos; las series por usuario completas llegan en S-08 |
| D6 | BOLETA y FACTURA quedan en `estado_sunat = PENDIENTE`; INTERNO queda en `NO_APLICA` (trigger) | El envío al PSE es F3; el comprobante ya es válido localmente y se imprime |
| D7 | Un cargo de una estadía cerrada se rechaza en el servicio (409) | Una estadía cerrada ya está facturada |

## 3. API

| Método y ruta | Permiso | Auditoría |
|---|---|---|
| `POST /reservas` (`habitaciones[]`, `adelanto`, `metodoPagoId`) | `reserva.crear` | `reserva.crear` |
| `POST /reservas/:id/checkin` (`huespedes[]` por habitación) | `estancia.checkin` | `estancia.checkin` |
| `POST /estancias` (check-in directo) | `estancia.checkin` | `estancia.checkin` |
| `GET /estancias/:id` · `GET /estancias/habitacion/:id` | sesión | — |
| `POST /estancias/:id/huespedes` | `estancia.checkin` | `estancia.huesped` |
| `POST /estancias/:id/cargos` · `DELETE /estancias/:id/cargos/:cargoId` | `estancia.checkout` | `estancia.cargo` · `estancia.cargo_anulado` |
| `POST /estancias/:id/checkout` | `estancia.checkout` | `estancia.checkout` |
| `GET /comprobantes?fecha` · `GET /comprobantes/:id` | sesión | — |
| `GET /productos` | sesión | — |
| `GET /caja` · `GET /caja/metodos-pago` | sesión | — |
| `POST /caja/abrir` · `POST /caja/movimientos` | `caja.abrir` | `caja.abrir` · `caja.movimiento` |
| `POST /caja/cerrar` | `caja.cerrar` | `caja.cerrar` |

## 4. Cliente

- **Estadía**: cajón lateral que se abre desde el tablero, el plano o la reserva en curso. Muestra los huéspedes (y permite agregar acompañantes), los consumos por categoría, los cargos libres y la cuenta con el adelanto.
- **Check-out**: tipo de comprobante y botones «Todo en efectivo/Yape/…». Permite dividir el pago y muestra lo recibido y el vuelto. Al confirmar sale el ticket de 80 mm imprimible.
- **Reservas**: varias habitaciones con sus personas; adelanto con método de pago; check-in por habitación con acompañantes.
- **Caja**: abrir, efectivo esperado y saldo por método, movimientos del turno, comprobantes de hoy, gastos y retiros, y cierre con faltante o sobrante.
- **Demostración web**: recorrido guiado de 7 pasos que se marcan solos: abrir caja → reserva familiar → check-in → consumo → check-out → limpieza → cierre.

## 5. Pruebas

- Unitarias: `cobro.spec.ts` (IGV, vuelto, pago dividido, comisión, monto en letras).
- Integración: `checkout.e2e-spec.ts`:
  - familia en dos habitaciones: adelanto con Yape, acompañantes, consumos, saldo insuficiente, factura sin RUC, boleta con vuelto, comprobante y caja;
  - huésped sin reserva por 6 horas con nota interna;
  - cierre de caja con diferencia.
