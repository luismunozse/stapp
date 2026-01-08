"use client"

import Link from "next/link"
import Image from "next/image"
import { Mail, Phone, MapPin, Twitter, Facebook, Instagram, Linkedin } from "lucide-react"

export function Footer() {
  const currentYear = new Date().getFullYear()

  const footerLinks = {
    producto: [
      { name: "Características", href: "#features" },
      { name: "Precios", href: "#pricing" },
      { name: "Testimonios", href: "#testimonials" },
      { name: "FAQ", href: "#faq" },
    ],
    empresa: [
      { name: "Sobre Nosotros", href: "/empresa/sobre-nosotros" },
      { name: "Blog", href: "/empresa/blog" },
      { name: "Trabaja con nosotros", href: "/empresa/trabaja-con-nosotros" },
      { name: "Contacto", href: "/empresa/contacto" },
    ],
    legal: [
      { name: "Términos de servicio", href: "/legal/terminos" },
      { name: "Política de privacidad", href: "/legal/privacidad" },
      { name: "Política de cookies", href: "/legal/cookies" },
    ],
  }

  const socialLinks = [
    { name: "Twitter", icon: Twitter, href: "#" },
    { name: "Facebook", icon: Facebook, href: "#" },
    { name: "Instagram", icon: Instagram, href: "#" },
    { name: "LinkedIn", icon: Linkedin, href: "#" },
  ]

  return (
    <footer className="bg-gray-900 text-gray-300">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8">
          {/* Brand */}
          <div className="lg:col-span-2">
            <Link href="/" className="flex items-center mb-6">
              <Image
                src="/logo.png"
                alt="STApp"
                width={120}
                height={40}
                className="h-10 w-auto object-contain brightness-0 invert"
              />
            </Link>
            <p className="text-gray-400 mb-6 max-w-sm">
              Sistema completo para gestionar tu taller de reparación de
              dispositivos electrónicos. Órdenes, inventario, facturación y más.
            </p>
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <Mail className="w-5 h-5 text-gray-500" />
                <span>soporte@stapp.com</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Phone className="w-5 h-5 text-gray-500" />
                <span>+1 (555) 123-4567</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <MapPin className="w-5 h-5 text-gray-500" />
                <span>Disponible en toda Latinoamérica</span>
              </div>
            </div>
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

          {/* Empresa */}
          <div>
            <h3 className="text-white font-semibold mb-4">Empresa</h3>
            <ul className="space-y-3">
              {footerLinks.empresa.map((link) => (
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
        <div className="border-t border-gray-800 mt-8 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-gray-500">
            © {currentYear} STApp. Todos los derechos reservados.
          </p>
          <div className="flex items-center gap-4">
            {socialLinks.map((social) => (
              <a
                key={social.name}
                href={social.href}
                className="text-gray-500 hover:text-white transition-colors"
                aria-label={social.name}
              >
                <social.icon className="w-5 h-5" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}
