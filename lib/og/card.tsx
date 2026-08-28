/**
 * Tarjeta de Open Graph: lo que se ve cuando alguien pega un link de STApp en
 * WhatsApp, que es por lejos donde mas se comparte.
 *
 * Tres decisiones que mandan sobre el resto:
 *
 * 1. El medio es chico. En un chat el preview entra en unos 400px de ancho, a
 *    veces menos. A ese tamano se leen tres cosas: la marca, una linea de
 *    texto y un color. Por eso el titular es enorme y no hay grillas de
 *    features ni listas de bullets.
 *
 * 2. Se usa el logo de verdad. La version anterior dibujaba un cuadrado con
 *    las letras "ST" en vez del isotipo real (un equipo con un circuito en la
 *    pantalla), que es justamente lo que hace reconocible a la marca.
 *
 * 3. Sin degrades. Las dos versiones anteriores se apoyaban en uno y
 *    terminaban pareciendo cualquier banner de SaaS. Color plano, que ademas
 *    aguanta el escalado a miniatura sin ensuciarse.
 *
 * No lleva bajada en la variante de producto: WhatsApp ya muestra la meta
 * description justo debajo de la imagen, y repetirla es gastar el espacio que
 * necesita el titular.
 */

const PAPEL = "#FFFFFF"
const MESA = "#EEF2F7"
const TINTA = "#0B1220"
const TINTA_SUAVE = "#5A6879"
const AZUL = "#2563EB"
const VERDE = "#047857"
const VERDE_FONDO = "#ECFDF5"
const LINEA = "#DDE3EC"

/** Isotipo real: el equipo con el circuito en la pantalla. */
function Isotipo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <rect x="10" y="4" width="28" height="40" rx="6" fill={AZUL} />
      <rect x="14" y="10" width="20" height="28" rx="2" fill={PAPEL} />
      <path
        d="M18 18h4v4h6v-4h2M18 26h10M22 26v6"
        stroke={AZUL}
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="18" cy="18" r="1.5" fill={AZUL} />
      <circle cx="28" cy="26" r="1.5" fill={AZUL} />
      <circle cx="22" cy="32" r="1.5" fill={AZUL} />
      <rect x="20" y="6" width="8" height="2" rx="1" fill="rgba(255,255,255,0.5)" />
      <rect x="18" y="40" width="12" height="2" rx="1" fill="rgba(255,255,255,0.3)" />
    </svg>
  )
}

function Marca() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <Isotipo size={58} />
      <div
        style={{
          display: "flex",
          fontSize: 46,
          fontWeight: 700,
          letterSpacing: -1.2,
        }}
      >
        <div style={{ color: AZUL }}>ST</div>
        <div style={{ color: TINTA }}>App</div>
      </div>
    </div>
  )
}

/** Chip de estado: el unico acento de color de la pieza. */
function ChipEstado() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 22px",
        borderRadius: 999,
        backgroundColor: VERDE_FONDO,
        border: `1px solid ${VERDE}`,
      }}
    >
      <div
        style={{ width: 12, height: 12, borderRadius: 999, backgroundColor: VERDE }}
      />
      <div style={{ fontSize: 24, fontWeight: 600, color: VERDE }}>
        Listo para entregar
      </div>
    </div>
  )
}

export interface OgCardProps {
  /** Titulo propio (posts del blog). Sin esto sale la tarjeta del producto. */
  titulo?: string
  descripcion?: string
}

// Va en tres lineas a proposito: la triada tiene ritmo, y nombra ordenes,
// inventario y caja con las palabras del taller — el equipo que deja el
// cliente, el repuesto que se usa, la plata que entra — sin enumerar features.
const LINEAS_PRODUCTO = ["Cada equipo,", "cada repuesto,", "cada peso."]

export function OgCard({ titulo, descripcion }: OgCardProps) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        padding: 48,
        backgroundColor: MESA,
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "52px 64px",
          backgroundColor: PAPEL,
          borderRadius: 28,
          border: `1px solid ${LINEA}`,
        }}
      >
        <Marca />

        {titulo ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontSize: 58,
                fontWeight: 700,
                lineHeight: 1.1,
                letterSpacing: -2,
                color: TINTA,
                // Un titulo largo no puede empujar la bajada fuera de la
                // tarjeta.
                maxHeight: 200,
                overflow: "hidden",
              }}
            >
              {titulo}
            </div>
            {descripcion ? (
              <div
                style={{
                  display: "flex",
                  marginTop: 20,
                  fontSize: 28,
                  color: TINTA_SUAVE,
                  lineHeight: 1.35,
                  maxHeight: 78,
                  overflow: "hidden",
                }}
              >
                {descripcion}
              </div>
            ) : null}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {LINEAS_PRODUCTO.map((linea) => (
              <div
                key={linea}
                style={{
                  display: "flex",
                  fontSize: 86,
                  fontWeight: 700,
                  lineHeight: 1.06,
                  letterSpacing: -3,
                  color: TINTA,
                }}
              >
                {linea}
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {/* El chip es un estado real de una orden y solo tiene sentido en la
              tarjeta del producto. En un articulo seria ruido: ahi la etiqueta
              dice lo unico util, que esto es una nota del blog. */}
          {titulo ? (
            <div
              style={{
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: 1.5,
                color: AZUL,
              }}
            >
              BLOG
            </div>
          ) : (
            <ChipEstado />
          )}
          <div style={{ fontSize: 26, color: TINTA_SUAVE }}>stapp.com.ar</div>
        </div>
      </div>
    </div>
  )
}

export const OG_SIZE = { width: 1200, height: 630 } as const
