import { describe, it, expect } from "vitest"
import { validarDestinoWhatsApp } from "@/lib/whatsapp/destino"

/**
 * En prod el 52% de los destinos guardados tiene 8 digitos: es el numero local
 * sin codigo de area. Formatearlo produce 54 + 8 digitos, que no le llega a
 * nadie — Evolution devuelve "Bad Request" y el taller ve un fallo sin motivo.
 */
describe("validarDestinoWhatsApp", () => {
  it("rechaza el numero argentino sin codigo de area", () => {
    const r = validarDestinoWhatsApp("60351282", "AR")
    expect(r.valido).toBe(false)
    if (!r.valido) expect(r.motivo).toMatch(/c[oó]digo de [aá]rea|faltan/i)
  })

  it("acepta el argentino completo con codigo de area", () => {
    expect(validarDestinoWhatsApp("1160351282", "AR").valido).toBe(true)
  })

  it("acepta el argentino ya con codigo de pais", () => {
    expect(validarDestinoWhatsApp("541160351282", "AR").valido).toBe(true)
  })

  it("acepta el argentino con + y separadores", () => {
    expect(validarDestinoWhatsApp("+54 9 11 6035-1282", "AR").valido).toBe(true)
  })

  it("acepta el argentino con 0 de larga distancia", () => {
    expect(validarDestinoWhatsApp("01160351282", "AR").valido).toBe(true)
  })

  it("rechaza vacio", () => {
    const r = validarDestinoWhatsApp("", "AR")
    expect(r.valido).toBe(false)
    if (!r.valido) expect(r.motivo).toMatch(/sin tel[eé]fono|vac/i)
  })

  it("rechaza texto sin digitos", () => {
    expect(validarDestinoWhatsApp("no tiene", "AR").valido).toBe(false)
  })

  it("usa el minimo del pais: 9 digitos es valido en Chile pero no en Argentina", () => {
    expect(validarDestinoWhatsApp("912345678", "CL").valido).toBe(true)
    expect(validarDestinoWhatsApp("912345678", "AR").valido).toBe(false)
  })

  it("sin pais conocido asume Argentina, como el resto del sistema", () => {
    expect(validarDestinoWhatsApp("60351282", null).valido).toBe(false)
    expect(validarDestinoWhatsApp("1160351282", null).valido).toBe(true)
  })

  it("no rechaza por ser largo: un internacional con codigo de pais pasa", () => {
    expect(validarDestinoWhatsApp("+5215512345678", "MX").valido).toBe(true)
  })

  it("el motivo dice cuantos digitos hay, para que el taller sepa que corregir", () => {
    const r = validarDestinoWhatsApp("60351282", "AR")
    if (!r.valido) expect(r.motivo).toMatch(/8/)
    else throw new Error("deberia ser invalido")
  })
})
