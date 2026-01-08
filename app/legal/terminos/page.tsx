import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Términos de Servicio | STApp",
  description: "Términos y condiciones de uso de STApp",
}

export default function TerminosPage() {
  return (
    <article className="prose prose-gray max-w-none">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Términos de Servicio</h1>

      <p className="text-gray-500 mb-8">Última actualización: {new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}</p>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">1. Aceptación de los Términos</h2>
        <p className="text-gray-600 mb-4">
          Al acceder y utilizar STApp ("el Servicio"), usted acepta estar sujeto a estos Términos de Servicio.
          Si no está de acuerdo con alguna parte de estos términos, no podrá acceder al Servicio.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">2. Descripción del Servicio</h2>
        <p className="text-gray-600 mb-4">
          STApp es una plataforma de gestión integral para talleres de reparación de dispositivos electrónicos.
          El Servicio incluye, pero no se limita a:
        </p>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li>Gestión de órdenes de trabajo</li>
          <li>Control de inventario</li>
          <li>Facturación y cobros</li>
          <li>Gestión de clientes</li>
          <li>Reportes y análisis</li>
          <li>Gestión de técnicos</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">3. Registro y Cuenta</h2>
        <p className="text-gray-600 mb-4">
          Para utilizar el Servicio, debe crear una cuenta proporcionando información precisa y completa.
          Usted es responsable de:
        </p>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li>Mantener la confidencialidad de su contraseña</li>
          <li>Todas las actividades que ocurran bajo su cuenta</li>
          <li>Notificar inmediatamente cualquier uso no autorizado de su cuenta</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">4. Planes y Pagos</h2>
        <p className="text-gray-600 mb-4">
          STApp ofrece diferentes planes de suscripción. Al seleccionar un plan de pago, usted acepta:
        </p>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li>Proporcionar información de pago válida y actualizada</li>
          <li>Autorizar los cargos recurrentes según el plan seleccionado</li>
          <li>Los precios pueden cambiar con previo aviso de 30 días</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">5. Uso Aceptable</h2>
        <p className="text-gray-600 mb-4">
          Al usar el Servicio, usted se compromete a no:
        </p>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li>Violar leyes o regulaciones aplicables</li>
          <li>Infringir derechos de propiedad intelectual de terceros</li>
          <li>Transmitir malware o código malicioso</li>
          <li>Intentar acceder sin autorización a sistemas o datos</li>
          <li>Usar el Servicio para fines ilegales o fraudulentos</li>
          <li>Revender o redistribuir el Servicio sin autorización</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">6. Propiedad Intelectual</h2>
        <p className="text-gray-600 mb-4">
          El Servicio y su contenido original, características y funcionalidad son propiedad de STApp y están
          protegidos por leyes de derechos de autor, marcas registradas y otras leyes de propiedad intelectual.
        </p>
        <p className="text-gray-600 mb-4">
          Usted conserva todos los derechos sobre los datos que ingresa en el Servicio.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">7. Disponibilidad del Servicio</h2>
        <p className="text-gray-600 mb-4">
          Nos esforzamos por mantener el Servicio disponible las 24 horas del día, los 7 días de la semana.
          Sin embargo, no garantizamos que el Servicio estará disponible de manera ininterrumpida.
          Podemos realizar mantenimiento programado con previo aviso.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">8. Limitación de Responsabilidad</h2>
        <p className="text-gray-600 mb-4">
          En ningún caso STApp, sus directores, empleados o agentes serán responsables por daños
          indirectos, incidentales, especiales, consecuentes o punitivos, incluyendo pérdida de beneficios,
          datos o uso, resultantes de su acceso o uso del Servicio.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">9. Terminación</h2>
        <p className="text-gray-600 mb-4">
          Podemos terminar o suspender su cuenta inmediatamente, sin previo aviso, si usted incumple
          estos Términos de Servicio. Usted puede cancelar su cuenta en cualquier momento desde la
          configuración de su cuenta.
        </p>
        <p className="text-gray-600 mb-4">
          Tras la terminación, su derecho a usar el Servicio cesará inmediatamente. Si desea exportar
          sus datos, debe hacerlo antes de la cancelación.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">10. Modificaciones</h2>
        <p className="text-gray-600 mb-4">
          Nos reservamos el derecho de modificar estos términos en cualquier momento. Le notificaremos
          cualquier cambio publicando los nuevos términos en esta página y, si los cambios son significativos,
          enviándole un correo electrónico.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">11. Ley Aplicable</h2>
        <p className="text-gray-600 mb-4">
          Estos Términos se regirán e interpretarán de acuerdo con las leyes aplicables,
          sin tener en cuenta sus disposiciones sobre conflictos de leyes.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">12. Contacto</h2>
        <p className="text-gray-600 mb-4">
          Si tiene preguntas sobre estos Términos de Servicio, puede contactarnos en:
        </p>
        <ul className="list-none text-gray-600 space-y-2">
          <li><strong>Email:</strong> soporte@stapp.com</li>
          <li><strong>Teléfono:</strong> +1 (555) 123-4567</li>
        </ul>
      </section>
    </article>
  )
}
