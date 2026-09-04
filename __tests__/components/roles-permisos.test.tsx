import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react"

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { RolesPermisos } from "@/components/configuracion/roles-permisos"

const EQUIPO = [
  {
    id: "u-1",
    nombre: "Ana Gómez",
    email: "ana@taller.test",
    rol: "ADMIN",
    sucursalId: null,
    activo: true,
    porcentajeComision: 0,
  },
  {
    id: "u-2",
    nombre: "Juan Pérez",
    email: "juan@taller.test",
    rol: "TECNICO",
    sucursalId: "suc-A",
    activo: true,
    porcentajeComision: 15,
  },
  {
    id: "u-3",
    nombre: "Eva Ruiz",
    email: "eva@taller.test",
    rol: "TECNICO",
    sucursalId: "suc-A",
    activo: false,
    porcentajeComision: 10,
  },
]

/** Ruteo de fetch por URL: la pantalla pide el equipo y la configuración. */
function mockFetch(overrides: { patch?: any } = {}) {
  const patchSpy = vi.fn()
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/usuarios") {
        return { ok: true, json: async () => EQUIPO }
      }
      if (url === "/api/configuracion") {
        return {
          ok: true,
          json: async () => ({
            tecnicosOperanPos: true,
            tecnicosCobranCotizaciones: false,
            vendedoresAdministranInventario: false,
            vendedoresManejanCaja: false,
          }),
        }
      }
      if (url.endsWith("/rol")) {
        patchSpy(url, JSON.parse(String(init?.body ?? "{}")))
        return {
          ok: overrides.patch?.ok ?? true,
          json: async () =>
            overrides.patch?.body ?? { success: true, message: "Listo" },
        }
      }
      return { ok: true, json: async () => ({}) }
    }),
  )
  return { patchSpy }
}

async function abrirModalDe(nombre: string) {
  render(<RolesPermisos allowEdit />)
  await screen.findByText(nombre)
  const fila = screen.getByText(nombre).closest("li")!
  fireEvent.click(within(fila).getByRole("button", { name: /cambiar rol/i }))
}

describe("Roles y permisos", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch()
  })

  it("lista al equipo entero, con los tres roles juntos", async () => {
    render(<RolesPermisos allowEdit />)

    expect(await screen.findByText("Ana Gómez")).toBeInTheDocument()
    expect(screen.getByText("Juan Pérez")).toBeInTheDocument()
    expect(screen.getByText("Eva Ruiz")).toBeInTheDocument()
  })

  it('al usuario con activo=false NO lo llama "Inactivo"', async () => {
    // `users.activo` no bloquea el login: solo saca a la persona de los
    // desplegables de asignación. Decirle "Inactivo" le haría creer al dueño
    // que le sacó la entrada al sistema. Se nombra por lo que hace.
    render(<RolesPermisos allowEdit />)

    await screen.findByText("Eva Ruiz")
    expect(screen.getByText("No recibe asignaciones")).toBeInTheDocument()
    expect(screen.queryByText(/^Inactivo$/i)).not.toBeInTheDocument()
  })

  it("pide el % de comisión al pasar de Técnico a Vendedor, y dice sobre qué se aplica", async () => {
    await abrirModalDe("Juan Pérez")

    // Sin cambiar el rol todavía no hay nada que confirmar.
    expect(screen.queryByLabelText(/comisión como/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("radio", { name: /vendedor/i }))

    const campo = await screen.findByLabelText(/comisión como vendedor/i)
    // Viene con el número viejo a la vista: el riesgo no es el número, es que
    // la base de cálculo cambió sin que nadie lo diga.
    expect(campo).toHaveValue(15)
    expect(screen.getByText(/venía de 15% sobre reparaciones/i)).toBeInTheDocument()
    expect(screen.getByText(/ahora se aplica sobre cada venta/i)).toBeInTheDocument()
  })

  it("NO pide comisión al pasar a Administrador", async () => {
    await abrirModalDe("Juan Pérez")
    fireEvent.click(screen.getByRole("radio", { name: /administrador/i }))

    expect(screen.queryByLabelText(/comisión como/i)).not.toBeInTheDocument()
  })

  it("manda el rol y la comisión confirmada", async () => {
    const { patchSpy } = mockFetch()
    await abrirModalDe("Juan Pérez")

    fireEvent.click(screen.getByRole("radio", { name: /vendedor/i }))
    const campo = await screen.findByLabelText(/comisión como vendedor/i)
    fireEvent.change(campo, { target: { value: "5" } })
    fireEvent.click(screen.getByRole("button", { name: /^cambiar rol$/i }))

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith("/api/usuarios/u-2/rol", {
        rol: "VENDEDOR",
        porcentajeComision: 5,
      })
    })
  })

  it("no deja confirmar si el rol no cambió", async () => {
    await abrirModalDe("Juan Pérez")

    expect(screen.getByRole("button", { name: /^cambiar rol$/i })).toBeDisabled()
  })

  it("avisa que la persona tiene que volver a entrar", async () => {
    // El cambio no es inmediato: el JWT ya firmado vive hasta su exp. Sin este
    // aviso el dueño cree que aplicó y abre un ticket.
    await abrirModalDe("Juan Pérez")
    fireEvent.click(screen.getByRole("radio", { name: /vendedor/i }))

    expect(
      screen.getByText(/va a tener que volver a iniciar sesión/i),
    ).toBeInTheDocument()
  })

  it("muestra los permisos agrupados por rol, con el estado que vino de la org", async () => {
    render(<RolesPermisos allowEdit />)

    const pos = await screen.findByRole("checkbox", {
      name: /vender desde el punto de venta/i,
    })
    expect(pos).toBeChecked()
    expect(
      screen.getByRole("checkbox", { name: /cobrar sus propias cotizaciones/i }),
    ).not.toBeChecked()
  })

  it("con allowEdit en false no se puede tocar nada", async () => {
    render(<RolesPermisos allowEdit={false} />)

    await screen.findByText("Juan Pérez")
    for (const b of screen.getAllByRole("button", { name: /cambiar rol/i })) {
      expect(b).toBeDisabled()
    }
    expect(
      await screen.findByRole("checkbox", { name: /vender desde el punto de venta/i }),
    ).toBeDisabled()
  })
})

describe("Roles y permisos — permisos que la API no conoce", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("no dibuja el toggle de un permiso que /api/configuracion no devuelve", async () => {
    // Un permiso dibujado que el servidor no sabe guardar es peor que uno que
    // falta: el dueño lo prende, no pasa nada, y no hay error. Pasa de verdad
    // mientras un permiso nuevo viaja en un PR y su ruta en otro.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/usuarios") return { ok: true, json: async () => EQUIPO }
        if (url === "/api/configuracion") {
          return {
            ok: true,
            json: async () => ({
              tecnicosOperanPos: true,
              vendedoresAdministranInventario: false,
              vendedoresManejanCaja: false,
              // tecnicosCobranCotizaciones NO viene: su ruta no está desplegada.
            }),
          }
        }
        return { ok: true, json: async () => ({}) }
      }),
    )

    render(<RolesPermisos allowEdit />)

    expect(
      await screen.findByRole("checkbox", { name: /vender desde el punto de venta/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("checkbox", { name: /cobrar sus propias cotizaciones/i }),
    ).not.toBeInTheDocument()
  })
})
