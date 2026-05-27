import { redirect } from "next/navigation"

// La ruta detallada /cotizaciones/[id] no existe como página independiente.
// El detalle se abre como dialog en /cotizaciones?abrir=<id>.
// Esta page captura links viejos (notificaciones, bookmarks, screenshots
// compartidos) y los redirige al deeplink correcto.
export default async function CotizacionRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/cotizaciones?abrir=${encodeURIComponent(id)}`)
}
