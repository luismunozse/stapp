// @vitest-environment node
import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, it, expect } from "vitest"

import {
  decidirConciliacion,
  GRACIA_CONCILIACION_MS,
  type NotaCreditoPorConciliar,
} from "@/lib/facturacion/arca/conciliar-nota-credito"
import type { ConsultaResult } from "@/lib/facturacion/types"

// Este repo es público: solo datos de prueba, ningún CUIT ni cliente real.
const MINUTO = 60_000

// 2026-10-20 12:00 hora argentina.
const AHORA = new Date("2026-10-20T15:00:00.000Z")

/** Instante `ms` milisegundos antes de AHORA, como lo devuelve Postgres (ISO). */
const haceMs = (ms: number) => new Date(AHORA.getTime() - ms).toISOString()

/** NC B pendiente con el número 5 reservado, enviada hace 10 minutos. */
const pendiente: NotaCreditoPorConciliar = {
  estado: "pendiente",
  puntoVenta: 3,
  cbteNroSolicitado: 5,
  importeTotal: 1210,
  receptorDocTipoCod: 99,
  receptorDocNro: "0",
  fechaEmision: "2026-10-20",
  ultimoIntentoAt: haceMs(10 * MINUTO),
}

/** Lo que ARCA devolvería si la NC 5 sí se emitió con los datos que mandamos. */
const consultaCoincide: ConsultaResult = {
  existe: true,
  cbteNro: 5,
  cae: "70000000000042",
  caeVencimiento: "20261030",
  resultado: "A",
  cbteFch: "20261020",
  concepto: 1,
  docTipo: 99,
  docNro: "0",
  impTotal: 1210,
  impNeto: 1000,
  impIva: 210,
  impTrib: 0,
  impOpEx: 0,
  impTotConc: 0,
  moneda: "PES",
  cotizacion: 1,
}

const noExiste: ConsultaResult = { existe: false }

describe("decidirConciliacion — ARCA tiene el número solicitado", () => {
  it("mismo total, documento y fecha, resultado A: adopta el CAE de ARCA", () => {
    expect(decidirConciliacion(pendiente, consultaCoincide, null, AHORA)).toEqual({
      accion: "adoptar",
      numero: "0003-00000005",
      cae: "70000000000042",
      caeVencimiento: "20261030",
    })
  })

  it("adopta aunque el envío sea de hace segundos: que ARCA ya la tenga es evidencia positiva", () => {
    const recien = { ...pendiente, ultimoIntentoAt: haceMs(5_000) }

    expect(decidirConciliacion(recien, consultaCoincide, null, AHORA).accion).toBe("adoptar")
  })

  it("adopta una NC ya marcada rechazada si ARCA muestra ESE número autorizado con los mismos datos", () => {
    const rechazada = { ...pendiente, estado: "rechazado" as const }

    expect(decidirConciliacion(rechazada, consultaCoincide, null, AHORA)).toEqual({
      accion: "adoptar",
      numero: "0003-00000005",
      cae: "70000000000042",
      caeVencimiento: "20261030",
    })
  })

  it("compara el total al centavo: el ruido de coma flotante no impide adoptar", () => {
    const conRuido = { ...consultaCoincide, impTotal: 1210 - 1e-12 } // 1209.999999999999

    expect(conRuido.impTotal).not.toBe(1210)
    expect(decidirConciliacion(pendiente, conRuido, null, AHORA).accion).toBe("adoptar")
  })

  it.each([
    ["el total difiere un centavo", { impTotal: 1210.01 }],
    ["el total difiere mucho", { impTotal: 1000 }],
    ["el tipo de documento difiere", { docTipo: 96 }],
    ["el número de documento difiere", { docNro: "30111111118" }],
    ["la fecha difiere", { cbteFch: "20261019" }],
  ])("%s: queda para soporte, nunca se adopta", (_caso, cambio) => {
    const consulta = { ...consultaCoincide, ...cambio }

    expect(decidirConciliacion(pendiente, consulta, null, AHORA)).toEqual({
      accion: "soporte",
      razon: "datos_distintos",
    })
  })

  it("el comprobante que ARCA devuelve es OTRO número: no se adopta ni siquiera con los mismos datos", () => {
    const otroNumero = { ...consultaCoincide, cbteNro: 6 }

    expect(decidirConciliacion(pendiente, otroNumero, null, AHORA)).toEqual({
      accion: "soporte",
      razon: "datos_distintos",
    })
  })

  it("si la consulta no informa el número, no se puede probar que sea el solicitado: soporte", () => {
    const { cbteNro: _omitido, ...sinNumero } = consultaCoincide

    expect(decidirConciliacion(pendiente, sinNumero, null, AHORA)).toEqual({
      accion: "soporte",
      razon: "datos_distintos",
    })
  })

  it.each([
    ["el resultado no es A", { resultado: "R" }],
    ["falta el resultado", { resultado: undefined }],
    ["no trae CAE", { cae: undefined }],
    ["el CAE viene vacío", { cae: "" }],
    ["no trae vencimiento", { caeVencimiento: undefined }],
  ])("%s: no hay nada que adoptar, soporte", (_caso, cambio) => {
    const consulta = { ...consultaCoincide, ...cambio }

    expect(decidirConciliacion(pendiente, consulta, null, AHORA)).toEqual({
      accion: "soporte",
      razon: "datos_distintos",
    })
  })

  it.each([
    ["sin total", { importeTotal: null }],
    ["sin tipo de documento", { receptorDocTipoCod: null }],
    ["sin número de documento", { receptorDocNro: null }],
    ["sin fecha", { fechaEmision: null }],
  ])("la fila de la NC está %s: no se puede probar que sea la nuestra, soporte", (_caso, cambio) => {
    const incompleta = { ...pendiente, ...cambio }

    expect(decidirConciliacion(incompleta, consultaCoincide, null, AHORA)).toEqual({
      accion: "soporte",
      razon: "datos_distintos",
    })
  })
})

describe("decidirConciliacion — un null de la fila no se confunde con cero", () => {
  it("sin total en la fila no se adopta ni siquiera un comprobante de ARCA con total 0", () => {
    const sinTotal = { ...pendiente, importeTotal: null }
    const consultaEnCero = { ...consultaCoincide, impTotal: 0 }

    expect(decidirConciliacion(sinTotal, consultaEnCero, null, AHORA)).toEqual({
      accion: "soporte",
      razon: "datos_distintos",
    })
  })
})

describe("decidirConciliacion — ARCA no tiene el número solicitado", () => {
  it("el último autorizado es menor y ya pasó la gracia: ARCA no la emitió, se rechaza", () => {
    expect(decidirConciliacion(pendiente, noExiste, 4, AHORA)).toEqual({ accion: "rechazar" })
  })

  it("también con un último autorizado mucho menor", () => {
    expect(decidirConciliacion(pendiente, noExiste, 0, AHORA)).toEqual({ accion: "rechazar" })
  })

  it("el último autorizado ya llegó al número pero ARCA no devuelve el comprobante: incoherente, soporte", () => {
    expect(decidirConciliacion(pendiente, noExiste, 5, AHORA)).toEqual({
      accion: "soporte",
      razon: "numero_ocupado",
    })
    expect(decidirConciliacion(pendiente, noExiste, 9, AHORA)).toEqual({
      accion: "soporte",
      razon: "numero_ocupado",
    })
  })

  it("sin el último autorizado no se puede concluir: nunca se rechaza por un null", () => {
    expect(decidirConciliacion(pendiente, noExiste, null, AHORA)).toEqual({
      accion: "soporte",
      razon: "sin_confirmacion",
    })
  })

  it.each([Number.NaN, -1, 4.5, Number.POSITIVE_INFINITY])(
    "un último autorizado que no es un entero válido (%s) tampoco alcanza para rechazar",
    (ultimoRaro) => {
      expect(decidirConciliacion(pendiente, noExiste, ultimoRaro, AHORA)).toEqual({
        accion: "soporte",
        razon: "sin_confirmacion",
      })
    }
  )

  describe("período de gracia desde el último envío", () => {
    const conEdad = (ms: number) => ({ ...pendiente, ultimoIntentoAt: haceMs(ms) })

    it("dentro de la gracia no se rechaza: el pedido a ARCA todavía puede estar procesándose", () => {
      expect(decidirConciliacion(conEdad(10_000), noExiste, 4, AHORA)).toEqual({
        accion: "esperar",
        razon: "dentro_de_gracia",
      })
      expect(decidirConciliacion(conEdad(4 * MINUTO + 59_000), noExiste, 4, AHORA).accion).toBe("esperar")
    })

    it("justo en los 5 minutos todavía no está vencida; un segundo después sí", () => {
      expect(decidirConciliacion(conEdad(5 * MINUTO), noExiste, 4, AHORA).accion).toBe("esperar")
      expect(decidirConciliacion(conEdad(5 * MINUTO + 1_000), noExiste, 4, AHORA).accion).toBe("rechazar")
    })

    it("si no se sabe cuándo se envió (o la fecha es ilegible), no se puede probar que pasó la gracia", () => {
      for (const ultimoIntentoAt of [null, "", "no-es-una-fecha"]) {
        expect(
          decidirConciliacion({ ...pendiente, ultimoIntentoAt }, noExiste, 4, AHORA)
        ).toEqual({ accion: "esperar", razon: "dentro_de_gracia" })
      }
    })

    it("un envío con fecha futura (reloj desfasado) cuenta como dentro de la gracia", () => {
      const futuro = { ...pendiente, ultimoIntentoAt: new Date(AHORA.getTime() + MINUTO).toISOString() }

      expect(decidirConciliacion(futuro, noExiste, 4, AHORA).accion).toBe("esperar")
    })

    it("acepta la fecha como Date además de ISO", () => {
      const comoDate = { ...pendiente, ultimoIntentoAt: new Date(AHORA.getTime() - 10 * MINUTO) }

      expect(decidirConciliacion(comoDate, noExiste, 4, AHORA).accion).toBe("rechazar")
    })

    it("la gracia solo frena el rechazo: un número ocupado o un null sin último siguen yendo a soporte", () => {
      expect(decidirConciliacion(conEdad(10_000), noExiste, 5, AHORA).accion).toBe("soporte")
      expect(decidirConciliacion(conEdad(10_000), noExiste, null, AHORA).accion).toBe("soporte")
    })

    it("una NC ya rechazada no tiene nada que proteger: 'rechazar' es idempotente aunque sea reciente", () => {
      const rechazadaReciente = { ...pendiente, estado: "rechazado" as const, ultimoIntentoAt: haceMs(10_000) }

      expect(decidirConciliacion(rechazadaReciente, noExiste, 4, AHORA)).toEqual({ accion: "rechazar" })
    })
  })
})

describe("GRACIA_CONCILIACION_MS", () => {
  it("son 5 minutos", () => {
    expect(GRACIA_CONCILIACION_MS).toBe(5 * MINUTO)
  })

  it("supera el maxDuration más alto de las funciones: un envío que ARCA sigue procesando ya terminó", () => {
    const vercel = JSON.parse(readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")) as {
      functions: Record<string, { maxDuration?: number }>
    }
    const duraciones = Object.values(vercel.functions).map((f) => f.maxDuration ?? 0)
    const maxSegundos = Math.max(...duraciones)

    expect(duraciones.length).toBeGreaterThan(0)
    expect(maxSegundos).toBeGreaterThan(0)
    expect(GRACIA_CONCILIACION_MS).toBeGreaterThan(maxSegundos * 1000)
  })
})
