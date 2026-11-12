import { describe, it, expect } from "vitest"
import {
  NAV_SECTIONS,
  ORG_FEATURES_APAGADAS,
  accionesVisibles,
  bottomNavItems,
  coincideComando,
  hrefResultado,
  itemsVisibles,
  seccionesVisibles,
  type OrgFeatures,
} from "@/lib/navegacion"
import { redirigirPorRol } from "@/lib/rutas-por-rol"

const todo: OrgFeatures = {
  moduloAgenda: true,
  vendedoresAdministranInventario: true,
  tecnicosOperanPos: true,
  vendedoresManejanCaja: true,
}

const hrefs = (items: { href: string }[]) => items.map((i) => i.href)
const labels = (items: { label: string }[]) => items.map((i) => i.label)

describe("navegación: una sola fuente sin duplicados", () => {
  it("ningún rol ve dos ítems con el mismo destino", () => {
    for (const role of ["ADMIN", "VENDEDOR", "TECNICO"]) {
      const items = hrefs(itemsVisibles(role, todo))
      expect(new Set(items).size, role).toBe(items.length)
    }
  })

  it("ningún título de sección repite el nombre de un ítem", () => {
    const todosLosLabels = new Set(NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.label)))
    for (const section of NAV_SECTIONS) {
      if (section.label) expect(todosLosLabels.has(section.label), section.label).toBe(false)
    }
  })

  it("el panel se llama Inicio en todos lados, y ya no hay 'Ventas / POS'", () => {
    const admin = itemsVisibles("ADMIN", todo)
    expect(admin.find((i) => i.href === "/dashboard")?.label).toBe("Inicio")
    expect(bottomNavItems("ADMIN", todo)[0].label).toBe("Inicio")
    expect(labels(admin)).not.toContain("Ventas / POS")
    expect(labels(admin)).not.toContain("Dashboard")
  })

  it("la suscripción no está en la navegación (vive en el menú de la cuenta)", () => {
    expect(hrefs(itemsVisibles("ADMIN", todo))).not.toContain("/configuracion/billing")
    expect(labels(itemsVisibles("ADMIN", todo))).not.toContain("Facturación")
  })
})

describe("navegación: filtrado por rol", () => {
  it("TECNICO no ve módulos de administración ni de mostrador sin permiso", () => {
    const items = hrefs(itemsVisibles("TECNICO", ORG_FEATURES_APAGADAS))
    for (const prohibido of ["/caja", "/finanzas", "/configuracion", "/inventario", "/reportes", "/pos", "/ventas", "/facturacion"]) {
      expect(items).not.toContain(prohibido)
    }
    expect(items).toContain("/ordenes")
    expect(labels(itemsVisibles("TECNICO", ORG_FEATURES_APAGADAS))).toContain("Mi desempeño")
  })

  it("VENDEDOR ve caja e inventario solo si la org lo habilitó", () => {
    expect(hrefs(itemsVisibles("VENDEDOR", ORG_FEATURES_APAGADAS))).not.toContain("/caja")
    expect(hrefs(itemsVisibles("VENDEDOR", ORG_FEATURES_APAGADAS))).not.toContain("/inventario")
    expect(hrefs(itemsVisibles("VENDEDOR", todo))).toContain("/caja")
    expect(hrefs(itemsVisibles("VENDEDOR", todo))).toContain("/inventario")
  })

  it("la barra inferior del técnico no muestra Agenda con el módulo apagado", () => {
    expect(hrefs(bottomNavItems("TECNICO", ORG_FEATURES_APAGADAS))).not.toContain("/agenda")
    expect(hrefs(bottomNavItems("TECNICO", todo))).toContain("/agenda")
  })

  it("todo lo que la navegación le muestra a un rol, el middleware lo deja pasar", () => {
    for (const role of ["ADMIN", "VENDEDOR", "TECNICO"]) {
      for (const item of [...itemsVisibles(role, todo), ...accionesVisibles(role, todo)]) {
        expect(redirigirPorRol(item.href.split("?")[0], role), `${role} ${item.href}`).toBe(false)
      }
    }
  })

  it("las secciones vacías desaparecen", () => {
    const secciones = seccionesVisibles("TECNICO", ORG_FEATURES_APAGADAS)
    expect(secciones.every((s) => s.items.length > 0)).toBe(true)
    expect(secciones.map((s) => s.label)).not.toContain("Finanzas")
  })
})

describe("paleta: acciones filtradas por rol", () => {
  it("ADMIN tiene todas las acciones", () => {
    expect(labels(accionesVisibles("ADMIN", ORG_FEATURES_APAGADAS))).toEqual(
      expect.arrayContaining(["Nueva orden", "Nueva venta", "Nuevo cliente", "Nueva orden de compra"]),
    )
  })

  it("TECNICO sin POS no puede empezar una venta ni una compra", () => {
    const acciones = labels(accionesVisibles("TECNICO", ORG_FEATURES_APAGADAS))
    expect(acciones).toContain("Nueva orden")
    expect(acciones).toContain("Nuevo cliente")
    expect(acciones).not.toContain("Nueva venta")
    expect(acciones).not.toContain("Nueva orden de compra")
  })

  it("TECNICO con POS habilitado puede empezar una venta", () => {
    expect(labels(accionesVisibles("TECNICO", todo))).toContain("Nueva venta")
  })

  it("VENDEDOR vende pero no compra a proveedores", () => {
    const acciones = labels(accionesVisibles("VENDEDOR", ORG_FEATURES_APAGADAS))
    expect(acciones).toContain("Nueva venta")
    expect(acciones).not.toContain("Nueva orden de compra")
  })
})

describe("paleta: coincidencias y destinos", () => {
  it("busca sin tildes ni mayúsculas, también por palabras clave", () => {
    const ordenes = itemsVisibles("ADMIN", todo).find((i) => i.href === "/ordenes")!
    expect(coincideComando(ordenes, "ORDENES")).toBe(true)
    const pos = itemsVisibles("ADMIN", todo).find((i) => i.href === "/pos")!
    expect(coincideComando(pos, "punto de venta")).toBe(true)
    expect(coincideComando(pos, "garantía")).toBe(false)
  })

  it("un cliente lleva a su ficha, no al listado", () => {
    expect(hrefResultado("cliente", "abc")).toBe("/clientes/abc")
    expect(hrefResultado("orden", "xyz")).toBe("/ordenes/xyz")
  })
})
