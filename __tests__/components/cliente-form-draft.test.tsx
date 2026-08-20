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

function makeCliente(overrides: Partial<Cliente> = {}): Cliente {
  return {
    id: "cli-1",
    nombre: "Juan Perez",
    telefono: "1100000000",
    email: null,
    createdAt: new Date(),
    updatedAt: new Date(),
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
})
