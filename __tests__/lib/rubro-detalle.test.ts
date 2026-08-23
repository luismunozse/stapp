import { describe, it, expect } from "vitest"
import { derivarDesdeDetalle, personalizarPack } from "@/lib/rubros/detalle"
import { getRubro } from "@/lib/rubros"

/**
 * El camino genérico guiado: el usuario escribe qué repara en texto libre y de
 * ahí sale el tipo de equipo, su código, su prefijo de orden y el vocabulario.
 *
 * Es lo que cubre el long tail de oficios (máquinas de café, cortadoras de
 * pasto, cerrajería) sin escribir un pack por rubro. La derivación tiene que
 * aguantar cualquier cosa que tipee alguien a las nueve de la mañana.
 */

describe("derivarDesdeDetalle — código del tipo", () => {
  it("arma un código en SCREAMING_SNAKE sin acentos", () => {
    expect(derivarDesdeDetalle("máquinas de café")?.codigo).toBe("MAQUINA_DE_CAFE")
  })

  it("descarta signos y colapsa espacios", () => {
    expect(derivarDesdeDetalle("  cortadoras   de pasto!! ")?.codigo).toBe(
      "CORTADORA_DE_PASTO"
    )
  })

  it("respeta el máximo de 20 caracteres del schema de tipos-dispositivo", () => {
    const d = derivarDesdeDetalle("maquinarias agricolas de gran porte")
    expect(d!.codigo.length).toBeLessThanOrEqual(20)
    expect(d!.codigo).toMatch(/^[A-Z][A-Z0-9_]*$/)
  })

  it("no deja guiones bajos colgando al truncar", () => {
    const d = derivarDesdeDetalle("equipos de refrigeracion comercial")
    expect(d!.codigo.endsWith("_")).toBe(false)
  })

  it("acepta números", () => {
    expect(derivarDesdeDetalle("motores 4 tiempos")?.codigo).toBe("MOTOR_4_TIEMPO")
  })
})

describe("derivarDesdeDetalle — singular y plural en castellano", () => {
  it("singulariza plurales en vocal + s", () => {
    expect(derivarDesdeDetalle("máquinas de café")?.nombre).toBe("Máquina de café")
    expect(derivarDesdeDetalle("cortadoras de pasto")?.nombre).toBe("Cortadora de pasto")
    expect(derivarDesdeDetalle("llaves")?.nombre).toBe("Llave")
  })

  it("singulariza plurales en consonante + es", () => {
    expect(derivarDesdeDetalle("relojes")?.nombre).toBe("Reloj")
    expect(derivarDesdeDetalle("motores")?.nombre).toBe("Motor")
    expect(derivarDesdeDetalle("televisores")?.nombre).toBe("Televisor")
  })

  it("singulariza cada palabra que venga en plural", () => {
    expect(derivarDesdeDetalle("cajas registradoras")?.nombre).toBe("Caja registradora")
  })

  it("deja intacto lo que ya viene en singular", () => {
    expect(derivarDesdeDetalle("máquina de café")?.nombre).toBe("Máquina de café")
    expect(derivarDesdeDetalle("bicicleta")?.nombre).toBe("Bicicleta")
  })

  it("no toca las palabras de enlace", () => {
    const d = derivarDesdeDetalle("equipos de aire acondicionado")
    expect(d?.nombre).toBe("Equipo de aire acondicionado")
  })

  it("arma el plural del vocabulario", () => {
    const d = derivarDesdeDetalle("máquinas de café")
    expect(d?.equipo).toBe("Máquina de café")
    expect(d?.equipoPlural).toBe("Máquinas de café")
  })

  it("pluraliza agregando es cuando termina en consonante", () => {
    const d = derivarDesdeDetalle("reloj")
    expect(d?.equipo).toBe("Reloj")
    expect(d?.equipoPlural).toBe("Relojes")
  })
})

describe("derivarDesdeDetalle — prefijo de orden", () => {
  it("usa las primeras letras de la primera palabra significativa", () => {
    expect(derivarDesdeDetalle("máquinas de café")?.prefijoOrden).toBe("MAQ")
    expect(derivarDesdeDetalle("cerraduras")?.prefijoOrden).toBe("CER")
  })

  it("siempre devuelve entre 2 y 5 letras mayúsculas sin acentos", () => {
    for (const texto of ["máquinas de café", "ollas", "aires acondicionados", "pc"]) {
      const p = derivarDesdeDetalle(texto)!.prefijoOrden
      expect(p, texto).toMatch(/^[A-Z]{2,5}$/)
    }
  })
})

describe("derivarDesdeDetalle — entradas que no sirven", () => {
  it.each([null, undefined, "", "   ", "!!!", "---", "1"])(
    "devuelve null para %p",
    (entrada) => {
      expect(derivarDesdeDetalle(entrada as any)).toBeNull()
    }
  )

  it("devuelve null si al limpiar no queda ninguna letra", () => {
    expect(derivarDesdeDetalle("### $$$ ###")).toBeNull()
  })

  it("corta las respuestas absurdamente largas sin romper", () => {
    const d = derivarDesdeDetalle("a".repeat(500))
    expect(d).not.toBeNull()
    expect(d!.codigo.length).toBeLessThanOrEqual(20)
    expect(d!.prefijoOrden).toMatch(/^[A-Z]{2,5}$/)
  })
})

describe("personalizarPack", () => {
  const generico = getRubro("generico")

  it("reemplaza el tipo EQUIPO por el que describió el usuario", () => {
    const pack = personalizarPack(generico, "máquinas de café")

    expect(pack.tipos).toHaveLength(1)
    expect(pack.tipos[0].codigo).toBe("MAQUINA_DE_CAFE")
    expect(pack.tipos[0].nombre).toBe("Máquina de café")
    expect(pack.tipos[0].prefijoOrden).toBe("MAQ")
  })

  it("conserva la config del pack base (campos, accesorios, categorías)", () => {
    const pack = personalizarPack(generico, "cortadoras de pasto")

    expect(pack.tipos[0].config.campos?.imei?.visible).toBe(true)
    expect(pack.tipos[0].config.campos?.password?.visible).toBe(false)
    expect(pack.tipos[0].config.categoriasInventario).toEqual(
      generico.tipos[0].config.categoriasInventario
    )
  })

  it("escribe el vocabulario derivado", () => {
    const pack = personalizarPack(generico, "máquinas de café")

    expect(pack.terminologia.equipo).toBe("Máquina de café")
    expect(pack.terminologia.equipoPlural).toBe("Máquinas de café")
  })

  it("apunta los checklists sin tipo al tipo nuevo", () => {
    const pack = personalizarPack(generico, "cerraduras")
    expect(pack.checklists[0].tipoCodigo).toBe("CERRADURA")
  })

  it("devuelve el pack intacto si el detalle no sirve", () => {
    expect(personalizarPack(generico, "")).toBe(generico)
    expect(personalizarPack(generico, null)).toBe(generico)
    expect(personalizarPack(generico, "###")).toBe(generico)
  })

  it("no muta el pack original", () => {
    const antes = JSON.stringify(generico)
    personalizarPack(generico, "máquinas de café")
    expect(JSON.stringify(generico)).toBe(antes)
  })

  /**
   * Solo el pack genérico se personaliza. Si alguien eligió "Taller mecánico" y
   * ademas escribió algo, el pack curado gana: tiene tres tipos, marcas y
   * problemas propios que una derivación de texto libre no puede reemplazar.
   */
  it("no toca los packs curados", () => {
    const automotor = getRubro("automotor")
    expect(personalizarPack(automotor, "máquinas de café")).toBe(automotor)
  })
})
