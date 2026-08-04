/**
 * construirEquipoPayload (components/ordenes/recepcion-form.tsx) es la logica
 * mas riesgosa del formulario de recepcion multiple: las tres correcciones
 * del dispatch original de Task 10 viven aca (labels de accesorios en vez de
 * ids, split del prefijo data-URL de las fotos, sin `tipo` por foto). Es
 * exactamente el tipo de bug que no tira ningun error: si esto se rompe, el
 * resultado es un comprobante firmado con datos equivocados, no un crash.
 *
 * Se testea como funcion pura (sin ModalProvider, sin canvas, sin montar
 * React) porque no depende de hooks ni de contexto.
 */
import { describe, it, expect } from "vitest"
import {
  construirEquipoPayload,
  resolverAccesoriosDisponibles,
  type EquipoSideState,
} from "@/components/ordenes/recepcion-form"
import type { EquipoFormValues } from "@/components/ordenes/recepcion-equipo-card"
import type { TipoDispositivoCustom } from "@/types"

const tiposFixture: TipoDispositivoCustom[] = [
  {
    id: "tipo-1",
    codigo: "CELULAR",
    nombre: "Celular",
    prefijoOrden: "CEL",
    icono: null,
    activo: true,
    esBase: true,
    orden: 1,
    config: {
      accesorios: [
        { id: "cargador", label: "Cargador" },
        { id: "cable", label: "Cable USB" },
      ],
    },
  },
]

const equipoFixture: EquipoFormValues = {
  dispositivo: "iPhone 13",
  tipoDispositivo: "CELULAR",
  marca: "Apple",
  color: "Negro",
  imei: "123456789012345",
  problemaReportado: "No enciende",
  codigoAccesoDispositivo: "",
}

const sideVacio = (): EquipoSideState => ({
  accesoriosSeleccionados: [],
  otroAccesorio: "",
  camposExtraValues: {},
  fotos: [],
})

describe("construirEquipoPayload — accesorios", () => {
  it("mapea un id de accesorio conocido a su label", () => {
    const side = { ...sideVacio(), accesoriosSeleccionados: ["cargador"] }
    const result = construirEquipoPayload(equipoFixture, side, tiposFixture)
    expect(result.accesorios).toBe("Cargador")
  })

  it("un id sin match en accesoriosDisponibles cae de vuelta al id mismo (caso 'otro' agregado a mano)", () => {
    const side = { ...sideVacio(), accesoriosSeleccionados: ["Mochila con ruedas"] }
    const result = construirEquipoPayload(equipoFixture, side, tiposFixture)
    expect(result.accesorios).toBe("Mochila con ruedas")
  })

  it("combina labels conocidas y texto libre en el mismo string, separadas por coma", () => {
    const side = {
      ...sideVacio(),
      accesoriosSeleccionados: ["cargador", "cable", "Funda a medida"],
    }
    const result = construirEquipoPayload(equipoFixture, side, tiposFixture)
    expect(result.accesorios).toBe("Cargador, Cable USB, Funda a medida")
  })

  it("sin accesorios seleccionados, el campo queda undefined (no un string vacio)", () => {
    const result = construirEquipoPayload(equipoFixture, sideVacio(), tiposFixture)
    expect(result.accesorios).toBeUndefined()
  })
})

describe("construirEquipoPayload — fotos", () => {
  it("separa el prefijo data:mime;base64, de una foto valida", () => {
    const side: EquipoSideState = {
      ...sideVacio(),
      fotos: [
        {
          id: "foto-1",
          preview: "data:image/png;base64,QUJD",
          file: new File([""], "foto.png", { type: "image/png" }),
          descripcion: "Pantalla rota",
        },
      ],
    }
    const result = construirEquipoPayload(equipoFixture, side, tiposFixture)
    expect(result.fotos).toHaveLength(1)
    expect(result.fotos![0].data).toBe("QUJD")
    expect(result.fotos![0].mime).toBe("image/png")
    expect(result.fotos![0].descripcion).toBe("Pantalla rota")
  })

  it("si la foto no matchea el patron data-URL, cae al fallback documentado (data vacio, mime image/jpeg)", () => {
    const side: EquipoSideState = {
      ...sideVacio(),
      fotos: [
        {
          id: "foto-2",
          preview: "esto-no-es-un-data-url",
          file: new File([""], "foto.jpg", { type: "image/jpeg" }),
          descripcion: "",
        },
      ],
    }
    const result = construirEquipoPayload(equipoFixture, side, tiposFixture)
    expect(result.fotos).toHaveLength(1)
    expect(result.fotos![0].data).toBe("")
    expect(result.fotos![0].mime).toBe("image/jpeg")
  })

  it("no incluye 'tipo' en el objeto de cada foto: el endpoint fija tipo:'INGRESO' el mismo", () => {
    const side: EquipoSideState = {
      ...sideVacio(),
      fotos: [
        {
          id: "foto-3",
          preview: "data:image/png;base64,QUJD",
          file: new File([""], "foto.png", { type: "image/png" }),
          descripcion: "",
        },
      ],
    }
    const result = construirEquipoPayload(equipoFixture, side, tiposFixture)
    expect(result.fotos![0]).not.toHaveProperty("tipo")
    expect(Object.keys(result.fotos![0]).sort()).toEqual(["data", "descripcion", "mime"])
  })

  it("una foto sin File adjunto se filtra (no se manda al backend)", () => {
    const side: EquipoSideState = {
      ...sideVacio(),
      fotos: [{ id: "foto-4", preview: "data:image/png;base64,QUJD", descripcion: "" }],
    }
    const result = construirEquipoPayload(equipoFixture, side, tiposFixture)
    expect(result.fotos).toBeUndefined()
  })

  it("sin fotos, el campo queda undefined", () => {
    const result = construirEquipoPayload(equipoFixture, sideVacio(), tiposFixture)
    expect(result.fotos).toBeUndefined()
  })
})

describe("construirEquipoPayload — metadata y campos base", () => {
  it("copia los campos del equipo tal cual (dispositivo, tipoDispositivo, etc.)", () => {
    const result = construirEquipoPayload(equipoFixture, sideVacio(), tiposFixture)
    expect(result.dispositivo).toBe("iPhone 13")
    expect(result.tipoDispositivo).toBe("CELULAR")
    expect(result.marca).toBe("Apple")
    expect(result.imei).toBe("123456789012345")
  })

  it("filtra valores vacios de camposExtraValues antes de armar metadata", () => {
    const side: EquipoSideState = {
      ...sideVacio(),
      camposExtraValues: { procesador: "i7", ram: "", puertosUsb: 0, otro: null },
    }
    const result = construirEquipoPayload(equipoFixture, side, tiposFixture)
    // 0 es un valor valido (contador), no se filtra; "" y null si.
    expect(result.metadata).toEqual({ procesador: "i7", puertosUsb: 0 })
  })

  it("sin campos extra con valor, metadata queda undefined", () => {
    const result = construirEquipoPayload(equipoFixture, sideVacio(), tiposFixture)
    expect(result.metadata).toBeUndefined()
  })
})

describe("resolverAccesoriosDisponibles", () => {
  it("devuelve los accesorios configurados para un tipo conocido", () => {
    const result = resolverAccesoriosDisponibles("CELULAR", tiposFixture)
    expect(result).toEqual([
      { id: "cargador", label: "Cargador" },
      { id: "cable", label: "Cable USB" },
    ])
  })

  it("cae al FALLBACK_CONFIG si el codigo de tipo no existe en la lista", () => {
    const result = resolverAccesoriosDisponibles("TIPO_INEXISTENTE", tiposFixture)
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBeGreaterThan(0)
  })
})
