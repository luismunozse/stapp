// @vitest-environment node
import { describe, it, expect } from "vitest"
import { generateOrdenTicketCommands, type OrdenTicketData } from "@/lib/escpos"
import { resolveTerminologia } from "@/lib/terminologia"
import { defaultProfile } from "@/lib/thermal-paper"

function decode(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes)
}

const baseData: OrdenTicketData = {
  numeroOrden: 42,
  fechaIngreso: "01/07/2026 10:30",
  estado: "Recibido",
  cliente: { nombre: "Juan Perez", telefono: "1122334455" },
  dispositivo: "iPhone 13 Pro",
  tipo: "Celular",
  marca: "Apple",
  problemaReportado: "No enciende",
}

describe("generateOrdenTicketCommands — seccion dispositivo", () => {
  it("lista Tipo:, Marca: y Modelo: con sus valores", () => {
    const text = decode(generateOrdenTicketCommands(baseData, defaultProfile(80)))
    expect(text).toMatch(/Tipo:\s+Celular/)
    expect(text).toMatch(/Marca:\s+Apple/)
    expect(text).toMatch(/Modelo:\s+iPhone 13 Pro/)
  })

  it("omite Tipo y Marca sin datos, pero Modelo se imprime siempre", () => {
    const text = decode(generateOrdenTicketCommands({ ...baseData, tipo: null, marca: null }, defaultProfile(80)))
    expect(text).not.toContain("Tipo:")
    expect(text).not.toContain("Marca:")
    expect(text).toMatch(/Modelo:\s+iPhone 13 Pro/)
  })

  it("el identificador del equipo usa la terminologia, nunca 'IMEI' hardcodeado", () => {
    const withImei = { ...baseData, imei: "354829106712345" }

    const porDefecto = decode(generateOrdenTicketCommands(withImei, defaultProfile(80)))
    expect(porDefecto).toMatch(/N.mero de serie:\s+354829106712345/)
    expect(porDefecto).not.toContain("IMEI:")

    const custom = resolveTerminologia({ serie: "Patente" })
    const conOverride = decode(generateOrdenTicketCommands(withImei, defaultProfile(80), custom))
    expect(conOverride).toMatch(/Patente:\s+354829106712345/)
  })

  it("Marca y Modelo respetan overrides de terminologia", () => {
    const custom = resolveTerminologia({ marca: "Fabricante", modelo: "Version" })
    const text = decode(generateOrdenTicketCommands(baseData, defaultProfile(80), custom))
    expect(text).toMatch(/Fabricante:\s+Apple/)
    expect(text).toMatch(/Version:\s+iPhone 13 Pro/)
  })

  it("con label largo en 58mm el valor pasa a linea propia sin perderse", () => {
    // Override sin cap de longitud: el valor no debe colapsar a 1 caracter
    const custom = resolveTerminologia({ serie: "Numero de identificacion vehicular" })
    const text = decode(
      generateOrdenTicketCommands({ ...baseData, imei: "354829106712345" }, defaultProfile(58), custom),
    )
    expect(text).toContain("354829106712345")
    const lines = text.split("\n")
    const labelLine = lines.find((l) => l.includes("identificacion"))
    const valueLine = lines.find((l) => l.includes("354829106712345"))
    expect(labelLine).toBeDefined()
    expect(labelLine!.length).toBeLessThanOrEqual(33) // truncado a 32 + \r opcional
    expect(valueLine).toMatch(/^ 354829106712345/)
  })

  it("respeta el ancho de 58mm truncando valores largos", () => {
    const text = decode(
      generateOrdenTicketCommands(
        { ...baseData, dispositivo: "MacBook Pro 16 M3 Max 2023 Space Black Edition" },
        defaultProfile(58),
      ),
    )
    const modeloLine = text.split("\n").find((l) => l.includes("Modelo:"))
    expect(modeloLine).toBeDefined()
    expect(modeloLine!.length).toBeLessThanOrEqual(33) // 32 chars + posible \r
  })
})
