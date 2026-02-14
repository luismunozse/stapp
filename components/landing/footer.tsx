import Link from "next/link"
import { STAppLogo } from "@/components/shared/stapp-logo"

export function Footer() {
  // Calculado en el servidor - sin hydration mismatch
  const currentYear = new Date().getFullYear()

  const footerLinks = {
    producto: [
      { name: "Características", href: "#features" },
      { name: "Precios", href: "#pricing" },
      { name: "FAQ", href: "#faq" },
    ],
    legal: [
      { name: "Términos de servicio", href: "/legal/terminos" },
      { name: "Política de privacidad", href: "/legal/privacidad" },
      { name: "Política de cookies", href: "/legal/cookies" },
    ],
  }

  return (
    <footer className="bg-muted dark:bg-card border-t">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="lg:col-span-2">
            <Link href="/" className="flex items-center mb-6">
              <STAppLogo size="lg" />
            </Link>
            <p className="text-muted-foreground max-w-sm">
              Sistema completo para gestionar tu taller de reparación de
              dispositivos electrónicos. Órdenes, inventario, facturación y más.
            </p>
          </div>

          {/* Producto */}
          <div>
            <h3 className="text-foreground font-semibold mb-4">Producto</h3>
            <ul className="space-y-3">
              {footerLinks.producto.map((link) => (
                <li key={link.name}>
                  <a
                    href={link.href}
                    className="text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                  >
                    {link.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="text-foreground font-semibold mb-4">Legal</h3>
            <ul className="space-y-3">
              {footerLinks.legal.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className="text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom */}
        <div className="border-t mt-8 pt-6">
          <p className="text-sm text-muted-foreground text-center">
            © {currentYear} STApp. Todos los derechos reservados.
          </p>
        </div>
      </div>
    </footer>
  )
}
