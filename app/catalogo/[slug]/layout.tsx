import { Plus_Jakarta_Sans, Inter } from "next/font/google"

// Loaded ONLY here so the dashboard bundle never pays for these fonts.
const displayFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["500", "700", "800"],
  variable: "--font-display",
  display: "swap",
})

const bodyFont = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
})

/**
 * Storefront scope: fixed light "warm commercial v2" tokens + fonts.
 * Brand vars (--brand*) keep being applied per view via brandCssVars().
 */
export default function CatalogoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`catalogo-storefront ${displayFont.variable} ${bodyFont.variable} min-h-screen bg-cat-bg font-body text-cat-ink`}
    >
      {children}
    </div>
  )
}
