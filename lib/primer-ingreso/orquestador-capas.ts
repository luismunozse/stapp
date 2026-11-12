/**
 * Orquestador de capas de primer ingreso (auditoría UX §5.1).
 *
 * Al entrar por primera vez se apilaban hasta cuatro capas a la vez: el tour
 * guiado, el modal de novedades, el de cambio de políticas y el aviso de
 * instalación (beta de Android o PWA). Este módulo decide UNA sola por sesión.
 *
 * Cómo funciona:
 * - Cada capa se postula (`registrar`) cuando, según su propia lógica, querría
 *   mostrarse. Su "no mostrar nunca más" (localStorage, last_seen_version,
 *   etc.) sigue siendo suyo: si ya la cerraron, no se postula.
 * - Desde la primera postulación se abre una ventana corta (VENTANA_MS) para
 *   que lleguen las demás (algunas dependen de un fetch o de un evento del
 *   navegador). Al cerrarse, gana la de mayor prioridad.
 * - La ganadora queda fijada en sessionStorage: durante el resto de la
 *   sesión (la pestaña) solo esa capa puede mostrarse, aunque el usuario la
 *   cierre. Las demás esperan a la próxima sesión.
 * - Si después de la ventana todavía no ganó nadie, la primera que se postule
 *   gana en el acto.
 *
 * Es un store a nivel de módulo (no un Context) porque el instalador PWA vive
 * en el layout raíz, fuera del layout del panel: así todas las capas
 * comparten el mismo árbitro sin agregar providers.
 */

/**
 * Orden de prioridad, de mayor a menor. ÚNICO lugar donde se define.
 *
 * 1. tour: orientarse en la app es lo más útil en el primer ingreso, y solo
 *    compite mientras no se completó.
 * 2. novedades: cambia cómo se usa la app hoy; para quien ya hizo el tour es
 *    la información más relevante.
 * 3. politicas: es informativo y redundante con el banner de prueba, que
 *    queda siempre visible.
 * 4. apk-beta: invitación a la beta de Android; el aviso del menú lateral y
 *    /descargar siguen disponibles aunque pierda.
 * 5. pwa-instalar: sugerencia de instalación, lo menos urgente.
 */
export const PRIORIDAD_CAPAS = [
  "tour",
  "novedades",
  "politicas",
  "apk-beta",
  "pwa-instalar",
] as const

export type CapaId = (typeof PRIORIDAD_CAPAS)[number]

export const SESSION_KEY = "stapp_capa_sesion"
export const VENTANA_MS = 1500

type Listener = () => void

const candidatas = new Set<CapaId>()
const listeners = new Set<Listener>()
let activa: CapaId | null = null
let activaCargada = false
let ventanaAbierta = false
let ventanaCerrada = false
let timer: ReturnType<typeof setTimeout> | null = null

function esCapa(valor: unknown): valor is CapaId {
  return typeof valor === "string" && (PRIORIDAD_CAPAS as readonly string[]).includes(valor)
}

// sessionStorage puede faltar o tirar (ventana privada, datos bloqueados): en
// ese caso la decisión vive solo en memoria y vale para esta carga de página.
function leerSesion(): CapaId | null {
  try {
    const valor = window.sessionStorage.getItem(SESSION_KEY)
    return esCapa(valor) ? valor : null
  } catch {
    return null
  }
}

function guardarSesion(id: CapaId) {
  try {
    window.sessionStorage.setItem(SESSION_KEY, id)
  } catch {
    // sin storage: queda en memoria
  }
}

function cargarActiva() {
  if (activaCargada) return
  activaCargada = true
  activa = leerSesion()
}

function notificar() {
  listeners.forEach((l) => l())
}

function elegir() {
  if (activa) return
  const ganadora = PRIORIDAD_CAPAS.find((id) => candidatas.has(id))
  if (!ganadora) return
  activa = ganadora
  guardarSesion(ganadora)
  notificar()
}

function cerrarVentana() {
  timer = null
  ventanaCerrada = true
  elegir()
}

/** La capa avisa que querría mostrarse. */
export function registrar(id: CapaId) {
  cargarActiva()
  candidatas.add(id)
  if (activa) return
  if (ventanaCerrada) {
    elegir()
    return
  }
  if (!ventanaAbierta) {
    ventanaAbierta = true
    timer = setTimeout(cerrarVentana, VENTANA_MS)
  }
}

/** La capa ya no quiere mostrarse (se desmontó o la cerraron). */
export function retirar(id: CapaId) {
  // Si era la activa, la sesión ya la consumió: no se le pasa el turno a otra.
  candidatas.delete(id)
}

export function getActiva(): CapaId | null {
  cargarActiva()
  return activa
}

export function suscribir(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Solo para tests: vuelve el orquestador al estado inicial. */
export function __resetOrquestador() {
  if (timer) clearTimeout(timer)
  timer = null
  candidatas.clear()
  listeners.clear()
  activa = null
  activaCargada = false
  ventanaAbierta = false
  ventanaCerrada = false
}
