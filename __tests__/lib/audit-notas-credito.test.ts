// @vitest-environment node
import { describe, it, expect } from "vitest"
import { generateDescription } from "@/lib/audit"

describe("auditoría — nota de crédito", () => {
  it("la emisión se lee como 'Creó nota de crédito', no con el nombre de la tabla", () => {
    expect(generateDescription("CREATE", "notas_credito", "ckabc123456")).toBe("Creó nota de crédito #123456")
  })
})
