/**
 * Cubre el wiring de useFormDraft (hooks/use-form-draft.ts) dentro de
 * ClienteForm: un borrador valido en localStorage se restaura al abrir el
 * dialog, con la key scopeada por cliente.id (edicion) o "new" (alta) --
 * nunca se cruzan. "Descartar" borra el borrador y vuelve el formulario al
 * prefill/blanco base.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"
import { ClienteForm } from "@/components/clientes/cliente-form"
import type { Cliente } from "@/types"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1", organizationId: "org-1", role: "ADMIN" } } }),
}))

/** `updatedAt` fijo y viejo a proposito: es el token de frescura que el hook
 *  compara contra el borrador. Con `new Date()` el registro quedaria empatado
 *  (o un milisegundo por delante) con el borrador recien escrito y el
 *  resultado del test dependeria del reloj. */
const CLIENTE_UPDATED_AT = new Date("2026-01-01T10:00:00.000Z")

function makeCliente(overrides: Partial<Cliente> = {}): Cliente {
  return {
    id: "cli-1",
    nombre: "Juan Perez",
    telefono: "1100000000",
    email: null,
    createdAt: new Date("2026-01-01T09:00:00.000Z"),
    updatedAt: CLIENTE_UPDATED_AT,
    ...overrides,
  }
}

describe("ClienteForm — borrador local", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "c1" }) }))
    window.localStorage.clear()
  })

  it("restaura un borrador de alta ('new') y muestra el aviso dismissible", () => {
    window.localStorage.setItem(
      "draft:v1:cliente-form:org-1:user-1:new",
      JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        data: {
          tipoCliente: "INDIVIDUAL",
          nombre: "Ana Restaurada",
          telefono: "1122334455",
          email: "",
          direccion: "",
          dni: "",
          razonSocial: "",
          cuit: "",
          aceptaWhatsapp: true,
          tipoPrecio: "MINORISTA",
          descuentoPct: undefined,
        },
      }),
    )

    render(
      <ModalProvider>
        <ClienteForm cliente={null} open onClose={vi.fn()} onSuccess={vi.fn()} />
      </ModalProvider>,
    )

    expect(screen.getByText(/se restauró un borrador no guardado/i)).toBeInTheDocument()
    expect(screen.getByLabelText("Nombre *")).toHaveValue("Ana Restaurada")
  })

  it("no restaura un borrador de alta en un formulario de edicion (recordId distinto)", () => {
    window.localStorage.setItem(
      "draft:v1:cliente-form:org-1:user-1:new",
      JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        data: {
          tipoCliente: "INDIVIDUAL",
          nombre: "Borrador de alta",
          telefono: "1122334455",
          email: "",
          direccion: "",
          dni: "",
          razonSocial: "",
          cuit: "",
          aceptaWhatsapp: true,
          tipoPrecio: "MINORISTA",
          descuentoPct: undefined,
        },
      }),
    )

    render(
      <ModalProvider>
        <ClienteForm cliente={makeCliente()} open onClose={vi.fn()} onSuccess={vi.fn()} />
      </ModalProvider>,
    )

    expect(screen.queryByText(/se restauró un borrador no guardado/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText("Nombre *")).toHaveValue("Juan Perez")
  })

  it('"Descartar" borra el borrador y vuelve al prefill del cliente', () => {
    window.localStorage.setItem(
      "draft:v1:cliente-form:org-1:user-1:edit:cli-1",
      JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        data: {
          tipoCliente: "INDIVIDUAL",
          nombre: "Juan Editado Sin Guardar",
          telefono: "1100000000",
          email: "",
          direccion: "",
          dni: "",
          razonSocial: "",
          cuit: "",
          aceptaWhatsapp: true,
          tipoPrecio: "MINORISTA",
          descuentoPct: undefined,
        },
      }),
    )

    render(
      <ModalProvider>
        <ClienteForm cliente={makeCliente()} open onClose={vi.fn()} onSuccess={vi.fn()} />
      </ModalProvider>,
    )
    expect(screen.getByLabelText("Nombre *")).toHaveValue("Juan Editado Sin Guardar")

    fireEvent.click(screen.getByRole("button", { name: /descartar/i }))

    expect(screen.queryByText(/se restauró un borrador no guardado/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText("Nombre *")).toHaveValue("Juan Perez")
    expect(window.localStorage.getItem("draft:v1:cliente-form:org-1:user-1:edit:cli-1")).toBeNull()
  })

  it("descarta un borrador de edicion si otro usuario guardo el cliente despues", () => {
    // El submit de edicion manda el formulario entero (PUT /api/clientes/:id),
    // asi que restaurar un borrador viejo encima de un registro mas nuevo
    // pisaria en silencio lo que guardo el otro usuario.
    const key = "draft:v1:cliente-form:org-1:user-1:edit:cli-1"
    // Borrador reciente (dentro de la ventana de 7 dias) escrito cuando el
    // registro tenia otro updatedAt: alguien lo guardo en el medio.
    const savedAt = Date.now() - 60_000
    window.localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        savedAt,
        recordUpdatedAt: savedAt - 60_000,
        data: {
          tipoCliente: "INDIVIDUAL",
          nombre: "Version vieja sin guardar",
          telefono: "1100000000",
          email: "",
          direccion: "",
          dni: "",
          razonSocial: "",
          cuit: "",
          aceptaWhatsapp: true,
          tipoPrecio: "MINORISTA",
          descuentoPct: undefined,
        },
      }),
    )

    render(
      <ModalProvider>
        <ClienteForm
          cliente={makeCliente({ updatedAt: new Date(Date.now() - 10_000) })}
          open
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      </ModalProvider>,
    )

    expect(screen.queryByText(/se restauró un borrador no guardado/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText("Nombre *")).toHaveValue("Juan Perez")
    expect(window.localStorage.getItem(key)).toBeNull()
  })
})
