"use client"

import Link from "next/link"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Clock,
  MessageCircle,
  Send,
  CheckCircle,
} from "lucide-react"

export default function ContactoPage() {
  const [formData, setFormData] = useState({
    nombre: "",
    email: "",
    telefono: "",
    asunto: "",
    mensaje: "",
  })
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    // Simular envío
    await new Promise((resolve) => setTimeout(resolve, 1500))

    setSubmitted(true)
    setLoading(false)
    setFormData({
      nombre: "",
      email: "",
      telefono: "",
      asunto: "",
      mensaje: "",
    })

    // Reset mensaje de éxito después de 5 segundos
    setTimeout(() => setSubmitted(false), 5000)
  }

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    })
  }

  const contactMethods = [
    {
      icon: Mail,
      title: "Email",
      description: "Nuestro equipo de soporte",
      value: "soporte@stapp.com",
      href: "mailto:soporte@stapp.com",
      color: "text-blue-600",
      bgColor: "bg-blue-50",
    },
    {
      icon: Phone,
      title: "Teléfono",
      description: "Lun a Vie, 9am - 6pm",
      value: "+54 11 1234-5678",
      href: "tel:+541112345678",
      color: "text-green-600",
      bgColor: "bg-green-50",
    },
    {
      icon: MessageCircle,
      title: "WhatsApp",
      description: "Respuesta rápida",
      value: "+54 11 1234-5678",
      href: "https://wa.me/541112345678",
      color: "text-emerald-600",
      bgColor: "bg-emerald-50",
    },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Header */}
      <header className="border-b bg-white">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Link href="/landing">
            <Button variant="ghost" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Volver al inicio
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-16 sm:py-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-6">
              Contáctanos
            </h1>
            <p className="text-xl text-gray-600">
              ¿Tienes preguntas? Estamos aquí para ayudarte. Envíanos un mensaje y
              te responderemos lo antes posible.
            </p>
          </div>
        </div>
      </section>

      {/* Contact Methods */}
      <section className="pb-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-5xl mx-auto">
            <div className="grid md:grid-cols-3 gap-6">
              {contactMethods.map((method) => (
                <a
                  key={method.title}
                  href={method.href}
                  target={method.href.startsWith("http") ? "_blank" : undefined}
                  rel={method.href.startsWith("http") ? "noopener noreferrer" : undefined}
                  className="block"
                >
                  <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer">
                    <CardContent className="pt-6 text-center">
                      <div
                        className={`w-14 h-14 ${method.bgColor} rounded-full flex items-center justify-center mx-auto mb-4`}
                      >
                        <method.icon className={`h-7 w-7 ${method.color}`} />
                      </div>
                      <h3 className="font-semibold text-gray-900 mb-1">
                        {method.title}
                      </h3>
                      <p className="text-sm text-gray-500 mb-2">
                        {method.description}
                      </p>
                      <p className={`font-medium ${method.color}`}>
                        {method.value}
                      </p>
                    </CardContent>
                  </Card>
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Contact Form & Info */}
      <section className="pb-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-5xl mx-auto grid lg:grid-cols-3 gap-8">
            {/* Form */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Envíanos un mensaje</CardTitle>
                </CardHeader>
                <CardContent>
                  {submitted && (
                    <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
                      <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-green-800 font-medium">
                          ¡Mensaje enviado exitosamente!
                        </p>
                        <p className="text-green-700 text-sm mt-1">
                          Nos pondremos en contacto contigo pronto.
                        </p>
                      </div>
                    </div>
                  )}

                  <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="nombre">Nombre completo *</Label>
                        <Input
                          id="nombre"
                          name="nombre"
                          value={formData.nombre}
                          onChange={handleChange}
                          required
                          placeholder="Juan Pérez"
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label htmlFor="telefono">Teléfono</Label>
                        <Input
                          id="telefono"
                          name="telefono"
                          type="tel"
                          value={formData.telefono}
                          onChange={handleChange}
                          placeholder="+54 11 1234-5678"
                          className="mt-1"
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="email">Email *</Label>
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        value={formData.email}
                        onChange={handleChange}
                        required
                        placeholder="juan@ejemplo.com"
                        className="mt-1"
                      />
                    </div>

                    <div>
                      <Label htmlFor="asunto">Asunto *</Label>
                      <Input
                        id="asunto"
                        name="asunto"
                        value={formData.asunto}
                        onChange={handleChange}
                        required
                        placeholder="¿En qué podemos ayudarte?"
                        className="mt-1"
                      />
                    </div>

                    <div>
                      <Label htmlFor="mensaje">Mensaje *</Label>
                      <Textarea
                        id="mensaje"
                        name="mensaje"
                        value={formData.mensaje}
                        onChange={handleChange}
                        required
                        rows={6}
                        placeholder="Cuéntanos más sobre tu consulta..."
                        className="mt-1"
                      />
                    </div>

                    <Button type="submit" size="lg" className="w-full gap-2" disabled={loading}>
                      {loading ? (
                        <>
                          <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Enviando...
                        </>
                      ) : (
                        <>
                          <Send className="h-4 w-4" />
                          Enviar mensaje
                        </>
                      )}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>

            {/* Additional Info */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Horarios de Atención</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-start gap-3">
                    <Clock className="h-5 w-5 text-gray-400 mt-0.5" />
                    <div>
                      <p className="font-medium text-gray-900">Lunes a Viernes</p>
                      <p className="text-sm text-gray-600">9:00 AM - 6:00 PM (ART)</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Clock className="h-5 w-5 text-gray-400 mt-0.5" />
                    <div>
                      <p className="font-medium text-gray-900">Fin de Semana</p>
                      <p className="text-sm text-gray-600">Cerrado</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Ubicación</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-start gap-3">
                    <MapPin className="h-5 w-5 text-gray-400 mt-0.5" />
                    <div>
                      <p className="text-gray-700">Buenos Aires, Argentina</p>
                      <p className="text-sm text-gray-600 mt-1">
                        Servicio disponible en toda Latinoamérica
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-primary/5 border-primary/20">
                <CardContent className="pt-6">
                  <h3 className="font-semibold text-gray-900 mb-2">
                    ¿Necesitas ayuda inmediata?
                  </h3>
                  <p className="text-sm text-gray-700 mb-4">
                    Consulta nuestra sección de preguntas frecuentes o inicia una
                    prueba gratuita.
                  </p>
                  <div className="space-y-2">
                    <Button variant="outline" className="w-full" asChild>
                      <Link href="/landing#faq">Ver FAQ</Link>
                    </Button>
                    <Button className="w-full" asChild>
                      <Link href="/registro">Probar gratis</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-white py-8">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-gray-600">
            © {new Date().getFullYear()} STApp. Todos los derechos reservados.
          </p>
        </div>
      </footer>
    </div>
  )
}
