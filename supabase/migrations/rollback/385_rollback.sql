-- Rollback de 385 (verificación de la delegación ARCA).
--
-- Las filas que quedaron en 'pendiente_verificacion' no entran en el CHECK
-- anterior: se pasan a 'error' (la ruta las muestra como no conectadas y el
-- taller puede volver a guardar). NO se pasan a 'conectado', porque eso
-- habilitaría a facturar CUITs sin verificar.
--
-- Revertir también el código (resolverCredenciales / canEmitir / ruta de
-- credenciales): con este rollback y el código nuevo, ninguna delegación
-- pendiente vuelve a quedar habilitada sola.

SET LOCAL lock_timeout = '3s';

UPDATE facturacion_credenciales
   SET estado = 'error', updated_at = NOW()
 WHERE estado = 'pendiente_verificacion';

DROP INDEX IF EXISTS facturacion_credenciales_cuit_delegado_uniq;

ALTER TABLE facturacion_credenciales DROP CONSTRAINT IF EXISTS facturacion_credenciales_estado_check;
ALTER TABLE facturacion_credenciales ADD CONSTRAINT facturacion_credenciales_estado_check
  CHECK (estado IN ('conectado', 'error', 'cert_vencido', 'sin_configurar'));
