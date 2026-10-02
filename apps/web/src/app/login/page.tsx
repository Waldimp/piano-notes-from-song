import Link from "next/link";

import Brand from "@/components/Brand";
import LoginForm from "@/components/LoginForm";
import SoftBackdrop from "@/components/soft/SoftBackdrop";
import { GrandPiano } from "@/components/soft/Illustrations";
import { FREE_CREDITS, FREE_PREVIEW_SECONDS } from "@/lib/beta/preview";

export const metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <div className="auth">
      <aside className="auth-brand">
        <SoftBackdrop rain={0.7} />
        <Brand href="/landing" />
        <div>
          <GrandPiano className="auth-illo" />
          <h2>
            Cada canción que te gusta, <span className="script">para tus manos.</span>
          </h2>
          <p>
            Sube un audio de piano y practícalo con notas que caen, manos separadas, velocidad ajustable y loop de
            práctica. Gratis: {FREE_CREDITS} vistas previas de {FREE_PREVIEW_SECONDS} segundos.
          </p>
        </div>
        <p className="auth-brand-foot muted small">
          <Link href="/landing">← Volver al inicio</Link>
        </p>
      </aside>
      <section className="auth-form">
        <LoginForm />
      </section>
    </div>
  );
}
