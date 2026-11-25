# S-07 — Series, correlativo, estructura del comprobante, totales y descuento global

| | |
|---|---|
| Sprint | S-07 (F3) del DT-001, semanas 13–14 |
| Fecha | 2026-11-25 |
| Estado | Implementado en la rama `s07-comprobantes` (sobre `s07-integracion`, PR #6) |
| Requerimientos | RF-FAC-01 series · RF-FAC-02 series por usuario · RF-FAC-03 factura · RF-FAC-04 boleta identificada · RF-FAC-07 correlativo · RF-FAC-08 descuento global |
| Resultado verificable (DT-001 §7.2) | Se numeran comprobantes sin saltos con varias cajas simultáneas |

## Punto de partida

El PR #5 ya emite boleta, factura y nota interna al hacer el check-out: correlativo con `sp_siguiente_correlativo` en la misma transacción, IGV desglosado por línea, factura solo a un RUC, pago mixto con vuelto y ticket. Falta lo que este spec cubre. El envío a SUNAT es del S-08.

## Decisiones

| # | Decisión | Motivo |
|---|---|---|
| D1 | Formato de serie según SUNAT: factura `F` + 3, boleta `B` + 3, nota de crédito o débito `F` o `B` + 3 (según el documento que corrige), interno `I` + 3. Siempre 4 caracteres en mayúsculas | Una serie con otro prefijo la rechaza SUNAT |
| D2 | Una serie nueva puede empezar en un número dado (`correlativoInicial`), para continuar la numeración de un sistema anterior. Después solo se activa o desactiva | Cambiar la serie o el número de una serie con comprobantes los dejaría con saltos o duplicados |
| D3 | No se desactiva la última serie activa de factura, boleta o interno de la sucursal | Sin ella no se puede cobrar |
| D4 | Elección de la serie al emitir: primero una serie del tipo asignada al usuario; si no tiene, una serie libre (sin usuarios asignados); si no hay ninguna, 409 | Así cada caja tiene su numeración (RF-FAC-02) y quien no tiene una propia usa las compartidas |
| D5 | Las asignaciones del seed (todas las series al administrador) eran provisionales: la migración las borra para que las series de ejemplo queden compartidas | Con D4 habrían dejado a recepción sin series |
| D6 | Descuento global en soles o en porcentaje del total, con motivo (5 a 250) y el permiso `descuento.aplicar`. Afecta la base imponible (catálogo 53, código 02): del descuento con IGV se separa la base y el IGV, y se restan de los totales sin tocar las líneas | RF-FAC-08: «no prorrateado por línea» |
| D7 | El descuento no puede dejar el total por debajo del adelanto ya cobrado | Habría que devolver dinero, y eso es una nota de crédito |
| D8 | Boleta de más de S/ 700 exige receptor identificado (no «sin documento») | Umbral vigente de SUNAT para boletas (RF-FAC-04) |
| D9 | La boleta puede salir a nombre de otra persona (no solo del titular); la factura, a una empresa con RUC | Paga un familiar o un tercero |
| D10 | `armarComprobante` convierte un comprobante guardado a la estructura del puerto `ProveedorFacturacion` y verifica que cuadre (suma de líneas − descuento = total, IGV, prefijo de serie, receptor). `GET /comprobantes/:id/estructura` la muestra | Deja lista la entrada del S-08 y prueba la estructura desde ya |

## Base de datos

Migración `20261125100000_series_y_descuento` (con `down.sql`):
- Borra las asignaciones provisionales de `usuario_serie` (D5).
- Agrega `comprobante.descuento_motivo VARCHAR(250)` y `comprobante.descuento_igv DECIMAL(14,2)` (el descuento con IGV es `descuento_global + descuento_igv`).

## API

| Método y ruta | Permiso | Auditoría |
|---|---|---|
| `GET /facturacion/series` (de la sucursal, con usuarios asignados) | `config.empresa` | — |
| `GET /facturacion/series/usuarios` (usuarios con acceso a la sucursal) | `config.empresa` | — |
| `POST /facturacion/series` `{ tipo, serie, correlativoInicial? }` | `config.empresa` | `serie.crear` |
| `PATCH /facturacion/series/:id` `{ activo }` | `config.empresa` | `serie.editar` |
| `PUT /facturacion/series/:id/usuarios` `{ usuarioIds }` | `config.empresa` | `serie.asignar` |
| `GET /facturacion/series/para-emitir?tipo=` (la que usaría el usuario) | `estancia.checkout` o `comprobante.emitir` | — |
| `POST /estancias/:id/checkout` agrega `serieId?`, `clienteId?` (también para boleta) y `descuento?: { tipo: MONTO\|PORCENTAJE, valor, motivo }` | igual; el descuento exige `descuento.aplicar` | `estancia.checkout` |
| `GET /comprobantes/:id/estructura` | sesión | — |

## Pantallas

- **Series de comprobantes** (menú Configuración, permiso `config.empresa`): tabla por tipo con último número, estado y usuarios; panel para crear, activar o desactivar y asignar usuarios.
- **Check-out:** muestra la serie que se usará, permite emitir la boleta a nombre de otra persona y, con `descuento.aplicar`, agregar un descuento en soles o % con motivo; la cuenta se recalcula.
- **Ticket:** línea de descuento global.

## Pruebas

- Unitarias: formato de serie por tipo; elección de serie; descuento (monto, porcentaje, desglose de IGV, tope por adelanto); boleta identificada; `armarComprobante` cuadra con y sin descuento.
- Integración: crear series válidas e inválidas, duplicada 409, última activa 409, asignación y elección (usuario con serie propia, sin serie usa la libre, sin ninguna 409); check-out con descuento (totales y motivo), sin permiso 403, descuento por debajo del adelanto 400; boleta mayor a S/ 700 sin documento 400; **20 emisiones simultáneas en la misma serie sin saltos ni duplicados**; estructura del comprobante.
