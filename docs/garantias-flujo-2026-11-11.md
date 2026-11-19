# Garantías: mapa del flujo actual y propuesta

_Fecha: 2026-11-11._

- **Origen:** la tarjeta "Garantías por vencer" del dashboard lleva a `/ordenes`, que no tiene filtro de garantías (auditoría UX, PR #646).
- **Cómo se hizo:** investigación de solo lectura.
- **Confianza:** [V] = verificado en el código · [I] = inferido.

---

## 1. Qué existe hoy

Hay **cuatro conceptos de "garantía" que no se conectan entre sí** [V]:

| | Concepto | Dónde vive | Nace en | Estados |
|---|---|---|---|---|
| A | Garantía de **reparación** | `garantias` (001:378), 1 por orden (`orden_id UNIQUE`), **sin `organization_id`** | entrega (checkbox, días por defecto de la org) · POST manual · presupuesto convertido · reparación express | ACTIVA / VENCIDA / RECLAMADA |
| B | **Reclamos** (solo de A) | `reclamos_garantia` (001:392) | card de garantía en el detalle de orden | PENDIENTE / EN_REVISION / ACEPTADO / RECHAZADO / RESUELTO |
| C | Garantía de **venta** | `garantias_venta` (016:69), 1 por **línea**, con número correlativo | RPC `crear_venta_atomica` (días del producto → de la org → 0) | ACTIVA / ANULADA (VENCIDA y RECLAMADA **nunca se escriben**) |
| D | Garantía de **proveedor** por serie | `inventario_series.fecha_garantia_vence` (175:114) | ingreso de serie y venta | `GARANTIA_ACTIVA` (columna sobrecargada) |

Además, el **re-ingreso** se marca en `ordenes_servicio` con `orden_origen_id`, `es_reingreso` y `garantia_origen_id` (TEXT, sin FK) (068:75).

### Dónde lo ve el usuario
- **Dashboard:**
  - La tarjeta suma A + C, con una ventana de 7 días.
  - Las órdenes se filtran por sucursal; las ventas son de toda la org.
  - Lleva a `/ordenes`, sin filtro.
  - Las alertas muestran 3 garantías de orden (con link) y garantías de venta como texto plano.
- **Detalle de orden:** `GarantiaCard`, al final de todo y solo si la orden está ENTREGADO.
- **Ventas:** botón "Gestión de Garantías", que abre un **modal** de solo lectura con una ventana de **30 días**.
- **Detalle de venta:** muestra el enum crudo ("ACTIVA"), incluso cuando la garantía ya venció.
- **Reclamos abiertos:** **no hay forma de listarlos**; hay que abrir orden por orden.

---

## 2. Problemas encontrados

### Bugs (se pueden arreglar ya, sin decisiones de producto)
1. **[V]** **La card de garantía:**
   - Pide `GET /api/garantias?ordenId=…`, pero la API **ignora `ordenId`**, así que trae todas las garantías de la org (con sus reclamos) y además escribe VENCIDA en lote.
   - La API devuelve los reclamos en snake_case (`fecha_reclamo`) y la card lee camelCase (`fechaReclamo`). Por eso **la fecha del reclamo sale vacía** y nunca aparece "Nueva orden de reparación creada".
2. **[V]** **Presupuesto → orden** (`convertir-orden/route.ts:203-218`):
   - Crea la garantía **cuando la orden está en RECIBIDO**, así que el plazo corre desde el ingreso.
   - Calcula el vencimiento con `setDate` en la hora del servidor.
   - Como `orden_id` es UNIQUE, la garantía de la entrega falla en silencio.
3. **[V]** **Entrega:** el insert de la garantía no revisa el error (`entregar/route.ts:272-282`) y no le avisa al cliente. `GARANTIA_CREADA` solo sale desde el POST manual.
4. **[V]** **Reclamo aceptado → orden nueva:** se crea **sin** `es_reingreso`, `orden_origen_id`, `garantia_origen_id` ni `sucursal_id`. No entra en las métricas de reingreso y no se puede rastrear.
5. **[V]** **Re-ingreso desde el menú "⋯":** no valida que exista una garantía vigente y nunca guarda `garantia_origen_id`. `REINGRESO_GARANTIA` no se encola nunca.
6. **[V]** **Editar una venta** borra y recrea sus garantías, y se pierde el estado.
7. **[V]** **Link público de seguimiento:** vence a los 30 días de la entrega. Si la garantía dura 90, el cliente pierde el acceso al certificado a los 30.
8. **[V]** **Zona horaria:** hay cuatro formas distintas de calcular los vencimientos (`addDaysInTimeZone`, `setDate` del servidor, `NOW()+interval`, `CURRENT_DATE`).
9. **[V]** **Estado VENCIDA "lazy":** solo se escribe cuando alguien abre la pantalla. El estado guardado no es confiable.
10. **[V]** **Métricas de reingreso:** las del técnico no cuentan las órdenes nacidas de un reclamo; las de comisiones sí.

### UX/UI
- No hay página ni ítem de menú de garantías; la de ventas es un modal escondido.
- `garantia-card.tsx` usa colores crudos sin modo oscuro y `prompt()` nativo para rechazar o resolver. Muestra botones de crear y editar a roles que reciben 403 al guardar.
- La garantía de venta muestra el enum crudo y un estado engañoso.
- No hay un texto de **términos de garantía** configurable: las "condiciones" se escriben a mano en cada entrega.
- El cliente no ve en el seguimiento si su reclamo está en curso.
- Falta la tilde en "garantía" en el menú, los banners, los emails y WhatsApp.

---

## 3. Propuesta (recomendación)

**Idea central:** una sola noción de **Garantía** con **origen** (Reparación o Venta), una sola **página `/garantias`** y un solo **flujo de reclamo**, que siempre termina en un **re-ingreso vinculado**.

### 3.1 Modelo
- **Lectura unificada:** una vista SQL `v_garantias` (UNION de A y C) con `origen`, `organization_id`, `sucursal_id`, `cliente`, `item/equipo`, `fecha_inicio`, `fecha_vencimiento` y un **estado derivado**: VIGENTE / POR_VENCER / VENCIDA / RECLAMADA / ANULADA.
  - El estado se calcula con la fecha del taller y deja de escribirse "lazy".
  - Las tablas no se migran; la vista solo unifica la lectura.
- **Garantía de reparación:** se agrega `organization_id` a `garantias` (backfill desde la orden).
- **Reclamos:** pasan a cubrir los dos orígenes, `garantia_id` o `garantia_venta_id` (con un CHECK de exactamente uno). El ciclo se simplifica:
  - **ABIERTO** → **ACEPTADO**, que crea el re-ingreso vinculado, o **RECHAZADO**, con motivo.
  - De ACEPTADO pasa a **RESUELTO** solo, cuando se entrega la orden de re-ingreso.
- **Garantía de proveedor (D):** queda en inventario, fuera de esta vista.

### 3.2 Flujo
1. **Nace al entregar.** Los días se toman del presupuesto, del servicio o del valor por defecto de la org. El alcance (repuesto / mano de obra / ambos) queda estructurado.
   - El presupuesto ya no crea la garantía: guarda las condiciones en la orden y la entrega las aplica.
   - Se notifica al cliente con `GARANTIA_CREADA`.
2. **Venta:** queda como está (por línea). Si se edita la venta, se conserva el estado de cada garantía.
3. **Reclamo (cualquier rol lo registra):** desde la página de garantías, el detalle de la orden o venta, o la búsqueda por cliente o número. Valida que la garantía esté vigente; el ADMIN puede forzarlo dejando un motivo.
4. **Decisión (ADMIN):**
   - **Aceptar** crea una orden de re-ingreso sin cargo, con todos los vínculos y la sucursal.
   - **Rechazar** pide un motivo en un diálogo propio, no en un `prompt`.
5. **"Re-ingreso por garantía"** del menú pasa a ser un atajo del mismo flujo: registra el reclamo y lo acepta en un paso. Deja de haber dos caminos.
6. **Métricas:** el reingreso cuenta contra el **técnico de la orden original**, igual en técnicos y en comisiones.

### 3.3 Pantallas
- **`/garantias`** (menú Operación; para ADMIN y VENDEDOR, y para TECNICO en solo lectura):
  - Pestañas: **Por vencer · Reclamos abiertos · Vigentes · Vencidas y anuladas**.
  - Filtros: origen, sucursal y búsqueda por cliente, orden, venta o número de certificado.
  - Cada fila muestra cliente, equipo o producto, origen, vencimiento ("vence en 5 días") y estado en `StatusPill`, con texto y color.
  - Acciones de cada fila: Registrar reclamo, Ver orden/venta, Certificado PDF y WhatsApp.
- **Dashboard:** la tarjeta lleva a `/garantias?tab=por-vencer`, con la **misma ventana y el mismo alcance** que la página. Se suma "Reclamos abiertos" al strip de acciones.
- **Detalle de orden:** la garantía pasa a ser una línea en el encabezado ("Garantía hasta 12/02 · 23 días"), con el detalle en una pestaña. Los reclamos se muestran como timeline.
- **Detalle de venta:** estado derivado ("Vencida", no "ACTIVA") y "Registrar reclamo" por línea.
- **Seguimiento público:** el link dura **hasta que vence la garantía**. Muestra la garantía y el estado del reclamo con copy para el cliente.
- **Configuración:**
  - **Términos de garantía** de la org, que se imprimen en el comprobante de entrega y en el certificado.
  - Ventana "por vencer" (por defecto 7 días).
  - Aviso al cliente antes del vencimiento (opcional, apagado por defecto).
- **Visual:** tokens y modo oscuro, `ConfirmDialog`, y la palabra "garantía" con tilde en todos lados.

### 3.4 Fases
- **Fase 0 (bugs, ya):** puntos 1, 2, 3 y 7 de §2 más los arreglos de UX de la card (roles, modo oscuro, `prompt`). Es un PR chico que no depende de las decisiones.
- **Fase 1:** vista `v_garantias`, API unificada y página `/garantias`. La tarjeta del dashboard apunta ahí.
- **Fase 2:** reclamos unificados (reparación + venta), re-ingreso único con vínculos, RESUELTO automático y métricas por técnico original.
- **Fase 3:** términos configurables, notificaciones (emisión y por vencer) y seguimiento extendido.

---

## 4. Decisiones del dueño

Las decisiones 1 a 4 están **confirmadas por el dueño el 2026-11-11**. Las 5 a 9 son la recomendación por defecto hasta que el dueño diga otra cosa.

| # | Pregunta | Decisión |
|---|---|---|
| 1 | ¿Una página `/garantias` que unifique reparación y venta? | ✅ Sí |
| 2 | ¿Las garantías de venta se pueden reclamar con el mismo flujo? | ✅ Sí |
| 3 | ¿Quién registra y quién decide un reclamo? | ✅ Registra cualquier rol; decide ADMIN |
| 4 | ¿Desde cuándo corre la garantía de reparación? | ✅ Desde la entrega |
| 5 | Ventana "por vencer" | 7 días, configurable |
| 6 | ¿Aviso al cliente antes de que venza? | Opcional, apagado por defecto |
| 7 | ¿El link de seguimiento dura lo mismo que la garantía? | Sí |
| 8 | ¿El reingreso cuenta contra el técnico original? | Sí |
| 9 | ¿Las garantías de proveedor por serie entran en la vista? | No, quedan en inventario |
