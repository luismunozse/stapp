import { ImageResponse } from "next/og"
import { NextRequest } from "next/server"

export const runtime = "edge"

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const title = searchParams.get("title") || "STApp - Gesti\u00f3n de Servicio T\u00e9cnico"
  const description =
    searchParams.get("description") ||
    "Software para talleres de reparaci\u00f3n de celulares y dispositivos electr\u00f3nicos"

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0a0a1a",
          backgroundImage:
            "radial-gradient(circle at 25% 25%, #1e3a5f 0%, transparent 50%), radial-gradient(circle at 75% 75%, #1a1a4e 0%, transparent 50%)",
        }}
      >
        {/* Grid pattern */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "60px 80px",
            textAlign: "center",
          }}
        >
          {/* Logo */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
              marginBottom: "40px",
            }}
          >
            <div
              style={{
                width: "64px",
                height: "64px",
                borderRadius: "16px",
                background: "linear-gradient(135deg, #3b82f6, #2563eb)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                <line x1="12" y1="18" x2="12" y2="18" />
              </svg>
            </div>
            <span
              style={{
                fontSize: "48px",
                fontWeight: "bold",
                color: "white",
                letterSpacing: "-1px",
              }}
            >
              <span style={{ color: "#3b82f6" }}>ST</span>App
            </span>
          </div>

          {/* Title */}
          <h1
            style={{
              fontSize: "52px",
              fontWeight: "bold",
              color: "white",
              lineHeight: 1.2,
              marginBottom: "20px",
              maxWidth: "900px",
            }}
          >
            {title}
          </h1>

          {/* Description */}
          <p
            style={{
              fontSize: "24px",
              color: "rgba(255,255,255,0.7)",
              lineHeight: 1.5,
              maxWidth: "700px",
            }}
          >
            {description}
          </p>

          {/* Features bar */}
          <div
            style={{
              display: "flex",
              gap: "32px",
              marginTop: "40px",
              color: "rgba(255,255,255,0.6)",
              fontSize: "18px",
            }}
          >
            <span>\u2022 \u00d3rdenes de trabajo</span>
            <span>\u2022 Inventario</span>
            <span>\u2022 Clientes</span>
            <span>\u2022 Reportes</span>
          </div>

          {/* URL */}
          <div
            style={{
              position: "absolute",
              bottom: "30px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              color: "rgba(255,255,255,0.4)",
              fontSize: "18px",
            }}
          >
            stapp.com.ar
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  )
}
