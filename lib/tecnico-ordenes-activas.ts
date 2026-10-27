// The sentence that says how many open orders a technician holds when an ADMIN is about to deactivate him
// (or has just done it), and where they are. Deactivating a technician is a GLOBAL write, so the number is
// the total over every branch; `enAlcance` is the part in the scope the ADMIN works in, which is what a
// reassignment from this screen moves. Pure on purpose: the API warning and the confirm text of the page say
// the same thing.

/** What the ADMIN is told, or null when he holds no open order anywhere. `comienzo` is the subject ("El técnico tiene", "Aún tiene"). */
export function avisoDeOrdenesActivas(total: number, enAlcance: number | undefined, comienzo: string): string | null {
  if (total <= 0) return null
  const aca = enAlcance === undefined ? total : Math.max(0, Math.min(enAlcance, total))
  if (aca >= total) return `${comienzo} ${total} orden(es) activa(s). Considerá reasignarlas.`
  const donde = aca === 0 ? "todas de otras sucursales" : `(${aca} de esta sucursal y ${total - aca} de otras)`
  const cuantas = aca === 0 ? `${total} orden(es) activa(s), ${donde}` : `${total} orden(es) activa(s) ${donde}`
  return `${comienzo} ${cuantas}. Considerá reasignarlas: las de otras sucursales se mueven eligiendo esa sucursal en el selector.`
}
