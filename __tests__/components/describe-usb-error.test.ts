// @vitest-environment node
import { describe, it, expect } from "vitest"
import { describeUsbError } from "@/components/pos/use-thermal-printer"

const mk = (name: string, message: string) => Object.assign(new Error(message), { name })

describe("describeUsbError", () => {
  it("SecurityError → mensaje accionable que redirige al camino navegador", () => {
    const msg = describeUsbError(mk("SecurityError", "Access denied"))
    expect(msg).toContain("driver")
    expect(msg).toContain("Imprimir (navegador)")
  })

  it("mensajes con 'claim' o 'protected class' → mismo mensaje del driver", () => {
    expect(describeUsbError(mk("NetworkError", "Unable to claim interface"))).toContain("Imprimir (navegador)")
    expect(describeUsbError(mk("SecurityError", "The requested interface implements a protected class"))).toContain("Imprimir (navegador)")
  })

  it("NetworkError sin claim → desconexion", () => {
    expect(describeUsbError(mk("NetworkError", "Device unavailable"))).toContain("desconect")
  })

  it("otros errores conservan su mensaje; sin mensaje → generico", () => {
    expect(describeUsbError(mk("TypeError", "boom"))).toBe("boom")
    expect(describeUsbError(null)).toBe("Error al conectar impresora")
  })
})
