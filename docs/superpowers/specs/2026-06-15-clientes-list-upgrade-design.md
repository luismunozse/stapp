# Upgrade de la lista de clientes (SP-A)

**Fecha:** 2026-06-15 · **Estado:** Diseño aprobado

## Problema

La lista de clientes (`/clientes`) solo tiene buscador — sin filtros — y las
filas muestran poco contexto (nombre, tel, email, dirección, fecha de alta,
saldo). Para responder preguntas operativas básicas — "¿quiénes me deben?",
"¿cuántas órdenes hizo este cliente?", "¿clientes empresa?", "¿quién no vino
hace tiempo?" — hay que entrar cliente por cliente o cruzar a mano. Además, el
"saldo" que se muestra es **crédito a favor** (depósitos en cuenta corriente),
no deuda, lo que confunde.

Falta: filtrar la lista, ver métricas por cliente de un vistazo, y un flujo de
cobranza rápido sobre los deudores.

## Objetivo

Convertir la lista en una herramienta operativa: filtros (tipo, con deuda,
fecha de alta, acepta-WhatsApp), columnas con métricas por cliente (deuda
pendiente, # órdenes, última visita) y un modo deudores (filtro "con deuda" +
total adeudado) que reusa el cobro existente.

## Alcance

Este cambio cubre **solo la lista de clientes**. Fuera de alcance: cambios en la
página de detalle, y crear orden/cotización desde el cliente (eso es el sub-
proyecto SP-B, spec aparte). El filtro por sector queda **diferido** (los
sectores son por-cliente, no hay taxonomía compartida que justifique un filtro
global).

## Decisiones (cerradas)

1. **VIEW `v_clientes_resumen`** como cimiento. Filtrar y ordenar por deuda
   pendiente / # órdenes / última visita DEBE hacerse en SQL (son agregados),
   así que no alcanza con calcular en JS post-query. La view agrega
   `ordenes_servicio` por `cliente_id`. Es eficiente con el índice existente
   `ordenes_org_cliente_idx (organization_id, cliente_id)`.
2. **`GET /api/clientes` lee de la view**; POST/PUT/DELETE siguen sobre la tabla
   `clientes` (la view es solo lectura).
3. **`saldo` = crédito a favor; `deuda_pendiente` = lo que debe.** Conceptos
   distintos. La UI los muestra separados: columna "Crédito" (lo que hoy es
   "Saldo") y columna nueva "Deuda".
4. **Deudores = filtro + barra resumen** sobre la misma lista (no página
   aparte): toggle "Con deuda" + barra "Total adeudado". El cobro reusa el
   `CobrarMultipleDialog` ya presente en las acciones de fila.
5. **Migración aplicada en prod por el usuario** (patrón del repo).

## Arquitectura

### Migración (DB — aplicar en prod por el usuario)

`supabase/migrations/225_v_clientes_resumen.sql` (verificar que 225 sea el
próximo libre antes de crear):

```sql
CREATE OR REPLACE VIEW v_clientes_resumen AS
SELECT
  c.*,
  COALESCE(agg.ordenes_count, 0)   AS ordenes_count,
  agg.ultima_visita                AS ultima_visita,
  COALESCE(agg.deuda_pendiente, 0) AS deuda_pendiente
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
) agg ON agg.cliente_id = c.id;
```

Notas:
- `c.*` mantiene `organization_id`, así que el endpoint sigue filtrando por org.
- La view se consulta con `supabaseAdmin` (service role), igual que hoy; el
  aislamiento multi-tenant lo da el `.eq("organization_id", ...)` explícito.
- `deuda_pendiente` usa el modelo de cobros directo (migración 067):
  `estado_cobro`, `costo_final`, `descuento_cobro`, `total_cobrado` — NO la
  tabla `facturas`.

### `GET /api/clientes` (`app/api/clientes/route.ts`)

Cambios en el GET (POST sin cambios):
- `from("clientes")` → `from("v_clientes_resumen")` para la query de listado.
- Nuevos params (todos opcionales; ausencia = comportamiento actual):
  - `tipoCliente` ∈ {INDIVIDUAL, EMPRESA} → `.eq("tipo_cliente", v)`
  - `conDeuda=true` → `.gt("deuda_pendiente", 0)`
  - `fechaDesde` → `.gte("created_at", "<fecha>T00:00:00")`
  - `fechaHasta` → `.lte("created_at", "<fecha>T23:59:59")`
  - `aceptaWhatsapp` ∈ {true,false} → `.eq("acepta_whatsapp", v)`
- `sortMap` extendido: agregar `deudaPendiente→deuda_pendiente`,
  `ordenes→ordenes_count`, `ultimaVisita→ultima_visita` (además de los
  actuales createdAt/nombre/telefono/email).
- **Total adeudado del set filtrado** (`totalDeuda`): además de la query
  paginada, ejecutar una agregación con LOS MISMOS filtros, sin paginar, que
  sume `deuda_pendiente`. Como Supabase no expone `sum()` directo de forma
  simple, traer solo la columna `deuda_pendiente` de todas las filas filtradas
  (`.select("deuda_pendiente")`) y sumar en JS. (Volumen acotado: clientes por
  org. Aceptable.) Devolver `totalDeuda` en la respuesta.
- Respuesta: misma forma `{ data, total, page, limit, totalPages }` + nuevo
  campo `totalDeuda`. Mantener los headers `no-store`.

Mapeo de la respuesta — NO modificar `formatCliente` (es compartido con
órdenes/ventas que no tienen los agregados). En el GET, extender por fila:
```ts
data: (clientes || []).map((c) => ({
  ...formatCliente(c),
  deudaPendiente: parseFloat(c.deuda_pendiente || "0"),
  ordenesCount: c.ordenes_count ?? 0,
  ultimaVisita: c.ultima_visita ?? null,
})),
```

### Tipos (`types/index.ts`)

Extender `Cliente` con campos opcionales (solo los puebla el endpoint de
listado):
```ts
deudaPendiente?: number
ordenesCount?: number
ultimaVisita?: string | null
```

### Frontend (`components/clientes/clientes-list.tsx`)

1. **Barra de filtros** (encima de la tabla, junto al buscador):
   - Tipo: select Todos / Individual / Empresa.
   - "Solo con deuda": toggle/checkbox.
   - Fecha de alta: desde / hasta (los date inputs del proyecto).
   - Acepta WhatsApp: select Todos / Sí / No.
   - Cada cambio resetea `page=1` y se agrega al `apiUrl` (mismo patrón SWR +
     `URLSearchParams` que ya usa la búsqueda). La búsqueda mantiene su debounce.
2. **Columnas nuevas** en la `DataTable` (desktop) y en `ClienteMobileCard`:
   - **Crédito** (rename de la actual "Saldo"; muestra `saldoCuenta`, el crédito
     a favor).
   - **Deuda** (`deudaPendiente`; en rojo si > 0; `-` si 0). `hideOnTablet`.
   - **# Órdenes** (`ordenesCount`). `hideOnMobile`.
   - **Última visita** (`ultimaVisita`, `formatDate`; `-` si null).
     `hideOnMobile`.
   - Hacer ordenables (sortable) Deuda / # Órdenes / Última visita usando el
     `sortBy`/`sortOrder` que ya maneja la lista.
3. **Modo deudores**: la barra resumen "Total adeudado:
   {formatPrice(totalDeuda)}" se muestra **solo cuando el toggle "Con deuda" está
   activo** (evita ruido en el listado general). El cobro por cliente ya existe
   (acción "Cobrar órdenes" → `CobrarMultipleDialog`) — no se agrega flujo nuevo.

### Mobile (`components/clientes/cliente-mobile-card.tsx`)

Agregar a la card: deuda (si > 0, destacada), # órdenes y última visita de forma
compacta. Mantener las acciones existentes.

## Estados y errores

- **Sin resultados con filtros**: el `EmptyState` actual, con copy que aclare que
  hay filtros activos + acción "Limpiar filtros".
- **Cliente sin órdenes**: `deuda_pendiente=0`, `ordenes_count=0`,
  `ultima_visita=null` (la view ya devuelve estos defaults por el LEFT JOIN).
- **`totalDeuda`**: si la agregación falla, degradar a no mostrar la barra (no
  romper la lista).
- **Multi-tenant**: la view incluye `organization_id`; el endpoint filtra por org
  igual que hoy. Cubrir en tests.

## Testing

Infra de test: solo API (vitest + `__tests__/api/helpers.ts`). La view SQL se
verifica manual (no hay infra de test SQL). Componentes se verifican con
`npx tsc --noEmit` + `npm run build` + manual.

Tests de API (`__tests__/api/clientes-filtros.test.ts`, nuevo):
- `tipoCliente=EMPRESA` → aplica `.eq("tipo_cliente", "EMPRESA")`.
- `conDeuda=true` → aplica `.gt("deuda_pendiente", 0)`.
- `fechaDesde`/`fechaHasta` → aplica `.gte`/`.lte` sobre `created_at`.
- `aceptaWhatsapp=false` → aplica `.eq("acepta_whatsapp", false)`.
- Sin params → no aplica ninguno de los filtros nuevos (comportamiento actual).
- La query lee de `v_clientes_resumen`.
- `totalDeuda` está presente en la respuesta.
- Los tests existentes (`__tests__/api/clientes.test.ts`, `v1-clientes.test.ts`)
  siguen verdes (el `from()` del listado cambia a la view — ajustar los mocks de
  esos tests si referencian `clientes` para el GET de listado).

## Plan de entrega

Un solo PR. Orden de implementación:
1. Migración `225_v_clientes_resumen.sql`.
2. Backend: `GET /api/clientes` lee de la view + filtros + `totalDeuda` + mapeo;
   tipos en `types/index.ts`; tests de API.
3. Frontend: barra de filtros + columnas nuevas + rename "Saldo"→"Crédito".
4. Mobile card: métricas nuevas.
5. Barra "Total adeudado" (deudores).
6. Verificación: tests verdes, typecheck, build, recorrido manual.

## Fuera de alcance

- Filtro por sector (diferido).
- Cambios en la página de detalle del cliente.
- Crear orden/cotización desde el cliente (SP-B, spec aparte).
- Materialización de la view / triggers (la view simple alcanza; optimizar solo
  si el volumen lo exige).
