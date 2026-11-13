import { Metadata } from "next"
import Link from "next/link"
import { CONTACT_EMAIL } from "@/lib/contact"
import { DEFAULT_TIMEZONE } from "@/lib/timezone"

export const metadata: Metadata = {
  title: "Política de Privacidad | STApp",
  description: "Política de privacidad y protección de datos de STApp",
  alternates: {
    canonical: "https://stapp.com.ar/legal/privacidad",
  },
}

export default function PrivacidadPage() {
  return (
    <article className="prose prose-gray max-w-none">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Política de Privacidad</h1>

      <p className="text-gray-500 mb-8">Última actualización: {new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric', timeZone: DEFAULT_TIMEZONE })}</p>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">1. Introducción</h2>
        <p className="text-gray-600 mb-4">
          En STApp nos comprometemos a proteger tu privacidad. Esta Política de Privacidad explica cómo
          recopilamos, usamos, divulgamos y protegemos tu información cuando utilizás nuestro servicio.
        </p>
        <p className="text-gray-600 mb-4">
          Al usar STApp, aceptás la recopilación y uso de información de acuerdo con esta política.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">2. Información que Recopilamos</h2>

        <h3 className="text-lg font-medium text-gray-900 mt-6 mb-3">2.1 Información proporcionada por vos</h3>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li><strong>Datos de registro:</strong> nombre, correo electrónico, contraseña, nombre del negocio</li>
          <li><strong>Información del negocio:</strong> dirección, teléfono, logo, configuraciones</li>
          <li><strong>Datos de clientes:</strong> información de tus clientes que ingresás al sistema</li>
          <li><strong>Datos de órdenes:</strong> detalles de reparaciones, inventario, facturación</li>
          <li><strong>Información de pago:</strong> datos de tarjeta procesados de forma segura por terceros</li>
        </ul>

        <h3 className="text-lg font-medium text-gray-900 mt-6 mb-3">2.2 Información recopilada automáticamente</h3>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li><strong>Datos de uso:</strong> páginas visitadas, funciones utilizadas, tiempo de uso</li>
          <li><strong>Información del dispositivo:</strong> tipo de navegador, sistema operativo, dirección IP</li>
          <li><strong>Cookies y tecnologías similares:</strong> para mejorar tu experiencia</li>
        </ul>

        <h3 className="text-lg font-medium text-gray-900 mt-6 mb-3">2.3 Aplicación móvil (Android)</h3>
        <p className="text-gray-600 mb-4">
          La aplicación de STApp para Android solicita los siguientes permisos. Todos son opcionales:
          te los pedimos recién cuando usás la función correspondiente y podés revocarlos en cualquier
          momento desde los ajustes de Android sin perder acceso al resto del Servicio.
        </p>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li>
            <strong>Cámara y fotos:</strong> para adjuntar fotos de los equipos a una orden de servicio.
            Sólo accedemos a las imágenes que capturás o seleccionás expresamente, y se almacenan
            asociadas a la orden dentro de tu cuenta. No leemos el resto de tu galería.
          </li>
          <li>
            <strong>Notificaciones:</strong> si las activás, el dispositivo genera un identificador
            (token de Firebase Cloud Messaging) que guardamos para poder enviarte avisos sobre tus
            órdenes. Dejamos de usarlo cuando el dispositivo lo invalida (por ejemplo, al
            desinstalar la aplicación) y podés revocar el permiso desde los ajustes del teléfono.
          </li>
          <li>
            <strong>Datos técnicos de la aplicación:</strong> plataforma y versión instalada, para
            diagnosticar errores y avisarte cuando hay una actualización disponible.
          </li>
        </ul>
        <p className="text-gray-600 mt-4">
          No utilizamos identificadores de publicidad ni rastreamos tu actividad fuera de STApp.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">3. Cómo Usamos tu Información</h2>
        <p className="text-gray-600 mb-4">
          Utilizamos la información recopilada para:
        </p>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li>Proporcionar, mantener y mejorar el Servicio</li>
          <li>Procesar transacciones y enviar notificaciones relacionadas</li>
          <li>Responder a tus comentarios, preguntas y solicitudes de soporte</li>
          <li>Enviar comunicaciones sobre actualizaciones, seguridad y promociones (con tu consentimiento)</li>
          <li>Monitorear y analizar tendencias, uso y actividades</li>
          <li>Detectar, investigar y prevenir actividades fraudulentas</li>
          <li>Personalizar y mejorar tu experiencia</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">4. Compartición de Información</h2>
        <p className="text-gray-600 mb-4">
          No vendemos tu información personal. Podemos compartir tu información en las siguientes circunstancias:
        </p>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li>
            <strong>Proveedores de servicios:</strong> terceros que nos ayudan a operar el Servicio y
            que sólo procesan los datos necesarios para su función: alojamiento de la aplicación
            (Vercel), base de datos y almacenamiento de archivos (Supabase), procesamiento de pagos
            (Mercado Pago), envío de notificaciones push (Google Firebase Cloud Messaging), envío de
            correos transaccionales (EnvialoSimple, Resend) y mensajería de WhatsApp.
          </li>
          <li><strong>Cumplimiento legal:</strong> cuando sea requerido por ley o para proteger derechos</li>
          <li><strong>Transferencia de negocio:</strong> en caso de fusión, adquisición o venta de activos</li>
          <li><strong>Con tu consentimiento:</strong> cuando nos autorices expresamente</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">5. Seguridad de los Datos</h2>
        <p className="text-gray-600 mb-4">
          Implementamos medidas de seguridad técnicas y organizativas para proteger tu información, incluyendo:
        </p>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li>Encriptación de datos en tránsito (HTTPS/TLS)</li>
          <li>Encriptación de datos sensibles en reposo</li>
          <li>Controles de acceso estrictos</li>
          <li>Monitoreo continuo de seguridad</li>
          <li>Copias de seguridad regulares</li>
        </ul>
        <p className="text-gray-600 mt-4">
          Sin embargo, ningún método de transmisión por Internet es 100% seguro, por lo que no podemos
          garantizar seguridad absoluta.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">6. Retención de Datos</h2>
        <p className="text-gray-600 mb-4">
          Conservamos tu información mientras tu cuenta esté activa o según sea necesario para proporcionarte
          el Servicio. También podemos retener cierta información según sea necesario para:
        </p>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li>Cumplir con obligaciones legales</li>
          <li>Resolver disputas</li>
          <li>Hacer cumplir nuestros acuerdos</li>
        </ul>
        <p className="text-gray-600 mt-4">
          Podés eliminar tu usuario o tu taller en cualquier momento desde la sección “Zona de peligro” de tu perfil, o
          siguiendo las instrucciones en <Link href="/legal/eliminar-cuenta" className="text-blue-600 hover:underline">Eliminar mi cuenta</Link>.
          Conservamos los datos durante 30 días para poder revertir el pedido y después los borramos de forma definitiva.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">7. Tus Derechos</h2>
        <p className="text-gray-600 mb-4">
          Dependiendo de tu ubicación, podés tener los siguientes derechos:
        </p>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li><strong>Acceso:</strong> solicitar una copia de tus datos personales</li>
          <li><strong>Rectificación:</strong> corregir datos inexactos o incompletos</li>
          <li><strong>Eliminación:</strong> solicitar la eliminación de tus datos</li>
          <li><strong>Portabilidad:</strong> recibir tus datos en formato estructurado</li>
          <li><strong>Oposición:</strong> oponerte al procesamiento de tus datos</li>
          <li><strong>Limitación:</strong> restringir el procesamiento de tus datos</li>
          <li><strong>Retiro del consentimiento:</strong> retirar el consentimiento en cualquier momento</li>
        </ul>
        <p className="text-gray-600 mt-4">
          Para ejercer estos derechos, podés hacerlo desde tu perfil o
          escribiéndonos a{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 hover:underline">
            {CONTACT_EMAIL}
          </a>
          . Si querés eliminar tu cuenta y los datos asociados, incluidos los de la aplicación móvil,
          vas a encontrar los pasos en{" "}
          <Link href="/legal/eliminar-cuenta" className="text-blue-600 hover:underline">Eliminar mi cuenta</Link>.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">8. Transferencias Internacionales</h2>
        <p className="text-gray-600 mb-4">
          Tu información puede ser transferida y mantenida en servidores ubicados fuera de tu país de
          residencia. Nos aseguramos de que dichas transferencias cumplan con las leyes aplicables
          y proporcionen protección adecuada.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">9. Privacidad de Menores</h2>
        <p className="text-gray-600 mb-4">
          El Servicio no está dirigido a menores de 18 años. No recopilamos intencionalmente información
          personal de menores. Si descubrimos que hemos recopilado información de un menor, la eliminaremos
          inmediatamente.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">10. Cambios a esta Política</h2>
        <p className="text-gray-600 mb-4">
          Podemos actualizar esta Política de Privacidad periódicamente. Te notificaremos cualquier cambio
          publicando la nueva política en esta página y actualizando la fecha de "última actualización".
          Se recomienda revisar esta política regularmente.
        </p>
      </section>

    </article>
  )
}
