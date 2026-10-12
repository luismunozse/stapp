import { describe, it, expect } from "vitest"
import { getTaxIdLabel, getPersonalIdLabel, getCombinedIdLabel } from "@/lib/countries"

describe("getTaxIdLabel", () => {
  it("uses the country's own label", () => {
    expect(getTaxIdLabel("AR")).toBe("CUIT")
    expect(getTaxIdLabel("ES")).toBe("NIF")
    expect(getTaxIdLabel("MX")).toBe("RFC")
  })

  it("falls back to Argentina when the country is missing or unknown", () => {
    expect(getTaxIdLabel(undefined)).toBe("CUIT")
    expect(getTaxIdLabel(null)).toBe("CUIT")
    expect(getTaxIdLabel("")).toBe("CUIT")
    expect(getTaxIdLabel("ZZ")).toBe("CUIT")
  })
})

describe("getPersonalIdLabel", () => {
  it("uses the country's own label", () => {
    expect(getPersonalIdLabel("AR")).toBe("DNI")
    expect(getPersonalIdLabel("ES")).toBe("DNI/NIE")
  })

  it("falls back to Argentina when the country is missing or unknown", () => {
    expect(getPersonalIdLabel(undefined)).toBe("DNI")
    expect(getPersonalIdLabel("ZZ")).toBe("DNI")
  })
})

describe("getCombinedIdLabel", () => {
  it("is byte-identical to the legacy hardcoded labels for Argentina", () => {
    expect(getCombinedIdLabel("AR", "personal-primero")).toBe("DNI/CUIT")
    expect(getCombinedIdLabel("AR", "fiscal-primero")).toBe("CUIT/DNI")
  })

  it("uses the short combined label of the country, in either order", () => {
    expect(getCombinedIdLabel("ES", "personal-primero")).toBe("NIF/NIE")
    expect(getCombinedIdLabel("ES", "fiscal-primero")).toBe("NIF/NIE")
    expect(getCombinedIdLabel("CL", "personal-primero")).toBe("RUT")
    expect(getCombinedIdLabel("CL", "fiscal-primero")).toBe("RUT")
  })

  it("composes the labels when the country has no short one", () => {
    expect(getCombinedIdLabel("MX", "personal-primero")).toBe("CURP/RFC")
    expect(getCombinedIdLabel("MX", "fiscal-primero")).toBe("RFC/CURP")
  })

  it("falls back to the Argentine labels when the country is missing", () => {
    expect(getCombinedIdLabel(undefined, "personal-primero")).toBe("DNI/CUIT")
    expect(getCombinedIdLabel(null, "fiscal-primero")).toBe("CUIT/DNI")
  })
})
