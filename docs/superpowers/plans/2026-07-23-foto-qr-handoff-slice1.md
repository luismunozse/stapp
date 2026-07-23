# Foto QR Handoff — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data model and the two security-critical pure modules that the phone-camera handoff depends on, with nothing user-visible yet.

**Architecture:** A `foto_borrador` row holds one short-lived upload session; `foto_borrador_item` holds the staged photos. The QR token is generated with 256 bits of entropy, stored only as a SHA-256 hash, and every accept/reject decision is a pure predicate so it can be tested without infrastructure. Uploaded bytes are validated by magic bytes (never the `Content-Type` header) and re-encoded server-side to strip EXIF.

**Tech Stack:** Next.js 16, TypeScript, Supabase (Postgres + Storage), Vitest, `sharp` (new dependency).

**Spec:** `docs/superpowers/specs/2026-07-23-foto-qr-handoff-design.md`

## Global Constraints

- Migration number is **276**; it is the next free number (275 is the highest applied).
- Table ids follow the existing schema convention: `id TEXT PRIMARY KEY DEFAULT generate_cuid()` (defined in `001_schema.sql`). **Not uuid.**
- New tables enable RLS and declare policies following `274_asistente_panel.sql` exactly.
- No rollback file: migrations 274 and 275 have none, and `supabase/migrations/rollback/` stops at 203.
- Migrations are idempotent (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`) and open with the `-- ====` banner comment block.
- Pure-logic tests start with `// @vitest-environment node` and use Spanish `describe`/`it` descriptions, matching `__tests__/lib/blog-seo.test.ts`.
- Identifier style follows the codebase: English verb + Spanish domain noun (`requireInventarioAccess`, `parseMoneyInput`, `hashApiKey`).
- Token TTL is **5 minutes**, max **6** photos per draft, max **3** active drafts per user, max **2 MB** per photo. These are the values in the spec — do not change them.
- Magic-byte allowlist is **JPEG, PNG, WebP only**. SVG must be rejected.
- Test runner: `npx vitest run <path>`. Strict TDD is active — the failing test comes first, always.

---

### Task 1: Migration 276 — draft tables

**Files:**
- Create: `supabase/migrations/276_foto_borrador.sql`

**Interfaces:**
- Consumes: `organizations(id)`, `users(id)`, `sucursales(id)` (from `201_sucursales_tabla.sql`), `generate_cuid()` (from `001_schema.sql`).
- Produces: tables `foto_borrador` and `foto_borrador_item`, consumed by Slice 2's endpoints.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/276_foto_borrador.sql`:

```sql
-- ============================================================================
-- 276: borradores de fotos para el handoff por QR al crear órdenes
-- ============================================================================
-- Permite sacar las fotos del equipo con el celular mientras se carga la orden
-- desde una PC. El token del QR concede UNA sola capacidad: agregar una imagen
-- a un borrador. Se guarda hasheado (SHA-256) — el token crudo vive solo en el
-- QR en pantalla — y vence a los 5 minutos.
--
-- El staging es transporte: al crear la orden las fotos viajan por el payload
-- actual de POST /api/ordenes, así que acá NO se cuentan contra la cuota de
-- storage del plan (se estarían contando dos veces).
-- ============================================================================

CREATE TABLE IF NOT EXISTS foto_borrador (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sucursal_id TEXT REFERENCES sucursales(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE foto_borrador IS
  'Sesión efímera de subida de fotos por QR. El token vive solo hasheado; el borrador sobrevive al vencimiento del token para no perder fotos ya subidas.';
COMMENT ON COLUMN foto_borrador.token_hash IS
  'SHA-256 hex del token crudo. El token crudo nunca se persiste.';

-- Lookup del token en cada subida: debe ser único y rápido.
CREATE UNIQUE INDEX IF NOT EXISTS foto_borrador_token_hash_idx
  ON foto_borrador(token_hash);
-- Tope de borradores activos por usuario.
CREATE INDEX IF NOT EXISTS foto_borrador_user_idx
  ON foto_borrador(user_id, revoked_at, expires_at);
-- Barrido del job de limpieza.
CREATE INDEX IF NOT EXISTS foto_borrador_created_idx
  ON foto_borrador(created_at);

CREATE TABLE IF NOT EXISTS foto_borrador_item (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  borrador_id TEXT NOT NULL REFERENCES foto_borrador(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE foto_borrador_item IS
  'Foto en staging. Se borra al crear la orden (las fotos viajan por el payload actual) o por el job de limpieza a las 24h.';

CREATE INDEX IF NOT EXISTS foto_borrador_item_borrador_idx
  ON foto_borrador_item(borrador_id);

ALTER TABLE foto_borrador ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS foto_borrador_select ON foto_borrador;
CREATE POLICY foto_borrador_select ON foto_borrador
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS foto_borrador_all_service ON foto_borrador;
CREATE POLICY foto_borrador_all_service ON foto_borrador
  FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE foto_borrador_item ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS foto_borrador_item_select ON foto_borrador_item;
CREATE POLICY foto_borrador_item_select ON foto_borrador_item
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM foto_borrador b
      WHERE b.id = foto_borrador_item.borrador_id
        AND b.organization_id = current_setting('app.organization_id', true)
    )
  );

DROP POLICY IF EXISTS foto_borrador_item_all_service ON foto_borrador_item;
CREATE POLICY foto_borrador_item_all_service ON foto_borrador_item
  FOR ALL USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Verify the file parses as valid SQL by review**

There is no local Postgres in this project, so this is a read-through, not a command. Confirm each of these by eye:
- Every `CREATE` uses `IF NOT EXISTS`; every `CREATE POLICY` is preceded by `DROP POLICY IF EXISTS`.
- `sucursal_id` is nullable with `ON DELETE SET NULL` (a draft outliving a deleted branch must not cascade away).
- No `updated_at` column and therefore no `updated_at` trigger — these rows are never updated in place except `revoked_at`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/276_foto_borrador.sql
git commit -m "feat(ordenes): tablas de borrador de fotos para el handoff por QR"
```

---

### Task 2: Token module

**Files:**
- Create: `lib/foto-borrador-token.ts`
- Test: `__tests__/lib/foto-borrador-token.test.ts`

**Interfaces:**
- Consumes: node `crypto` only. Mirrors the idiom of `lib/api-keys.ts` (`randomBytes` + `createHash("sha256")`).
- Produces, relied on by Slice 2:
  - `FOTO_BORRADOR_TTL_MS: number`
  - `MAX_FOTOS_POR_BORRADOR: number`
  - `MAX_BORRADORES_ACTIVOS: number`
  - `generateBorradorToken(): { raw: string; hash: string }`
  - `hashBorradorToken(raw: string): string`
  - `canAcceptFoto(borrador: BorradorEstado, cantidadActual: number, now: Date): ResultadoAceptacion`
  - `type BorradorEstado = { revokedAt: Date | string | null; expiresAt: Date | string }`
  - `type MotivoRechazo = "REVOCADO" | "VENCIDO" | "TOPE_ALCANZADO"`
  - `type ResultadoAceptacion = { ok: true } | { ok: false; motivo: MotivoRechazo }`

Note: the spec sketched a separate `isExpired()` helper. It is deliberately **not** exported — expiry is folded into `canAcceptFoto` so there is exactly one gate. A separate `isExpired` invites a caller to check expiry and forget the revoked and cap checks.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/foto-borrador-token.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  generateBorradorToken,
  hashBorradorToken,
  canAcceptFoto,
  FOTO_BORRADOR_TTL_MS,
  MAX_FOTOS_POR_BORRADOR,
} from "@/lib/foto-borrador-token"

const AHORA = new Date("2026-07-23T12:00:00.000Z")
const vigente = {
  revokedAt: null,
  expiresAt: new Date(AHORA.getTime() + FOTO_BORRADOR_TTL_MS),
}

describe("token del borrador: el crudo nunca se persiste", () => {
  it("genera un token de 256 bits junto a su hash sha256", () => {
    const { raw, hash } = generateBorradorToken()
    // base64url de 32 bytes = 43 chars sin padding
    expect(raw).toHaveLength(43)
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("el hash es reproducible desde el crudo, y el crudo no se deduce del hash", () => {
    const { raw, hash } = generateBorradorToken()
    expect(hashBorradorToken(raw)).toBe(hash)
    expect(hash).not.toContain(raw)
  })

  it("dos tokens seguidos no colisionan", () => {
    expect(generateBorradorToken().raw).not.toBe(generateBorradorToken().raw)
  })
})

describe("canAcceptFoto: única compuerta de aceptación", () => {
  it("acepta un borrador vigente por debajo del tope", () => {
    expect(canAcceptFoto(vigente, 0, AHORA)).toEqual({ ok: true })
  })

  it("rechaza un borrador revocado antes que cualquier otra causa", () => {
    const revocado = { revokedAt: AHORA, expiresAt: vigente.expiresAt }
    expect(canAcceptFoto(revocado, 99, AHORA)).toEqual({ ok: false, motivo: "REVOCADO" })
  })

  it("rechaza exactamente en el instante de vencimiento, no un ms después", () => {
    const borde = { revokedAt: null, expiresAt: AHORA }
    expect(canAcceptFoto(borde, 0, AHORA)).toEqual({ ok: false, motivo: "VENCIDO" })
  })

  it("sigue aceptando un milisegundo antes de vencer", () => {
    const casi = { revokedAt: null, expiresAt: new Date(AHORA.getTime() + 1) }
    expect(canAcceptFoto(casi, 0, AHORA)).toEqual({ ok: true })
  })

  it("rechaza al alcanzar el tope de fotos", () => {
    expect(canAcceptFoto(vigente, MAX_FOTOS_POR_BORRADOR, AHORA)).toEqual({
      ok: false,
      motivo: "TOPE_ALCANZADO",
    })
  })

  it("acepta expiresAt serializado como string (viene así de supabase-js)", () => {
    const desdeDb = { revokedAt: null, expiresAt: vigente.expiresAt.toISOString() }
    expect(canAcceptFoto(desdeDb, 0, AHORA)).toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/foto-borrador-token.test.ts`
Expected: FAIL — cannot resolve `@/lib/foto-borrador-token`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/foto-borrador-token.ts`:

```ts
import { randomBytes, createHash } from "crypto"

/** Vida del token del QR. Corta a propósito: el QR queda expuesto en pantalla. */
export const FOTO_BORRADOR_TTL_MS = 5 * 60 * 1000
export const MAX_FOTOS_POR_BORRADOR = 6
export const MAX_BORRADORES_ACTIVOS = 3

export type BorradorEstado = {
  revokedAt: Date | string | null
  expiresAt: Date | string
}

export type MotivoRechazo = "REVOCADO" | "VENCIDO" | "TOPE_ALCANZADO"

export type ResultadoAceptacion = { ok: true } | { ok: false; motivo: MotivoRechazo }

export function hashBorradorToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex")
}

/**
 * 256 bits de entropía. El crudo viaja solo al QR; en la base queda el hash,
 * así que una filtración de la tabla no entrega tokens usables.
 */
export function generateBorradorToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url")
  return { raw, hash: hashBorradorToken(raw) }
}

/**
 * Compuerta única de aceptación. `now` se inyecta para que el vencimiento sea
 * testeable sin reloj ambiente.
 */
export function canAcceptFoto(
  borrador: BorradorEstado,
  cantidadActual: number,
  now: Date,
): ResultadoAceptacion {
  if (borrador.revokedAt) return { ok: false, motivo: "REVOCADO" }
  if (new Date(borrador.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, motivo: "VENCIDO" }
  }
  if (cantidadActual >= MAX_FOTOS_POR_BORRADOR) {
    return { ok: false, motivo: "TOPE_ALCANZADO" }
  }
  return { ok: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/foto-borrador-token.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/foto-borrador-token.ts __tests__/lib/foto-borrador-token.test.ts
git commit -m "feat(ordenes): token hasheado y compuerta de aceptación del borrador"
```

---

### Task 3: Image validation module

**Files:**
- Create: `lib/foto-borrador-image.ts`
- Test: `__tests__/lib/foto-borrador-image.test.ts`
- Modify: `package.json` (add `sharp`)

**Interfaces:**
- Consumes: `sharp`.
- Produces, relied on by Slice 2:
  - `MAX_FOTO_BYTES: number`
  - `sniffImageMime(buffer: Buffer): "image/jpeg" | "image/png" | "image/webp" | null`
  - `reencodeFoto(buffer: Buffer): Promise<{ buffer: Buffer; mime: "image/jpeg" }>`

- [ ] **Step 1: Add the dependency**

Run: `npm install sharp`

This is the decision recorded in the spec: the project has no server-side encoder (`lib/image-compression.ts` wraps `browser-image-compression`, which is canvas-based and client-only). EXIF stripping must be enforced on the server because the upload endpoint is public and the client is attacker-controlled.

- [ ] **Step 2: Write the failing test**

Create `__tests__/lib/foto-borrador-image.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { sniffImageMime, reencodeFoto } from "@/lib/foto-borrador-image"

const lienzo = () =>
  sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })

describe("sniffImageMime: el tipo sale de los magic bytes, no del header", () => {
  it("reconoce JPEG, PNG y WebP reales", async () => {
    expect(sniffImageMime(await lienzo().jpeg().toBuffer())).toBe("image/jpeg")
    expect(sniffImageMime(await lienzo().png().toBuffer())).toBe("image/png")
    expect(sniffImageMime(await lienzo().webp().toBuffer())).toBe("image/webp")
  })

  it("rechaza SVG aunque se presente como imagen", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    expect(sniffImageMime(svg)).toBeNull()
  })

  it("rechaza un archivo cualquiera renombrado como imagen", () => {
    expect(sniffImageMime(Buffer.from("no soy una imagen"))).toBeNull()
  })

  it("rechaza un buffer demasiado corto sin explotar", () => {
    expect(sniffImageMime(Buffer.from([0xff, 0xd8]))).toBeNull()
  })
})

describe("reencodeFoto: la salida no arrastra metadata del cliente", () => {
  it("borra el EXIF que traía la foto original", async () => {
    const conExif = await lienzo()
      .withExif({ IFD0: { Copyright: "cliente", Software: "camara" } })
      .jpeg()
      .toBuffer()
    expect((await sharp(conExif).metadata()).exif).toBeDefined()

    const { buffer } = await reencodeFoto(conExif)
    expect((await sharp(buffer).metadata()).exif).toBeUndefined()
  })

  it("normaliza siempre a JPEG decodificable", async () => {
    const { buffer, mime } = await reencodeFoto(await lienzo().png().toBuffer())
    expect(mime).toBe("image/jpeg")
    expect(sniffImageMime(buffer)).toBe("image/jpeg")
    expect((await sharp(buffer).metadata()).width).toBe(8)
  })

  it("falla ante bytes que no son imagen en vez de devolver basura", async () => {
    await expect(reencodeFoto(Buffer.from("no soy una imagen"))).rejects.toThrow()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/foto-borrador-image.test.ts`
Expected: FAIL — cannot resolve `@/lib/foto-borrador-image`.

- [ ] **Step 4: Write minimal implementation**

Create `lib/foto-borrador-image.ts`:

```ts
import sharp from "sharp"

/** Tope por foto, ya comprimida en el cliente (~300KB con compressImage). */
export const MAX_FOTO_BYTES = 2 * 1024 * 1024

export type MimePermitido = "image/jpeg" | "image/png" | "image/webp"

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * El `Content-Type` lo miente cualquiera, así que el tipo sale de los bytes.
 * SVG queda fuera a propósito: es el único formato de imagen que puede llevar
 * script, y excluirlo elimina el XSS almacenado en vez de intentar sanearlo.
 */
export function sniffImageMime(buffer: Buffer): MimePermitido | null {
  if (buffer.length < 12) return null
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg"
  if (buffer.subarray(0, 8).equals(PNG_MAGIC)) return "image/png"
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp"
  }
  return null
}

/**
 * Re-encodea del lado del servidor. `rotate()` aplica la orientación EXIF antes
 * de que se pierda, si no las fotos verticales salen acostadas. sharp descarta
 * la metadata salvo que se pida `withMetadata()`, así que el EXIF (que lleva
 * GPS del cliente) no llega al registro de la orden.
 */
export async function reencodeFoto(
  buffer: Buffer,
): Promise<{ buffer: Buffer; mime: "image/jpeg" }> {
  const out = await sharp(buffer).rotate().jpeg({ quality: 82 }).toBuffer()
  return { buffer: out, mime: "image/jpeg" }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/foto-borrador-image.test.ts`
Expected: PASS — 7 tests.

If `withExif` is unavailable on the installed sharp version, build the EXIF fixture with `.withMetadata({ exif: { IFD0: { Copyright: "cliente" } } })` instead and re-run. Do not weaken the assertion that the re-encoded output has no `exif`.

- [ ] **Step 6: Verify nothing else broke**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npx vitest run __tests__/lib`
Expected: all lib tests pass.

Note: `__tests__/components/orden-form-dispositivo-error.test.tsx` is a known pre-existing flake — it takes ~4.94 s against a 5000 ms `testTimeout` and fails only under full-suite load. It passes in isolation and in CI. It is unrelated to this work.

- [ ] **Step 7: Commit**

```bash
git add lib/foto-borrador-image.ts __tests__/lib/foto-borrador-image.test.ts package.json package-lock.json
git commit -m "feat(ordenes): validación por magic bytes y re-encodeo que limpia EXIF"
```

---

### Task 4: Open the PR

**Files:** none

- [ ] **Step 1: Write the PR body**

Write this to a scratch file (the repo has no PR template):

```markdown
Base del handoff por QR para sacar las fotos del equipo con el celular mientras
se carga la orden desde una PC. Diseño completo en
`docs/superpowers/specs/2026-07-23-foto-qr-handoff-design.md`.

**Este slice es inerte**: no agrega ninguna ruta, ninguna pantalla y ningún
endpoint. No hay nada que clickear. Son la migración y los dos módulos puros
sobre los que se apoyan los slices siguientes.

## Cambios

| Archivo | Qué hace |
|---|---|
| `supabase/migrations/276_foto_borrador.sql` | Tablas `foto_borrador` y `foto_borrador_item`, con RLS siguiendo 274 |
| `lib/foto-borrador-token.ts` | Token de 256 bits, guardado solo como hash SHA-256, y la compuerta única de aceptación |
| `lib/foto-borrador-image.ts` | Tipo por magic bytes (JPEG/PNG/WebP, SVG rechazado) y re-encodeo que limpia EXIF |

## Seguridad

El token concede una sola capacidad: agregar una imagen a un borrador. Se guarda
hasheado, así que una filtración de la tabla no entrega tokens usables. Vence a
los 5 minutos. Los topes (6 fotos, 2MB) son constantes exportadas, no números
sueltos en un handler.

El re-encodeo server-side **agrega `sharp`** como dependencia. El proyecto no
tenía encoder de servidor: `lib/image-compression.ts` envuelve
`browser-image-compression`, que es canvas y solo corre en el navegador. El
canvas del celular ya limpia EXIF de rebote, pero el endpoint de subida va a ser
público y el cliente lo controla el atacante. El EXIF lleva GPS del cliente a un
registro permanente del negocio, así que se fuerza del lado del servidor.

## Migración

**276 requiere aplicarse a mano** antes del slice 2. Sola no rompe nada: ninguna
ruta la consulta todavía.

## Verificación

- `npx vitest run __tests__/lib/foto-borrador-token.test.ts` — 9 tests
- `npx vitest run __tests__/lib/foto-borrador-image.test.ts` — 7 tests
- `npx tsc --noEmit` limpio
```

Then:

```bash
git push -u origin docs/foto-qr-handoff-spec
gh pr create --base main \
  --title "feat(ordenes): base del handoff por QR para fotos de ingreso (slice 1)" \
  --body-file <scratch file written above>
```

- [ ] **Step 2: Read the checks before merging**

Substitute the PR number returned by `gh pr create`:

```bash
gh pr checks <pr-number> --watch --interval 20
gh pr view <pr-number> --json mergeable,mergeStateStatus,statusCheckRollup \
  -q '{mergeable:.mergeable, state:.mergeStateStatus, failing:[.statusCheckRollup[]|select(.conclusion!="SUCCESS" and .conclusion!="NEUTRAL" and .state!="SUCCESS")|.name//.context]}'
```

Expected: `failing` is empty, `mergeable` is `MERGEABLE`, `state` is `CLEAN`.

Confirm this as a **separate step**. Do not chain `gh pr merge` onto the watch command — that is how #211 got merged with red checks.

---

## What this slice deliberately does not do

- No endpoint, authenticated or public. Slice 2.
- No QR panel and no phone page. Slice 3.
- No cleanup cron. Slice 4.
- No change to `POST /api/ordenes`, in this slice or any later one.

Nothing here is reachable by a user. The deliverable is a migration plus two tested modules.
