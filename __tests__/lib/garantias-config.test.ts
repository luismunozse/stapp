import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { PDFFont } from "pdf-lib"
import { supabaseAdmin } from "@/lib/supabase"
import { createChainMock } from "../api/helpers"
import {
  GARANTIA_TERMINOS_MAX,
  bloquesTerminosGarantia,
  configGarantiasDeFila,
  validarConfigGarantias,
  ventanaDeOrg,
} from "@/lib/garantias/config"
import { listarGarantias, parseFiltrosGarantias, resumenGarantiasPorVencer } from "@/lib/garantias/listado"
import { lineasTerminosGarantia, wrapPdfTexto } from "@/lib/pdf"

describe("configuración de garantías de la org (402)", () => {
  it("sin columnas (402 sin correr) usa los defaults: 7 días, sin aviso, sin términos", () => {
    expect(configGarantiasDeFila({ zona_horaria: "America/Argentina/Buenos_Aires" })).toEqual({
      terminos: null,
      ventanaPorVencer: 7,
      avisoVencimiento: false,
    })
    expect(configGarantiasDeFila(null).ventanaPorVencer).toBe(7)
  })

  it("lee la fila: términos limpios, ventana y aviso", () => {
    expect(
      configGarantiasDeFila({
        garantia_terminos: "  No cubre golpes.\r\n  ",
        garantia_ventana_por_vencer_dias: 15,
        garantia_aviso_vencimiento: true,
      })
    ).toEqual({ terminos: "No cubre golpes.", ventanaPorVencer: 15, avisoVencimiento: true })
  })

  it("una ventana fuera de 1..90 o basura cae a 7", () => {
    expect(ventanaDeOrg(0)).toBe(7)
    expect(ventanaDeOrg(91)).toBe(7)
    expect(ventanaDeOrg("abc")).toBe(7)
    expect(ventanaDeOrg(30)).toBe(30)
  })

  describe("validarConfigGarantias (PUT)", () => {
    it("acepta los tres campos y los pasa a columnas", () => {
      expect(validarConfigGarantias({ terminos: " Texto ", ventanaPorVencer: 10, avisoVencimiento: true })).toEqual({
        ok: true,
        update: { garantia_terminos: "Texto", garantia_ventana_por_vencer_dias: 10, garantia_aviso_vencimiento: true },
      })
    })

    it("términos vacíos se guardan como NULL", () => {
      const r = validarConfigGarantias({ terminos: "   " })
      expect(r).toEqual({ ok: true, update: { garantia_terminos: null } })
    })

    it("rechaza términos de más de 2000 caracteres", () => {
      const r = validarConfigGarantias({ terminos: "x".repeat(GARANTIA_TERMINOS_MAX + 1) })
      expect(r.ok).toBe(false)
    })

    it.each([0, 91, 7.5, "siete", null])("rechaza la ventana %s", (v) => {
      expect(validarConfigGarantias({ ventanaPorVencer: v }).ok).toBe(false)
    })

    it("rechaza un aviso que no es booleano y un body vacío", () => {
      expect(validarConfigGarantias({ avisoVencimiento: "true" }).ok).toBe(false)
      expect(validarConfigGarantias({}).ok).toBe(false)
      expect(validarConfigGarantias(null).ok).toBe(false)
    })
  })

  describe("términos en el comprobante: no reemplazan las condiciones de la entrega", () => {
    it("imprime primero las condiciones de la entrega y después los términos de la org", () => {
      expect(bloquesTerminosGarantia("Alcance: Solo repuesto.", "No cubre golpes.")).toEqual([
        { titulo: "Condiciones de esta garantía", texto: "Alcance: Solo repuesto." },
        { titulo: "Términos de garantía", texto: "No cubre golpes." },
      ])
    })

    it("sin términos de la org quedan solo las condiciones, y al revés", () => {
      expect(bloquesTerminosGarantia("Alcance: Solo repuesto.", null)).toHaveLength(1)
      expect(bloquesTerminosGarantia(null, "No cubre golpes.")).toEqual([
        { titulo: "Términos de garantía", texto: "No cubre golpes." },
      ])
      expect(bloquesTerminosGarantia("  ", "")).toEqual([])
    })

    it("si son el mismo texto se imprime una sola vez", () => {
      expect(bloquesTerminosGarantia("Igual", "Igual")).toHaveLength(1)
    })
  })

  describe("lineasTerminosGarantia (PDF)", () => {
    // Fuente falsa: cada carácter mide 1 pt.
    const font = { widthOfTextAtSize: (t: string) => t.length } as unknown as PDFFont

    it("corta por ancho y respeta los renglones", () => {
      expect(wrapPdfTexto("uno dos tres\ncuatro", font, 8, 8)).toEqual(["uno dos", "tres", "cuatro"])
    })

    it("parte una palabra que sola no entra", () => {
      expect(wrapPdfTexto("abcdefghij", font, 8, 4).every((l) => l.length <= 4)).toBe(true)
    })

    it("con tope de líneas, la última avisa que el texto sigue en el taller", () => {
      const lineas = lineasTerminosGarantia(null, "uno\ndos\ntres", font, 8, 60, 2)
      expect(lineas).toHaveLength(2)
      expect(lineas[1].texto).toContain("texto completo en el taller")
    })

    it("sin espacio no imprime nada", () => {
      expect(lineasTerminosGarantia("x", "y", font, 8, 60, 0)).toEqual([])
    })
  })
})

describe("ventana \"por vencer\" de la org", () => {
  type Chain = ReturnType<typeof createChainMock>

  function grabar(org: Record<string, unknown>) {
    const vistas: Chain[] = []
    vi.mocked(supabaseAdmin.from).mockImplementation((t: string) => {
      if (t === "v_garantias") {
        const c = createChainMock([], null, 3)
        vistas.push(c)
        return c as any
      }
      if (t === "organizations") return createChainMock(org) as any
      return createChainMock([], null, 0) as any
    })
    return vistas
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ["Date"] })
    // 2026-11-11 en Buenos Aires.
    vi.setSystemTime(new Date("2026-11-11T15:00:00Z"))
  })
  afterEach(() => vi.useRealTimers())

  it("sin ?ventana la URL no fija la ventana: manda la de la org", () => {
    expect(parseFiltrosGarantias(new URLSearchParams("tab=por-vencer")).ventana).toBeNull()
    expect(parseFiltrosGarantias(new URLSearchParams("ventana=3")).ventana).toBe(3)
  })

  it("la lista y el dashboard usan la ventana de la org (14 días)", async () => {
    const org = { zona_horaria: "America/Argentina/Buenos_Aires", garantia_ventana_por_vencer_dias: 14 }
    const pagina = grabar(org)
    const r = await listarGarantias({
      organizationId: "org-1",
      alcance: { tipo: "todas" },
      filtros: { tab: "por-vencer", origen: null, q: null, page: 1, limit: 20, ventana: null },
      actor: null,
    })
    expect(r.ventana).toBe(14)
    expect(pagina[0].lte).toHaveBeenCalledWith("dia_vencimiento", "2026-11-25")

    const dash = grabar(org)
    await resumenGarantiasPorVencer("org-1", { tipo: "todas" })
    expect(dash[0].lte).toHaveBeenCalledWith("dia_vencimiento", "2026-11-25")
    expect(dash[0].eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("sin la columna (402 sin correr) sigue siendo 7", async () => {
    const vistas = grabar({ zona_horaria: "America/Argentina/Buenos_Aires" })
    const r = await resumenGarantiasPorVencer("org-1", { tipo: "todas" })
    expect(r.total).toBe(3)
    expect(vistas[0].lte).toHaveBeenCalledWith("dia_vencimiento", "2026-11-18")
  })
})
