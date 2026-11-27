# Operación real del hotel: estadías cortas con pago adelantado

| | |
|---|---|
| Fecha | 2026-11-26 |
| Estado | Implementado en la rama `operacion-real` (sobre `s07-comprobantes`) |
| Origen | Plano del local (2 niveles) e información del cuartelero, enviada por lnunezfue el 26/11 |
| Requerimientos | RF-RES-04 (estados y limpieza), RF-RES-08 (turnos), RF-RES-12/13 (salida y extensión), RF-CAJ (cobro) |

## 1. Lo que dijo el hotel

- Es un hotel para parejas: casi nadie toma 24 h; **la estadía promedio es de 4 horas**.
- Cuando se paga la noche o «turno completo» (sin pedir horas), **sale a las 9:00** del día siguiente.
- Hora máxima de salida según la hora del check-in:
  - check-in en la **tarde o noche** → hasta las **6:00 del día siguiente**;
  - check-in de **madrugada** → hasta las **12:00 del mismo día**;
  - check-in en la **mañana** → hasta las **18:00 del mismo día**.
- **El pago es adelantado**, en **efectivo y con Culqi**.
- **No venden nada a las habitaciones.**
- Toman reservas **sin adelanto**, y no todas se usan.
- La limpieza de una habitación toma **30 minutos**.
- Tiene **2 niveles**: todas las habitaciones son matrimoniales menos una doble (n − 1 matrimoniales y 1 doble).

## 2. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| D1 | La operación se configura **por sucursal** (`sucursal_operacion`, `sucursal_franja_salida`) en *Hotel y tarifas → Operación*. Sin fila, la sucursal sigue las reglas de siempre (salida 12:00, sin topes, cobro al salir) | Las reglas son de este local; otro local de la empresa puede trabajar distinto. Las pruebas y el hostal siguen igual |
| D2 | La **noche o turno completo** (turno de 24 h) sale a la `hora_salida_noche` (9:00) del día siguiente. Si entra de madrugada con al menos 3 h por delante, sale ese mismo día a las 9:00 | Es lo que dijo el dueño («ocupa hasta el día siguiente, hasta las 9 am»). Quien entra a las 2:00 no se queda hasta el otro día |
| D3 | **Por horas**: sale al check-in + las horas compradas. Si eso pasa la hora máxima de la franja de ingreso, **se rechaza** y se dice cuántos turnos caben (o que venda la noche) | No se venden horas que no se pueden usar. *Interpretación*: la hora máxima de la franja aplica a las estadías por horas; la noche completa sale a las 9:00 (por eso la franja «tarde y noche» dice 6:00 y la noche dice 9:00). **A confirmar con el hotel** |
| D4 | La **extensión** por horas tampoco pasa la hora máxima de la franja en que entró | La misma regla, aplicada al quedarse más |
| D5 | **Cobro al ingreso**: el check-in directo pide comprobante y pago en el mismo paso (crea la estadía y llama a `POST /estancias/:id/cobro`). Una extensión o una salida tardía dejan un saldo que se cobra igual. El check-out con la cuenta pagada **no emite nada**: solo cierra y pasa a limpieza | Así trabaja el hotel. Si el cobro falla (p. ej. caja cerrada) el check-in queda hecho y se avisa para cobrar desde la habitación |
| D6 | La cuenta se **cobra en partes**: cada comprobante lleva solo lo pendiente. Los turnos cobrados salen del detalle del comprobante (unidad ZZ, sin anulados) y los cargos guardan `comprobante_id`. El adelanto de una reserva va en el primer comprobante | Un comprobante por pago, sin cobrar dos veces |
| D7 | **Culqi** es un método de pago más (`CULQI`), no se integra la pasarela | El cobro se hace en el POS/enlace de Culqi; el sistema registra el método y el n.º de operación |
| D8 | `vende_consumos = false` oculta la sección de consumos en la estadía (los cargos existentes se siguen viendo) | El hotel no vende a las habitaciones; menos ruido en recepción |
| D9 | El **tablero cuenta el tiempo en limpieza** desde el último cambio de estado (historial) y marca *Limpieza demorada* al pasar los `minutos_limpieza` (30) | Lo pidió el hotel; el historial ya guarda la hora de cada cambio |
| D10 | La **reserva** por noche usa la misma salida (9:00) y la por horas no pasa la hora máxima de la franja de llegada. Al hacer el check-in de una reserva, **el tiempo corre desde que llegan** (la salida se calcula desde ese momento y la reserva acompaña la nueva salida) | Llegan cuando pueden y no todas se usan; sin adelanto, la que no llega se marca «no se presentó» |
| D11 | **Turno de 4 horas** en el seed (promedio de estadía) y turno sugerido del check-in configurable | El check-in propone lo más común |
| D12 | Seed: *Hotel Centro* sigue el plano real, girado para la pantalla (la calle a la izquierda). 1er nivel: garaje, recepción y escalera, sala-comedor-cocineta, 5 dormitorios, SS.HH. y patio. 2do nivel: 9 dormitorios a ambos lados del pasillo, SS.HH. y escalera. 13 matrimoniales y 1 doble (105) | La demo muestra su propio local |

## 3. API

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/hospedaje/operacion` | Operación de la sucursal del token (`configurada: false` si no tiene) |
| PUT | `/hospedaje/operacion` | La guarda (permiso `operacion.configurar`, auditado `operacion.configurar`). Valida franjas: sin cruces, con salida posterior al final de la franja, hasta 8 |
| POST | `/estancias/:id/cobro` | Cobra lo pendiente sin cerrar (`estancia.checkin` o `estancia.checkout`, auditado `estancia.cobro`). 409 si no hay nada por cobrar |
| POST | `/estancias/:id/checkout` | Igual que antes; con la cuenta pagada no pide comprobante ni pagos y responde `comprobanteId: null` |
| GET | `/hospedaje/tablero` | Cada habitación trae `estadoDesde` y, en limpieza, `limpieza: { minutos, demorada, esperados }` |

La cuenta (`GET /estancias/:id`) agrega `pendientes`, `porCobrar`, `cobrado` y `comprobantes`; `saldo` es lo pendiente menos el adelanto no usado.

## 4. Base de datos

Migración `20261126000000_operacion_sucursal` (con `down.sql`, probada subir → bajar → subir):
- `sucursal_operacion` (cobro al ingreso, consumos, minutos de limpieza 5–240, hora de salida de la noche, turno sugerido).
- `sucursal_franja_salida` (nombre, desde, hasta —00:00 = medianoche—, salida máxima, día siguiente o no).
- `estancia_cargo.comprobante_id`.
- Método de pago `CULQI` y permiso `operacion.configurar` (ADMINISTRADOR).

## 5. Corrección incluida

El movimiento de caja de una venta guardaba el id del **comprobante** en `comprobante_pago_id` (FK a `comprobante_pago`). Ahora guarda el id del pago. La prueba de check-out que leía la columna con el id del comprobante se corrigió.

## 6. Pruebas

- Unitarias: `hospedaje/domain/operacion.spec.ts` (franjas, topes, noche, madrugada, limpieza, validación).
- Integración: `test/operacion.e2e-spec.ts` (7 casos: sin configurar, permisos y validación, noche a las 9:00, tope por franja, cobro al ingreso → extensión → check-out sin cobro con Culqi y vuelto, limpieza en el tablero, reservas por noche y por horas). Las demás suites corren con la operación del seed apartada (`test/operacion-legada.ts`, global setup y teardown).
- Cliente: `features/hospedaje/operacion.test.ts` (vista previa de la salida).
- Demo web: recorrido completo probado en el navegador (Playwright) en escritorio y móvil.

## 7. A confirmar con el hotel

1. Noche completa con salida a las 9:00 vs. la hora máxima de 6:00 de la franja «tarde y noche» (D3). Hoy: por horas, 6:00; noche, 9:00. Se cambia en *Operación* sin tocar código.
2. ¿Boleta siempre, o nota interna para algunos cobros? El check-in ofrece ambas.
3. Precios reales por turno (el seed usa precios de ejemplo: 4 h matrimonial S/ 48).
