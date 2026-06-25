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
3. **(B) Recargo fijo / bloqueado.** El % lo define la configuración; el cajero **no** puede editarlo en la venta. Esto **reemplaza** el recargo manual por tarjeta actual.
4. **(B) % por método, no por cuotas.** El recargo es el mismo para cualquier cantidad de cuotas. (Recargo por cantidad de cuotas = etapa futura, fuera de alcance.)
5. **(B) Alcance: por organización.** Una política central por org. (Por sucursal = etapa futura.)
6. **(B) Reutiliza `pagos_venta.recargo_porcentaje`** → **sin cambios en la RPC `crear_venta_atomica`**.
7. **(B) Enforcement server-side:** la ruta `/api/ventas` reescribe el % con el configurado por método e **ignora** el valor que mande el cliente (así "bloqueado" se cumple de verdad).
8. **(B) Alcance funcional: ventas del POS.** Órdenes de servicio y facturas quedan fuera.

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

#### B.5 — POS (cobro)

- `components/pagos/multi-pago-input.tsx`: al elegir un método, **mostrar el % configurado en modo lectura** (no editable) y reflejar el recargo en el total. Eliminar/ocultar el input manual de recargo por tarjeta (lo reemplaza la config). El campo `costoFinanciero` (costo que absorbe el comercio) queda como está si existe; no es parte de este cambio.
- El POS obtiene el mapa método→% (endpoint `GET` de B.2, o uno liviano dedicado) al montar el checkout.
- El payload sigue mandando `recargo` por pago (compatibilidad), pero el valor es informativo: el server lo reescribe (ver B.6).

#### B.6 — Enforcement en `app/api/ventas/route.ts`

- Antes de armar `p_pagos`, cargar `getRecargosMetodo(organizationId)`.
- Para cada pago: **forzar** `recargo = recargos[metodo] ?? 0`, ignorando el valor del cliente. Así el % es server-authoritative ("bloqueado").
- El resto del flujo (cálculo de `monto`, inserción en `pagos_venta.recargo_porcentaje` vía `crear_venta_atomica`) **no cambia**.

## Aritmética del recargo (a confirmar en el plan)

El recargo hoy se guarda en `pagos_venta.recargo_porcentaje`; el cargo final al cliente = `monto + monto * recargo/100` (`multi-pago-input.tsx:111-121`). El plan debe verificar **dónde** se materializa el monto con recargo (en `monto` del pago vs. cálculo en display/arqueo) para que el % configurado impacte el total cobrado y el arqueo de forma consistente, sin doble conteo con `costo_financiero`.

## Casos borde

- **Método sin config** → 0% (precio contado).
- **CUENTA_CORRIENTE con recargo** → el % aplica igual; el monto a cuenta corriente sube según el recargo. Verificar interacción con `usar_cuenta_corriente`.
- **Cliente manda recargo manipulado** → el server lo descarta (B.6).
- **Venta sin pago (PENDIENTE / fiado)** → sin pagos, sin recargo.
- **Multi-pago** → cada pago aplica el % de su propio método.

## No-goals (fuera de alcance)

- Recargo distinto por cantidad de cuotas.
- Recargo por sucursal (es por org).
- Precio explícito por artículo (segundo precio en la ficha).
- Aplicar el recargo a órdenes de servicio / facturas.
- Tocar el `costo_financiero` (costo del comercio).

## Archivos afectados (resumen)

- **A:** `components/pos/pos-cart.tsx`
- **B (nuevo):** migración `recargos_metodo_pago`; `app/api/configuracion/recargos-metodo/route.ts`; `app/(dashboard)/configuracion/recargos-metodo/page.tsx` (+ componente); `lib/recargos.ts`
- **B (editar):** `app/(dashboard)/configuracion/page.tsx` (card nueva); `components/pagos/multi-pago-input.tsx`; `app/api/ventas/route.ts`
- **Tests:** unit del enforcement en `/api/ventas`, unit del helper `getRecargosMetodo`, y del cálculo de recargo en el POS.
