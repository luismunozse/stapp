import { ImageResponse } from "next/og"
import { supabaseAdmin } from "@/lib/supabase"
import { stockDisponibleCatalogo } from "@/lib/catalogo/stock-disponible"

export const runtime = "nodejs"
export const alt = "Item del catálogo"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

const FALLBACK_COLOR = "#2563eb"

function formatPrecio(n: number, moneda: string) {
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: moneda || "ARS",
      maximumFractionDigits: 0,
    }).format(n)
  } catch {
    return `$${n.toLocaleString("es-AR")}`
  }
}

function clip(s: string | null | undefined, max: number): string {
  if (!s) return ""
  return s.length > max ? s.slice(0, max - 1) + "…" : s
}

export default async function Image({ params }: { params: { slug: string; itemId: string } }) {
  const { slug, itemId } = params

  const { data: config } = await supabaseAdmin
    .from("catalogo_config")
    .select("titulo, color_primary, organization_id, activo")
    .eq("slug", slug)
    .maybeSingle()

  if (!config || !config.activo) {
    return fallbackOG("Catálogo", "Producto no disponible", FALLBACK_COLOR)
  }

  const [{ data: item }, { data: org }] = await Promise.all([
    supabaseAdmin
      .from("catalogo_items")
      .select("nombre, descripcion, tipo, precio, precio_hasta, imagen_url, stock, inventario_id, inventario:inventario(stock, stock_reservado)")
      .eq("id", itemId)
      .eq("organization_id", config.organization_id)
      .eq("activo", true)
      .maybeSingle(),
    supabaseAdmin
      .from("organizations")
      .select("nombre, nombre_mostrar, logo_url, moneda")
      .eq("id", config.organization_id)
      .single(),
  ])

  if (!item) return fallbackOG("Item no encontrado", config.titulo || "Catálogo", config.color_primary || FALLBACK_COLOR)

  const color = config.color_primary || FALLBACK_COLOR
  const moneda = org?.moneda || "ARS"
  const orgName = org?.nombre_mostrar || org?.nombre || "Catálogo"
  // Mismo cálculo que la página del item: si la card compartida dice "quedan
  // unidades" y la página dice "Agotado", el link llega desmintiéndose solo.
  const stockReal = stockDisponibleCatalogo(item as any)
  const agotado = stockReal === 0
  const nombre = clip(item.nombre, 80)
  const descripcion = clip(item.descripcion, 140)

  const precioLabel = (() => {
    if (item.precio == null) return "Consultar precio"
    const base = formatPrecio(Number(item.precio), moneda)
    return item.precio_hasta != null ? `Desde ${base}` : base
  })()

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#ffffff",
        }}
      >
        {/* Imagen lateral */}
        <div
          style={{
            width: 600,
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: `linear-gradient(135deg, ${color}1f 0%, ${color}0a 100%)`,
            overflow: "hidden",
          }}
        >
          {item.imagen_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.imagen_url}
              alt=""
              width={520}
              height={520}
              style={{ objectFit: "cover", borderRadius: 24, boxShadow: "0 20px 50px rgba(0,0,0,0.15)" }}
            />
          ) : (
            <div
              style={{
                fontSize: 220,
                opacity: 0.45,
              }}
            >
              {item.tipo === "SERVICIO" ? "🛠️" : "📦"}
            </div>
          )}
        </div>

        {/* Contenido derecho */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            padding: "60px 56px",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                fontSize: 22,
                color: "#475569",
                marginBottom: 24,
              }}
            >
              {org?.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={org.logo_url}
                  alt=""
                  width={44}
                  height={44}
                  style={{ borderRadius: 8, objectFit: "cover" }}
                />
              ) : (
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 8,
                    background: color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#ffffff",
                    fontWeight: 800,
                    fontSize: 22,
                  }}
                >
                  {orgName.slice(0, 1).toUpperCase()}
                </div>
              )}
              <span style={{ fontWeight: 600 }}>{clip(orgName, 30)}</span>
            </div>

            <div
              style={{
                fontSize: 56,
                fontWeight: 800,
                color: "#0f172a",
                lineHeight: 1.05,
                marginBottom: 18,
                display: "flex",
              }}
            >
              {nombre}
            </div>

            {descripcion && (
              <div
                style={{
                  fontSize: 24,
                  color: "#475569",
                  lineHeight: 1.4,
                  display: "flex",
                }}
              >
                {descripcion}
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div
                style={{
                  fontSize: 44,
                  fontWeight: 800,
                  color,
                }}
              >
                {precioLabel}
              </div>
              {agotado && (
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: "#dc2626",
                    background: "#fee2e2",
                    padding: "6px 14px",
                    borderRadius: 999,
                  }}
                >
                  AGOTADO
                </div>
              )}
            </div>

            <div
              style={{
                fontSize: 20,
                fontWeight: 600,
                color: "#ffffff",
                background: color,
                padding: "14px 28px",
                borderRadius: 999,
                alignSelf: "flex-start",
              }}
            >
              Ver y cotizar →
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size }
  )
}

function fallbackOG(titulo: string, sub: string, color: string) {
  return new ImageResponse(
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
        <div
          style={{
            fontSize: 28,
            color: "#475569",
            marginTop: 24,
            textAlign: "center",
            maxWidth: 900,
          }}
        >
          {sub}
        </div>
      </div>
    ),
    { ...size }
  )
}
