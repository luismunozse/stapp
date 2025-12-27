-- ========================================
-- ACTUALIZAR ESTADOS DE ORDEN
-- ========================================
-- Nuevos estados más completos para cubrir todo el flujo

-- Paso 1: Eliminar el default actual
ALTER TABLE ordenes_servicio ALTER COLUMN estado DROP DEFAULT;

-- Paso 2: Crear nuevo enum con todos los estados
CREATE TYPE estado_orden_new AS ENUM (
  'RECIBIDO',           -- Equipo recién ingresado
  'EN_DIAGNOSTICO',     -- Técnico evaluando el problema
  'PRESUPUESTADO',      -- Presupuesto definido, esperando respuesta
  'APROBADO',           -- Cliente aprobó el presupuesto
  'EN_REPARACION',      -- Técnico trabajando
  'ESPERANDO_REPUESTO', -- Pausado por falta de repuesto
  'REPARADO',           -- Reparación completada
  'ENTREGADO',          -- Cliente retiró el equipo
  'CANCELADO',          -- Orden cancelada
  'SIN_REPARACION'      -- No se puede reparar o cliente rechazó
);

-- Paso 3: Actualizar la columna con mapeo de estados antiguos a nuevos
ALTER TABLE ordenes_servicio
  ALTER COLUMN estado TYPE estado_orden_new
  USING (
    CASE estado::text
      WHEN 'PENDIENTE' THEN 'RECIBIDO'::estado_orden_new
      WHEN 'EN_REPARACION' THEN 'EN_REPARACION'::estado_orden_new
      WHEN 'ESPERANDO_REPUESTO' THEN 'ESPERANDO_REPUESTO'::estado_orden_new
      WHEN 'COMPLETADO' THEN 'REPARADO'::estado_orden_new
      WHEN 'ENTREGADO' THEN 'ENTREGADO'::estado_orden_new
      WHEN 'CANCELADO' THEN 'CANCELADO'::estado_orden_new
      ELSE 'RECIBIDO'::estado_orden_new
    END
  );

-- Paso 4: Eliminar el enum antiguo y renombrar el nuevo
DROP TYPE estado_orden;
ALTER TYPE estado_orden_new RENAME TO estado_orden;

-- Paso 5: Establecer el nuevo default
ALTER TABLE ordenes_servicio ALTER COLUMN estado SET DEFAULT 'RECIBIDO';

-- Agregar comentarios para documentación
COMMENT ON TYPE estado_orden IS 'Estados del flujo de órdenes de servicio:
RECIBIDO: Equipo recién ingresado
EN_DIAGNOSTICO: Técnico evaluando el problema
PRESUPUESTADO: Esperando respuesta del cliente al presupuesto
APROBADO: Cliente aprobó, listo para reparar
EN_REPARACION: Técnico trabajando en la reparación
ESPERANDO_REPUESTO: Pausado hasta que llegue el repuesto
REPARADO: Reparación completada, pendiente de retiro
ENTREGADO: Cliente retiró el equipo
CANCELADO: Orden cancelada
SIN_REPARACION: No se puede reparar o cliente rechazó';
