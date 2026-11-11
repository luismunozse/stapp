import { redirect } from "next/navigation"

/**
 * /reportes-avanzados dibujaba la misma ReportesAvanzadosView que /reportes,
 * pero cerrada entera en Free y sin el permiso `vendedores_ven_ingresos` de la
 * pestaña Clientes. Además no la cubría el filtro de rutas por rol del
 * middleware (/reportes sí: un TECNICO no entra). Ahora /reportes bloquea
 * pestaña por pestaña lo que es del plan Profesional, así que esta ruta queda
 * como alias para no romper links viejos (el asistente la cita, y puede haber
 * favoritos).
 */
export default function ReportesAvanzadosPage() {
  redirect("/reportes")
}
