// __tests__/components/print-label.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  buildLabelHtml,
  printDeviceLabel,
  readEtiquetaSize,
  saveEtiquetaSize,
  DEFAULT_LABEL_SIZE,
  type LabelData,
} from "@/components/ordenes/print-label"

const baseData: LabelData = {
  codigoOrden: "A-1",
  numeroOrden: 1,
  clienteNombre: "Ana",
  dispositivo: "iPhone 12",
  problemaReportado: "No carga",
  fechaIngreso: "01/01/2026",
  variant: "reparado",
  fechaReparacion: "02/01/2026",
}

describe("buildLabelHtml — tamaños y modos", () => {
  it("die-cut 60x40: @page 60mm 40mm", () => {
    expect(buildLabelHtml(baseData, "60x40", "")).toContain("size: 60mm 40mm")
  })

  it("die-cut 40x30: @page 40mm 30mm", () => {
    expect(buildLabelHtml(baseData, "40x30", "")).toContain("size: 40mm 30mm")
  })

  it("rollo 58mm: @page 58mm auto (altura automática)", () => {
    expect(buildLabelHtml(baseData, "58mm", "")).toContain("size: 58mm auto")
  })

  it("rollo 80mm: @page 80mm auto", () => {
    expect(buildLabelHtml(baseData, "80mm", "")).toContain("size: 80mm auto")
  })
})

describe("buildLabelHtml — contenido por variante", () => {
  it("variante reparado muestra el badge REPARADO y 'Listo para entregar'", () => {
    const html = buildLabelHtml(baseData, "60x40", "")
    expect(html).toContain("REPARADO")
    expect(html).toContain("Listo para entregar")
  })

  it("variante ingreso muestra el problema y NO el badge", () => {
    const html = buildLabelHtml({ ...baseData, variant: "ingreso" }, "60x40", "")
    expect(html).not.toContain("REPARADO")
    expect(html).toContain("No carga")
  })

  it("rollo variante reparado también muestra badge y 'Listo para entregar'", () => {
    const html = buildLabelHtml(baseData, "58mm", "")
    expect(html).toContain("REPARADO")
    expect(html).toContain("Listo para entregar")
  })

  it("rollo variante ingreso muestra el problema y NO el badge", () => {
    const html = buildLabelHtml({ ...baseData, variant: "ingreso" }, "80mm", "")
    expect(html).not.toContain("REPARADO")
    expect(html).toContain("No carga")
  })

  it("incluye el QR cuando se pasa un dataUrl", () => {
    const html = buildLabelHtml(baseData, "60x40", "data:image/png;base64,AAA")
    expect(html).toContain("data:image/png;base64,AAA")
  })

  it("siempre incluye cliente y equipo", () => {
    const html = buildLabelHtml(baseData, "58mm", "")
    expect(html).toContain("Ana")
    expect(html).toContain("iPhone 12")
  })
})

describe("persistencia del tamaño en localStorage", () => {
  beforeEach(() => localStorage.clear())

  it("devuelve el default cuando no hay nada guardado", () => {
    expect(readEtiquetaSize()).toBe(DEFAULT_LABEL_SIZE)
  })

  it("guarda y lee el mismo tamaño (roundtrip)", () => {
    saveEtiquetaSize("58mm")
    expect(readEtiquetaSize()).toBe("58mm")
  })

  it("ignora un valor inválido guardado y cae al default", () => {
    localStorage.setItem("stapp:etiqueta-size", "999x999")
    expect(readEtiquetaSize()).toBe(DEFAULT_LABEL_SIZE)
  })
})

// ============================================================
// printDeviceLabel: el promise tiene que abarcar el print real
// ============================================================
// El flujo de recepción múltiple imprime N etiquetas con un `for` + `await`
// porque cada print() abre un diálogo del SO y dos diálogos superpuestos son
// inmanejables frente al cliente. Eso sólo funciona si el promise de
// printDeviceLabel cierra DESPUÉS del print, nunca antes.
//
// jsdom no tiene iframes navegables ni print(), así que el borde con el
// navegador se falsea (contentDocument/contentWindow + un onload que dispara el
// test), pero la coordinación de promesas que se está probando es la real.

interface FakeImg {
  complete: boolean
  naturalWidth: number
  onload: (() => void) | null
  onerror: (() => void) | null
}

function pendingImg(): FakeImg {
  // No dispara ni onload ni onerror: mantiene triggerPrint() en vuelo hasta su
  // propio timeout, que es lo que hace posible el caso del onload tardío.
  return { complete: false, naturalWidth: 0, onload: null, onerror: null }
}

function loadedImg(): FakeImg {
  return { complete: true, naturalWidth: 10, onload: null, onerror: null }
}

function installFakeIframe(opts: { readyState: string; images: FakeImg[] }) {
  const print = vi.fn()
  const focus = vi.fn()
  const doc = {
    readyState: opts.readyState,
    images: opts.images,
    open: vi.fn(),
    write: vi.fn(),
    close: vi.fn(),
  }
  let created: HTMLElement | null = null
  const realCreateElement = document.createElement.bind(document)

  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag !== "iframe") return realCreateElement(tag)
    // Un <span> real: es un Node de verdad (appendChild/removeChild funcionan)
    // y, a diferencia de un <iframe> real, jsdom no le dispara un `load`
    // propio — el test decide cuándo llega onload y con qué retraso.
    const el = realCreateElement("span")
    Object.defineProperty(el, "contentDocument", { get: () => doc, configurable: true })
    Object.defineProperty(el, "contentWindow", {
      get: () => ({ focus, print, document: doc }),
      configurable: true,
    })
    created = el
    return el
  }) as typeof document.createElement)

  return { print, focus, doc, fireOnload: () => created?.onload?.(new Event("load")) }
}

type Settlement = "pending" | "resolved" | "rejected"

function track(p: Promise<void>) {
  const state = { value: "pending" as Settlement }
  const done = p.then(
    () => {
      state.value = "resolved"
    },
    () => {
      state.value = "rejected"
    },
  )
  return { state, done }
}

/** Drena la cola de microtasks (varios `await` anidados en la cadena). */
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

const ingresoData: LabelData = { ...baseData, variant: "ingreso" }

describe("printDeviceLabel — el promise cierra recién cuando el print ocurrió", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.innerHTML = ""
  })

  it("onload a tiempo: imprime una sola vez y resuelve después del print", async () => {
    const fake = installFakeIframe({ readyState: "loading", images: [loadedImg()] })

    // baseUrl vacío ⇒ no se genera QR, así que no hay await de qrcode en medio.
    const { state, done } = track(printDeviceLabel(ingresoData, ""))
    expect(fake.print).not.toHaveBeenCalled()

    fake.fireOnload()
    await flush()

    expect(fake.print).toHaveBeenCalledTimes(1)
    await done
    expect(state.value).toBe("resolved")
  })

  it("onload que nunca llega: el timeout imprime igual y el promise cierra", async () => {
    const fake = installFakeIframe({ readyState: "loading", images: [loadedImg()] })
    const { state, done } = track(printDeviceLabel(ingresoData, ""))

    await vi.advanceTimersByTimeAsync(3000)

    expect(fake.print).toHaveBeenCalledTimes(1)
    await done
    expect(state.value).toBe("resolved")
  })

  it("onload tardío con el print en vuelo: NO cierra el promise antes del print", async () => {
    const fake = installFakeIframe({ readyState: "loading", images: [pendingImg()] })
    const { state, done } = track(printDeviceLabel(ingresoData, ""))

    // Se agota la espera de iframe.onload ⇒ arranca el print, que queda
    // esperando la imagen (su propio timeout vence 3s más tarde).
    await vi.advanceTimersByTimeAsync(3000)
    expect(fake.print).not.toHaveBeenCalled()
    expect(state.value).toBe("pending")

    // Llega el onload genuino, tarde, con ese print todavía pendiente.
    fake.fireOnload()
    await flush()

    // La regresión que este test protege: si el segundo runOnce() devolviera
    // una promesa nueva ya resuelta en vez de la del print en vuelo, acá el
    // promise ya estaría cerrado y el loop dispararía la etiqueta siguiente.
    expect(state.value).toBe("pending")
    expect(fake.print).not.toHaveBeenCalled()

    // Vence la espera de la imagen ⇒ recién ahí se imprime, una sola vez.
    await vi.advanceTimersByTimeAsync(3000)
    expect(fake.print).toHaveBeenCalledTimes(1)
    await done
    expect(state.value).toBe("resolved")
  })

  it("onload tardío y print() que falla: el rechazo llega al llamador", async () => {
    const fake = installFakeIframe({ readyState: "loading", images: [pendingImg()] })
    fake.print.mockImplementation(() => {
      throw new Error("print falló")
    })

    const { state, done } = track(printDeviceLabel(ingresoData, ""))

    await vi.advanceTimersByTimeAsync(3000)
    fake.fireOnload()
    await flush()
    await vi.advanceTimersByTimeAsync(3000)

    await done
    expect(state.value).toBe("rejected")
    expect(fake.print).toHaveBeenCalledTimes(1)
  })

  it("documento ya completo: imprime una sola vez sin depender de onload", async () => {
    const fake = installFakeIframe({ readyState: "complete", images: [loadedImg()] })
    const { state, done } = track(printDeviceLabel(ingresoData, ""))

    await flush()

    expect(fake.print).toHaveBeenCalledTimes(1)
    await done
    expect(state.value).toBe("resolved")
  })
})
