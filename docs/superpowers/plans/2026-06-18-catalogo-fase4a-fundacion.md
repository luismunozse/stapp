# Catálogo Fase 4a — Fundación + first impression — Plan

**Goal:** Lenguaje visual brand-led (theming + contraste), hero sin-banner tipográfico con mesh de marca, placeholder sin-foto consistente, logo sin recorte.

**Ejecución:** inline en el worktree `.claude/worktrees/catalogo-fase4a` (branch `feat/catalogo-fase4a`, off main). `node_modules` via junction. Visual con skill de diseño; helpers con TDD. Reviews delegados (read-only).

**Spec:** `docs/superpowers/specs/2026-06-18-catalogo-fase4a-fundacion-design.md`

---

## Task 1 — `lib/catalogo/brand.ts` (TDD)
- `getBrandTheme(hex)` → `{ brand, brandForeground, tint, tintStrong }`.
- Parse `#rgb`/`#rrggbb` → rgb; luminancia relativa WCAG; fg blanco si oscuro, oscuro si claro.
- Tints: `${hex}14` (tint), `${hex}26` (tintStrong). Input inválido → default `#0F172A`.
- Test `__tests__/lib/catalogo-brand.test.ts`: contraste dark/light, `#rgb`, inválido, formato tint.

## Task 2 — `components/catalogo-public/catalogo-image-placeholder.tsx` (TDD)
- Props: `name: string`, `className?`, `tipo?`. Render monograma (1ra letra alfanumérica, upper) sobre `var(--brand-tint)`, color `var(--brand)`. Nombre vacío → ícono lucide fallback.
- Test `__tests__/components/catalogo-image-placeholder.test.tsx`: monograma de "Funda" = "F"; vacío no crashea; className aplicada.

## Task 3 — Consumir vars de theming
- En `catalogo-view.tsx` (~:260) y `catalogo-item-view.tsx` (~:126): donde se setea `--brand`, setear también `--brand-foreground`, `--brand-tint`, `--brand-tint-strong` desde `getBrandTheme(color_primary)`.

## Task 4 — Hero sin-banner (skill de diseño)
- `catalogo-hero.tsx` rama sin banner: nombre grande protagonista + tagline + logo + CTAs; fondo mesh (2–3 radial-gradients en `--brand-tint`/`--brand-tint-strong`), visible en claro/oscuro.
- CTA WhatsApp: `background: var(--brand)`, `color: var(--brand-foreground)` (ambas ramas).

## Task 5 — Reemplazar emojis por placeholder
- `item-card.tsx:99`, `item-detail-dialog.tsx:257`, `catalogo-view.tsx:349`, `catalogo-item-view.tsx:169` → `<CatalogoImagePlaceholder name={item.nombre} .../>`.
- `app/catalogo/[slug]/c/[categoriaSlug]/page.tsx:183` (📁) → placeholder con el nombre de la categoría.

## Task 6 — Logo handling
- Logo en hero (ambas ramas): `object-contain` + max-h en contenedor neutro (no recortar anchos). Sin `logoUrl` → `CatalogoImagePlaceholder` con el nombre del local.

## Verificación final
- `npx vitest run` de los 2 tests nuevos → pass.
- `npx tsc --noEmit` → 0 errores. `npx eslint` sobre archivos tocados → 0 warnings.
- `npm run build` → exit 0.
- Manual: hero sin banner con varios brand colors (oscuro/claro/saturado); items/categorías sin foto; logo ancho.
- Review final holístico (delegado).

## Criterios de aceptación: ver spec.
