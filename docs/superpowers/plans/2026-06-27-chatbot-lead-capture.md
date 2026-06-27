# Captación de leads en el chatbot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el chatbot de la landing capte el contacto del visitante con un mini-form explícito (Nombre + WhatsApp), guardándolo como lead "caliente" visible en el panel de superadmin.

**Architecture:** Frontend: un componente de form aislado (`LeadCaptureForm`) que el panel del chatbot muestra vía botón fijo y auto-aparición por interés. Backend: se reutiliza el endpoint `POST /api/chatbot/capture-lead` (que ya hace upsert + dedup vía `upsertLeadFromConversation`), extendido para crear la conversación si falta y marcar los leads del form con score alto. No se toca `upsert-lead.ts` (ya soporta `score`/`interes`).

**Tech Stack:** Next.js (App Router), React 19, TypeScript, Tailwind, Supabase (`supabaseAdmin`), Zod, Vitest + @testing-library/react, Anthropic SDK (chatbot).

## Global Constraints

- UI/copy en español rioplatense informal (vos/tenés), consistente con el chatbot existente ("Santi").
- No agregar dependencias nuevas.
- No modificar el camino de extracción automática de leads (su score no cambia).
- Origen del lead siempre `CHATBOT`.
- El form pide solo **Nombre + WhatsApp**.
- Lead del form → `score = 85`, `interes = "Pidió ser contactado (chatbot)"`.
- Degradación segura: si el POST falla, el form muestra error y permite reintentar; nada rompe el chat.

---

### Task 1: Helper de validación del form (puro, testeable)

**Files:**
- Create: `components/chatbot/lead-form-validation.ts`
- Test: `__tests__/lib/lead-form-validation.test.ts`

**Interfaces:**
- Produces:
  - `interface LeadFormInput { nombre: string; whatsapp: string }`
  - `interface LeadFormValidation { ok: boolean; telefono?: string; error?: string }`
  - `function validateLeadForm(input: LeadFormInput): LeadFormValidation`
  - Regla: `nombre.trim().length >= 2`; `telefono = whatsapp.replace(/\D/g,"")` con `length >= 8`. Devuelve `telefono` ya en dígitos puros.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/lead-form-validation.test.ts
import { describe, it, expect } from "vitest"
import { validateLeadForm } from "@/components/chatbot/lead-form-validation"

describe("validateLeadForm", () => {
  it("rechaza nombre vacío o muy corto", () => {
    expect(validateLeadForm({ nombre: " ", whatsapp: "1112345678" }).ok).toBe(false)
    expect(validateLeadForm({ nombre: "A", whatsapp: "1112345678" }).ok).toBe(false)
  })
  it("rechaza WhatsApp con menos de 8 dígitos", () => {
    const r = validateLeadForm({ nombre: "Juan", whatsapp: "12-34" })
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })
  it("acepta y limpia el WhatsApp a dígitos", () => {
    const r = validateLeadForm({ nombre: "  Juan Pérez ", whatsapp: "+54 9 11 1234-5678" })
    expect(r.ok).toBe(true)
    expect(r.telefono).toBe("5491112345678")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/lead-form-validation.test.ts`
Expected: FAIL — cannot find module `lead-form-validation`.

- [ ] **Step 3: Write minimal implementation**

```ts
// components/chatbot/lead-form-validation.ts
export interface LeadFormInput {
  nombre: string
  whatsapp: string
}

export interface LeadFormValidation {
  ok: boolean
  telefono?: string
  error?: string
}

export function validateLeadForm(input: LeadFormInput): LeadFormValidation {
  const nombre = input.nombre.trim()
  if (nombre.length < 2) {
    return { ok: false, error: "Ingresá tu nombre" }
  }
  const telefono = input.whatsapp.replace(/\D/g, "")
  if (telefono.length < 8) {
    return { ok: false, error: "Ingresá un WhatsApp válido (con código de área)" }
  }
  return { ok: true, telefono }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/lead-form-validation.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/chatbot/lead-form-validation.ts __tests__/lib/lead-form-validation.test.ts
git commit -m "feat(chatbot): helper de validación del mini-form de lead"
```

---

### Task 2: Extender `capture-lead` (crear conversación si falta + score del form)

**Files:**
- Modify: `app/api/chatbot/capture-lead/route.ts`
- Test: `__tests__/api/chatbot-capture-lead.test.ts`

**Interfaces:**
- Consumes: `upsertLeadFromConversation(conversacionId, sessionId, data)` de `@/lib/chatbot/upsert-lead` (sin cambios; ya acepta `score` e `interes` en `LeadUpsertData`).
- Produces: `POST /api/chatbot/capture-lead` acepta body
  `{ sessionId: string, conversacionId?: string, nombre?: string, email?: string, telefono?: string, empresa?: string, interes?: string, planInteres?: string, fuente?: "form" }`.
  Si `conversacionId` falta o no existe para ese `sessionId`, crea una conversación nueva. Si `fuente === "form"`: `score = 85` e `interes = "Pidió ser contactado (chatbot)"` (salvo que venga `interes` explícito). Respuesta: `{ success: true, leadId, message }`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/api/chatbot-capture-lead.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const upsertMock = vi.fn()
vi.mock("@/lib/chatbot/upsert-lead", () => ({
  upsertLeadFromConversation: (...args: unknown[]) => upsertMock(...args),
}))

// supabaseAdmin: encadenable; .single() de la creación de conversación devuelve un id.
const convInsertSingle = vi.fn().mockResolvedValue({ data: { id: "conv-new", session_id: "s1" }, error: null })
const convSelectMaybe = vi.fn().mockResolvedValue({ data: null }) // no existe -> se crea
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: convSelectMaybe }) }) }),
      insert: () => ({ select: () => ({ single: convInsertSingle }) }),
    }),
  },
}))

vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => "test" }),
}))

import { POST } from "@/app/api/chatbot/capture-lead/route"

function req(body: unknown) {
  return new Request("http://localhost/api/chatbot/capture-lead", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/chatbot/capture-lead", () => {
  beforeEach(() => {
    upsertMock.mockReset().mockResolvedValue({ leadId: "lead-1", created: true })
    convSelectMaybe.mockResolvedValue({ data: null })
  })

  it("crea la conversación si no viene conversacionId y captura el lead", async () => {
    const res = await POST(req({ sessionId: "s1", nombre: "Juan", telefono: "5491112345678", fuente: "form" }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    // se llamó al upsert con la conversación recién creada y score 85
    const [, , data] = upsertMock.mock.calls[0]
    expect(data.score).toBe(85)
    expect(data.interes).toBe("Pidió ser contactado (chatbot)")
  })

  it("rechaza si no hay ningún dato de contacto", async () => {
    const res = await POST(req({ sessionId: "s1", fuente: "form" }))
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/chatbot-capture-lead.test.ts`
Expected: FAIL — la versión actual exige `conversacionId` (`z.string().min(1)`) y no fija `score`.

- [ ] **Step 3: Write minimal implementation**

Reemplazá el contenido de `app/api/chatbot/capture-lead/route.ts` por:

```ts
import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { z } from "zod"
import { supabaseAdmin } from "@/lib/supabase"
import { upsertLeadFromConversation } from "@/lib/chatbot/upsert-lead"

const leadCaptureSchema = z.object({
  sessionId: z.string().min(1, "Session ID es requerido"),
  conversacionId: z.string().optional(),
  nombre: z.string().optional(),
  email: z.string().email("Email inválido").optional(),
  telefono: z.string().optional(),
  empresa: z.string().optional(),
  interes: z.string().optional(),
  planInteres: z.string().optional(),
  fuente: z.enum(["form"]).optional(),
})

async function resolveConversacionId(
  sessionId: string,
  conversacionId: string | undefined
): Promise<string | null> {
  if (conversacionId) {
    const { data } = await supabaseAdmin
      .from("chatbot_conversaciones")
      .select("id, session_id")
      .eq("id", conversacionId)
      .eq("session_id", sessionId)
      .maybeSingle()
    if (data) return data.id as string
  }

  const headersList = await headers()
  const ip = headersList.get("x-forwarded-for") || headersList.get("x-real-ip") || "unknown"
  const userAgent = headersList.get("user-agent") || "unknown"
  const referrer = headersList.get("referer") || headersList.get("referrer") || null

  const { data, error } = await supabaseAdmin
    .from("chatbot_conversaciones")
    .insert({ session_id: sessionId, ip_address: ip, user_agent: userAgent, referrer })
    .select("id, session_id")
    .single()
  if (error || !data) return null
  return data.id as string
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const data = leadCaptureSchema.parse(body)

    if (!data.nombre && !data.email && !data.telefono && !data.empresa) {
      return NextResponse.json(
        { error: "Se requiere al menos uno: nombre, email, teléfono o empresa" },
        { status: 400 }
      )
    }

    const conversacionId = await resolveConversacionId(data.sessionId, data.conversacionId)
    if (!conversacionId) {
      return NextResponse.json(
        { error: "No se pudo iniciar la conversación. Intentá de nuevo." },
        { status: 500 }
      )
    }

    let nombre = data.nombre
    if (!nombre && data.email) {
      const localPart = data.email.split("@")[0]
      const formatted = localPart.replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      if (formatted.length >= 2) nombre = formatted
    }

    const esForm = data.fuente === "form"
    const result = await upsertLeadFromConversation(conversacionId, data.sessionId, {
      nombre,
      email: data.email,
      telefono: data.telefono,
      empresa: data.empresa,
      interes: data.interes ?? (esForm ? "Pidió ser contactado (chatbot)" : "Consulta desde chatbot"),
      planInteres: data.planInteres,
      score: esForm ? 85 : null,
    })

    if (!result) {
      return NextResponse.json(
        { error: "No se pudo capturar el lead. Verificá los datos." },
        { status: 422 }
      )
    }

    return NextResponse.json({
      success: true,
      leadId: result.leadId,
      message: result.created ? "Lead capturado exitosamente" : "Lead actualizado correctamente",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error("Error capturando lead:", error)
    return NextResponse.json(
      { error: "Error al capturar lead. Por favor intentá de nuevo." },
      { status: 500 }
    )
  }
}
```

Nota: se quitó el fallback de extracción de nombre desde mensajes previos (dependía de leer `chatbot_mensajes`); el form ya envía el nombre, y si no hay nombre pero hay email se deriva del local-part. Esto mantiene el endpoint simple y testeable.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/api/chatbot-capture-lead.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add app/api/chatbot/capture-lead/route.ts __tests__/api/chatbot-capture-lead.test.ts
git commit -m "feat(chatbot): capture-lead crea conversación si falta y marca leads del form (score 85)"
```

---

### Task 3: Componente `LeadCaptureForm`

**Files:**
- Create: `components/chatbot/lead-capture-form.tsx`
- Test: `__tests__/components/lead-capture-form.test.tsx`

**Interfaces:**
- Consumes: `validateLeadForm` (Task 1); `POST /api/chatbot/capture-lead` (Task 2).
- Produces: `function LeadCaptureForm(props: { sessionId: string; conversacionId: string | null; onCaptured: () => void }): JSX.Element`
  - Inputs controlados Nombre + WhatsApp, botón "Enviar". Valida con `validateLeadForm`; si falla muestra el `error` inline. Si pasa, `POST` con `{ sessionId, conversacionId, nombre, telefono, fuente: "form" }`; en éxito llama `onCaptured()`; en error muestra mensaje y permite reintentar. Estado `submitting` deshabilita el botón.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/lead-capture-form.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { LeadCaptureForm } from "@/components/chatbot/lead-capture-form"

describe("LeadCaptureForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("muestra error si el WhatsApp es inválido y no llama al fetch", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
    const onCaptured = vi.fn()
    render(<LeadCaptureForm sessionId="s1" conversacionId="c1" onCaptured={onCaptured} />)
    fireEvent.change(screen.getByPlaceholderText(/nombre/i), { target: { value: "Juan" } })
    fireEvent.change(screen.getByPlaceholderText(/whatsapp/i), { target: { value: "123" } })
    fireEvent.click(screen.getByRole("button", { name: /enviar/i }))
    expect(await screen.findByText(/whatsapp válido/i)).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(onCaptured).not.toHaveBeenCalled()
  })

  it("postea y llama onCaptured en éxito", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, leadId: "l1" }), { status: 200 })
    )
    const onCaptured = vi.fn()
    render(<LeadCaptureForm sessionId="s1" conversacionId="c1" onCaptured={onCaptured} />)
    fireEvent.change(screen.getByPlaceholderText(/nombre/i), { target: { value: "Juan" } })
    fireEvent.change(screen.getByPlaceholderText(/whatsapp/i), { target: { value: "11 1234-5678" } })
    fireEvent.click(screen.getByRole("button", { name: /enviar/i }))
    await waitFor(() => expect(onCaptured).toHaveBeenCalled())
    const [, init] = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]
    const sent = JSON.parse((init as RequestInit).body as string)
    expect(sent).toMatchObject({ sessionId: "s1", conversacionId: "c1", nombre: "Juan", fuente: "form" })
    expect(sent.telefono).toBe("1112345678")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/lead-capture-form.test.tsx`
Expected: FAIL — cannot find module `lead-capture-form`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// components/chatbot/lead-capture-form.tsx
"use client"

import { useState } from "react"
import { Loader2, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { validateLeadForm } from "./lead-form-validation"

interface LeadCaptureFormProps {
  sessionId: string
  conversacionId: string | null
  onCaptured: () => void
}

export function LeadCaptureForm({ sessionId, conversacionId, onCaptured }: LeadCaptureFormProps) {
  const [nombre, setNombre] = useState("")
  const [whatsapp, setWhatsapp] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    setError(null)
    const v = validateLeadForm({ nombre, whatsapp })
    if (!v.ok) {
      setError(v.error ?? "Revisá los datos")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/chatbot/capture-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          conversacionId: conversacionId ?? undefined,
          nombre: nombre.trim(),
          telefono: v.telefono,
          fuente: "form",
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "No se pudo enviar")
      }
      onCaptured()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar. Probá de nuevo.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="my-3 rounded-xl border bg-muted/40 p-3 space-y-2">
      <p className="text-sm font-medium">Dejanos tus datos y te contactamos 👇</p>
      <Input
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        placeholder="Tu nombre"
        disabled={submitting}
      />
      <Input
        value={whatsapp}
        onChange={(e) => setWhatsapp(e.target.value)}
        placeholder="Tu WhatsApp"
        inputMode="tel"
        disabled={submitting}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button onClick={handleSubmit} disabled={submitting} className="w-full" size="sm">
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
        Enviar
      </Button>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/components/lead-capture-form.test.tsx`
Expected: PASS (2 tests). Si falla por entorno DOM, confirmar que `vitest.config` usa `environment: "jsdom"` (ya lo usan los tests de `components/pos/__tests__`).

- [ ] **Step 5: Commit**

```bash
git add components/chatbot/lead-capture-form.tsx __tests__/components/lead-capture-form.test.tsx
git commit -m "feat(chatbot): componente LeadCaptureForm (nombre + whatsapp)"
```

---

### Task 4: Integrar el form en el panel del chatbot

**Files:**
- Modify: `components/chatbot/chatbot-panel.tsx`

**Interfaces:**
- Consumes: `LeadCaptureForm` (Task 3). La respuesta de `POST /api/chatbot` ya incluye `intencion: string` y `leadScore: number`.

- [ ] **Step 1: Importar el form y constantes de disparo** (cerca de los imports, tras la línea `import { ChatMessage } from "./chat-message"`)

```tsx
import { LeadCaptureForm } from "./lead-capture-form"
```

Y debajo de `const WHATSAPP_MESSAGE = ...` agregar:

```tsx
const LEAD_CAPTURED_KEY = "chatbot-lead-captured"
const INTENCIONES_LEAD = new Set(["solicitar_demo", "preguntar_precio", "lead_calificado"])
```

- [ ] **Step 2: Agregar estado** (junto a los otros `useState`, tras `const [showCaptureBadge, setShowCaptureBadge] = useState(false)`)

```tsx
const [showLeadForm, setShowLeadForm] = useState(false)
const [offeredForm, setOfferedForm] = useState(false)
```

- [ ] **Step 3: Pre-cargar el flag de capturado desde localStorage** (dentro del `useEffect` que corre con `[isClient]`, después de `setSessionId(sid)`)

```tsx
if (localStorage.getItem(LEAD_CAPTURED_KEY) === "true") {
  setLeadCaptured(true)
}
```

- [ ] **Step 4: Auto-aparición por interés** (en `handleSendMessage`, reemplazar el bloque `if (data.leadCaptured && !leadCaptured) {...}` por:)

```tsx
if (data.leadCaptured && !leadCaptured) {
  setLeadCaptured(true)
  setShowCaptureBadge(true)
}

const interesado =
  (typeof data.leadScore === "number" && data.leadScore >= 60) ||
  INTENCIONES_LEAD.has(data.intencion)
if (interesado && !leadCaptured && !offeredForm) {
  setOfferedForm(true)
  setShowLeadForm(true)
}
```

- [ ] **Step 5: Handler de captura** (agregar junto a `handleSendMessage`)

```tsx
const handleLeadCaptured = () => {
  setLeadCaptured(true)
  setShowLeadForm(false)
  setShowCaptureBadge(true)
  if (typeof window !== "undefined") localStorage.setItem(LEAD_CAPTURED_KEY, "true")
}
```

- [ ] **Step 6: Renderizar el form inline** (en el área de mensajes, justo antes de `<div ref={messagesEndRef} />`)

```tsx
{showLeadForm && !leadCaptured && sessionId && (
  <LeadCaptureForm
    sessionId={sessionId}
    conversacionId={conversacionId}
    onCaptured={handleLeadCaptured}
  />
)}
```

- [ ] **Step 7: Botón fijo "Quiero que me contacten"** (en el footer, reemplazar el `<p>` de "Presioná Enter para enviar" por un contenedor que incluya el CTA cuando no fue capturado)

```tsx
<div className="flex items-center justify-between mt-2">
  {!leadCaptured ? (
    <button
      type="button"
      onClick={() => setShowLeadForm(true)}
      className="text-xs font-medium text-primary hover:underline"
    >
      📞 Quiero que me contacten
    </button>
  ) : (
    <p className="text-xs text-muted-foreground">Presioná Enter para enviar</p>
  )}
  <a
    href={`https://wa.me/${WHATSAPP_NUMBER}?text=${WHATSAPP_MESSAGE}`}
    target="_blank"
    rel="noopener noreferrer"
    className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 font-medium transition-colors"
  >
    <WhatsAppIcon className="w-3.5 h-3.5" />
    Hablar con una persona
  </a>
</div>
```

(Se elimina el `<div className="flex items-center justify-between mt-2">` original que tenía solo el `<p>` y el link, ya que este lo reemplaza.)

- [ ] **Step 8: Typecheck + lint**

Run: `npx tsc --noEmit -p tsconfig.json`
Run: `npx eslint components/chatbot/chatbot-panel.tsx`
Expected: sin errores.

- [ ] **Step 9: Commit**

```bash
git add components/chatbot/chatbot-panel.tsx
git commit -m "feat(chatbot): mostrar mini-form por interés y botón fijo de contacto"
```

---

### Task 5: Empujón del bot hacia el form (system prompt)

**Files:**
- Modify: `app/api/chatbot/route.ts` (bloque `systemPrompt`, ~líneas 106-113)

- [ ] **Step 1: Ajustar la instrucción de captación** (reemplazar la viñeta que empieza con "Si el usuario muestra interés genuino…")

```ts
- Si el usuario muestra interés genuino (pregunta por demo, precios o cómo empezar), invitalo de forma natural a dejar su nombre y WhatsApp en el formulario "Quiero que me contacten" que aparece abajo, para que una persona del equipo lo contacte. No insistas ni pidas todos los datos en el texto del chat.
```

- [ ] **Step 2: Verificar build del route**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add app/api/chatbot/route.ts
git commit -m "feat(chatbot): el bot invita a usar el form de contacto cuando hay interés"
```

---

## Verificación final

- [ ] `npx vitest run __tests__/lib/lead-form-validation.test.ts __tests__/api/chatbot-capture-lead.test.ts __tests__/components/lead-capture-form.test.tsx`
- [ ] `npx tsc --noEmit -p tsconfig.json`
- [ ] `npx eslint components/chatbot app/api/chatbot/capture-lead/route.ts`
- [ ] Smoke manual (opcional, en preview de Vercel): abrir el chat, preguntar por precio → aparece el form; enviar Nombre + WhatsApp → badge "Tus datos quedaron guardados" → el lead aparece en `/superadmin/leads` como caliente (score 85).

## Notas

- No se modifica `lib/chatbot/upsert-lead.ts`: ya acepta `score` e `interes` en `LeadUpsertData` y aplica `visto=false` / dedup correctamente.
- Aviso al equipo: vía panel de superadmin (badge de "calientes no vistos", score ≥ 80). Sin WhatsApp/email en esta entrega.
- Fuera de alcance: arreglo de `RESEND_API_KEY` (emails de lead/órdenes fallan en prod, problema aparte).
