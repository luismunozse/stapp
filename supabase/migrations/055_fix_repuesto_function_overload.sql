-- Fix: eliminar funciones duplicadas con tipo UUID que causan error PGRST203
-- "Could not choose the best candidate function between overloads"
-- Las versiones TEXT (de migración 053) son las correctas

DROP FUNCTION IF EXISTS add_repuesto_inventario(UUID, UUID, INTEGER);
DROP FUNCTION IF EXISTS remove_repuesto_inventario(UUID);
