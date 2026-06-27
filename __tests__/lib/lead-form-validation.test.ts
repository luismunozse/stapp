import { describe, it, expect } from "vitest"
import { validateLeadForm } from "@/components/chatbot/lead-form-validation"

describe("validateLeadForm", () => {
  it("rechaza nombre vacío o muy corto", () => {
    expect(validateLeadForm({ nombre: " ", whatsapp: "1112345678" }).ok).toBe(false)
    expect(validateLeadForm({ nombre: "A", whatsapp: "1112345678" }).ok).toBe(false)
  })
  it("rechaza WhatsApp con menos de 8 dígitos", () => {
    const r = validateLeadForm({ nombre: "Juan", whatsapp: "12-34" })
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })
  it("acepta y limpia el WhatsApp a dígitos", () => {
    const r = validateLeadForm({ nombre: "  Juan Pérez ", whatsapp: "+54 9 11 1234-5678" })
    expect(r.ok).toBe(true)
    expect(r.telefono).toBe("5491112345678")
  })
})
