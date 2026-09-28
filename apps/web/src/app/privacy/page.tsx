import LegalLayout from "@/components/LegalLayout";

export const metadata = { title: "Política de privacidad" };

export default function PrivacyPage() {
  return (
    <LegalLayout title="Política de privacidad" updated="27 de septiembre de 2026">
      <h2>1. Qué datos tratamos</h2>
      <ul>
        <li>Cuenta: correo e identificadores de autenticación (Supabase Auth).</li>
        <li>Subidas: los archivos de audio que envías y los datos derivados del tutorial (notas).</li>
        <li>Uso: plan, saldo de créditos, estado de las solicitudes y registros relacionados.</li>
        <li>Facturación: identificadores de compra y referencias de transacción de Wompi (nunca el número de tarjeta ni CVV).</li>
      </ul>

      <h2>2. Para qué</h2>
      <p>
        Para ejecutar el tutorial, aplicar los límites de créditos, mostrarte tu biblioteca, procesar pagos,
        prevenir abusos y operar el producto.
      </p>

      <h2>3. Proveedores e infraestructura</h2>
      <ul>
        <li>Supabase — autenticación, base de datos y almacenamiento de archivos.</li>
        <li>Vercel — alojamiento de la aplicación web.</li>
        <li>Modal — procesamiento con GPU de la transcripción.</li>
        <li>Wompi — procesamiento de pagos (El Salvador).</li>
      </ul>

      <h2>4. Conservación</h2>
      <p>
        Los datos de cuenta y los tutoriales se conservan mientras tu cuenta esté activa. Los audios originales
        se eliminan automáticamente pasadas 24 horas de procesarse (30 días si son vistas previas, para que
        puedas desbloquear la canción completa). Puedes solicitar la eliminación de tu cuenta contactándonos.
        Los registros de facturación necesarios para conciliación pueden conservarse por motivos operativos.
      </p>

      <h2>5. Tus derechos</h2>
      <p>
        Según la ley aplicable, puedes solicitar acceso, corrección o eliminación de los datos personales
        asociados a tu cuenta. Contáctanos usando el correo de tu cuenta.
      </p>

      <h2>6. Seguridad</h2>
      <p>
        Usamos controles de acceso (incluida seguridad a nivel de fila) y no almacenamos secretos de tarjeta en
        nuestros servidores. Ningún método es perfecto: protege tu acceso.
      </p>
    </LegalLayout>
  );
}
