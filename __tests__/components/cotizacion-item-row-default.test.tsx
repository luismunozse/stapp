// __tests__/components/cotizacion-item-row-default.test.tsx
//
// La busqueda de los dos catalogos (inventario + servicios) ya existia en
// ItemRow, pero vivia detras de un boton icono sin etiqueta y el taller nunca
// se enteraba. Esta suite cubre la inversion del default: una fila NUEVA
// arranca en modo busqueda, pero una fila que ya tiene descripcion cargada
// (las cotizaciones en BORRADOR que ya existen) sigue mostrando el input de
// texto libre tal cual estaba, sin abrir el buscador encima.
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"
import { ItemRow } from "@/components/cotizaciones/item-row"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))

const baseItem = {
  descripcion: "",
  cantidad: 1,
  precioUnitario: 0,
}

function renderItemRow(item: Record<string, unknown>) {
  return render(
    <ModalProvider>
      <ItemRow item={item as any} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} />
    </ModalProvider>
  )
}

describe("ItemRow — default de la fila nueva", () => {
  it("una fila vacia (sin descripcion, sin vinculo a catalogo) arranca en modo busqueda", () => {
    renderItemRow({ ...baseItem })

    // Los dos layouts (movil y escritorio) se montan siempre en jsdom; ambos
    // comparten el mismo estado, asi que el buscador aparece en los dos.
    const buscadores = screen.getAllByPlaceholderText("Buscar producto o servicio...")
    expect(buscadores.length).toBeGreaterThan(0)
    expect(screen.queryAllByPlaceholderText("Descripción del item")).toHaveLength(0)
  })

  it("una fila con descripcion ya guardada renderiza el input de descripcion, no el buscador (guard de BORRADOR)", () => {
    // Este es el caso que protege a las cotizaciones en BORRADOR que ya
    // existen: reabrirlas para editar no puede tapar el dato guardado con un
    // buscador vacio.
    renderItemRow({ ...baseItem, descripcion: "Cambio de pantalla" })

    expect(screen.getAllByDisplayValue("Cambio de pantalla").length).toBeGreaterThan(0)
    expect(screen.queryAllByPlaceholderText("Buscar producto o servicio...")).toHaveLength(0)
  })

  it("una fila ya vinculada a inventario (con descripcion) tampoco abre el buscador", () => {
    renderItemRow({ ...baseItem, descripcion: "Pantalla iPhone 12", inventarioId: "inv-1" })

    expect(screen.queryAllByPlaceholderText("Buscar producto o servicio...")).toHaveLength(0)
    expect(screen.getAllByDisplayValue("Pantalla iPhone 12").length).toBeGreaterThan(0)
  })

  it("el enlace 'Escribir a mano' cambia la fila vacia a texto libre", () => {
    renderItemRow({ ...baseItem })

    const enlaces = screen.getAllByRole("button", { name: "Escribir a mano" })
    expect(enlaces.length).toBeGreaterThan(0)

    fireEvent.click(enlaces[0])

    // El estado showInvSearch es unico y compartido por los dos layouts: un
    // solo click alcanza para que ambos vuelvan a texto libre.
    expect(screen.queryAllByPlaceholderText("Buscar producto o servicio...")).toHaveLength(0)
    expect(screen.getAllByPlaceholderText("Descripción del item").length).toBeGreaterThan(0)
  })

  // Fix round 1: los dos layouts (movil y escritorio) estan montados a la vez
  // (se alternan por CSS, no por render condicional). Con un unico ref
  // compartido, el ultimo layout en asignarse (escritorio, por orden de
  // documento) se lo quedaba, y el listener de "click afuera" leia un toque
  // DENTRO del buscador movil como un click afuera — la busqueda se cerraba
  // sola apenas el usuario la tocaba en el celular.
  it("un mousedown adentro del buscador del layout movil no lo cierra", () => {
    const { container } = renderItemRow({ ...baseItem })

    const buscadorMovil = container.querySelector(
      '.sm\\:hidden input[placeholder="Buscar producto o servicio..."]'
    )
    expect(buscadorMovil).not.toBeNull()

    fireEvent.mouseDown(buscadorMovil as Element)

    // Sigue abierto: el buscador (en los dos layouts, que comparten estado)
    // no se cerro por un toque que cayo adentro suyo.
    expect(screen.getAllByPlaceholderText("Buscar producto o servicio...").length).toBeGreaterThan(0)
    expect(screen.queryAllByPlaceholderText("Descripción del item")).toHaveLength(0)
  })

  // Fix round 2: el buscador de una fila fresca arranca abierto por DEFAULT,
  // sin que el usuario haya tocado nada todavia. El click-afuera solo tiene
  // que cerrar una busqueda que el usuario abrio A PROPOSITO (icono Package);
  // cerrar tambien el default rompia la primera fila de un formulario nuevo,
  // que se volvia texto libre apenas el usuario clickeaba CUALQUIER otra cosa
  // de la pantalla (el selector de cliente, por ejemplo) antes de haber
  // tocado siquiera el buscador.
  it("un mousedown afuera NO cierra el buscador default de una fila fresca sin tocar", () => {
    renderItemRow({ ...baseItem })

    fireEvent.mouseDown(document.body)

    // Sigue abierto: el estado default no cuenta como "abierto a proposito".
    expect(screen.getAllByPlaceholderText("Buscar producto o servicio...").length).toBeGreaterThan(0)
    expect(screen.queryAllByPlaceholderText("Descripción del item")).toHaveLength(0)
  })

  it("un mousedown afuera SI cierra el buscador que el usuario abrio a proposito con el icono Package", () => {
    renderItemRow({ ...baseItem })

    // Cierra el default con "Escribir a mano" y lo reabre con el icono: esa
    // reapertura es la accion deliberada que la correccion distingue del
    // default sin tocar.
    fireEvent.click(screen.getAllByRole("button", { name: "Escribir a mano" })[0])
    fireEvent.click(screen.getAllByTitle("Buscar producto o servicio")[0])
    expect(screen.getAllByPlaceholderText("Buscar producto o servicio...").length).toBeGreaterThan(0)

    fireEvent.mouseDown(document.body)

    expect(screen.queryAllByPlaceholderText("Buscar producto o servicio...")).toHaveLength(0)
    expect(screen.getAllByPlaceholderText("Descripción del item").length).toBeGreaterThan(0)
  })
})
