import { ImageResponse } from "next/og"
import { supabaseAdmin } from "@/lib/supabase"

export const runtime = "nodejs"
export const alt = "Catálogo"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default async function Image({ params }: { params: { slug: string } }) {
  const { slug } = params

  const { data: config } = await supabaseAdmin
    .from("catalogo_config")
    .select("titulo, descripcion, color_primary, organization_id, activo")
    .eq("slug", slug)
    .maybeSingle()

  const fallback = (titulo: string, sub: string, color: string) =>
    new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: `linear-gradient(135deg, ${color}22 0%, ${color}11 60%, #ffffff 100%)`,
            padding: 80,
          }}
        >
          <div
            style={{
              fontSize: 64,
              fontWeight: 800,
              color: "#0f172a",
              textAlign: "center",
              maxWidth: 1000,
              lineHeight: 1.1,
            }}
          >
            {titulo}
          </div>
          <div style={{ fontSize: 28, color: "#475569", marginTop: 24, textAlign: "center", maxWidth: 900 }}>
            {sub}
          </div>
          <div
            style={{
              marginTop: 60,
              fontSize: 22,
              color,
              fontWeight: 600,
              padding: "12px 28px",
              borderRadius: 999,
              background: "#ffffff",
              border: `2px solid ${color}`,
            }}
          >
            Ver catálogo →
          </div>
        </div>
      ),
      { ...size }
    )

  if (!config || !config.activo) {
    return fallback("Catálogo", "Productos y servicios", "#2563eb")
  }

  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("nombre, nombre_mostrar")
    .eq("id", config.organization_id)
    .single()

  const titulo = config.titulo || org?.nombre_mostrar || org?.nombre || "Catálogo"
  const descripcion = config.descripcion || "Productos y servicios"
  const color = config.color_primary || "#2563eb"

  return fallback(titulo, descripcion, color)
}
