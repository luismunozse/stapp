# Panel AI Assistant — Design

**Date**: 2026-07-20
**Status**: Approved by Luis (pending spec review)

## Goal

Add an AI assistant inside the authenticated panel that helps workshops learn STApp faster. Knowledge-only guide (no access to org data), gated to the **Profesional plan with ACTIVE status** (trial excluded), with hard cost controls so token spend is bounded per org.

## Non-goals

- No querying of org data ("how much did I sell today") — the assistant only answers "how do I use X" questions.
- No tool use, no RAG, no embeddings.
- No changes to the landing chatbot (`app/api/chatbot/route.ts`), though it can later adopt the same caching technique.

## Architecture

### 1. Knowledge base — single source of truth

- Extract the `sections: ManualSection[]` array (and its types) from `app/ayuda/manual/page.tsx` into `lib/manual-content.ts` as pure typed data.
- `app/ayuda/manual/page.tsx` imports it — zero visual change.
- `lib/asistente/system-prompt.ts` renders the same data into the system prompt text.
- The system prompt is **fully static**: no price interpolation, no dates, no per-request values. This is a hard requirement for prompt caching (prefix match — any byte change invalidates the cache).
- Updating the manual automatically updates the assistant.

### 2. API endpoint — `app/api/asistente/route.ts` (POST)

Order of checks:

1. **Auth**: panel session required (same pattern as other authenticated API routes). No session → 401.
2. **Plan gate**: `hasPlanFeature(orgId, "asistente_ia")` AND `subscription.status === "ACTIVE"`. The extra status check excludes TRIALING (which `hasPlanFeature` allows while the trial is valid). The `asistente_ia` feature flag is added to the Profesional plan via migration; per-org overrides (`organization_feature_overrides`) allow manual enablement for any org.
3. **Input validation** (zod): message ≤ 1,000 chars, non-empty.
4. **Rate limit**: 10 messages/min per user (in-memory map, same approach as landing bot).
5. **Daily cap**: 50 messages/day per org — computed by counting today's rows in `asistente_mensajes` (org timezone-aware day boundary via existing `lib/timezone.ts` conventions). Over cap → 429 with a friendly message.

Claude call:

- Model: `claude-haiku-4-5`, `max_tokens: 1024`.
- System prompt block carries `cache_control: {type: "ephemeral"}`. Haiku 4.5 minimum cacheable prefix is 4,096 tokens; the rendered manual comfortably exceeds it.
- Conversation history: last 6 turns, loaded from DB, passed as messages (after the cached system prefix).
- Prompt instructions: answer ONLY about how to use STApp (based on the manual content); politely refuse any other topic; never invent features; role-aware answers (ADMIN/TECNICO/VENDEDOR) where the manual marks them.

### 3. Persistence — migration `274_asistente_panel.sql` (number = next available)

- `asistente_conversaciones`: id, organization_id, usuario_id, created_at.
- `asistente_mensajes`: id, conversacion_id, tipo (USER/ASSISTANT), contenido, modelo, input_tokens, cache_read_input_tokens, cache_creation_input_tokens, output_tokens, tiempo_respuesta_ms, created_at.
- RLS by organization, consistent with existing tables.
- Feature flag `asistente_ia` added to the Profesional plan's `feature_flags`.
- Token columns give real cost per org and abuse visibility from a single table; the daily cap query reads from the same table.

### 4. UI — floating widget

- Component mounted in the dashboard layout: floating bubble, bottom corner, opens a chat panel.
- Rendered only when the org passes the gate; the server enforces the gate regardless (hiding the button is UX, not security).
- Orgs without access see a locked bubble linking to the plan upgrade page (upsell surface for Profesional).
- UI copy in neutral Spanish, consistent with the rest of the panel.
- Error states: 429 (rate/daily limit) shows the limit message; API failure shows a retry message.

## Cost model

- ~$0.0035/message with warm cache (cached read ~15–20k tokens at $0.10/MTok + ~400 output tokens at $5/MTok).
- Hard ceiling: 50 msg/day/org → worst case ≈ $5 USD/month per hyperactive org; typical org ≪ $1.
- Cache writes (1.25×) occur at most once per 5-min idle window; negligible at this scale.

## Security summary

- Endpoint requires panel auth; multi-tenant safety is structural: the model never receives org data, only static manual text.
- No tools; prompt anchored to STApp usage topics.
- Per-user rate limit + per-org daily cap persisted in DB (survives restarts/instances).
- Usage logged per org (token counts per message).

## Testing

- Unit: system-prompt renderer (stable output, no dynamic values), gate logic (Profesional ACTIVE passes; TRIALING/free/expired fail), daily-cap counting.
- API: 401 without session, 403 without plan, 429 over limits, happy path persists both messages with token usage.
- Existing manual page still renders from the extracted data (typecheck + existing e2e).
