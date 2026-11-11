import { describe, it, expect, beforeEach } from "vitest"
import {
  parseOrdenesFiltros,
  serializeOrdenesFiltros,
  urlListaConFiltros,
  ordenesHref,
  apiParamsDeFiltroRapido,
  guardarUltimaListaOrdenes,
  leerUltimaListaOrdenes,
  FILTROS_VACIOS,
} from "@/lib/ordenes/filtros-url"

const parse = (qs: string) => parseOrdenesFiltros(new URLSearchParams(qs))

describe("parseOrdenesFiltros", () => {
  it("sin params devuelve los filtros vacíos", () => {
    expect(parse("")).toEqual(FILTROS_VACIOS)
    expect(parseOrdenesFiltros(null)).toEqual(FILTROS_VACIOS)
  })

  it("lee todos los filtros, la página y el orden", () => {
    const f = parse(
      "search=Galaxy&estado=RECIBIDO&estadoCobro=PARCIAL&filtro=vencidas&tecnicoId=t1&tipoDispositivo=CEL" +
        "&marca=Sam&conPresupuesto=si&conSena=no&fechaDesde=2026-01-01&fechaHasta=2026-01-31" +
        "&fechaPrometidaDesde=2026-02-01&fechaEntregaHasta=2026-03-01&page=3&limit=50&sort=estado&dir=asc"
    )
    expect(f).toMatchObject({
      search: "Galaxy",
      estado: "RECIBIDO",
      estadoCobro: "PARCIAL",
      filtro: "vencidas",
      tecnicoId: "t1",
      tipoDispositivo: "CEL",
      marca: "Sam",
      conPresupuesto: "si",
      conSena: "no",
      fechaDesde: "2026-01-01",
      fechaHasta: "2026-01-31",
      fechaPrometidaDesde: "2026-02-01",
      fechaEntregaHasta: "2026-03-01",
      page: 3,
      pageSize: 50,
      sort: { key: "estado", direction: "asc" },
    })
  })

  it("acepta el alias viejo estado_cobro del dashboard", () => {
    expect(parse("estado_cobro=PENDIENTE").estadoCobro).toBe("PENDIENTE")
  })

  it("estado=pendientes (link viejo del dashboard) es el grupo de órdenes en curso", () => {
    const f = parse("estado=pendientes")
    expect(f.estado).toBe("")
    expect(f.filtro).toBe("activas")
  })

  it("ignora valores que la lista no entiende", () => {
    expect(
      parse("estado=NOPE&estadoCobro=X&filtro=raro&conSena=quizas&fechaDesde=ayer&page=-2&limit=abc&sort=hack")
    ).toEqual(FILTROS_VACIOS)
  })

  it("limita el tamaño de página a 100 y la página mínima es 1", () => {
    expect(parse("limit=5000").pageSize).toBe(100)
    expect(parse("page=0").page).toBe(1)
  })
})

describe("serializeOrdenesFiltros", () => {
  it("omite los defaults", () => {
    expect(serializeOrdenesFiltros(FILTROS_VACIOS).toString()).toBe("")
  })

  it("ida y vuelta conserva los filtros", () => {
    const qs = "search=abc&estado=REPARADO&filtro=sinTecnico&page=2&limit=50&sort=numeroOrden&dir=desc"
    const f = parse(qs)
    expect(parse(serializeOrdenesFiltros(f).toString())).toEqual(f)
  })
})

describe("urlListaConFiltros", () => {
  it("respeta params ajenos (fromTurno), descarta nueva y los alias viejos", () => {
    const actual = new URLSearchParams("fromTurno=t9&nueva=1&estado_cobro=PENDIENTE&page=4")
    expect(urlListaConFiltros("/ordenes", actual, { ...FILTROS_VACIOS, estado: "RECIBIDO" })).toBe(
      "/ordenes?fromTurno=t9&estado=RECIBIDO"
    )
  })

  it("sin filtros vuelve al path pelado", () => {
    expect(urlListaConFiltros("/ordenes", new URLSearchParams("filtro=vencidas"), FILTROS_VACIOS)).toBe("/ordenes")
  })
})

describe("ordenesHref (links del dashboard)", () => {
  it("arma hrefs que la lista entiende", () => {
    expect(ordenesHref()).toBe("/ordenes")
    expect(ordenesHref({ filtro: "pendientesCobro" })).toBe("/ordenes?filtro=pendientesCobro")
    expect(ordenesHref({ estado: "RECIBIDO" })).toBe("/ordenes?estado=RECIBIDO")
    for (const href of [
      ordenesHref({ filtro: "pendientesCobro" }),
      ordenesHref({ filtro: "vencidas" }),
      ordenesHref({ filtro: "activas" }),
      ordenesHref({ estado: "ESPERANDO_REPUESTO" }),
    ]) {
      const qs = href.split("?")[1]
      expect(serializeOrdenesFiltros(parse(qs)).toString()).toBe(qs)
    }
  })
})

describe("apiParamsDeFiltroRapido", () => {
  it("traduce cada chip a los params de GET /api/ordenes", () => {
    expect(apiParamsDeFiltroRapido("vencidas")).toEqual({ vencimiento: "vencidas" })
    expect(apiParamsDeFiltroRapido("venceHoy")).toEqual({ vencimiento: "venceHoy" })
    expect(apiParamsDeFiltroRapido("pendientesCobro")).toEqual({ cobroPendiente: "true" })
    expect(apiParamsDeFiltroRapido("sinTecnico")).toEqual({ sinTecnico: "true" })
    expect(apiParamsDeFiltroRapido("activas")).toEqual({ activas: "true" })
    expect(apiParamsDeFiltroRapido("")).toEqual({})
  })
})

describe("última lista de órdenes (volver desde el detalle)", () => {
  beforeEach(() => sessionStorage.clear())

  it("sin nada guardado vuelve a /ordenes", () => {
    expect(leerUltimaListaOrdenes()).toBe("/ordenes")
  })

  it("devuelve la lista filtrada guardada", () => {
    guardarUltimaListaOrdenes("/ordenes?filtro=vencidas&page=2")
    expect(leerUltimaListaOrdenes()).toBe("/ordenes?filtro=vencidas&page=2")
  })

  it("descarta valores que no son la lista de órdenes", () => {
    guardarUltimaListaOrdenes("https://evil.example/ordenes")
    expect(leerUltimaListaOrdenes()).toBe("/ordenes")
    guardarUltimaListaOrdenes("/ordenes/abc")
    expect(leerUltimaListaOrdenes()).toBe("/ordenes")
  })
})
