# Product

## Register

product

## Users

Owners and staff of small-to-medium electronics repair shops ("talleres de servicio técnico") in Argentina and Latin America — mostly mobile phone and computer repair businesses.

Three roles, three contexts:
- **ADMIN** (shop owner/manager): often not technical. Wants the whole business legible at a glance — orders in flight, money owed, stock running low. Uses it on desktop in the back office and on mobile on the move.
- **VENDEDOR** (front-counter seller): high-tempo intake. Creates orders and clients, rings up POS sales, talks to customers. Speed and few taps matter most.
- **TECNICO** (technician): sees only assigned orders. Focused, repetitive task flow; updates status, logs parts and hours.

Primary context is a busy counter or workbench, frequently on mobile, sometimes one-handed. Spanish (Argentina): voseo, ARS/MercadoPago, DNI, dd/mm/yyyy.

## Product Purpose

End-to-end management of the repair lifecycle: order intake → diagnosis → quote → repair → delivery, plus inventory, POS sales, invoicing, warranties, customer messaging (email + WhatsApp), and analytics. Multi-tenant SaaS with Free and Profesional tiers; the paid tier unlocks unlimited volume, advanced reports, multi-branch, and branding.

Success = the shop runs its day inside STApp without falling back to paper or spreadsheets, and a non-technical owner trusts the numbers it shows.

## Brand Personality

Modern and accessible. Professional but warm — a serious work tool that doesn't feel like enterprise software. Voice is plain, direct, helpful; never jargon-heavy, never cute. Three words: **clear, capable, approachable.**

The interface should feel current and considered (justifies the Profesional price) while staying calm and out of the way during high-tempo work.

## Anti-references

All four flagged explicitly by the owner:
- **Legacy ERP / Excel**: infinite gray tables, dense airless forms, 2000s-era Argentine management software (SAP-like). No.
- **Generic AI SaaS**: purple gradients, glassmorphism, the hero-metric template, identical icon+title+text card grids. No.
- **Too playful**: saturated color everywhere, cartoon illustrations, over-animation. It's a work tool, not a consumer app. No.
- **Cold / soulless corporate**: boring corporate blue, all gray-and-white, zero personality. This is the CURRENT state and the primary thing to fix — warmth must come from execution, not from a rebrand.

## Design Principles

1. **Operator speed first.** This is a tool people use all day at a counter. Clarity and few taps beat decoration. Never add motion or surface that slows the primary task.
2. **Warmth through execution, not rebrand.** The blue identity stays. Personality comes from depth, rhythm, considered spacing, good states, and craft details — not from new brand colors or louder visuals.
3. **Systematic consistency.** Adopt the existing design system everywhere. Shared primitives (page shell, section header, status, empty/error states) so every screen feels like one product, not 300 hand-built pages.
4. **Depth over boxes.** Move past card-overuse and white-on-white. Build hierarchy with surface, space, and weight — not by wrapping everything in another card.
5. **Trust for non-technical owners.** Clear labels, honest numbers, helpful empty and error states, sensible defaults. The owner should never feel lost or doubt what a screen is telling them.

## Accessibility & Inclusion

- Target WCAG 2.1 AA. Body text ≥4.5:1, large/UI text ≥3:1 — fix the current low-contrast muted grays.
- Touch targets ≥44px (already enforced for coarse pointers); preserve on mobile-first flows.
- Full dark mode already exists; keep parity in every change.
- Honor `prefers-reduced-motion` on all animation (landing already has a provider; extend the discipline into the app).
- Mobile-first and frequently one-handed: reachable primary actions, bottom sheets over top modals on small screens.
