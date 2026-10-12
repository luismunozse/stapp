-- ============================================================================
-- 326: permiso para que los VENDEDORES vean los ingresos del taller
-- ============================================================================
-- Preferencia por organizacion, como la 275, 314, 320 y 322. Pero al reves que
-- todas ellas, y conviene entender por que antes de copiar el patron:
--
--   DEFAULT true, NO false.
--
-- Las otras cuatro AGREGAN una capacidad que nadie tenia: nacen apagadas y el
-- taller las prende si quiere. Esta QUITA una que todos tienen hoy. Nacer
-- apagada le cambiaria la pantalla de reportes a las 223 organizaciones
-- activas de un dia para el otro, sin que ninguna lo haya pedido. El unico
-- taller que lo pidio la apaga; el resto no se entera.
--
-- Que queda detras del permiso, cuando se apaga:
--
--   GET /api/reportes/ingresos
--   GET /api/reportes/ingresos-unificados
--   GET /api/reportes/comparativa-ingresos
--   GET /api/reportes/resumen-ingresos
--   GET /api/reportes/top-clientes          (cuanto gasto cada cliente)
--
-- Que NO queda detras, a proposito: `performance-tecnicos` y `tasa-retorno`
-- tambien mencionan ingresos, pero son reportes operativos —que produce cada
-- tecnico, cuantos equipos vuelven— que el vendedor necesita para atender al
-- cliente. Cortarlos seria cobrar el permiso mas caro de lo que se pidio.
--
-- Tampoco toca los COSTOS, que ya estaban cerrados y siguen igual: `rentabilidad`,
-- `analisis-inventario`, `inventario-analytics`, `prediccion-repuestos` y
-- `ventas-analytics` filtran `precio_compra` y `margen` por `canViewCost`. La
-- linea que este flag agrega es la otra: cuanto ENTRA, no cuanto cuesta.
--
-- El ADMIN no depende del flag, nunca. El TECNICO tampoco: el middleware no lo
-- deja entrar a /reportes.
-- ============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS vendedores_ven_ingresos BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN organizations.vendedores_ven_ingresos IS
  'Si false, los usuarios con rol VENDEDOR no ven los reportes de ingresos del taller (ingresos, ingresos-unificados, comparativa-ingresos, resumen-ingresos, top-clientes). Default TRUE —al reves que los demas permisos opt-in— porque hoy ya los ven: este flag quita algo existente en vez de agregar algo nuevo. No afecta a los reportes operativos ni al gating de costos por canViewCost, que es independiente.';
