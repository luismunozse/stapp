import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Política de Cookies | STApp",
  description: "Política de cookies y tecnologías de seguimiento de STApp",
  alternates: {
    canonical: "https://stapp.com.ar/legal/cookies",
  },
}

export default function CookiesPage() {
  return (
    <article className="prose prose-gray max-w-none">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Política de Cookies</h1>

      <p className="text-gray-500 mb-8">Última actualización: {new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}</p>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">1. ¿Qué son las Cookies?</h2>
        <p className="text-gray-600 mb-4">
          Las cookies son pequeños archivos de texto que se almacenan en su dispositivo (computadora, tablet
          o móvil) cuando visita un sitio web. Las cookies son ampliamente utilizadas para hacer que los
          sitios web funcionen de manera más eficiente y proporcionar información a los propietarios del sitio.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">2. ¿Cómo Usamos las Cookies?</h2>
        <p className="text-gray-600 mb-4">
          STApp utiliza cookies y tecnologías similares para varios propósitos:
        </p>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li>Mantener su sesión iniciada</li>
          <li>Recordar sus preferencias y configuraciones</li>
          <li>Entender cómo utiliza nuestro Servicio</li>
          <li>Mejorar el rendimiento y la funcionalidad</li>
          <li>Proporcionar contenido personalizado</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">3. Tipos de Cookies que Utilizamos</h2>

        <div className="overflow-x-auto mt-6">
          <table className="min-w-full border border-gray-200 rounded-lg">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 border-b">Tipo</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 border-b">Propósito</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 border-b">Duración</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              <tr>
                <td className="px-4 py-3 text-sm font-medium text-gray-900">Esenciales</td>
                <td className="px-4 py-3 text-sm text-gray-600">Necesarias para el funcionamiento básico del sitio (autenticación, seguridad)</td>
                <td className="px-4 py-3 text-sm text-gray-600">Sesión / 30 días</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-sm font-medium text-gray-900">Funcionales</td>
                <td className="px-4 py-3 text-sm text-gray-600">Recuerdan sus preferencias (idioma, tema, configuración)</td>
                <td className="px-4 py-3 text-sm text-gray-600">1 año</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-sm font-medium text-gray-900">Analíticas</td>
                <td className="px-4 py-3 text-sm text-gray-600">Nos ayudan a entender cómo los usuarios interactúan con el sitio</td>
                <td className="px-4 py-3 text-sm text-gray-600">2 años</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-sm font-medium text-gray-900">Rendimiento</td>
                <td className="px-4 py-3 text-sm text-gray-600">Mejoran la velocidad y el rendimiento del sitio</td>
                <td className="px-4 py-3 text-sm text-gray-600">1 año</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">4. Cookies Específicas que Utilizamos</h2>

        <h3 className="text-lg font-medium text-gray-900 mt-6 mb-3">Cookies Esenciales</h3>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li><strong>session_token:</strong> Mantiene su sesión iniciada de forma segura</li>
          <li><strong>csrf_token:</strong> Protección contra ataques de falsificación de solicitudes</li>
          <li><strong>tenant_id:</strong> Identifica su cuenta de negocio</li>
        </ul>

        <h3 className="text-lg font-medium text-gray-900 mt-6 mb-3">Cookies Funcionales</h3>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li><strong>user_preferences:</strong> Almacena sus preferencias de visualización</li>
          <li><strong>sidebar_state:</strong> Recuerda el estado de la barra lateral</li>
          <li><strong>theme:</strong> Recuerda su preferencia de tema (claro/oscuro)</li>
        </ul>

        <h3 className="text-lg font-medium text-gray-900 mt-6 mb-3">Cookies Analíticas</h3>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li><strong>_ga, _gid:</strong> Google Analytics - análisis de uso del sitio</li>
          <li><strong>_gat:</strong> Google Analytics - limita la tasa de solicitudes</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">5. Cookies de Terceros</h2>
        <p className="text-gray-600 mb-4">
          Utilizamos servicios de terceros que pueden establecer sus propias cookies:
        </p>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li><strong>Google Analytics:</strong> Para análisis de uso y comportamiento</li>
          <li><strong>MercadoPago:</strong> Para procesamiento seguro de pagos</li>
          <li><strong>Intercom/Chat:</strong> Para soporte al cliente en tiempo real</li>
        </ul>
        <p className="text-gray-600 mt-4">
          Estos terceros tienen sus propias políticas de privacidad que le recomendamos revisar.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">6. Cómo Gestionar las Cookies</h2>
        <p className="text-gray-600 mb-4">
          Puede controlar y gestionar las cookies de varias formas:
        </p>

        <h3 className="text-lg font-medium text-gray-900 mt-6 mb-3">Configuración del Navegador</h3>
        <p className="text-gray-600 mb-4">
          La mayoría de los navegadores le permiten:
        </p>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li>Ver qué cookies tiene y eliminarlas individualmente</li>
          <li>Bloquear cookies de terceros</li>
          <li>Bloquear cookies de sitios específicos</li>
          <li>Bloquear todas las cookies</li>
          <li>Eliminar todas las cookies al cerrar el navegador</li>
        </ul>

        <h3 className="text-lg font-medium text-gray-900 mt-6 mb-3">Enlaces de Configuración por Navegador</h3>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li><strong>Chrome:</strong> Configuración → Privacidad y seguridad → Cookies</li>
          <li><strong>Firefox:</strong> Opciones → Privacidad y seguridad → Cookies</li>
          <li><strong>Safari:</strong> Preferencias → Privacidad → Cookies</li>
          <li><strong>Edge:</strong> Configuración → Privacidad → Cookies</li>
        </ul>

        <div className="bg-yellow-50 dark:bg-yellow-950/50 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mt-6">
          <p className="text-yellow-800 dark:text-yellow-300 text-sm">
            <strong>Nota:</strong> Si deshabilita las cookies esenciales, es posible que algunas funciones
            del Servicio no funcionen correctamente y no pueda iniciar sesión en su cuenta.
          </p>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">7. Otras Tecnologías de Seguimiento</h2>
        <p className="text-gray-600 mb-4">
          Además de las cookies, podemos utilizar otras tecnologías similares:
        </p>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li><strong>Local Storage:</strong> Almacena datos en su navegador para mejorar el rendimiento</li>
          <li><strong>Session Storage:</strong> Almacena datos temporales durante su sesión</li>
          <li><strong>Web Beacons:</strong> Pequeñas imágenes para rastrear interacciones en emails</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">8. Actualizaciones de esta Política</h2>
        <p className="text-gray-600 mb-4">
          Podemos actualizar esta Política de Cookies periódicamente para reflejar cambios en nuestras
          prácticas o por razones operativas, legales o regulatorias. Le recomendamos revisar esta página
          regularmente para estar informado sobre nuestro uso de cookies.
        </p>
      </section>

    </article>
  )
}
