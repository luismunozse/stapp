import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const mockRole = vi.hoisted(() => ({ current: "ADMIN" as string }))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: mockRole.current } }, status: "authenticated" }),
}))

import {
  MoverSucursal,
  lineaOrdenesAbiertas,
  lineaTurnosPendientes,
  lineaCajaAbierta,
} from "@/components/usuarios/mover-sucursal"

const SUCURSALES = [
  { id: "suc-a", nombre: "Casa Central", principal: true },
  { id: "suc-b", nombre: "Cerro", principal: false },
  { id: "suc-c", nombre: "Tablada", principal: false },
]

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

const info = (over: Record<string, unknown> = {}) => ({
  usuario: { id: "u1", nombre: "Tomás", rol: "TECNICO", sucursalId: "suc-a" },
  ordenesAbiertas: [],
  totalOrdenesAbiertas: 0,
  turnosPendientes: [],
  totalTurnosPendientes: 0,
  cajaAbierta: null,
  ...over,
})

const CAJA_CENTRAL = { sesionId: "ses-1", sucursalId: "suc-a", sucursalNombre: "Casa Central" }

/** GET answers `get`, PUT answers `put`; every call is recorded on the returned mock. */
function mockApi(get: () => Response | Promise<Response>, put?: () => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === "PUT" ? put!() : get()
  )
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

const abrir = async () => fireEvent.click(await screen.findByRole("button", { name: "Mover de sucursal" }))
const elegir = (id: string) => fireEvent.change(screen.getByLabelText("Nueva sucursal"), { target: { value: id } })
const confirmar = () => screen.getByRole("button", { name: "Confirmar movimiento" })

describe("lineaOrdenesAbiertas", () => {
  it.each([
    [4, "Casa Central", "TECNICO", "Tiene 4 órdenes abiertas en Casa Central. Seguirán asignadas a este técnico."],
    [1, "Cerro", "TECNICO", "Tiene 1 orden abierta en Cerro. Seguirá asignada a este técnico."],
    [3, "Cerro", "VENDEDOR", "Tiene 3 órdenes abiertas en Cerro. Seguirán asignadas a este vendedor."],
    [2, null, "TECNICO", "Tiene 2 órdenes abiertas sin sucursal. Seguirán asignadas a este técnico."],
  ])("%i en %s (%s)", (cantidad, sucursal, rol, esperado) => {
    expect(lineaOrdenesAbiertas(cantidad, sucursal, rol)).toBe(esperado)
  })
})

describe("lineaTurnosPendientes / lineaCajaAbierta", () => {
  it.each([
    [2, "Casa Central", "TECNICO", "Tiene 2 turnos pendientes en Casa Central. Siguen asignados a este técnico, pero dejará de verlos en su agenda."],
    [1, "Cerro", "TECNICO", "Tiene 1 turno pendiente en Cerro. Sigue asignado a este técnico, pero dejará de verlo en su agenda."],
    [3, null, "VENDEDOR", "Tiene 3 turnos pendientes sin sucursal. Siguen asignados a este vendedor, pero dejará de verlos en su agenda."],
  ])("%i en %s (%s)", (cantidad, sucursal, rol, esperado) => {
    expect(lineaTurnosPendientes(cantidad, sucursal, rol)).toBe(esperado)
  })

  it.each([
    ["Cerro", "Tiene una caja abierta en Cerro. Cerrala antes de moverlo."],
    [null, "Tiene una caja abierta. Cerrala antes de moverlo."],
  ])("caja en %s", (sucursal, esperado) => {
    expect(lineaCajaAbierta(sucursal)).toBe(esperado)
  })
})

describe("MoverSucursal", () => {
  beforeEach(() => {
    mockRole.current = "ADMIN"
  })
  afterEach(() => vi.unstubAllGlobals())

  describe("visibilidad", () => {
    it("ADMIN con más de una sucursal: lee al usuario y muestra su sucursal actual", async () => {
      const fetchMock = mockApi(() => json(info()))
      render(<MoverSucursal usuarioId="u1" sucursales={SUCURSALES} />)

      expect(await screen.findByText("Casa Central")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Mover de sucursal" })).toBeEnabled()
      expect(fetchMock).toHaveBeenCalledWith("/api/usuarios/u1/sucursal", expect.objectContaining({ cache: "no-store" }))
    })

    it("no muestra nada ni consulta si la organización tiene una sola sucursal", () => {
      const fetchMock = mockApi(() => json(info()))
      const { container } = render(<MoverSucursal usuarioId="u1" sucursales={SUCURSALES.slice(0, 1)} />)

      expect(container).toBeEmptyDOMElement()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("no muestra nada ni consulta si quien mira no es ADMIN", () => {
      mockRole.current = "TECNICO"
      const fetchMock = mockApi(() => json(info()))
      const { container } = render(<MoverSucursal usuarioId="u1" sucursales={SUCURSALES} />)

      expect(container).toBeEmptyDOMElement()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("un usuario sin sucursal o en una inactiva se muestra con una etiqueta neutra", async () => {
      mockApi(() => json(info({ usuario: { id: "u1", nombre: "Tomás", rol: "TECNICO", sucursalId: null } })))
      const { unmount } = render(<MoverSucursal usuarioId="u1" sucursales={SUCURSALES} />)
      expect(await screen.findByText("Sin sucursal")).toBeInTheDocument()
      unmount()

      mockApi(() => json(info({ usuario: { id: "u1", nombre: "Tomás", rol: "TECNICO", sucursalId: "suc-vieja" } })))
      render(<MoverSucursal usuarioId="u1" sucursales={SUCURSALES} />)
      expect(await screen.findByText("Sucursal inactiva")).toBeInTheDocument()
    })
  })

  describe("aviso de órdenes abiertas", () => {
    it("con órdenes abiertas lo muestra al abrir, no antes, y aclara que no se reasignan", async () => {
      mockApi(() =>
        json(info({ ordenesAbiertas: [{ sucursalId: "suc-a", sucursalNombre: "Casa Central", cantidad: 4 }], totalOrdenesAbiertas: 4 }))
      )
      render(<MoverSucursal usuarioId="u1" sucursales={SUCURSALES} />)

      await screen.findByRole("button", { name: "Mover de sucursal" })
      expect(screen.queryByText(/Tiene 4/)).not.toBeInTheDocument()

      await abrir()
      expect(screen.getByText("Tiene 4 órdenes abiertas en Casa Central. Seguirán asignadas a este técnico.")).toBeInTheDocument()
      expect(screen.getByText(/no reasigna ni cambia de sucursal ninguna orden/i)).toBeInTheDocument()
    })

    it("agrupa por sucursal, una línea por grupo, con etiqueta neutra si falta el nombre", async () => {
      mockApi(() =>
        json(
          info({
            ordenesAbiertas: [
              { sucursalId: "suc-b", sucursalNombre: "Cerro", cantidad: 3 },
              { sucursalId: null, sucursalNombre: null, cantidad: 1 },
            ],
            totalOrdenesAbiertas: 4,
          })
        )
      )
      render(<MoverSucursal usuarioId="u1" sucursales={SUCURSALES} />)
      await abrir()

      expect(screen.getAllByRole("listitem")).toHaveLength(2)
      expect(screen.getByText("Tiene 3 órdenes abiertas en Cerro. Seguirán asignadas a este técnico.")).toBeInTheDocument()
      expect(screen.getByText("Tiene 1 orden abierta sin sucursal. Seguirá asignada a este técnico.")).toBeInTheDocument()
    })

    it("a un vendedor no le habla de técnico", async () => {
      mockApi(() =>
        json(
          info({
            usuario: { id: "u1", nombre: "Vera", rol: "VENDEDOR", sucursalId: "suc-a" },
            ordenesAbiertas: [{ sucursalId: "suc-a", sucursalNombre: "Casa Central", cantidad: 2 }],
            totalOrdenesAbiertas: 2,
          })
        )
      )
      render(<MoverSucursal usuarioId="u1" sucursales={SUCURSALES} />)
      await abrir()

      expect(screen.getByText(/Seguirán asignadas a este vendedor/)).toBeInTheDocument()
      expect(screen.queryByText(/técnico/i)).not.toBeInTheDocument()
    })

    it("sin órdenes abiertas no hay aviso, pero el selector sí está", async () => {
      mockApi(() => json(info()))
      render(<MoverSucursal usuarioId="u1" sucursales={SUCURSALES} />)
      await abrir()

      expect(screen.getByLabelText("Nueva sucursal")).toBeInTheDocument()
      expect(screen.queryByText(/Tiene \d+/)).not.toBeInTheDocument()
      expect(screen.queryByRole("listitem")).not.toBeInTheDocument()
      expect(screen.queryByText(/ninguna orden/i)).not.toBeInTheDocument()
    })

    it("avisa de los turnos pendientes por sucursal, sin la nota de órdenes", async () => {
      mockApi(() =>
        json(
          info({
            turnosPendientes: [
              { sucursalId: "suc-b", sucursalNombre: "Cerro", cantidad: 2 },
              { sucursalId: "suc-a", sucursalNombre: "Casa Central", cantidad: 1 },
            ],
            totalTurnosPendientes: 3,
          })
        )
      )
      render(<MoverSucursal usuarioId="u1" sucursales={SUCURSALES} />)
      await abrir()

      expect(screen.getAllByRole("listitem")).toHaveLength(2)
      expect(screen.getByText(/^Tiene 2 turnos pendientes en Cerro\./)).toBeInTheDocument()
      expect(screen.getByText(/^Tiene 1 turno pendiente en Casa Central\./)).toBeInTheDocument()
      expect(screen.queryByText(/ninguna orden/i)).not.toBeInTheDocument()
      expect(confirmar()).toBeDisabled()
      elegir("suc-c")
      expect(confirmar()).toBeEnabled()
    })

    it("con una caja abierta explica por qué y no deja confirmar aunque se elija una sucursal", async () => {
      const fetchMock = mockApi(() => json(info({ cajaAbierta: CAJA_CENTRAL })))
      render(<MoverSucursal usuarioId="u1" sucursales={SUCURSALES} />)
      await abrir()

      expect(screen.getByText("Tiene una caja abierta en Casa Central. Cerrala antes de moverlo.")).toBeInTheDocument()
      elegir("suc-b")
      expect(confirmar()).toBeDisabled()
      fireEvent.click(confirmar())
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false)
    })

    it("los campos de turnos y caja son opcionales: sin ellos no hay aviso y se puede mover", async () => {
      mockApi(() =>
        json({
          usuario: { id: "u1", nombre: "Tomás", rol: "TECNICO", sucursalId: "suc-a" },
          ordenesAbiertas: [],
          totalOrdenesAbiertas: 0,
        })
      )
      render(<MoverSucursal usuarioId="u1" sucursales={SUCURSALES} />)
      await abrir()
      elegir("suc-b")

      expect(screen.queryByRole("listitem")).not.toBeInTheDocument()
      expect(screen.queryByText(/caja abierta/i)).not.toBeInTheDocument()
      expect(confirmar()).toBeEnabled()
    })

    it("una caja abierta sin nombre de sucursal bloquea igual, con la etiqueta neutra", async () => {
      mockApi(() => json(info({ cajaAbierta: { sesionId: "ses-9", sucursalId: null, sucursalNombre: null } })))
      render(<MoverSucursal usuarioId="u1" sucursales={SUCURSALES} />)
      await abrir()

      expect(screen.getByText("Tiene una caja abierta. Cerrala antes de moverlo.")).toBeInTheDocument()
      elegir("suc-b")
      expect(confirmar()).toBeDisabled()
    })

    it("si no se pueden leer los pendientes muestra el error del servidor, no deja mover a ciegas y Reintentar lo recupera", async () => {
      let falla = true
      mockApi(() =>
        falla ? json({ error: "No pudimos leer el trabajo pendiente del usuario" }, 500) : json(info())
      )
      render(<MoverSucursal usuarioId="u1" sucursales={SUCURSALES} />)

      expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos leer el trabajo pendiente del usuario")
      expect(screen.queryByRole("button", { name: "Mover de sucursal" })).not.toBeInTheDocument()

      falla = false
      fireEvent.click(screen.getByRole("button", { name: "Reintentar" }))
      expect(await screen.findByRole("button", { name: "Mover de sucursal" })).toBeInTheDocument()
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    })

    it("si la lectura falla sin cuerpo útil (red caída) usa un mensaje propio", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")))
      render(<MoverSucursal usuarioId="u1" sucursales={SUCURSALES} />)

      expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos leer el trabajo pendiente de este usuario")
      expect(screen.queryByRole("button", { name: "Mover de sucursal" })).not.toBeInTheDocument()
    })
  })

  describe("mover", () => {
    it("el selector ofrece las otras sucursales (no la actual) y confirmar espera a que se elija una", async () => {
      mockApi(() => json(info()))
      render(<MoverSucursal usuarioId="u1" sucursales={SUCURSALES} />)
      await abrir()

      const opciones = screen.getAllByRole("option").map((o) => o.textContent)
      expect(opciones).toEqual(["Elegí una sucursal", "Cerro", "Tablada"])
      expect(confirmar()).toBeDisabled()
      // The change is not instant (a few seconds), and the panel must not promise it is.
      expect(screen.getByText(/en unos segundos/)).toBeInTheDocument()
      expect(screen.queryByText(/próxima acción/)).not.toBeInTheDocument()

      elegir("suc-b")
      expect(confirmar()).toBeEnabled()
    })

    it("confirmar hace PUT con la sucursal elegida, avisa, actualiza la actual y no envía el formulario", async () => {
      const onMoved = vi.fn()
      const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
      const fetchMock = mockApi(
        () => json(info()),
        () => json({ success: true, sucursalId: "suc-b", message: "Tomás ahora está en Cerro. El cambio se aplica en unos segundos, sin volver a iniciar sesión." })
      )
      render(
        <form onSubmit={onSubmit}>
          <MoverSucursal usuarioId="u1" sucursales={SUCURSALES} onMoved={onMoved} />
        </form>
      )
      await abrir()
      elegir("suc-b")
      fireEvent.click(confirmar())

      expect(await screen.findByRole("status")).toHaveTextContent("Tomás ahora está en Cerro.")
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/usuarios/u1/sucursal",
        expect.objectContaining({
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sucursalId: "suc-b" }),
        })
      )
      expect(onMoved).toHaveBeenCalledWith("suc-b")
      expect(screen.queryByLabelText("Nueva sucursal")).not.toBeInTheDocument()
      expect(screen.getByText("Cerro", { selector: "p" })).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it("no permite doble envío mientras la petición está pendiente", async () => {
      let resolver!: (r: Response) => void
      const fetchMock = mockApi(
        () => json(info()),
        () => new Promise<Response>((r) => (resolver = r))
      )
      render(<MoverSucursal usuarioId="u1" sucursales={SUCURSALES} />)
      await abrir()
      elegir("suc-b")
      fireEvent.click(confirmar())
      fireEvent.click(screen.getByRole("button", { name: "Moviendo..." }))

      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1)
      expect(screen.getByRole("button", { name: "Moviendo..." })).toBeDisabled()

      resolver(json({ success: true, message: "Listo." }))
      await screen.findByRole("status")
    })

    it("400: muestra el mensaje del servidor, conserva la elección y deja reintentar", async () => {
      const onMoved = vi.fn()
      const fetchMock = mockApi(
        () => json(info()),
        () => json({ error: "La sucursal elegida no existe o está inactiva." }, 400)
      )
      render(<MoverSucursal usuarioId="u1" sucursales={SUCURSALES} onMoved={onMoved} />)
      await abrir()
      elegir("suc-b")
      fireEvent.click(confirmar())

      expect(await screen.findByRole("alert")).toHaveTextContent("La sucursal elegida no existe o está inactiva.")
      expect(onMoved).not.toHaveBeenCalled()
      expect(screen.getByLabelText("Nueva sucursal")).toHaveValue("suc-b")
      expect(confirmar()).toBeEnabled()
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method !== "PUT")).toHaveLength(1)
    })

    it("409 CAJA_ABIERTA: muestra el error tal cual, relee al usuario y pasa a bloquear con la caja", async () => {
      const onMoved = vi.fn()
      let lecturas = 0
      mockApi(
        () => json(++lecturas === 1 ? info() : info({ cajaAbierta: CAJA_CENTRAL })),
        () => json({ error: "Tiene una caja abierta en Casa Central. Cerrala antes de moverlo.", code: "CAJA_ABIERTA" }, 409)
      )
      render(<MoverSucursal usuarioId="u1" sucursales={SUCURSALES} onMoved={onMoved} />)
      await abrir()
      elegir("suc-b")
      fireEvent.click(confirmar())

      expect(await screen.findByRole("alert")).toHaveTextContent("Tiene una caja abierta en Casa Central. Cerrala antes de moverlo.")
      await waitFor(() => expect(lecturas).toBe(2))
      elegir("suc-b")
      expect(confirmar()).toBeDisabled()
      expect(onMoved).not.toHaveBeenCalled()
    })

    it("409 cambió mientras tanto: muestra el error tal cual, relee al usuario y pide elegir de nuevo", async () => {
      const onMoved = vi.fn()
      let lecturas = 0
      mockApi(
        () =>
          json(
            ++lecturas === 1
              ? info()
              : info({ usuario: { id: "u1", nombre: "Tomás", rol: "TECNICO", sucursalId: "suc-c" } })
          ),
        () => json({ error: "El usuario cambió mientras tanto. Recargá e intentá de nuevo." }, 409)
      )
      render(<MoverSucursal usuarioId="u1" sucursales={SUCURSALES} onMoved={onMoved} />)
      await abrir()
      elegir("suc-b")
      fireEvent.click(confirmar())

      expect(await screen.findByRole("alert")).toHaveTextContent("El usuario cambió mientras tanto. Recargá e intentá de nuevo.")
      // The reread says someone already moved the user to Tablada: that is the current branch now.
      expect(await screen.findByText("Tablada", { selector: "p" })).toBeInTheDocument()
      expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Elegí una sucursal", "Casa Central", "Cerro"])
      expect(screen.getByLabelText("Nueva sucursal")).toHaveValue("")
      expect(confirmar()).toBeDisabled()
      expect(onMoved).not.toHaveBeenCalled()
    })

    it("un error de red se muestra y no cierra el panel", async () => {
      mockApi(
        () => json(info()),
        () => Promise.reject(new Error("network"))
      )
      render(<MoverSucursal usuarioId="u1" sucursales={SUCURSALES} />)
      await abrir()
      elegir("suc-c")
      fireEvent.click(confirmar())

      expect(await screen.findByRole("alert")).toHaveTextContent(/conexión/i)
      await waitFor(() => expect(confirmar()).toBeEnabled())
    })

    it("Cancelar cierra el panel sin mover a nadie", async () => {
      const fetchMock = mockApi(() => json(info()))
      render(<MoverSucursal usuarioId="u1" sucursales={SUCURSALES} />)
      await abrir()
      elegir("suc-b")
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))

      expect(screen.queryByLabelText("Nueva sucursal")).not.toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Mover de sucursal" })).toBeInTheDocument()
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false)
    })
  })
})
