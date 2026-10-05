# Campaña de migración al débito automático — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Invitar por mail a los talleres que hoy pagan a mano a que adhieran al débito automático, sin escribirle dos veces a nadie ni escribirle a quien no corresponde.

**Architecture:** Reusa la infraestructura de lifecycle emails que ya existe — `lifecycle_emails` para el registro y la idempotencia, `lifecycle-templates.ts` para el contenido. La campaña se dispara a mano desde un endpoint de superadmin, no por cron: es un envío único, no un ciclo, y quien decide cuándo mandarlo sos vos. El endpoint acepta un modo de simulación que lista destinatarios sin mandar nada.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (`supabaseAdmin`), EnvialoSimple para el envío (`ENVIALOSIMPLE_API_KEY`), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-preapproval-mercadopago-design.md` (§5)

## Global Constraints

- **No se manda nada hasta que el flujo esté verificado de punta a punta.** El código puede mergear; el envío espera a que una adhesión real haya activado un plan y cobrado su primer mes. Está en §8 del spec.
- **Una sola vez por organización.** La idempotencia sale de `lifecycle_emails` con `email_type = 'PREAPPROVAL_INVITE'`, igual que el resto de los lifecycle.
- **El mail dice qué medios sirven**: tarjeta de crédito, tarjeta de débito o dinero en cuenta de Mercado Pago. **La tarjeta prepaga NO sirve** — verificado el 2026-08-23 contra la pantalla real de adhesión. Son 7 de los 13 pagadores actuales: si el mail no lo aclara, van a intentar, no van a encontrar su tarjeta, y no van a entender qué hicieron mal.
- El mail **no promete** que el precio queda fijo. Una PreApproval cobra siempre el mismo monto hasta que se actualice por API, y todavía no está resuelto cómo se sube el precio (§7 del spec). No prometer lo que no sabemos sostener.
- Comentarios y copy en español neutro. Commits convencionales, sin tildes en el mensaje, sin "Co-Authored-By".
- Antes de commitear: `npx tsc --noEmit` y `npm run test:run` en verde.

## Decisión de diseño que se aparta del spec

El spec (§5.1) proponía generar el `init_point` de cada organización y mandarlo como link de un clic.

**Este plan linkea a `/configuracion/billing` en vez de eso**, por tres razones: crear una PreApproval por organización genera objetos en MercadoPago que quizá nadie use; una PreApproval pendiente puede caducar antes de que el taller abra el mail; y el taller que llega a la pantalla de billing ve su plan, su vencimiento y el selector, en vez de aterrizar directo en una autorización de pago sin contexto.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `lib/emails/lifecycle-templates.ts` (modificar) | Tipo `PREAPPROVAL_INVITE` y su contenido |
| `lib/billing/campana-preapproval.ts` (nuevo) | Regla pura de a quién se le manda |
| `lib/emails/enviar.ts` (nuevo) | Envío y registro de lifecycle emails, hoy duplicados dentro de cada cron |
| `app/api/superadmin/campanas/preapproval/route.ts` (nuevo) | Dispara la campaña, con modo simulación |

---

### Task 1: El mail

**Files:**
- Modify: `lib/emails/lifecycle-templates.ts` (tipo `LifecycleEmailType` ~131, función `getLifecycleEmail` ~157)
- Test: `__tests__/lib/preapproval-invite-email.test.ts`

**Interfaces:**
- Produces: `getLifecycleEmail("PREAPPROVAL_INVITE", data)` → `{ subject, html }`.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/lib/preapproval-invite-email.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { getLifecycleEmail } from "@/lib/emails/lifecycle-templates"

const DATA = { organizationName: "Taller Romemaq", organizationSlug: "romemaq" } as never

describe("Mail de invitación al débito automático", () => {
  it("dice qué medios de pago sirven", () => {
    const { html } = getLifecycleEmail("PREAPPROVAL_INVITE", DATA)

    expect(html).toMatch(/cr[ée]dito/i)
    expect(html).toMatch(/d[ée]bito/i)
    expect(html).toMatch(/dinero en cuenta/i)
  })

  it("avisa que la prepaga no sirve: son 7 de 13 pagadores", () => {
    const { html } = getLifecycleEmail("PREAPPROVAL_INVITE", DATA)
    expect(html).toMatch(/prepaga/i)
  })

  it("lleva a la pantalla de facturación, no a una autorizacion suelta", () => {
    const { html } = getLifecycleEmail("PREAPPROVAL_INVITE", DATA)
    expect(html).toContain("/configuracion/billing")
  })

  it("dice que se puede cancelar cuando quiera", () => {
    const { html } = getLifecycleEmail("PREAPPROVAL_INVITE", DATA)
    expect(html).toMatch(/cancel/i)
  })

  it("NO promete que el precio queda fijo", () => {
    const { html } = getLifecycleEmail("PREAPPROVAL_INVITE", DATA)
    expect(html).not.toMatch(/precio.{0,30}(fijo|congelado)|congelamos/i)
  })

  it("tiene asunto", () => {
    const { subject } = getLifecycleEmail("PREAPPROVAL_INVITE", DATA)
    expect(subject.length).toBeGreaterThan(10)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run __tests__/lib/preapproval-invite-email.test.ts`
Expected: FAIL — `"PREAPPROVAL_INVITE"` no es un `LifecycleEmailType` válido.

- [ ] **Step 3: Agregar el tipo**

En `lib/emails/lifecycle-templates.ts`, en la unión `LifecycleEmailType` (~131), agregar:

```ts
  | "PREAPPROVAL_INVITE"
```

- [ ] **Step 4: Agregar el caso al switch**

Dentro de `getLifecycleEmail`, siguiendo el patrón de los casos existentes (usan `baseTemplate({ preheader, content })`):

```ts
    case "PREAPPROVAL_INVITE":
      return {
        subject: "Ya no hace falta que te acuerdes de pagar STApp todos los meses",
        html: baseTemplate({
          preheader: "Activá el débito automático y despreocupate de la renovación.",
          content: `
            <p class="text-body">Hola ${data.organizationName},</p>

            <p class="text-body">
              Hasta ahora tenías que entrar a pagar STApp todos los meses. Si te
              olvidabas, el sistema se bloqueaba hasta que lo hicieras.
            </p>

            <p class="text-body">
              Ya no hace falta: podés activar el <strong>débito automático</strong>
              y se cobra solo cada mes.
            </p>

            <p class="text-body">
              Se activa desde tu pantalla de facturación, y lo cancelás cuando
              quieras desde ahí mismo.
            </p>

            <p class="text-body">
              <strong>Medios que acepta MercadoPago para el débito automático:</strong>
              tarjeta de crédito, tarjeta de débito o dinero en cuenta de Mercado Pago.
              La <strong>tarjeta prepaga no sirve</strong> para cobros automáticos —
              si hoy pagás con una, vas a poder seguir pagando mes a mes como hasta ahora.
            </p>

            <p style="text-align:center;margin:32px 0;">
              <a href="https://${data.organizationSlug}.${ROOT_DOMAIN}/configuracion/billing"
                 style="background:#2563eb;color:#ffffff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
                Activar el débito automático
              </a>
            </p>

            <p class="text-muted" style="font-size:13px;">
              Si preferís seguir pagando mes a mes, no tenés que hacer nada.
            </p>
          `,
        }),
      }
```

**Importante sobre el link:** mirá cómo arman las URLs los casos existentes de ese archivo (usan `ROOT_DOMAIN` y el slug de la organización) y seguí exactamente ese patrón. Si el patrón del repo difiere del de arriba, gana el del repo — el test solo exige que la URL contenga `/configuracion/billing`.

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run __tests__/lib/preapproval-invite-email.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/emails/lifecycle-templates.ts __tests__/lib/preapproval-invite-email.test.ts
git commit -m "feat(billing): mail de invitacion al debito automatico"
```

---

### Task 2: A quién se le manda

**Files:**
- Create: `lib/billing/campana-preapproval.ts`
- Test: `__tests__/lib/campana-preapproval.test.ts`

**Interfaces:**
- Produces: `esDestinatarioDeLaCampana({ precioMensual, tienePreapproval, status, yaRecibioElMail }): boolean`

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/lib/campana-preapproval.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { esDestinatarioDeLaCampana } from "@/lib/billing/campana-preapproval"

const PAGADOR = {
  precioMensual: 19999,
  tienePreapproval: false,
  status: "ACTIVE",
  yaRecibioElMail: false,
}

describe("esDestinatarioDeLaCampana", () => {
  it("le manda al que paga a mano", () => {
    expect(esDestinatarioDeLaCampana(PAGADOR)).toBe(true)
  })

  it("no le manda a quien ya tiene debito automatico", () => {
    expect(esDestinatarioDeLaCampana({ ...PAGADOR, tienePreapproval: true })).toBe(false)
  })

  it("no le manda a quien esta en un plan gratis", () => {
    expect(esDestinatarioDeLaCampana({ ...PAGADOR, precioMensual: 0 })).toBe(false)
  })

  it("no le manda a quien esta en trial: todavia no paga", () => {
    expect(esDestinatarioDeLaCampana({ ...PAGADOR, status: "TRIALING" })).toBe(false)
  })

  it("no le manda dos veces a la misma organizacion", () => {
    expect(esDestinatarioDeLaCampana({ ...PAGADOR, yaRecibioElMail: true })).toBe(false)
  })

  it("le manda al que se atraso: es a quien mas le sirve", () => {
    expect(esDestinatarioDeLaCampana({ ...PAGADOR, status: "PAST_DUE" })).toBe(true)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run __tests__/lib/campana-preapproval.test.ts`
Expected: FAIL — no existe `@/lib/billing/campana-preapproval`.

- [ ] **Step 3: Implementar**

Crear `lib/billing/campana-preapproval.ts`:

```ts
/**
 * Quien recibe la invitacion a activar el debito automatico.
 *
 * Es una regla sobre a quien se le escribe: equivocarse manda un mail a quien
 * no corresponde, y eso no se puede deshacer. Va pura y con tests.
 */
export function esDestinatarioDeLaCampana(input: {
  /** Precio del plan actual. Cero o menos = plan gratis. */
  precioMensual: number
  tienePreapproval: boolean
  status: string
  yaRecibioElMail: boolean
}): boolean {
  // Una sola vez por organizacion.
  if (input.yaRecibioElMail) return false

  // Ya se cobra solo: no hay nada que invitarle.
  if (input.tienePreapproval) return false

  // El mensaje es para quien paga. En Free o en trial no aplica.
  if (input.precioMensual <= 0) return false
  if (input.status === "TRIALING") return false

  // PAST_DUE SI entra: es exactamente a quien mas le sirve dejar de depender
  // de acordarse. Que se haya atrasado es el sintoma que la campana ataca.
  return true
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run __tests__/lib/campana-preapproval.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/billing/campana-preapproval.ts __tests__/lib/campana-preapproval.test.ts
git commit -m "feat(billing): regla de a quien se le invita al debito automatico"
```

---

### Task 3: El endpoint que la dispara

**Files:**
- Create: `app/api/superadmin/campanas/preapproval/route.ts`
- Test: `__tests__/api/campana-preapproval.test.ts`

**Interfaces:**
- Consumes: `esDestinatarioDeLaCampana` (Task 2), `getLifecycleEmail("PREAPPROVAL_INVITE", …)` (Task 1).
- Produces: `POST /api/superadmin/campanas/preapproval` → `{ simulacion: boolean, destinatarios: Array<{nombre, email}>, enviados: number, fallidos: number }`

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/api/campana-preapproval.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/superadmin-auth", () => ({
  requireSuperadmin: vi.fn().mockResolvedValue({ error: null }),
}))

import { POST } from "@/app/api/superadmin/campanas/preapproval/route"

describe("POST /api/superadmin/campanas/preapproval", () => {
  beforeEach(() => vi.clearAllMocks())

  it("en simulacion NO manda ningun mail", async () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as never

    const res = await POST(createPostRequest({ simulacion: true }) as never)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.simulacion).toBe(true)
    expect(body.enviados).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("el modo real requiere pedirlo explicitamente", async () => {
    const res = await POST(createPostRequest({}) as never)
    const { body } = await parseResponse(res)

    // Sin decir nada, simula: mandar mails no puede ser el default.
    expect(body.simulacion).toBe(true)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run __tests__/api/campana-preapproval.test.ts`
Expected: FAIL — no existe la ruta.

- [ ] **Step 3: Extraer los helpers de envío**

`sendEmail`, `wasAlreadySent` y `logEmail` viven **dentro** de `app/api/cron/lifecycle-emails/route.ts` sin exportar, y hay copias en otros crons. En vez de agregar una copia más, se extraen.

Crear `lib/emails/enviar.ts`:

```ts
import { supabaseAdmin } from "@/lib/supabase"

const ENVIALOSIMPLE_API_URL = "https://api.envialosimple.email/api/v1/mail/send"
const EMAIL_FROM = process.env.EMAIL_FROM || "STApp <no-reply@stapp.com.ar>"

/** Devuelve true si el proveedor acepto el envio. Nunca lanza. */
export async function enviarEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = process.env.ENVIALOSIMPLE_API_KEY
  if (!apiKey) return false
  try {
    const res = await fetch(ENVIALOSIMPLE_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, html }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Idempotencia: una organizacion recibe cada email_type una sola vez. */
export async function yaSeEnvio(orgId: string, emailType: string): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from("lifecycle_emails")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("email_type", emailType)
    .eq("status", "SENT")
  return (count || 0) > 0
}

export async function registrarEnvio(
  orgId: string,
  emailType: string,
  status: "SENT" | "FAILED",
  userId?: string
): Promise<void> {
  await supabaseAdmin.from("lifecycle_emails").insert({
    organization_id: orgId,
    user_id: userId || null,
    email_type: emailType,
    status,
  })
}
```

**Verificá los valores exactos** de `ENVIALOSIMPLE_API_URL` y `EMAIL_FROM` contra `app/api/cron/lifecycle-emails/route.ts` (están declarados arriba del archivo) y copiálos textualmente. Si difieren de lo de acá, **gana el del repo**.

**NO migres los crons existentes a este módulo.** Funcionan y no son parte de esta campaña; migrarlos mezcla un refactor con un envío de mails. Queda como follow-up.

- [ ] **Step 4: Implementar la ruta**

Crear `app/api/superadmin/campanas/preapproval/route.ts`:

```ts
import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { getLifecycleEmail } from "@/lib/emails/lifecycle-templates"
import { esDestinatarioDeLaCampana } from "@/lib/billing/campana-preapproval"
import { enviarEmail, yaSeEnvio, registrarEnvio } from "@/lib/emails/enviar"

const EMAIL_TYPE = "PREAPPROVAL_INVITE"

/**
 * Invita a los talleres que pagan a mano a activar el debito automatico.
 *
 * Se dispara a mano y no por cron: es un envio unico, y cuando se manda lo
 * decide una persona.
 *
 * `simulacion` vale TRUE si no se dice lo contrario. Mandarle mails a clientes
 * reales no puede ser lo que pasa cuando alguien pega en el endpoint sin leer.
 */
export async function POST(request: Request) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const body = await request.json().catch(() => ({}))
    const simulacion = body?.simulacion !== false

    const { data: subs, error: dbError } = await supabaseAdmin
      .from("subscriptions")
      .select(`
        organization_id, status, mercadopago_preapproval_id,
        organizations!inner ( id, nombre, email, slug, activo ),
        plans!inner ( precio_mensual )
      `)
      .in("status", ["ACTIVE", "PAST_DUE"])

    if (dbError) {
      console.error("[campana-preapproval] Error consultando suscripciones:", dbError)
      return NextResponse.json({ error: "Error consultando suscripciones" }, { status: 500 })
    }

    const destinatarios: Array<{ organizationId: string; nombre: string; email: string; slug: string }> = []
    let sinEmail = 0

    for (const sub of (subs || []) as any[]) {
      const org = sub.organizations
      if (!org || org.activo === false) continue

      const elegible = esDestinatarioDeLaCampana({
        precioMensual: Number(sub.plans?.precio_mensual) || 0,
        tienePreapproval: !!sub.mercadopago_preapproval_id,
        status: sub.status,
        yaRecibioElMail: await yaSeEnvio(sub.organization_id, EMAIL_TYPE),
      })

      if (!elegible) continue

      // Sin mail no hay a donde escribir. No es un fallo de envio: se cuenta aparte.
      if (!org.email) {
        sinEmail++
        continue
      }

      destinatarios.push({
        organizationId: sub.organization_id,
        nombre: org.nombre,
        email: org.email,
        slug: org.slug,
      })
    }

    if (simulacion) {
      return NextResponse.json({
        simulacion: true,
        destinatarios: destinatarios.map((d) => ({ nombre: d.nombre, email: d.email })),
        total: destinatarios.length,
        sinEmail,
        enviados: 0,
        fallidos: 0,
      })
    }

    let enviados = 0
    let fallidos = 0

    for (const d of destinatarios) {
      const { subject, html } = getLifecycleEmail(EMAIL_TYPE as never, {
        organizationName: d.nombre,
        organizationSlug: d.slug,
      } as never)

      const ok = await enviarEmail(d.email, subject, html)
      await registrarEnvio(d.organizationId, EMAIL_TYPE, ok ? "SENT" : "FAILED")

      if (ok) enviados++
      else fallidos++
    }

    return NextResponse.json({
      simulacion: false,
      destinatarios: destinatarios.map((d) => ({ nombre: d.nombre, email: d.email })),
      total: destinatarios.length,
      sinEmail,
      enviados,
      fallidos,
    })
  } catch (err) {
    console.error("[campana-preapproval] Error:", err)
    return NextResponse.json({ error: "Error ejecutando la campaña" }, { status: 500 })
  }
}
```

**Sobre el tipo de `getLifecycleEmail`:** si `LifecycleEmailData` exige campos que no tenemos, mirá su declaración en `lib/emails/lifecycle-templates.ts` y pasá lo que pida — el `as never` de arriba es un atajo que hay que reemplazar por el shape real.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run __tests__/api/campana-preapproval.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Verificar todo y commitear**

Run: `npx tsc --noEmit && npm run test:run && npm run lint`

```bash
git add app/api/superadmin/campanas/preapproval/route.ts __tests__/api/campana-preapproval.test.ts
git commit -m "feat(billing): disparar la campana de debito automatico con modo simulacion"
```

---

## Antes de mandar un solo mail

El código puede mergear cuando esté listo. **El envío espera.**

1. Que una adhesión real haya llegado hasta el final: plan activado y primer cobro registrado (§8 del spec).
2. Correr la campaña en **simulación** y leer la lista de destinatarios uno por uno. Son 13: se revisan a mano en dos minutos.
3. Recién ahí, el envío real.

Mandar la invitación antes de que el flujo esté verificado significa empujar a trece talleres hacia un camino que nadie recorrió. Si falla, no falla en silencio: falla delante de la gente que ya te está pagando.
