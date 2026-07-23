# Electronic Invoicing (ARCA/AFIP) — Slice 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an Argentine org on the Profesional plan issue AFIP/ARCA electronic invoices (Factura B/C) from a closed POS sale, via TusFacturasAPP using the org's own credentials (BYO), opt-in and off by default.

**Architecture:** A `FacturacionProvider` interface (`lib/facturacion/`) with a single `TusFacturasProvider` implementation isolates the vendor. Org credentials live encrypted in a dedicated table, never returned to the client. Emission is a manual server action off a completed `ventas` row, persisted in `comprobantes_fiscales`. Two-layer gating: commercial (`plans.feature_flags.facturacion_electronica` + `organizations.pais='AR'`) and an opt-in org toggle.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (`supabaseAdmin`), Vitest, Node `crypto` (AES-256-GCM). Provider transport: `fetch` to `https://www.tusfacturas.app/app/api/v2/facturacion/nuevo`.

## Global Constraints

- Naming: feature endpoints live under `app/api/facturacion-electronica/*`. NEVER use `app/api/facturacion/*` (that is the SaaS-billing/internal non-fiscal invoice, e.g. `app/api/facturacion/generar`). Tests: `__tests__/api/facturacion-electronica-*.test.ts`.
- Fiscal table is `comprobantes_fiscales` (NOT `facturas` — that non-fiscal table already exists).
- Next migration number: `276`. Banner-comment convention (78 `=`), prose in Spanish.
- Test runner: Vitest (`npx vitest run <file>`). API tests use helpers in `__tests__/api/helpers.ts`: `mockAuthSuccess`, `mockAuthError`, `createChainMock`, `mockSupabaseFrom`, `createGetRequest`, `createPostRequest`, `parseResponse`. `auth()` is globally mocked in `vitest.setup.ts`.
- Secrets (`apitoken`, `apikey`, `usertoken`) are encrypted at rest and MUST NOT appear in any GET/response body sent to the client. `app/api/configuracion` returns all org columns to the client — credentials must NOT be added there.
- Fail-closed everywhere: missing gate / toggle off / no credentials → no emission.
- Code artifacts (identifiers, comments, UI copy) in English except user-facing Spanish UI strings, which follow the existing neutral/professional Spanish of the panel.
- Commit after every task. Conventional commits, no AI attribution.

---

## Task 0: Spike — validate DEV-account emission (BLOCKING, ~30 min, may be throwaway)

**Purpose:** Confirm the exact TusFacturasAPP request/response for Factura B and C against Luis's free DEV account (no CAE/QR, no real fiscal document), and capture the verbatim payload the provider will build. No app code ships from this task; its output (a captured request+response) is the source of truth for Task 4 and Task 9.

**Files:**
- Create (scratch, git-ignored): `scratch/tusfacturas-spike.md` — paste the working request JSON + success response JSON for one Factura B and one Factura C.

- [ ] **Step 1:** Log in to the DEV account at tusfacturas.app and copy the three API credentials (`apitoken`, `apikey`, `usertoken`) and the punto de venta.
- [ ] **Step 2:** From a shell, emit a **Factura C** (monotributo emisor, consumidor final receptor):

```bash
curl -s -X POST https://www.tusfacturas.app/app/api/v2/facturacion/nuevo \
  -H "Content-Type: application/json" \
  -d '{
    "apitoken":"<APITOKEN>","apikey":"<APIKEY>","usertoken":"<USERTOKEN>",
    "cliente":{"documento_tipo":"CONSUMIDOR FINAL","documento_nro":"0","razon_social":"Consumidor Final","email":"","domicilio":"","condicion_iva":"CF","condicion_pago":"0"},
    "comprobante":{"rubro":"Servicios","tipo":"FACTURA C","operacion":"V","external_reference":"spike-c-1","punto_venta":"<PV>","fecha":"'"$(date +%d/%m/%Y)"'","vencimiento":"'"$(date +%d/%m/%Y)"'","moneda":"PES","cotizacion":"1","detalle":[{"cantidad":"1","afip_scheme":"07","alicuota":"0","importe":"1000","producto":{"descripcion":"Servicio de prueba","unidad_bulto":"1","precio_unitario_sin_iva":"1000"}}],"leyenda_gral":""}
  }' | tee -a scratch/tusfacturas-spike.md
```

Expected: JSON with `"error":"N"`, an `errores` array, `comprobante_nro`, `comprobante_pdf_url`. (DEV account: `cae` may be blank/test.)

- [ ] **Step 3:** Repeat with `"tipo":"FACTURA B"` and a receptor `condicion_iva` for a consumidor final, `alicuota":"21"` (RI emisor). Append the response.
- [ ] **Step 4:** In `scratch/tusfacturas-spike.md`, record the EXACT strings that worked for: `comprobante.tipo` (B vs C), `cliente.condicion_iva`, `cliente.documento_tipo`, `detalle[].afip_scheme` per IVA rate, and the success-response field names actually returned. **Task 4 and Task 9 use these captured values.**
- [ ] **Step 5:** Ensure `scratch/` is git-ignored (`echo "scratch/" >> .gitignore` if not already). Do NOT commit credentials.

**Outcome gate:** If no test/DEV emission is possible without a real CAE, STOP and switch Slice-1 provider to Afip SDK (out of this plan). Otherwise proceed.

---

## PR1 — Foundations (invisible; every path fails closed)

### Task 1: Migration 276 — schema

**Files:**
- Create: `supabase/migrations/276_facturacion_electronica.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- 276: facturación electrónica ARCA (Slice 1) — schema base
-- ============================================================================
-- Toggle opt-in por org (preferencia, NO gating comercial → no va en
-- plans.feature_flags). Credenciales BYO cifradas (nunca al frontend).
-- comprobantes_fiscales guarda el resultado de cada emisión.
-- ============================================================================

-- 1) Preferencia opt-in por organización (default apagado)
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS facturacion_electronica_habilitada BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN organizations.facturacion_electronica_habilitada IS
  'Si true, la org habilitó la emisión de facturas electrónicas (opt-in). Requiere plan Profesional + pais=AR + credenciales conectadas.';

-- 2) Credenciales del proveedor (BYO), cifradas at-rest
CREATE TABLE IF NOT EXISTS facturacion_credenciales (
  organization_id       TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  apitoken_enc          TEXT NOT NULL,
  apikey_enc            TEXT NOT NULL,
  usertoken_enc         TEXT NOT NULL,
  punto_venta           INTEGER NOT NULL DEFAULT 1,
  condicion_fiscal      TEXT NOT NULL DEFAULT 'MONOTRIBUTO', -- MONOTRIBUTO | RESPONSABLE_INSCRIPTO
  estado                TEXT NOT NULL DEFAULT 'conectado',   -- conectado | error
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3) Comprobantes fiscales emitidos
CREATE TABLE IF NOT EXISTS comprobantes_fiscales (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  venta_id              TEXT NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  tipo                  TEXT NOT NULL,               -- 'B' | 'C'
  punto_venta           INTEGER NOT NULL,
  numero                TEXT,
  cae                   TEXT,
  cae_vencimiento       TEXT,
  estado                TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | emitido | rechazado
  pdf_url               TEXT,
  receptor_doc_tipo     TEXT,
  receptor_doc_nro      TEXT,
  receptor_condicion_iva TEXT,
  total                 NUMERIC(14,2) NOT NULL DEFAULT 0,
  provider              TEXT NOT NULL DEFAULT 'tusfacturas',
  provider_response     JSONB,
  error_msg             TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una venta no puede tener dos comprobantes EMITIDOS
CREATE UNIQUE INDEX IF NOT EXISTS uq_comprobante_venta_emitido
  ON comprobantes_fiscales(venta_id) WHERE estado = 'emitido';

CREATE INDEX IF NOT EXISTS idx_comprobantes_org ON comprobantes_fiscales(organization_id);

-- 4) Feature flag comercial en el plan Profesional
UPDATE plans
SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"facturacion_electronica": true}'::jsonb
WHERE slug = 'profesional';
```

- [ ] **Step 2: Sanity-check** the SQL parses (no runner in CI; visually confirm idempotency `IF NOT EXISTS`). Do NOT apply to prod here — applied manually after PR1 merges.
- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/276_facturacion_electronica.sql
git commit -m "feat(facturacion-electronica): migración 276 (toggle, credenciales, comprobantes_fiscales)"
```

### Task 2: Encryption helper for credentials

**Files:**
- Create: `lib/facturacion/crypto.ts`
- Test: `__tests__/lib/facturacion-crypto.test.ts`

**Interfaces:**
- Produces: `encryptSecret(text: string): string`, `decryptSecret(payload: string): string` (format `ivHex:tagHex:dataHex`, AES-256-GCM, key = sha256 of `process.env.FACTURACION_ENCRYPTION_KEY`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll } from "vitest"
import { encryptSecret, decryptSecret } from "@/lib/facturacion/crypto"

beforeAll(() => { process.env.FACTURACION_ENCRYPTION_KEY = "test-key-at-least-32-chars-long-xxxxx" })

describe("facturacion crypto", () => {
  it("round-trips a secret", () => {
    const enc = encryptSecret("my-api-token")
    expect(enc).not.toContain("my-api-token")
    expect(decryptSecret(enc)).toBe("my-api-token")
  })
  it("produces a different ciphertext each call (random IV)", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"))
  })
})
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run __tests__/lib/facturacion-crypto.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** (mirrors `lib/whatsapp/encryption.ts`)

```ts
import crypto from "crypto"

const ALGORITHM = "aes-256-gcm"

function getKey(): Buffer {
  const raw = process.env.FACTURACION_ENCRYPTION_KEY || ""
  return crypto.createHash("sha256").update(raw).digest()
}

export function encryptSecret(text: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv)
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()])
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc.toString("hex")}`
}

export function decryptSecret(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":")
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, "hex"))
  decipher.setAuthTag(Buffer.from(tagHex, "hex"))
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8")
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run __tests__/lib/facturacion-crypto.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add lib/facturacion/crypto.ts __tests__/lib/facturacion-crypto.test.ts && git commit -m "feat(facturacion-electronica): helper de cifrado AES-256-GCM para credenciales"`

### Task 3: Provider types + interface + tipo derivation

**Files:**
- Create: `lib/facturacion/types.ts`
- Create: `lib/facturacion/derive.ts`
- Test: `__tests__/lib/facturacion-derive.test.ts`

**Interfaces:**
- Produces (`types.ts`):

```ts
export type CondicionFiscalEmisor = "MONOTRIBUTO" | "RESPONSABLE_INSCRIPTO"
export type TipoComprobante = "B" | "C"

export interface FacturacionCredenciales {
  apitoken: string; apikey: string; usertoken: string
  puntoVenta: number; condicionFiscal: CondicionFiscalEmisor
}
export interface EmitirInput {
  ventaId: string
  receptor: { razonSocial: string; documentoTipo: string; documentoNro: string; condicionIva: string; email?: string; domicilio?: string }
  moneda: string
  items: Array<{ cantidad: number; descripcion: string; importeUnitario: number; alicuotaIva: number }>
  total: number
}
export interface ComprobanteResult {
  ok: boolean; tipo: TipoComprobante
  numero?: string; cae?: string; caeVencimiento?: string
  pdfUrl?: string; afipQr?: string; errores?: string[]; raw: unknown
}
export interface FacturacionProvider {
  emitir(creds: FacturacionCredenciales, input: EmitirInput): Promise<ComprobanteResult>
}
```

- Produces (`derive.ts`): `deriveTipo(condicion: CondicionFiscalEmisor): TipoComprobante`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import { deriveTipo } from "@/lib/facturacion/derive"

describe("deriveTipo", () => {
  it("monotributo emits Factura C", () => { expect(deriveTipo("MONOTRIBUTO")).toBe("C") })
  it("responsable inscripto emits Factura B", () => { expect(deriveTipo("RESPONSABLE_INSCRIPTO")).toBe("B") })
})
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run __tests__/lib/facturacion-derive.test.ts` → FAIL.
- [ ] **Step 3: Implement** — `types.ts` as above, then:

```ts
// lib/facturacion/derive.ts
import type { CondicionFiscalEmisor, TipoComprobante } from "./types"
// Slice 1: B/C only. Monotributo → C; Responsable Inscripto → B (Factura A out of scope).
export function deriveTipo(condicion: CondicionFiscalEmisor): TipoComprobante {
  return condicion === "MONOTRIBUTO" ? "C" : "B"
}
```

- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git add lib/facturacion/types.ts lib/facturacion/derive.ts __tests__/lib/facturacion-derive.test.ts && git commit -m "feat(facturacion-electronica): tipos del provider + derivación B/C"`

### Task 4: TusFacturasProvider (payload builder + HTTP)

**Files:**
- Create: `lib/facturacion/tusfacturas-provider.ts`
- Test: `__tests__/lib/facturacion-tusfacturas.test.ts`

**Interfaces:**
- Consumes: `FacturacionProvider`, `FacturacionCredenciales`, `EmitirInput`, `ComprobanteResult`, `deriveTipo`.
- Produces: `buildPayload(creds, input, tipo)` (exported for testing) and `tusFacturasProvider: FacturacionProvider`.

> **Reconcile with Task 0 spike output** before finalizing field strings (`comprobante.tipo`, `afip_scheme`, `condicion_iva`). The structure below matches the documented API; update literal values to the ones captured in `scratch/tusfacturas-spike.md`.

- [ ] **Step 1: Write the failing test** (mocks `fetch`)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { buildPayload, tusFacturasProvider } from "@/lib/facturacion/tusfacturas-provider"
import type { FacturacionCredenciales, EmitirInput } from "@/lib/facturacion/types"

const creds: FacturacionCredenciales = { apitoken: "a", apikey: "k", usertoken: "u", puntoVenta: 3, condicionFiscal: "MONOTRIBUTO" }
const input: EmitirInput = {
  ventaId: "v1", moneda: "PES", total: 1210,
  receptor: { razonSocial: "Consumidor Final", documentoTipo: "CONSUMIDOR FINAL", documentoNro: "0", condicionIva: "CF" },
  items: [{ cantidad: 1, descripcion: "Servicio", importeUnitario: 1210, alicuotaIva: 21 }],
}

describe("buildPayload", () => {
  it("includes auth, external_reference and Factura C for monotributo", () => {
    const p = buildPayload(creds, input, "C")
    expect(p.apitoken).toBe("a"); expect(p.apikey).toBe("k"); expect(p.usertoken).toBe("u")
    expect(p.comprobante.tipo).toBe("FACTURA C")
    expect(p.comprobante.external_reference).toBe("v1")
    expect(p.comprobante.punto_venta).toBe("3")
    expect(p.comprobante.detalle).toHaveLength(1)
  })
})

describe("tusFacturasProvider.emitir", () => {
  beforeEach(() => { vi.restoreAllMocks() })
  it("maps a success response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({
      error: "N", errores: [], cae: "123", vencimiento_cae: "2026-08-01",
      comprobante_nro: "0003-00000001", comprobante_pdf_url: "http://pdf", afip_qr: "qr",
    }) }))
    const r = await tusFacturasProvider.emitir(creds, input)
    expect(r.ok).toBe(true); expect(r.tipo).toBe("C"); expect(r.cae).toBe("123")
    expect(r.numero).toBe("0003-00000001"); expect(r.pdfUrl).toBe("http://pdf")
  })
  it("maps a rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ error: "S", errores: ["CUIT inválido"] }) }))
    const r = await tusFacturasProvider.emitir(creds, input)
    expect(r.ok).toBe(false); expect(r.errores).toContain("CUIT inválido")
  })
})
```

- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement**

```ts
import type { FacturacionProvider, FacturacionCredenciales, EmitirInput, ComprobanteResult, TipoComprobante } from "./types"
import { deriveTipo } from "./derive"

const ENDPOINT = "https://www.tusfacturas.app/app/api/v2/facturacion/nuevo"
// AFIP IVA scheme codes by rate (confirm against spike output).
const AFIP_SCHEME: Record<number, string> = { 0: "03", 10.5: "04", 21: "05", 27: "06" }

function ddmmyyyy(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}

export function buildPayload(creds: FacturacionCredenciales, input: EmitirInput, tipo: TipoComprobante) {
  const hoy = ddmmyyyy(new Date())
  return {
    apitoken: creds.apitoken, apikey: creds.apikey, usertoken: creds.usertoken,
    cliente: {
      documento_tipo: input.receptor.documentoTipo, documento_nro: input.receptor.documentoNro,
      razon_social: input.receptor.razonSocial, email: input.receptor.email ?? "",
      domicilio: input.receptor.domicilio ?? "", condicion_iva: input.receptor.condicionIva, condicion_pago: "0",
    },
    comprobante: {
      rubro: "Servicios", tipo: tipo === "C" ? "FACTURA C" : "FACTURA B", operacion: "V",
      external_reference: input.ventaId, punto_venta: String(creds.puntoVenta),
      fecha: hoy, vencimiento: hoy, moneda: input.moneda, cotizacion: "1",
      detalle: input.items.map((it) => ({
        cantidad: String(it.cantidad),
        afip_scheme: AFIP_SCHEME[it.alicuotaIva] ?? "05",
        alicuota: String(it.alicuotaIva),
        importe: String(it.importeUnitario * it.cantidad),
        producto: { descripcion: it.descripcion, unidad_bulto: "1", precio_unitario_sin_iva: String(it.importeUnitario) },
      })),
      leyenda_gral: "",
    },
  }
}

export const tusFacturasProvider: FacturacionProvider = {
  async emitir(creds, input): Promise<ComprobanteResult> {
    const tipo = deriveTipo(creds.condicionFiscal)
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(creds, input, tipo)),
      })
      const data: any = await res.json()
      if (data?.error === "N") {
        return {
          ok: true, tipo, numero: data.comprobante_nro, cae: data.cae,
          caeVencimiento: data.vencimiento_cae, pdfUrl: data.comprobante_pdf_url,
          afipQr: data.afip_qr, raw: data,
        }
      }
      return { ok: false, tipo, errores: data?.errores ?? ["Error desconocido del proveedor"], raw: data }
    } catch (e: any) {
      return { ok: false, tipo, errores: [e?.message ?? "Fallo de red"], raw: null }
    }
  },
}
```

- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git add lib/facturacion/tusfacturas-provider.ts __tests__/lib/facturacion-tusfacturas.test.ts && git commit -m "feat(facturacion-electronica): TusFacturasProvider (payload + emisión)"`

### Task 5: Access gate helper

**Files:**
- Create: `lib/facturacion/access.ts`
- Test: `__tests__/lib/facturacion-access.test.ts`

**Interfaces:**
- Consumes: `hasPlanFeature` from `@/lib/subscriptions`, `supabaseAdmin`.
- Produces: `canEmitirFacturaElectronica(organizationId: string): Promise<boolean>` — true only when plan has `facturacion_electronica`, `organizations.pais === 'AR'`, `facturacion_electronica_habilitada === true`, AND a `facturacion_credenciales` row exists.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: vi.fn() } }))

import { hasPlanFeature } from "@/lib/subscriptions"
import { supabaseAdmin } from "@/lib/supabase"
import { canEmitirFacturaElectronica } from "@/lib/facturacion/access"

function orgRow(row: any) {
  return { select: () => ({ eq: () => ({ single: async () => ({ data: row }) }) }) }
}
function credRow(row: any) {
  return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) }
}

describe("canEmitirFacturaElectronica", () => {
  beforeEach(() => vi.clearAllMocks())
  it("false when plan lacks the feature", async () => {
    ;(hasPlanFeature as any).mockResolvedValue(false)
    expect(await canEmitirFacturaElectronica("o1")).toBe(false)
  })
  it("true when all conditions hold", async () => {
    ;(hasPlanFeature as any).mockResolvedValue(true)
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(orgRow({ pais: "AR", facturacion_electronica_habilitada: true }))
      .mockReturnValueOnce(credRow({ organization_id: "o1" }))
    expect(await canEmitirFacturaElectronica("o1")).toBe(true)
  })
  it("false when pais != AR", async () => {
    ;(hasPlanFeature as any).mockResolvedValue(true)
    ;(supabaseAdmin.from as any).mockReturnValueOnce(orgRow({ pais: "MX", facturacion_electronica_habilitada: true }))
    expect(await canEmitirFacturaElectronica("o1")).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement**

```ts
import { hasPlanFeature } from "@/lib/subscriptions"
import { supabaseAdmin } from "@/lib/supabase"

export async function canEmitirFacturaElectronica(organizationId: string): Promise<boolean> {
  try {
    if (!(await hasPlanFeature(organizationId, "facturacion_electronica"))) return false
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("pais, facturacion_electronica_habilitada")
      .eq("id", organizationId)
      .single()
    if (!org || org.pais !== "AR" || org.facturacion_electronica_habilitada !== true) return false
    const { data: cred } = await supabaseAdmin
      .from("facturacion_credenciales")
      .select("organization_id")
      .eq("organization_id", organizationId)
      .maybeSingle()
    return !!cred
  } catch {
    return false // fail closed
  }
}
```

- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git add lib/facturacion/access.ts __tests__/lib/facturacion-access.test.ts && git commit -m "feat(facturacion-electronica): gate canEmitirFacturaElectronica (fail-closed)"`

**PR1 boundary:** open PR "feat(facturacion-electronica): foundations (migración 276, provider, cifrado, gate)". No UI, flag off → zero behavior change. After merge: apply migration 276 manually to prod, set `FACTURACION_ENCRYPTION_KEY` in env.

---

## PR2 — Settings & connection

### Task 6: Configuración GET/PUT — availability flag + toggle

**Files:**
- Modify: `app/api/configuracion/route.ts` (GET select + response; PUT handler + PGRST204 strip list)
- Test: `__tests__/api/facturacion-electronica-configuracion.test.ts`

**Interfaces:**
- Produces: GET response gains `facturacionElectronicaDisponible: boolean` (commercial gate: plan feature + pais=AR) and `facturacionElectronicaHabilitada: boolean` (the toggle). PUT accepts `facturacionElectronicaHabilitada`.

- [ ] **Step 1: Write the failing test** — assert GET returns `facturacionElectronicaHabilitada` from the column, and PUT with `{ facturacionElectronicaHabilitada: true }` writes `facturacion_electronica_habilitada`. (Mirror `__tests__/api/configuracion-terminologia.test.ts` structure: `mockAuthSuccess({ role: "ADMIN" })`, `mockSupabaseFrom({ organizations: createChainMock(row) })`.)
- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement**
  - Add `facturacion_electronica_habilitada` to both `select(...)` column lists (full + the `selectColsFull`/`selectCols` strings).
  - In GET response mapping and both PUT response mappings, add: `facturacionElectronicaHabilitada: !!organization.facturacion_electronica_habilitada`.
  - Compute availability in GET: `const facturacionElectronicaDisponible = organization.pais === "AR" && (await hasPlanFeature(organizationId!, "facturacion_electronica"))` and include it in the response. Import `hasPlanFeature` from `@/lib/subscriptions`.
  - In PUT: destructure `facturacionElectronicaHabilitada`; `if (facturacionElectronicaHabilitada !== undefined) updateData.facturacion_electronica_habilitada = !!facturacionElectronicaHabilitada`.
  - Add `facturacion_electronica_habilitada` to the PGRST204 strip block (mirror how `vendedores_administran_inventario` is deleted) so pre-migration deploys don't 500.
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(facturacion-electronica): toggle y disponibilidad en /api/configuracion"`

### Task 7: Credentials endpoint (write-only secrets, status GET)

**Files:**
- Create: `app/api/facturacion-electronica/credenciales/route.ts`
- Test: `__tests__/api/facturacion-electronica-credenciales.test.ts`

**Interfaces:**
- Consumes: `requireAdmin` (`@/lib/auth-utils`), `supabaseAdmin`, `encryptSecret` (`@/lib/facturacion/crypto`).
- Produces:
  - `GET` → `{ conectado: boolean, puntoVenta: number|null, condicionFiscal: string|null, updatedAt: string|null }` — NEVER the secrets.
  - `PUT` body `{ apitoken, apikey, usertoken, puntoVenta, condicionFiscal }` → upserts encrypted row; returns status only. ADMIN only.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockAuthError, createChainMock, mockSupabaseFrom, createGetRequest, createPostRequest, parseResponse } from "./helpers"
vi.mock("@/lib/facturacion/crypto", () => ({ encryptSecret: (s: string) => `enc(${s})`, decryptSecret: (s: string) => s }))
import { GET, PUT } from "@/app/api/facturacion-electronica/credenciales/route"

describe("facturacion-electronica/credenciales", () => {
  beforeEach(() => vi.clearAllMocks())
  it("GET 401 unauthenticated", async () => {
    mockAuthError(); const { status } = await parseResponse(await GET()); expect(status).toBe(401)
  })
  it("GET returns status only, never secrets", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "o1" })
    mockSupabaseFrom({ facturacion_credenciales: createChainMock({ organization_id: "o1", punto_venta: 3, condicion_fiscal: "MONOTRIBUTO", updated_at: "2026-07-23", apitoken_enc: "enc(x)" }) })
    const { status, body } = await parseResponse(await GET())
    expect(status).toBe(200); expect(body.conectado).toBe(true); expect(body.puntoVenta).toBe(3)
    expect(JSON.stringify(body)).not.toContain("enc(")
  })
  it("PUT 403 for non-ADMIN", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    const { status } = await parseResponse(await PUT(createPostRequest({ apitoken: "a", apikey: "k", usertoken: "u", puntoVenta: 1, condicionFiscal: "MONOTRIBUTO" })))
    expect(status).toBe(403)
  })
})
```

- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement**

```ts
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { encryptSecret } from "@/lib/facturacion/crypto"

export async function GET() {
  const { error, organizationId } = await requireAdmin()
  if (error) return error
  const { data } = await supabaseAdmin
    .from("facturacion_credenciales")
    .select("organization_id, punto_venta, condicion_fiscal, updated_at")
    .eq("organization_id", organizationId!)
    .maybeSingle()
  return NextResponse.json({
    conectado: !!data,
    puntoVenta: data?.punto_venta ?? null,
    condicionFiscal: data?.condicion_fiscal ?? null,
    updatedAt: data?.updated_at ?? null,
  })
}

export async function PUT(request: Request) {
  const { error, organizationId } = await requireAdmin()
  if (error) return error
  const body = await request.json().catch(() => null)
  const { apitoken, apikey, usertoken, puntoVenta, condicionFiscal } = body || {}
  if (!apitoken || !apikey || !usertoken) {
    return NextResponse.json({ error: "Faltan credenciales" }, { status: 400 })
  }
  const cond = condicionFiscal === "RESPONSABLE_INSCRIPTO" ? "RESPONSABLE_INSCRIPTO" : "MONOTRIBUTO"
  const { error: dbError } = await supabaseAdmin.from("facturacion_credenciales").upsert({
    organization_id: organizationId!,
    apitoken_enc: encryptSecret(String(apitoken)),
    apikey_enc: encryptSecret(String(apikey)),
    usertoken_enc: encryptSecret(String(usertoken)),
    punto_venta: Number(puntoVenta) || 1,
    condicion_fiscal: cond,
    estado: "conectado",
    updated_at: new Date().toISOString(),
  })
  if (dbError) return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 })
  return NextResponse.json({ conectado: true, puntoVenta: Number(puntoVenta) || 1, condicionFiscal: cond })
}
```

- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(facturacion-electronica): endpoint de credenciales (write-only)"`

### Task 8: Configuración UI — toggle + connection card

**Files:**
- Modify: `components/configuracion/configuracion-form.tsx`
- Test: none new (UI wiring; covered by manual + the endpoint tests). Optional light render test if a `__tests__/components` pattern exists.

- [ ] **Step 1:** Add state seeded from GET: `facturacionDisponible`, `facturacionHabilitada`, plus connection form fields `feApitoken/feApikey/feUsertoken/fePuntoVenta/feCondicionFiscal`, and `feConectado` from `GET /api/facturacion-electronica/credenciales` (fetch in `fetchConfig`). Seed `setFacturacionDisponible(!!data.facturacionElectronicaDisponible)`, `setFacturacionHabilitada(!!data.facturacionElectronicaHabilitada)`.
- [ ] **Step 2:** Render a new `<Card>` titled "Facturación electrónica (AFIP/ARCA)" **only when `facturacionDisponible`**. Inside: the opt-in checkbox (mirror the `vendedoresAdministranInventario` label/checkbox block at lines ~526-539) bound to `facturacionHabilitada`. When enabled, show the connection sub-block: three password inputs (apitoken/apikey/usertoken — `type="password"`), a punto de venta number input, a condición fiscal select (`MONOTRIBUTO` / `RESPONSABLE_INSCRIPTO`), a "Conectar" button that `PUT`s to `/api/facturacion-electronica/credenciales`, and a status line ("Conectado" / "No conectado") from `feConectado`. Copy in neutral Spanish.
- [ ] **Step 3:** Wire the toggle into the existing `handleSave` PUT body as `facturacionElectronicaHabilitada: facturacionHabilitada`. Keep credentials on their OWN "Conectar" action (never in the configuracion PUT).
- [ ] **Step 4:** Manual check: `npm run dev`, open Configuración as ADMIN of a Profesional AR org → the card appears; as a Free org → hidden.
- [ ] **Step 5: Commit** — `git commit -m "feat(facturacion-electronica): sección de conexión en Configuración"`

**PR2 boundary:** open PR "feat(facturacion-electronica): settings y conexión BYO". Depends on PR1 merged + migration applied + env key set.

---

## PR3 — Emission

### Task 9: Venta → EmitirInput mapper

**Files:**
- Create: `lib/facturacion/map-venta.ts`
- Test: `__tests__/lib/facturacion-map-venta.test.ts`

**Interfaces:**
- Consumes: a `ventas` row (snake_case) + its `items_venta`.
- Produces: `mapVentaToEmitirInput(venta: any, items: any[]): EmitirInput`. Consumidor-final default when no cliente doc; receptor `condicionIva` = "CF"; `documentoTipo` = "CONSUMIDOR FINAL", `documentoNro` = "0". Uses `venta.iva_tasa` (default 21) for `alicuotaIva`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import { mapVentaToEmitirInput } from "@/lib/facturacion/map-venta"

describe("mapVentaToEmitirInput", () => {
  it("defaults to consumidor final and maps items", () => {
    const venta = { id: "v1", total: 1210, iva_tasa: 21, cliente_nombre: "Juan" }
    const items = [{ cantidad: 1, descripcion: "Servicio", precio_unitario: 1210 }]
    const input = mapVentaToEmitirInput(venta, items)
    expect(input.ventaId).toBe("v1")
    expect(input.receptor.documentoTipo).toBe("CONSUMIDOR FINAL")
    expect(input.items[0].alicuotaIva).toBe(21)
    expect(input.total).toBe(1210)
  })
})
```

- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement** (align item field names to the real `items_venta` columns confirmed in Task 0/exploration — `precio_unitario`, `descripcion`/`producto_nombre`):

```ts
import type { EmitirInput } from "./types"
export function mapVentaToEmitirInput(venta: any, items: any[]): EmitirInput {
  const alic = Number(venta.iva_tasa) || 21
  return {
    ventaId: venta.id,
    moneda: "PES",
    total: Number(venta.total) || 0,
    receptor: {
      razonSocial: venta.cliente_nombre || "Consumidor Final",
      documentoTipo: "CONSUMIDOR FINAL", documentoNro: "0", condicionIva: "CF",
    },
    items: (items || []).map((it) => ({
      cantidad: Number(it.cantidad) || 1,
      descripcion: it.descripcion || it.producto_nombre || "Item",
      importeUnitario: Number(it.precio_unitario) || 0,
      alicuotaIva: alic,
    })),
  }
}
```

- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(facturacion-electronica): mapper venta→EmitirInput"`

### Task 10: Emisión endpoint

**Files:**
- Create: `app/api/facturacion-electronica/emitir/route.ts`
- Test: `__tests__/api/facturacion-electronica-emitir.test.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `canEmitirFacturaElectronica`, `supabaseAdmin`, `decryptSecret`, `tusFacturasProvider`, `mapVentaToEmitirInput`.
- Body: `{ ventaId: string }`. Flow: gate → load venta+items+credenciales → insert `comprobantes_fiscales` `pendiente` → `provider.emitir` → update `emitido`(+CAE/numero/pdf) or `rechazado`(+error). Idempotent: if an `emitido` row exists for the venta, return it (409/200) without re-emitting.

- [ ] **Step 1: Write the failing test** — cases: 401 unauth; 403 when `canEmitirFacturaElectronica` false; 200 + `estado: "emitido"` on provider success (mock `tusFacturasProvider.emitir` → `{ ok: true, cae: "1", numero: "0003-1", tipo: "C", pdfUrl: "http://p", raw: {} }`); 422 + `estado: "rechazado"` on `{ ok: false, errores: [...] }`; 409 when an emitido comprobante already exists. Mock provider via `vi.mock("@/lib/facturacion/tusfacturas-provider", ...)` and gate via `vi.mock("@/lib/facturacion/access", ...)`.
- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement**

```ts
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { canEmitirFacturaElectronica } from "@/lib/facturacion/access"
import { decryptSecret } from "@/lib/facturacion/crypto"
import { tusFacturasProvider } from "@/lib/facturacion/tusfacturas-provider"
import { mapVentaToEmitirInput } from "@/lib/facturacion/map-venta"

export async function POST(request: Request) {
  const { error, organizationId } = await requireAdmin()
  if (error) return error
  if (!(await canEmitirFacturaElectronica(organizationId!))) {
    return NextResponse.json({ error: "Facturación electrónica no disponible" }, { status: 403 })
  }
  const { ventaId } = (await request.json().catch(() => ({}))) as { ventaId?: string }
  if (!ventaId) return NextResponse.json({ error: "Falta ventaId" }, { status: 400 })

  const { data: existing } = await supabaseAdmin
    .from("comprobantes_fiscales").select("*").eq("venta_id", ventaId).eq("estado", "emitido").maybeSingle()
  if (existing) return NextResponse.json({ comprobante: existing, yaEmitido: true }, { status: 409 })

  const { data: venta } = await supabaseAdmin.from("ventas").select("*").eq("id", ventaId).eq("organization_id", organizationId!).single()
  if (!venta) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 })
  const { data: items } = await supabaseAdmin.from("items_venta").select("*").eq("venta_id", ventaId)
  const { data: cred } = await supabaseAdmin.from("facturacion_credenciales").select("*").eq("organization_id", organizationId!).single()

  const creds = {
    apitoken: decryptSecret(cred.apitoken_enc), apikey: decryptSecret(cred.apikey_enc), usertoken: decryptSecret(cred.usertoken_enc),
    puntoVenta: cred.punto_venta, condicionFiscal: cred.condicion_fiscal,
  }
  const input = mapVentaToEmitirInput(venta, items || [])

  const { data: pend } = await supabaseAdmin.from("comprobantes_fiscales").insert({
    organization_id: organizationId!, venta_id: ventaId, tipo: creds.condicionFiscal === "MONOTRIBUTO" ? "C" : "B",
    punto_venta: creds.puntoVenta, estado: "pendiente", total: venta.total,
    receptor_doc_tipo: input.receptor.documentoTipo, receptor_doc_nro: input.receptor.documentoNro,
    receptor_condicion_iva: input.receptor.condicionIva,
  }).select("id").single()

  const result = await tusFacturasProvider.emitir(creds, input)

  if (result.ok) {
    const { data: updated } = await supabaseAdmin.from("comprobantes_fiscales").update({
      estado: "emitido", tipo: result.tipo, numero: result.numero, cae: result.cae,
      cae_vencimiento: result.caeVencimiento, pdf_url: result.pdfUrl, provider_response: result.raw as any, updated_at: new Date().toISOString(),
    }).eq("id", pend!.id).select("*").single()
    return NextResponse.json({ comprobante: updated }, { status: 200 })
  }
  const { data: rej } = await supabaseAdmin.from("comprobantes_fiscales").update({
    estado: "rechazado", error_msg: (result.errores || []).join("; "), provider_response: result.raw as any, updated_at: new Date().toISOString(),
  }).eq("id", pend!.id).select("*").single()
  return NextResponse.json({ comprobante: rej, error: "Rechazado por el proveedor" }, { status: 422 })
}
```

- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(facturacion-electronica): endpoint de emisión"`

### Task 11: "Emitir factura" button in the post-sale modal

**Files:**
- Modify: `components/ventas/venta-creada-modal.tsx`
- Test: none new (manual; endpoint covered by Task 10).

- [ ] **Step 1:** Add optional prop `facturacionDisponible?: boolean` (passed down from wherever the modal is rendered — POS layout that already knows org features; default false). Only render the button when true.
- [ ] **Step 2:** In the action block next to "Ver Comprobante PDF" (~line 150-163), add an "Emitir factura" button with local state `emitiendo`/`comprobante`/`errorFE`. On click: `POST /api/facturacion-electronica/emitir` with `{ ventaId: venta.id }`.
- [ ] **Step 3:** On success show the tipo + número + a "Ver factura PDF" link (`comprobante.pdf_url`); on 409 show "Ya emitida" with the existing link; on 422 show the rejection `error_msg`. Disable the button while `emitiendo` and after success.
- [ ] **Step 4:** Manual check with the DEV credentials connected: complete a POS sale → "Emitir factura" → returns número + PDF link; a second click shows "Ya emitida".
- [ ] **Step 5: Commit** — `git commit -m "feat(facturacion-electronica): botón Emitir factura en POS"`

**PR3 boundary:** open PR "feat(facturacion-electronica): emisión desde POS". Depends on PR1 + PR2.

---

## Self-Review

**Spec coverage** (design §→task):
- Gating two layers → Task 1 (flag/column), Task 5 (gate), Task 6 (availability), Task 8 (conditional UI). ✔
- Provider abstraction → Task 3 (interface) + Task 4 (impl). ✔
- Credentials encrypted/write-only → Task 2, Task 7. ✔
- Data (migration 276, both tables + flag) → Task 1. ✔
- Emission POS/manual/B-C/instantáneo → Task 9, 10, 11. ✔
- Webhook → out of Slice 1 (design §6). No task — intentional. ✔
- Testing (gate, credentials no-leak, provider, emission, tipo) → covered per task. ✔
- Homologación/spike → Task 0. ✔

**Placeholder scan:** the only deferred literals are the exact TusFacturas `tipo`/`afip_scheme`/`condicion_iva` strings, explicitly gated on the Task 0 spike capture (real values, not "TODO"). Item-column names in Task 9 (`precio_unitario`/`descripcion`) to be confirmed against `items_venta` during apply.

**Type consistency:** `FacturacionCredenciales`, `EmitirInput`, `ComprobanteResult`, `deriveTipo`, `canEmitirFacturaElectronica`, `tusFacturasProvider`, `mapVentaToEmitirInput`, `encryptSecret`/`decryptSecret` used with identical signatures across tasks. ✔
