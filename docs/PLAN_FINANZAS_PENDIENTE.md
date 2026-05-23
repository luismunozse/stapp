# Finanzas — pendientes futuros

Contexto: refactor inicial (2026-05) alineó devengado (estado-resultados, tendencia, rentabilidad) y cash flow (dashboard, comparativa, resumen, unificados). Estados terminales `ENTREGADO_SIN_REPARACION` y `ENTREGADO_SIN_COBRO` ahora incluidos. Comisión técnico + vendedor sumadas como costo operativo. Devengado por `fecha_completado`.

Lo que queda son cambios de modelo, no fixes de filtro.

---

## 1. Reembolsos / Notas de crédito

**Problema**: hoy anular venta resta todo. Reembolso parcial (devolución de un producto, ajuste de precio post-venta, corrección por garantía) no existe. Impacta:
- `estado-resultados`: ingresos sobreestimados si hubo refund.
- `tendencia-financiera`: mismo.
- Caja: descuadre vs realidad.

**Modelo propuesto**:
```sql
CREATE TABLE notas_credito (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  venta_id TEXT REFERENCES ventas(id),
  orden_id TEXT REFERENCES ordenes_servicio(id),
  motivo TEXT NOT NULL,           -- DEVOLUCION, AJUSTE_PRECIO, GARANTIA, ERROR_FACTURACION
  monto NUMERIC(12,2) NOT NULL,
  iva_monto NUMERIC(12,2) DEFAULT 0,
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metodo_devolucion TEXT,         -- EFECTIVO, TRANSFERENCIA, NOTA_CREDITO_INTERNA
  user_id TEXT REFERENCES users(id),
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE items_nota_credito (
  id TEXT PRIMARY KEY,
  nota_credito_id TEXT NOT NULL REFERENCES notas_credito(id) ON DELETE CASCADE,
  item_venta_id TEXT REFERENCES items_venta(id),  -- si aplica
  cantidad INTEGER NOT NULL,
  precio_unitario NUMERIC(12,2) NOT NULL,
  restock BOOLEAN DEFAULT TRUE     -- devuelve stock al inventario
);
```

**Impacto en reportes**:
- Restar `notas_credito.monto` de `ingresosVentas` / `ingresosServicios` en el período.
- Si `restock = true`, restaurar stock atómicamente y revertir snapshot de costo.
- Caja: registrar movimiento EGRESO automático con categoría "Devolución".

**UI**:
- Botón "Generar nota de crédito" en detalle de venta + orden.
- Listado en finanzas con filtros (motivo, período).
- PDF imprimible.

**Riesgos**:
- Idempotencia: una venta no puede tener notas de crédito > total.
- Inventario reservado vs entregado en órdenes.
- Cálculos históricos: notas de crédito retroactivas al cerrar mes.

---

## 2. IVA discriminado

**Problema**: `ventas.total`, `facturas.total`, `ordenes_servicio.costo_final` tratan monto como bruto. `facturas` tiene `iva` y `subtotal` pero el resto no. Cálculo de margen incluye IVA, distorsiona indicadores.

**Modelo propuesto**:
```sql
-- Config por organización
ALTER TABLE organizations
  ADD COLUMN iva_default NUMERIC(5,2) DEFAULT 21,   -- AR: 21, exento: 0
  ADD COLUMN iva_responsable_inscripto BOOLEAN DEFAULT FALSE;

-- En ventas + ordenes
ALTER TABLE ventas
  ADD COLUMN iva_porcentaje NUMERIC(5,2),
  ADD COLUMN iva_monto NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN subtotal_neto NUMERIC(12,2);

ALTER TABLE ordenes_servicio
  ADD COLUMN iva_porcentaje NUMERIC(5,2),
  ADD COLUMN iva_monto NUMERIC(12,2) DEFAULT 0;

-- Por item para casos mixtos (productos exentos + gravados)
ALTER TABLE items_venta
  ADD COLUMN iva_porcentaje NUMERIC(5,2),
  ADD COLUMN iva_monto_unitario NUMERIC(12,2) DEFAULT 0;
```

**Impacto en reportes**:
- `estado-resultados`: separar "Ingresos brutos" / "IVA débito fiscal" / "Ingresos netos".
- Costos también separan IVA crédito (si el proveedor lo discrimina).
- Margen calculado sobre netos.

**UI**:
- Toggle "Incluye IVA" en config organización.
- Display dual en venta/orden: bruto y neto.
- Reporte IVA mensual (débito − crédito).

**Migración data histórica**:
- Asumir todo previo como bruto con IVA inferido por `iva_default` o NULL si no se puede determinar. Marcar "estimado" en reportes.

---

## 3. Inventario — merma / obsolescencia

**Problema**: stock baja solo al consumir (venta/orden). Pérdidas por rotura, robo, vencimiento, obsolescencia no se registran ni afectan rentabilidad.

**Modelo propuesto**:
```sql
CREATE TABLE ajustes_inventario (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  inventario_id TEXT NOT NULL REFERENCES inventario(id),
  tipo TEXT NOT NULL,             -- MERMA, ROTURA, ROBO, OBSOLESCENCIA, AJUSTE_FISICO, DONACION
  cantidad INTEGER NOT NULL,      -- siempre positivo, dirección por tipo
  direccion TEXT NOT NULL,        -- SALIDA | ENTRADA (ajuste físico puede ser cualquiera)
  costo_unitario_snapshot NUMERIC(12,2),  -- costo al momento del ajuste
  motivo TEXT,
  user_id TEXT REFERENCES users(id),
  fecha TIMESTAMPTZ DEFAULT NOW(),
  afecta_rentabilidad BOOLEAN DEFAULT TRUE,
  comprobante_foto TEXT           -- foto del producto roto, acta, etc.
);
```

**Trigger**: actualizar `inventario.stock` atómicamente. Crear movimiento_inventario.

**Impacto en reportes**:
- Nueva categoría de costo: "Merma/Pérdidas de inventario" = sum(cantidad × costo_snapshot) por período.
- Restar de ganancia bruta.
- Reporte específico: ABC de mermas por SKU/categoría.

**UI**:
- Acción "Registrar merma" en detalle de item.
- Conteo físico programado (skill `conteos_inventario` ya existe — integrar).
- Dashboard alert: items con merma > X% mes.

**Política**:
- Robo/donación: opt-in afecta rentabilidad.
- Obsolescencia: trigger automático si `fecha_vencimiento < NOW()` + alerta.

---

## 4. Reporte fiscal / impuestos consolidado

Una vez que IVA esté implementado:
- Libro IVA ventas / compras.
- Cálculo retenciones (ingresos brutos, ganancias).
- Export AFIP-compatible (CSV / TXT formato RG).
- Dependencia: integración con servicios fiscales externos (TangoFE, AFIP webservices).

Esto excede scope inmediato. Documentar requerimiento si cliente lo pide.

---

## 5. Tests financieros

Faltan tests de los endpoints refactorizados. Recomendación:

**Vitest** sobre cada endpoint con fixtures:
- `estado-resultados`: orden REPARADO con costo + repuestos + comisión, verificar margen.
- Orden `ENTREGADO_SIN_REPARACION` con `costo_final` > 0: aparece en ingresos.
- Orden `ENTREGADO_SIN_COBRO` con repuestos: ingreso = 0, costo cuenta.
- Venta COMPLETADA con vendedor + pct: comisión sumada.
- CF de pagos con `fecha_completado` fuera del rango: excluido.
- `comparativa-ingresos`: factura + cobro de la misma orden = no duplica.

**Playwright** UI:
- Tab Finanzas → cada subtab carga, números coinciden con backend.
- Cambio de período actualiza.
- PDF export incluye comisiones cuando hay.

---

## 6. Items de cotización SIN link a inventario

**Estado actual** (post-fix 2026-05): reportes financieros suman costo de repuestos via:
1. `repuestos_orden` (precio_unitario = `inventario.precio_compra`, mig 151).
2. `items_cotizacion` de cotizaciones ACEPTADAS, **sólo si tienen `inventario_id` NOT NULL** → costo = `cantidad × inventario.precio_compra`.

**Gap**: items de cotización cargados a mano (sin link a inventario) tienen `precio_unitario` que es precio al cliente, pero **no hay columna para costo de compra**. El sistema no puede contarlos como costo real, por lo que inflan ganancia bruta.

**Modelo propuesto**:
```sql
ALTER TABLE items_cotizacion
  ADD COLUMN costo_unitario DECIMAL(10,2),
  ADD COLUMN costo_unitario_origen TEXT CHECK (costo_unitario_origen IN ('MANUAL','INVENTARIO_SNAPSHOT'));

-- Trigger snapshot al aceptar cotización (si tiene inventario_id):
-- copia inventario.precio_compra a items_cotizacion.costo_unitario.

-- Reportes pasan a usar COALESCE(it.costo_unitario, it.inventario.precio_compra, 0).
```

**UI**:
- Al cargar item manual en cotización, campo opcional "Costo de compra" además de "Precio".
- Tip: si dejás en blanco, el sistema no podrá calcular margen real.

**Migración data histórica**: items existentes sin `costo_unitario` quedan como hoy (0 costo). Banner en finanzas avisa "X items de cotización sin costo registrado".

---

## 7. Promedio ponderado de `inventario.precio_compra`

**Estado actual**: `inventario.precio_compra` es una sola columna sin snapshot histórico ni cálculo ponderado. Cada compra del mismo SKU pisa o ignora el precio anterior. Si comprás:
- 10 unidades a $80
- 10 unidades a $120

`precio_compra` queda en lo último (depende de cómo lo escribís). No refleja costo real promedio.

Para repuestos consumidos: ya hay snapshot al insertar (mig 151 en `repuestos_orden`, mig 182 en `items_cotizacion`). Eso protege la HISTORIA. Pero para nuevas órdenes, toman el `precio_compra` actual del inventario — que puede no reflejar el cost real si los lotes mezclados tienen costos distintos.

**Modelo propuesto** (weighted average):
```sql
-- Trigger en movimientos_inventario tipo ENTRADA/COMPRA_RECIBIDA:
-- precio_compra_nuevo = (stock_prev * precio_prev + cantidad_in * costo_in) / (stock_prev + cantidad_in)

-- Requiere que el movimiento de entrada cargue costo_unitario:
ALTER TABLE movimientos_inventario
  ADD COLUMN costo_unitario DECIMAL(10,2);

CREATE OR REPLACE FUNCTION actualizar_precio_compra_promedio()
RETURNS TRIGGER AS $$
DECLARE
  v_stock_prev INT;
  v_precio_prev NUMERIC;
  v_nuevo NUMERIC;
BEGIN
  IF NEW.tipo IN ('ENTRADA','COMPRA_RECIBIDA') AND NEW.costo_unitario IS NOT NULL THEN
    SELECT stock, precio_compra INTO v_stock_prev, v_precio_prev
    FROM inventario WHERE id = NEW.inventario_id FOR UPDATE;

    IF v_stock_prev > 0 AND v_precio_prev > 0 THEN
      v_nuevo := (v_stock_prev * v_precio_prev + NEW.cantidad * NEW.costo_unitario)
                 / (v_stock_prev + NEW.cantidad);
    ELSE
      v_nuevo := NEW.costo_unitario;
    END IF;

    UPDATE inventario SET precio_compra = ROUND(v_nuevo, 2) WHERE id = NEW.inventario_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**UI**:
- En módulo "Compras / Recepción de mercadería" cargar `costo_unitario` por línea.
- Alternativa: FIFO/LIFO en vez de promedio. Más complejo, requiere lotes.

**Defer**: requiere flujo de compras con costos discriminados que hoy no existe completamente. Postergar hasta tener compras maduras.

---

## 8. Costo financiero en `cobros_orden`

**Estado actual**: reportes financieros cuentan CF (comisión terminales) de:
- `pagos_venta.costo_financiero_monto` (ventas con tarjeta)
- `pagos_parciales.costo_financiero_monto` (cobros de facturas)

**Gap**: `cobros_orden` (cobro directo a orden sin factura) tiene `recargo_porcentaje` y `monto_original` pero NO tiene `costo_financiero_monto`. Si admin cobra orden con tarjeta directo (sin facturar), el CF no entra en reportes.

**Opciones**:
1. Agregar columna `costo_financiero_monto` y `costo_financiero_porcentaje` a `cobros_orden`, replicar lógica de pagos_venta.
2. Interpretar `recargo_porcentaje` como CF cuando admin lo absorbe (no lo pasa al cliente). Requiere flag `recargo_absorbido_por_comerciante BOOLEAN`.

**Defer**: bajo impacto si la mayoría facturan o no usan tarjeta directa.

---

## 9. Edge cases del modelo híbrido

Implementación actual de "híbrido" (devengado + cobros adelanto) tiene supuestos:

1. **Refunds sobre adelantos NO existen**: si admin cobró $300 adelanto y después cancela la órden, debe anular el cobro (`cobros_orden.anulado = true`). Si no anula, $300 quedan como ingreso fantasma. Mitigado parcialmente: ya excluimos cobros de órdenes CANCELADO/SIN_REPARACION del cálculo, pero el cobro sigue en caja física → descuadre vs realidad.
   **Acción recomendada**: UI confirmación al cancelar orden con cobros pendientes → forzar a anular o registrar refund.

2. **Cobro cross-mes después de completed**: si órden completó marzo y admin cobra abril una cuota adicional, NO cuenta en abril (correcto, ya devengado). Pero si admin pretendía que sea ingreso real abril, queda invisible. Asume contabilidad devengado pura.

3. **Cotización ACEPTADA luego RECHAZADA**: items linkeados liberan stock vía RPC. Snapshot de `costo_unitario` queda pero la cotización ya no se cuenta (reportes filtran `estado === 'ACEPTADA'`). Si admin re-acepta, trigger no re-snapshot (check `IS NULL`). OK.

4. **Trigger snapshot solo dispara on UPDATE OF estado**: cotización creada directamente en ACEPTADA (importación, migración data) no snapshot. Workaround: trigger AFTER INSERT OR UPDATE.

---

## 10. Otros gaps menores

- **`gastos_recurrentes`**: ya hay job, verificar que crea movimientos con `afecta_rentabilidad = true` correcto.
- **Multi-moneda**: ingresos en USD vs ARS no se convierten. Si crece, requiere tabla `cotizaciones_diarias` y conversión en reportes.
- **Cierre de período**: hoy todo es vivo. Considerar tabla `cierres_contables` que congele un mes (auditoría).
- **Caja por sucursal/depósito**: con `multi_deposito` activo, finanzas no segmenta. Agregar filtro por depósito.

---

## Orden sugerido de implementación

1. **Tests** (1) — antes de tocar más código.
2. **Merma inventario** (3) — modelo simple, impacto claro, no rompe nada.
3. **Reembolsos** (1) — más complejo, requiere UI nueva pero impacto alto.
4. **IVA discriminado** (2) — el más invasivo, requiere migración de data y opt-in por org.
5. **Multi-moneda / cierres** — solo si el negocio escala.

## Owner

Sin asignar. Cuando se retome, priorizar con cliente cuál duele más hoy.
