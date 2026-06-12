# Spec: Inventario Profesional — Roadmap de consolidación

**Fecha:** 2026-06-12
**Estado:** Borrador para revisión
**Alcance:** Roadmap maestro. Cada fase se descompone en su propio plan de implementación (spec → plan → PRs encadenados). Este documento fija prioridades, alcance y no-objetivos.

---

## 1. Contexto

Auditoría del módulo de inventario (2026-06-11/12) contra apps consolidadas (Zoho Inventory, Odoo, Cin7, Loyverse, Dux/Alegra). Conclusión: STApp ya supera en cantidad de features a Loyverse y Square (variantes, lotes, series, kits, depósitos, conteos físicos, ABC, reposición, mermas, historial de precios, auditoría, barcode, webhooks). El problema no es falta de features sino **flujos a medio cerrar** que generan datos inconsistentes, ausencia de **valorización contable** y **UX fragmentada** (10 sub-rutas + 8 dialogs).

### Verificaciones realizadas

- Recepción de OC **ya existe y funciona**: `app/api/ordenes-compra/[id]/recibir/route.ts` → RPC `recibir_orden_compra` (mig. 109/110), soporta recepción parcial (estados `ENVIADA` → `RECIBIDA_PARCIAL` → `RECIBIDA`) y registra movimiento `COMPRA_RECIBIDA`. Queda fuera del problema.
- Multi-depósito fase 2 pendiente: confirmado en mig. 169 — `crear_venta_atomica` y las RPCs de reserva no aceptan `deposito_id`.
- Series en venta: mig. 175 lo marca explícitamente como "fase 2", no implementado.
- Webhooks de stock: los triggers DB de ventas/órdenes no emiten `inventario.stock_bajo` (limitación documentada en `app/api/inventario/[id]/stock/route.ts:76-80`).

---

## 2. Principio rector

El usuario objetivo es un taller de servicio técnico con mostrador, no un operador logístico. "Profesional" significa: **datos en los que se puede confiar, números que cierran para el contador y una UX que no exige entrenamiento**. No significa más módulos.

Regla de decisión para features nuevas: si Odoo la tiene pero Loyverse no, probablemente sobra.

---

## 3. Roadmap por fases

Orden estricto: cada fase asume la anterior cerrada. Las fases son sub-proyectos independientes; cada una tendrá su propio plan de implementación y cadena de PRs.

### Fase 1 — Integridad: cerrar flujos a medias

Objetivo: que ningún feature existente produzca datos inconsistentes. Es prerequisito de todo lo demás (la Fase 4 sincroniza stock hacia afuera; sincronizar stock inconsistente es exportar el bug).

| # | Entrega | Detalle | Riesgo |
|---|---------|---------|--------|
| 1.1 | Multi-depósito en ventas y reservas | `crear_venta_atomica`, `editar_venta_atomica`, `add_repuesto_inventario`, `consumir_reservas_orden`, `reservar_items_cotizacion` y triggers de anulación/devolución aceptan y descuentan por `deposito_id`. POS y órdenes seleccionan depósito (default: depósito principal del usuario/sucursal). `inventario_depositos` pasa a ser fuente de verdad; `inventario.stock` queda como agregado sincronizado por trigger. | Alto — toca todas las RPCs de stock. Migración de datos: asignar stock actual al depósito principal. |
| 1.2 | Variantes en POS | `items_venta.variante_id` (nullable FK). POS: si el item tiene `tiene_variantes`, selector de variante obligatorio. `crear_venta_atomica` descuenta de `inventario_variantes.stock` vía `ajustar_stock_variante_atomic`; el agregado del padre se mantiene por el trigger existente `sync_inventario_total_variantes`. | Medio. |
| 1.3 | Series en venta | Si `trackea_series`: selector de serie disponible en POS; la venta marca `inventario_series.estado = 'VENDIDO'` y vincula `venta_id`. Anulación revierte a `DISPONIBLE`. | Bajo — tablas ya preparadas (mig. 175). |
| 1.4 | Lotes FEFO en venta | Si `trackea_lotes`: descuento automático del lote con vencimiento más próximo (FEFO) en `crear_venta_atomica`; sin selector manual en POS (se mantiene simple). Anulación devuelve al mismo lote. | Medio. |
| 1.5 | Webhooks de stock desde triggers | Los movimientos generados por ventas/órdenes/anulaciones emiten `inventario.stock_bajo` al cruzar umbral. Implementación: tabla outbox `webhook_outbox` poblada por trigger + drenaje desde el servidor (route handler o cron), porque los triggers DB no pueden hacer HTTP saliente de forma confiable. | Bajo. |

Criterio de salida: stock por depósito cuadra contra movimientos en una org con 2 depósitos operando ventas, órdenes, cotizaciones, anulaciones y devoluciones. Tests de integración por cada RPC modificada.

### Fase 2 — Valorización contable

Objetivo: números que un contador acepta.

| # | Entrega | Detalle |
|---|---------|---------|
| 2.1 | Costo promedio ponderado (CPP) | Columna `inventario.costo_promedio DECIMAL(10,4)`. Se recalcula en `recibir_orden_compra` y en ajustes de entrada con costo: `nuevo_cpp = (stock_actual × cpp_actual + cant_recibida × costo_unitario) / (stock_actual + cant_recibida)`. Las salidas no modifican CPP. `precio_compra` se mantiene como "último costo" (no romper nada existente). Valorización en reportes y stats pasa a usar CPP con fallback a `precio_compra` si CPP es null. Backfill inicial: `costo_promedio = precio_compra`. |
| 2.2 | Kardex valorizado | Reporte estándar: por item y rango de fechas, entradas/salidas/saldo con costo unitario (CPP al momento del movimiento), importe y saldo valorizado. Requiere snapshot de CPP en `movimientos_inventario` (columna nueva `costo_unitario_snapshot`, poblada desde 2.1 en adelante; movimientos históricos se muestran sin valorizar). Export XLSX incluido. Página en reportes. |
| 2.3 | Export XLSX inventario enriquecido | Columnas: stock por depósito, reservado, CPP, último costo, valorización CPP, rotación (de analisis-abc), lote/vencimiento más próximo. |

### Fase 3 — UX 360°: consolidar, no sumar

Objetivo: que el módulo se sienta profesional. Patrón Zoho/Odoo: una página por producto.

| # | Entrega | Detalle |
|---|---------|---------|
| 3.1 | Página detalle producto `/inventario/[id]` | Tabs: Resumen (stock por depósito, precios, CPP, imágenes), Movimientos (con filtros por tipo/fecha/usuario — cubre gap de filtros), Variantes, Lotes, Series, Kit/BOM, Compras (OCs del item), Analytics. Los dialogs existentes se reutilizan como contenido de tabs donde aplique. |
| 3.2 | Consolidar sub-rutas | `/inventario/variantes/[id]`, `/lotes`, `/series`, `/kits` redirigen al tab correspondiente del detalle. Quedan como páginas propias solo los PROCESOS: `/conteos`, `/analisis-abc`, `/reposicion`, `/importar-precios`. |
| 3.3 | Scanner-first | Acción global de escaneo en el header del módulo (reutiliza `barcode-scanner.tsx`): código encontrado → detalle 360°; no encontrado → form de alta con barcode precargado. |
| 3.4 | Reubicar `wipe-inventario` | Sale de mobile-only; va a `/configuracion` con doble confirmación tipeada (nombre de la org) y registro en auditoría. |

### Fase 4 — Diferencial comercial: sync multicanal

Objetivo: el feature que nadie del nicho tiene — un solo stock entre mostrador, MercadoLibre y TiendaNube.

| # | Entrega | Detalle |
|---|---------|---------|
| 4.1 | Vinculación de publicaciones | Tabla `canales_publicaciones` (item/variante ↔ ID de publicación externa, por canal). UI de vinculación en el tab Resumen del detalle 360°. |
| 4.2 | Stock saliente | Movimiento de stock local → push de stock a ML/TiendaNube (outbox de Fase 1.5 reutilizado; reintentos con backoff). |
| 4.3 | Venta entrante | Webhook de ML/TiendaNube → crea venta en STApp (canal marcado) → descuenta stock vía `crear_venta_atomica`. Manejo de colisión: venta externa con stock 0 local → alerta, no venta negativa. |

Esta fase requiere su propio ciclo completo de brainstorming (OAuth de ML, rate limits, idempotencia de webhooks, multi-cuenta). Acá solo se fija el lugar en el roadmap y sus prerequisitos: Fase 1 completa y 1.5 en particular.

---

## 4. Restar (decisiones explícitas de NO hacer)

- **Sin unidades de medida fraccionadas** (kg, metros). El nicho vende unidades.
- **Sin BOM multinivel ni manufactura.** Kits de un nivel (lo existente) alcanza.
- **Sin WMS** (ubicaciones por estantería escaneables, picking). `ubicacion` texto libre alcanza.
- **Sin FIFO/LIFO contable por capas.** CPP es el estándar esperado en LATAM y suficiente.
- **Sin selector manual de lote en POS.** FEFO automático; menos clicks en mostrador.

## 5. Backlog (válido, pero después del roadmap)

Listas de precios múltiples (minorista/mayorista) · reglas de markup por categoría · reorden automático (OC borrador) · alertas stock bajo por email/WhatsApp · import wizard CSV/XLSX con mapeo de columnas · factura de proveedor y cuentas por pagar · barcode server-side (PDF/ZPL térmica) · predicción de demanda.

## 6. Riesgos transversales

- **Fase 1.1 es el cambio más invasivo del sistema de stock desde mig. 043.** Mitigación: feature flag por org (`organizations.multi_deposito_enforced`), orgs con un solo depósito siguen el camino actual; rollout gradual.
- **Numeración de migraciones**: coordinar con worktrees activos (tip actual 205). Reservar rangos por fase antes de abrir PRs paralelos.
- **CPP con stock negativo histórico o costo 0**: definir en el plan de Fase 2 (propuesta: CPP no se recalcula si stock_actual < 0; costo 0 se promedia igual, con warning en UI).
- **Presupuesto de review**: cada fase excede 400 líneas → PRs encadenados obligatorios por entrega (1.1, 1.2, … cada una su PR o cadena).

## 7. Criterio de éxito global

1. Org con 2 depósitos opera 30 días sin descuadre stock-vs-movimientos.
2. Contador puede emitir kardex valorizado y valorización CPP de un período cerrado.
3. Un producto se gestiona completo (stock, variantes, lotes, series, compras, analytics) sin salir de su página de detalle.
4. Venta en MercadoLibre descuenta stock local en < 1 min (Fase 4).

## 8. Próximo paso

Plan de implementación de **Fase 1.1 (multi-depósito en ventas y reservas)** — la entrega de mayor riesgo y mayor valor de integridad.
