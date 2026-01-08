"use client"

import Link from "next/link"
import Image from "next/image"

export function Footer() {
  const currentYear = new Date().getFullYear()

  const footerLinks = {
    producto: [
      { name: "Características", href: "#features" },
      { name: "Precios", href: "#pricing" },
      { name: "Testimonios", href: "#testimonials" },
      { name: "FAQ", href: "#faq" },
    ],
    legal: [
      { name: "Términos de servicio", href: "/legal/terminos" },
      { name: "Política de privacidad", href: "/legal/privacidad" },
      { name: "Política de cookies", href: "/legal/cookies" },
    ],
  }

  return (
    <footer className="bg-gray-900 text-gray-300">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="lg:col-span-2">
            <Link href="/" className="flex items-center mb-6">
              <Image
                src="/logo.png"
                alt="STApp"
                width={160}
                height={48}
                className="h-12 w-auto object-contain brightness-0 invert"
              />
            </Link>
            <p className="text-gray-400 max-w-sm">
              Sistema completo para gestionar tu taller de reparación de
              dispositivos electrónicos. Órdenes, inventario, facturación y más.
            </p>
          </div>

          {/* Producto */}
          <div>
            <h3 className="text-white font-semibold mb-4">Producto</h3>
            <ul className="space-y-3">
              {footerLinks.producto.map((link) => (
                <li key={link.name}>
                  <a
                    href={link.href}
                    className="text-gray-400 hover:text-white transition-colors"
                  >
                    {link.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="text-white font-semibold mb-4">Legal</h3>
            <ul className="space-y-3">
              {footerLinks.legal.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className="text-gray-400 hover:text-white transition-colors"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom */}
        <div className="border-t border-gray-800 mt-8 pt-6">
          <p className="text-sm text-gray-500 text-center">
            © {currentYear} STApp. Todos los derechos reservados.
          </p>
        </div>
      </div>
    </footer>
  )
}
