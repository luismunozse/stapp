# Mobile UX Audit — STApp

Stack: Next.js 16 · React 18 · Tailwind 3.4 · Radix · Capacitor 8 (Android) · PWA.
Surfaces: webapp at `stapp.com.ar`, tenant subdomains (`*.stapp.com.ar`), public `/catalogo`, `/seguimiento`, Android wrapper.

**Foundation already good.** App ships with bottom nav, drawer, safe-area utilities, touch-target floor, viewport meta, PWA + Capacitor. Audit below targets remaining friction and groups fixes into 10 PRs ordered by ROI.

Notation: `path:line` references file at the time of audit (branch `main`, commit `5431cac`).

---

## PR-1 — Form primitive: iOS zoom fix + 16px floor (P0, ~30 min)

**Single highest-leverage change.** Every form input/textarea/select inherits `text-sm` (14px) from the base primitive. iOS Safari zooms the viewport on focus whenever the focused field's computed font-size < 16px. Currently triggers on ~54 forms. Visible as "page jumps when I tap a field".

Files:
- [`components/ui/input.tsx:13`](components/ui/input.tsx#L13) — default `text-sm`
- [`components/ui/textarea.tsx:12`](components/ui/textarea.tsx#L12) — default `text-sm`
- [`components/ui/select.tsx:22`](components/ui/select.tsx#L22) — `SelectTrigger` default `text-sm`

Fix: change default to `text-base sm:text-sm` (16px on mobile, 14px on `≥640px`). Applies retroactively to all 54 forms — no per-form change needed.

Verify after: focus any input on iOS Safari real device or `webkit-prefers` emulator. No zoom.

---

## PR-2 — Dialog/Popover/Sheet mobile-first widths + safe-area (P0, ~2 h)

Radix Dialog default in [`components/ui/dialog.tsx:61`](components/ui/dialog.tsx#L61) sets `w-full max-w-lg` — fine, but consumers add desktop sizes (`sm:max-w-3xl`) without locking the mobile width, so dialogs without `sm:` prefix overflow < 384px.

### Build new primitive: `components/ui/sheet.tsx`

There is **no Sheet primitive**. `components/catalogo-public/cart-drawer.tsx` rolls its own. Build a Radix-Dialog-backed `Sheet` (side="bottom" or "right") with safe-area-aware padding. Re-export from `components/ui`.

### Default constraints

[`components/ui/dialog.tsx:61`](components/ui/dialog.tsx#L61):
- Add `max-h-[100dvh]`, `pb-[env(safe-area-inset-bottom,16px)]` to content
- Wrap content scroll in `overflow-y-auto` so header/footer stay pinned
- Add `data-vaul-drawer` semantics if you adopt Vaul later

[`components/ui/popover.tsx:24`](components/ui/popover.tsx#L24): default `w-72` (288px) clips on 320px screens. Change to `w-[min(18rem,calc(100vw-2rem))]`.

[`components/ui/dropdown-menu.tsx:19`](components/ui/dropdown-menu.tsx#L19): default `w-56`. Add `align="end"` clipping guard via `collisionPadding={16}` on `DropdownMenuContent`.

### Per-file fixes (P0 overflowers)

| File | Line | Issue | Fix |
|------|------|-------|-----|
| `components/clientes/clientes-segmentacion.tsx` | 72 | `sm:max-w-5xl` no mobile cap | `max-w-[calc(100vw-2rem)] sm:max-w-5xl` |
| `components/configuracion/label-templates-manager.tsx` | 335 | `max-w-4xl` always | `max-w-[calc(100vw-2rem)] sm:max-w-4xl` |
| `components/catalogo-public/item-detail-dialog.tsx` | 194 | `max-w-2xl` always + tall image | `w-full sm:max-w-2xl`, cap image `max-h-[55dvh]` |
| `components/catalogo-public/cart-drawer.tsx` | 176, 192 | drawer no `pb-[env(safe-area-inset-bottom)]` | add `pb-[env(safe-area-inset-bottom,1rem)]` to scroll wrapper |
| `components/ventas/venta-form.tsx` | 446 | long form `max-h-[90vh]`, footer unreachable | flex column, sticky footer, `pb-[env(safe-area-inset-bottom)]` |
| `components/ventas/venta-edit-form.tsx` | 236 | same | same |
| `components/ventas/garantias-ventas-panel.tsx` | 50 | table inside `sm:max-w-4xl` no mobile cap | `w-[calc(100vw-1rem)] sm:max-w-4xl` |
| `components/inventario/quick-stock-adjust.tsx` | 107 | popover `w-64` clips at right edge | `w-[min(16rem,calc(100vw-2rem))]` |
| `components/notifications/notification-bell.tsx` | 37 | `w-80` full bleed | `w-[calc(100vw-2rem)] sm:w-80` |
| `components/billing/upgrade-modal.tsx` | 148 | `p-0 sm:max-w-[540px]` content edge crush | `p-4 sm:p-0` outer wrap, keep inner CTA padded |
| `components/whats-new-modal.tsx` | 70 | no safe-area | add `pb-[env(safe-area-inset-bottom)]` |
| `components/nps-survey.tsx` | 69 | `sm:max-w-md` no mobile cap | `max-w-[calc(100vw-2rem)] sm:max-w-md` |
| `components/chatbot/chatbot-panel.tsx` | 154-155 | `fixed bottom-6` no safe-area | `pb-[max(1.5rem,env(safe-area-inset-bottom))]` |
| `components/cookie-consent.tsx` | 115 | `fixed bottom-0` no safe-area | `pb-[env(safe-area-inset-bottom)]` |
| `components/cookie-settings.tsx` | 177 | `fixed bottom-4 right-4` | same |
| `components/offline/offline-banner.tsx` | 12 | `fixed top-0` no safe-area-inset-top | add `pt-[env(safe-area-inset-top)]` |

### Long select → bottom-sheet on mobile (P1)

`Radix Select` popover with >10 items is a poor mobile UX (scrollable popover inside a popover, anchored to a small trigger, easy to dismiss accidentally). Build `SelectMobileSheet` variant that on `(hover: none)` opens a `Sheet` instead of `SelectContent`.

Apply to:
- [`components/inventario/inventario-form.tsx:739`](components/inventario/inventario-form.tsx#L739) (Tipo)
- [`components/inventario/inventario-form.tsx:817`](components/inventario/inventario-form.tsx#L817) (Categoría)
- [`components/cotizaciones/cotizacion-form.tsx:545`](components/cotizaciones/cotizacion-form.tsx#L545) (Tipo dispositivo)
- [`components/ordenes/orden-form.tsx:819`](components/ordenes/orden-form.tsx#L819) (Sector)
- [`components/inventario/inventario-bulk-bar.tsx`](components/inventario/inventario-bulk-bar.tsx) (categoría/proveedor inline)

---

## PR-3 — Capacitor critical fixes (P0, ~1.5 h)

Three blockers in the native Android wrapper. Found via grep — no other file references.

### Hardware back button missing

**No usage of `App.addListener('backButton', ...)` anywhere in the codebase.** Result: tapping the system back button anywhere inside the app (POS mid-sale, deep in `/ordenes/[id]`, inside a Dialog) exits the app entirely.

Fix: add a top-level listener in [`app/(dashboard)/layout.tsx`](app/(dashboard)/layout.tsx) (or a `<CapacitorBackButton/>` client component mounted in `Providers`). Logic:

```ts
import { App } from "@capacitor/app";
useEffect(() => {
  const sub = App.addListener("backButton", ({ canGoBack }) => {
    if (openDialogsRef.current > 0) { /* close top dialog */ return; }
    if (canGoBack) router.back();
    else App.exitApp();
  });
  return () => { sub.then(s => s.remove()); };
}, []);
```

### `capacitor.config.ts` webDir wrong

[`capacitor.config.ts:6`](capacitor.config.ts#L6) sets `webDir: 'public'`. Next.js builds to `.next/`. The current setup works because [`capacitor.config.ts:9`](capacitor.config.ts#L9) uses `server.url: 'https://stapp.com.ar/app-entry'` — i.e. the native shell loads the **remote** site, ignoring `webDir`. That's a valid pattern but should be documented. If you ever flip to bundled mode, this breaks.

Action: add a comment in `capacitor.config.ts` clarifying it's intentionally a remote-loaded shell, and that `webDir` is only consumed if `server.url` is removed.

### Status bar hardcoded white in dark mode

[`capacitor.config.ts:20-23`](capacitor.config.ts#L20) sets `StatusBar.style: 'DARK'` (dark text) + `backgroundColor: '#ffffff'`. In dark theme, status bar text becomes invisible against dark app content.

Fix: subscribe to theme change and call `StatusBar.setStyle({ style: Style.Light })` + `setBackgroundColor({ color: '#0a0a1a' })` when dark. Wire in `components/providers.tsx` or `lib/capacitor.ts`.

### Push notification tap doesn't deep-link

[`hooks/use-push-notifications.ts`](hooks/use-push-notifications.ts) registers token + sends to backend but **never listens for `pushNotificationActionPerformed`**. Tapping a notification just opens the app — doesn't route to the relevant order/ticket.

Fix:
```ts
PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
  const path = action.notification.data?.path;
  if (path) router.push(path);
});
```

### Deep links not configured

[`android/app/src/main/AndroidManifest.xml`](android/app/src/main/AndroidManifest.xml) has no `<intent-filter>` for `https://stapp.com.ar/*` or a custom `stapp://` scheme. Means WhatsApp share links / email CTAs open in browser instead of the app.

Action: add app-links intent-filter + host `assetlinks.json` at `public/.well-known/assetlinks.json`. Reference: https://developer.android.com/training/app-links.

### Splash race condition

[`capacitor.config.ts:13-18`](capacitor.config.ts#L13) `launchShowDuration: 2000` + `launchAutoHide: true`. If app boots in 500ms, user stares at splash for 1.5s. If auth flow needs 3s, splash hides early and user sees blank.

Fix: set `launchAutoHide: false`, call `SplashScreen.hide()` explicitly after the first authenticated render (or after `/app-entry` resolves).

### `safe-area-bottom` class used but not defined

[`components/pos/pos-terminal.tsx:624`](components/pos/pos-terminal.tsx#L624), [`components/pos/pos-terminal.tsx:667`](components/pos/pos-terminal.tsx#L667), and at least 4 other files reference `.safe-area-bottom`. [`app/globals.css:445`](app/globals.css#L445) only defines `.safe-bottom`. **Class silently does nothing.**

Fix: add `.safe-area-bottom { padding-bottom: env(safe-area-inset-bottom, 0px); }` in globals.css, OR replace all `safe-area-bottom` → `safe-bottom`.

### `isNativePlatform()` branches missing in PWA banner

[`components/pwa/pwa-installer.tsx:17`](components/pwa/pwa-installer.tsx#L17) hides correctly inside native — verified. But verify [`components/pos/pos-terminal.tsx`](components/pos/pos-terminal.tsx) and any "install our app" CTA also gate on `isNativePlatform()`.

---

## PR-4 — Viewport units (`dvh`) + body overflow (P1, ~30 min)

iOS Safari and Android Chrome resize the visual viewport when the URL bar appears/hides. `100vh` snapshots the largest viewport, causing content to be cut off below the fold when the URL bar is visible.

Replace `min-h-screen` → `min-h-dvh` (dynamic viewport height) globally. 45 occurrences:

**Auth pages** (most critical, user's first impression):
- [`app/(auth)/login/page.tsx:350,370,580`](app/(auth)/login/page.tsx#L350)
- [`app/(auth)/registro/page.tsx:281`](app/(auth)/registro/page.tsx#L281)
- [`app/(auth)/forgot-password/page.tsx:48,82`](app/(auth)/forgot-password/page.tsx#L48)
- [`app/(auth)/reset-password/[token]/page.tsx:73,103`](app/(auth)/reset-password/[token]/page.tsx#L73)
- [`app/(auth)/verificar-email/page.tsx:89,203`](app/(auth)/verificar-email/page.tsx#L89)
- [`app/superadmin-login/page.tsx:130,150,242`](app/superadmin-login/page.tsx#L130)
- [`app/google-auth/page.tsx:52,151,227`](app/google-auth/page.tsx#L52)

**Marketing/empresa**: `app/empresa/sobre-nosotros/page.tsx`, `app/empresa/contacto/page.tsx`, `app/empresa/blog/page.tsx`, `app/empresa/trabaja-con-nosotros/page.tsx`, `app/descargar/android/page.tsx`, `app/tenant-not-found/page.tsx`, `app/error.tsx`, `app/global-error.tsx:18` (inline `100vh` → `100dvh`).

**Superadmin** (full-height shell): [`app/superadmin/layout.tsx:23,26`](app/superadmin/layout.tsx#L23) uses `h-screen` + `overflow-hidden` — flip to `h-dvh`.

**Catalogo público**: 2 occurrences.

**Manual de uso**: [`app/ayuda/manual/page.tsx:1127`](app/ayuda/manual/page.tsx#L1127) `max-h-[calc(100vh-9rem)]` → `max-h-[calc(100dvh-9rem)]`.

### Body `overflow-x: hidden`

[`app/globals.css:264`](app/globals.css#L264) sets `body { overflow-x: hidden }`. This masks underlying overflow bugs and prevents intentional horizontal scroll (chip rows, tab strips). Audit each overflow source individually; in most cases the fix is `max-w-full` on the offending child, not a body-level mute.

Suggested replacement: remove the body rule, add `[&]:overflow-x-hidden` selectively to dashboard layout root if needed.

---

## PR-5 — Input keyboard hints (P1, ~1 h)

Pure additive changes — no UI shift, no breaking changes. Pays off immediately.

### `inputmode="decimal"` on currency

Currency fields currently `type="number"` (which on Android opens a weird non-decimal keypad, and on Safari shows up/down arrows that nobody uses for money). Better: `type="text" inputmode="decimal"`.

- [`components/cotizaciones/cotizacion-form.tsx:829,833,836,667,684,704`](components/cotizaciones/cotizacion-form.tsx#L829)
- [`components/ordenes/orden-form.tsx:1066,1134`](components/ordenes/orden-form.tsx#L1066) (presupuesto, seña)
- [`components/inventario/inventario-form.tsx:872,889,946,958,970`](components/inventario/inventario-form.tsx#L872)
- [`components/pagos/multi-pago-input.tsx:145-200`](components/pagos/multi-pago-input.tsx#L145)
- [`components/caja/apertura-dialog.tsx`](components/caja/apertura-dialog.tsx), `cierre-dialog.tsx`, `movimiento-manual-form.tsx`
- [`components/facturacion/pago-form.tsx`](components/facturacion/pago-form.tsx)
- [`components/pos/pos-checkout-dialog.tsx:336`](components/pos/pos-checkout-dialog.tsx#L336)
- [`components/catalogo/catalogo-item-dialog.tsx`](components/catalogo/catalogo-item-dialog.tsx) (3 precio inputs)

### `inputmode="tel"` on phone

- [`components/clientes/cliente-form.tsx:251`](components/clientes/cliente-form.tsx#L251)
- [`components/ordenes/orden-form.tsx:1312`](components/ordenes/orden-form.tsx#L1312)
- `components/tecnicos/tecnico-form.tsx`, `components/vendedores/vendedor-form.tsx`, `components/proveedores/proveedor-form.tsx`, `components/agenda/turno-form-dialog.tsx`, `components/catalogo-public/cart-drawer.tsx`

### `inputmode="email"` on email

Same set + auth pages.

### `inputmode="numeric"` on DNI/CUIT

- [`components/clientes/cliente-form.tsx:234,283`](components/clientes/cliente-form.tsx#L234)
- Anywhere `dni`/`cuit`/`stock` integers appear.

### `type="search"` on search inputs

Gives iOS/Android a native clear-X button and a "Search" return key.

- [`components/shared/global-search.tsx`](components/shared/global-search.tsx)
- [`components/superadmin/global-search.tsx`](components/superadmin/global-search.tsx)
- [`components/pos/pos-product-search.tsx:223`](components/pos/pos-product-search.tsx#L223) (currently `type="number"` — wrong)
- `components/catalogo-public/catalogo-filters.tsx`

### `autocomplete` on auth/profile forms

- [`app/(auth)/login/page.tsx`](app/(auth)/login/page.tsx): email → `autocomplete="email"`, password → `autocomplete="current-password"`
- [`app/(auth)/registro/page.tsx`](app/(auth)/registro/page.tsx): password → `autocomplete="new-password"`, name → `autocomplete="name"`
- `components/clientes/cliente-form.tsx`: email/phone/name/address → respective `autocomplete` tokens
- `components/perfil/*-form.tsx`: same

---

## PR-6 — Touch feedback states (P1, ~2 h)

Hover-only interactive elements feel dead on touch. Codebase has 474 `hover:` instances and only 13 `active:` (36:1 ratio).

### Base button (biggest win)

[`components/ui/button.tsx`](components/ui/button.tsx) variants currently define hover only. Add to every variant: `active:scale-[0.98] active:brightness-95 transition-transform`. Single-file change ripples through every button in the app.

### Nav links

[`components/layout/navbar.tsx`](components/layout/navbar.tsx):
- Line 328 (logo `Link`): add `active:opacity-60`
- Line 412-426 (sidebar `Link`): add `active:bg-sidebar-accent/80`
- Line 530-550 (mobile header icon buttons): already have `touch-target`, add `active:bg-accent/60`
- Line 580-595 (drawer items): already have `active:scale-[0.98] active:bg-accent/80` ✓
- Line 626-642 (bottom-nav links): already have `active:scale-95` ✓

### Card clickables

`components/dashboard/quick-actions.tsx`, `components/dashboard/ordenes-recientes.tsx`, `components/clientes/clientes-list.tsx` (mobile cards), `components/ordenes/orden-mobile-card.tsx`, `components/ventas/venta-mobile-card.tsx` — add `active:opacity-80 active:scale-[0.99]` to the card root.

### Tap delay

Already mitigated by `viewport.maximumScale = 5` (no 300ms click delay since iOS 9.3). Verify no `cursor-pointer` is being misused as the only affordance.

---

## PR-7 — Mobile-only patterns (P1, ~3 h)

New primitives that bring native-app polish to the PWA. Reusable across all forms.

### Sticky form action bar

Long forms ([`ordenes/orden-form.tsx`](components/ordenes/orden-form.tsx), [`inventario/inventario-form.tsx`](components/inventario/inventario-form.tsx), [`cotizaciones/cotizacion-form.tsx`](components/cotizaciones/cotizacion-form.tsx)) put Save at the very bottom — user must scroll past 30+ fields on mobile. Provide `<FormActionBar />` component:

```tsx
<div className="sticky bottom-0 -mx-4 px-4 py-3 bg-background/95 backdrop-blur border-t flex gap-2 justify-end pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:bg-transparent sm:border-0 sm:mx-0 sm:px-0 sm:py-0 sm:backdrop-blur-none">
  <Button type="button" variant="outline">Cancelar</Button>
  <Button type="submit">Guardar</Button>
</div>
```

Apply to: `orden-form.tsx:1588`, `inventario-form.tsx:1132`, `cotizacion-form.tsx:972`, `cliente-form.tsx:304`, `proveedor-form.tsx`, `tecnico-form.tsx`, `vendedor-form.tsx`.

### Mobile date picker

[`components/ui/date-picker.tsx:91`](components/ui/date-picker.tsx#L91) uses `react-day-picker` inside a Popover — desktop-shaped, hard to use on a 320px screen. Detect touch (`window.matchMedia("(hover: none)").matches`) and swap to native `<input type="date">` on touch devices. Keep the popover variant for desktop (better for date-range selection).

Affected pickers: [`orden-form.tsx:1077`](components/ordenes/orden-form.tsx#L1077), [`cotizacion-form.tsx:936`](components/cotizaciones/cotizacion-form.tsx#L936), plus all reports / agenda filters.

### Step indicators visible on mobile

[`components/ordenes/orden-form.tsx:790`](components/ordenes/orden-form.tsx#L790) hides step labels with `hidden sm:inline`. On mobile user only sees numbered circles → no clue what step 3 is about. Replace with abbreviated label or current-step pill: `Paso 2/4 · Diagnóstico`.

### Pull-to-refresh hook

Native app users expect it. Build `usePullToRefresh()` for list pages (`/ordenes`, `/clientes`, `/inventario`). Use Pointer Events + `overscroll-behavior: contain` on the scroll root. Wire to mutate SWR.

### FAB for primary action

On `/ordenes`, `/clientes`, `/inventario`, `/cotizaciones`, `/ventas` the "New" action sits in a desktop toolbar. On mobile it's offscreen or competes with filters. Add a Floating Action Button (`fixed bottom-20 right-4`, above bottom nav + safe-area).

---

## PR-8 — Top-traffic routes verification (P1, ~3 h)

The table-and-list audit found **no critical overflow** — the `hidden sm:table` + `sm:hidden` cards pattern is consistently applied. Polish work only.

### Touch target standardization

Multiple list-row action buttons sit at `h-7 w-7` or `h-8 w-8` (28-32px) which is below the 44px WCAG mobile floor. Already partly enforced via `@media (pointer: coarse) button { min-height: 44px }` in [`globals.css:418`](app/globals.css#L418), but this only sets min-height — width stays small, so icon buttons become tall+narrow.

Fix: extend the rule:
```css
@media (pointer: coarse) {
  button[data-touch-icon],
  [role="button"][data-touch-icon] {
    min-width: 44px;
    min-height: 44px;
  }
}
```
And add `data-touch-icon` to the icon variant in [`components/ui/button.tsx`](components/ui/button.tsx).

Specific offenders worth checking after the global rule:
- [`components/ordenes/ordenes-list.tsx:473-475`](components/ordenes/ordenes-list.tsx#L473) (action row gap-1)
- [`components/clientes/clientes-list.tsx:245-250,321`](components/clientes/clientes-list.tsx#L245)
- [`components/inventario/inventario-list.tsx:507-608,817-833,956`](components/inventario/inventario-list.tsx#L507)
- [`components/proveedores/proveedores-list.tsx:341-375`](components/proveedores/proveedores-list.tsx#L341)
- [`components/facturacion/facturacion-list.tsx:214-265`](components/facturacion/facturacion-list.tsx#L214) — 5-6 action buttons wrap to 2 rows, collapse to a single "⋯" menu on mobile

### Action row → kebab menu on mobile

Where row exposes >3 actions (facturas, cotizaciones), collapse to a `DropdownMenu` triggered by a single 44px button on `<sm`. Keep inline on `sm:`.

### Sticky list headers offset

[`components/facturacion/facturacion-list.tsx:176`](components/facturacion/facturacion-list.tsx#L176) and other table headers need to sit below the 56px mobile top nav. Use `top-14 sm:top-0` or CSS var.

### Filter chip row scroll

`/ordenes` filter chips wrap to 3 rows on mobile. Convert to a single horizontally-scrolling row using `flex overflow-x-auto snap-x snap-mandatory -mx-4 px-4` with `[&::-webkit-scrollbar]:hidden`.

### Missing mobile cards

- [`app/superadmin/organizaciones/[id]/_components/org-users-tab.tsx:139-162`](app/superadmin/organizaciones/[id]/_components/org-users-tab.tsx#L139) — users table has no `sm:hidden` card variant. Build one (low traffic, P2).

---

## PR-9 — POS terminal mobile polish (P1, ~2 h)

POS is the most touch-critical surface. Currently functional but with rough edges.

[`components/pos/pos-terminal.tsx:573-596`](components/pos/pos-terminal.tsx#L573): desktop 2-col, mobile tab bar. Works but cart isn't persistently visible on the product tab. Mitigation already in place via floating cart badge ([line 667](components/pos/pos-terminal.tsx#L667)), but:

- Floating badge at `bottom-20` overlaps the bottom-tab area on notched devices. Bump to `bottom-[calc(5rem+env(safe-area-inset-bottom))]`.
- Tab switching re-renders entire `PosProductSearch` / `PosCart`. Wrap each in `<div style={{ display: tab === 'X' ? 'block' : 'none' }}>` so they stay mounted — preserves search state and scroll position across tab swaps.

[`components/pos/pos-product-search.tsx:223`](components/pos/pos-product-search.tsx#L223): `type="number"` on search input is wrong. → `type="search" inputmode="search"`.

[`components/pos/pos-product-search.tsx:283-312`](components/pos/pos-product-search.tsx#L283): product card grid-cols-2 on mobile gives ~70px wide tap targets w/ `text-clamp-2` hiding stock warnings. Either bump to `grid-cols-1` on `<sm` (list view) or increase min-height and show stock pill before truncation.

[`components/pos/pos-checkout-dialog.tsx:336`](components/pos/pos-checkout-dialog.tsx#L336): cash amount input `type="number"`. → `type="text" inputmode="decimal"`.

[`components/pos/pos-cart.tsx:254-276`](components/pos/pos-cart.tsx#L254): qty +/- buttons need `active:scale-90 active:bg-accent` for tap feedback. Optionally add long-press to accelerate (`useLongPress` with 50ms tick).

[`components/inventario/barcode-scanner.tsx`](components/inventario/barcode-scanner.tsx): camera dialog doesn't check `isNativePlatform()`. On Capacitor Android, `@capacitor/camera` + `Camera.scan` (or the `@capacitor-mlkit/barcode-scanning` plugin) is dramatically faster than the web `getUserMedia` + manual decode. Add native branch.

[`components/pos/pos-terminal.tsx:77-90`](components/pos/pos-terminal.tsx#L77): `/api/notificaciones/config` fetched on every mount. Cache in SWR with `dedupingInterval: 3600_000` or localStorage TTL.

---

## PR-10 — Performance + polish (P2, ~1.5 h)

### Backdrop-blur on low-end Android

34 uses of `backdrop-blur` across the app. On Android 8-9 + Snapdragon 4xx, each one is a paint hot-spot. Critical paths:

- [`components/layout/navbar.tsx:514`](components/layout/navbar.tsx#L514) (mobile header) — keep, but reduce to `backdrop-blur-sm` (4px) which renders ~4x faster than `backdrop-blur` (8px).
- [`components/layout/navbar.tsx:620`](components/layout/navbar.tsx#L620) (bottom nav) — same.
- [`components/agenda/agenda-view.tsx:459,562`](components/agenda/agenda-view.tsx#L459) — during drag, blur causes jank. Disable via `data-dragging` class.

Add fallback CSS:
```css
@media (prefers-reduced-motion: reduce), (max-resolution: 1.5dppx) {
  .backdrop-blur, .backdrop-blur-sm { backdrop-filter: none; background-color: hsl(var(--background)/0.95); }
}
```

### Service Worker quota guard

[`public/sw.js`](public/sw.js) uses IndexedDB across 8 stores for offline-first sync. Capacitor Android WebView has ~50MB quota. No `navigator.storage.estimate()` check anywhere. If user works offline for a week and exceeds quota, writes silently fail.

Add quota probe in [`contexts/offline-context.tsx`](contexts/offline-context.tsx):
```ts
const { usage, quota } = await navigator.storage.estimate();
if (usage / quota > 0.8) showToast("Storage 80% full, sync now");
```

### Photo upload size

[`components/fotos/foto-upload.tsx:36-68`](components/fotos/foto-upload.tsx#L36) uses Capacitor Camera `DataUrl` (base64). For photos >2MB this is a 33% size penalty + JS string blocking the main thread during encode. Use `resultType: CameraResultType.Uri` + `@capacitor/filesystem` `readFile` only for thumbnail; upload the original file directly via `fetch` with multipart.

Also: use [`browser-image-compression`](https://www.npmjs.com/package/browser-image-compression) (already a dep, [`package.json:50`](package.json#L50)) to compress to ≤1MB before upload. Saves user data + speeds upload on slow 3G.

### Spacing on mobile

Marketing pages use `gap-8` / `space-y-8` which wastes vertical space on phones:
- [`app/empresa/sobre-nosotros/page.tsx:95`](app/empresa/sobre-nosotros/page.tsx#L95)
- [`app/empresa/contacto/page.tsx:163`](app/empresa/contacto/page.tsx#L163)
- [`app/descargar/android/page.tsx:45`](app/descargar/android/page.tsx#L45)
- [`app/ayuda/manual/page.tsx:1124`](app/ayuda/manual/page.tsx#L1124)
- [`app/ayuda/page.tsx:450`](app/ayuda/page.tsx#L450)

Change pattern: `gap-8` → `gap-4 md:gap-8`, `space-y-8` → `space-y-4 md:space-y-8`.

### `text-xs` clusters

In data-dense screens (`components/caja/movimientos-manuales-list.tsx`, `components/billing/usage-stats.tsx:73-99`, `components/agenda/turno-detail-sheet.tsx:163-220`) multiple `text-xs` (12px) labels stack. On a 320px screen this is borderline illegible. Add a `text-caption-mobile` utility (`text-[13px] sm:text-xs`) and apply to clusters.

### Bottom nav

[`components/layout/navbar.tsx:138-143`](components/layout/navbar.tsx#L138) — `bottomNavItems` does not include `/pos` for VENDEDOR role despite POS being a primary touch-target route for that role. Reorder by role:
- `ADMIN`: Dashboard · Órdenes · Clientes · Inventario · Más
- `VENDEDOR`: Dashboard · POS · Ventas · Clientes · Más
- `TECNICO`: Dashboard · Órdenes · Agenda · Clientes · Más

Build via `bottomNavByRole` map.

### Mobile header declutter

[`components/layout/navbar.tsx:514-552`](components/layout/navbar.tsx#L514) crams 7 icons into a 14px-tall mobile header: `PlanBadge` + `GlobalSearch` + `DeadlineCalendar` + `NotificationBell` + `ThemeToggle` + `Logout` + `Menu`. Logout duplicates the drawer logout. Theme toggle is a vanity icon. On a 360px iPhone these are ~40px wide each — easy mistap.

Proposed mobile header right-side: **Search · Bell · Avatar(menu trigger)**. Move `PlanBadge` into the drawer header (alongside user info). Move `DeadlineCalendar`, `ThemeToggle`, `Logout` into the drawer. The hamburger button can be the user avatar — same affordance.

---

## Verification matrix

After each PR, manually verify on:

| Device class | Browser | What to check |
|---|---|---|
| iPhone SE (375×667) | Safari | iOS zoom on input focus, safe-area-bottom on home indicator, sticky form action bar |
| iPhone 14 Pro (393×852) | Safari | Notch safe-area-top, status bar style follows theme |
| Pixel 6 (412×915) | Chrome | Bottom nav height under URL bar, `dvh` reflow on URL bar collapse |
| Low-end Android (Moto E, 360×640) | Chrome | `backdrop-blur` jank, scroll smoothness |
| Capacitor Android wrapper | WebView | Hardware back button, status bar dark mode, splash hide, push tap deep link |

Use Chrome DevTools device emulation as smoke test, but **all critical paths (auth, POS checkout, order creation) must be tested on a real device** before merging PR-1, PR-2, PR-3.

---

## Suggested merge order

1. **PR-1** (form font-size) — 1 file, huge UX gain, zero risk.
2. **PR-3** (Capacitor critical) — back button + status bar + safe-area class fix. Native users impacted right now.
3. **PR-2** (Dialogs + Sheet primitive) — unlocks PR-7 patterns. Slightly bigger surface.
4. **PR-4** (`dvh`) — global search/replace. Verify auth flows.
5. **PR-5** (inputmode/autocomplete) — additive, low risk.
6. **PR-6** (active states) — single base-button change + nav touch-ups.
7. **PR-7** (sticky bar, mobile date picker, FAB) — needs Sheet from PR-2.
8. **PR-8** (table action menus, sticky headers).
9. **PR-9** (POS polish).
10. **PR-10** (perf + clutter).

Total est: ~16h focused dev + 4h device QA. Recommend splitting across two sprints, with PR-1/3 shipped within 48h.
