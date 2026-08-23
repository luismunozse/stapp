// Layout pieces shared by the A4 documents rendered with @react-pdf/renderer.
//
// The split against lib/pdf-react-shared.ts is deliberate: that file holds
// primitives with NO geometry (tokens, safe, fetchLogo, Helvetica metrics,
// truncateToWidth). Anything that draws or positions lives here.
//
// Out of scope by design: the thermal ticket (58/80mm) and ESC/POS. They are
// a different medium — 32 characters wide, no fonts, no layout.
import * as React from "react"
import { View, Text, Image, StyleSheet } from "@react-pdf/renderer"
import {
  MONO,
  TYPE,
  RULE_WIDTH,
  PAGE_WIDTH_A4,
  safe,
  truncateToWidth,
  type PdfLogo,
  type HelveticaMetrics,
} from "./pdf-react-shared"

/** The one wording. Previously written three different ways across engines. */
export const LEYENDA_NO_FISCAL = "Documento no válido como comprobante fiscal"

/** Footer variant: names the document, then the legend. */
export const leyendaPie = (documento: string) =>
  `${documento} — no válido como comprobante fiscal.`

// ===========================================================================
// Header geometry
//
// Two headers share this code and they are NOT the same shape. The remito
// carries a fiscal letter box straddling the frame's top border plus a
// centered legend under it; the recibo/resumen carry neither, so nothing
// sits in the middle of their header and their left zone is wider. Every
// constant below is annotated with where its number comes from — these were
// derived empirically (some from measured render positions) and stripping
// the derivations turns this block into magic numbers nobody can safely
// change later.
// ===========================================================================

// === LOGO ===
// fetchLogo lives in lib/pdf-react-shared.ts. It was ported from
// generateFacturaPDFLegacy's LOGO block (lib/pdf.ts) and keeps legacy's
// try/catch degrade-to-no-logo guarantee. Unlike legacy, it does NOT decode
// pixel dimensions: the component reserves a FIXED box (LOGO_BOX_WIDTH x
// LOGO_BOX_HEIGHT below) and lets react-pdf's own objectFit:"contain"
// preserve the image's aspect ratio inside it, so the left-zone offset the
// clamp budget depends on is a known constant instead of varying per image.

// Logo box — matches legacy's max ~50pt tall / ~80pt wide proportions
// (generateFacturaPDFLegacy's `maxLogoHeight`/`maxLogoWidth`), fixed rather
// than scaled per-image (see the LOGO comment above). LOGO_GAP mirrors
// legacy's "+15" gap between the logo and the company text
// (`logoWidth = scaledWidth + 15`). Both documents reserve the same box, so
// an org printing them side by side gets its headers lined up.
const LOGO_BOX_WIDTH = 80
const LOGO_BOX_HEIGHT = 50
const LOGO_GAP = 15

// === Left-zone truncation clamp (letter box vs. header text) ===
// Ported from generateFacturaPDFLegacy's clampLeftZoneText (lib/pdf.ts).
// truncateToWidth + helveticaMetrics are shared (lib/pdf-react-shared.ts);
// the budget they are applied to is derived below, per header shape.

// Left-zone x-origin and letter-box budget. Mirrors legacy's
// `leftX = frameLeft + innerPad + logoWidth` and
// `leftZoneMaxWidth = letterBoxX - 10 - leftX` (lib/pdf.ts), but derived
// from THIS component's own layout instead of legacy's pdf-lib coordinates:
//   - LEFT_ZONE_X: the page's paddingLeft (40) + estilosShell.frameInner's
//     padding (10) — the left zone's content starts right after the frame's
//     own padding, same as legacy's frameLeft(=margin) + innerPad. Both
//     documents use the same page padding, so this is shared.
//   - LETTER_BOX_X: the letter box (estilosShell.letterBox, LETTER_BOX_WIDTH)
//     is centered on the full A4 page width (595.28pt — @react-pdf/layout's
//     PAGE_SIZES.A4[0]) via letterBoxWrap's alignItems:'center' over a
//     left:0/right:0 span — same value as legacy's
//     `(width - letterBoxWidth) / 2` because both frames sit on symmetric
//     40pt page margins.
//   - LETTER_BOX_GAP: the 10pt clearance legacy's clampLeftZoneText leaves
//     before the letter box.
// Budget shrinks by LOGO_BOX_WIDTH + LOGO_GAP when a logo is present,
// because the left zone's text column is pushed right by that much (see
// estilosShell.leftZoneLogo below).
const LEFT_ZONE_X = 40 + 10
const LETTER_BOX_GAP = 10
const LETTER_BOX_WIDTH = 34
const LETTER_BOX_X = PAGE_WIDTH_A4 / 2 - LETTER_BOX_WIDTH / 2

// Legend under the letter box ("Documento no válido..."), centered on the
// FULL page width via estilosShell.legendWrap below — mirrors legacy's own
// legend-aware clamp (lib/pdf.ts's clampLeftZoneText + glyphBandsIntersect).
// At TYPE.fine (6.5), LEYENDA_NO_FISCAL measures ~135pt wide, so its own left
// edge (~230pt, page-center minus half its width) sits FURTHER LEFT than the
// letter-box-only budget's boundary (~270-280pt, depending on logo) — a
// left-zone line that clears the letter box can still run into the legend
// if the two sit in the same page row.
//
// Row geometry (measured via extractReactPdfTextPositions against the actual
// render, task-5 fix — react-pdf computes line height from the font's own
// metrics, not a simple multiplier, so this isn't a closed-form derivation
// like legacy's fixed "12pt per row" pdf-lib stepping, but the empirical
// result is the same shape): row 1 (company name, TYPE.body bold) sits clear
// above the legend's row by ~4pt — NEVER truncate it tighter. Row 2 —
// whichever of Tel/dirección/domicilio is the FIRST one present, since the
// other two are conditionally omitted and the remaining ones shift up to fill
// the gap — lands only ~2pt from the legend's own baseline, well within both
// lines' glyph heights: it visibly overlaps. Row 3+ clears the legend again
// by a full row-step (~11pt). Because which field ends up in row 2 depends on
// which optional org fields are set, the tighter legend-aware budget is
// applied uniformly to all three conditional left-zone lines rather than
// tracked per row position — always safe, since the legend is wider than the
// letter box so its left edge is always the tighter of the two constraints.
// That split is why presupuestoZonaIzquierda takes a `fila`: collapsing both
// rows onto the tight budget silently truncates company names measuring
// between the two boundaries on a live document.

// Right-zone sizing — the `zonaDerecha` axis, independent of the letter box:
//   - CONTENT_WIDTH: the A4 page minus both 40pt margins, minus the frame's
//     own border on each side, minus frameInner's padding on each side.
//   - RIGHT_ZONE_WIDTH: the pinned width of a "fija" right zone, sized for
//     the widest line it can hold. A document pins it when its right zone's
//     content is predictable (a recibo tops out at CUIT + condición IVA);
//     it leaves the zone "auto" when the zone carries more identity lines
//     than that. The remito is "auto" because pinning it to 190pt squeezes
//     the left zone until yoga shrinks the reserved logo box itself, from
//     80pt to ~49pt, and re-wraps company names that fit today (measured
//     against the pre-refactor render).
//   - HEADER_GAP: the left zone's own paddingRight when the right zone is
//     pinned — the budget subtracts exactly what the style reserves.
const RIGHT_ZONE_WIDTH = 190
const HEADER_GAP = 14
const CONTENT_WIDTH = PAGE_WIDTH_A4 - 40 - 40 - RULE_WIDTH * 2 - 10 * 2

/**
 * How the header splits its width. "fija" pins the right zone to
 * RIGHT_ZONE_WIDTH; "auto" lets it size to its own content. Required, never
 * defaulted: it is the axis a migrating document is most likely to get wrong
 * by inheriting someone else's header.
 */
export type ZonaDerecha = "fija" | "auto"

/**
 * Truncation budget for the header's left zone, in points.
 *
 * Two INDEPENDENT axes bound it, and a document sets them separately:
 *
 *   - `zonaDerecha`: "fija" pins the right zone to RIGHT_ZONE_WIDTH, which
 *     bounds the left zone from the right by a constant. "auto" lets the
 *     right zone size to its own content, so it contributes no constant.
 *   - `letterBox`: the box bounds the left zone from the middle, and the
 *     legend underneath it bounds every row below the company name — at
 *     TYPE.fine the legend measures ~135pt, so its left edge sits further
 *     left than the box's. `fila` picks which of the two applies.
 *
 * They were one flag until the shell's second review: right-zone sizing is a
 * function of what the right zone CARRIES (the remito prints ingresos brutos
 * and inicio de actividades, a recibo does not), never of whether a fiscal
 * box happens to be drawn. Folding them together would hand the first later
 * document that wants a boxed header with a pinned right zone a third style
 * pair instead of a combination that already works.
 *
 * Shrinks by the logo box plus its gap when a logo is present, because the
 * text column is pushed right by exactly that much.
 */
export function presupuestoZonaIzquierda({
  logo,
  letterBox,
  zonaDerecha,
  metrics,
  fila = "datos",
}: {
  logo: boolean
  letterBox: boolean
  zonaDerecha: ZonaDerecha
  metrics: HelveticaMetrics
  /** "nombre" = the company-name row, which clears the legend. */
  fila?: "nombre" | "datos"
}): number {
  const anchoLogo = logo ? LOGO_BOX_WIDTH + LOGO_GAP : 0
  const x = LEFT_ZONE_X + anchoLogo

  // Collect every bound that actually applies and let the tightest win. The
  // two axes are independent: a pinned right zone bounds the left zone from
  // the right, a letter box bounds it from the middle, and a document may
  // have either, both or neither. The frame's own inner width is the floor
  // case, for a header with no competitor at all.
  const topes = [CONTENT_WIDTH - anchoLogo]

  if (zonaDerecha === "fija") topes.push(CONTENT_WIDTH - RIGHT_ZONE_WIDTH - HEADER_GAP - anchoLogo)

  if (letterBox) {
    topes.push(LETTER_BOX_X - LETTER_BOX_GAP - x)
    // The company-name row sits above the legend's row and only has to clear
    // the box; every row under it also has to clear the legend.
    if (fila !== "nombre") {
      const anchoLeyenda = metrics.regular.widthOfTextAtSize(LEYENDA_NO_FISCAL, TYPE.fine)
      topes.push(PAGE_WIDTH_A4 / 2 - anchoLeyenda / 2 - LETTER_BOX_GAP - x)
    }
  }

  return Math.min(...topes)
}

export type EmisorData = {
  nombreEmpresa?: string | null
  telefonoEmpresa?: string | null
  direccionEmpresa?: string | null
  domicilioFiscalEmpresa?: string | null
  cuitEmpresa?: string | null
  condicionIvaEmpresa?: string | null
  ingresosBrutosEmpresa?: string | null
  inicioActividadesEmpresa?: string | null
  logoUrl?: string | null
}

export type ClienteData = {
  nombre?: string | null
  dni?: string | null
  telefono?: string | null
  email?: string | null
  direccion?: string | null
}

/** What every A4 document's data type extends. */
export type DocumentoBase = EmisorData & {
  cliente: ClienteData
  moneda?: string | null
  zonaHoraria?: string | null
  sucursalNombre?: string | null
  atendidoPor?: string | null
}

/** Cliente detail lines BandaCliente can print, by field name. */
export type CampoCliente = "dni" | "telefono" | "email" | "direccion"

// Named `estilosShell` and exported from the start: Tasks 4-7 add to this same
// object, and documents compose their own rows against it.
export const estilosShell = StyleSheet.create({
  footer: { position: "absolute", bottom: 40, left: 40, right: 40 },
  footerRule: { borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.rule },
  footerDisclaimer: { fontSize: TYPE.fine, color: MONO.faint, marginTop: 8 },
  footerRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  footerFine: { fontSize: 7, color: MONO.faint },
  footerPageNum: { fontSize: TYPE.small, color: MONO.faint },
  hr: { borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.rule },
  sectionLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: TYPE.sectionLabel,
    color: MONO.label,
    textTransform: "uppercase",
  },
  seccion: { marginTop: 14 },
  seccionBody: { marginTop: 8 },
  filaDetalle: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: RULE_WIDTH,
    borderBottomColor: MONO.rule,
    paddingVertical: 3,
  },
  filaLabel: { fontSize: TYPE.body, color: MONO.label },
  filaValor: { fontSize: TYPE.body, textAlign: "right" },
  barraTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: MONO.totalBg,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 4,
  },
  barraLabel: { fontFamily: "Helvetica-Bold", fontSize: TYPE.total },
  barraValor: { fontFamily: "Helvetica-Bold", fontSize: TYPE.total },
  badge: { borderWidth: 0.75, borderColor: MONO.ink, paddingHorizontal: 5, paddingVertical: 3.5, alignSelf: "flex-start" },
  badgeText: { fontFamily: "Helvetica-Bold", fontSize: 7 },

  // === Header ===
  // PAINT POINT #1 (letter-box straddle): the classic remito's letter box (X)
  // straddles the outer frame's top border — half above, half below. In
  // pdf-lib this is one absolute rectangle at a hardcoded y. In react-pdf we
  // get it via position:'absolute' + a negative `top` on a child of the frame
  // itself (not the padded content wrapper) — actually LESS code than
  // pdf-lib's version, since we don't need to separately compute frameTop: the
  // offset is relative to the frame's own border, guaranteed aligned by flex
  // flow. Centering is `alignItems:'center'` on a full-width wrapper instead
  // of pdf-lib's manual `(width - letterBoxWidth) / 2` text-width math — a
  // genuine win.
  frame: {
    borderWidth: RULE_WIDTH,
    borderColor: MONO.ink,
    position: "relative", // anchor for the straddling letter box below
  },
  frameInner: { padding: 10 },
  headerRow: { flexDirection: "row", justifyContent: "space-between" },
  // Two left/right zone pairs, keyed to the `zonaDerecha` axis — NOT to the
  // letter box, which only owns the box, the legend and the centerGutter:
  //   - *Fija: the right zone is pinned to RIGHT_ZONE_WIDTH and the left
  //     zone reserves HEADER_GAP, the same gap the budget subtracts.
  //   - *Auto: the right zone sizes to its content, so the left zone needs
  //     only a hairline of separation from whatever sits beside it.
  leftZoneDerechaFija: { flex: 1, paddingRight: HEADER_GAP, flexDirection: "row", alignItems: "flex-start" },
  leftZoneDerechaAuto: { flex: 1, paddingRight: 4, flexDirection: "row", alignItems: "flex-start" },
  // Fixed reservation (LOGO_BOX_WIDTH/HEIGHT/GAP) — objectFit "contain" keeps
  // the actual image's own aspect ratio inside this box without react needing
  // to know its pixel dimensions up front.
  leftZoneLogo: { width: LOGO_BOX_WIDTH, height: LOGO_BOX_HEIGHT, marginRight: LOGO_GAP, objectFit: "contain" },
  leftZoneText: { flexDirection: "column" },
  centerGutter: { width: 180 }, // reserves room under the letter box/legend
  rightZoneFija: { width: RIGHT_ZONE_WIDTH, alignItems: "flex-end" },
  rightZoneAuto: { alignItems: "flex-end" },
  companyName: { fontFamily: "Helvetica-Bold", fontSize: TYPE.body },
  smallLabel: { fontSize: TYPE.small, color: MONO.label, marginTop: 2 },
  smallLabelRight: { fontSize: TYPE.small, color: MONO.label, marginTop: 2, textAlign: "right" },
  docTitle: { fontFamily: "Helvetica-Bold", fontSize: TYPE.docTitle },
  docNumber: { fontFamily: "Helvetica-Bold", fontSize: TYPE.docNumber, marginTop: 2 },
  letterBoxWrap: { position: "absolute", top: -15, left: 0, right: 0, alignItems: "center" },
  letterBox: {
    width: LETTER_BOX_WIDTH,
    height: 30,
    borderWidth: RULE_WIDTH,
    borderColor: MONO.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  letterBoxText: { fontFamily: "Helvetica-Bold", fontSize: 20 },
  legendWrap: { position: "absolute", top: 21, left: 0, right: 0, alignItems: "center" },
  legendText: { fontSize: TYPE.fine, color: MONO.label },

  // === Cliente band ===
  // clienteLeft's paddingRight is a per-document value, not a house constant:
  // `nombre` and `email` in this column are NOT length-capped (only the
  // address is), so the column's width decides where a long email wraps.
  // Each document keeps its own via BandaCliente's `espacioDerecha`.
  clienteBand: { flexDirection: "row", justifyContent: "space-between", paddingTop: 6 },
  clienteLeft: { flex: 1 },
  clienteRight: { alignItems: "flex-end" },
  clienteNombre: { fontFamily: "Helvetica-Bold", fontSize: TYPE.body, marginTop: 3 },
})

/**
 * Emisor identity frame shared by every A4 document. The right zone renders
 * whatever identity lines the document wants under its title, so a remito
 * shows its emission dates and a resumen shows its period, without either one
 * owning the emisor block.
 *
 * `children` render INSIDE the frame, below the header rule — that is where
 * the cliente band and any per-document band (condiciones de pago, ...) live.
 * Closing the frame before them would leave them outside its border.
 */
export function Cabecera({
  emisor,
  metrics,
  zonaDerecha,
  logo = null,
  titulo,
  numero,
  lineasDerecha = [],
  letterBox,
  wrap = true,
  children,
}: {
  emisor: EmisorData
  metrics: HelveticaMetrics
  /** How the header splits its width — see ZonaDerecha. Required on purpose. */
  zonaDerecha: ZonaDerecha
  logo?: PdfLogo | null
  titulo: string
  numero?: string
  lineasDerecha?: string[]
  /** Present renders the straddling box with this letter plus the centered legend. */
  letterBox?: string
  /** false keeps the whole frame on one page (the remito's contract). */
  wrap?: boolean
  children?: React.ReactNode
}) {
  const conCaja = Boolean(letterBox)
  // The company name measures against bold metrics (companyName), the rest
  // against regular (smallLabel) — and against a different budget, because
  // only the conditional rows share a page row with the centered legend.
  const presupuestoNombre = presupuestoZonaIzquierda({
    logo: Boolean(logo),
    letterBox: conCaja,
    zonaDerecha,
    metrics,
    fila: "nombre",
  })
  const presupuestoDatos = presupuestoZonaIzquierda({
    logo: Boolean(logo),
    letterBox: conCaja,
    zonaDerecha,
    metrics,
    fila: "datos",
  })
  const clamp = (texto: string) => truncateToWidth(metrics.regular, texto, TYPE.small, presupuestoDatos)

  const nombre = truncateToWidth(
    metrics.bold,
    safe(emisor.nombreEmpresa) || "Servicio Tecnico",
    TYPE.body,
    presupuestoNombre
  )
  const telefono = safe(emisor.telefonoEmpresa)
  const direccion = safe(emisor.direccionEmpresa)
  const domicilio = safe(emisor.domicilioFiscalEmpresa)
  const cuit = safe(emisor.cuitEmpresa)
  const condicionIva = safe(emisor.condicionIvaEmpresa)
  const ingresosBrutos = safe(emisor.ingresosBrutosEmpresa)
  const inicioActividades = safe(emisor.inicioActividadesEmpresa)

  return (
    <View style={estilosShell.frame} wrap={wrap}>
      <View style={estilosShell.frameInner}>
        <View style={estilosShell.headerRow}>
          <View
            style={
              zonaDerecha === "fija" ? estilosShell.leftZoneDerechaFija : estilosShell.leftZoneDerechaAuto
            }
          >
            {logo ? <Image style={estilosShell.leftZoneLogo} src={{ data: logo.data, format: logo.format }} /> : null}
            <View style={estilosShell.leftZoneText}>
              <Text style={estilosShell.companyName}>{nombre}</Text>
              {telefono ? <Text style={estilosShell.smallLabel}>{clamp(`Tel: ${telefono}`)}</Text> : null}
              {direccion ? <Text style={estilosShell.smallLabel}>{clamp(direccion)}</Text> : null}
              {domicilio && domicilio !== direccion ? (
                <Text style={estilosShell.smallLabel}>{clamp(domicilio)}</Text>
              ) : null}
            </View>
          </View>

          {/* Reserves room under the letter box and legend so the right zone
              never slides into them. Only needed when they are drawn. */}
          {conCaja ? <View style={estilosShell.centerGutter} /> : null}

          <View style={zonaDerecha === "fija" ? estilosShell.rightZoneFija : estilosShell.rightZoneAuto}>
            <Text style={estilosShell.docTitle}>{titulo}</Text>
            {/* `undefined` means the document has no number line at all (the
                resumen); an empty string means it has one that happens to be
                blank, which still occupies its row. Collapsing the two shifts
                a numbered document up by the row's 2pt margin. */}
            {numero === undefined ? null : <Text style={estilosShell.docNumber}>{numero}</Text>}
            {lineasDerecha.map((linea, i) => (
              <Text key={i} style={estilosShell.smallLabelRight}>
                {linea}
              </Text>
            ))}
            {cuit ? <Text style={estilosShell.smallLabelRight}>CUIT: {cuit}</Text> : null}
            {ingresosBrutos ? <Text style={estilosShell.smallLabelRight}>Ingresos brutos: {ingresosBrutos}</Text> : null}
            {inicioActividades ? (
              <Text style={estilosShell.smallLabelRight}>Inicio actividades: {inicioActividades}</Text>
            ) : null}
            {condicionIva ? <Text style={estilosShell.smallLabelRight}>{condicionIva.toUpperCase()}</Text> : null}
          </View>
        </View>

        <View style={[estilosShell.hr, { marginTop: 10 }]} />

        {children}
      </View>

      {/* Letter box + legend: absolute, straddling the frame's own top border
          — direct children of `frame`, not `frameInner`, so the -15 offset is
          relative to the actual bordered edge. Last in flow so they paint
          over the header, same as before they moved here. */}
      {letterBox ? (
        <>
          <View style={estilosShell.letterBoxWrap}>
            <View style={estilosShell.letterBox}>
              <Text style={estilosShell.letterBoxText}>{letterBox}</Text>
            </View>
          </View>
          <View style={estilosShell.legendWrap}>
            <Text style={estilosShell.legendText}>{LEYENDA_NO_FISCAL}</Text>
          </View>
        </>
      ) : null}
    </View>
  )
}

/**
 * Cliente band. `campos` names which detail lines to print and in which
 * order, because the documents genuinely disagree: the remito prints the
 * address first and carries the DNI on the right, the cuenta corriente
 * documents lead with the DNI. `derecha` is a free slot for whatever the
 * document pins to the right (a VENTA/ORDEN reference, sucursal, ...).
 */
export function BandaCliente({
  label,
  cliente,
  campos = ["dni", "telefono", "email", "direccion"],
  derecha,
  espacioInferior = 0,
  espacioDerecha,
}: {
  label: string
  cliente: ClienteData
  campos?: CampoCliente[]
  derecha?: React.ReactNode
  /** Bottom padding, for a band followed by another band inside the frame. */
  espacioInferior?: number
  /**
   * Gutter between the cliente column and `derecha`. Required: `nombre` and
   * `email` are not length-capped, so this width decides where a long email
   * wraps — no document may inherit another's value by omission.
   */
  espacioDerecha: number
}) {
  const nombre = safe(cliente?.nombre) || "Consumidor Final"
  const valores: Record<CampoCliente, string> = {
    dni: safe(cliente?.dni) ? `DNI/CUIT: ${safe(cliente?.dni)}` : "",
    telefono: safe(cliente?.telefono) ? `Tel: ${safe(cliente?.telefono)}` : "",
    email: safe(cliente?.email),
    direccion: safe(cliente?.direccion),
  }

  return (
    <View style={[estilosShell.clienteBand, { paddingBottom: espacioInferior }]}>
      <View style={[estilosShell.clienteLeft, { paddingRight: espacioDerecha }]}>
        <Text style={estilosShell.sectionLabel}>{label}</Text>
        <Text style={estilosShell.clienteNombre}>{nombre}</Text>
        {campos.map((campo) =>
          valores[campo] ? (
            <Text key={campo} style={estilosShell.smallLabel}>
              {valores[campo]}
            </Text>
          ) : null
        )}
      </View>
      {derecha ? <View style={estilosShell.clienteRight}>{derecha}</View> : null}
    </View>
  )
}

export function Seccion({ titulo, children }: { titulo: string; children?: React.ReactNode }) {
  return (
    <View style={estilosShell.seccion}>
      <Text style={estilosShell.sectionLabel}>{titulo}</Text>
      <View style={estilosShell.seccionBody}>{children}</View>
    </View>
  )
}

export function FilaDetalle({ label, valor }: { label: string; valor: string }) {
  return (
    <View style={estilosShell.filaDetalle}>
      <Text style={estilosShell.filaLabel}>{label}</Text>
      <Text style={estilosShell.filaValor}>{valor}</Text>
    </View>
  )
}

export function BarraTotal({ label, valor }: { label: string; valor: string }) {
  return (
    <View style={estilosShell.barraTotal} wrap={false}>
      <Text style={estilosShell.barraLabel}>{label}</Text>
      <Text style={estilosShell.barraValor}>{valor}</Text>
    </View>
  )
}

export function Badge({ texto }: { texto: string }) {
  return (
    <View style={estilosShell.badge}>
      <Text style={estilosShell.badgeText}>{texto}</Text>
    </View>
  )
}

export function Pie({ leyenda, fechaImpresion }: { leyenda: string; fechaImpresion: string }) {
  return (
    <View style={estilosShell.footer} fixed>
      <View style={estilosShell.footerRule} />
      <Text style={estilosShell.footerDisclaimer}>{leyenda}</Text>
      <View style={estilosShell.footerRow}>
        <Text style={estilosShell.footerFine}>Impreso: {fechaImpresion}</Text>
        <Text
          style={estilosShell.footerPageNum}
          render={({ pageNumber, totalPages }) => (totalPages > 1 ? `Página ${pageNumber} de ${totalPages}` : "")}
        />
      </View>
    </View>
  )
}
