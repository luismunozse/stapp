# Foto QR Handoff — Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the endpoints that mint, feed, read and revoke a photo draft — including the public upload endpoint the phone talks to.

**Architecture:** Four authenticated routes under `/api/ordenes/foto-borrador` handle the PC side; one public route under `/api/public/carga-foto/[token]` handles the phone. The public route is the only unauthenticated surface and runs every check before touching storage. Staged bytes live in a **private** bucket and are handed back to the PC as base64 by an authenticated route, so the object never has a reachable URL.

**Tech Stack:** Next.js 16 route handlers, Supabase (Postgres + Storage), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-23-foto-qr-handoff-design.md`
**Builds on:** Slice 1 (`lib/foto-borrador-token.ts`, `lib/foto-borrador-image.ts`, migration 276).

## Global Constraints

- Migration number is **282** (276 shipped in slice 1). Renumbered from 277: `main` merged `277_trigger_recalcular_estado_cobro.sql` first, and 278-280 are reserved for other open branches while 281 is already applied in production.
- The bucket is created **by migration**, following `160_proveedores_extras.sql`: `INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)` with `ON CONFLICT DO UPDATE`.
- Bucket is `foto-borrador`, `public = false`, limit `2097152` (2 MB), `allowed_mime_types = ARRAY['image/jpeg']`. `reencodeFoto` always emits JPEG, so the storage layer itself rejects anything else.
- **No signed URLs.** The authenticated GET returns base64. This supersedes the spec's "short-lived signed URLs" wording — the PC needs base64 for the existing `fotos` state, so a URL would be extra attack surface for zero benefit.
- `/api/public` is already exempt from auth in `isPublicPath()` (`middleware.ts`). **No middleware change in this slice.**
- Reuse from slice 1, do not redefine: `generateBorradorToken`, `hashBorradorToken`, `canAcceptFoto`, `FOTO_BORRADOR_TTL_MS`, `MAX_FOTOS_POR_BORRADOR`, `MAX_BORRADORES_ACTIVOS`, `sniffImageMime`, `reencodeFoto`, `MAX_FOTO_BYTES`.
- Auth gate for the PC routes is `requireAuth()` + `canCreateOrders(role)` from `lib/auth-utils.ts`.
- Rate limiting uses `rateLimit(identifier, limit, windowMs)` from `lib/rate-limit.ts`.
- API tests use `__tests__/api/helpers.ts`: `mockAuthSuccess`, `mockAuthError`, `createChainMock`, `mockSupabaseFrom`, `createPostRequest`, `createGetRequest`, `parseResponse`.
- Test runner: `npx vitest run <path>`.

## Threat rule for the public endpoint

Every failure on `/api/public/carga-foto/[token]` returns the **same** generic body and status. Unknown token, expired token, revoked token and cap-reached must be indistinguishable from outside, so the endpoint cannot be used to probe which drafts exist.

---

### Task 1: Migration 282 — private bucket

**Files:**
- Create: `supabase/migrations/282_foto_borrador_bucket.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- 282: bucket privado para las fotos en staging del handoff por QR
-- ============================================================================
-- public=false: a diferencia de fotos-ordenes, estos objetos no se sirven por
-- URL. La PC los pide por un endpoint autenticado que devuelve base64, así que
-- el objeto nunca tiene una URL alcanzable.
--
-- Los topes viven también acá y no solo en el handler: reencodeFoto siempre
-- emite JPEG, así que el bucket rechaza por sí mismo cualquier otra cosa aunque
-- un día el código se equivoque.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('foto-borrador', 'foto-borrador', false, 2097152, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/282_foto_borrador_bucket.sql
git commit -m "feat(ordenes): bucket privado para las fotos en staging del QR"
```

---

### Task 2: Mint endpoint

**Files:**
- Create: `app/api/ordenes/foto-borrador/route.ts`
- Test: `__tests__/api/foto-borrador-crear.test.ts`

**Interfaces:**
- Produces: `POST /api/ordenes/foto-borrador` → `201 { draftId, token, expiresAt }`.

- [ ] **Step 1: Write the failing test**

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

import { POST } from "@/app/api/ordenes/foto-borrador/route"

describe("POST /api/ordenes/foto-borrador — emisión del token", () => {
  beforeEach(() => vi.clearAllMocks())

  it("rechaza sin sesión", async () => {
    mockAuthError()
    const res = await POST(createPostRequest({}))
    expect(res.status).toBe(401)
  })

  it("rechaza a un rol que no puede crear órdenes", async () => {
    mockAuthSuccess({ role: "CLIENTE" })
    const res = await POST(createPostRequest({}))
    expect(res.status).toBe(403)
  })

  it("devuelve el token crudo pero persiste solo el hash", async () => {
    mockAuthSuccess()
    const insert = createChainMock({ id: "draft-1" }, null)
    const activos = createChainMock([], null, 0)
    mockSupabaseFrom({ foto_borrador: Object.assign(insert, { ...activos }) })

    const res = await POST(createPostRequest({}))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const persisted = JSON.stringify(insert.insert.mock.calls)
    expect(persisted).not.toContain(body.token)
    expect(persisted).toContain("token_hash")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/foto-borrador-crear.test.ts`
Expected: FAIL — cannot resolve the route module.

- [ ] **Step 3: Write the implementation**

```ts
import { NextResponse } from "next/server"
import { requireAuth, canCreateOrders } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import {
  generateBorradorToken,
  FOTO_BORRADOR_TTL_MS,
  MAX_BORRADORES_ACTIVOS,
} from "@/lib/foto-borrador-token"

export async function POST() {
  const { error, organizationId, userId, role } = await requireAuth()
  if (error) return error

  if (!canCreateOrders(role)) {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
  }

  const ahora = new Date()

  // Tope de borradores activos por usuario: evita que alguien farmee tokens.
  const { count } = await supabaseAdmin
    .from("foto_borrador")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("revoked_at", null)
    .gt("expires_at", ahora.toISOString())

  if ((count ?? 0) >= MAX_BORRADORES_ACTIVOS) {
    return NextResponse.json(
      { error: "Demasiados códigos activos. Cerrá alguno antes de pedir otro." },
      { status: 429 },
    )
  }

  const { raw, hash } = generateBorradorToken()
  const expiresAt = new Date(ahora.getTime() + FOTO_BORRADOR_TTL_MS)

  const { data, error: dbError } = await supabaseAdmin
    .from("foto_borrador")
    .insert({
      organization_id: organizationId,
      user_id: userId,
      token_hash: hash,
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single()

  if (dbError || !data) {
    return NextResponse.json({ error: "No se pudo generar el código" }, { status: 500 })
  }

  // El crudo se devuelve una única vez, para el QR. No queda en ningún lado.
  return NextResponse.json(
    { draftId: data.id, token: raw, expiresAt: expiresAt.toISOString() },
    { status: 201 },
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/api/foto-borrador-crear.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/ordenes/foto-borrador/route.ts __tests__/api/foto-borrador-crear.test.ts
git commit -m "feat(ordenes): endpoint que emite el token del borrador de fotos"
```

---

### Task 3: Read and revoke endpoints

**Files:**
- Create: `app/api/ordenes/foto-borrador/[draftId]/route.ts`
- Test: `__tests__/api/foto-borrador-leer.test.ts`

**Interfaces:**
- Produces: `GET .../[draftId]` → `{ items: [{ id, mime, data }] }` where `data` is base64. `DELETE .../[draftId]` → `{ ok: true }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createGetRequest, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

import { GET } from "@/app/api/ordenes/foto-borrador/[draftId]/route"

describe("GET /api/ordenes/foto-borrador/[draftId] — lectura por la PC", () => {
  beforeEach(() => vi.clearAllMocks())

  it("no devuelve el borrador de otra organización", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    const borrador = createChainMock(null, null)
    mockSupabaseFrom({ foto_borrador: borrador })

    const res = await GET(createGetRequest(), { params: Promise.resolve({ draftId: "d1" }) })
    expect(res.status).toBe(404)
    expect(borrador.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("devuelve base64 y nunca una URL", async () => {
    mockAuthSuccess()
    const borrador = createChainMock({ id: "d1" }, null)
    const items = createChainMock([{ id: "i1", storage_path: "p1", mime: "image/jpeg" }], null)
    mockSupabaseFrom({ foto_borrador: borrador, foto_borrador_item: items })

    vi.mocked(supabaseAdmin.storage.from).mockReturnValue({
      download: vi.fn().mockResolvedValue({
        data: { arrayBuffer: async () => new TextEncoder().encode("bytes").buffer },
        error: null,
      }),
    } as any)

    const { status, body } = await parseResponse(
      await GET(createGetRequest(), { params: Promise.resolve({ draftId: "d1" }) }),
    )

    expect(status).toBe(200)
    expect(body.items[0].data).toBe(Buffer.from("bytes").toString("base64"))
    expect(JSON.stringify(body)).not.toMatch(/https?:\/\//)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/foto-borrador-leer.test.ts`
Expected: FAIL — cannot resolve the route module.

- [ ] **Step 3: Write the implementation**

```ts
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

const BUCKET = "foto-borrador"

type Ctx = { params: Promise<{ draftId: string }> }

async function findBorrador(draftId: string, organizationId: string) {
  const { data } = await supabaseAdmin
    .from("foto_borrador")
    .select("id")
    .eq("id", draftId)
    .eq("organization_id", organizationId)
    .single()
  return data
}

export async function GET(_req: Request, { params }: Ctx) {
  const { error, organizationId } = await requireAuth()
  if (error) return error

  const { draftId } = await params
  const borrador = await findBorrador(draftId, organizationId!)
  if (!borrador) return NextResponse.json({ error: "No encontrado" }, { status: 404 })

  const { data: rows } = await supabaseAdmin
    .from("foto_borrador_item")
    .select("id, storage_path, mime")
    .eq("borrador_id", draftId)
    .order("created_at", { ascending: true })

  // Se devuelve base64, no URL: el objeto vive en un bucket privado y nunca
  // queda alcanzable desde afuera.
  const items = []
  for (const row of rows ?? []) {
    const { data: blob } = await supabaseAdmin.storage.from(BUCKET).download(row.storage_path)
    if (!blob) continue
    const buffer = Buffer.from(await blob.arrayBuffer())
    items.push({ id: row.id, mime: row.mime, data: buffer.toString("base64") })
  }

  return NextResponse.json({ items })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { error, organizationId } = await requireAuth()
  if (error) return error

  const { draftId } = await params
  const borrador = await findBorrador(draftId, organizationId!)
  if (!borrador) return NextResponse.json({ error: "No encontrado" }, { status: 404 })

  const { data: rows } = await supabaseAdmin
    .from("foto_borrador_item")
    .select("storage_path")
    .eq("borrador_id", draftId)

  const paths = (rows ?? []).map((r) => r.storage_path)
  if (paths.length > 0) {
    await supabaseAdmin.storage.from(BUCKET).remove(paths)
  }

  // El cascade de la FK se lleva los items.
  await supabaseAdmin.from("foto_borrador").delete().eq("id", draftId)

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/api/foto-borrador-leer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/api/ordenes/foto-borrador/[draftId]/route.ts" __tests__/api/foto-borrador-leer.test.ts
git commit -m "feat(ordenes): lectura en base64 y borrado del borrador de fotos"
```

---

### Task 4: Regenerate endpoint

**Files:**
- Create: `app/api/ordenes/foto-borrador/[draftId]/regenerar/route.ts`
- Test: `__tests__/api/foto-borrador-regenerar.test.ts`

**Interfaces:**
- Produces: `POST .../[draftId]/regenerar` → `{ token, expiresAt }`. Keeps the draft and its photos; only the token changes.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createPostRequest, parseResponse } from "./helpers"

import { POST } from "@/app/api/ordenes/foto-borrador/[draftId]/regenerar/route"

describe("POST .../regenerar — el token rota, las fotos quedan", () => {
  beforeEach(() => vi.clearAllMocks())

  it("emite un token nuevo y corre el vencimiento", async () => {
    mockAuthSuccess()
    const chain = createChainMock({ id: "d1" }, null)
    mockSupabaseFrom({ foto_borrador: chain })

    const { status, body } = await parseResponse(
      await POST(createPostRequest({}), { params: Promise.resolve({ draftId: "d1" }) }),
    )

    expect(status).toBe(200)
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now())

    // Se actualiza el hash, no se borra el borrador ni sus fotos.
    const updated = JSON.stringify(chain.update.mock.calls)
    expect(updated).toContain("token_hash")
    expect(chain.delete).not.toHaveBeenCalled()
  })

  it("no regenera el borrador de otra organización", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    const chain = createChainMock(null, null)
    mockSupabaseFrom({ foto_borrador: chain })

    const res = await POST(createPostRequest({}), { params: Promise.resolve({ draftId: "d1" }) })
    expect(res.status).toBe(404)
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/foto-borrador-regenerar.test.ts`
Expected: FAIL — cannot resolve the route module.

- [ ] **Step 3: Write the implementation**

```ts
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { generateBorradorToken, FOTO_BORRADOR_TTL_MS } from "@/lib/foto-borrador-token"

type Ctx = { params: Promise<{ draftId: string }> }

export async function POST(_req: Request, { params }: Ctx) {
  const { error, organizationId } = await requireAuth()
  if (error) return error

  const { draftId } = await params

  const { data: borrador } = await supabaseAdmin
    .from("foto_borrador")
    .select("id")
    .eq("id", draftId)
    .eq("organization_id", organizationId!)
    .single()

  if (!borrador) return NextResponse.json({ error: "No encontrado" }, { status: 404 })

  const { raw, hash } = generateBorradorToken()
  const expiresAt = new Date(Date.now() + FOTO_BORRADOR_TTL_MS)

  // Rota el token del mismo borrador: el anterior deja de servir en el acto,
  // y las fotos ya subidas siguen ahí.
  await supabaseAdmin
    .from("foto_borrador")
    .update({ token_hash: hash, expires_at: expiresAt.toISOString(), revoked_at: null })
    .eq("id", draftId)

  return NextResponse.json({ token: raw, expiresAt: expiresAt.toISOString() })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/api/foto-borrador-regenerar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/api/ordenes/foto-borrador/[draftId]/regenerar/route.ts" __tests__/api/foto-borrador-regenerar.test.ts
git commit -m "feat(ordenes): rotación del token del borrador sin perder las fotos"
```

---

### Task 5: Public upload endpoint

This is the only unauthenticated surface in the feature. Read the "Threat rule" at the top of this plan before writing it.

**Files:**
- Create: `app/api/public/carga-foto/[token]/route.ts`
- Test: `__tests__/api/carga-foto-publico.test.ts`

**Interfaces:**
- Produces: `POST /api/public/carga-foto/[token]` with body `{ data: string /* base64 */ }` → `{ ok: true }` or a uniform `{ error: "No se pudo subir la foto" }` with status 400.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockSupabaseFrom, createPostRequest, parseResponse } from "./helpers"
import { hashBorradorToken, FOTO_BORRADOR_TTL_MS } from "@/lib/foto-borrador-token"

import { POST } from "@/app/api/public/carga-foto/[token]/route"

const ctx = (token: string) => ({ params: Promise.resolve({ token }) })
const vigente = (over: any = {}) => ({
  id: "d1",
  organization_id: "org-1",
  revoked_at: null,
  expires_at: new Date(Date.now() + FOTO_BORRADOR_TTL_MS).toISOString(),
  ...over,
})

describe("POST /api/public/carga-foto/[token] — única superficie sin auth", () => {
  beforeEach(() => vi.clearAllMocks())

  it("responde igual ante token inexistente que ante token vencido", async () => {
    mockSupabaseFrom({ foto_borrador: createChainMock(null, null) })
    const inexistente = await parseResponse(
      await POST(createPostRequest({ data: "x" }), ctx("no-existe")),
    )

    vi.clearAllMocks()
    mockSupabaseFrom({
      foto_borrador: createChainMock(vigente({ expires_at: new Date(Date.now() - 1000).toISOString() }), null),
      foto_borrador_item: createChainMock([], null, 0),
    })
    const vencido = await parseResponse(await POST(createPostRequest({ data: "x" }), ctx("vencido")))

    expect(inexistente.status).toBe(vencido.status)
    expect(inexistente.body).toEqual(vencido.body)
  })

  it("busca por hash, nunca por el token crudo", async () => {
    const chain = createChainMock(null, null)
    mockSupabaseFrom({ foto_borrador: chain })
    await POST(createPostRequest({ data: "x" }), ctx("token-crudo"))

    const calls = JSON.stringify(chain.eq.mock.calls)
    expect(calls).toContain(hashBorradorToken("token-crudo"))
    expect(calls).not.toContain("token-crudo")
  })

  it("rechaza contenido que no es una imagen permitida", async () => {
    mockSupabaseFrom({
      foto_borrador: createChainMock(vigente(), null),
      foto_borrador_item: createChainMock([], null, 0),
    })
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString("base64")
    const res = await POST(createPostRequest({ data: svg }), ctx("t"))
    expect(res.status).toBe(400)
  })

  it("rechaza un payload por encima del tope de peso", async () => {
    mockSupabaseFrom({
      foto_borrador: createChainMock(vigente(), null),
      foto_borrador_item: createChainMock([], null, 0),
    })
    const gordo = Buffer.alloc(3 * 1024 * 1024).toString("base64")
    const res = await POST(createPostRequest({ data: gordo }), ctx("t"))
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/carga-foto-publico.test.ts`
Expected: FAIL — cannot resolve the route module.

- [ ] **Step 3: Write the implementation**

```ts
import { NextResponse } from "next/server"
import { v4 as uuidv4 } from "uuid"
import { supabaseAdmin } from "@/lib/supabase"
import { rateLimit } from "@/lib/rate-limit"
import { hashBorradorToken, canAcceptFoto } from "@/lib/foto-borrador-token"
import { sniffImageMime, reencodeFoto, MAX_FOTO_BYTES } from "@/lib/foto-borrador-image"

const BUCKET = "foto-borrador"

type Ctx = { params: Promise<{ token: string }> }

/**
 * Respuesta única para TODA falla. Token inexistente, vencido, revocado o con
 * el tope alcanzado responden exactamente igual, así que desde afuera no se
 * puede sondear qué borradores existen.
 */
const rechazo = () =>
  NextResponse.json({ error: "No se pudo subir la foto" }, { status: 400 })

export async function POST(req: Request, { params }: Ctx) {
  const { token } = await params

  const porToken = await rateLimit(`cf:${token}`, 20, 5 * 60 * 1000)
  if (!porToken.success) return rechazo()

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconocida"
  const porIp = await rateLimit(`cf-ip:${ip}`, 60, 5 * 60 * 1000)
  if (!porIp.success) return rechazo()

  // El crudo solo se usa para derivar el hash; nunca va a una query.
  const tokenHash = hashBorradorToken(token)

  const { data: borrador } = await supabaseAdmin
    .from("foto_borrador")
    .select("id, organization_id, revoked_at, expires_at")
    .eq("token_hash", tokenHash)
    .single()

  if (!borrador) return rechazo()

  const { count } = await supabaseAdmin
    .from("foto_borrador_item")
    .select("id", { count: "exact", head: true })
    .eq("borrador_id", borrador.id)

  const puede = canAcceptFoto(
    { revokedAt: borrador.revoked_at, expiresAt: borrador.expires_at },
    count ?? 0,
    new Date(),
  )
  if (!puede.ok) return rechazo()

  let body: { data?: string }
  try {
    body = await req.json()
  } catch {
    return rechazo()
  }
  if (!body?.data || typeof body.data !== "string") return rechazo()

  const buffer = Buffer.from(body.data, "base64")
  if (buffer.length === 0 || buffer.length > MAX_FOTO_BYTES) return rechazo()

  // El tipo sale de los bytes, no de ningún header que mande el cliente.
  if (!sniffImageMime(buffer)) return rechazo()

  let normalizada: { buffer: Buffer; mime: "image/jpeg" }
  try {
    normalizada = await reencodeFoto(buffer)
  } catch {
    return rechazo()
  }

  const path = `${borrador.organization_id}/${borrador.id}/${uuidv4()}.jpg`
  const { error: upErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, normalizada.buffer, { contentType: normalizada.mime, upsert: false })

  if (upErr) return rechazo()

  const { error: dbErr } = await supabaseAdmin.from("foto_borrador_item").insert({
    borrador_id: borrador.id,
    storage_path: path,
    mime: normalizada.mime,
    size: normalizada.buffer.length,
  })

  if (dbErr) {
    await supabaseAdmin.storage.from(BUCKET).remove([path]).catch(() => {})
    return rechazo()
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/api/carga-foto-publico.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/api/public/carga-foto/[token]/route.ts" __tests__/api/carga-foto-publico.test.ts
git commit -m "feat(ordenes): endpoint publico de subida con respuesta uniforme ante fallas"
```

---

### Task 6: Full verification and PR

- [ ] **Step 1: Verify the whole project**

```bash
npx tsc --noEmit
npx eslint app/api/ordenes/foto-borrador "app/api/public/carga-foto/[token]/route.ts" __tests__/api
npx vitest run __tests__/api __tests__/lib
npx next build
```

Expected: tsc exit 0, eslint exit 0, all tests pass, build "Compiled successfully".

- [ ] **Step 2: Open the PR**

Body must state: migrations **276 and 282 both need manual application** before anything works, that the only unauthenticated surface is `/api/public/carga-foto/[token]`, that all its failures are indistinguishable by design, and that nothing is user-visible yet (the QR panel and phone page are slice 3).

If GitHub Actions does not fire on PR creation, close and reopen the PR — that re-emits the `pull_request` event. This happened on #239.

- [ ] **Step 3: Read checks as a separate step before merging**

Do not chain `gh pr merge` onto the watch command.

---

## What this slice deliberately does not do

- No QR panel, no phone page, no change to `OrdenForm`. Slice 3.
- No cleanup cron. Slice 4.
- No change to `POST /api/ordenes`, here or ever.
