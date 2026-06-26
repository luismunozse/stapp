# POS — Editar precio visible + recargo por método de pago

**Fecha:** 2026-06-25 · **Estado:** Diseño aprobado

## Problema

Dos limitaciones reportadas en el POS:

1. **"No se puede editar el precio de un artículo desde el carrito."** En realidad SÍ se puede (`components/pos/pos-cart.tsx:418`, panel expandible con campo "Precio unit."), pero está escondido detrás de una flechita ▼ minúscula en el nombre del producto (`pos-cart.tsx:294-305`). Nadie lo descubre → se percibe como ausente.
2. **No existe "precio distinto según método de pago."** Hoy un artículo tiene un solo `inventario.precio_venta`. Existe un `recargo_porcentaje` por pago (`pagos_venta`), pero se carga **manual** por venta (pensado para cuotas de tarjeta). No hay forma de que, por ejemplo, contado/transferencia tengan un precio y cuenta corriente/tarjeta otro, de forma automática.

## Objetivo

- **(A)** Hacer el editor de precio del POS **visible y descubrible** (la lógica ya existe).
- **(B)** Permitir un **precio distinto según método de pago** mediante una **regla global por método (%)**: precio base por artículo + un % configurable por método que el POS aplica **automático y fijo** (no editable por el cajero).

## Decisiones (cerradas)

1. **(A) Affordance explícita:** reemplazar la flechita ▼ por un botón **"✏ Editar"** claro por línea, que abre el panel existente (Precio unit. + Garantía + Descuento). Sin backend.
2. **(B) Modelo = regla global por método (%).** El precio del artículo es el **precio base (contado = 0%)**; cada método tiene un % que se suma. No se agregan precios por artículo.
3. **(B) El % es INGRESO del negocio, no interés bancario.** *(Confirmado con el usuario, 2026-06-26.)* El % sube el **precio efectivo de la venta** y se contabiliza como ingreso. NO se modela como `recargo_porcentaje` (que `multi-pago-input.tsx:82-83` excluye explícitamente del ingreso del comercio). Esto distingue esta feature del recargo bancario existente.
4. **(B) Una condición de precio por venta.** El % aplica al **precio efectivo de los items** (sube `precio_unitario` → sube subtotal, IVA, total e ingreso de forma consistente). Como los items son compartidos por toda la venta, la condición es **única por venta**, determinada por el método de pago. **[A confirmar en revisión]** la regla de multi-pago (ver más abajo).
5. **(B) Recargo fijo / bloqueado.** El % lo define la configuración; el cajero **no** puede editarlo en la venta. Esto **reemplaza** el recargo manual por tarjeta actual.
6. **(B) % por método, no por cuotas.** El % es el mismo para cualquier cantidad de cuotas. (Por cantidad de cuotas = etapa futura, fuera de alcance.)
7. **(B) Alcance: por organización.** Una política central por org. (Por sucursal = etapa futura.)
8. **(B) Enforcement server-side:** la ruta `/api/ventas` calcula el precio efectivo aplicando el % configurado del método e **ignora** cualquier precio "inflado" que mande el cliente (así "bloqueado" se cumple de verdad y no es manipulable).
9. **(B) Alcance funcional: ventas del POS.** Órdenes de servicio y facturas quedan fuera.

### Regla de multi-pago **[a confirmar en revisión]**

El POS permite pago dividido en varios métodos. Como la condición de precio es **única por venta**, hay que definir qué tier aplica cuando se mezclan métodos de distinto %. Recomendación v1 (la más simple y transparente):

> La condición de precio de la venta = la del **método de pago principal** (el primer pago / el de mayor monto). El precio efectivo de TODA la venta se calcula con ese %. Se muestra el total efectivo claramente antes de confirmar.

Alternativa (más estricta, más trabajo): un **selector explícito de "condición de pago"** (Contado vs Financiado) separado del split, que fija el precio y obliga a que los pagos sean de esa condición. Si preferís esta, lo ajustamos.

## Arquitectura

### Parte A — Editor de precio visible (`components/pos/pos-cart.tsx`)

- Mantener el panel expandible existente (`isExpanded`, estado `expandedItem`) y su contenido (precio/garantía/descuento) sin cambios funcionales.
- Cambiar **solo el disparador**: hoy el toggle está en el botón del nombre (`:294-305`) con un Chevron chico (`:312-316`). Agregar un botón visible **"✏ Editar"** (ícono `Pencil` de lucide + label corto) en la fila de la línea, que ejecute el mismo toggle (`setExpandedItem` + setear `precioDraft`/`garantiaDraft`).
- El Chevron puede quedar como indicador de estado (abierto/cerrado) o eliminarse; el botón "Editar" pasa a ser el affordance principal.
- Sin cambios en payload, API ni RPC.

### Parte B — Recargo por método de pago

#### B.1 — Migración (nueva tabla de configuración)

Tabla `recargos_metodo_pago`:
- `id` TEXT PK (cuid)
- `organization_id` TEXT NOT NULL FK organizations ON DELETE CASCADE
- `metodo_pago` TEXT NOT NULL — valor del enum `metodo_pago_venta` (EFECTIVO, TRANSFERENCIA, TARJETA_DEBITO, TARJETA_CREDITO, MERCADOPAGO, CUENTA_CORRIENTE, OTRO)
- `porcentaje` DECIMAL(5,2) NOT NULL DEFAULT 0 — recargo % (≥ 0)
- `activo` BOOLEAN NOT NULL DEFAULT true
- `created_at` / `updated_at` TIMESTAMPTZ
- UNIQUE (organization_id, metodo_pago)
- RLS: política por org (espejo de otras tablas) + service_role.
- **Sin backfill obligatorio:** método sin fila ⇒ 0% (contado por defecto). Opcionalmente sembrar filas en 0 para los métodos conocidos al entrar a la pantalla de config.

#### B.2 — API de configuración (`app/api/configuracion/recargos-metodo/route.ts`, nuevo)

- `GET`: lista los % por método de la org (devuelve todos los métodos conocidos, con 0 si no hay fila). `requireAuth`.
- `PUT`/`POST`: upsert del % por método. **Solo ADMIN** (`requireAdmin` / `canEditConfiguration`). Valida `porcentaje >= 0` con Zod.

#### B.3 — Pantalla de configuración (`app/(dashboard)/configuracion/recargos-metodo/page.tsx` + componente cliente, nuevo)

- Listada bajo **Configuración → "Recargos por método de pago"** (nueva card en la sección Finanzas de `app/(dashboard)/configuracion/page.tsx`).
- Tabla editable: método ↔ % (input numérico). Contado/Transferencia en 0; Cuenta corriente/Tarjeta con su recargo.
- Solo ADMIN puede guardar.

#### B.4 — Helper de lectura (`lib/recargos.ts`, nuevo)

- `getRecargosMetodo(organizationId): Promise<Record<string, number>>` → mapa método→%. Cacheable por request. Usado por el POS (vía endpoint) y por la ruta de ventas (enforcement).

#### B.5 — POS (cobro y precio efectivo)

- El POS obtiene el mapa método→% (endpoint `GET` de B.2, o uno liviano dedicado) al montar el checkout.
- Al elegir el método (la **condición de pago**), el POS calcula y muestra el **precio efectivo** de la venta: total base × (1 + %/100). Muestra claramente "Total contado: $X" vs "Total {método}: $Y" para que sea transparente.
- `components/pagos/multi-pago-input.tsx`: **eliminar el input manual de recargo por tarjeta** (lo reemplaza la condición de pago). El campo `costoFinanciero` (costo que absorbe el comercio) queda como está; no es parte de este cambio.
- El payload manda el método/condición; los precios efectivos los **recalcula y valida el server** (no se confía en precios del cliente, ver B.6).

#### B.6 — Precio efectivo + enforcement en `app/api/ventas/route.ts`

- Cargar `getRecargosMetodo(organizationId)` y derivar la **condición de la venta** (regla de multi-pago, ver arriba: método principal en v1).
- Calcular `factor = 1 + (recargos[condicion] ?? 0)/100`. Aplicar `factor` al **precio unitario de cada item** ANTES de calcular subtotal/descuentos/IVA/total (líneas `:188-251`). Así el ingreso, IVA y total reflejan el precio efectivo de forma consistente, y los pagos suman ese total.
- El `costo_unitario_snapshot` (costo) **no** se toca → el margen sube por el mayor precio de venta, correcto.
- Persistir el % aplicado en la venta (campo nuevo `recargo_metodo_porcentaje` en `ventas`, o en `observaciones`) para trazabilidad/reportes. **[decisión menor — el plan elige]**
- El cálculo es server-authoritative: aunque el cliente mande precios inflados, el server parte del precio base del catálogo. **Nota:** hoy el precio base viaja en el payload (`precioUnitario`), editable por el cajero (Parte A). El plan debe definir si el server confía en ese `precioUnitario` como "base" (y solo aplica el factor encima) — que es lo coherente con la edición manual de precio del POS.

## Materialización del precio (ingreso) — verificación obligatoria del plan

El total de la venta sale de los precios de los items (`route.ts:188-251`), y los pagos deben sumar ese total. El plan DEBE: (1) aplicar el `factor` sobre `precioUnitario` de los items en el server; (2) confirmar que `pagos_venta.monto` (que lee el arqueo) suma el total efectivo → el ingreso extra aparece en arqueo y reportes; (3) NO usar `recargo_porcentaje` para esto (queda en null/0 salvo que se reintroduzca interés bancario real); (4) evitar doble conteo con `costo_financiero` (que sigue siendo costo del comercio, intacto).

## Casos borde

- **Método sin config** → factor 1.0 (precio contado).
- **CUENTA_CORRIENTE con %** → el precio efectivo sube; el monto cargado a cuenta corriente = total efectivo. Verificar interacción con `usar_cuenta_corriente` (debe cargar el monto efectivo, no el base).
- **Cliente manda precio inflado** → el server parte del precio base + aplica el factor; ver nota B.6 sobre la edición manual de precio.
- **Venta sin pago (PENDIENTE / fiado)** → sin método ⇒ ¿qué condición? v1: precio base (contado) hasta que se cobre. **[el plan lo define]**
- **Multi-pago con métodos de distinto tier** → v1: aplica el tier del método principal a toda la venta (ver regla de multi-pago).

## No-goals (fuera de alcance)

- Recargo distinto por cantidad de cuotas.
- Recargo por sucursal (es por org).
- Precio explícito por artículo (segundo precio en la ficha).
- Aplicar el recargo a órdenes de servicio / facturas.
- Tocar el `costo_financiero` (costo del comercio).

## Archivos afectados (resumen)

- **A:** `components/pos/pos-cart.tsx`
- **B (nuevo):** migración `recargos_metodo_pago`; `app/api/configuracion/recargos-metodo/route.ts`; `app/(dashboard)/configuracion/recargos-metodo/page.tsx` (+ componente); `lib/recargos.ts`
- **B (editar):** `app/(dashboard)/configuracion/page.tsx` (card nueva); `components/pagos/multi-pago-input.tsx`; `app/api/ventas/route.ts`; posible columna nueva `ventas.recargo_metodo_porcentaje` (trazabilidad)
- **Tests:** unit del helper `getRecargosMetodo`; unit del **cálculo del precio efectivo** en `/api/ventas` (total/IVA reflejan el factor, ingreso correcto, server ignora precios inflados); unit del cálculo de precio efectivo mostrado en el POS.
