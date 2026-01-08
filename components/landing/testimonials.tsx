"use client"

import { Star } from "lucide-react"

const testimonials = [
  {
    content:
      "Antes llevaba todo en papel y era un caos. Con STApp puedo rastrear cada reparación y mis clientes reciben actualizaciones automáticas. ¡Una maravilla!",
    author: "Carlos Martínez",
    role: "Dueño de TechFix",
    avatar: "CM",
    rating: 5,
  },
  {
    content:
      "El control de inventario me salvó. Ahora sé exactamente qué repuestos tengo y cuándo pedir más. Ya no pierdo ventas por falta de stock.",
    author: "María González",
    role: "Propietaria de CelularesExpress",
    avatar: "MG",
    rating: 5,
  },
  {
    content:
      "Probé varios sistemas y este es el único que realmente entiende las necesidades de un taller de reparaciones. El soporte es excelente.",
    author: "Roberto Sánchez",
    role: "Gerente de ComputerShop",
    avatar: "RS",
    rating: 5,
  },
]

export function Testimonials() {
  return (
    <section id="testimonials" className="py-6 sm:py-8 bg-gray-50">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-6">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
            Lo que dicen nuestros clientes
          </h2>
          <p className="text-lg text-gray-600">
            Más de 500 talleres confían en STApp para gestionar
            sus reparaciones.
          </p>
        </div>

        {/* Testimonials grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {testimonials.map((testimonial, index) => (
            <div
              key={index}
              className="bg-white rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow"
            >
              {/* Stars */}
              <div className="flex gap-1 mb-4">
                {Array.from({ length: testimonial.rating }).map((_, i) => (
                  <Star
                    key={i}
                    className="w-5 h-5 fill-yellow-400 text-yellow-400"
                  />
                ))}
              </div>

              {/* Quote */}
              <blockquote className="text-gray-700 mb-6">
                "{testimonial.content}"
              </blockquote>

              {/* Author */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm">
                  {testimonial.avatar}
                </div>
                <div>
                  <p className="font-semibold text-gray-900">
                    {testimonial.author}
                  </p>
                  <p className="text-sm text-gray-500">{testimonial.role}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
