import { Metadata } from "next"
import { CONTACT_EMAIL } from "@/lib/contact"
import { GRACE_DAYS } from "@/lib/account-deletion/state"
import { EliminarCuentaForm } from "@/components/legal/eliminar-cuenta-form"

export const metadata: Metadata = {
  title: "Eliminar mi cuenta | STApp",
  description: "Cómo eliminar su usuario o su taller de STApp, qué se borra y qué se conserva.",
  // Explícito: Next hereda el canonical del layout raíz y lo apuntaría a la home.
  alternates: { canonical: "https://stapp.com.ar/legal/eliminar-cuenta" },
}

export default function EliminarCuentaPage() {
  return (
    <article className="prose prose-gray max-w-none">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Eliminar mi cuenta</h1>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Cómo hacerlo</h2>
        <p className="text-gray-600 mb-4">
          Ingrese el subdominio de su taller e inicie sesión: llegará a la sección “Zona de peligro” de su perfil.
          Es el mismo camino que ofrece la aplicación. Por seguridad le pedimos su contraseña (o su email si usa Google) y,
          si lo tiene activado, el código de verificación en dos pasos.
        </p>
        <EliminarCuentaForm />
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Dos opciones</h2>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li><strong>Eliminar mi usuario:</strong> cualquier usuario puede hacerlo. El taller sigue funcionando.</li>
          <li><strong>Eliminar el taller:</strong> solo un administrador. Elimina la organización y sus datos, y cancela la suscripción. Antes puede descargar un respaldo.</li>
        </ul>
        <p className="text-gray-600 mt-4">
          El último administrador de un taller no puede eliminar solo su usuario: debe eliminar el taller o transferir el rol de administrador a otra persona.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Qué se elimina y qué se conserva</h2>
        <h3 className="text-lg font-medium text-gray-900 mt-6 mb-3">Al eliminar un usuario</h3>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li>Se borran su nombre, email, teléfono, foto, contraseña y datos de verificación en dos pasos.</li>
          <li>Las operaciones que registró (ventas, órdenes, caja) se conservan para el taller y quedan firmadas como “Usuario eliminado”.</li>
        </ul>
        <h3 className="text-lg font-medium text-gray-900 mt-6 mb-3">Al eliminar un taller</h3>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li>Se cancela la suscripción en el momento y el acceso se desactiva.</li>
          <li>Transcurrido el plazo se borran todos los datos del taller: clientes, órdenes, ventas, inventario, comprobantes y archivos.</li>
          <li>La obligación de conservar la documentación fiscal emitida corresponde al taller: descargue el respaldo antes de confirmar. STApp no retiene nada pasado el plazo.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Plazos</h2>
        <p className="text-gray-600">
          La desactivación es inmediata. Durante {GRACE_DAYS} días podemos revertir el pedido si cambia de opinión. Pasado ese plazo
          el borrado es definitivo y no se puede deshacer.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">¿No puede ingresar?</h2>
        <p className="text-gray-600">
          Escríbanos a <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 hover:underline">{CONTACT_EMAIL}</a> desde el
          email de su cuenta y le ayudaremos con el pedido.
        </p>
      </section>
    </article>
  )
}
