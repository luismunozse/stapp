/**
 * Validaciones del wizard de OrdenForm que antes quedaban en silencio:
 *  - el IMEI vive en el paso 1 pero solo se validaba en el submit (paso 3), asi
 *    que "Crear orden" no hacia nada visible;
 *  - los items `requerido` del checklist mostraban "*" pero nunca se validaban.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1", organizationId: "org-1", role: "ADMIN" } } }),
}))
vi.mock("@/components/firma/signature-pad", () => ({
  SignaturePad: () => <div data-testid="signature-pad" />,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { toast } from "sonner"

function tipoCelular(validacionImei: "imei" | "none") {
  return {
    id: "tipo-cel",
    codigo: "CELULAR",
    nombre: "Celular",
    config: {
      accesorios: [],
      problemasComunes: [],
      marcas: [],
      camposExtra: [],
      campos: { imei: { label: "IMEI", validacion: validacionImei } },
    },
  }
}

const estado = vi.hoisted(() => ({ tipos: [] as unknown[] }))
vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({ tipos: estado.tipos, loading: false, error: null, refetch: vi.fn() }),
}))

const DRAFT_KEY = "draft:v3:orden-form:org-1:user-1:new"
function draft(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 3,
    savedAt: Date.now(),
    data: {
      form: {
        clienteId: "cli-1", dispositivo: "iPhone 13", tipoDispositivo: "CELULAR", marca: "", color: "", imei: "",
        problemaReportado: "No enciende", accesorios: "", codigoAccesoDispositivo: "", telefonoContacto: "",
        fechaPrometida: "", observaciones: "", notasInternas: "", ...extra,
      },
      selectedClienteObj: { id: "cli-1", nombre: "Juan", telefono: "1122334455", tipoCliente: "PARTICULAR" },
      accesoriosSeleccionados: [], otroAccesorio: "", camposExtraValues: {}, metodoPagoSena: "EFECTIVO",
      selectedSectorId: "", selectedTecnicoId: "", selectedRecibidoPorId: "",
      checklistValores: {}, checklistTemplateId: null, checklistNotas: "",
    },
  })
}

async function settle(ms = 2000) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

async function abrir({
  extra = {},
  checklistItems = null,
}: {
  extra?: Record<string, unknown>
  checklistItems?: unknown[] | null
} = {}) {
  const fetchSpy = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/checklist-templates/by-device-type")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          template: checklistItems ? { id: "tpl-1", nombre: "Ingreso", items: checklistItems } : null,
        }),
      } as Response)
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => (url === "/api/ordenes" ? { id: "ord-1", numeroOrden: 1 } : []),
    } as Response)
  })
  vi.stubGlobal("fetch", fetchSpy)
  window.localStorage.setItem(DRAFT_KEY, draft(extra))
  const { OrdenForm } = await import("@/components/ordenes/orden-form")
  const onClose = vi.fn()
  const onSuccess = vi.fn()
  // Elemento nuevo en cada render: con el mismo objeto React no vuelve a
  // renderizar y el mock de tipos no se relee.
  const ui = () => <ModalProvider><OrdenForm onClose={onClose} onSuccess={onSuccess} /></ModalProvider>
  const utils = render(ui())
  await settle()
  return { fetchSpy, rerender: () => utils.rerender(ui()) }
}

const posteos = (spy: ReturnType<typeof vi.fn>) =>
  spy.mock.calls.filter((c) => String(c[0]) === "/api/ordenes")

/** Avanza un paso: en el 1 el boton se llama "Agregar detalles". */
const siguiente = async () => {
  fireEvent.click(
    screen.queryByRole("button", { name: "Agregar detalles" }) ??
      screen.getByRole("button", { name: "Siguiente" }),
  )
  await settle()
}
const crear = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Crear orden" }))
  await settle()
}

describe("OrdenForm: validacion por paso", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    vi.mocked(toast.error).mockClear()
    estado.tipos = [tipoCelular("imei")]
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it("un IMEI invalido frena el 'Agregar detalles' del paso 1 con el error en el campo", async () => {
    const { fetchSpy } = await abrir({ extra: { imei: "12345" } })
    await siguiente()
    expect(screen.getByText("El IMEI debe tener exactamente 15 dígitos")).toBeInTheDocument()
    expect(screen.getByText(/Paso 1\/3/)).toBeInTheDocument()
    expect(document.activeElement?.id).toBe("imei")
    expect(posteos(fetchSpy)).toHaveLength(0)
  })

  it("con un IMEI de 15 digitos avanza normalmente", async () => {
    await abrir({ extra: { imei: "123456789012345" } })
    await siguiente()
    expect(screen.queryByText("El IMEI debe tener exactamente 15 dígitos")).toBeNull()
    expect(screen.getByText(/Paso 2\/3/)).toBeInTheDocument()
  })

  it("si el IMEI llega invalido al submit, vuelve al paso 1, enfoca el campo y avisa", async () => {
    // La config del tipo cambia despues de pasar el paso 1 (sin validacion de
    // IMEI al avanzar, con validacion al crear): es la red de seguridad.
    estado.tipos = [tipoCelular("none")]
    const { fetchSpy, rerender } = await abrir({ extra: { imei: "12345" } })
    await siguiente()
    await siguiente()
    estado.tipos = [tipoCelular("imei")]
    rerender()
    await settle()
    await crear()
    expect(posteos(fetchSpy)).toHaveLength(0)
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("15 dígitos"))
    expect(screen.getByText(/Paso 1\/3/)).toBeInTheDocument()
    expect(screen.getByText("El IMEI debe tener exactamente 15 dígitos")).toBeInTheDocument()
    expect(document.activeElement?.id).toBe("imei")
  })

  it("un item requerido del checklist sin responder frena la creacion con aviso visible", async () => {
    const { fetchSpy } = await abrir({
      checklistItems: [
        { id: "opcional", label: "Tiene funda", tipo: "BOOLEAN", orden: 1, requerido: false },
        { id: "pantalla", label: "Pantalla sana", tipo: "BOOLEAN", orden: 2, requerido: true },
        { id: "rayones", label: "Rayones", tipo: "TEXT", orden: 3, requerido: true },
      ],
    })
    await siguiente()
    await siguiente()
    await crear()
    expect(posteos(fetchSpy)).toHaveLength(0)
    expect(toast.error).toHaveBeenCalledWith("Completá los 2 ítems obligatorios del checklist")
    expect(screen.getAllByText("Completá este ítem obligatorio")).toHaveLength(2)
    // Foco en el primero que falta (el boton "Si" de "Pantalla sana").
    expect(document.getElementById("checklist-item-pantalla")?.contains(document.activeElement)).toBe(true)

    // "No" es una respuesta valida.
    const pantalla = document.getElementById("checklist-item-pantalla")!
    fireEvent.click(Array.from(pantalla.querySelectorAll("button")).find((b) => b.textContent === "No")!)
    fireEvent.change(document.getElementById("checklist-item-rayones")!.querySelector("input")!, {
      target: { value: "Ninguno" },
    })
    await settle()
    expect(screen.queryByText("Completá este ítem obligatorio")).toBeNull()

    await crear()
    expect(posteos(fetchSpy)).toHaveLength(1)
  })

  it("sin items requeridos el checklist no bloquea la creacion", async () => {
    const { fetchSpy } = await abrir({
      checklistItems: [{ id: "opcional", label: "Tiene funda", tipo: "BOOLEAN", orden: 1, requerido: false }],
    })
    await siguiente()
    await siguiente()
    await crear()
    expect(toast.error).not.toHaveBeenCalled()
    expect(posteos(fetchSpy)).toHaveLength(1)
  })
  describe("crear desde el paso 1", () => {
    it("con los obligatorios validos crea la orden sin pasar por los pasos 2 y 3", async () => {
      const { fetchSpy } = await abrir({ extra: { imei: "123456789012345" } })
      expect(screen.getByText(/Paso 1\/3/)).toBeInTheDocument()
      // Telefono y PIN viven en el paso 1: se cargan con el cliente delante.
      fireEvent.change(screen.getByLabelText("Teléfono de contacto"), { target: { value: "1199887766" } })
      fireEvent.change(screen.getByPlaceholderText("PIN o contraseña para las pruebas"), {
        target: { value: "4321" },
      })
      await crear()
      expect(posteos(fetchSpy)).toHaveLength(1)
      const body = JSON.parse(String(posteos(fetchSpy)[0][1]?.body))
      expect(body).toMatchObject({
        clienteId: "cli-1",
        dispositivo: "iPhone 13",
        tipoDispositivo: "CELULAR",
        problemaReportado: "No enciende",
        imei: "123456789012345",
        telefonoContacto: "1199887766",
        codigoAccesoDispositivo: "4321",
      })
    })

    it("sin el problema reportado no crea y muestra el error en el paso 1", async () => {
      const { fetchSpy } = await abrir({ extra: { problemaReportado: "" } })
      await crear()
      expect(posteos(fetchSpy)).toHaveLength(0)
      expect(screen.getByText(/Paso 1\/3/)).toBeInTheDocument()
      expect(screen.getAllByText("El problema es requerido").length).toBeGreaterThan(0)
    })

    it("un IMEI invalido frena el 'Crear orden' del paso 1 y enfoca el campo", async () => {
      const { fetchSpy } = await abrir({ extra: { imei: "12345" } })
      await crear()
      expect(posteos(fetchSpy)).toHaveLength(0)
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("15 dígitos"))
      expect(screen.getByText("El IMEI debe tener exactamente 15 dígitos")).toBeInTheDocument()
      expect(document.activeElement?.id).toBe("imei")
    })

    it("con items requeridos del checklist sin responder avisa desde el paso 1 y lleva al checklist", async () => {
      const { fetchSpy } = await abrir({
        checklistItems: [{ id: "pantalla", label: "Pantalla sana", tipo: "BOOLEAN", orden: 1, requerido: true }],
      })
      expect(
        screen.getByText("El checklist de ingreso tiene 1 ítem obligatorio sin completar (paso 3)."),
      ).toBeInTheDocument()
      await crear()
      expect(posteos(fetchSpy)).toHaveLength(0)
      expect(toast.error).toHaveBeenCalledWith("Completá el ítem obligatorio del checklist: Pantalla sana")
      expect(screen.getByText(/Paso 3\/3/)).toBeInTheDocument()
      expect(document.getElementById("checklist-item-pantalla")?.contains(document.activeElement)).toBe(true)

      const pantalla = document.getElementById("checklist-item-pantalla")!
      fireEvent.click(Array.from(pantalla.querySelectorAll("button")).find((b) => b.textContent === "Sí")!)
      await settle()
      await crear()
      expect(posteos(fetchSpy)).toHaveLength(1)
    })

    it("los pasos 2 y 3 siguen accesibles desde el indicador", async () => {
      await abrir()
      fireEvent.click(screen.getByRole("button", { name: "Paso 3: Fotos y checklist (opcional)" }))
      await settle()
      expect(screen.getByText(/Paso 3\/3/)).toBeInTheDocument()
      fireEvent.click(screen.getByRole("button", { name: "Paso 2: Detalles (opcional)" }))
      await settle()
      expect(screen.getByText(/Paso 2\/3/)).toBeInTheDocument()
    })

    it("saltar hacia adelante desde el indicador valida el paso 1", async () => {
      await abrir({ extra: { dispositivo: "" } })
      fireEvent.click(screen.getByRole("button", { name: "Paso 3: Fotos y checklist (opcional)" }))
      await settle()
      expect(screen.getByText(/Paso 1\/3/)).toBeInTheDocument()
      expect(screen.getAllByText("El dispositivo es requerido").length).toBeGreaterThan(0)
    })
  })
})
