/**
 * Cubre el wiring de useFormDraft (hooks/use-form-draft.ts) dentro de
 * ClienteForm: un borrador valido en localStorage se restaura al abrir el
 * dialog, con la key scopeada por cliente.id (edicion) o "new" (alta) --
 * nunca se cruzan. "Descartar" borra el borrador y vuelve el formulario al
 * prefill/blanco base.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
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


/** "Descartar" pasa por una confirmacion (components/ui/draft-restored-notice.tsx):
 *  un click solo abre el dialogo, el borrador recien se pierde al confirmar. El
 *  dialogo abre en el mismo commit del click, asi que se busca sincronico:
 *  findBy* cuelga en los bloques que corren con timers falsos. */
async function descartarBorrador() {
  fireEvent.click(screen.getByRole("button", { name: "Descartar" }))
  fireEvent.click(screen.getByRole("button", { name: "Descartar borrador" }))
  // El handler descarta recien cuando resuelve la promesa del dialogo.
  await act(async () => {})
}

describe("ClienteForm — borrador local", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "c1" }) }))
    window.localStorage.clear()
  })

  it("restaura un borrador de alta ('new') y muestra el aviso dismissible", () => {
    window.localStorage.setItem(
      "draft:v2:cliente-form:org-1:user-1:new",
      JSON.stringify({
        version: 2,
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
      "draft:v2:cliente-form:org-1:user-1:new",
      JSON.stringify({
        version: 2,
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

  it('"Descartar" borra el borrador y vuelve al prefill del cliente', async () => {
    window.localStorage.setItem(
      "draft:v2:cliente-form:org-1:user-1:edit:cli-1",
      JSON.stringify({
        version: 2,
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

    await descartarBorrador()

    expect(screen.queryByText(/se restauró un borrador no guardado/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText("Nombre *")).toHaveValue("Juan Perez")
    expect(window.localStorage.getItem("draft:v2:cliente-form:org-1:user-1:edit:cli-1")).toBeNull()
  })

  it("una revalidacion del cliente no pisa el borrador restaurado", () => {
    // cliente-detalle.tsx alimenta este prop desde SWR: cada revalidacion trae
    // un objeto nuevo con los mismos datos. Si el prefill depende de la
    // identidad del objeto, vuelve a resetear el formulario y se lleva puesto
    // el borrador mientras el aviso sigue diciendo que se restauro uno.
    const key = "draft:v2:cliente-form:org-1:user-1:edit:cli-1"
    window.localStorage.setItem(
      key,
      JSON.stringify({
        version: 2,
        savedAt: Date.now(),
        recordUpdatedAt: CLIENTE_UPDATED_AT.getTime(),
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

    const { rerender } = render(
      <ModalProvider>
        <ClienteForm cliente={makeCliente()} open onClose={vi.fn()} onSuccess={vi.fn()} />
      </ModalProvider>,
    )
    expect(screen.getByLabelText("Nombre *")).toHaveValue("Juan Editado Sin Guardar")

    // Misma ficha, objeto nuevo: es lo unico que cambia en una revalidacion.
    rerender(
      <ModalProvider>
        <ClienteForm cliente={makeCliente()} open onClose={vi.fn()} onSuccess={vi.fn()} />
      </ModalProvider>,
    )

    expect(screen.getByLabelText("Nombre *")).toHaveValue("Juan Editado Sin Guardar")
  })

  it("muestra el guardado de otro usuario cuando el dialog no tiene nada escrito", async () => {
    // El prefill depende de `cliente?.id` (y no de la identidad del objeto)
    // para que una revalidacion de SWR no se lleve puesto lo que el operador
    // esta escribiendo. Pero cuando no escribio NADA no hay nada que proteger:
    // sin refrescar, el dialog se queda con la version vieja de la ficha y
    // "Guardar" manda el registro entero, pisando en silencio lo que guardo el
    // companero. El aviso de conflicto tampoco sale (el hook re-inicializa,
    // porque no hay trabajo del que hacerse cargo).
    const { rerender } = render(
      <ModalProvider>
        <ClienteForm cliente={makeCliente()} open onClose={vi.fn()} onSuccess={vi.fn()} />
      </ModalProvider>,
    )
    expect(screen.getByLabelText("Nombre *")).toHaveValue("Juan Perez")

    // El companero guarda la ficha; SWR revalida y trae los datos nuevos.
    rerender(
      <ModalProvider>
        <ClienteForm
          cliente={makeCliente({
            nombre: "Juan Perez Actualizado",
            telefono: "1155556666",
            updatedAt: new Date("2026-01-03T10:00:00.000Z"),
          })}
          open
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      </ModalProvider>,
    )

    expect(screen.getByLabelText("Nombre *")).toHaveValue("Juan Perez Actualizado")
    expect(screen.getByLabelText("Teléfono *")).toHaveValue("1155556666")
    // Nada que avisar: en pantalla estan los datos del companero.
    expect(screen.queryByText(/otro usuario guardó esta ficha/i)).not.toBeInTheDocument()
  })

  it("no pisa lo que el operador escribio cuando otro usuario guarda la ficha", async () => {
    // La otra mitad de la regla: si hay algo escrito, se conserva y el
    // conflicto se avisa. Refrescar aca seria perder trabajo sin decirlo.
    const { rerender } = render(
      <ModalProvider>
        <ClienteForm cliente={makeCliente()} open onClose={vi.fn()} onSuccess={vi.fn()} />
      </ModalProvider>,
    )
    fireEvent.change(screen.getByLabelText("Nombre *"), {
      target: { value: "Juan Perez (sin guardar)" },
    })

    rerender(
      <ModalProvider>
        <ClienteForm
          cliente={makeCliente({
            nombre: "Juan Perez Actualizado",
            updatedAt: new Date("2026-01-03T10:00:00.000Z"),
          })}
          open
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      </ModalProvider>,
    )

    expect(screen.getByLabelText("Nombre *")).toHaveValue("Juan Perez (sin guardar)")
    expect(screen.getByText(/otro usuario guardó esta ficha/i)).toBeInTheDocument()
  })

  it("descarta un borrador cuya forma ya no es la del formulario", () => {
    // DRAFT_SCHEMA_VERSION se mantiene a mano: si alguien cambia los campos de
    // este formulario sin tocarla, el borrador viejo (hasta 7 dias) pasa las
    // validaciones del sobre igual. `reset()` no tira excepcion con una forma
    // equivocada -- aplica lo que le den -- asi que el try/catch de abajo no lo
    // agarra: el dialog abre con campos vacios o con basura y esos valores se
    // van tal cual en el PUT/POST.
    const key = "draft:v2:cliente-form:org-1:user-1:new"
    window.localStorage.setItem(
      key,
      JSON.stringify({
        version: 2,
        savedAt: Date.now(),
        data: { nombre: 42, direccion: "Calle Falsa 123" },
      }),
    )

    render(
      <ModalProvider>
        <ClienteForm cliente={null} open onClose={vi.fn()} onSuccess={vi.fn()} />
      </ModalProvider>,
    )

    expect(screen.queryByText(/se restauró un borrador no guardado/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText("Nombre *")).toHaveValue("")
    expect(window.localStorage.getItem(key)).toBeNull()
  })

  it("aplica un borrador que aparece despues de abrir el dialog", () => {
    // localStorage se comparte entre pestanas: la del mostrador puede escribir
    // el borrador de esta misma ficha mientras el dialog ya esta abierto. Si el
    // formulario se marca como "borrador aplicado" antes de saber si habia uno,
    // esa entrada no se aplica nunca -- pero el hook si la cuenta como
    // restaurada, asi que despues la pisa en silencio con lo que hay en
    // pantalla y el aviso nunca aparece.
    const key = "draft:v2:cliente-form:org-1:user-1:edit:cli-1"

    const { rerender } = render(
      <ModalProvider>
        <ClienteForm cliente={makeCliente()} open onClose={vi.fn()} onSuccess={vi.fn()} />
      </ModalProvider>,
    )
    expect(screen.getByLabelText("Nombre *")).toHaveValue("Juan Perez")

    const otroUpdatedAt = new Date("2026-01-02T10:00:00.000Z")
    window.localStorage.setItem(
      key,
      JSON.stringify({
        version: 2,
        savedAt: Date.now(),
        recordUpdatedAt: otroUpdatedAt.getTime(),
        data: {
          tipoCliente: "INDIVIDUAL",
          nombre: "Escrito en la otra pestana",
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

    // La revalidacion que trae el guardado de la otra pestana: mueve el token
    // de frescura y vuelve a correr la lectura del borrador.
    rerender(
      <ModalProvider>
        <ClienteForm
          cliente={makeCliente({ updatedAt: otroUpdatedAt })}
          open
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      </ModalProvider>,
    )

    expect(screen.getByLabelText("Nombre *")).toHaveValue("Escrito en la otra pestana")
    expect(screen.getByText(/se restauró un borrador no guardado/i)).toBeInTheDocument()
  })

  it("no aplica el borrador de una ficha al reabrir el dialog sobre otra", () => {
    // El dialog se queda montado con open=false entre usos y el hook pausado no
    // limpia `draft`, asi que al reabrir sobre otra ficha el borrador de la
    // anterior sigue ahi por un commit. Un latch por scope (recordId) se
    // adelanta al hook -- el scope cambia en el render, `draft` recien en el
    // commit siguiente -- y aplicaba ese borrador sobre la ficha equivocada. El
    // latch va por identidad del objeto justamente para que no pueda pasar.
    window.localStorage.setItem(
      "draft:v2:cliente-form:org-1:user-1:edit:cli-1",
      JSON.stringify({
        version: 2,
        savedAt: Date.now(),
        recordUpdatedAt: CLIENTE_UPDATED_AT.getTime(),
        data: {
          tipoCliente: "INDIVIDUAL",
          nombre: "Borrador de la ficha 1",
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

    const otraFicha = makeCliente({ id: "cli-2", nombre: "Otra Persona" })
    const { rerender } = render(
      <ModalProvider>
        <ClienteForm cliente={makeCliente()} open onClose={vi.fn()} onSuccess={vi.fn()} />
      </ModalProvider>,
    )
    expect(screen.getByLabelText("Nombre *")).toHaveValue("Borrador de la ficha 1")

    rerender(
      <ModalProvider>
        <ClienteForm cliente={makeCliente()} open={false} onClose={vi.fn()} onSuccess={vi.fn()} />
      </ModalProvider>,
    )
    rerender(
      <ModalProvider>
        <ClienteForm cliente={otraFicha} open onClose={vi.fn()} onSuccess={vi.fn()} />
      </ModalProvider>,
    )

    expect(screen.getByLabelText("Nombre *")).toHaveValue("Otra Persona")
    expect(screen.queryByText(/se restauró un borrador no guardado/i)).not.toBeInTheDocument()
  })

  it("conserva el borrador ya aplicado cuando otro usuario guarda la ficha en el medio", () => {
    // El efecto de la key vuelve a correr cada vez que SWR trae un `updatedAt`
    // nuevo. Sobre un dialog que YA tiene el borrador aplicado en pantalla y
    // que el operador todavia no toco, re-inicializar borraba la entrada por
    // desactualizada y ponia `draft` en null mientras el formulario seguia
    // mostrando esos valores y el aviso seguia anunciando el borrador:
    // "Guardar" pisaba el guardado del companero con exactamente el contenido
    // que el token de frescura existe para rechazar.
    const key = "draft:v2:cliente-form:org-1:user-1:edit:cli-1"
    window.localStorage.setItem(
      key,
      JSON.stringify({
        version: 2,
        savedAt: Date.now(),
        recordUpdatedAt: CLIENTE_UPDATED_AT.getTime(),
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

    const { rerender } = render(
      <ModalProvider>
        <ClienteForm cliente={makeCliente()} open onClose={vi.fn()} onSuccess={vi.fn()} />
      </ModalProvider>,
    )
    expect(screen.getByLabelText("Nombre *")).toHaveValue("Juan Editado Sin Guardar")

    // El companero guarda la misma ficha; SWR revalida y el token se mueve.
    rerender(
      <ModalProvider>
        <ClienteForm
          cliente={makeCliente({ updatedAt: new Date("2026-01-03T10:00:00.000Z") })}
          open
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      </ModalProvider>,
    )

    expect(screen.getByLabelText("Nombre *")).toHaveValue("Juan Editado Sin Guardar")
    expect(screen.getByText(/se restauró un borrador no guardado/i)).toBeInTheDocument()
    expect(window.localStorage.getItem(key)).not.toBeNull()
    // Nadie pierde en silencio: el conflicto se avisa y lo resuelve el operador.
    expect(screen.getByText(/otro usuario guardó esta ficha/i)).toBeInTheDocument()
  })

  it("descarta un borrador de edicion si otro usuario guardo el cliente despues", () => {
    // El submit de edicion manda el formulario entero (PUT /api/clientes/:id),
    // asi que restaurar un borrador viejo encima de un registro mas nuevo
    // pisaria en silencio lo que guardo el otro usuario.
    const key = "draft:v2:cliente-form:org-1:user-1:edit:cli-1"
    // Borrador reciente (dentro de la ventana de 7 dias) escrito cuando el
    // registro tenia otro updatedAt: alguien lo guardo en el medio.
    const savedAt = Date.now() - 60_000
    window.localStorage.setItem(
      key,
      JSON.stringify({
        version: 2,
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
