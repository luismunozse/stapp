import { describe, it, expect } from "vitest"
import {
  RUBROS,
  RUBRO_IDS,
  DEFAULT_RUBRO_ID,
  getRubro,
  isRubroId,
} from "@/lib/rubros"
import { TERMINOS } from "@/lib/terminologia"

/**
 * Los packs de rubro son la fuente única de la siembra de una organización
 * nueva (tipos de equipo, config por tipo, checklists y vocabulario). Un pack
 * mal formado no rompe en tiempo de compilación pero deja una org inservible,
 * así que las invariantes se cubren acá.
 */

describe("registro de rubros", () => {
  it("expone al menos los 6 rubros de la primera tanda", () => {
    expect(RUBRO_IDS).toEqual(
      expect.arrayContaining([
        "electronica",
        "electrodomesticos",
        "automotor",
        "motos-bicicletas",
        "relojeria",
        "generico",
      ])
    )
  })

  it("no repite ids", () => {
    expect(new Set(RUBRO_IDS).size).toBe(RUBRO_IDS.length)
  })

  it("el rubro por defecto existe en el registro", () => {
    expect(RUBRO_IDS).toContain(DEFAULT_RUBRO_ID)
  })

  it("getRubro cae al genérico ante un id desconocido, null o vacío", () => {
    expect(getRubro("no-existe").id).toBe(DEFAULT_RUBRO_ID)
    expect(getRubro(null).id).toBe(DEFAULT_RUBRO_ID)
    expect(getRubro(undefined).id).toBe(DEFAULT_RUBRO_ID)
    expect(getRubro("").id).toBe(DEFAULT_RUBRO_ID)
  })

  it("isRubroId discrimina ids válidos", () => {
    expect(isRubroId("automotor")).toBe(true)
    expect(isRubroId("plomeria")).toBe(false)
    expect(isRubroId(null)).toBe(false)
  })
})

describe.each(RUBROS.map((r) => [r.id, r] as const))("pack %s", (_id, pack) => {
  it("tiene nombre y descripción no vacíos", () => {
    expect(pack.nombre.trim()).not.toBe("")
    expect(pack.descripcion.trim()).not.toBe("")
  })

  it("tiene al menos un tipo de equipo", () => {
    expect(pack.tipos.length).toBeGreaterThan(0)
  })

  it("no repite códigos de tipo", () => {
    const codigos = pack.tipos.map((t) => t.codigo)
    expect(new Set(codigos).size).toBe(codigos.length)
  })

  it("los códigos de tipo son SCREAMING_SNAKE_CASE", () => {
    for (const tipo of pack.tipos) {
      expect(tipo.codigo).toMatch(/^[A-Z][A-Z0-9_]*$/)
    }
  })

  it("cada tipo tiene prefijo de orden corto y en mayúsculas", () => {
    for (const tipo of pack.tipos) {
      expect(tipo.prefijoOrden).toMatch(/^[A-Z]{2,5}$/)
    }
  })

  it("no repite prefijos de orden dentro del pack", () => {
    const prefijos = pack.tipos.map((t) => t.prefijoOrden)
    expect(new Set(prefijos).size).toBe(prefijos.length)
  })

  it("los checklists apuntan a tipos que existen en el pack", () => {
    const codigos = new Set(pack.tipos.map((t) => t.codigo))
    for (const checklist of pack.checklists) {
      if (checklist.tipoCodigo === null) continue
      expect(codigos).toContain(checklist.tipoCodigo)
    }
  })

  it("los items de checklist de tipo SELECT traen opciones", () => {
    for (const checklist of pack.checklists) {
      for (const item of checklist.items) {
        if (item.tipo === "SELECT") {
          expect(item.opciones, `${checklist.nombre} / ${item.label}`).toBeTruthy()
        }
      }
    }
  })

  it("solo usa claves de vocabulario del catálogo", () => {
    const conocidas = new Set(TERMINOS.map((t) => t.key))
    for (const key of Object.keys(pack.terminologia)) {
      expect(conocidas, `clave desconocida: ${key}`).toContain(key)
    }
  })

  it("no deja valores de vocabulario vacíos", () => {
    for (const [key, value] of Object.entries(pack.terminologia)) {
      expect(value.trim(), `${key} vacío`).not.toBe("")
    }
  })
})

describe("pack electronica — compatibilidad con orgs existentes", () => {
  const electronica = getRubro("electronica")

  /**
   * Toda org creada antes de esta feature tiene estos códigos sembrados por
   * el trigger `trigger_organization_tipos_dispositivo` (migraciones 014/021/092).
   * Si el pack de electrónica dejara de traerlos, una org nueva que elige
   * "electrónica" arrancaría distinta a todas las que ya están en producción.
   */
  it("conserva los códigos base que sembraba el trigger", () => {
    const codigos = electronica.tipos.map((t) => t.codigo)
    expect(codigos).toEqual(
      expect.arrayContaining([
        "CELULAR",
        "COMPUTADORA",
        "TABLET",
        "CONSOLA",
        "SMARTWATCH",
        "ACCESORIOS",
        "IMPRESORA",
        "TODOS",
      ])
    )
  })

  it("mantiene los prefijos de orden históricos", () => {
    const porCodigo = new Map(electronica.tipos.map((t) => [t.codigo, t.prefijoOrden]))
    expect(porCodigo.get("CELULAR")).toBe("CEL")
    expect(porCodigo.get("COMPUTADORA")).toBe("PC")
    expect(porCodigo.get("TABLET")).toBe("TAB")
    expect(porCodigo.get("CONSOLA")).toBe("CONS")
    expect(porCodigo.get("SMARTWATCH")).toBe("SW")
    expect(porCodigo.get("TODOS")).toBe("ORD")
  })

  it("deja el vocabulario en los defaults neutrales (no lo pisa)", () => {
    expect(electronica.terminologia).toEqual({})
  })

  it("CELULAR sigue validando IMEI de 15 dígitos", () => {
    const celular = electronica.tipos.find((t) => t.codigo === "CELULAR")
    expect(celular?.config.campos?.imei?.validacion).toBe("imei")
  })
})

describe("packs de oficios — no arrastran supuestos de electrónica", () => {
  it("automotor usa vocabulario de taller mecánico", () => {
    const automotor = getRubro("automotor")
    expect(automotor.terminologia.equipo).toBe("Vehículo")
    expect(automotor.terminologia.serie).toBe("Patente")
    expect(automotor.terminologia.tecnico).toBe("Mecánico")
  })

  it("ningún pack de oficio valida el identificador como IMEI", () => {
    const oficios = RUBROS.filter((r) => r.id !== "electronica")
    for (const pack of oficios) {
      for (const tipo of pack.tipos) {
        expect(
          tipo.config.campos?.imei?.validacion,
          `${pack.id}/${tipo.codigo}`
        ).not.toBe("imei")
      }
    }
  })

  it("ningún pack de oficio pide contraseña de desbloqueo", () => {
    const oficios = RUBROS.filter((r) => r.id !== "electronica")
    for (const pack of oficios) {
      for (const tipo of pack.tipos) {
        expect(
          tipo.config.campos?.password?.visible,
          `${pack.id}/${tipo.codigo}`
        ).toBe(false)
      }
    }
  })

  it("cada pack de oficio trae categorías de inventario propias", () => {
    const oficios = RUBROS.filter((r) => r.id !== "generico")
    for (const pack of oficios) {
      for (const tipo of pack.tipos) {
        expect(
          tipo.config.categoriasInventario?.length,
          `${pack.id}/${tipo.codigo}`
        ).toBeGreaterThan(0)
      }
    }
  })

  it("cada pack de oficio trae problemas comunes propios", () => {
    const oficios = RUBROS.filter((r) => r.id !== "generico")
    for (const pack of oficios) {
      const conProblemas = pack.tipos.filter(
        (t) => (t.config.problemasComunes?.length ?? 0) > 0
      )
      expect(conProblemas.length, pack.id).toBeGreaterThan(0)
    }
  })

  it("cada pack trae al menos un checklist de recepción", () => {
    for (const pack of RUBROS) {
      expect(pack.checklists.length, pack.id).toBeGreaterThan(0)
    }
  })
})
