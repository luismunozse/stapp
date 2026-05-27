import { ImageResponse } from "next/og"
import { supabaseAdmin } from "@/lib/supabase"
import { isValidSlug } from "@/lib/catalogo-validators"

export const runtime = "nodejs"

// Tamaños permitidos para íconos PWA. 192 + 512 son obligatorios según
// Web App Manifest spec. 384 lo usa Chromium para Pixel densities altas.
// "maskable" se sirve como 512 con padding mayor para safe-zone (los lanchers
// recortan ~10% por el lado, sin padding se ve cortado).
const ALLOWED_SIZES = new Set([192, 384, 512])

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; size: string }> }
) {
  const { slug, size: sizeRaw } = await params

  if (!isValidSlug(slug)) {
    return new Response("Slug inválido", { status: 400 })
  }

  const sizeMatch = sizeRaw.match(/^(\d+)(-maskable)?$/)
  if (!sizeMatch) return new Response("Tamaño inválido", { status: 400 })
  const size = parseInt(sizeMatch[1], 10)
  const maskable = !!sizeMatch[2]
  if (!ALLOWED_SIZES.has(size)) {
    return new Response("Tamaño no soportado", { status: 400 })
  }

  const { data: config } = await supabaseAdmin
    .from("catalogo_config")
    .select("titulo, color_primary, organization_id, activo")
    .eq("slug", slug)
    .maybeSingle()

  if (!config || !config.activo) {
    return new Response("Catálogo no disponible", { status: 404 })
  }

  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("nombre_mostrar, nombre, logo_url")
    .eq("id", config.organization_id)
    .single()

  const color = /^#[0-9a-fA-F]{3,8}$/.test(config.color_primary || "")
    ? config.color_primary!
    : "#2563eb"

  const titulo = config.titulo || org?.nombre_mostrar || org?.nombre || "Catálogo"
  // Inicial(es) como fallback si no hay logo_url. Toma primeras 2 palabras.
  const inicial = titulo
    .split(/\s+/)
    .map((w: string) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()

  // Safe-zone para maskable: el ícono visible queda en el 80% central.
  // Web App Manifest spec: padding mínimo del 10% en cada lado.
  const innerSize = maskable ? Math.floor(size * 0.6) : Math.floor(size * 0.75)
  const fontSize = Math.floor(innerSize * 0.5)

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: color,
        }}
      >
        {org?.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={org.logo_url}
            alt=""
            width={innerSize}
            height={innerSize}
            style={{
              width: innerSize,
              height: innerSize,
              objectFit: "contain",
              borderRadius: maskable ? 0 : Math.floor(innerSize * 0.2),
            }}
          />
        ) : (
          <div
            style={{
              fontSize,
              fontWeight: 800,
              color: "#ffffff",
              fontFamily: "system-ui, sans-serif",
              letterSpacing: -2,
            }}
          >
            {inicial || "C"}
          </div>
        )}
      </div>
    ),
    {
      width: size,
      height: size,
      headers: {
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      },
    }
  )
}
