-- Agrega sectores_texto a v_clientes_resumen para poder buscar clientes empresa
-- por el nombre de sus sectores internos (areas/contactos), no solo por
-- nombre/telefono/dni/email. Es un agregado de los sectores activos por cliente.
CREATE OR REPLACE VIEW v_clientes_resumen AS
SELECT
  c.*,
  COALESCE(agg.ordenes_count, 0)   AS ordenes_count,
  agg.ultima_visita                AS ultima_visita,
  COALESCE(agg.deuda_pendiente, 0) AS deuda_pendiente,
  sec.sectores_texto               AS sectores_texto
FROM clientes c
LEFT JOIN (
  SELECT
    cliente_id,
    COUNT(*)            AS ordenes_count,
    MAX(fecha_ingreso)  AS ultima_visita,
    SUM(
      CASE WHEN estado_cobro IN ('PENDIENTE','PARCIAL')
        THEN GREATEST(
          COALESCE(costo_final, 0)
          - COALESCE(descuento_cobro, 0)
          - COALESCE(total_cobrado, 0), 0)
        ELSE 0 END
    ) AS deuda_pendiente
  FROM ordenes_servicio
  GROUP BY cliente_id
) agg ON agg.cliente_id = c.id
LEFT JOIN (
  SELECT cliente_id, string_agg(nombre, ' ') AS sectores_texto
  FROM sectores_cliente
  WHERE activo = true
  GROUP BY cliente_id
) sec ON sec.cliente_id = c.id;
