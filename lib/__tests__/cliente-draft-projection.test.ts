import { describe, it, expect } from "vitest"
import {
  SENSITIVE_CLIENTE_FIELDS,
  stripSensitiveClienteFields,
} from "@/lib/cliente-draft-projection"

describe("stripSensitiveClienteFields", () => {
  it("drops every field that must never reach a draft", () => {
    const projected = stripSensitiveClienteFields({
      id: "cli-1",
      nombre: "Ana Gomez",
      telefono: "1122334455",
      tipoCliente: "EMPRESA",
      razonSocial: "Acme SA",
      dni: "30111222",
      cuit: "30-71111111-9",
      email: "ana@acme.test",
      direccion: "Av. Siempreviva 742",
    })

    expect(projected).toEqual({
      id: "cli-1",
      nombre: "Ana Gomez",
      telefono: "1122334455",
      tipoCliente: "EMPRESA",
      razonSocial: "Acme SA",
    })
    for (const field of SENSITIVE_CLIENTE_FIELDS) {
      expect(projected).not.toHaveProperty(field)
    }
  })

  it("leaves the caller's own object untouched", () => {
    // The call sites read live form state through getValue(): projecting must
    // not take the customer's document out of the form on its way to storage.
    const values = { nombre: "Ana Gomez", dni: "30111222" }

    stripSensitiveClienteFields(values)

    expect(values.dni).toBe("30111222")
  })
})
