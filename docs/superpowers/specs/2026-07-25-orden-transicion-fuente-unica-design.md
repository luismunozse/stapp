# Diseño: fuente única para las transiciones de estado de órdenes

**Fecha:** 2026-07-25
**Estado:** aprobado
**Alcance:** rutear todas las escrituras de `estado` de `ordenes_servicio` a través de la máquina de estados, con un update atómico que cierra las carreras TOCTOU.

## Contexto y problema

`lib/orden-state-machine.ts` es la máquina de estados central (transiciones válidas + campos requeridos). Hoy solo la usan dos rutas: el `PUT /api/ordenes/[id]` y el `POST /api/ordenes/[id]/entregar`.

El resto de los flujos que cambian el estado de una orden (portal del cliente, cotizaciones, bot de WhatsApp) escriben `estado` **sin pasar por la máquina de estados**, con un patrón *"chequeo el estado, después hago UPDATE ciego por id"*. Esto produce dos problemas:

1. **Bug real y determinístico (#6a).** `revertirOrdenSinPresupuestoActivo` (`app/api/cotizaciones/[id]/route.ts:79`) setea `EN_DIAGNOSTICO`, y su caller (`recalcPresupuestoOrden`, línea 130) lo invoca cuando la orden está en `PRESUPUESTADO` **o `APROBADO`**. Pero `APROBADO → EN_DIAGNOSTICO` es una transición **inválida** (`APROBADO` solo permite `EN_REPARACION` y `CANCELADO`). Cuando a una orden ya aprobada se le borra/desvincula la última cotización activa, regresa en silencio a `EN_DIAGNOSTICO` y se le borra `costo_final`.

2. **Patrón TOCTOU sistémico.** Las ~10 llamadas hacen fetch-del-estado y luego UPDATE por `id` sin `.eq("estado", esperado)`. Un doble-click en el portal del cliente, o mensajes casi simultáneos del bot, pueden pisar estado (last-write-wins) y duplicar eventos/notificaciones.

## Objetivos

- Una **fuente única** para aplicar transiciones de estado de órdenes: validación por la máquina de estados + update atómico.
- Cerrar el bug #6a.
- Cerrar la ventana de carrera TOCTOU en las escrituras existentes.
- Sin cambios de UX para los flujos que hoy funcionan correctamente.

## No-objetivos

- No se cambian las transiciones válidas de la máquina de estados (salvo lo que exija la decisión de #6a, que en este diseño **no** agrega transiciones).
- No se toca el `PUT` ni `/entregar` (ya están gateados).
- No se rediseña el flujo de cotizaciones más allá de las escrituras de estado.

## Diseño

### 1. Helper `transicionarOrden` — nuevo `lib/orden-transicion.ts`

`lib/orden-state-machine.ts` se mantiene **puro** (sin dependencias de base de datos). El helper nuevo vive en un archivo aparte que importa la máquina de estados y recibe el cliente de Supabase.

```ts
type ResultadoTransicion =
  | { ok: true;  estado: EstadoOrden }
  | { ok: false; motivo: "TRANSICION_INVALIDA"; mensaje: string }
  | { ok: false; motivo: "ESTADO_CAMBIO" }   // 0 filas: la orden ya no está en `esperado`

async function transicionarOrden(
  supabase: SupabaseClient,
  params: {
    ordenId: string
    organizationId: string
    esperado: EstadoOrden          // estado en el que creemos que está la orden
    nuevo: EstadoOrden             // estado destino
    camposExtra?: Record<string, unknown>  // p.ej. presupuesto, costo_final, urls de firma
  }
): Promise<ResultadoTransicion>
```

**Lógica:**

1. Si `!esTransicionValida(esperado, nuevo)` → `{ ok:false, motivo:"TRANSICION_INVALIDA", mensaje: getMensajeTransicionInvalida(esperado, nuevo) }`. (Esto atrapa el intento inválido del bug #6a.)
2. UPDATE atómico:
   ```ts
   supabase.from("ordenes_servicio")
     .update({ estado: nuevo, ...camposExtra })
     .eq("id", ordenId)
     .eq("organization_id", organizationId)
     .eq("estado", esperado)      // guarda de concurrencia
     .select("id")
   ```
3. Si afecta 0 filas → `{ ok:false, motivo:"ESTADO_CAMBIO" }` (la orden cambió entre el fetch y el update).
4. Si afecta 1 fila → `{ ok:true, estado: nuevo }`.
5. Un error real de DB (`error != null`) se **lanza** (los callers ya usan try/catch).

Los `orden_eventos` (timeline) **quedan en cada caller**, gateados por `ok:true`, porque cada ruta arma su propia descripción/metadata.

### 2. Wiring de las llamadas

| Ruta / archivo | `esperado → nuevo` | En mismatch (`ESTADO_CAMBIO`) |
|---|---|---|
| `app/api/whatsapp/webhook/route.ts` | `PRESUPUESTADO → APROBADO` | **no-op silencioso** (bot, sin request/response UX) |
| `app/api/public/ordenes/[token]/approve-budget/route.ts` | `PRESUPUESTADO → APROBADO` | `400` |
| `lib/cotizacion-aprobar-orden.ts` (3 callers) | `PRESUPUESTADO → APROBADO` | propaga resultado → caller responde `400` |
| `app/api/public/ordenes/[token]/reject-budget/route.ts` | `PRESUPUESTADO → EN_DIAGNOSTICO` | `400` |
| `app/api/public/cotizaciones/[token]/rechazar/route.ts` | `PRESUPUESTADO → EN_DIAGNOSTICO` | `400` |
| `app/api/cotizaciones/[id]/route.ts` (revertir) | `PRESUPUESTADO → EN_DIAGNOSTICO` | ver sección 3 |
| `app/api/cotizaciones/[id]/route.ts:505` | `RECIBIDO\|EN_DIAGNOSTICO → PRESUPUESTADO` | `400` |
| `app/api/cotizaciones/[id]/enviar/route.ts` | `RECIBIDO\|EN_DIAGNOSTICO → PRESUPUESTADO` | `400` |

Para los sitios con `esperado` dinámico (RECIBIDO o EN_DIAGNOSTICO), se pasa `esperado = ordenActual.estado` (fetch fresco), y el `.eq("estado", esperado)` garantiza atomicidad.

Los 3 callers de `lib/cotizacion-aprobar-orden.ts` son: `app/api/public/ordenes/[token]/approve-cotizacion/route.ts`, `app/api/public/cotizaciones/[token]/aprobar/route.ts` y `app/api/cotizaciones/[id]/aprobar/route.ts`. El helper `aplicarAprobacionCotizacionAOrden` pasa a devolver un resultado tipado que los 3 traducen a su respuesta.

### 3. Bug #6a — bloquear el borrado en `APROBADO`

Decisión de negocio: no se puede borrar/desvincular la última cotización activa de una orden **aprobada**.

En el `DELETE` de cotización (y en el path de desvinculación, si aplica), **antes** de borrar: si al quedar sin cotizaciones activas la orden está en `APROBADO`, responder `400` con un mensaje claro ("No se puede borrar la última cotización de una orden aprobada. Cancelá o mové la orden primero."). No se borra la cotización.

Con esto, `revertirOrdenSinPresupuestoActivo` solo se ejecuta para órdenes en `PRESUPUESTADO`, y pasa por `transicionarOrden(esperado="PRESUPUESTADO", nuevo="EN_DIAGNOSTICO", camposExtra={presupuesto:null, costo_final:null, ...})` — transición válida. Si por defensa el helper recibiera `APROBADO`, devuelve `TRANSICION_INVALIDA` y no corrompe el estado.

### 4. Manejo de errores

- **Portal del cliente / staff autenticado:** `ESTADO_CAMBIO` → `400` con mensaje ("El estado de la orden cambió; recargá e intentá de nuevo."). `TRANSICION_INVALIDA` no debería ocurrir en flujos válidos; si ocurre, `400` con el mensaje de la máquina.
- **Bot de WhatsApp:** `ESTADO_CAMBIO` → **no-op silencioso** (no hay UX de error que mostrar). No se envía notificación ni se inserta evento.
- El evento `orden_eventos` y las notificaciones se emiten **solo** en `ok:true`.

### 5. Testing (TDD estricto)

- **Unit `transicionarOrden`** (`lib/__tests__/orden-transicion.test.ts`): transición inválida → `TRANSICION_INVALIDA`; válida con 1 fila → `ok`; válida con 0 filas → `ESTADO_CAMBIO`; passthrough de `camposExtra`; scoping por `organization_id`; error de DB → lanza.
- **Integración de rutas**: actualizar/agregar tests de las rutas afectadas para el nuevo resultado atómico, más un test del bloqueo `APROBADO` en el `DELETE` de cotización.

### 6. Entrega

El cambio es grande (~10 call sites en ~8 archivos + helper + tests). Probablemente supere el presupuesto de 400 líneas. La fase de `writing-plans` decide el corte en PRs encadenadas; corte sugerido:

1. **Helper + unit tests** (`lib/orden-transicion.ts` + su test) — sin cambios de comportamiento.
2. **Migrar rutas de cotización + fix #6a** (bloqueo APROBADO + revertir + enviar + [id]).
3. **Migrar rutas de portal + webhook** (approve-budget, reject-budget, rechazar, whatsapp).

## Riesgos

- Toca flujos **customer-facing** (portal de aprobación/rechazo de presupuesto). El update atómico puede convertir en `400` casos que antes pasaban por race; es el comportamiento deseado, pero requiere tests de las rutas.
- `aplicarAprobacionCotizacionAOrden` es compartido por 3 callers: cambiar su firma a un resultado tipado impacta a los 3 (hay que actualizarlos juntos).
- El bloqueo del borrado en `APROBADO` es un **cambio de comportamiento** observable para el staff.
