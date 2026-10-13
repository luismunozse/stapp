-- ========================================
-- Rollback de la migracion 351
-- ========================================
-- Devuelve EXECUTE a PUBLIC, anon y authenticated (el estado previo en produccion:
-- la ACL tenia =X y los dos roles). service_role conserva el suyo. Sin BEGIN:
-- db-run.mjs lo rechaza en --apply.
-- ========================================

GRANT EXECUTE ON FUNCTION adjust_stock_atomic(p_inventario_id text, p_organization_id text, p_user_id text, p_mode text, p_value integer, p_motivo text, p_tipo text, p_referencia_tipo text, p_deposito_id text) TO PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION aplicar_ajuste_inventario(p_inventario_id text, p_tipo text, p_direccion text, p_cantidad integer, p_motivo text, p_comprobante_url text, p_afecta_rentabilidad boolean, p_user_id text, p_deposito_id text, p_sucursal_id text) TO PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION asegurar_fila_deposito(p_inventario_id text, p_deposito_id text, p_org_id text) TO PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION consolidate_inventario_items(p_source_id text, p_target_id text, p_user_id text) TO PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION crear_nota_credito(p_org_id text, p_venta_id text, p_orden_id text, p_motivo text, p_monto numeric, p_metodo_devolucion text, p_notas text, p_user_id text, p_items jsonb) TO PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION crear_venta_atomica(p_org_id text, p_vendedor_id text, p_cliente_id text, p_cliente_nombre text, p_cliente_telefono text, p_subtotal numeric, p_descuento numeric, p_tipo_descuento text, p_porcentaje_descuento numeric, p_total numeric, p_metodo_pago text, p_observaciones text, p_numero_referencia text, p_cuotas integer, p_recargo_porcentaje numeric, p_monto_original numeric, p_items jsonb, p_pagos jsonb, p_idempotency_key text, p_deposito_id text, p_sucursal_id text) TO PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION descontar_stock_deposito(p_inventario_id text, p_org_id text, p_deposito_id text, p_cantidad integer, p_strict boolean) TO PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION desensamblar_kit_atomic(p_kit_id text, p_cantidad integer, p_org_id text, p_user_id text, p_deposito_id text, p_motivo text) TO PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION editar_venta_atomica(p_org_id text, p_user_id text, p_venta_id text, p_cliente_id text, p_cliente_nombre text, p_cliente_telefono text, p_subtotal numeric, p_descuento numeric, p_tipo_descuento text, p_porcentaje_descuento numeric, p_total numeric, p_metodo_pago text, p_observaciones text, p_items jsonb, p_deposito_id text) TO PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION ensamblar_kit_atomic(p_kit_id text, p_cantidad_a_ensamblar integer, p_org_id text, p_user_id text, p_deposito_id text, p_motivo text) TO PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION finalizar_conteo(p_conteo_id text, p_user_id text, p_forzar boolean) TO PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION get_deposito_principal(p_org_id text) TO PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION incrementar_stock_deposito(p_inventario_id text, p_org_id text, p_deposito_id text, p_cantidad integer) TO PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION iniciar_conteo(p_organization_id text, p_user_id text, p_nombre text, p_deposito_id text, p_tipo text, p_filtros jsonb, p_tolerancia_pct numeric, p_aplicar_ajustes boolean, p_notas text) TO PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION liberar_reserva_deposito(p_inventario_id text, p_org_id text, p_deposito_id text, p_cantidad integer) TO PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION recibir_orden_compra(p_oc_id text, p_user_id text, p_items jsonb, p_organization_id text, p_request_id text, p_deposito_id text) TO PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION registrar_devolucion_atomica(p_org_id text, p_venta_id text, p_user_id text, p_numero_devolucion text, p_motivo text, p_observaciones text, p_metodo_reembolso text, p_reembolso_referencia text, p_items jsonb, p_idempotency_key text) TO PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION registrar_entrada_lote(p_organization_id text, p_user_id text, p_inventario_id text, p_numero_lote text, p_cantidad integer, p_costo_unitario numeric, p_fecha_vencimiento date, p_proveedor_id text, p_orden_compra_id text, p_deposito_id text, p_notas text) TO PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION registrar_entrada_series(p_organization_id text, p_user_id text, p_inventario_id text, p_numeros_serie text[], p_lote_id text, p_costo_unitario numeric, p_deposito_id text, p_garantia_dias integer) TO PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION reservar_stock_deposito(p_inventario_id text, p_org_id text, p_deposito_id text, p_cantidad integer, p_strict boolean) TO PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION salida_serie(p_organization_id text, p_user_id text, p_inventario_id text, p_serie_id text, p_venta_id text, p_cliente_id text, p_motivo text, p_tipo text) TO PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION seed_deposito_inicial() TO PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION transferir_stock_atomic(p_inventario_id text, p_organization_id text, p_user_id text, p_deposito_origen text, p_deposito_destino text, p_cantidad integer, p_motivo text) TO PUBLIC, anon, authenticated;
