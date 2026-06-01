# Diseño — POS: consumo de series en venta + idempotencia + costo manual

Fecha: 2026-05-30
Estado: aprobado (pendiente review escrito)

## Contexto

La sección POS vende a través de `POST /api/ventas` → RPC `crear_venta_atomica`
(definición autoritativa actual: `supabase/migrations/199_fix_series_integrity.sql`).

Migración 175 (`175_lotes_series.sql`) introdujo tracking opcional por ítem:

- `inventario.trackea_series BOOLEAN DEFAULT false` — si true, cada unidad es
  1 fila en `inventario_series`.
- Tabla `inventario_series` (estados `DISPONIBLE`, `RESERVADO`, `VENDIDO`,
  `GARANTIA_ACTIVA`, `DEVUELTO`, `BLOQUEADO`).
- Invariante: `estado='VENDIDO'` implica `venta_id IS NOT NULL` (enforce a nivel RPC).
- La entrada de series está wired (`registrar_entrada_series` vía
  `POST /api/inventario/[id]/series`) y la búsqueda también.

La migración 175 dejó explícito (líneas 15-16) que **la integración del consumo
de series con la venta es "fase 2" (override en `crear_venta_atomica`) y nunca
se hizo**. `salida_serie` (parcheado en 199) no se llama desde ningún punto del
código de la app.

### Problema

1. **Series desync:** vender un producto con `trackea_series=true` por POS baja
   `inventario.stock` agregado pero deja las filas `inventario_series` en
   `DISPONIBLE`. Corrupción latente de contadores. Es la fase 2 nunca integrada.
2. **Sin idempotencia:** `POST /api/ventas` no tiene clave de idempotencia. Un
   reintento de red / respuesta perdida crea una segunda venta y un segundo
   descuento de stock (venta duplicada).
3. **Costo de ítem manual:** la RPC 199 ya acepta `costo` por ítem como fallback,
   pero el checkout POS nunca lo envía. Ítems manuales quedan con
   `costo_unitario_snapshot` NULL → margen inflado en P&L.

### Fuera de alcance (decidido)

- **Precio confiado al cliente:** se mantiene editable. Los vendedores son staff
  de confianza; el precio por línea es feature, no bug.
- **Resumen multi-pago en `ventas.metodo_pago`:** guarda sólo el primer método.
  Anotado; no se cambia en este trabajo. El desglose completo vive en `pagos_venta`.

## Decisiones de producto

| Tema | Decisión |
|------|----------|
| Selección de series en checkout | **Auto FIFO + override**: auto-elige las N más viejas `DISPONIBLE`; el cajero puede intercambiar/escanear. |
| Garantía en venta serializada | **diasGarantia POS manda**: recalcula `serie.fecha_garantia_vence = hoy + diasGarantia`; estado `GARANTIA_ACTIVA` si queda vigente; además genera certificado `garantias_venta` (igual que hoy). |
| Precio | Confiar (sin cambio). |

## A. Consumo de series en la venta

### Flujo de datos

```
/api/inventario/search → devuelve trackeaSeries por producto
addProduct → cart item gana { trackeaSeries, serieIds: string[] }
cart línea serializada:
  - fetch series DISPONIBLE: GET /api/inventario/[id]/series?estado=DISPONIBLE
  - auto-selecciona las N (= cantidad) más viejas (FIFO, orden created_at asc)
  - botón override: abre lista, cajero togglea / escanea numero_serie
  - serieIds.length debe == cantidad para confirmar
checkout payload: items[].serieIds
```

### Cambios en `crear_venta_atomica` (migración 200)

Reproduce la definición de 199 **verbatim** salvo, dentro del loop de items
(paso 6), para cada item donde el `inventario` tiene `trackea_series = true`:

1. Resolver series a consumir:
   - Si `serieIds` provistos: validar `array_length == cantidad`; cada serie
     existe, pertenece al `inventario_id` + `organization_id`, está `DISPONIBLE`;
     lockear `FOR UPDATE`.
   - Si NO provistos: tomar las `cantidad` más viejas `DISPONIBLE`
     (`ORDER BY created_at ASC LIMIT cantidad FOR UPDATE`).
2. Si la cantidad de `DISPONIBLE` resueltas < `cantidad` →
   `RAISE EXCEPTION ... USING ERRCODE='P0003'` ('producto serializado sin series
   suficientes disponibles').
3. Marcar cada serie:
   - `venta_id`, `cliente_id`, `fecha_venta = NOW()`.
   - Si `diasGarantia > 0`: `fecha_garantia_vence = CURRENT_DATE + diasGarantia`,
     `estado = 'GARANTIA_ACTIVA'`.
   - Si `diasGarantia = 0`: `estado = 'VENDIDO'`.
4. La columna `serie_ids` del `movimientos_inventario` insertado incluye las
   series consumidas.
5. El decremento de `inventario.stock` agregado **no cambia** (sigue siendo el
   contador agregado; las series son la capa fina). Items no serializados:
   comportamiento idéntico al actual.

**Importante:** NO se invoca `salida_serie`. Esa RPC decrementa stock e inserta
su propio movimiento; llamarla desde `crear_venta_atomica` duplicaría ambos. El
consumo es inline. `salida_serie` se reserva para egresos no-venta (ajustes,
devoluciones manuales futuras).

### Edge cases

- Item con `trackea_series=true` pero 0 series `DISPONIBLE` (stock legado sin
  series cargadas) → RAISE claro, la venta se rechaza entera (atómica).
- Series duplicadas en `serieIds` → validación de count + estado las detecta
  (una sola fila DISPONIBLE no se puede tomar dos veces bajo el lock).

## B. Idempotencia

- Cliente genera `idempotencyKey` (`crypto.randomUUID()`) **una vez por intento
  de checkout**, estable entre reintentos del mismo submit (se guarda en estado
  del dialog y se regenera sólo al abrir un checkout nuevo / venta nueva).
- Migración 200: `ALTER TABLE ventas ADD COLUMN idempotency_key TEXT` +
  `CREATE UNIQUE INDEX ... ON ventas(organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL`.
- `crear_venta_atomica` recibe `p_idempotency_key` e inserta su valor en `ventas`.
- API `POST /api/ventas`: si la RPC falla con `23505` (unique violation) sobre el
  índice de idempotencia → la venta ya existe; se hace `SELECT` de la venta por
  `(organization_id, idempotency_key)`, se formatea y se devuelve **201 con la
  venta original** (reintento idempotente, sin duplicado ni segundo descuento).

## C. Costo de ítem manual

- `addManualProduct` (UI en `pos-product-search.tsx`) gana un campo `costo`
  opcional (numérico ≥ 0).
- Cart item manual lleva `costo`.
- Checkout incluye `costo` en el payload de items.
- La RPC 199 ya usa ese `costo` como fallback cuando no hay `precio_compra` /
  `inventarioId`. Cierra el margen inflado para ítems manuales.

## Migración 200 (única)

Archivo: `supabase/migrations/200_series_en_venta_e_idempotencia.sql`

1. `ALTER TABLE ventas ADD COLUMN IF NOT EXISTS idempotency_key TEXT`.
2. `CREATE UNIQUE INDEX IF NOT EXISTS ... ON ventas(organization_id,
   idempotency_key) WHERE idempotency_key IS NOT NULL`.
3. `CREATE OR REPLACE FUNCTION crear_venta_atomica(...)` con nuevo parámetro
   `p_idempotency_key TEXT DEFAULT NULL`, reproduciendo 199 verbatim + (A) consumo
   de series + (B) persistir idempotency_key. No edita 199.

Nota: agregar un parámetro a la firma de la RPC crea una nueva sobrecarga; revisar
si hay que `DROP FUNCTION` de la firma vieja para evitar ambigüedad de overload
(PostgREST). Resolver en el plan de implementación.

## Archivos tocados

| Archivo | Cambio |
|---------|--------|
| `supabase/migrations/200_series_en_venta_e_idempotencia.sql` | nuevo: columna + índice + RPC |
| `app/api/inventario/search/route.ts` | devolver `trackeaSeries` |
| `app/api/ventas/route.ts` | zod `items[].serieIds`, `idempotencyKey`; pasar a RPC; manejar 23505 |
| `components/pos/pos-types.ts` | cart item: `trackeaSeries`, `serieIds`, `costo` |
| `components/pos/pos-terminal.tsx` | `addProduct`/`addManualProduct` con nuevos campos |
| `components/pos/pos-product-search.tsx` | input `costo` opcional en producto manual |
| `components/pos/pos-cart.tsx` | picker de series por línea serializada (auto FIFO + override) |
| `components/pos/pos-checkout-dialog.tsx` | enviar `serieIds` + `idempotencyKey`; validar serieIds.length == cantidad |

## Testing

- Venta de producto serializado: stock agregado baja N, N series pasan a
  `VENDIDO`/`GARANTIA_ACTIVA` con `venta_id`, movimiento con `serie_ids`.
- Venta con override: serie elegida específica sale, no la FIFO.
- Series insuficientes → venta rechazada, sin cambios parciales (atómica).
- Idempotencia: doble POST con misma key → una sola venta, segundo devuelve la
  misma; stock baja una vez.
- Ítem no serializado: comportamiento sin cambios (regresión).
- Ítem manual con costo → `costo_unitario_snapshot` poblado.
- Garantía: `diasGarantia>0` setea `fecha_garantia_vence = hoy+dias` y
  `GARANTIA_ACTIVA`.
