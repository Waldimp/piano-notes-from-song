import Link from "next/link";

import AppFooter from "@/components/AppFooter";
import LoginForm from "@/components/LoginForm";
import { SITE_NAME } from "@/lib/site";

export default function LoginPage() {
  return (
    <>
      <div className="login-page-top">
        <Link href="/landing" className="back">
          ← {SITE_NAME}
        </Link>
      </div>
      <LoginForm />
      <AppFooter />
    </>
  );
}
