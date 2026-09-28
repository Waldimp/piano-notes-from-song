import Link from "next/link";

import Brand from "@/components/Brand";
import HeroDemo from "@/components/HeroDemo";
import LoginForm from "@/components/LoginForm";
import { FREE_CREDITS, FREE_PREVIEW_SECONDS } from "@/lib/beta/preview";

export const metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <div className="auth">
      <aside className="auth-brand">
        <HeroDemo speed={0.7} startAt={10} minWidth={720} />
        <div className="hero-shade" aria-hidden="true" />
        <Brand href="/landing" />
        <div>
          <h2>Cada canción que te gusta, convertida en un tutorial para tus manos.</h2>
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
