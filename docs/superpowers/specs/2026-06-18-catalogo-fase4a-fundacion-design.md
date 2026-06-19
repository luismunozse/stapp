# Catálogo — Fase 4a: Fundación + first impression

**Fecha:** 2026-06-18
**Estado:** Diseño aprobado, pendiente plan
**Alcance:** Primer slice de la Fase 4 (rediseño del storefront público). Dirección visual aprobada:
**tipográfica + mesh de marca**.

## Contexto

El storefront público tiene interacciones pulidas (animaciones, a11y, micro-interacciones) pero un
shell visual genérico. Lo que se ve "barato" al instante:
- **Hero sin-banner** = página casi blanca (gradiente brand al ~13% → invisible). La mayoría de
  talleres no sube banner.
- **Placeholders emoji** (📦 🛠️ 📁) para items/categorías sin foto — la señal más amateur.
- **Brand color aplicado ancho pero superficial** — inline `style` en cada botón; la CSS var
  `--brand` se setea (`catalogo-view.tsx:260`, `catalogo-item-view.tsx:126`) pero **no se consume**;
  sin tinte de superficies ni chequeo de contraste (un brand claro con texto blanco = invisible).

Este slice establece el **lenguaje visual** (fundación de theming) y arregla la primera impresión.
Los siguientes slices (4b cards, 4c filtros/detalle, 4d checkout/categoría) lo reutilizan.

## Objetivos

1. Fundación de theming brand-led con contraste correcto.
2. Hero sin-banner rediseñado: tipográfico + mesh de marca visible.
3. Sistema de placeholder sin-foto consistente (reemplaza emojis).
4. Logo handling sin recorte.

## Fuera de alcance (otros slices)

- Cards/grid + empty states (4b). Filtros + detalle dialog (4c). Checkout trust + CategoriaHero + footer (4d).
- Refactor de TODOS los `style={{ backgroundColor }}` inline del storefront (se migra por slice; 4a solo el hero).

## Diseño

### 1. Fundación de theming — `lib/catalogo/brand.ts`

`getBrandTheme(hex: string)` → objeto puro:
- `brand`: el hex normalizado (default a un color seguro si el input es inválido).
- `brandForeground`: `"#ffffff"` o un oscuro (`"#1a1a1a"`) según la **luminancia relativa** del brand
  (WCAG): si el brand es claro (luminancia alta) → texto oscuro; si es oscuro → blanco. Resuelve el
  bug de contraste de las CTAs.
- `tint`: el brand a baja alpha para washes de superficie (ej. `${hex}14` ≈ 8%).
- `tintStrong`: alpha media para acentos (ej. `${hex}26` ≈ 15%).
Helpers internos: parse hex (#rgb / #rrggbb) → {r,g,b}; luminancia relativa.

**Consumo de las vars:** donde hoy se setea `--brand` (catalogo-view, catalogo-item-view), setear
también `--brand-foreground`, `--brand-tint`, `--brand-tint-strong` desde `getBrandTheme`. El hero
rediseñado consume estas vars (el resto de componentes se migra en su slice).

### 2. Hero sin-banner — `catalogo-hero.tsx` (rama sin banner)

Reemplazar el `radial-gradient(... ${brandColor}22 ...)` lavado por un **mesh** de varios gradientes
radiales en brand color, visible (no al 8%), con el nombre del local como protagonista:
- Layout: nombre grande (`text-3xl sm:text-5xl font-bold tracking-tight`), tagline debajo, logo a un
  lado, CTAs (WhatsApp + Compartir) debajo o a la derecha.
- Fondo mesh: 2–3 `radial-gradient` en `--brand-tint`/`--brand-tint-strong` en posiciones distintas,
  sobre `bg-background`. Visible pero no satura; legible en claro y oscuro.
- **Auto-contraste**: la CTA de WhatsApp usa `var(--brand)` de fondo y `var(--brand-foreground)` de
  texto (no más `text-white` hardcodeado).
- Mantener `TrustStrip`. La rama **con banner** se conserva (ya es buena); solo se armoniza el botón
  WhatsApp para usar `--brand-foreground`.

### 3. Placeholder sin-foto — `components/catalogo-public/catalogo-image-placeholder.tsx`

Componente presentacional: dado `name` (y opcional `tipo`/`variant`), renderiza un cuadro con el
**monograma** (primera letra alfanumérica del nombre, mayúscula) centrado sobre un tinte del brand
(`--brand-tint`), con el color del monograma en `--brand` o `--brand-foreground` según legibilidad.
Si el nombre está vacío → un ícono neutro (lucide `ImageOff`/`Package`). Acepta `className` para el
contenedor (aspect-square / aspect-video según el caller).
Reemplaza los emojis en: `item-card.tsx:99`, `item-detail-dialog.tsx:257`, `catalogo-view.tsx:349`
(strip recientes), `catalogo-item-view.tsx:169`, y el `📁` del server `app/catalogo/[slug]/c/[categoriaSlug]/page.tsx:183`
(categoría → monograma del nombre de la categoría).

### 4. Logo handling

Donde se renderiza el logo (hero ambas ramas; y donde aplique), usar `object-contain` con
`max-h`/`max-w` en un contenedor de fondo neutro, en vez de `object-cover` que recorta logos anchos a
cuadrado. Si no hay `logoUrl` → usar el `CatalogoImagePlaceholder` con el nombre del local (monograma).

## Testing

- `getBrandTheme` (unidad): contraste (brand oscuro `#1d4ed8` → fg blanco; brand claro `#fde047` →
  fg oscuro), formato de tint (`#rrggbb` + alpha), input inválido → default seguro, soporte `#rgb`.
- `CatalogoImagePlaceholder` (componente): monograma = 1ra letra mayúscula del nombre; nombre vacío →
  no crashea (ícono fallback); respeta `className`.
- Lo visual (mesh, hero, logo) va por `next build` + revisión manual.

## Criterios de aceptación

1. `getBrandTheme` da un `brandForeground` legible para brands claros y oscuros.
2. El hero sin-banner muestra un mesh de marca visible con el nombre del local protagonista; la CTA
   de WhatsApp es legible con cualquier brand color.
3. No quedan emojis 📦/🛠️/📁 como placeholder en el storefront; se usa el monograma.
4. Los logos anchos no se recortan a cuadrado.
5. `tsc` + `eslint` verdes, tests nuevos pasan, `next build` exit 0.

## Roadmap

- **4a (este doc):** fundación + first impression.
- **4b:** cards + grid + empty states.
- **4c:** filtros + detalle.
- **4d:** checkout trust + categoría + footer.
