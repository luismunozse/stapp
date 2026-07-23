# Phone Camera Handoff for Order Intake Photos — Design

**Date**: 2026-07-23
**Status**: Approved by Luis (pending spec review)

## Goal

Let an operator creating an order **from a desktop PC** capture intake photos of the device with the phone already in their hand, without leaving the order form.

Today step 3 of `OrdenForm` collects photos as base64 in component state and sends them in the create payload. On a PC the "Tomar foto" button uses `capture="environment"`, which does nothing useful — so the operator must photograph the device with a phone, transfer the file to the PC, and pick it from disk. In practice the photo is skipped, and the intake record (`constancia`) of the device's condition is lost.

The handoff: the form shows a QR, the operator scans it with the phone's native camera app, takes the photos, and they appear in the PC form as they arrive. Creating the order attaches them as `INGRESO`, exactly as today.

Available on **all plans** — this is core to order intake, not a premium add-on.

## Non-goals

- Replacing the existing file picker. It stays as-is for photos already on the PC.
- Real-time push. The project uses no Supabase Realtime; short polling is sufficient for a panel that is open for seconds.
- Photo capture for anything other than order intake (inventory, catalog, post-creation `FotoUpload`) — the mechanism is reusable later but this change touches order creation only.
- Attaching photos to an order that already exists. That path already works via `FotoUpload` and `/api/ordenes/[id]/fotos`.
- Any change to `POST /api/ordenes` (see Architecture §6).

## Security model

This is the core of the design, so it is stated before the mechanics.

**Governing principle: the QR token grants exactly one capability — append one image to one specific draft.** Nothing else. The phone page is a dumb camera pipe.

- It does not authenticate, does not set cookies, and does not read any session.
- It renders **no business data** — no client, no device, no order number, no organization name. Someone who scans a QR they were not meant to scan learns nothing about the system.
- It is **write-only**: it never reads or lists photos from the server. Thumbnails are the ones the phone just took, held client-side.
- No CORS headers are added. It is same-origin only.

### Token

- 256 bits from `crypto.randomBytes(32)`, base64url-encoded.
- Stored **hashed (SHA-256)** in `foto_borrador.token_hash`. The raw token exists only in the QR on screen and in the phone's URL. A database leak yields no usable tokens.
- **TTL: 5 minutes absolute**, no refresh. The PC panel shows a countdown and a "Regenerar QR" button that revokes the old draft's token and mints a new one for the same draft.
- Scoped to one `foto_borrador` row, itself bound to `organization_id`, `sucursal_id` and the issuing `user_id`.
- Revoked when: the order is created, the form/panel is closed, the TTL passes, or the per-draft photo cap is reached.
- Only an authenticated user allowed to create orders can mint one, capped at **3 active drafts per user**.

**The token is ephemeral; the draft is not.** Photos already uploaded survive token expiry, so an operator who takes 6 minutes does not lose their work — they just need a fresh QR to upload more.

### Upload hardening

- Max **6 photos per draft**; max **2 MB per photo** after the client-side `compressImage` (which already targets ~300 KB / 1920 px).
- Content type validated by **magic bytes**, not the `Content-Type` header.
- Server-side **re-encode** of every accepted image. This defeats polyglot files and strips EXIF, which otherwise leaks the client's geolocation into the order record.
- Rate limited with the existing `rateLimit()` from `lib/rate-limit.ts`, per token and per IP — the same defense the middleware already applies to public catálogo slugs.
- Staged objects live under a private prefix, `drafts/{organization_id}/{draft_id}/`. Only the authenticated PC session reads them back, via short-lived signed URLs.

### Accepted residual risk

Anyone who can see the PC screen can scan the QR and add a photo to the order being created at that moment. This is inherent to any QR handoff. Impact is low — the operator watches the photos appear — and the 5-minute TTL bounds it. There is no pivot into the authenticated system: the token authenticates nothing and reads nothing.

## Architecture

### 1. DB — migration `276_foto_borrador.sql`

Two new tables. `fotos_orden` is **not** touched; making its `orden_id` nullable to reuse it would weaken an existing invariant on the table that holds the actual intake record.

- `foto_borrador`: `id`, `organization_id`, `sucursal_id`, `user_id`, `token_hash` (unique, indexed), `expires_at`, `revoked_at`, `created_at`.
- `foto_borrador_item`: `id`, `borrador_id` (FK, cascade delete), `storage_path`, `mime`, `size`, `created_at`.

Idempotent, with a banner comment, following the conventions of migrations 265/274/275.

### 2. Token helpers — `lib/foto-borrador-token.ts`

Pure functions, no I/O, so the security-critical logic is testable without infrastructure:

- `generateToken()` → raw token + its SHA-256 hash.
- `hashToken(raw)` → hash for lookup.
- `isExpired(borrador, now)` → TTL check, `now` injected (no ambient clock).
- `canAcceptPhoto(borrador, itemCount, now)` → single predicate covering revoked / expired / cap reached, returning a discriminated reason.

### 3. Image validation — `lib/foto-borrador-image.ts`

- `sniffImageMime(buffer)` → mime from magic bytes, or `null` when unrecognized. **Allowlist: JPEG, PNG, WebP only.** SVG is rejected outright — it is the one image type that can carry script, and excluding it removes the stored-XSS vector entirely rather than trying to sanitize it.
- `reencodeImage(buffer)` → normalized image with all metadata stripped.

**Decision: add `sharp` as a dependency for the re-encode.** The project has no server-side image encoder today (`lib/image-compression.ts` wraps `browser-image-compression`, which is canvas-based and client-only).

The alternative — validating magic bytes and trusting the phone's client-side compression — is weaker in a way that matters here. Canvas re-encoding on the phone does strip EXIF as a side effect, but a client-side guarantee is no guarantee: the upload endpoint is public and an attacker controls their own client. EXIF on an intake photo carries the client's GPS coordinates into a permanent business record, so stripping it must be enforced server-side.

Tradeoff accepted: `sharp` is a native binary dependency and adds build weight. It is supported first-class on Vercel, which is the deployment target.

### 4. Authenticated endpoints (PC side)

- `POST /api/ordenes/foto-borrador` — mints a draft, returns `{ draftId, token, expiresAt }`. Enforces the per-user active-draft cap.
- `GET /api/ordenes/foto-borrador/[draftId]` — returns items with short-lived signed URLs. Scoped to the issuing user's organization.
- `DELETE /api/ordenes/foto-borrador/[draftId]` — revokes the token and deletes rows and storage objects. Called when the order is created or the panel is cancelled.
- `POST /api/ordenes/foto-borrador/[draftId]/regenerar` — revokes the current token, mints a new one for the same draft.

### 5. Public upload endpoint (phone side)

`POST /api/public/carga-foto/[token]` — placed under the existing `/api/public` namespace, which `isPublicPath()` in `middleware.ts` already exempts from auth.

Order of checks, all before any write: rate limit → token hash lookup → `canAcceptPhoto` → size cap → magic-byte sniff → re-encode → store → insert row. Every failure returns a generic message; the response never distinguishes "unknown token" from "expired token", so the endpoint cannot be used to probe for valid drafts.

### 6. Order creation stays untouched

The PC polls `GET /api/ordenes/foto-borrador/[draftId]` every 2–3 s while the panel is open, downloads new items, and pushes them into the **existing** `fotos` state as `FotoPreview` objects. On submit they travel in the current `fotos: [{ data, mime, tipo: "INGRESO" }]` payload.

`POST /api/ordenes` therefore needs **no changes**. The staging tables are pure transport, and the intake record is written by the same code path that works today — including `enforcePlanLimit(organizationId, "storage")` and `updateStorageUsage`.

Photos travel twice (phone → server → PC → server). At ~300 KB compressed and 6 photos max, that is ~1.8 MB in the worst case — a cheap price for not touching the critical creation path.

Consequence: **staged photos do not count against the plan's storage quota.** They are counted once, when the order is created, through the normal path. Counting them at staging time would bill the organization twice. Abuse is bounded by the hard caps, not by quota.

### 7. Phone page — `app/carga-foto/[token]/page.tsx`

Public, added to `isPublicPath()`. Mirrors the existing public token-scoped pages (`/seguimiento`, `/cotizacion`).

Minimal UI: one large "Sacar foto" button (`<input type="file" accept="image/*" capture="environment">`), a client-side preview strip, and an upload action. Client-side `compressImage` before upload, reusing `lib/image-compression`. States: ready, uploading, done, and a terminal error state for expired/invalid tokens reading "Este código venció. Pedí uno nuevo en la PC."

### 8. PC panel — `components/ordenes/foto-qr-panel.tsx`

Rendered in step 3 of `OrdenForm` behind a "Sacar fotos con el celular" button. Shows the QR (via the existing `qrcode` dependency, already used by catálogo sharing and label printing), a 5-minute countdown, "Regenerar QR", and a live count of received photos. Polling starts when the panel opens and stops on close, order creation, or unmount.

The QR encodes the tenant-qualified URL `https://{tenant-host}/carga-foto/{token}`, since the app is multi-tenant by subdomain.

### 9. Cleanup

A route under the existing `/api/cron` namespace (already public-exempt and used by other jobs) deletes drafts older than 24 h along with their storage objects. This covers panels abandoned without cancelling.

## Testing

Strict TDD is active for this project. The security-critical logic is deliberately factored into pure functions so it is tested without infrastructure:

- `lib/foto-borrador-token.ts` — hash round-trip, expiry boundary with injected `now`, revoked and cap-reached predicates.
- `lib/foto-borrador-image.ts` — magic-byte sniffing accepts real JPEG/PNG/WebP, rejects a renamed non-image, and rejects SVG even when the header claims `image/svg+xml`; re-encode strips EXIF (assert a GPS-tagged fixture comes out clean).
- Endpoint tests: unknown and expired tokens return the same generic response; the cap is enforced at the boundary; oversized payloads are rejected before any write.
- Component test for `FotoQrPanel` covering the countdown-expired state and stopping the poll on unmount.
- No authenticated e2e coverage — `STAPP_TEST_EMAIL`/`STAPP_TEST_PASSWORD` are absent from both `.env` and CI, so those specs self-skip and would be a false guard.

## Delivery

Sized for review focus, as chained PRs off `main`:

1. Migration 276 + `lib/foto-borrador-token.ts` + `lib/foto-borrador-image.ts` (adds the `sharp` dependency), with their tests. No UI, no routes.
2. Authenticated draft endpoints + the public upload endpoint, with tests.
3. Phone page + PC QR panel wired into `OrdenForm` step 3.
4. Cleanup cron route.

Slice 1 is inert on its own; nothing is user-visible until slice 3.
