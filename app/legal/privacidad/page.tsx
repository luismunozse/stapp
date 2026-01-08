import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Política de Privacidad | STApp",
  description: "Política de privacidad y protección de datos de STApp",
}

export default function PrivacidadPage() {
  return (
    <article className="prose prose-gray max-w-none">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Política de Privacidad</h1>

      <p className="text-gray-500 mb-8">Última actualización: {new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}</p>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">1. Introducción</h2>
        <p className="text-gray-600 mb-4">
          En STApp nos comprometemos a proteger su privacidad. Esta Política de Privacidad explica cómo
          recopilamos, usamos, divulgamos y protegemos su información cuando utiliza nuestro servicio.
        </p>
        <p className="text-gray-600 mb-4">
          Al usar STApp, usted acepta la recopilación y uso de información de acuerdo con esta política.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">2. Información que Recopilamos</h2>

        <h3 className="text-lg font-medium text-gray-900 mt-6 mb-3">2.1 Información proporcionada por usted</h3>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li><strong>Datos de registro:</strong> nombre, correo electrónico, contraseña, nombre del negocio</li>
          <li><strong>Información del negocio:</strong> dirección, teléfono, logo, configuraciones</li>
          <li><strong>Datos de clientes:</strong> información de sus clientes que usted ingresa al sistema</li>
          <li><strong>Datos de órdenes:</strong> detalles de reparaciones, inventario, facturación</li>
          <li><strong>Información de pago:</strong> datos de tarjeta procesados de forma segura por terceros</li>
        </ul>

        <h3 className="text-lg font-medium text-gray-900 mt-6 mb-3">2.2 Información recopilada automáticamente</h3>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li><strong>Datos de uso:</strong> páginas visitadas, funciones utilizadas, tiempo de uso</li>
          <li><strong>Información del dispositivo:</strong> tipo de navegador, sistema operativo, dirección IP</li>
          <li><strong>Cookies y tecnologías similares:</strong> para mejorar su experiencia</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">3. Cómo Usamos su Información</h2>
        <p className="text-gray-600 mb-4">
          Utilizamos la información recopilada para:
        </p>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li>Proporcionar, mantener y mejorar el Servicio</li>
          <li>Procesar transacciones y enviar notificaciones relacionadas</li>
          <li>Responder a sus comentarios, preguntas y solicitudes de soporte</li>
          <li>Enviar comunicaciones sobre actualizaciones, seguridad y promociones (con su consentimiento)</li>
          <li>Monitorear y analizar tendencias, uso y actividades</li>
          <li>Detectar, investigar y prevenir actividades fraudulentas</li>
          <li>Personalizar y mejorar su experiencia</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">4. Compartición de Información</h2>
        <p className="text-gray-600 mb-4">
          No vendemos su información personal. Podemos compartir su información en las siguientes circunstancias:
        </p>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li><strong>Proveedores de servicios:</strong> terceros que nos ayudan a operar el Servicio (hosting, procesamiento de pagos, análisis)</li>
          <li><strong>Cumplimiento legal:</strong> cuando sea requerido por ley o para proteger derechos</li>
          <li><strong>Transferencia de negocio:</strong> en caso de fusión, adquisición o venta de activos</li>
          <li><strong>Con su consentimiento:</strong> cuando usted nos autorice expresamente</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">5. Seguridad de los Datos</h2>
        <p className="text-gray-600 mb-4">
          Implementamos medidas de seguridad técnicas y organizativas para proteger su información, incluyendo:
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
          Conservamos su información mientras su cuenta esté activa o según sea necesario para proporcionarle
          el Servicio. También podemos retener cierta información según sea necesario para:
        </p>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li>Cumplir con obligaciones legales</li>
          <li>Resolver disputas</li>
          <li>Hacer cumplir nuestros acuerdos</li>
        </ul>
        <p className="text-gray-600 mt-4">
          Puede solicitar la eliminación de sus datos en cualquier momento contactándonos.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">7. Sus Derechos</h2>
        <p className="text-gray-600 mb-4">
          Dependiendo de su ubicación, puede tener los siguientes derechos:
        </p>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li><strong>Acceso:</strong> solicitar una copia de sus datos personales</li>
          <li><strong>Rectificación:</strong> corregir datos inexactos o incompletos</li>
          <li><strong>Eliminación:</strong> solicitar la eliminación de sus datos</li>
          <li><strong>Portabilidad:</strong> recibir sus datos en formato estructurado</li>
          <li><strong>Oposición:</strong> oponerse al procesamiento de sus datos</li>
          <li><strong>Limitación:</strong> restringir el procesamiento de sus datos</li>
          <li><strong>Retiro del consentimiento:</strong> retirar el consentimiento en cualquier momento</li>
        </ul>
        <p className="text-gray-600 mt-4">
          Para ejercer estos derechos, contacte a soporte@stapp.com.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">8. Transferencias Internacionales</h2>
        <p className="text-gray-600 mb-4">
          Su información puede ser transferida y mantenida en servidores ubicados fuera de su país de
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
          Podemos actualizar esta Política de Privacidad periódicamente. Le notificaremos cualquier cambio
          publicando la nueva política en esta página y actualizando la fecha de "última actualización".
          Se recomienda revisar esta política regularmente.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">11. Contacto</h2>
        <p className="text-gray-600 mb-4">
          Si tiene preguntas sobre esta Política de Privacidad, puede contactarnos:
        </p>
        <ul className="list-none text-gray-600 space-y-2">
          <li><strong>Email:</strong> soporte@stapp.com</li>
          <li><strong>Teléfono:</strong> +1 (555) 123-4567</li>
          <li><strong>Delegado de Protección de Datos:</strong> privacidad@stapp.com</li>
        </ul>
      </section>
    </article>
  )
}
