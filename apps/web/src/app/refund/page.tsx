import LegalLayout from "@/components/LegalLayout";

export const metadata = { title: "Política de reembolsos" };

export default function RefundPage() {
  return (
    <LegalLayout title="Política de reembolsos" updated="27 de septiembre de 2026">
      <h2>1. Mini Pack</h2>
      <p>
        El Mini Pack es una compra única de créditos. Tras un pago correcto en Wompi, los créditos se añaden a
        tu cuenta una sola vez.
      </p>

      <h2>2. Créditos sin usar</h2>
      <p>
        Si pides un reembolso antes de usar los créditos comprados, podemos revertir la acreditación y
        gestionar el reembolso a través de Wompi cuando el proveedor lo permita.
      </p>

      <h2>3. Créditos consumidos</h2>
      <p>
        Si ya usaste parte o todos los créditos en tutoriales, no reembolsamos automáticamente el importe
        completo. Podemos ofrecer un ajuste parcial caso por caso; nunca dejaremos un saldo negativo sin
        revisión.
      </p>

      <h2>4. Cobros duplicados o erróneos</h2>
      <p>
        Si Wompi o nuestros sistemas muestran un cobro duplicado por la misma compra, contáctanos. Conciliamos
        con nuestros registros y el identificador de transacción de Wompi; los duplicados válidos se reembolsan
        o corrigen sin acreditar créditos dos veces.
      </p>

      <h2>5. Cómo contactarnos</h2>
      <p>
        Escríbenos desde el correo de tu cuenta de Pianissimo indicando la hora aproximada de la compra y, si
        lo tienes, la referencia de autorización o transacción de Wompi de tu recibo.
      </p>
    </LegalLayout>
  );
}
