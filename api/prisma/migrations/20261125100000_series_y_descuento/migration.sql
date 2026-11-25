-- S-07: series por usuario y descuento global del comprobante
-- Spec: docs/superpowers/specs/2026-11-25-s07-comprobantes-design.md

-- Las asignaciones de series que cargaba el seed (todas al administrador) eran provisionales. Desde S-07 una serie
-- asignada es exclusiva de sus usuarios (D4), así que se quitan para que las series existentes queden compartidas.
DELETE FROM usuario_serie;

-- Descuento global (RF-FAC-08): `descuento_global` es la base descontada; el IGV descontado y el motivo van aparte
ALTER TABLE comprobante
  ADD COLUMN descuento_igv DECIMAL(14,2) NOT NULL DEFAULT 0.00
    COMMENT 'IGV del descuento global; descuento con IGV = descuento_global + descuento_igv' AFTER descuento_global,
  ADD COLUMN descuento_motivo VARCHAR(250) NULL AFTER descuento_igv,
  ADD CONSTRAINT ck_comp_descuento CHECK (descuento_global >= 0 AND descuento_igv >= 0);
