# Spec: Servicios asignables a órdenes

**Fecha:** 2026-07-24
**Estado:** Borrador para revisión
**Alcance:** Tres entregas. PR 1 corrige hacia adelante un bug de integridad preexistente en `estado_cobro`. PR 2 corrige los datos históricos afectados por ese bug. PR 3 agrega la sección Servicios. PR 2 y PR 3 dependen de PR 1, pero no entre sí.

---

## 1. Contexto

Un taller tiene servicios con precio prefijado (ejemplo: instalación de Windows, $25.000) que hoy no puede cargar de forma limpia en una orden. `inventario` no sirve para intangibles y `repuestos_orden` tiene la semántica invertida.

### Verificaciones realizadas

**`inventario` no admite intangibles.** `001_schema.sql:236` define `stock INTEGER DEFAULT 0`, `precio_compra NOT NULL` y `tipo_dispositivo NOT NULL`. `043_mejoras_inventario_ventas.sql:20` agrega `CHECK (stock >= 0)`. Cargar un servicio ahí contamina valorización, alertas de stock mínimo, depósitos y kits.

**`repuestos_orden.precio_unitario` es COSTO, no precio de venta.** Documentado explícitamente en el `COMMENT` de `151_fix_add_repuesto_precio_compra.sql:72`: *"precio_unitario = precio_compra del inventario (costo, no venta) para que la card de comisión calcule ganancia correctamente"*. La view `v_comisiones_ordenes` (`119_comisiones_tecnicos.sql:45-52`) calcula:

```
ganancia       = costo_final - SUM(repuestos_orden.cantidad * precio_unitario)
monto_comision = ganancia * porcentaje_comision / 100
```

Consecuencia: cargar un servicio como repuesto manual lo **resta** de la ganancia y **baja** la comisión del técnico. Es lo opuesto al efecto buscado. El label de la UI ya lo refleja: `orden-repuestos-tab.tsx:266` dice "Costo unitario", no "Precio".

Este fix regresionó una vez (085 lo introdujo, algo lo revirtió, 151 lo reaplicó). Cualquier cambio a `add_repuesto_inventario` debe preservar `precio_compra`.

**La fórmula de ganancia está duplicada en siete lugares**, sin fuente única:

| # | Ubicación |
|---|-----------|
| 1 | `supabase/migrations/119_comisiones_tecnicos.sql:45` — view `v_comisiones_ordenes` |
| 2 | `app/api/reportes/rentabilidad/route.ts:84` |
| 3 | `app/api/reportes/estado-resultados/route.ts:181` |
| 4 | `app/api/reportes/rentabilidad-tecnicos/route.ts:119` |
| 5 | `app/api/reportes/tendencia-financiera/route.ts:184` |
| 6 | `components/ordenes/orden-comision-card.tsx:55` |
| 7 | `app/api/tecnicos/[id]/insights/route.ts:71` |

**`catalogo_items` ya modela servicios pero no sirve acá.** `143_catalogo_publico.sql:67` define `tipo IN ('PRODUCTO','SERVICIO')` con `precio`, `precio_hasta` y un constraint que prohíbe stock en servicios. Pero es la vitrina pública: `catalogo_config.activo` es `NOT NULL DEFAULT FALSE` (`143:31`), o sea que arranca apagada y la mayoría de las organizaciones no la usa. Acoplar la operación interna a una vitrina opcional mezcla dos ciclos de vida distintos.

**`costo_final` es un campo manual y es la única fuente de ingreso de la orden.** Se escribe en `app/api/ordenes/[id]/route.ts:282` sin ninguna guarda (ni por `total_cobrado > 0`, ni por estado terminal, ni por `estado_cobro`). De ahí sale toda la plata: `cobros/route.ts:260` calcula `pendiente = costo_final - descuento_cobro - total_cobrado`.

**Bug preexistente: `costo_final` se escribe desde ~10 lugares y solo uno recalcula `estado_cobro`.**

| Sitio | ¿Llama a `recalcular_estado_cobro`? |
|---|---|
| `app/api/ordenes/route.ts:395` (alta) | Sí, en `:464` |
| `app/api/ordenes/[id]/route.ts:282` (PUT) | No |
| `lib/cotizacion-aprobar-orden.ts:82` | No |
| `app/api/public/ordenes/[token]/approve-budget/route.ts:64` | No |
| `app/api/public/ordenes/[token]/reject-budget/route.ts:41` | No |
| `app/api/cotizaciones/route.ts:454` | No |
| `app/api/cotizaciones/[id]/route.ts:84, 122, 141, 507, 634, 649` | No (6 sitios) |

El RPC `recalcular_estado_cobro` (`068_mejoras_ordenes.sql:100-130`) es idempotente y puro: deriva todo de `cobros_orden` + `costo_final` + `descuento_cobro`. Tiene exactamente tres callers reales en TS: `cobros/route.ts:348`, `cobros/route.ts:557` y `ordenes/route.ts:464`.

No hay ningún trigger que compense. Los únicos triggers sobre `ordenes_servicio` son `ordenes_search_update` (`038:43`, mantiene `search_vector`), `trg_orden_cambio_estado_tiempo` (`068:169`, `AFTER UPDATE OF estado`) y un `AFTER INSERT` en `006:419`. Ninguno toca `estado_cobro`.

**Cadena de impacto del bug.** Orden de $20.000 cobrada en su totalidad (`estado_cobro = 'COBRADO'`). Se edita el costo final a $45.000:

1. `estado_cobro` queda en `'COBRADO'` y `total_cobrado` en $20.000.
2. `273_deuda_solo_ordenes_cobrables.sql:56` filtra `estado_cobro IN ('PENDIENTE','PARCIAL')`, así que los $25.000 desaparecen de la deuda del cliente.
3. `app/api/clientes/[id]/ordenes-pendientes/route.ts:28` usa el mismo filtro: tampoco figuran ahí.
4. `app/api/comisiones/route.ts:57` filtra `.eq("estado_cobro","COBRADO")`, así que la orden sí entra y `v_comisiones_ordenes` calcula la comisión sobre los $45.000.

Resultado neto: se pierde deuda cobrable y se paga comisión sobre dinero que nunca ingresó. El caso más expuesto es `approve-budget/route.ts:64`, que es el endpoint **público** donde el cliente aprueba el presupuesto sin autenticarse; si dejó una seña, la corrupción ocurre ahí.

`descuento_cobro` no tiene el problema: `cobros/route.ts:274` lo escribe y `:348` recalcula en el mismo flujo.

**`estado_cobro` y `total_cobrado` son valores 100% derivados.** Verificado exhaustivamente:

- SQL: se escriben solo en `068:128-129` (dentro del RPC vigente), `067:96-97` (versión anterior del mismo RPC, reemplazada) y `067:50-51` (backfill one-shot de la columna legacy `sena`, ya ejecutado).
- TypeScript: cero escrituras a `estado_cobro`, cero escrituras a `total_cobrado`. El único hit de `total_cobrado` es una lectura en `entregar/route.ts:142`.
- `242_cobros_orden_atomico.sql:144` y `:231` ya hacen `PERFORM recalcular_estado_cobro`.
- No hay triggers sobre `cobros_orden`.

Esto es lo que hace seguro el fix por trigger: no introduce una fuente de verdad nueva, hace cumplir la que ya existe.

**Otros datos de contexto:**

- `inventario` no tiene `sucursal_id`; es catálogo a nivel organización y el stock se particiona por depósito. Un catálogo de servicios (sin stock) no tiene nada que particionar.
- `083_inventario_critical_fixes.sql:21` eliminó el `UNIQUE(organization_id, codigo)` de `inventario` por incompatibilidad con el soft delete. Servicios debe usar índice único parcial desde el inicio.
- Helpers de autorización en `lib/auth-utils.ts`: `requireAuth` (`:20`), `requireAdmin` (`:55`), `requireAdminOrVendedor` (`:90`), `requireInventarioAccess` (`:121`).
- `app/api/ordenes/[id]/repuestos/route.ts:32` usa `requireAuth()` y valida pertenencia a la organización en `:40-49`.
- Última migración aplicada: 276.

---

## 2. Principio rector

**Repuestos son costo. Servicios son ingreso.** Son dos conceptos contables opuestos y no comparten tabla, aunque ambos sean líneas de una orden.

Corolario operativo: el catálogo de Servicios ahorra tipear, no obliga a nada. Un taller que no quiera mantener catálogo debe poder cargar un servicio suelto en la orden y seguir trabajando.

---

## 3. Entregas

| PR | Contenido | Migración | Depende de |
|----|-----------|-----------|------------|
| 1 | Trigger de integridad de `estado_cobro` + script de dry-run | 277 | — |
| 2 | Backfill histórico de `estado_cobro` | 278 | PR 1 y revisión del dry-run |
| 3 | Sección Servicios: catálogo y líneas de orden | 279 | PR 1 |

PR 2 y PR 3 son independientes entre sí. El backfill corrige el pasado; Servicios construye sobre el trigger, que corrige el futuro. Separarlos evita que la decisión sobre datos históricos —que necesita revisión humana de los números del dry-run— bloquee la corrección hacia adelante ni la funcionalidad nueva.

---

## 4. PR 1 y PR 2 — Integridad de `estado_cobro`

Bug preexistente en producción, independiente de Servicios. Sale primero porque Servicios va a escribir `costo_final` con mucha más frecuencia que hoy, y construir sobre el bug lo amplifica.

### 4.1 PR 1 · Migración 277 — Trigger

Trigger sobre `ordenes_servicio`:

```sql
CREATE OR REPLACE FUNCTION trg_recalcular_estado_cobro()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM recalcular_estado_cobro(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ordenes_recalcular_cobro ON ordenes_servicio;
CREATE TRIGGER ordenes_recalcular_cobro
  AFTER UPDATE OF costo_final, descuento_cobro ON ordenes_servicio
  FOR EACH ROW
  WHEN (
    OLD.costo_final    IS DISTINCT FROM NEW.costo_final OR
    OLD.descuento_cobro IS DISTINCT FROM NEW.descuento_cobro
  )
  EXECUTE FUNCTION trg_recalcular_estado_cobro();
```

**Por qué trigger y no diez llamadas explícitas.** La regla ya se omitió en 9 de 10 sitios de escritura. Repetirla a mano por décima vez deja el mismo problema para el próximo caller. El trigger la pone donde no se puede omitir, y cubre además cualquier RPC que escriba la columna.

**Por qué no hay recursión.** El `UPDATE` anidado dentro de `recalcular_estado_cobro` (`068:127-130`) fija solo `total_cobrado` y `estado_cobro`. En PostgreSQL, `AFTER UPDATE OF col` dispara cuando la columna aparece en la lista `SET` del statement; ninguna de las dos columnas del `UPDATE OF` está ahí. La cláusula `WHEN` actúa como segunda guarda.

**Efectos colaterales sobre otros triggers.** `ordenes_search_update` (`038:43`) es `BEFORE INSERT OR UPDATE` y ya se dispara en cada update; suma una invocación por cambio de costo, despreciable. `trg_orden_cambio_estado_tiempo` (`068:169`) es `AFTER UPDATE OF estado` y el update anidado no toca `estado`, así que no se dispara.

**Riesgo sobre datos existentes: ninguno.** El trigger solo actúa sobre updates futuros.

### 4.2 PR 1 · Dry-run (script, no migración)

Antes del backfill, y siguiendo el patrón de `docs/cc-backfill-fase3-dryrun.sql`, se corre en producción una query de solo lectura que reporta:

- Cantidad de órdenes cuyo `estado_cobro` cambiaría, con el desglose `de → a`.
- Monto total involucrado.
- Cuántas de esas órdenes tienen `comision_pagada = true`.
- Cuántas están en estado terminal (entregadas).

El resultado se revisa antes de decidir el alcance del backfill.

### 4.3 PR 2 · Migración 278 — Backfill

Ejecuta `recalcular_estado_cobro` sobre las órdenes afectadas. Se define recién con los números del dry-run a la vista.

**Riesgos conocidos, a evaluar con el dry-run:**

1. **Visibilidad.** Órdenes que hoy figuran como COBRADO pasarán a PARCIAL o PENDIENTE. No es una regresión: es el saldo real apareciendo. Requiere aviso previo a los talleres afectados.
2. **Comisiones.** `comisiones/route.ts:57` filtra `.eq("estado_cobro","COBRADO")`. Una orden que sale de COBRADO desaparece de la pantalla de comisiones. Si el técnico ya tenía la comisión marcada como pagada (`comision_pagada = true`), se pierde de su historial visible. Este es el riesgo de confianza más concreto y por eso el dry-run debe contarlo explícitamente.

### 4.4 Tests (PR 1)

- Editar `costo_final` de una orden con cobros recalcula `estado_cobro` y `total_cobrado`.
- Editar `descuento_cobro` recalcula.
- Aprobar presupuesto desde el endpoint público recalcula.
- Rechazar presupuesto (`costo_final = null`) deja `estado_cobro = 'PENDIENTE'`.
- El trigger no entra en recursión (un update produce exactamente una recalculación).
- Un update que no toca `costo_final` ni `descuento_cobro` no dispara el trigger.

---

## 5. PR 3 — Sección Servicios

### 5.1 Modelo de datos (migración 279)

```sql
CREATE TABLE servicios (
  id                    TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  codigo                TEXT NOT NULL,
  nombre                TEXT NOT NULL,
  descripcion           TEXT,
  categoria             TEXT,
  precio                DECIMAL(10,2) NOT NULL CHECK (precio >= 0),
  duracion_estimada_min INTEGER CHECK (duracion_estimada_min IS NULL OR duracion_estimada_min > 0),
  activo                BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice único parcial: permite reutilizar el código de un servicio borrado.
-- Patrón tomado de 083_inventario_critical_fixes.sql:21.
CREATE UNIQUE INDEX servicios_org_codigo_uniq
  ON servicios(organization_id, codigo) WHERE deleted_at IS NULL;

CREATE INDEX servicios_org_activo_idx
  ON servicios(organization_id) WHERE activo = TRUE AND deleted_at IS NULL;

CREATE TABLE servicios_orden (
  id              TEXT PRIMARY KEY DEFAULT generate_cuid(),
  orden_id        TEXT NOT NULL REFERENCES ordenes_servicio(id) ON DELETE CASCADE,
  servicio_id     TEXT REFERENCES servicios(id) ON DELETE SET NULL,
  nombre          TEXT NOT NULL,
  cantidad        INTEGER NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  precio_unitario DECIMAL(10,2) NOT NULL CHECK (precio_unitario >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX servicios_orden_orden_idx ON servicios_orden(orden_id);

COMMENT ON COLUMN servicios_orden.precio_unitario IS
  'PRECIO DE VENTA (ingreso). Semantica OPUESTA a repuestos_orden.precio_unitario, que es costo.';
```

RLS por `organization_id` en ambas tablas, siguiendo el patrón vigente. `servicios_orden` hereda acceso vía join con `ordenes_servicio`, igual que `items_factura` (`053:168-176`).

Trigger de `updated_at` sobre `servicios`, con la función `update_updated_at()` ya existente.

**Decisiones de diseño:**

1. **`nombre` es snapshot siempre, no solo en líneas ad-hoc.** Si el precio del catálogo cambia o el servicio se borra, las órdenes históricas no deben mutar. Mismo criterio que `items_factura.descripcion`.

2. **`precio_unitario` es venta, y el `COMMENT` lo documenta.** Coexisten dos tablas de líneas con el mismo nombre de columna y significado invertido. Sin el comentario, el próximo que copie la lógica de repuestos vuelve a romper el cálculo de comisiones.

3. **`servicio_id` nullable con `ON DELETE SET NULL`.** Habilita servicios ad-hoc sin alta previa y evita que borrar un servicio del catálogo rompa órdenes existentes.

4. **Sin `costo` ni `costo_unitario` en esta entrega.** Deliberado: la fórmula de ganancia está duplicada en los siete lugares listados en la sección 1. Exponer un costo de servicio sin actualizar los siete produce sobrestimación silenciosa de ganancia y comisiones. Cuando se necesite, entra como `ALTER TABLE ADD COLUMN` junto con la actualización de los siete sitios, en el mismo PR.

5. **Sin `sucursal_id`.** Consistente con `inventario`, que es catálogo a nivel organización. Un servicio no tiene stock que particionar.

6. **Sin `tipo_dispositivo`.** Un servicio es transversal a los tipos de dispositivo.

7. **Precio fijo únicamente.** Sin rango (`precio_hasta`) ni tarifa por hora. El rango es decorativo mientras al asignar haya que fijar un número concreto; la tarifa por hora es otro modelo de precio y requiere discriminador, lógica de cálculo y superficie de test propia.

### 5.2 Impacto en el total de la orden

El servicio **alimenta** `costo_final`, no lo reemplaza. `costo_final` sigue siendo la única fuente de ingreso, así que los siete sitios que calculan ganancia siguen siendo correctos sin tocar una línea. La comisión del técnico sube al agregar servicios, que es el resultado correcto: hizo el trabajo.

**Regla de sincronización:** automático mientras nadie pagó nada; explícito cuando ya hay dinero en el medio.

Al agregar o eliminar una línea de `servicios_orden`, dentro de la misma transacción:

```
suma_anterior = SUM(cantidad * precio_unitario) de servicios_orden ANTES del cambio
suma_nueva    = SUM(cantidad * precio_unitario) de servicios_orden DESPUES del cambio

si orden.total_cobrado > 0:
    no modificar costo_final
    la UI muestra "Servicios: $X · Costo final: $Y" con boton "Aplicar al total"
sino si orden.costo_final IS NULL o orden.costo_final == suma_anterior:
    si suma_nueva > 0:
        costo_final = suma_nueva
    sino:
        costo_final = NULL          # se elimino la ultima linea
sino:
    no modificar costo_final (fue editado a mano)
    la UI muestra el boton "Aplicar al total"
```

**Por qué automático y no solo un botón.** Un botón que hay que acordarse de apretar se olvida, y el costo de olvidarlo es cobrar mal. La regla es determinística: se compara la suma anterior contra la nueva dentro de la misma transacción.

**Por qué se apaga con cobros.** Si el cliente ya puso dinero, mover el total en silencio cambia lo que debe sin que nadie lo decida. Ahí el humano decide.

**Por qué `NULL` y no `0` al eliminar la última línea.** `CAMPOS_REQUERIDOS_POR_ESTADO.REPARADO` (`lib/orden-state-machine.ts:81`) valida `costo_final != null && parseFloat(costo_final) > 0`. Tanto `0` como `NULL` bloquean la transición a REPARADO, así que son equivalentes para ese gate, y también para `recalcular_estado_cobro` (que hace `COALESCE(costo_final,0)` y cae en `'PENDIENTE'` cuando el neto es `<= 0`) y para el cálculo de deuda (`273:84`, que aplica `GREATEST(..., 0)`). Se elige `NULL` porque significa "sin precio definido" en vez de "el precio es cero", que es lo mismo que ya hace `reject-budget/route.ts:41`, y porque deja la rama `IS NULL` lista para que el próximo alta de servicio vuelva a autocompletar.

**Consecuencia visible, deliberada:** una orden que se quedó sin líneas de servicio no puede pasar a REPARADO hasta que alguien cargue un precio. Es el comportamiento correcto y ya es el vigente para cualquier orden sin costo.

Toda escritura de `costo_final` por esta vía queda cubierta por el trigger del PR 1.

### 5.3 Permisos

| Acción | Autorización | Fundamento |
|---|---|---|
| CRUD del catálogo `/servicios` | `requireAdmin()` | Los precios son decisión comercial. Consistente con `/comisiones` y `/vendedores`, ambos ADMIN. |
| Asignar/quitar servicio en una orden | `requireAuth()` + validación de organización | Espeja `repuestos_orden` (`repuestos/route.ts:32` y `:40-49`). Quien trabaja la orden puede cargarla. |

### 5.4 UI y navegación

**Entrada de menú.** `/servicios` en el grupo principal del sidebar, inmediatamente después de Inventario (`components/layout/navbar.tsx:101`), con `roles: ["ADMIN"]`. Son los dos catálogos de lo que el taller vende: productos y servicios. Ubicarlo en el grupo colapsable "Más" lo vuelve invisible.

**Pantalla `/servicios`.** CRUD simple: listado con búsqueda y filtro por categoría, alta y edición (código, nombre, descripción, categoría, precio, duración estimada, activo), soft delete. Sin stock, depósitos, variantes ni lotes.

**Tab en el detalle de orden.** Tab "Servicios", hermana de "Repuestos", con el mismo patrón de `orden-repuestos-tab.tsx`: alternador "Del catálogo" / "Manual". Al elegir del catálogo, el precio viene precargado desde `servicios.precio` pero queda **editable**; ese valor es el que se persiste en `servicios_orden.precio_unitario`.

El subtotal se muestra como ingreso, con etiqueta que lo distinga del subtotal de repuestos (que es costo).

**Checkbox "Guardar en Servicios".** Al cargar un servicio manual, un checkbox opcional lo da de alta en el catálogo con los datos tipeados. Permite construir el catálogo trabajando, sin configuración previa. Cierra el caso del taller que no quiere mantener catálogo.

### 5.5 API

| Ruta | Métodos |
|---|---|
| `/api/servicios` | GET (listado con búsqueda y paginación), POST |
| `/api/servicios/[id]` | PUT, DELETE (soft delete) |
| `/api/ordenes/[id]/servicios` | POST, DELETE (por `servicioOrdenId`) |

`/api/ordenes/[id]/servicios` valida pertenencia de la orden a la organización antes de operar, igual que `repuestos/route.ts:40-49`, y aplica la regla de sincronización de la sección 5.2.

---

## 6. No-objetivos

Fuera de alcance en esta entrega, por decisión explícita:

- Servicios en POS y en cotizaciones. El alcance acordado es órdenes.
- Costo de servicio y margen real (ver decisión 4 de la sección 5.1).
- Precio por sucursal, listas de precios por tipo de cliente, precio por tipo de dispositivo.
- Tarifa por hora y precio por rango.
- Historial de precios. El snapshot de `nombre` y `precio_unitario` en la línea ya da trazabilidad histórica.
- Integración con el catálogo público (`catalogo_items`). Son sistemas independientes.
- Unificar `repuestos_orden` y `servicios_orden` en una tabla de líneas.
- Deduplicar la fórmula de ganancia en los siete sitios. Es deuda real y conviene atacarla, pero es un refactor propio.

---

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| El backfill del PR 2 hace desaparecer órdenes de la pantalla de comisiones | Dry-run del PR 1 que cuenta explícitamente las órdenes con `comision_pagada = true` antes de decidir |
| Talleres ven saldos que "no estaban" tras el backfill | Aviso previo; el dry-run da el universo exacto de organizaciones afectadas |
| Alguien copia la lógica de repuestos sobre servicios y vuelve a invertir el signo | `COMMENT` en la columna; test que fija la semántica de cada tabla |
| La regla de sincronización de `costo_final` sorprende al usuario | Cuatro tests de borde; la UI muestra siempre suma de servicios y costo final por separado |
| El trigger del PR 1 introduce recursión | `UPDATE OF` sobre columnas que el update anidado no toca, más cláusula `WHEN`; test dedicado |

---

## 8. Testing

**PR 1:** los seis casos de la sección 4.4.

**PR 2:** verificación post-backfill de que ninguna orden queda con `estado_cobro` inconsistente respecto de sus `cobros_orden`.

**PR 3:**

- Alta de servicio en el catálogo con código duplicado tras soft delete (debe permitirse).
- Asignar servicio del catálogo a una orden: `nombre` y `precio_unitario` quedan como snapshot.
- Cambiar el precio del catálogo no altera líneas ya cargadas.
- Borrar un servicio del catálogo no rompe órdenes existentes (`servicio_id` queda en NULL, `nombre` persiste).
- Servicio ad-hoc sin `servicio_id`.
- Sincronización de `costo_final`, un test por rama:
  - orden sin cobros y sin costo previo → autocompleta;
  - orden sin cobros con `costo_final` editado a mano → no pisa, expone "Aplicar al total";
  - orden con `total_cobrado > 0` → no pisa, expone "Aplicar al total";
  - eliminación de la última línea → `costo_final` queda en `NULL`;
  - tras quedar en `NULL`, agregar un servicio vuelve a autocompletar.
- La transición a REPARADO se bloquea cuando la orden quedó sin líneas y `costo_final` es `NULL`.
- Permisos: no-ADMIN no puede crear servicios en el catálogo; sí puede asignarlos a una orden.
- Aislamiento entre organizaciones en ambas tablas.
- Semántica de signo: un servicio suma a la ganancia de `v_comisiones_ordenes` y un repuesto la resta.
