import LegalLayout from "@/components/LegalLayout";

export const metadata = { title: "Términos del servicio" };

export default function TermsPage() {
  return (
    <LegalLayout title="Términos del servicio" updated="27 de septiembre de 2026">
      <h2>1. El servicio</h2>
      <p>
        Pianissimo convierte el audio que subes en tutoriales para aprender piano. El servicio se ofrece tal
        cual durante la beta y puede cambiar o interrumpirse.
      </p>

      <h2>2. Cuentas</h2>
      <p>
        Debes mantener segura tu forma de acceso y eres responsable de la actividad de tu cuenta. Podemos
        suspender cuentas que abusen del servicio (spam, fraude o intentos de saltarse los límites).
      </p>

      <h2>3. Créditos, vista previa y Mini Pack</h2>
      <p>
        Cada tutorial completo consume un crédito de tu saldo. El plan gratuito incluye créditos de vista
        previa que procesan únicamente los primeros 60 segundos de una canción. El Mini Pack es una compra
        única de créditos al precio mostrado en el pago. Los créditos no tienen valor en efectivo ni son un
        monedero fuera de Pianissimo.
      </p>

      <h2>4. Tus subidas</h2>
      <p>
        Confirmas que tienes derecho a subir y procesar el audio que envías. No subas contenido ilegal ni
        material del que no seas titular o licenciatario. Podemos eliminar subidas que incumplan estos
        términos. Los archivos originales se conservan temporalmente para poder generar la canción completa y
        después se eliminan.
      </p>

      <h2>5. Pagos</h2>
      <p>
        Los pagos con tarjeta los procesa Wompi (El Salvador). Pianissimo no almacena números de tarjeta ni
        CVV. La confirmación de un pago llega por los avisos verificados de Wompi a nuestros servidores, no
        solo por la redirección del navegador.
      </p>

      <h2>6. Disponibilidad y responsabilidad</h2>
      <p>
        El procesamiento depende de infraestructura de terceros (hosting, base de datos, GPU). Buscamos
        fiabilidad, pero no garantizamos un servicio ininterrumpido. En la medida permitida por la ley,
        Pianissimo y sus operadores no responden por daños indirectos derivados del uso del servicio.
      </p>

      <h2>7. Cambios</h2>
      <p>
        Podemos actualizar estos términos. Seguir usando el servicio tras un cambio implica aceptarlo. Contacto:
        el correo de soporte indicado al pie de la página.
      </p>
    </LegalLayout>
  );
}
