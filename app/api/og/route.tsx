import { ImageResponse } from "next/og"
import { NextRequest } from "next/server"

export const runtime = "edge"

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const title = searchParams.get("title") || "STApp - Software de Gestión para Talleres de Celulares"
  const description =
    searchParams.get("description") ||
    "Gestión completa de tu taller: órdenes, inventario, ventas y finanzas"

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
          backgroundColor: "#f8fafc",
          backgroundImage:
            "radial-gradient(circle at 20% 20%, #dbeafe 0%, transparent 55%), radial-gradient(circle at 80% 80%, #e0e7ff 0%, transparent 55%)",
        }}
      >
        {/* Grid pattern */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(to right, rgba(37,99,235,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(37,99,235,0.06) 1px, transparent 1px)",
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
              gap: "18px",
              marginBottom: "36px",
            }}
          >
            <div
              style={{
                width: "72px",
                height: "72px",
                borderRadius: "18px",
                background: "linear-gradient(135deg, #3b82f6, #2563eb)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 10px 25px rgba(37,99,235,0.35)",
              }}
            >
              <svg
                width="40"
                height="40"
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
                fontSize: "54px",
                fontWeight: "bold",
                color: "#0f172a",
                letterSpacing: "-1.5px",
              }}
            >
              <span style={{ color: "#2563eb" }}>ST</span>App
            </span>
          </div>

          {/* Title */}
          <h1
            style={{
              fontSize: "56px",
              fontWeight: "bold",
              color: "#0f172a",
              lineHeight: 1.15,
              marginBottom: "20px",
              maxWidth: "960px",
              letterSpacing: "-1px",
            }}
          >
            {title}
          </h1>

          {/* Description */}
          <p
            style={{
              fontSize: "26px",
              color: "#475569",
              lineHeight: 1.45,
              maxWidth: "820px",
              margin: 0,
            }}
          >
            {description}
          </p>

          {/* Features bar */}
          <div
            style={{
              display: "flex",
              gap: "32px",
              marginTop: "32px",
              color: "#64748b",
              fontSize: "20px",
              fontWeight: 500,
            }}
          >
            <span>• Órdenes</span>
            <span>• Inventario</span>
            <span>• Ventas</span>
            <span>• Finanzas</span>
          </div>

          {/* CTA Button */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginTop: "36px",
              padding: "20px 48px",
              background: "linear-gradient(135deg, #3b82f6, #2563eb)",
              borderRadius: "999px",
              color: "white",
              fontSize: "28px",
              fontWeight: "bold",
              boxShadow: "0 14px 36px rgba(37,99,235,0.45)",
            }}
          >
            Probá gratis 30 días →
          </div>

          {/* URL */}
          <div
            style={{
              position: "absolute",
              bottom: "30px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              color: "#94a3b8",
              fontSize: "18px",
              fontWeight: 500,
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
