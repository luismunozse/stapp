-- ========================================
-- Migracion 351: cerrar a service_role los RPCs que mueven stock
-- ========================================
--
-- Problema: estas funciones son SECURITY INVOKER y en produccion tienen EXECUTE
-- para PUBLIC, anon y authenticated (177_kits_bom.sql:721-726 hasta le otorga
-- EXECUTE a authenticated explicitamente, por eso hay que revocar los tres roles).
-- Con la anon key publica cualquiera puede llamar /rest/v1/rpc/<funcion>; lo unico
-- que lo frena hoy es RLS sobre las tablas, no el permiso de ejecucion.
--
-- Verificado: todo caller de aplicacion llama estos RPCs con supabaseAdmin
-- (service_role). liberar_reserva_catalogo y crear_reparaciones_express son
-- SECURITY DEFINER y los invocan como owner, asi que no dependen de estos grants.
--
-- Mismo patron que 349_reparaciones_express.sql: REVOKE de PUBLIC, anon y
-- authenticated, y GRANT a service_role. Firmas exactas de produccion
-- (pg_get_function_identity_arguments). Solo cambia permisos: no toca cuerpos ni
-- datos. No empieza con BEGIN (db-run.mjs).
--
-- Orden: aplicar despues de la 350 (la 350 ya trata igual a su funcion nueva).
-- Rollback: rollback/351_rollback.sql devuelve EXECUTE a PUBLIC, anon y
-- authenticated, el estado previo.
-- ========================================

REVOKE EXECUTE ON FUNCTION adjust_stock_atomic(p_inventario_id text, p_organization_id text, p_user_id text, p_mode text, p_value integer, p_motivo text, p_tipo text, p_referencia_tipo text, p_deposito_id text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION adjust_stock_atomic(p_inventario_id text, p_organization_id text, p_user_id text, p_mode text, p_value integer, p_motivo text, p_tipo text, p_referencia_tipo text, p_deposito_id text) FROM anon;
REVOKE EXECUTE ON FUNCTION adjust_stock_atomic(p_inventario_id text, p_organization_id text, p_user_id text, p_mode text, p_value integer, p_motivo text, p_tipo text, p_referencia_tipo text, p_deposito_id text) FROM authenticated;
GRANT EXECUTE ON FUNCTION adjust_stock_atomic(p_inventario_id text, p_organization_id text, p_user_id text, p_mode text, p_value integer, p_motivo text, p_tipo text, p_referencia_tipo text, p_deposito_id text) TO service_role;

REVOKE EXECUTE ON FUNCTION aplicar_ajuste_inventario(p_inventario_id text, p_tipo text, p_direccion text, p_cantidad integer, p_motivo text, p_comprobante_url text, p_afecta_rentabilidad boolean, p_user_id text, p_deposito_id text, p_sucursal_id text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION aplicar_ajuste_inventario(p_inventario_id text, p_tipo text, p_direccion text, p_cantidad integer, p_motivo text, p_comprobante_url text, p_afecta_rentabilidad boolean, p_user_id text, p_deposito_id text, p_sucursal_id text) FROM anon;
REVOKE EXECUTE ON FUNCTION aplicar_ajuste_inventario(p_inventario_id text, p_tipo text, p_direccion text, p_cantidad integer, p_motivo text, p_comprobante_url text, p_afecta_rentabilidad boolean, p_user_id text, p_deposito_id text, p_sucursal_id text) FROM authenticated;
GRANT EXECUTE ON FUNCTION aplicar_ajuste_inventario(p_inventario_id text, p_tipo text, p_direccion text, p_cantidad integer, p_motivo text, p_comprobante_url text, p_afecta_rentabilidad boolean, p_user_id text, p_deposito_id text, p_sucursal_id text) TO service_role;

REVOKE EXECUTE ON FUNCTION asegurar_fila_deposito(p_inventario_id text, p_deposito_id text, p_org_id text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION asegurar_fila_deposito(p_inventario_id text, p_deposito_id text, p_org_id text) FROM anon;
REVOKE EXECUTE ON FUNCTION asegurar_fila_deposito(p_inventario_id text, p_deposito_id text, p_org_id text) FROM authenticated;
GRANT EXECUTE ON FUNCTION asegurar_fila_deposito(p_inventario_id text, p_deposito_id text, p_org_id text) TO service_role;

REVOKE EXECUTE ON FUNCTION consolidate_inventario_items(p_source_id text, p_target_id text, p_user_id text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION consolidate_inventario_items(p_source_id text, p_target_id text, p_user_id text) FROM anon;
REVOKE EXECUTE ON FUNCTION consolidate_inventario_items(p_source_id text, p_target_id text, p_user_id text) FROM authenticated;
GRANT EXECUTE ON FUNCTION consolidate_inventario_items(p_source_id text, p_target_id text, p_user_id text) TO service_role;

REVOKE EXECUTE ON FUNCTION crear_nota_credito(p_org_id text, p_venta_id text, p_orden_id text, p_motivo text, p_monto numeric, p_metodo_devolucion text, p_notas text, p_user_id text, p_items jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION crear_nota_credito(p_org_id text, p_venta_id text, p_orden_id text, p_motivo text, p_monto numeric, p_metodo_devolucion text, p_notas text, p_user_id text, p_items jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION crear_nota_credito(p_org_id text, p_venta_id text, p_orden_id text, p_motivo text, p_monto numeric, p_metodo_devolucion text, p_notas text, p_user_id text, p_items jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION crear_nota_credito(p_org_id text, p_venta_id text, p_orden_id text, p_motivo text, p_monto numeric, p_metodo_devolucion text, p_notas text, p_user_id text, p_items jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION crear_venta_atomica(p_org_id text, p_vendedor_id text, p_cliente_id text, p_cliente_nombre text, p_cliente_telefono text, p_subtotal numeric, p_descuento numeric, p_tipo_descuento text, p_porcentaje_descuento numeric, p_total numeric, p_metodo_pago text, p_observaciones text, p_numero_referencia text, p_cuotas integer, p_recargo_porcentaje numeric, p_monto_original numeric, p_items jsonb, p_pagos jsonb, p_idempotency_key text, p_deposito_id text, p_sucursal_id text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION crear_venta_atomica(p_org_id text, p_vendedor_id text, p_cliente_id text, p_cliente_nombre text, p_cliente_telefono text, p_subtotal numeric, p_descuento numeric, p_tipo_descuento text, p_porcentaje_descuento numeric, p_total numeric, p_metodo_pago text, p_observaciones text, p_numero_referencia text, p_cuotas integer, p_recargo_porcentaje numeric, p_monto_original numeric, p_items jsonb, p_pagos jsonb, p_idempotency_key text, p_deposito_id text, p_sucursal_id text) FROM anon;
REVOKE EXECUTE ON FUNCTION crear_venta_atomica(p_org_id text, p_vendedor_id text, p_cliente_id text, p_cliente_nombre text, p_cliente_telefono text, p_subtotal numeric, p_descuento numeric, p_tipo_descuento text, p_porcentaje_descuento numeric, p_total numeric, p_metodo_pago text, p_observaciones text, p_numero_referencia text, p_cuotas integer, p_recargo_porcentaje numeric, p_monto_original numeric, p_items jsonb, p_pagos jsonb, p_idempotency_key text, p_deposito_id text, p_sucursal_id text) FROM authenticated;
GRANT EXECUTE ON FUNCTION crear_venta_atomica(p_org_id text, p_vendedor_id text, p_cliente_id text, p_cliente_nombre text, p_cliente_telefono text, p_subtotal numeric, p_descuento numeric, p_tipo_descuento text, p_porcentaje_descuento numeric, p_total numeric, p_metodo_pago text, p_observaciones text, p_numero_referencia text, p_cuotas integer, p_recargo_porcentaje numeric, p_monto_original numeric, p_items jsonb, p_pagos jsonb, p_idempotency_key text, p_deposito_id text, p_sucursal_id text) TO service_role;

REVOKE EXECUTE ON FUNCTION descontar_stock_deposito(p_inventario_id text, p_org_id text, p_deposito_id text, p_cantidad integer, p_strict boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION descontar_stock_deposito(p_inventario_id text, p_org_id text, p_deposito_id text, p_cantidad integer, p_strict boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION descontar_stock_deposito(p_inventario_id text, p_org_id text, p_deposito_id text, p_cantidad integer, p_strict boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION descontar_stock_deposito(p_inventario_id text, p_org_id text, p_deposito_id text, p_cantidad integer, p_strict boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION desensamblar_kit_atomic(p_kit_id text, p_cantidad integer, p_org_id text, p_user_id text, p_deposito_id text, p_motivo text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION desensamblar_kit_atomic(p_kit_id text, p_cantidad integer, p_org_id text, p_user_id text, p_deposito_id text, p_motivo text) FROM anon;
REVOKE EXECUTE ON FUNCTION desensamblar_kit_atomic(p_kit_id text, p_cantidad integer, p_org_id text, p_user_id text, p_deposito_id text, p_motivo text) FROM authenticated;
GRANT EXECUTE ON FUNCTION desensamblar_kit_atomic(p_kit_id text, p_cantidad integer, p_org_id text, p_user_id text, p_deposito_id text, p_motivo text) TO service_role;

REVOKE EXECUTE ON FUNCTION editar_venta_atomica(p_org_id text, p_user_id text, p_venta_id text, p_cliente_id text, p_cliente_nombre text, p_cliente_telefono text, p_subtotal numeric, p_descuento numeric, p_tipo_descuento text, p_porcentaje_descuento numeric, p_total numeric, p_metodo_pago text, p_observaciones text, p_items jsonb, p_deposito_id text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION editar_venta_atomica(p_org_id text, p_user_id text, p_venta_id text, p_cliente_id text, p_cliente_nombre text, p_cliente_telefono text, p_subtotal numeric, p_descuento numeric, p_tipo_descuento text, p_porcentaje_descuento numeric, p_total numeric, p_metodo_pago text, p_observaciones text, p_items jsonb, p_deposito_id text) FROM anon;
REVOKE EXECUTE ON FUNCTION editar_venta_atomica(p_org_id text, p_user_id text, p_venta_id text, p_cliente_id text, p_cliente_nombre text, p_cliente_telefono text, p_subtotal numeric, p_descuento numeric, p_tipo_descuento text, p_porcentaje_descuento numeric, p_total numeric, p_metodo_pago text, p_observaciones text, p_items jsonb, p_deposito_id text) FROM authenticated;
GRANT EXECUTE ON FUNCTION editar_venta_atomica(p_org_id text, p_user_id text, p_venta_id text, p_cliente_id text, p_cliente_nombre text, p_cliente_telefono text, p_subtotal numeric, p_descuento numeric, p_tipo_descuento text, p_porcentaje_descuento numeric, p_total numeric, p_metodo_pago text, p_observaciones text, p_items jsonb, p_deposito_id text) TO service_role;

REVOKE EXECUTE ON FUNCTION ensamblar_kit_atomic(p_kit_id text, p_cantidad_a_ensamblar integer, p_org_id text, p_user_id text, p_deposito_id text, p_motivo text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION ensamblar_kit_atomic(p_kit_id text, p_cantidad_a_ensamblar integer, p_org_id text, p_user_id text, p_deposito_id text, p_motivo text) FROM anon;
REVOKE EXECUTE ON FUNCTION ensamblar_kit_atomic(p_kit_id text, p_cantidad_a_ensamblar integer, p_org_id text, p_user_id text, p_deposito_id text, p_motivo text) FROM authenticated;
GRANT EXECUTE ON FUNCTION ensamblar_kit_atomic(p_kit_id text, p_cantidad_a_ensamblar integer, p_org_id text, p_user_id text, p_deposito_id text, p_motivo text) TO service_role;

REVOKE EXECUTE ON FUNCTION finalizar_conteo(p_conteo_id text, p_user_id text, p_forzar boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION finalizar_conteo(p_conteo_id text, p_user_id text, p_forzar boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION finalizar_conteo(p_conteo_id text, p_user_id text, p_forzar boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION finalizar_conteo(p_conteo_id text, p_user_id text, p_forzar boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION get_deposito_principal(p_org_id text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_deposito_principal(p_org_id text) FROM anon;
REVOKE EXECUTE ON FUNCTION get_deposito_principal(p_org_id text) FROM authenticated;
GRANT EXECUTE ON FUNCTION get_deposito_principal(p_org_id text) TO service_role;

REVOKE EXECUTE ON FUNCTION incrementar_stock_deposito(p_inventario_id text, p_org_id text, p_deposito_id text, p_cantidad integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION incrementar_stock_deposito(p_inventario_id text, p_org_id text, p_deposito_id text, p_cantidad integer) FROM anon;
REVOKE EXECUTE ON FUNCTION incrementar_stock_deposito(p_inventario_id text, p_org_id text, p_deposito_id text, p_cantidad integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION incrementar_stock_deposito(p_inventario_id text, p_org_id text, p_deposito_id text, p_cantidad integer) TO service_role;

REVOKE EXECUTE ON FUNCTION iniciar_conteo(p_organization_id text, p_user_id text, p_nombre text, p_deposito_id text, p_tipo text, p_filtros jsonb, p_tolerancia_pct numeric, p_aplicar_ajustes boolean, p_notas text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION iniciar_conteo(p_organization_id text, p_user_id text, p_nombre text, p_deposito_id text, p_tipo text, p_filtros jsonb, p_tolerancia_pct numeric, p_aplicar_ajustes boolean, p_notas text) FROM anon;
REVOKE EXECUTE ON FUNCTION iniciar_conteo(p_organization_id text, p_user_id text, p_nombre text, p_deposito_id text, p_tipo text, p_filtros jsonb, p_tolerancia_pct numeric, p_aplicar_ajustes boolean, p_notas text) FROM authenticated;
GRANT EXECUTE ON FUNCTION iniciar_conteo(p_organization_id text, p_user_id text, p_nombre text, p_deposito_id text, p_tipo text, p_filtros jsonb, p_tolerancia_pct numeric, p_aplicar_ajustes boolean, p_notas text) TO service_role;

REVOKE EXECUTE ON FUNCTION liberar_reserva_deposito(p_inventario_id text, p_org_id text, p_deposito_id text, p_cantidad integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION liberar_reserva_deposito(p_inventario_id text, p_org_id text, p_deposito_id text, p_cantidad integer) FROM anon;
REVOKE EXECUTE ON FUNCTION liberar_reserva_deposito(p_inventario_id text, p_org_id text, p_deposito_id text, p_cantidad integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION liberar_reserva_deposito(p_inventario_id text, p_org_id text, p_deposito_id text, p_cantidad integer) TO service_role;

REVOKE EXECUTE ON FUNCTION recibir_orden_compra(p_oc_id text, p_user_id text, p_items jsonb, p_organization_id text, p_request_id text, p_deposito_id text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION recibir_orden_compra(p_oc_id text, p_user_id text, p_items jsonb, p_organization_id text, p_request_id text, p_deposito_id text) FROM anon;
REVOKE EXECUTE ON FUNCTION recibir_orden_compra(p_oc_id text, p_user_id text, p_items jsonb, p_organization_id text, p_request_id text, p_deposito_id text) FROM authenticated;
GRANT EXECUTE ON FUNCTION recibir_orden_compra(p_oc_id text, p_user_id text, p_items jsonb, p_organization_id text, p_request_id text, p_deposito_id text) TO service_role;

REVOKE EXECUTE ON FUNCTION registrar_devolucion_atomica(p_org_id text, p_venta_id text, p_user_id text, p_numero_devolucion text, p_motivo text, p_observaciones text, p_metodo_reembolso text, p_reembolso_referencia text, p_items jsonb, p_idempotency_key text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION registrar_devolucion_atomica(p_org_id text, p_venta_id text, p_user_id text, p_numero_devolucion text, p_motivo text, p_observaciones text, p_metodo_reembolso text, p_reembolso_referencia text, p_items jsonb, p_idempotency_key text) FROM anon;
REVOKE EXECUTE ON FUNCTION registrar_devolucion_atomica(p_org_id text, p_venta_id text, p_user_id text, p_numero_devolucion text, p_motivo text, p_observaciones text, p_metodo_reembolso text, p_reembolso_referencia text, p_items jsonb, p_idempotency_key text) FROM authenticated;
GRANT EXECUTE ON FUNCTION registrar_devolucion_atomica(p_org_id text, p_venta_id text, p_user_id text, p_numero_devolucion text, p_motivo text, p_observaciones text, p_metodo_reembolso text, p_reembolso_referencia text, p_items jsonb, p_idempotency_key text) TO service_role;

REVOKE EXECUTE ON FUNCTION registrar_entrada_lote(p_organization_id text, p_user_id text, p_inventario_id text, p_numero_lote text, p_cantidad integer, p_costo_unitario numeric, p_fecha_vencimiento date, p_proveedor_id text, p_orden_compra_id text, p_deposito_id text, p_notas text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION registrar_entrada_lote(p_organization_id text, p_user_id text, p_inventario_id text, p_numero_lote text, p_cantidad integer, p_costo_unitario numeric, p_fecha_vencimiento date, p_proveedor_id text, p_orden_compra_id text, p_deposito_id text, p_notas text) FROM anon;
REVOKE EXECUTE ON FUNCTION registrar_entrada_lote(p_organization_id text, p_user_id text, p_inventario_id text, p_numero_lote text, p_cantidad integer, p_costo_unitario numeric, p_fecha_vencimiento date, p_proveedor_id text, p_orden_compra_id text, p_deposito_id text, p_notas text) FROM authenticated;
GRANT EXECUTE ON FUNCTION registrar_entrada_lote(p_organization_id text, p_user_id text, p_inventario_id text, p_numero_lote text, p_cantidad integer, p_costo_unitario numeric, p_fecha_vencimiento date, p_proveedor_id text, p_orden_compra_id text, p_deposito_id text, p_notas text) TO service_role;

REVOKE EXECUTE ON FUNCTION registrar_entrada_series(p_organization_id text, p_user_id text, p_inventario_id text, p_numeros_serie text[], p_lote_id text, p_costo_unitario numeric, p_deposito_id text, p_garantia_dias integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION registrar_entrada_series(p_organization_id text, p_user_id text, p_inventario_id text, p_numeros_serie text[], p_lote_id text, p_costo_unitario numeric, p_deposito_id text, p_garantia_dias integer) FROM anon;
REVOKE EXECUTE ON FUNCTION registrar_entrada_series(p_organization_id text, p_user_id text, p_inventario_id text, p_numeros_serie text[], p_lote_id text, p_costo_unitario numeric, p_deposito_id text, p_garantia_dias integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION registrar_entrada_series(p_organization_id text, p_user_id text, p_inventario_id text, p_numeros_serie text[], p_lote_id text, p_costo_unitario numeric, p_deposito_id text, p_garantia_dias integer) TO service_role;

REVOKE EXECUTE ON FUNCTION reservar_stock_deposito(p_inventario_id text, p_org_id text, p_deposito_id text, p_cantidad integer, p_strict boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reservar_stock_deposito(p_inventario_id text, p_org_id text, p_deposito_id text, p_cantidad integer, p_strict boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION reservar_stock_deposito(p_inventario_id text, p_org_id text, p_deposito_id text, p_cantidad integer, p_strict boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION reservar_stock_deposito(p_inventario_id text, p_org_id text, p_deposito_id text, p_cantidad integer, p_strict boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION salida_serie(p_organization_id text, p_user_id text, p_inventario_id text, p_serie_id text, p_venta_id text, p_cliente_id text, p_motivo text, p_tipo text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION salida_serie(p_organization_id text, p_user_id text, p_inventario_id text, p_serie_id text, p_venta_id text, p_cliente_id text, p_motivo text, p_tipo text) FROM anon;
REVOKE EXECUTE ON FUNCTION salida_serie(p_organization_id text, p_user_id text, p_inventario_id text, p_serie_id text, p_venta_id text, p_cliente_id text, p_motivo text, p_tipo text) FROM authenticated;
GRANT EXECUTE ON FUNCTION salida_serie(p_organization_id text, p_user_id text, p_inventario_id text, p_serie_id text, p_venta_id text, p_cliente_id text, p_motivo text, p_tipo text) TO service_role;

REVOKE EXECUTE ON FUNCTION seed_deposito_inicial() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION seed_deposito_inicial() FROM anon;
REVOKE EXECUTE ON FUNCTION seed_deposito_inicial() FROM authenticated;
GRANT EXECUTE ON FUNCTION seed_deposito_inicial() TO service_role;

REVOKE EXECUTE ON FUNCTION transferir_stock_atomic(p_inventario_id text, p_organization_id text, p_user_id text, p_deposito_origen text, p_deposito_destino text, p_cantidad integer, p_motivo text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION transferir_stock_atomic(p_inventario_id text, p_organization_id text, p_user_id text, p_deposito_origen text, p_deposito_destino text, p_cantidad integer, p_motivo text) FROM anon;
REVOKE EXECUTE ON FUNCTION transferir_stock_atomic(p_inventario_id text, p_organization_id text, p_user_id text, p_deposito_origen text, p_deposito_destino text, p_cantidad integer, p_motivo text) FROM authenticated;
GRANT EXECUTE ON FUNCTION transferir_stock_atomic(p_inventario_id text, p_organization_id text, p_user_id text, p_deposito_origen text, p_deposito_destino text, p_cantidad integer, p_motivo text) TO service_role;
