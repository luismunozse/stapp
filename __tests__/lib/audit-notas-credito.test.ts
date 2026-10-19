// @vitest-environment node
import { describe, it, expect } from "vitest"
import { generateDescription } from "@/lib/audit"

describe("auditoría — nota de crédito", () => {
  it("la emisión se lee como 'Creó nota de crédito', no con el nombre de la tabla", () => {
    expect(generateDescription("CREATE", "notas_credito", "ckabc123456")).toBe("Creó nota de crédito #123456")
  })

  it("la anulación se lee 'Anuló nota de crédito' con su número, no como un campo que cambió", () => {
    expect(
      generateDescription("UPDATE", "notas_credito", "ckabc123456", {
        before: { anulada: false },
        after: { anulada: true, numero: "NC-000012", motivo: "Se cargó por error" },
      })
    ).toBe("Anuló nota de crédito NC-000012 #123456")
  })

  it("caracterización: un UPDATE común sigue nombrando el campo que cambió", () => {
    expect(
      generateDescription("UPDATE", "ventas", "ckabc123456", {
        before: { estado: "COMPLETADA" },
        after: { estado: "ANULADA" },
      })
    ).toBe("Cambió estado de 'COMPLETADA' a 'ANULADA' en venta #123456")
  })
})
