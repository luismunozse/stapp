# PreApproval de MercadoPago — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un taller pueda adherir al débito automático de MercadoPago y que su suscripción se renueve sola, sin que el cron lo bloquee mientras MercadoPago reintenta un cobro.

**Architecture:** El lado receptor ya existe (`createSubscription`, los dos handlers de webhook, `cancelPreApproval`, la columna `mercadopago_preapproval_id`). Este plan agrega el lado emisor —una ruta que crea el PreApproval y un selector en el modal de upgrade— completa la activación en el webhook, y enseña al cron a distinguir "venció la fecha" de "el cobro está rebotando".

**Tech Stack:** Next.js App Router, TypeScript, Supabase (`supabaseAdmin`), SDK de MercadoPago (`mercadopago`), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-22-preapproval-mercadopago-design.md`

## Global Constraints

- **El débito automático NO es el default del selector.** El default es pago único; adherir es una elección explícita. Motivo en §3.2 del spec.
- **Ventana de gracia: 12 días.** MercadoPago reintenta 10 días con máximo 4 intentos; los 2 restantes son margen para el webhook. El número vive en una constante, no repetido en el código.
- **La cancelación que reporta MercadoPago no sirve como señal de bloqueo**: recién cancela tras 3 cuotas rechazadas (~3 meses).
- **No se toca `handleAuthorizedPaymentNotification` ni `handlePaymentNotification`.** Ya sobrevivieron a un bug de producción y son el camino del cobro mensual.
- Identificadores y comentarios de código en español neutro, como el resto del repo. Copy de UI en español.
- Comando de test: `npm run test:run`. Un test específico: `npx vitest run <ruta>`.
- Los números de migración se asignan al mergear. Este plan no crea migraciones.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `app/api/mercadopago/preapproval/route.ts` (nuevo) | Crear el PreApproval y devolver su `init_point` |
| `lib/subscriptions/sweep-rules.ts` (nuevo) | Las dos reglas del cron, puras y testeables |
| `components/billing/upgrade-modal.tsx` (modificar) | Selector pago único / débito automático |
| `app/api/mercadopago/webhook/route.ts` (modificar, `handlePreApprovalNotification` ~581) | Completar la activación: plan, período de facturación, proveedor |
| `app/api/cron/subscription-sweep/route.ts` (modificar) | Consumir las reglas puras |
| `lib/subscriptions.ts` (modificar) | Agregar `autoDebito` a `SubscriptionInfo` |
| `components/billing/current-plan.tsx` (modificar, ~117-126) | Copy honesto según haya o no débito automático |

---

# PR 1 — Alta y activación

### Task 1: Ruta que crea el PreApproval

**Files:**
- Create: `app/api/mercadopago/preapproval/route.ts`
- Test: `__tests__/api/mercadopago-preapproval.test.ts`

**Interfaces:**
- Consumes: `createSubscription({ organizationId, organizationName, email, billingPeriod, backUrl, planSlug })` de `lib/mercadopago.ts:133`, que devuelve el objeto PreApproval de MercadoPago (tiene `id` e `init_point`).
- Produces: `POST /api/mercadopago/preapproval` → `{ preapprovalId: string, initPoint: string }`.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/api/mercadopago-preapproval.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/mercadopago", () => ({
  createSubscription: vi.fn(),
}))

import { createSubscription } from "@/lib/mercadopago"
import { POST } from "@/app/api/mercadopago/preapproval/route"

describe("POST /api/mercadopago/preapproval", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createSubscription).mockResolvedValue({
      id: "pre-1",
      init_point: "https://mp.com/adherir/pre-1",
    } as never)
  })

  it("401 si no esta autenticado", async () => {
    mockAuthError()
    const res = await POST(createPostRequest({}) as never)
    const { status } = await parseResponse(res)
    expect(status).toBe(401)
  })

  it("404 si la organizacion esta inactiva", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      organizations: createChainMock({ id: "org-1", nombre: "Taller", activo: false }),
    })

    const res = await POST(createPostRequest({}) as never)
    const { status } = await parseResponse(res)
    expect(status).toBe(404)
  })

  it("devuelve el init_point de la adhesion", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      organizations: createChainMock({
        id: "org-1",
        nombre: "Taller",
        email: "taller@test.com",
        activo: true,
      }),
    })

    const res = await POST(createPostRequest({ planSlug: "profesional" }) as never)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.initPoint).toBe("https://mp.com/adherir/pre-1")
    expect(body.preapprovalId).toBe("pre-1")
  })

  it("le pasa a MercadoPago la organizacion del usuario, no la del request", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    mockSupabaseFrom({
      organizations: createChainMock({
        id: "org-1",
        nombre: "Taller",
        email: "taller@test.com",
        activo: true,
      }),
    })

    await POST(createPostRequest({ organizationId: "org-999" }) as never)

    expect(vi.mocked(createSubscription)).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1" })
    )
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run __tests__/api/mercadopago-preapproval.test.ts`
Expected: FAIL — no existe `@/app/api/mercadopago/preapproval/route`.

- [ ] **Step 3: Escribir la implementación mínima**

Crear `app/api/mercadopago/preapproval/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { createSubscription } from "@/lib/mercadopago"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const preapprovalSchema = z.object({
  billingPeriod: z.enum(["MONTHLY", "YEARLY"]).optional(),
  planSlug: z.string().optional(),
})

/**
 * Crea una adhesion al debito automatico (PreApproval de MercadoPago).
 *
 * Ruta separada de /api/mercadopago/preference a proposito: son dos objetos
 * distintos de MercadoPago, con dos respuestas distintas y dos ciclos de vida
 * distintos. Mezclarlas obligaria al caller a adivinar que recibio.
 *
 * La organizacion sale SIEMPRE de la sesion, nunca del body: el monto y el plan
 * los decide el servidor.
 */
export async function POST(request: NextRequest) {
  try {
    const { error, session, organizationId } = await requireAuth()
    if (error) return error

    const body = await request.json()
    const { billingPeriod = "MONTHLY", planSlug } = preapprovalSchema.parse(body)

    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .select("id, nombre, email, activo")
      .eq("id", organizationId)
      .single()

    if (orgError || !org || org.activo === false) {
      return NextResponse.json(
        { error: "Organización no encontrada o inactiva" },
        { status: 404 }
      )
    }

    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000"

    const preApproval = await createSubscription({
      organizationId: org.id,
      organizationName: org.nombre,
      email: org.email || session?.user?.email || "",
      billingPeriod: billingPeriod as "MONTHLY" | "YEARLY",
      backUrl: `${baseUrl}/configuracion/billing?mp_adhesion=true`,
      planSlug,
    })

    return NextResponse.json({
      preapprovalId: preApproval.id,
      initPoint: preApproval.init_point,
    })
  } catch (error) {
    console.error("Error creando adhesión de MercadoPago:", error)
    return NextResponse.json(
      { error: "Error al crear la adhesión al débito automático" },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run __tests__/api/mercadopago-preapproval.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/mercadopago/preapproval/route.ts __tests__/api/mercadopago-preapproval.test.ts
git commit -m "feat(billing): ruta de adhesion al debito automatico de MercadoPago"
```

---

### Task 2: Selector en el modal de upgrade

**Files:**
- Modify: `components/billing/upgrade-modal.tsx` (el bloque `handleUpgrade`, ~línea 94)

**Interfaces:**
- Consumes: `POST /api/mercadopago/preapproval` de la Task 1, que devuelve `{ initPoint }`.
- Produces: nada que consuman otras tasks.

- [ ] **Step 1: Agregar el estado del selector**

En `components/billing/upgrade-modal.tsx`, junto a los demás `useState` del componente:

```tsx
  // Pago único es el DEFAULT a proposito: el debito automatico es una
  // autorizacion permanente sobre el medio de pago del taller, y que venga
  // preseleccionada empuja a darla sin decidirlo. Ver spec §3.2.
  const [modoCobro, setModoCobro] = useState<"unico" | "automatico">("unico")
```

- [ ] **Step 2: Rutear según el modo elegido**

Reemplazar el bloque de MercadoPago dentro de `handleUpgrade`:

```tsx
      if (paymentMethod === "mercadopago") {
        const ruta =
          modoCobro === "automatico"
            ? "/api/mercadopago/preapproval"
            : "/api/mercadopago/preference"

        const response = await fetch(ruta, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ billingPeriod, planSlug }),
        })

        const data = await response.json()

        if (data.initPoint) {
          await openPaymentUrl(data.initPoint)
        } else {
          throw new Error(data.error || "No se pudo iniciar el pago")
        }
      } else {
```

- [ ] **Step 3: Renderizar el selector**

Dentro del bloque que se muestra cuando `paymentMethod === "mercadopago"`, antes del botón de pago:

```tsx
<div className="space-y-2">
  <label className="flex items-start gap-2 cursor-pointer">
    <input
      type="radio"
      name="modo-cobro"
      value="unico"
      checked={modoCobro === "unico"}
      onChange={() => setModoCobro("unico")}
      className="mt-1"
    />
    <span className="text-sm">
      <span className="font-medium">Pago único</span>
      <span className="block text-xs text-muted-foreground">
        Pagás este mes. Cuando venza, lo renovás vos.
      </span>
    </span>
  </label>

  <label className="flex items-start gap-2 cursor-pointer">
    <input
      type="radio"
      name="modo-cobro"
      value="automatico"
      checked={modoCobro === "automatico"}
      onChange={() => setModoCobro("automatico")}
      className="mt-1"
    />
    <span className="text-sm">
      <span className="font-medium">Débito automático</span>
      <span className="block text-xs text-muted-foreground">
        Se cobra solo todos los meses. Lo cancelás cuando quieras.
      </span>
    </span>
  </label>
</div>
```

- [ ] **Step 4: Verificar tipos y lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: 0 errores.

- [ ] **Step 5: Commit**

```bash
git add components/billing/upgrade-modal.tsx
git commit -m "feat(billing): elegir entre pago unico y debito automatico"
```

---

### Task 3: Completar la activación en el webhook

**Files:**
- Modify: `app/api/mercadopago/webhook/route.ts` (`handlePreApprovalNotification`, ~581)
- Test: `__tests__/api/mercadopago-preapproval-activacion.test.ts`

**Interfaces:**
- Consumes: el `external_reference` que escribe `createSubscription` — `{ organization_id, billing_period, plan_id, plan_slug }`.
- Produces: nada que consuman otras tasks.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/api/mercadopago-preapproval-activacion.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createChainMock, mockSupabaseFrom } from "./helpers"

import { handlePreApprovalNotification } from "@/app/api/mercadopago/webhook/route"

const PREAPPROVAL = {
  id: "pre-1",
  status: "authorized",
  external_reference: JSON.stringify({
    organization_id: "org-1",
    billing_period: "MONTHLY",
    plan_id: "plan-pro",
    plan_slug: "profesional",
  }),
}

describe("handlePreApprovalNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(PREAPPROVAL), { status: 200 })
    ) as never
  })

  afterEach(() => vi.restoreAllMocks())

  it("activa la suscripcion CON el plan de la adhesion, no con el que tenia", async () => {
    const subs = createChainMock(null, null)
    mockSupabaseFrom({ subscriptions: subs })

    await handlePreApprovalNotification("pre-1")

    expect(subs.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ACTIVE",
        plan_id: "plan-pro",
        billing_period: "MONTHLY",
        payment_provider: "MERCADOPAGO",
        mercadopago_preapproval_id: "pre-1",
      })
    )
  })

  it("no inventa un periodo: eso lo fija el primer cobro", async () => {
    const subs = createChainMock(null, null)
    mockSupabaseFrom({ subscriptions: subs })

    await handlePreApprovalNotification("pre-1")

    const escrito = subs.update.mock.calls[0][0]
    expect(escrito).not.toHaveProperty("current_period_end")
  })

  it("mapea paused a PAST_DUE", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ...PREAPPROVAL, status: "paused" }), { status: 200 })
    ) as never
    const subs = createChainMock(null, null)
    mockSupabaseFrom({ subscriptions: subs })

    await handlePreApprovalNotification("pre-1")

    expect(subs.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "PAST_DUE" })
    )
  })

  it("un estado desconocido no rompe ni activa nada", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ...PREAPPROVAL, status: "pending" }), { status: 200 })
    ) as never
    const subs = createChainMock(null, null)
    mockSupabaseFrom({ subscriptions: subs })

    const r = await handlePreApprovalNotification("pre-1")

    expect(r.status).toBe("SKIPPED")
    expect(subs.update).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run __tests__/api/mercadopago-preapproval-activacion.test.ts`
Expected: FAIL — `handlePreApprovalNotification` no está exportada, y cuando lo esté, el `update` no incluye `plan_id`.

- [ ] **Step 3: Implementar**

En `app/api/mercadopago/webhook/route.ts`, exportar la función y reemplazar el bloque final:

```ts
export async function handlePreApprovalNotification(
```

```ts
  const statusMap: Record<string, "ACTIVE" | "CANCELED" | "PAST_DUE"> = {
    authorized: "ACTIVE",
    paused: "PAST_DUE",
    cancelled: "CANCELED",
  }

  const status = statusMap[preApproval.status]

  // Un estado que no conocemos no se traduce a ACTIVE por default: activar una
  // suscripcion por un estado que no entendemos es regalar el plan pago.
  if (!status) {
    console.log(`[MP webhook] PreApproval ${preApprovalId} en estado ${preApproval.status} - sin accion`)
    return { status: "SKIPPED", reason: `preapproval_status_${preApproval.status}`, organizationId }
  }

  // Se escribe el plan de la adhesion: sin esto la organizacion queda ACTIVE
  // sobre el plan que tuviera antes — adhiere al Profesional y sigue con los
  // limites del Free.
  //
  // NO se escribe current_period_start/end: el periodo lo fija el primer cobro,
  // que llega como subscription_authorized_payment. El guard de la Task 4 cubre
  // la adhesion cuyo cobro nunca llega.
  await supabaseAdmin
    .from("subscriptions")
    .update({
      status,
      plan_id: externalRef.plan_id ?? undefined,
      billing_period: externalRef.billing_period ?? undefined,
      payment_provider: "MERCADOPAGO",
      mercadopago_preapproval_id: preApprovalId,
    })
    .eq("organization_id", organizationId)

  console.log(`[MP webhook] PreApproval ${preApprovalId} updated to ${status}`)
  return { status: "PROCESSED", organizationId }
```

Ampliar el tipo de `externalRef` en esa función:

```ts
  let externalRef: {
    organization_id?: string
    plan_id?: string
    billing_period?: "MONTHLY" | "YEARLY"
  }
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run __tests__/api/mercadopago-preapproval-activacion.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/mercadopago/webhook/route.ts __tests__/api/mercadopago-preapproval-activacion.test.ts
git commit -m "fix(billing): la adhesion activa el plan que se contrato"
```

---

### Task 4: Guard de la adhesión sin cobro

**Files:**
- Create: `lib/subscriptions/sweep-rules.ts`
- Test: `__tests__/lib/sweep-rules.test.ts`
- Modify: `app/api/cron/subscription-sweep/route.ts`

**Interfaces:**
- Produces: `DIAS_GRACIA_PREAPPROVAL: number`, y `esAdhesionSinCobro({ tienePreapproval, currentPeriodEnd, createdAt, pagosExitosos, ahora }): boolean`. La Task 5 agrega `venceLaGracia` al mismo archivo.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/lib/sweep-rules.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { esAdhesionSinCobro, DIAS_GRACIA_PREAPPROVAL } from "@/lib/subscriptions/sweep-rules"

const AHORA = new Date("2026-08-22T12:00:00Z")

function hace(dias: number) {
  const d = new Date(AHORA)
  d.setDate(d.getDate() - dias)
  return d.toISOString()
}

describe("esAdhesionSinCobro", () => {
  it("marca la adhesion vieja que nunca cobro", () => {
    expect(
      esAdhesionSinCobro({
        tienePreapproval: true,
        currentPeriodEnd: null,
        createdAt: hace(20),
        pagosExitosos: 0,
        ahora: AHORA,
      })
    ).toBe(true)
  })

  it("no toca una adhesion recien hecha: puede estar esperando el primer cobro", () => {
    expect(
      esAdhesionSinCobro({
        tienePreapproval: true,
        currentPeriodEnd: null,
        createdAt: hace(3),
        pagosExitosos: 0,
        ahora: AHORA,
      })
    ).toBe(false)
  })

  it("no toca una adhesion que ya cobro alguna vez", () => {
    expect(
      esAdhesionSinCobro({
        tienePreapproval: true,
        currentPeriodEnd: null,
        createdAt: hace(60),
        pagosExitosos: 1,
        ahora: AHORA,
      })
    ).toBe(false)
  })

  it("no toca una suscripcion que ya tiene periodo: de esa se ocupa la otra regla", () => {
    expect(
      esAdhesionSinCobro({
        tienePreapproval: true,
        currentPeriodEnd: hace(30),
        createdAt: hace(60),
        pagosExitosos: 0,
        ahora: AHORA,
      })
    ).toBe(false)
  })

  it("la ventana es la misma que la de la gracia", () => {
    expect(DIAS_GRACIA_PREAPPROVAL).toBe(12)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run __tests__/lib/sweep-rules.test.ts`
Expected: FAIL — no existe `@/lib/subscriptions/sweep-rules`.

- [ ] **Step 3: Implementar**

Crear `lib/subscriptions/sweep-rules.ts`:

```ts
/**
 * Las reglas del barrido diario de suscripciones, puras y testeables.
 *
 * Viven fuera del cron porque son decisiones sobre plata: bloquear a un taller
 * que si esta pagando, o regalarle el plan a uno que no. Adentro de la ruta no
 * se pueden probar sin levantar medio Supabase.
 */

/**
 * MercadoPago reintenta un cobro rechazado durante 10 dias, con un maximo de 4
 * intentos. Los 2 dias extra son margen para que llegue el webhook.
 *
 * NO se espera la cancelacion que reporta MercadoPago: recien cancela tras 3
 * cuotas rechazadas, que son unos tres meses de servicio regalado.
 */
export const DIAS_GRACIA_PREAPPROVAL = 12

const MS_POR_DIA = 24 * 60 * 60 * 1000

function diasDesde(iso: string, ahora: Date): number {
  return (ahora.getTime() - new Date(iso).getTime()) / MS_POR_DIA
}

/**
 * Una adhesion al debito automatico cuyo primer cobro nunca llego.
 *
 * Queda ACTIVE con current_period_end en NULL, y el cron filtra los NULL: sin
 * esta regla no la barre nadie y la organizacion se queda con el plan pago para
 * siempre sin haber pagado nunca. Es la misma familia del bug de la migracion
 * 304: una regla que se aplica por fecha, sobre una fila donde la fecha no
 * existe.
 */
export function esAdhesionSinCobro(input: {
  tienePreapproval: boolean
  currentPeriodEnd: string | null
  createdAt: string
  pagosExitosos: number
  ahora: Date
}): boolean {
  if (!input.tienePreapproval) return false
  if (input.currentPeriodEnd !== null) return false
  if (input.pagosExitosos > 0) return false

  return diasDesde(input.createdAt, input.ahora) > DIAS_GRACIA_PREAPPROVAL
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run __tests__/lib/sweep-rules.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Cablearlo en el cron**

En `app/api/cron/subscription-sweep/route.ts`, después del bloque que procesa `expired`, agregar una segunda pasada:

```ts
    // Segunda pasada: adhesiones al debito automatico cuyo primer cobro nunca
    // llego. La consulta de arriba no las ve porque filtra current_period_end
    // IS NOT NULL, y estas lo tienen en NULL desde que se autorizaron.
    const { data: adhesiones } = await supabaseAdmin
      .from("subscriptions")
      .select(`
        id, organization_id, created_at, current_period_end,
        mercadopago_preapproval_id,
        organizations!inner ( slug ),
        plans!inner ( tipo )
      `)
      .eq("status", "ACTIVE")
      .eq("plans.tipo", "PREMIUM")
      .is("current_period_end", null)
      .not("mercadopago_preapproval_id", "is", null)
      .neq("organizations.slug", "superadmin")

    for (const ad of (adhesiones || []) as any[]) {
      const { count } = await supabaseAdmin
        .from("subscription_payments")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", ad.organization_id)
        .eq("status", "SUCCEEDED")

      const marcar = esAdhesionSinCobro({
        tienePreapproval: true,
        currentPeriodEnd: ad.current_period_end,
        createdAt: ad.created_at,
        pagosExitosos: count ?? 0,
        ahora: new Date(nowIso),
      })

      if (!marcar) continue

      await supabaseAdmin
        .from("subscriptions")
        .update({ status: "PAST_DUE", updated_at: nowIso })
        .eq("id", ad.id)

      await supabaseAdmin.from("subscription_history").insert({
        subscription_id: ad.id,
        organization_id: ad.organization_id,
        action: "MARKED_PAST_DUE",
        previous_status: "ACTIVE",
        new_status: "PAST_DUE",
        details: { reason: "adhesion_sin_primer_cobro" },
        performed_by: "system:cron",
      })

      results.markedPastDue++
    }
```

Agregar el import arriba del archivo:

```ts
import { esAdhesionSinCobro } from "@/lib/subscriptions/sweep-rules"
```

- [ ] **Step 6: Verificar y commitear**

Run: `npx tsc --noEmit && npm run test:run`
Expected: 0 errores de tipos, suite completa en verde.

```bash
git add lib/subscriptions/sweep-rules.ts __tests__/lib/sweep-rules.test.ts app/api/cron/subscription-sweep/route.ts
git commit -m "fix(billing): barrer la adhesion cuyo primer cobro nunca llego"
```

---

# PR 2 — Ventana de gracia y UI honesta

### Task 5: La ventana de gracia

**Files:**
- Modify: `lib/subscriptions/sweep-rules.ts`
- Modify: `__tests__/lib/sweep-rules.test.ts`
- Modify: `app/api/cron/subscription-sweep/route.ts` (la rama `MERCADOPAGO || REBILL`, ~121)

**Interfaces:**
- Consumes: `DIAS_GRACIA_PREAPPROVAL` de la Task 4.
- Produces: `venceLaGracia({ tienePreapproval, currentPeriodEnd, ahora }): boolean`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `__tests__/lib/sweep-rules.test.ts`:

```ts
import { venceLaGracia } from "@/lib/subscriptions/sweep-rules"

describe("venceLaGracia", () => {
  it("no bloquea mientras MercadoPago sigue reintentando", () => {
    expect(
      venceLaGracia({ tienePreapproval: true, currentPeriodEnd: hace(3), ahora: AHORA })
    ).toBe(false)
  })

  it("bloquea cuando los reintentos ya se agotaron", () => {
    expect(
      venceLaGracia({ tienePreapproval: true, currentPeriodEnd: hace(15), ahora: AHORA })
    ).toBe(true)
  })

  it("sin debito automatico no hay gracia: la fecha vencida significa que no pago", () => {
    expect(
      venceLaGracia({ tienePreapproval: false, currentPeriodEnd: hace(1), ahora: AHORA })
    ).toBe(true)
  })

  it("una suscripcion sin fecha no la decide esta regla", () => {
    expect(
      venceLaGracia({ tienePreapproval: true, currentPeriodEnd: null, ahora: AHORA })
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run __tests__/lib/sweep-rules.test.ts`
Expected: FAIL — `venceLaGracia` no está exportada.

- [ ] **Step 3: Implementar**

Agregar a `lib/subscriptions/sweep-rules.ts`:

```ts
/**
 * Si corresponde marcar PAST_DUE a una suscripcion con la fecha vencida.
 *
 * Con pago manual la fecha vencida significa exactamente eso: no pago. Con
 * debito automatico no, porque MercadoPago puede estar reintentando un cobro
 * que va a prosperar — y el 80% de los pagos salen de saldo, asi que el rebote
 * no es la excepcion. Bloquear ahi es cortarle el sistema a alguien que si te
 * va a pagar.
 */
export function venceLaGracia(input: {
  tienePreapproval: boolean
  currentPeriodEnd: string | null
  ahora: Date
}): boolean {
  if (input.currentPeriodEnd === null) return false
  if (!input.tienePreapproval) return true

  return diasDesde(input.currentPeriodEnd, input.ahora) > DIAS_GRACIA_PREAPPROVAL
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run __tests__/lib/sweep-rules.test.ts`
Expected: PASS, 9 tests entre las dos reglas.

- [ ] **Step 5: Cablearlo en el cron**

En `app/api/cron/subscription-sweep/route.ts`, agregar `mercadopago_preapproval_id` al `select` de `expired` y proteger la rama externa:

```ts
      } else if (
        sub.payment_provider === "MERCADOPAGO" ||
        sub.payment_provider === "REBILL"
      ) {
        if (
          !venceLaGracia({
            tienePreapproval: !!sub.mercadopago_preapproval_id,
            currentPeriodEnd: sub.current_period_end,
            ahora: new Date(nowIso),
          })
        ) {
          results.skipped++
          continue
        }
```

Actualizar el import y el tipo `Sub` con `mercadopago_preapproval_id: string | null`.

- [ ] **Step 6: Verificar y commitear**

Run: `npx tsc --noEmit && npm run test:run`

```bash
git add lib/subscriptions/sweep-rules.ts __tests__/lib/sweep-rules.test.ts app/api/cron/subscription-sweep/route.ts
git commit -m "fix(billing): no bloquear mientras MercadoPago reintenta el cobro"
```

---

### Task 6: La UI deja de mentir

**Files:**
- Modify: `lib/subscriptions.ts` (`SubscriptionInfo`, ~5-25, y donde se arma el objeto)
- Modify: `components/billing/current-plan.tsx` (~117-126)
- Test: `__tests__/components/current-plan-facturacion.test.tsx`

**Interfaces:**
- Produces: `SubscriptionInfo.autoDebito: boolean`.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/components/current-plan-facturacion.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { CurrentPlan } from "@/components/billing/current-plan"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ timezone: "America/Argentina/Buenos_Aires" }),
}))

// CurrentPlan exige cuatro props; los tres callbacks no participan de lo que
// se prueba acá, pero sin ellos no compila.
const CALLBACKS = { onUpgrade: () => {}, onManage: () => {}, onCancel: () => {} }

const BASE = {
  id: "sub-1",
  planId: "plan-pro",
  planNombre: "Profesional",
  planTipo: "PREMIUM" as const,
  planSlug: "profesional" as never,
  tierOrder: 2,
  status: "ACTIVE" as const,
  billingPeriod: "MONTHLY" as const,
  paymentProvider: "MERCADOPAGO" as const,
  currentPeriodEnd: "2026-09-19T00:00:00Z",
  trialEnd: null,
  cancelAtPeriodEnd: false,
  limits: { ordenes: null, tecnicos: null, clientes: null, vendedores: null, storageMb: null, sucursales: null },
}

describe("CurrentPlan — que dice sobre el proximo cobro", () => {
  it("con debito automatico promete que se cobra solo", () => {
    render(<CurrentPlan subscription={{ ...BASE, autoDebito: true }} {...CALLBACKS} />)
    expect(screen.getByText(/Próxima facturación/i)).toBeTruthy()
  })

  it("sin debito automatico NO promete un cobro que no va a pasar", () => {
    render(<CurrentPlan subscription={{ ...BASE, autoDebito: false }} {...CALLBACKS} />)
    expect(screen.queryByText(/Próxima facturación/i)).toBeNull()
    expect(screen.getByText(/Renovás vos/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run __tests__/components/current-plan-facturacion.test.tsx`
Expected: FAIL — `autoDebito` no existe en el tipo y el componente muestra "Próxima facturación" en los dos casos.

- [ ] **Step 3: Agregar el campo al DTO**

En `lib/subscriptions.ts`, dentro de `SubscriptionInfo`, después de `paymentProvider`:

```ts
  /** Si la suscripcion se cobra sola. Es un booleano y no el id del preapproval:
   *  el identificador del proveedor no tiene por que viajar al browser. */
  autoDebito: boolean
```

Donde se arma el objeto, agregar `autoDebito: !!sub.mercadopago_preapproval_id` y sumar `mercadopago_preapproval_id` al `select` correspondiente.

- [ ] **Step 4: Cambiar el copy**

En `components/billing/current-plan.tsx`, reemplazar el bloque de la línea ~117:

```tsx
        {periodEnd && isPremium && isPaid && (
          <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
            <Calendar className="h-4 w-4 shrink-0" />
            {isCanceled ? (
              <span>Termina el {periodEnd}</span>
            ) : subscription.autoDebito ? (
              <span>Próxima facturación: {periodEnd}</span>
            ) : (
              <span>Vence el {periodEnd}. Renovás vos.</span>
            )}
          </div>
        )}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run __tests__/components/current-plan-facturacion.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 6: Verificar todo y commitear**

Run: `npx tsc --noEmit && npm run test:run && npm run lint`

```bash
git add lib/subscriptions.ts components/billing/current-plan.tsx __tests__/components/current-plan-facturacion.test.tsx
git commit -m "fix(billing): no prometer un cobro automatico que no existe"
```

---

## Verificación antes de exponerlo

Ningún test cubre a MercadoPago del otro lado. Antes de que un taller real vea el selector:

1. Adherir con una cuenta de prueba y confirmar que la suscripción queda `ACTIVE` **con el plan correcto** (es lo que arregla la Task 3).
2. Confirmar que el primer cobro llega como `subscription_authorized_payment` y fija el período.
3. Cancelar desde la app y verificar que MercadoPago deja de cobrar.
4. **Confirmar si una tarjeta prepaga puede adherir.** Es el 23% de los pagos y la documentación no la nombra.

Recién con esos cuatro puntos cerrados tiene sentido el PR 3, que invita a los talleres actuales a migrar — y que tiene su propio plan.
