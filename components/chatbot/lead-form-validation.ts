export interface LeadFormInput {
  nombre: string
  whatsapp: string
}

export interface LeadFormValidation {
  ok: boolean
  telefono?: string
  error?: string
}

export function validateLeadForm(input: LeadFormInput): LeadFormValidation {
  const nombre = input.nombre.trim()
  if (nombre.length < 2) {
    return { ok: false, error: "Ingresá tu nombre" }
  }
  const telefono = input.whatsapp.replace(/\D/g, "")
  if (telefono.length < 8) {
    return { ok: false, error: "Ingresá un WhatsApp válido (con código de área)" }
  }
  return { ok: true, telefono }
}
