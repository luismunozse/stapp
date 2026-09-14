# Separación de proveedor de email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrutar el correo dirigido al cliente final del taller por Resend sobre el subdominio `avisos.stapp.com.ar`, con seguimiento de entrega y supresión automática, dejando todo el correo de plataforma en EnvialoSimple.

**Architecture:** Se introduce una interfaz `EmailProvider` con dos implementaciones (EnvialoSimple y Resend) y dos funciones de ruteo con nombre explícito: `sendPlatform()` y `sendCustomer()`. El correo de plataforma no cambia de proveedor. El estado de entrega se registra en columnas nuevas de `notification_logs`, alimentadas por un webhook firmado que Resend invoca. Una lista de supresión global corta los envíos a direcciones muertas antes de llegar al proveedor.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase (PostgreSQL vía `supabaseAdmin`), Vitest, `svix` (verificación de firma del webhook).

**Spec:** `docs/superpowers/specs/2026-08-31-email-provider-split-design.md`

## Global Constraints

- **Migración:** el número libre es **321**. El 320 (`vendedores_manejan_caja`) está aplicado desde 2026-08-30.
- **Las migraciones se aplican a mano**, nunca desde CI: `node scripts/db-run.mjs <archivo>` corre en dry-run (envuelve todo en una transacción y hace ROLLBACK). Con `--apply` es permanente. Requiere `SUPABASE_DB_URL` en `.env.production.local`, apuntando a la **conexión directa (puerto 5432)**, no al pooler.
- **Sin `ALTER TYPE ... ADD VALUE` en este cambio.** `db-run.mjs` manda el archivo como multi-command string y PostgreSQL rechaza `ALTER TYPE ... ADD` en ese contexto. Se usa una columna nueva con `CHECK`, no una extensión del enum `estado_notificacion`.
- **Idioma de artefactos:** los comentarios de migraciones y de código en este repo están en español neutro. Los identificadores siguen el patrón mixto existente (tablas y columnas en español, nombres de función en inglés).
- **Remitente de plataforma:** `noreply@stapp.com.ar` (`EMAIL_FROM`). **Remitente de cliente:** `avisos@avisos.stapp.com.ar` (`RESEND_FROM`).
- **Tests:** Vitest. `include: ['**/*.{test,spec}.{ts,tsx}']`, así que un test en `lib/email/__tests__/` se descubre solo. `environment: 'jsdom'`, `globals: true`, timeout 30s.
- **`npm run lint` no termina** (recorre los worktrees). Usar `npx eslint <dirs>` acotado.
- **`npx tsc --noEmit` es parte de la definición de "listo".** El lint no chequea tipos y ya rompió builds antes.
- **No agregar `Co-Authored-By` ni atribución de IA a los commits.** Conventional commits.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `lib/email/types.ts` | Contratos: `EmailMessage`, `SendResult`, `EmailProvider`, `EmailAttachment`. Sin lógica. |
| `lib/email/providers/envialosimple.ts` | Adaptador HTTP a EnvialoSimple. Es el `fetch` que hoy vive en `lib/email.ts:169`, movido sin cambio de conducta. |
| `lib/email/providers/resend.ts` | Adaptador HTTP a Resend. |
| `lib/email/suppression.ts` | Consulta y alta en `email_suprimidos`. Aislado para que el router no dependa de Supabase directamente. |
| `lib/email/index.ts` | Router: `sendPlatform()` y `sendCustomer()`. Único lugar que decide proveedor. |
| `lib/email.ts` | **Sin cambios en las plantillas.** Sólo su `sendEmail` interno pasa a delegar en `sendPlatform`. |
| `lib/notifications/send-direct.ts` | Camino vivo en producción. Pasa a `sendCustomer` y persiste `provider_message_id` + `proveedor`. |
| `lib/notifications/index.ts` | Segundo camino. Mismo cambio. |
| `app/api/webhooks/resend/route.ts` | Recibe eventos de Resend, verifica firma, avanza el estado de entrega y suprime direcciones. |
| `supabase/migrations/321_email_delivery_tracking.sql` | Columnas de entrega en `notification_logs` + tabla `email_suprimidos`. |

---

## Task 1: Interfaz `EmailProvider` y adaptador EnvialoSimple

**Files:**
- Create: `lib/email/types.ts`
- Create: `lib/email/providers/envialosimple.ts`
- Create: `lib/email/index.ts`
- Modify: `lib/email.ts:5-6` (constantes) y `lib/email.ts:148-226` (`SendEmailParams` + `sendEmail`)
- Test: `lib/email/__tests__/provider-envialosimple.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `EmailAttachment = { filename: string; content: string; type: string }`
  - `EmailMessage = { to: string; subject: string; html: string; fromName?: string; substitutions?: Record<string,string>; attachments?: EmailAttachment[] }`
  - `SendResult = { id: string | null; proveedor: "envialosimple" | "resend" }`
  - `EmailProvider = { readonly nombre: "envialosimple" | "resend"; send(msg: EmailMessage): Promise<SendResult> }`
  - `sendPlatform(msg: EmailMessage): Promise<SendResult>`

> **Nota de diseño:** hoy `lib/email.ts:6` lee `process.env.EMAIL_FROM` **al cargar el módulo**. Eso hace imposible testear el remitente, porque el valor queda congelado antes de que el test pueda cambiarlo. El adaptador lo lee **en cada llamada**. Es el único cambio de conducta de esta tarea y es deliberado.

- [ ] **Step 1: Write the failing test**

Create `lib/email/__tests__/provider-envialosimple.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

const ENV_URL = "https://backend.envialosimple.email/api/v1/mail/send"

describe("envialoSimpleProvider", () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.ENVIALOSIMPLE_API_KEY = "key-test"
    process.env.EMAIL_FROM = "noreply@stapp.com.ar"
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "es-123" }),
    }) as any
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("pega a la URL de EnvialoSimple y devuelve el id", async () => {
    const { envialoSimpleProvider } = await import("../providers/envialosimple")

    const result = await envialoSimpleProvider.send({
      to: "cliente@example.com",
      subject: "Asunto",
      html: "<p>hola</p>",
    })

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(global.fetch).mock.calls[0]
    expect(url).toBe(ENV_URL)
    expect((init as any).headers.Authorization).toBe("Bearer key-test")
    expect(result).toEqual({ id: "es-123", proveedor: "envialosimple" })
  })

  it("compone el from con el nombre visible sobre la direccion verificada", async () => {
    const { envialoSimpleProvider } = await import("../providers/envialosimple")

    await envialoSimpleProvider.send({
      to: "cliente@example.com",
      subject: "Asunto",
      html: "<p>hola</p>",
      fromName: "Taller Pepe",
    })

    const body = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string)
    expect(body.from).toBe("Taller Pepe <noreply@stapp.com.ar>")
  })

  it("mapea adjuntos con disposition attachment", async () => {
    const { envialoSimpleProvider } = await import("../providers/envialosimple")

    await envialoSimpleProvider.send({
      to: "cliente@example.com",
      subject: "Asunto",
      html: "<p>hola</p>",
      attachments: [{ filename: "a.pdf", content: "YmFzZTY0", type: "application/pdf" }],
    })

    const body = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string)
    expect(body.attachments).toEqual([
      { filename: "a.pdf", content: "YmFzZTY0", type: "application/pdf", disposition: "attachment" },
    ])
  })

  it("tira si falta la API key", async () => {
    delete process.env.ENVIALOSIMPLE_API_KEY
    const { envialoSimpleProvider } = await import("../providers/envialosimple")

    await expect(
      envialoSimpleProvider.send({ to: "a@b.com", subject: "s", html: "h" })
    ).rejects.toThrow("ENVIALOSIMPLE_API_KEY no esta configurada")
  })

  it("tira con el cuerpo del error si el proveedor responde no-ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "direccion invalida",
    }) as any
    const { envialoSimpleProvider } = await import("../providers/envialosimple")

    await expect(
      envialoSimpleProvider.send({ to: "a@b.com", subject: "s", html: "h" })
    ).rejects.toThrow("direccion invalida")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/email/__tests__/provider-envialosimple.test.ts`
Expected: FAIL — `Failed to resolve import "../providers/envialosimple"`.

- [ ] **Step 3: Write `lib/email/types.ts`**

```ts
/** Contratos del envio de correo. Sin logica: sólo la forma de los datos. */

export interface EmailAttachment {
  filename: string
  /** Contenido en base64. */
  content: string
  /** MIME type, ej. "application/pdf". */
  type: string
}

export interface EmailMessage {
  to: string
  subject: string
  html: string
  /**
   * Nombre visible del remitente (ej. el nombre del taller). La direccion
   * siempre es la verificada del proveedor, nunca la del taller.
   */
  fromName?: string
  /** Sustituciones del lado del proveedor. Sólo EnvialoSimple las soporta. */
  substitutions?: Record<string, string>
  attachments?: EmailAttachment[]
}

export type NombreProveedor = "envialosimple" | "resend"

export interface SendResult {
  /** Id que asigna el proveedor. Es la clave de correlacion con el webhook. */
  id: string | null
  proveedor: NombreProveedor
}

export interface EmailProvider {
  readonly nombre: NombreProveedor
  send(msg: EmailMessage): Promise<SendResult>
}

/** Extrae la direccion de un from con formato "Nombre <addr>" o "addr". */
export function addressOf(from: string): string {
  const match = from.match(/<([^>]+)>/)
  return match ? match[1].trim() : from.trim()
}
```

- [ ] **Step 4: Write `lib/email/providers/envialosimple.ts`**

```ts
import { addressOf, type EmailProvider } from "../types"

const API_URL = "https://backend.envialosimple.email/api/v1/mail/send"

/**
 * Adaptador a EnvialoSimple. Es el `fetch` que vivia en lib/email.ts, movido
 * sin cambio de conducta salvo uno: EMAIL_FROM se lee en cada llamada y no al
 * cargar el modulo, para que sea testeable.
 */
export const envialoSimpleProvider: EmailProvider = {
  nombre: "envialosimple",

  async send({ to, subject, html, fromName, substitutions, attachments }) {
    const apiKey = process.env.ENVIALOSIMPLE_API_KEY
    if (!apiKey) {
      throw new Error("ENVIALOSIMPLE_API_KEY no esta configurada")
    }

    const base = process.env.EMAIL_FROM || "noreply@stapp.com.ar"
    const from = fromName ? `${fromName} <${addressOf(base)}>` : base

    const payload: Record<string, unknown> = { from, to, subject, html }

    if (substitutions) {
      payload.substitutions = substitutions
    }

    if (attachments && attachments.length > 0) {
      payload.attachments = attachments.map((att) => ({
        filename: att.filename,
        content: att.content,
        type: att.type,
        disposition: "attachment",
      }))
    }

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorData = await response.text()
      console.error("EnvialoSimple error:", errorData)
      console.error("EnvialoSimple status:", response.status)
      throw new Error(`Error al enviar el correo: ${errorData}`)
    }

    const json = (await response.json()) as { id?: string } | null
    return { id: json?.id ?? null, proveedor: "envialosimple" }
  },
}
```

- [ ] **Step 5: Write `lib/email/index.ts`**

```ts
import { envialoSimpleProvider } from "./providers/envialosimple"
import type { EmailMessage, SendResult } from "./types"

export type { EmailMessage, EmailAttachment, SendResult, EmailProvider } from "./types"

/**
 * Correo de plataforma: verificacion de cuenta, reset de contrasena,
 * facturacion, leads, soporte, cotizaciones y los crons de lifecycle.
 * Sale por el dominio principal.
 */
export async function sendPlatform(msg: EmailMessage): Promise<SendResult> {
  return envialoSimpleProvider.send(msg)
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run lib/email/__tests__/provider-envialosimple.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Delegar `lib/email.ts` en `sendPlatform`**

En `lib/email.ts`, borrar las constantes de las líneas 5-6 (`ENVIALOSIMPLE_API_URL` y `EMAIL_FROM`), borrar la función `addressOf` (líneas 163-166) y reemplazar el bloque `interface SendEmailParams` + `export async function sendEmail` (líneas 148-226) por:

```ts
import { sendPlatform, type EmailMessage } from "@/lib/email/index"

type SendEmailParams = EmailMessage

/**
 * Envio de correo de PLATAFORMA. Para correo dirigido al cliente final del
 * taller usar `sendCustomer` de "@/lib/email/index": sale por otro proveedor y
 * otro dominio a proposito.
 */
export async function sendEmail(params: SendEmailParams) {
  return sendPlatform(params)
}
```

`CONTACT_EMAIL`, `formatCurrencyValue` y `formatDateValue` siguen importándose igual. Las 8 funciones de plantilla (`sendVerificationEmail`, `sendAccountActivatedEmail`, `sendPasswordResetEmail`, `sendSupportReplyEmail`, `sendCotizacionEmail`, `sendAdminEmail`, `sendNewLeadNotification`, `sendAlertDigestEmail`) **no se tocan**.

- [ ] **Step 8: Verificar que nada se rompió**

Run: `npx vitest run __tests__/api/register-email-sent.test.ts __tests__/api/verify-email.test.ts __tests__/api/email-html-escape.test.ts lib/email/__tests__/`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 9: Commit**

```bash
git add lib/email/ lib/email.ts
git commit -m "refactor(email): extraer interfaz EmailProvider y adaptador EnvialoSimple

Mueve el fetch a EnvialoSimple detras de una interfaz y expone sendPlatform.
Conducta identica salvo que EMAIL_FROM pasa a leerse en cada llamada en vez de
al cargar el modulo, que era lo que impedia testear el remitente."
```

---

## Task 2: `sendCustomer` y rewiring de los dos caminos de notificación

**Files:**
- Modify: `lib/email/index.ts`
- Modify: `lib/notifications/send-direct.ts:2` (import) y `:92-98` (llamada)
- Modify: `lib/notifications/index.ts:2` (import) y `:96-100` (llamada)
- Test: `lib/email/__tests__/router.test.ts`

**Interfaces:**
- Consumes: `sendPlatform`, `EmailMessage`, `SendResult` de la Task 1.
- Produces: `sendCustomer(msg: EmailMessage): Promise<SendResult>`

> **Por qué son dos call sites.** `lib/notifications/` tiene dos rutas de correo al cliente. La viva en producción es `sendNotificationDirect` (`send-direct.ts:92`), invocada por `queueNotification` (`queue.ts:62`). `NotificationService.sendEmail` (`index.ts:96`) es la segunda; de esa clase la API sólo consume `getNotificationHistory`. **Cambiar sólo `index.ts` no altera nada en producción y el deploy pasa verde igual.** Ambas van.

En esta tarea `sendCustomer` todavía apunta a EnvialoSimple: no hay Resend hasta la Task 4. La conducta en producción no cambia. Esto es la costura, no el cambio.

- [ ] **Step 1: Write the failing test**

Create `lib/email/__tests__/router.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest"

const ENV_URL = "https://backend.envialosimple.email/api/v1/mail/send"

describe("router de email", () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.ENVIALOSIMPLE_API_KEY = "key-test"
    process.env.EMAIL_FROM = "noreply@stapp.com.ar"
    delete process.env.RESEND_API_KEY
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "es-1" }),
    }) as any
  })

  it("sendPlatform sale por EnvialoSimple", async () => {
    const { sendPlatform } = await import("../index")
    await sendPlatform({ to: "a@b.com", subject: "s", html: "h" })
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(ENV_URL)
  })

  it("sendCustomer sin RESEND_API_KEY cae a EnvialoSimple", async () => {
    const { sendCustomer } = await import("../index")
    const result = await sendCustomer({ to: "a@b.com", subject: "s", html: "h" })
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(ENV_URL)
    expect(result.proveedor).toBe("envialosimple")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/email/__tests__/router.test.ts`
Expected: FAIL — `sendCustomer is not a function`.

- [ ] **Step 3: Agregar `sendCustomer` a `lib/email/index.ts`**

```ts
/**
 * Correo dirigido al CLIENTE FINAL del taller: cambios de estado de orden,
 * presupuesto, recordatorio de retiro, garantia, cobranza.
 *
 * Sale por un proveedor y un subdominio distintos a proposito. Si esta rama
 * se llenara de correo de plataforma, un pico de rebotes en el canal operativo
 * volveria a tumbar la verificacion de cuenta y el reset de contrasena, que es
 * exactamente lo que esta separacion evita.
 */
export async function sendCustomer(msg: EmailMessage): Promise<SendResult> {
  return envialoSimpleProvider.send(msg)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/email/__tests__/router.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Rewire `lib/notifications/send-direct.ts`**

Reemplazar el import de la línea 2:

```ts
import { sendCustomer } from "@/lib/email/index"
```

Y en el bloque de envío (líneas 92-98) cambiar `sendEmail(` por `sendCustomer(`:

```ts
      const result = await sendCustomer({
        to: context.cliente.email,
        subject,
        html,
        fromName: context.organizationName,
      })
```

- [ ] **Step 6: Rewire `lib/notifications/index.ts`**

Reemplazar el import de la línea 2:

```ts
import { sendCustomer } from "@/lib/email/index"
```

Y en el bloque de envío (líneas 96-100):

```ts
      const result = await sendCustomer({
        to: context.cliente.email,
        subject: emailContent.subject,
        html: emailContent.html,
      })
```

- [ ] **Step 7: Verificar la suite de notificaciones**

Run: `npx vitest run lib/notifications/ lib/email/ __tests__/api/email-html-escape.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add lib/email/index.ts lib/notifications/send-direct.ts lib/notifications/index.ts
git commit -m "refactor(email): rutear las notificaciones al cliente por sendCustomer

Los dos caminos de correo al cliente (send-direct, que es el vivo en prod, y
NotificationService) pasan por sendCustomer. Todavia resuelve a EnvialoSimple:
la conducta en produccion no cambia. Es la costura para el proveedor nuevo."
```

**Fin del PR 1.** Abrir PR con los dos commits. Riesgo nulo: conducta idéntica.

---

## Task 3: Migración 321 — columnas de entrega y tabla de supresión

**Files:**
- Create: `supabase/migrations/321_email_delivery_tracking.sql`
- Create: `supabase/migrations/verify/321_probes.sql`

**Interfaces:**
- Consumes: nada.
- Produces: columnas `provider_message_id`, `proveedor`, `estado_entrega`, `delivered_at`, `bounced_at`, `bounce_tipo` en `notification_logs`; tabla `email_suprimidos`.

> **Desvío respecto del spec, deliberado.** El spec proponía extender el enum `estado_notificacion` con `ENTREGADO`/`REBOTADO`/`QUEJA`. No se hace, por dos razones:
>
> 1. `db-run.mjs` manda el archivo como multi-command string y PostgreSQL rechaza `ALTER TYPE ... ADD` en ese contexto. Es el mismo footgun que apareció en la 316/317.
> 2. Son **dos hechos distintos**. `estado` responde "¿el proveedor lo aceptó?" (ENVIADO/FALLIDO). El estado de entrega responde "¿qué pasó después?". Meterlos en un enum obliga además a tocar todos los consumidores TypeScript de `estado_notificacion`.
>
> Se usa una columna `estado_entrega TEXT` con `CHECK`. `estado` conserva su semántica y ningún consumidor existente se rompe.

- [ ] **Step 1: Escribir la migración**

Create `supabase/migrations/321_email_delivery_tracking.sql`:

```sql
-- ============================================================================
-- 321: seguimiento de entrega del correo al cliente + lista de supresion
-- ============================================================================
-- Contexto: hasta ahora notification_logs registraba el INTENTO de envio, no
-- el resultado. estado='ENVIADO' significa "el proveedor acepto el POST", no
-- "el correo llego". Nadie volvia a tocar la fila: si un aviso rebotaba, el
-- taller no se enteraba nunca.
--
-- POR QUE NO SE EXTIENDE EL ENUM estado_notificacion
-- Dos motivos. Primero, scripts/db-run.mjs manda el archivo como multi-command
-- string y PostgreSQL rechaza ALTER TYPE ... ADD en ese contexto. Segundo, y
-- mas importante: son dos hechos distintos. `estado` responde "lo acepto el
-- proveedor"; `estado_entrega` responde "que paso despues". Separarlos deja
-- intacta la semantica de estado y a todos sus consumidores.
--
-- POR QUE LA SUPRESION ES GLOBAL Y NO POR ORGANIZACION
-- Las organizaciones comparten el subdominio de envio avisos.stapp.com.ar, asi
-- que comparten reputacion. Si la organizacion A cobra un hard bounce y la B
-- sigue pegandole a esa misma casilla inexistente, el que se degrada es el
-- dominio de todas. organization_id queda para auditoria -saber quien origino
-- la supresion- pero la CONSULTA es por email solo.
-- ============================================================================

-- ── notification_logs: resultado post-envio ────────────────────────────────

ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS proveedor TEXT NOT NULL DEFAULT 'envialosimple',
  ADD COLUMN IF NOT EXISTS estado_entrega TEXT,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bounce_tipo TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_logs_estado_entrega_check'
  ) THEN
    ALTER TABLE notification_logs
      ADD CONSTRAINT notification_logs_estado_entrega_check
      CHECK (estado_entrega IS NULL OR estado_entrega IN ('ENTREGADO', 'REBOTADO', 'QUEJA'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_logs_bounce_tipo_check'
  ) THEN
    ALTER TABLE notification_logs
      ADD CONSTRAINT notification_logs_bounce_tipo_check
      CHECK (bounce_tipo IS NULL OR bounce_tipo IN ('HARD', 'SOFT', 'QUEJA'));
  END IF;
END $$;

-- El webhook busca por este id en cada evento. Sin indice hace full scan de
-- toda la tabla por evento recibido. Parcial porque las filas viejas lo tienen
-- en NULL y no se van a consultar nunca.
CREATE INDEX IF NOT EXISTS notification_logs_provider_msg_idx
  ON notification_logs (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

COMMENT ON COLUMN notification_logs.provider_message_id IS
  'Id que asigno el proveedor al aceptar el envio. Clave de correlacion con el webhook. Hasta la 321 vivia dentro de metadata, que es TEXT y no se puede indexar.';
COMMENT ON COLUMN notification_logs.proveedor IS
  'Proveedor que curso el envio: envialosimple o resend. Necesaria mientras el kill switch permita que convivan filas de ambos.';
COMMENT ON COLUMN notification_logs.estado_entrega IS
  'Resultado POSTERIOR al envio, informado por webhook: ENTREGADO, REBOTADO o QUEJA. NULL = todavia sin novedades. Distinto de estado, que solo dice si el proveedor acepto el POST.';
COMMENT ON COLUMN notification_logs.bounce_tipo IS
  'HARD, SOFT o QUEJA. Cubre tambien la queja por spam a proposito: operativamente es el mismo hecho (esta direccion no debe recibir mas correo) y duplicar columnas solo para la queja agregaria estado sin agregar informacion.';

-- ── email_suprimidos: direcciones que no deben recibir mas correo ──────────

CREATE TABLE IF NOT EXISTS email_suprimidos (
  id                  TEXT PRIMARY KEY DEFAULT generate_cuid(),
  email               TEXT NOT NULL,
  motivo              TEXT NOT NULL,
  proveedor           TEXT,
  organization_id     TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  notification_log_id TEXT REFERENCES notification_logs(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT email_suprimidos_motivo_check
    CHECK (motivo IN ('HARD_BOUNCE', 'QUEJA', 'MANUAL'))
);

-- La consulta del envio es por email, case-insensitive. El unique tambien
-- hace idempotente el ON CONFLICT DO NOTHING del webhook ante reintentos.
CREATE UNIQUE INDEX IF NOT EXISTS email_suprimidos_email_idx
  ON email_suprimidos (lower(email));

COMMENT ON TABLE email_suprimidos IS
  'Direcciones a las que no se envia mas correo al cliente. GLOBAL, no por organizacion: todas comparten el subdominio avisos.stapp.com.ar y por lo tanto la reputacion. organization_id es solo auditoria de quien la origino.';

-- Tabla global sin organization_id obligatorio: expuesta via PostgREST
-- filtraria direcciones de clientes de TODAS las organizaciones. Solo la
-- service role la toca.
ALTER TABLE email_suprimidos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON email_suprimidos FROM anon, authenticated;
```

- [ ] **Step 2: Escribir los probes de verificación**

Create `supabase/migrations/verify/321_probes.sql`:

```sql
-- Probes de la 321. Abre su propia transaccion y la revierte: db-run.mjs
-- detecta el BEGIN y rechaza --apply.
BEGIN;

-- 1. Las seis columnas existen
SELECT 'col ' || column_name AS probe, 'OK' AS resultado
FROM information_schema.columns
WHERE table_name = 'notification_logs'
  AND column_name IN ('provider_message_id','proveedor','estado_entrega','delivered_at','bounced_at','bounce_tipo')
ORDER BY column_name;

-- 2. El CHECK de estado_entrega rechaza un valor invalido
DO $$
BEGIN
  BEGIN
    UPDATE notification_logs SET estado_entrega = 'CUALQUIERA' WHERE id = (SELECT id FROM notification_logs LIMIT 1);
    RAISE EXCEPTION 'FALLO: el CHECK de estado_entrega no rechazo un valor invalido';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK: CHECK de estado_entrega activo';
  END;
END $$;

-- 3. El indice unico de supresion es case-insensitive
INSERT INTO email_suprimidos (email, motivo) VALUES ('Test@Example.com', 'MANUAL');
DO $$
BEGIN
  BEGIN
    INSERT INTO email_suprimidos (email, motivo) VALUES ('test@example.com', 'MANUAL');
    RAISE EXCEPTION 'FALLO: el unique index no es case-insensitive';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK: unique index case-insensitive activo';
  END;
END $$;

-- 4. RLS habilitado en email_suprimidos
SELECT 'rls email_suprimidos' AS probe,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'FALLO' END AS resultado
FROM pg_class WHERE relname = 'email_suprimidos';

ROLLBACK;
```

- [ ] **Step 3: Dry-run de la migración**

Run: `node scripts/db-run.mjs supabase/migrations/321_email_delivery_tracking.sql`
Expected: corre sin error y reporta ROLLBACK. **No** aplicar todavía — se aplica en el paso de operación del PR 2, junto con el deploy.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/321_email_delivery_tracking.sql supabase/migrations/verify/321_probes.sql
git commit -m "feat(email): migracion 321, seguimiento de entrega y lista de supresion

Agrega a notification_logs el resultado posterior al envio (estado_entrega,
timestamps, proveedor, provider_message_id indexado) y crea email_suprimidos,
global y solo accesible por service role. No extiende el enum
estado_notificacion a proposito: son dos hechos distintos y ALTER TYPE ... ADD
no corre en el multi-command string de db-run.mjs."
```

---

## Task 4: Adaptador Resend y kill switch

**Files:**
- Create: `lib/email/providers/resend.ts`
- Modify: `lib/email/index.ts` (`sendCustomer`)
- Test: `lib/email/__tests__/provider-resend.test.ts`, `lib/email/__tests__/router.test.ts` (agregar casos)

**Interfaces:**
- Consumes: `EmailProvider`, `EmailMessage`, `SendResult`, `addressOf` de la Task 1.
- Produces: `resendProvider: EmailProvider`.

> **Resend no soporta `substitutions` ni necesitamos adjuntos en este canal.** El adaptador **tira** si los recibe en vez de ignorarlos. Un drop silencioso convertiría un futuro error de ruteo en un correo mutilado que nadie mira; así se rompe fuerte y temprano.

- [ ] **Step 1: Write the failing test**

Create `lib/email/__tests__/provider-resend.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest"

const RESEND_URL = "https://api.resend.com/emails"

describe("resendProvider", () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.RESEND_API_KEY = "re_test"
    process.env.RESEND_FROM = "avisos@avisos.stapp.com.ar"
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" }),
    }) as any
  })

  it("pega a la API de Resend con bearer y devuelve el id", async () => {
    const { resendProvider } = await import("../providers/resend")

    const result = await resendProvider.send({
      to: "cliente@example.com",
      subject: "Tu orden esta lista",
      html: "<p>hola</p>",
    })

    const [url, init] = vi.mocked(global.fetch).mock.calls[0]
    expect(url).toBe(RESEND_URL)
    expect((init as any).headers.Authorization).toBe("Bearer re_test")
    expect(result).toEqual({
      id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794",
      proveedor: "resend",
    })
  })

  it("usa el nombre del taller sobre la direccion del subdominio de avisos", async () => {
    const { resendProvider } = await import("../providers/resend")

    await resendProvider.send({
      to: "cliente@example.com",
      subject: "s",
      html: "h",
      fromName: "Taller Pepe",
    })

    const body = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string)
    expect(body.from).toBe("Taller Pepe <avisos@avisos.stapp.com.ar>")
  })

  it("tira si le pasan substitutions, que Resend no soporta", async () => {
    const { resendProvider } = await import("../providers/resend")

    await expect(
      resendProvider.send({ to: "a@b.com", subject: "s", html: "h", substitutions: { x: "1" } })
    ).rejects.toThrow("substitutions")
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("tira si falta la API key", async () => {
    delete process.env.RESEND_API_KEY
    const { resendProvider } = await import("../providers/resend")

    await expect(
      resendProvider.send({ to: "a@b.com", subject: "s", html: "h" })
    ).rejects.toThrow("RESEND_API_KEY no esta configurada")
  })

  it("tira con el cuerpo del error si Resend responde no-ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"message":"API key is invalid"}',
    }) as any
    const { resendProvider } = await import("../providers/resend")

    await expect(
      resendProvider.send({ to: "a@b.com", subject: "s", html: "h" })
    ).rejects.toThrow("API key is invalid")
  })
})
```

Agregar a `lib/email/__tests__/router.test.ts`:

```ts
  it("sendCustomer con RESEND_API_KEY sale por Resend", async () => {
    process.env.RESEND_API_KEY = "re_test"
    process.env.RESEND_FROM = "avisos@avisos.stapp.com.ar"
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "re-1" }),
    }) as any

    const { sendCustomer } = await import("../index")
    const result = await sendCustomer({ to: "a@b.com", subject: "s", html: "h" })

    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe("https://api.resend.com/emails")
    expect(result.proveedor).toBe("resend")
  })

  it("un 401 de Resend NO cae a EnvialoSimple", async () => {
    process.env.RESEND_API_KEY = "re_malformada"
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "API key is invalid",
    }) as any

    const { sendCustomer } = await import("../index")

    await expect(sendCustomer({ to: "a@b.com", subject: "s", html: "h" })).rejects.toThrow()
    // Un solo intento: no hay segundo fetch al proveedor de plataforma.
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/email/__tests__/provider-resend.test.ts lib/email/__tests__/router.test.ts`
Expected: FAIL — no resuelve `../providers/resend`; el caso de Resend en el router falla porque `sendCustomer` sigue en EnvialoSimple.

- [ ] **Step 3: Write `lib/email/providers/resend.ts`**

```ts
import { addressOf, type EmailProvider } from "../types"

const API_URL = "https://api.resend.com/emails"

/**
 * Adaptador a Resend. Cursa SOLO el correo dirigido al cliente final del
 * taller, sobre el subdominio avisos.stapp.com.ar.
 */
export const resendProvider: EmailProvider = {
  nombre: "resend",

  async send({ to, subject, html, fromName, substitutions, attachments }) {
    // Resend no tiene sustituciones del lado del proveedor, y este canal no
    // manda adjuntos. Se rompe fuerte en vez de descartarlos en silencio: un
    // drop mudo convierte un error de ruteo en un correo mutilado que nadie
    // mira.
    if (substitutions) {
      throw new Error("resendProvider: substitutions no esta soportado en el canal de cliente")
    }
    if (attachments && attachments.length > 0) {
      throw new Error("resendProvider: attachments no esta soportado en el canal de cliente")
    }

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      throw new Error("RESEND_API_KEY no esta configurada")
    }

    const base = process.env.RESEND_FROM || "avisos@avisos.stapp.com.ar"
    const from = fromName ? `${fromName} <${addressOf(base)}>` : base

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    })

    if (!response.ok) {
      const errorData = await response.text()
      console.error("Resend error:", errorData)
      console.error("Resend status:", response.status)
      throw new Error(`Error al enviar el correo: ${errorData}`)
    }

    const json = (await response.json()) as { id?: string } | null
    return { id: json?.id ?? null, proveedor: "resend" }
  },
}
```

- [ ] **Step 4: Conectar el kill switch en `lib/email/index.ts`**

Agregar el import y reemplazar el cuerpo de `sendCustomer`:

```ts
import { resendProvider } from "./providers/resend"
```

```ts
export async function sendCustomer(msg: EmailMessage): Promise<SendResult> {
  // KILL SWITCH: la caida a EnvialoSimple ocurre SOLO por configuracion
  // ausente, NUNCA por un envio fallido. Un fallback en runtime romperia dos
  // cosas a la vez: mandaria correo de taller por el dominio que se quiere
  // aislar, y ocultaria la config rota detras de un "todo funciona".
  const provider = process.env.RESEND_API_KEY ? resendProvider : envialoSimpleProvider
  return provider.send(msg)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/email/`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Persistir `provider_message_id` y `proveedor` en los logs**

En `lib/notifications/send-direct.ts`, en el insert de éxito (líneas ~99-113), agregar las dos columnas nuevas:

```ts
      await supabaseAdmin.from("notification_logs").insert({
        organization_id: organizationId,
        orden_id: ordenId,
        garantia_id: garantiaId,
        cliente_id: clienteId,
        tipo,
        canal: "EMAIL",
        estado: "ENVIADO",
        destinatario: context.cliente.email,
        asunto: subject,
        contenido: html,
        error_message: null,
        provider_message_id: result.id,
        proveedor: result.proveedor,
        metadata: JSON.stringify({ messageId: result.id, provider: result.proveedor }),
      })
```

En `lib/notifications/index.ts`, `logNotification` recibe `messageId` pero no el proveedor. Extender su firma:

```ts
  private async logNotification(params: {
    type: NotificationType
    channel: NotificationChannel
    context: NotificationContext
    success: boolean
    messageId?: string
    proveedor?: string
    error?: string
    content: string
    subject?: string
  }): Promise<void> {
```

y en el insert agregar:

```ts
        provider_message_id: params.messageId || null,
        proveedor: params.proveedor || "envialosimple",
```

En la llamada de éxito de `sendEmail` (línea ~104) pasar `proveedor: result.proveedor` junto a `messageId: result.id`.

- [ ] **Step 7: Verificar**

Run: `npx vitest run lib/email/ lib/notifications/`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add lib/email/ lib/notifications/
git commit -m "feat(email): adaptador Resend con kill switch por RESEND_API_KEY

sendCustomer resuelve a Resend si la key esta cargada y a EnvialoSimple si no.
La caida al proveedor viejo es SOLO por config ausente: un 401 o un 5xx de
Resend tiran, no reintentan por el otro canal. Persiste provider_message_id y
proveedor en notification_logs para correlacionar el webhook."
```

**Fin del PR 2.** Se despliega **sin** `RESEND_API_KEY` en Vercel: en producción todo sigue por EnvialoSimple. Aplicar la migración 321 con `node scripts/db-run.mjs supabase/migrations/321_email_delivery_tracking.sql --apply` y correr los probes.

---

## Task 5: Lista de supresión

**Files:**
- Create: `lib/email/suppression.ts`
- Modify: `lib/email/index.ts` (`sendCustomer`)
- Test: `lib/email/__tests__/suppression.test.ts`

**Interfaces:**
- Consumes: `supabaseAdmin` de `@/lib/supabase`.
- Produces:
  - `estaSuprimido(email: string): Promise<string | null>` — devuelve el motivo o `null`.
  - `suprimirEmail(params: { email: string; motivo: "HARD_BOUNCE" | "QUEJA" | "MANUAL"; proveedor?: string; organizationId?: string | null; notificationLogId?: string | null }): Promise<void>`
  - `EmailSuprimidoError` — clase de error que lanza `sendCustomer`.

- [ ] **Step 1: Write the failing test**

Create `lib/email/__tests__/suppression.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createChainMock, mockSupabaseFrom } from "@/__tests__/api/helpers"

describe("supresion de email", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.RESEND_API_KEY = "re_test"
    process.env.RESEND_FROM = "avisos@avisos.stapp.com.ar"
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "re-1" }),
    }) as any
  })

  it("no envia a una direccion suprimida y tira EmailSuprimidoError", async () => {
    mockSupabaseFrom({
      email_suprimidos: createChainMock({ motivo: "HARD_BOUNCE" }),
    })

    const { sendCustomer } = await import("../index")

    await expect(
      sendCustomer({ to: "muerta@example.com", subject: "s", html: "h" })
    ).rejects.toThrow("email suprimido: HARD_BOUNCE")

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("envia normal si la direccion no esta suprimida", async () => {
    mockSupabaseFrom({
      email_suprimidos: createChainMock(null),
    })

    const { sendCustomer } = await import("../index")
    const result = await sendCustomer({ to: "viva@example.com", subject: "s", html: "h" })

    expect(result.proveedor).toBe("resend")
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it("si el lookup de supresion falla, ENVIA igual (fail open)", async () => {
    mockSupabaseFrom({
      email_suprimidos: createChainMock(null, { message: "connection reset" }),
    })

    const { sendCustomer } = await import("../index")
    const result = await sendCustomer({ to: "quien@example.com", subject: "s", html: "h" })

    expect(result.proveedor).toBe("resend")
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it("el chequeo corre TAMBIEN durante el fallback a EnvialoSimple", async () => {
    delete process.env.RESEND_API_KEY
    process.env.ENVIALOSIMPLE_API_KEY = "key-test"
    mockSupabaseFrom({
      email_suprimidos: createChainMock({ motivo: "QUEJA" }),
    })

    const { sendCustomer } = await import("../index")

    await expect(
      sendCustomer({ to: "muerta@example.com", subject: "s", html: "h" })
    ).rejects.toThrow("email suprimido: QUEJA")

    expect(global.fetch).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/email/__tests__/suppression.test.ts`
Expected: FAIL — `sendCustomer` no consulta supresión y llama a `fetch`.

- [ ] **Step 3: Write `lib/email/suppression.ts`**

```ts
import { supabaseAdmin } from "@/lib/supabase"

export type MotivoSupresion = "HARD_BOUNCE" | "QUEJA" | "MANUAL"

/** El destinatario esta en la lista de supresion y no se le envia. */
export class EmailSuprimidoError extends Error {
  constructor(public readonly motivo: string) {
    super(`email suprimido: ${motivo}`)
    this.name = "EmailSuprimidoError"
  }
}

/**
 * Devuelve el motivo de supresion, o null si la direccion puede recibir correo.
 *
 * FAIL OPEN: si la consulta falla, devuelve null y el envio sigue. Fallar
 * cerrado dejaria mudas a todas las organizaciones ante un hipo transitorio de
 * la base. El costo de un envio de mas a una casilla muerta es acotado; el de
 * silenciar a todos, no.
 */
export async function estaSuprimido(email: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("email_suprimidos")
      .select("motivo")
      .ilike("email", email)
      .maybeSingle()

    if (error) {
      console.error("estaSuprimido: fallo el lookup, se envia igual", error.message)
      return null
    }

    return (data as { motivo?: string } | null)?.motivo ?? null
  } catch (err) {
    console.error("estaSuprimido: excepcion en el lookup, se envia igual", err)
    return null
  }
}

/**
 * Da de baja una direccion. Idempotente: el unique index sobre lower(email)
 * absorbe los reintentos del webhook.
 */
export async function suprimirEmail(params: {
  email: string
  motivo: MotivoSupresion
  proveedor?: string
  organizationId?: string | null
  notificationLogId?: string | null
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from("email_suprimidos")
    .upsert(
      {
        email: params.email,
        motivo: params.motivo,
        proveedor: params.proveedor ?? null,
        organization_id: params.organizationId ?? null,
        notification_log_id: params.notificationLogId ?? null,
      },
      { onConflict: "email", ignoreDuplicates: true }
    )

  if (error) {
    console.error("suprimirEmail: no se pudo suprimir", params.email, error.message)
  }
}
```

- [ ] **Step 4: Conectar el chequeo en `sendCustomer`**

En `lib/email/index.ts`:

```ts
import { estaSuprimido, EmailSuprimidoError } from "./suppression"
```

```ts
export async function sendCustomer(msg: EmailMessage): Promise<SendResult> {
  // El chequeo va ANTES de elegir proveedor, y por lo tanto corre tambien
  // durante el fallback: la supresion es un hecho del destinatario, no del
  // proveedor. Enviar a una casilla suprimida por EnvialoSimple degradaria el
  // dominio de plataforma, que es justo lo que esta separacion protege.
  const motivo = await estaSuprimido(msg.to)
  if (motivo) {
    throw new EmailSuprimidoError(motivo)
  }

  // KILL SWITCH: la caida a EnvialoSimple ocurre SOLO por configuracion
  // ausente, NUNCA por un envio fallido.
  const provider = process.env.RESEND_API_KEY ? resendProvider : envialoSimpleProvider
  return provider.send(msg)
}
```

Exportar el error para que los call sites lo distingan:

```ts
export { EmailSuprimidoError } from "./suppression"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/email/`
Expected: PASS.

`send-direct.ts` ya envuelve el envío en `try/catch` y registra `estado='FALLIDO'` con `error_message`, así que la supresión queda logueada como `"email suprimido: HARD_BOUNCE"` sin cambios adicionales. No hace falta tocar los call sites.

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add lib/email/
git commit -m "feat(email): lista de supresion global antes del envio al cliente

sendCustomer consulta email_suprimidos antes de elegir proveedor, asi que el
chequeo corre tambien durante el fallback. Fail open a proposito: si el lookup
falla se envia igual, porque fallar cerrado dejaria mudas a todas las
organizaciones ante un hipo de la base."
```

---

## Task 6: Webhook de Resend

**Files:**
- Create: `app/api/webhooks/resend/route.ts`
- Modify: `package.json` (dependencia `svix`)
- Test: `__tests__/api/resend-webhook.test.ts`

**Interfaces:**
- Consumes: `suprimirEmail` de `lib/email/suppression.ts`, `supabaseAdmin`.
- Produces: endpoint `POST /api/webhooks/resend`.

> **Por qué `svix` y no HMAC a mano.** La verificación de firma es exactamente la clase de código donde un detalle sutil —comparación no constante en tiempo, tolerancia de timestamp ausente, manejo incorrecto de la versión de firma— abre un agujero silencioso. Este endpoint da de baja direcciones de correo: sin firma válida, cualquiera que descubra la URL podría dejar mudos a los talleres sin que ningún error se manifieste. Es una dependencia chica y es la oficial de Resend.

Payload real de Resend (confirmado en su documentación):

```json
{
  "type": "email.bounced",
  "created_at": "2026-11-22T23:41:12.126Z",
  "data": {
    "email_id": "56761188-7520-42d8-8898-ff6fc54ce618",
    "from": "Acme <onboarding@resend.dev>",
    "to": ["cliente@example.com"],
    "subject": "Sending this example",
    "bounce": { "message": "...", "subType": "Suppressed", "type": "Permanent" }
  }
}
```

Hard bounce es `data.bounce.type === "Permanent"`. Todo lo demás (`"Transient"`, `"Undetermined"`) es soft.

- [ ] **Step 1: Instalar `svix`**

Run: `npm install svix`

- [ ] **Step 2: Write the failing test**

Create `__tests__/api/resend-webhook.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

// La verificacion real de firma es de svix; aca se mockea para poder ejercitar
// tanto el camino valido como el invalido sin fabricar firmas reales.
const verify = vi.fn()
vi.mock("svix", () => ({
  Webhook: class {
    verify(...args: any[]) {
      return verify(...args)
    }
  },
}))

async function post(body: unknown, headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/api/webhooks/resend/route")
  const raw = JSON.stringify(body)
  return POST(
    new Request("http://localhost:3000/api/webhooks/resend", {
      method: "POST",
      headers: {
        "svix-id": "msg_1",
        "svix-timestamp": "1700000000",
        "svix-signature": "v1,firma",
        ...headers,
      },
      body: raw,
    })
  )
}

function evento(type: string, extra: Record<string, unknown> = {}) {
  return {
    type,
    created_at: "2026-08-31T12:00:00.000Z",
    data: {
      email_id: "re-abc",
      from: "Taller Pepe <avisos@avisos.stapp.com.ar>",
      to: ["cliente@example.com"],
      subject: "Tu orden esta lista",
      ...extra,
    },
  }
}

describe("POST /api/webhooks/resend", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.RESEND_WEBHOOK_SECRET = "whsec_test"
  })

  it("rechaza con 401 si la firma es invalida y no escribe nada", async () => {
    verify.mockImplementation(() => {
      throw new Error("No matching signature found")
    })
    const { supabaseAdmin } = await import("@/lib/supabase")
    const fromSpy = vi.fn()
    vi.mocked(supabaseAdmin.from).mockImplementation(fromSpy as any)

    const res = await post(evento("email.delivered"))

    expect(res.status).toBe(401)
    expect(fromSpy).not.toHaveBeenCalled()
  })

  it("email.delivered marca ENTREGADO", async () => {
    const payload = evento("email.delivered")
    verify.mockReturnValue(payload)
    // El update termina en .select(), asi que la cadena resuelve un ARRAY de
    // filas alcanzadas, no un objeto. Un objeto suelto haria que filas[0] sea
    // undefined y el test pasaria por el camino de "sin correlacionar".
    const logs = createChainMock([{ id: "log-1", organization_id: "org-1" }])
    mockSupabaseFrom({ notification_logs: logs })

    const res = await post(payload)

    expect(res.status).toBe(200)
    expect(logs.update).toHaveBeenCalledWith(
      expect.objectContaining({ estado_entrega: "ENTREGADO" })
    )
  })

  it("bounce Permanent marca REBOTADO y suprime la direccion", async () => {
    const payload = evento("email.bounced", {
      bounce: { message: "Unknown User", subType: "General", type: "Permanent" },
    })
    verify.mockReturnValue(payload)
    const logs = createChainMock([{ id: "log-1", organization_id: "org-1" }])
    const suprimidos = createChainMock(null)
    mockSupabaseFrom({ notification_logs: logs, email_suprimidos: suprimidos })

    const res = await post(payload)

    expect(res.status).toBe(200)
    expect(logs.update).toHaveBeenCalledWith(
      expect.objectContaining({ estado_entrega: "REBOTADO", bounce_tipo: "HARD" })
    )
    expect(suprimidos.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ email: "cliente@example.com", motivo: "HARD_BOUNCE" }),
      expect.anything()
    )
  })

  it("bounce Transient NO cambia estado_entrega ni suprime", async () => {
    const payload = evento("email.bounced", {
      bounce: { message: "Mailbox full", subType: "MailboxFull", type: "Transient" },
    })
    verify.mockReturnValue(payload)
    const logs = createChainMock([{ id: "log-1", organization_id: "org-1" }])
    const suprimidos = createChainMock(null)
    mockSupabaseFrom({ notification_logs: logs, email_suprimidos: suprimidos })

    await post(payload)

    const patch = vi.mocked(logs.update).mock.calls[0][0] as Record<string, unknown>
    expect(patch).not.toHaveProperty("estado_entrega")
    expect(patch.bounce_tipo).toBe("SOFT")
    // Sin estado nuevo no hay guard de precedencia: el soft bounce solo deja
    // constancia y no compite con ningun otro evento.
    expect(logs.or).not.toHaveBeenCalled()
    expect(suprimidos.upsert).not.toHaveBeenCalled()
  })

  it("email.complained marca QUEJA y suprime", async () => {
    const payload = evento("email.complained")
    verify.mockReturnValue(payload)
    const logs = createChainMock([{ id: "log-1", organization_id: "org-1" }])
    const suprimidos = createChainMock(null)
    mockSupabaseFrom({ notification_logs: logs, email_suprimidos: suprimidos })

    await post(payload)

    expect(logs.update).toHaveBeenCalledWith(
      expect.objectContaining({ estado_entrega: "QUEJA", bounce_tipo: "QUEJA" })
    )
    expect(suprimidos.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ motivo: "QUEJA" }),
      expect.anything()
    )
  })

  it("un delivered que llega DESPUES de una queja no la pisa", async () => {
    const payload = evento("email.delivered")
    verify.mockReturnValue(payload)
    // La fila ya esta en QUEJA, asi que el WHERE del update no alcanza ninguna:
    // devuelve array vacio.
    const logs = createChainMock([])
    mockSupabaseFrom({ notification_logs: logs })

    const res = await post(payload)

    expect(res.status).toBe(200)
    // El guard de precedencia va en el WHERE, no en una lectura previa: el
    // update se emite acotado a los estados previos permitidos y no toca nada.
    expect(logs.or).toHaveBeenCalledWith("estado_entrega.is.null")
    const { body } = await parseResponse(res.clone())
    expect(body.correlacionado).toBe(false)
  })

  it("un email_id desconocido devuelve 200, no 500", async () => {
    const payload = evento("email.delivered")
    verify.mockReturnValue(payload)
    mockSupabaseFrom({ notification_logs: createChainMock(null) })

    const res = await post(payload)

    expect(res.status).toBe(200)
  })

  it("un tipo de evento que no manejamos devuelve 200 sin tocar la base", async () => {
    const payload = evento("email.opened")
    verify.mockReturnValue(payload)
    const fromSpy = vi.fn()
    const { supabaseAdmin } = await import("@/lib/supabase")
    vi.mocked(supabaseAdmin.from).mockImplementation(fromSpy as any)

    const res = await post(payload)

    expect(res.status).toBe(200)
    expect(fromSpy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run __tests__/api/resend-webhook.test.ts`
Expected: FAIL — no resuelve `@/app/api/webhooks/resend/route`.

- [ ] **Step 4: Write `app/api/webhooks/resend/route.ts`**

```ts
import { NextResponse } from "next/server"
import { Webhook } from "svix"
import { supabaseAdmin } from "@/lib/supabase"
import { suprimirEmail } from "@/lib/email/suppression"

/**
 * Webhook de Resend: eventos de entrega del correo al cliente del taller.
 *
 * NO va bajo requireCronAuth. Este endpoint es publico por necesidad -lo llama
 * Resend- y su autenticacion ES la firma Svix. Sin verificarla, cualquiera que
 * descubra la URL podria dar de baja direcciones arbitrarias y dejar a los
 * talleres sin notificaciones, sin que ningun error se manifieste.
 */

type EventoResend = {
  type: string
  created_at: string
  data: {
    email_id: string
    to?: string[]
    subject?: string
    bounce?: { message?: string; subType?: string; type?: string }
  }
}

/**
 * El estado de entrega solo avanza. Los webhooks llegan desordenados: sin este
 * guard, un `delivered` retrasado pisaria una queja ya registrada, que es el
 * dato de mayor valor. El filtro va en el WHERE del UPDATE y no en una lectura
 * previa, para que sea atomico frente a eventos concurrentes.
 */
const ESTADOS_PREVIOS_PERMITIDOS: Record<string, string> = {
  ENTREGADO: "estado_entrega.is.null",
  REBOTADO: "estado_entrega.is.null,estado_entrega.eq.ENTREGADO",
  QUEJA: "estado_entrega.is.null,estado_entrega.eq.ENTREGADO,estado_entrega.eq.REBOTADO",
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    console.error("webhook resend: RESEND_WEBHOOK_SECRET no esta configurada")
    return NextResponse.json({ error: "webhook no configurado" }, { status: 500 })
  }

  // La firma se calcula sobre el cuerpo CRUDO. Llamar a request.json() primero
  // consume el stream y la verificacion falla siempre.
  const raw = await request.text()

  let evento: EventoResend
  try {
    evento = new Webhook(secret).verify(raw, {
      "svix-id": request.headers.get("svix-id") ?? "",
      "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
      "svix-signature": request.headers.get("svix-signature") ?? "",
    }) as EventoResend
  } catch (err) {
    console.error("webhook resend: firma invalida", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "firma invalida" }, { status: 401 })
  }

  const ahora = new Date().toISOString()
  const emailId = evento.data?.email_id
  const destinatario = evento.data?.to?.[0] ?? null

  let patch: Record<string, unknown> | null = null
  let nuevoEstado: string | null = null
  let motivoSupresion: "HARD_BOUNCE" | "QUEJA" | null = null

  switch (evento.type) {
    case "email.delivered":
      nuevoEstado = "ENTREGADO"
      patch = { estado_entrega: "ENTREGADO", delivered_at: ahora }
      break

    case "email.bounced": {
      const esHard = evento.data?.bounce?.type === "Permanent"
      if (esHard) {
        nuevoEstado = "REBOTADO"
        patch = { estado_entrega: "REBOTADO", bounced_at: ahora, bounce_tipo: "HARD" }
        motivoSupresion = "HARD_BOUNCE"
      } else {
        // Soft bounce: se deja constancia pero NO se mueve estado_entrega,
        // porque tras un rebote blando la entrega suele concretarse.
        patch = { bounced_at: ahora, bounce_tipo: "SOFT" }
      }
      break
    }

    case "email.complained":
      nuevoEstado = "QUEJA"
      patch = { estado_entrega: "QUEJA", bounced_at: ahora, bounce_tipo: "QUEJA" }
      motivoSupresion = "QUEJA"
      break

    default:
      // No suscribimos opened ni clicked, pero si alguien los habilita en el
      // panel de Resend no queremos que el endpoint empiece a devolver error.
      return NextResponse.json({ ok: true, ignorado: evento.type })
  }

  let query = supabaseAdmin
    .from("notification_logs")
    .update(patch)
    .eq("provider_message_id", emailId)

  if (nuevoEstado) {
    query = query.or(ESTADOS_PREVIOS_PERMITIDOS[nuevoEstado])
  }

  const { data: filas, error } = await query.select("id, organization_id")

  if (error) {
    console.error("webhook resend: fallo el update", error.message)
    // 500 para que Resend reintente: el evento es valido, la falla es nuestra.
    return NextResponse.json({ error: "no se pudo registrar el evento" }, { status: 500 })
  }

  const fila = (filas as Array<{ id: string; organization_id: string }> | null)?.[0] ?? null

  if (!fila) {
    // Puede ser correo anterior a la 321 (sin provider_message_id) o un evento
    // repetido que el guard de precedencia ya descarto. 200, NO 500: devolver
    // error haria que Resend reintente indefinidamente sobre correo que nunca
    // vamos a poder correlacionar.
    console.warn("webhook resend: sin fila para email_id", emailId, evento.type)
    return NextResponse.json({ ok: true, correlacionado: false })
  }

  if (motivoSupresion && destinatario) {
    await suprimirEmail({
      email: destinatario,
      motivo: motivoSupresion,
      proveedor: "resend",
      organizationId: fila.organization_id,
      notificationLogId: fila.id,
    })
  }

  return NextResponse.json({ ok: true, correlacionado: true })
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run __tests__/api/resend-webhook.test.ts`
Expected: PASS, 8 tests.

Run: `npx vitest run lib/email/ lib/notifications/ __tests__/api/`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npx eslint app/api/webhooks/resend lib/email`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add app/api/webhooks/resend/ __tests__/api/resend-webhook.test.ts package.json package-lock.json
git commit -m "feat(email): webhook de Resend con firma Svix y estado de entrega

Recibe delivered, bounced y complained; avanza estado_entrega con guard de
precedencia en el WHERE para que un evento retrasado no pise uno posterior, y
suprime la direccion ante hard bounce o queja. Un email_id desconocido devuelve
200 y no 500, si no Resend reintenta para siempre sobre correo previo a la 321."
```

**Fin del PR 3.** Es el punto de activación — ver "Pasos de operación" al final.

---

## Task 7: Estado de entrega visible en el historial de la orden

**Files:**
- Modify: `lib/notifications/index.ts` (`getNotificationHistory`, el `select`)
- Modify: `components/ordenes/notification-history.tsx` — `interface NotificationLog:24`, el mapeo a `TimelineEntry` en la línea ~119, y el subcomponente `EventoEntry:205`
- Test: `__tests__/api/notificaciones-historial-entrega.test.ts`

**Interfaces:**
- Consumes: columnas de la Task 3, poblado por la Task 6.
- Produces: `estado_entrega`, `delivered_at`, `bounced_at`, `bounce_tipo` en la respuesta de `GET /api/notificaciones`.

> Este PR es el que convierte el seguimiento en algo útil para el taller. También es el que hace **medible el volumen**, que hoy no lo es y es el único riesgo abierto de la decisión de proveedor.

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/notificaciones-historial-entrega.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createChainMock, mockSupabaseFrom, mockAuthSuccess, createGetRequest, parseResponse } from "./helpers"

describe("GET /api/notificaciones", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockAuthSuccess({ organizationId: "org-1" })
  })

  it("devuelve el estado de entrega en el historial", async () => {
    const logs = createChainMock([
      {
        id: "log-1",
        tipo: "CAMBIO_ESTADO",
        canal: "EMAIL",
        estado: "ENVIADO",
        estado_entrega: "REBOTADO",
        bounce_tipo: "HARD",
        bounced_at: "2026-08-31T12:00:00.000Z",
        delivered_at: null,
      },
    ])
    mockSupabaseFrom({ notification_logs: logs })

    const { GET } = await import("@/app/api/notificaciones/route")
    const { status, body } = await parseResponse(
      await GET(createGetRequest("http://localhost:3000/api/notificaciones"))
    )

    expect(status).toBe(200)
    expect(body[0].estado_entrega).toBe("REBOTADO")
    expect(body[0].bounce_tipo).toBe("HARD")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/notificaciones-historial-entrega.test.ts`
Expected: FAIL — el select no trae las columnas nuevas.

> **Ojo con el falso verde.** `createChainMock` devuelve lo que le pases sin mirar el `select`. Si el test sólo afirma sobre el objeto que el mock ya contiene, pasa aunque el `select` esté mal. Por eso el paso siguiente afirma **sobre el string del select**, no sólo sobre la respuesta. Es el mismo error que ya nos dio un falso verde en la cascada de configuración.

- [ ] **Step 3: Agregar la aserción sobre el select**

Añadir al test:

```ts
    const selectArg = vi.mocked(logs.select).mock.calls[0][0] as string
    expect(selectArg).toContain("estado_entrega")
    expect(selectArg).toContain("bounce_tipo")
```

- [ ] **Step 4: Ampliar el select en `getNotificationHistory`**

En `lib/notifications/index.ts`, reemplazar el `select("*", ...)` de `getNotificationHistory` por una lista explícita:

```ts
    let query = supabaseAdmin
      .from("notification_logs")
      .select(`
        id, tipo, canal, estado, destinatario, asunto, error_message, created_at,
        estado_entrega, delivered_at, bounced_at, bounce_tipo, proveedor,
        ordenes_servicio (numero_orden),
        clientes (nombre)
      `)
      .eq("organization_id", this.organizationId)
      .order("created_at", { ascending: false })
      .limit(limit)
```

`contenido` sale del select a propósito: es el HTML completo del correo y no se usa en el listado.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run __tests__/api/notificaciones-historial-entrega.test.ts`
Expected: PASS.

- [ ] **Step 6: Mostrar el estado en la UI**

En `components/ordenes/notification-history.tsx`:

**a)** Extender `interface NotificationLog` (línea 24), que hoy tiene `estado: string` en la 28:

```ts
  estado_entrega?: string | null
  bounce_tipo?: string | null
```

**b)** Extender `interface TimelineEntry` (línea 45), que hoy tiene `estadoEnvio?: string` en la 57:

```ts
  estadoEntrega?: string | null
```

**c)** En el mapeo de notificaciones a entradas del timeline (línea ~119, donde hoy se asigna `estadoEnvio: n.estado`), agregar:

```ts
            estadoEntrega: n.estado_entrega,
```

**d)** En el subcomponente `EventoEntry` (línea 205), junto a donde se renderizan los `Badge` de estado:

```tsx
{entry.estadoEntrega === "ENTREGADO" && (
  <Badge variant="outline" className="text-xs font-normal text-green-700 border-green-300">Entregado</Badge>
)}
{entry.estadoEntrega === "REBOTADO" && (
  <Badge variant="destructive" className="text-xs font-normal">Rebotó</Badge>
)}
{entry.estadoEntrega === "QUEJA" && (
  <Badge variant="destructive" className="text-xs font-normal">Marcado como spam</Badge>
)}
{entry.estadoEnvio === "ENVIADO" && !entry.estadoEntrega && (
  <Badge variant="outline" className="text-xs font-normal text-muted-foreground">Sin confirmar</Badge>
)}
```

`Sin confirmar` es deliberado: distingue "el proveedor lo aceptó pero todavía no sabemos si llegó" de "llegó". Sin ese estado, `ENVIADO` seguiría leyéndose como si fuera entrega confirmada, que es precisamente el malentendido que este cambio corrige.

- [ ] **Step 7: Verificar**

Run: `npx vitest run __tests__/api/ lib/notifications/ lib/email/`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add lib/notifications/index.ts app/api/notificaciones/ __tests__/api/notificaciones-historial-entrega.test.ts components/
git commit -m "feat(email): mostrar el estado de entrega en el historial de notificaciones

El historial distingue entregado, rebotado y marcado como spam, y agrega
'sin confirmar' para el correo aceptado por el proveedor del que todavia no
hay novedades. Sin ese estado, ENVIADO se seguia leyendo como entrega
confirmada, que es el malentendido que la 321 corrige."
```

**Fin del PR 4.**

---

## Pasos de operación

Se ejecutan entre el PR 2 (desplegado apagado) y la activación. No los cubre ningún test.

- [ ] **1.** Verificar el dominio `avisos.stapp.com.ar` en el panel de Resend.
- [ ] **2.** Cargar en el DNS los registros que dé Resend: SPF (TXT), DKIM (CNAMEs) y DMARC arrancando en `p=none`.
- [ ] **3.** Esperar la verificación en el panel. **Sin este paso no hay aislamiento de reputación**, con independencia de que el código funcione.
- [ ] **4.** Aplicar la migración: `node scripts/db-run.mjs supabase/migrations/321_email_delivery_tracking.sql --apply`, y después correr `node scripts/db-run.mjs supabase/migrations/verify/321_probes.sql`.
- [ ] **5.** Crear el endpoint de webhook en Resend apuntando a `https://<dominio>/api/webhooks/resend`, suscribir **sólo** `email.delivered`, `email.bounced` y `email.complained`, y guardar el secret como `RESEND_WEBHOOK_SECRET` en Vercel.
- [ ] **6.** Cargar `RESEND_API_KEY` y `RESEND_FROM` en Vercel. **Este es el acto de activación.**
- [ ] **7.** Correr la terna de simulación desde producción y verificar en `notification_logs` y `email_suprimidos`:

| Destino | Resultado esperado |
|---|---|
| `delivered+prueba1@resend.dev` | `estado_entrega='ENTREGADO'`, `delivered_at` cargado |
| `bounced+prueba1@resend.dev` | `estado_entrega='REBOTADO'`, `bounce_tipo='HARD'`, fila en `email_suprimidos` con motivo `HARD_BOUNCE` |
| `complained+prueba1@resend.dev` | `estado_entrega='QUEJA'`, `bounce_tipo='QUEJA'`, fila en `email_suprimidos` con motivo `QUEJA` |

- [ ] **8.** Enviar un aviso real a una casilla propia: revisar remitente, render y que no caiga en spam.
- [ ] **9.** Una vez que el flujo esté limpio, endurecer la política DMARC.

**Rollback:** borrar `RESEND_API_KEY` de Vercel. `sendCustomer` vuelve a EnvialoSimple sin necesidad de desplegar.
