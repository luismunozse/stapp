// __tests__/lib/facturacion-anular-client.test.ts
/**
 * Cliente de anulacion de facturas ARCA: POST anular (id de la FACTURA) y POST
 * verificar (id de la NOTA DE CREDITO). Mapea cada status y cada `resultado` del
 * servidor a un resultado con el texto que ve el usuario. El servidor sigue siendo
 * la autoridad de cada regla: aca solo se decide como se cuenta.
 */
import { describe, it, expect, vi } from "vitest"
import {
  anularComprobanteArca,
  verificarNotaCreditoArca,
  mensajeFacturaAnulada,
  etiquetaMotivoAnulacion,
  MOTIVOS_ANULACION,
  MAX_DETALLE_MOTIVO,
} from "@/lib/facturacion/anular-comprobante-client"
import { CONTACT_EMAIL } from "@/lib/contact"

const SIN_RESPUESTA = {
        kind: "sinConexion",
        message:
          "No pudimos confirmar cómo terminó la anulación. Actualizá la pantalla para ver si quedó anulada; si ves una nota de crédito pendiente, tocá 'Verificar con ARCA'.",
      }

function respuesta(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ status, json: async () => body })
}

const NC = { id: "nc1", tipo: "B", numero: "0003-00000002", cae: "74123456789099", estado: "emitido" }

describe("constantes de motivo", () => {
  it("ofrece los tres motivos del servidor con su texto", () => {
    expect(MOTIVOS_ANULACION).toEqual([
      { value: "error_factura", label: "Error en la factura" },
      { value: "devolucion_total", label: "Devolución total" },
      { value: "otro", label: "Otro" },
    ])
  })

  it("el detalle admite hasta 500 caracteres, igual que la ruta", () => {
    expect(MAX_DETALLE_MOTIVO).toBe(500)
  })

  it("etiquetaMotivoAnulacion traduce el codigo y calla lo desconocido", () => {
    expect(etiquetaMotivoAnulacion("error_factura")).toBe("Error en la factura")
    expect(etiquetaMotivoAnulacion("devolucion_total")).toBe("Devolución total")
    expect(etiquetaMotivoAnulacion("otro")).toBe("Otro")
    expect(etiquetaMotivoAnulacion("raro")).toBeNull()
    expect(etiquetaMotivoAnulacion(null)).toBeNull()
  })
})

describe("mensajeFacturaAnulada", () => {
  it("nombra la nota de credito electronica con letra y numero", () => {
    expect(mensajeFacturaAnulada({ tipo: "B", numero: "0003-00000002" })).toBe(
      "Factura anulada. Se emitió la nota de crédito electrónica B 0003-00000002."
    )
    expect(mensajeFacturaAnulada({ tipo: "C", numero: "0001-00000010" })).toBe(
      "Factura anulada. Se emitió la nota de crédito electrónica C 0001-00000010."
    )
  })

  it("sin numero (o sin comprobante) no inventa uno", () => {
    expect(mensajeFacturaAnulada({ tipo: "B", numero: null })).toBe(
      "Factura anulada. Se emitió la nota de crédito electrónica."
    )
    expect(mensajeFacturaAnulada(null)).toBe("Factura anulada. Se emitió la nota de crédito electrónica.")
  })
})

describe("anularComprobanteArca", () => {
  it("POSTea el motivo al endpoint de la FACTURA, sin detalle si no hay", async () => {
    const fetchImpl = respuesta(200, { comprobante: NC })
    await anularComprobanteArca("f1", { motivo: "error_factura" }, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledWith("/api/facturacion-electronica/comprobantes/f1/anular", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ motivo: "error_factura" }),
    })
  })

  it("manda el detalle recortado cuando lo hay", async () => {
    const fetchImpl = respuesta(200, { comprobante: NC })
    await anularComprobanteArca("f2", { motivo: "otro", motivoDetalle: "  Cambió la razón social  " }, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/facturacion-electronica/comprobantes/f2/anular",
      expect.objectContaining({ body: JSON.stringify({ motivo: "otro", motivoDetalle: "Cambió la razón social" }) })
    )
  })

  it("un detalle en blanco no viaja", async () => {
    const fetchImpl = respuesta(200, { comprobante: NC })
    await anularComprobanteArca("f1", { motivo: "devolucion_total", motivoDetalle: "   " }, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ motivo: "devolucion_total" }) })
    )
  })

  it("escapa el id en la URL", async () => {
    const fetchImpl = respuesta(200, {})
    await anularComprobanteArca("a/b c", { motivo: "otro", motivoDetalle: "x" }, fetchImpl)
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/facturacion-electronica/comprobantes/a%2Fb%20c/anular")
  })

  describe("200", () => {
    it("ok con la nota de credito y el aviso de plazo del servidor", async () => {
      const r = await anularComprobanteArca(
        "f1",
        { motivo: "error_factura" },
        respuesta(200, { comprobante: NC, anulado: { id: "f1" }, diasDesdeEmision: 20, fueraDePlazo: true })
      )
      expect(r).toEqual({ kind: "ok", comprobante: NC, fueraDePlazo: true, diasDesdeEmision: 20 })
    })

    it("dentro de plazo: fueraDePlazo false y los dias que informa el servidor", async () => {
      const r = await anularComprobanteArca(
        "f1",
        { motivo: "error_factura" },
        respuesta(200, { comprobante: NC, diasDesdeEmision: 3, fueraDePlazo: false })
      )
      expect(r).toEqual({ kind: "ok", comprobante: NC, fueraDePlazo: false, diasDesdeEmision: 3 })
    })

    it("cuerpo sin los extras: comprobante null, sin plazo ni dias", async () => {
      const r = await anularComprobanteArca("f1", { motivo: "error_factura" }, respuesta(200, {}))
      expect(r).toEqual({ kind: "ok", comprobante: null, fueraDePlazo: false, diasDesdeEmision: null })
    })

    it("solo true cuenta como fuera de plazo", async () => {
      const r = await anularComprobanteArca(
        "f1",
        { motivo: "error_factura" },
        respuesta(200, { comprobante: NC, fueraDePlazo: "si", diasDesdeEmision: "20" })
      )
      expect(r).toMatchObject({ kind: "ok", fueraDePlazo: false, diasDesdeEmision: null })
    })
  })

  describe("502", () => {
    it("envio incierto (verificar: true): no se vuelve a intentar, se verifica", async () => {
      const r = await anularComprobanteArca(
        "f1",
        { motivo: "error_factura" },
        respuesta(502, {
          error: "otro texto del servidor",
          comprobante: { id: "nc9", estado: "pendiente", cbte_nro_solicitado: 5 },
          verificar: true,
        })
      )
      expect(r).toEqual({
        kind: "incierta",
        comprobanteId: "nc9",
        message:
          "No pudimos confirmar con ARCA si la nota de crédito quedó emitida. Tocá 'Verificar con ARCA' en unos minutos.",
      })
    })

    it("incierta sin id legible: comprobanteId null", async () => {
      const r = await anularComprobanteArca("f1", { motivo: "error_factura" }, respuesta(502, { verificar: true }))
      expect(r).toMatchObject({ kind: "incierta", comprobanteId: null })
    })

    it("502 tecnico (sin verificar): es un error comun, NO una nota pendiente", async () => {
      const r = await anularComprobanteArca(
        "f1",
        { motivo: "error_factura" },
        respuesta(502, { error: "No pudimos comunicarnos con ARCA." })
      )
      expect(r).toEqual({ kind: "error", message: "No pudimos comunicarnos con ARCA." })
    })

    it("verificar distinto de true no cuenta", async () => {
      const r = await anularComprobanteArca(
        "f1",
        { motivo: "error_factura" },
        respuesta(502, { error: "x", verificar: "true" })
      )
      expect(r.kind).toBe("error")
    })
  })

  describe("500", () => {
    it("con CAE: ARCA la autorizo pero no se registro; se pide escribir a soporte con el CAE", async () => {
      const r = await anularComprobanteArca(
        "f1",
        { motivo: "error_factura" },
        respuesta(500, { error: "x", cae: "74123456789099", numero: "0003-00000002", comprobanteId: "nc9" })
      )
      expect(r).toEqual({
        kind: "autorizadaSinRegistrar",
        cae: "74123456789099",
        numero: "0003-00000002",
        message: `ARCA autorizó la nota de crédito (CAE 74123456789099), pero no pudimos registrarla en STApp. No la emitas de nuevo: escribinos a ${CONTACT_EMAIL} con ese CAE.`,
      })
    })

    it("con CAE pero sin numero: el numero queda null", async () => {
      const r = await anularComprobanteArca("f1", { motivo: "error_factura" }, respuesta(500, { cae: "7412" }))
      expect(r).toMatchObject({ kind: "autorizadaSinRegistrar", cae: "7412", numero: null })
    })

    it("sin CAE: error comun con el mensaje del servidor", async () => {
      const r = await anularComprobanteArca(
        "f1",
        { motivo: "error_factura" },
        respuesta(500, { error: "No se pudo cargar el comprobante" })
      )
      expect(r).toEqual({ kind: "error", message: "No se pudo cargar el comprobante" })
    })

    it("un CAE vacio no cuenta", async () => {
      const r = await anularComprobanteArca("f1", { motivo: "error_factura" }, respuesta(500, { cae: "", error: "Se cayó" }))
      expect(r).toEqual({ kind: "error", message: "Se cayó" })
    })
  })

  describe("409", () => {
    it("conflicto con el texto del servidor (otra nota en curso, ya anulada...)", async () => {
      const r = await anularComprobanteArca(
        "f1",
        { motivo: "error_factura" },
        respuesta(409, { error: "Esta factura ya tiene una nota de crédito en curso.", notaCredito: { id: "nc1" } })
      )
      expect(r).toEqual({ kind: "conflicto", message: "Esta factura ya tiene una nota de crédito en curso." })
    })

    it("sin texto: uno por defecto que manda a actualizar", async () => {
      const r = await anularComprobanteArca("f1", { motivo: "error_factura" }, respuesta(409, {}))
      expect(r).toEqual({
        kind: "conflicto",
        message: "La factura cambió mientras la anulabas. Actualizamos la pantalla con lo que quedó.",
      })
    })
  })

  describe("otros errores", () => {
    it("422: el mensaje de negocio del servidor tal cual", async () => {
      const r = await anularComprobanteArca(
        "f1",
        { motivo: "error_factura" },
        respuesta(422, { error: "ARCA no encontró la factura original." })
      )
      expect(r).toEqual({ kind: "error", message: "ARCA no encontró la factura original." })
    })

    it("422 de rechazo de ARCA: el error del servidor, no el comprobante", async () => {
      const r = await anularComprobanteArca(
        "f1",
        { motivo: "error_factura" },
        respuesta(422, { error: "10016: El numero no es el siguiente", comprobante: { id: "nc1", estado: "rechazado" } })
      )
      expect(r).toEqual({ kind: "error", message: "10016: El numero no es el siguiente" })
    })

    it("503 sin la migracion: el aviso del servidor", async () => {
      const r = await anularComprobanteArca(
        "f1",
        { motivo: "error_factura" },
        respuesta(503, { error: "La anulación de facturas todavía no está disponible. Contactá a soporte." })
      )
      expect(r).toEqual({
        kind: "error",
        message: "La anulación de facturas todavía no está disponible. Contactá a soporte.",
      })
    })

    it("403 sin texto: dice que no tiene permiso", async () => {
      const r = await anularComprobanteArca("f1", { motivo: "error_factura" }, respuesta(403, {}))
      expect(r).toEqual({ kind: "error", message: "No tenés permiso para anular facturas electrónicas." })
    })

    it("400/404 con texto usan el del servidor; sin texto, el generico", async () => {
      expect(await anularComprobanteArca("f1", { motivo: "otro" }, respuesta(400, { error: "Contanos el motivo en el detalle." }))).toEqual({
        kind: "error",
        message: "Contanos el motivo en el detalle.",
      })
      expect(await anularComprobanteArca("f1", { motivo: "otro" }, respuesta(404, {}))).toEqual(SIN_RESPUESTA)
    })

    it("cuerpo no JSON no rompe: se trata como vacio", async () => {
      const fetchImpl = vi.fn().mockResolvedValue({
        status: 500,
        json: async () => {
          throw new Error("bad json")
        },
      })
      expect(await anularComprobanteArca("f1", { motivo: "otro" }, fetchImpl)).toEqual(SIN_RESPUESTA)
    })

    it("un cuerpo que no es un objeto (null, lista, texto) tampoco se confunde con la falla de red", async () => {
      for (const cuerpo of [null, [], "boom", 7]) {
        const r = await anularComprobanteArca("f1", { motivo: "otro" }, respuesta(500, cuerpo))
        expect(r).toEqual(SIN_RESPUESTA)
      }
    })

    it("un error en blanco no es un cuerpo reconocido: sinConexion", async () => {
      expect(await anularComprobanteArca("f1", { motivo: "otro" }, respuesta(422, { error: "   " }))).toEqual(SIN_RESPUESTA)
    })

    it("504 con cuerpo HTML (el gateway cortó): sinConexion, nunca un error que invite a reintentar", async () => {
      const fetchImpl = vi.fn().mockResolvedValue({
        status: 504,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON")
        },
      })
      expect(await anularComprobanteArca("f1", { motivo: "otro" }, fetchImpl)).toEqual(SIN_RESPUESTA)
    })

    it("502 con cuerpo vacío: sinConexion", async () => {
      const fetchImpl = vi.fn().mockResolvedValue({
        status: 502,
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input")
        },
      })
      expect(await anularComprobanteArca("f1", { motivo: "otro" }, fetchImpl)).toEqual(SIN_RESPUESTA)
      expect(await anularComprobanteArca("f1", { motivo: "otro" }, respuesta(502, {}))).toEqual(SIN_RESPUESTA)
    })

    it("500 con JSON y CAE conserva su tratamiento específico (no se vuelve sinConexion)", async () => {
      const r = await anularComprobanteArca("f1", { motivo: "otro" }, respuesta(500, { cae: "74123456789099" }))
      expect(r.kind).toBe("autorizadaSinRegistrar")
    })

    it("un 5xx con JSON reconocido (error de texto) sigue siendo un error con ese texto", async () => {
      expect(await anularComprobanteArca("f1", { motivo: "otro" }, respuesta(503, { error: "No disponible" }))).toEqual({
        kind: "error",
        message: "No disponible",
      })
    })

    it("el aviso de verificar solo vale con 502: un 500 con la marca es un error comun", async () => {
      const r = await anularComprobanteArca("f1", { motivo: "otro" }, respuesta(500, { verificar: true, error: "Se cayó" }))
      expect(r).toEqual({ kind: "error", message: "Se cayó" })
    })

    it("un comprobante que no es un objeto no se toma por una nota de credito", async () => {
      const r = await anularComprobanteArca("f1", { motivo: "otro" }, respuesta(200, { comprobante: "nc1" }))
      expect(r).toMatchObject({ kind: "ok", comprobante: null })
    })

    it("falla de red: no sabemos si llego, asi que manda a actualizar antes de reintentar", async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"))
      expect(await anularComprobanteArca("f1", { motivo: "otro" }, fetchImpl)).toEqual({
        kind: "sinConexion",
        message:
          "Se cortó la conexión mientras anulábamos la factura. Antes de volver a intentar, actualizá la pantalla para ver si quedó anulada.",
      })
    })
  })
})

describe("verificarNotaCreditoArca", () => {
  it("POSTea al endpoint de la NOTA DE CREDITO, sin cuerpo", async () => {
    const fetchImpl = respuesta(200, { resultado: "emitida" })
    await verificarNotaCreditoArca("nc1", fetchImpl)
    expect(fetchImpl).toHaveBeenCalledWith("/api/facturacion-electronica/comprobantes/nc1/verificar", {
      method: "POST",
    })
  })

  it("escapa el id en la URL", async () => {
    const fetchImpl = respuesta(200, { resultado: "emitida" })
    await verificarNotaCreditoArca("n c", fetchImpl)
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/facturacion-electronica/comprobantes/n%20c/verificar")
  })

  describe("200", () => {
    it("adoptada: ARCA ya la tenia y quedo registrada", async () => {
      const r = await verificarNotaCreditoArca(
        "nc1",
        respuesta(200, { resultado: "adoptada", comprobante: NC, anulado: { id: "f1" } })
      )
      expect(r).toEqual({
        kind: "ok",
        resultado: "adoptada",
        comprobante: NC,
        message: "ARCA ya tenía la nota de crédito: quedó registrada y la factura figura como anulada.",
      })
    })

    it("emitida: ya estaba emitida (idempotente)", async () => {
      const r = await verificarNotaCreditoArca("nc1", respuesta(200, { resultado: "emitida", comprobante: NC }))
      expect(r).toEqual({
        kind: "ok",
        resultado: "emitida",
        comprobante: NC,
        message: "La nota de crédito ya estaba emitida y la factura figura como anulada.",
      })
    })

    it("rechazada: ARCA no la emitio y se puede volver a anular", async () => {
      const r = await verificarNotaCreditoArca(
        "nc1",
        respuesta(200, { resultado: "rechazada", mensaje: "Texto propio del servidor.", comprobante: { id: "nc1" } })
      )
      expect(r).toEqual({ kind: "noEmitida", message: "Texto propio del servidor." })
    })

    it("rechazada sin mensaje: usa el texto de siempre", async () => {
      const r = await verificarNotaCreditoArca("nc1", respuesta(200, { resultado: "rechazada" }))
      expect(r).toEqual({
        kind: "noEmitida",
        message: "ARCA no emitió la nota de crédito. Podés volver a anular la factura.",
      })
    })

    it("un resultado desconocido no se da por bueno: manda a actualizar", async () => {
      const r = await verificarNotaCreditoArca("nc1", respuesta(200, { resultado: "quiensabe" }))
      expect(r).toEqual({
        kind: "error",
        message: "No pudimos interpretar la respuesta. Actualizá la pantalla para ver cómo quedó la nota de crédito.",
      })
    })

    it("200 sin resultado tampoco", async () => {
      const r = await verificarNotaCreditoArca("nc1", respuesta(200, {}))
      expect(r.kind).toBe("error")
    })
  })

  describe("409", () => {
    it("esperar: el texto del servidor, que pide probar en unos minutos", async () => {
      const r = await verificarNotaCreditoArca(
        "nc1",
        respuesta(409, { resultado: "esperar", error: "Pasaron 2 minutos: probá en unos minutos más." })
      )
      expect(r).toEqual({ kind: "esperar", message: "Pasaron 2 minutos: probá en unos minutos más." })
    })

    it("esperar sin texto: uno por defecto con 'probá en unos minutos'", async () => {
      const r = await verificarNotaCreditoArca("nc1", respuesta(409, { resultado: "esperar" }))
      expect(r).toEqual({
        kind: "esperar",
        message: "El envío fue hace muy poco y ARCA puede seguir procesándolo: probá en unos minutos.",
      })
    })

    it("soporte: el texto del servidor, que trae el mail de soporte", async () => {
      const texto = `ARCA tiene una nota de crédito con ese número pero no coincide con la que enviamos. Contactá a soporte: ${CONTACT_EMAIL}.`
      const r = await verificarNotaCreditoArca("nc1", respuesta(409, { resultado: "soporte", razon: "datos_distintos", error: texto }))
      expect(r).toEqual({ kind: "soporte", message: texto })
    })

    it("soporte con un texto sin el mail: se le agrega", async () => {
      const r = await verificarNotaCreditoArca("nc1", respuesta(409, { resultado: "soporte", error: "Algo no coincide." }))
      expect(r).toEqual({
        kind: "soporte",
        message: `Algo no coincide. Contactá a soporte: ${CONTACT_EMAIL}.`,
      })
    })

    it("soporte sin texto: uno por defecto con el mail", async () => {
      const r = await verificarNotaCreditoArca("nc1", respuesta(409, { resultado: "soporte" }))
      expect(r).toEqual({
        kind: "soporte",
        message: `No pudimos confirmar la nota de crédito con ARCA. No la emitas de nuevo: contactá a soporte: ${CONTACT_EMAIL}.`,
      })
    })

    it("cambio: otra pantalla la modifico, hay que actualizar", async () => {
      const r = await verificarNotaCreditoArca(
        "nc1",
        respuesta(409, { resultado: "cambio", error: "Otro texto del servidor.", comprobante: NC })
      )
      expect(r).toEqual({ kind: "cambio", message: "Otro texto del servidor." })
    })

    it("cambio sin texto: uno por defecto que manda a actualizar", async () => {
      const r = await verificarNotaCreditoArca("nc1", respuesta(409, { resultado: "cambio" }))
      expect(r).toEqual({
        kind: "cambio",
        message: "La nota de crédito cambió mientras la verificábamos. Actualizá la pantalla.",
      })
    })

    it("409 sin resultado (estado que no se puede verificar): error comun", async () => {
      const r = await verificarNotaCreditoArca("nc1", respuesta(409, { error: "Esta nota de crédito no se puede verificar." }))
      expect(r).toEqual({ kind: "error", message: "Esta nota de crédito no se puede verificar." })
    })
  })

  describe("errores", () => {
    it("500 con CAE: ARCA la tiene pero no se registro; se pide escribir a soporte con el CAE", async () => {
      const r = await verificarNotaCreditoArca(
        "nc1",
        respuesta(500, { error: "x", cae: "74123456789099", numero: "0003-00000002", comprobanteId: "nc1" })
      )
      expect(r).toEqual({
        kind: "autorizadaSinRegistrar",
        cae: "74123456789099",
        numero: "0003-00000002",
        message: `ARCA autorizó la nota de crédito (CAE 74123456789099), pero no pudimos registrarla en STApp. No la emitas de nuevo: escribinos a ${CONTACT_EMAIL} con ese CAE.`,
      })
    })

    it("500 sin CAE, 502, 503 y 404: el texto del servidor o el generico", async () => {
      expect(await verificarNotaCreditoArca("nc1", respuesta(502, { error: "No pudimos comunicarnos con ARCA." }))).toEqual({
        kind: "error",
        message: "No pudimos comunicarnos con ARCA.",
      })
      expect(await verificarNotaCreditoArca("nc1", respuesta(503, { error: "No disponible" }))).toEqual({
        kind: "error",
        message: "No disponible",
      })
      expect(await verificarNotaCreditoArca("nc1", respuesta(500, {}))).toEqual({
        kind: "error",
        message: "No se pudo verificar la nota de crédito con ARCA",
      })
      expect(await verificarNotaCreditoArca("nc1", respuesta(404, {}))).toEqual({
        kind: "error",
        message: "No se pudo verificar la nota de crédito con ARCA",
      })
    })

    it("cuerpo no JSON no rompe", async () => {
      const fetchImpl = vi.fn().mockResolvedValue({
        status: 502,
        json: async () => {
          throw new Error("bad json")
        },
      })
      expect(await verificarNotaCreditoArca("nc1", fetchImpl)).toEqual({
        kind: "error",
        message: "No se pudo verificar la nota de crédito con ARCA",
      })
    })

    it("falla de red: mensaje de conexion", async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"))
      expect(await verificarNotaCreditoArca("nc1", fetchImpl)).toEqual({
        kind: "error",
        message: "Se cortó la conexión mientras verificábamos con ARCA. Probá de nuevo en unos minutos.",
      })
    })
  })
})
