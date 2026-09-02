/**
 * Keepalive: Supabase pausa los proyectos gratuitos tras 7 dias sin
 * actividad. Vercel Cron llama a esta ruta una vez al dia (vercel.json) y
 * hacemos una consulta minima con la clave de servidor.
 *
 * Solo corre en el servidor de Vercel: SUPABASE_SERVICE_ROLE_KEY nunca llega
 * al navegador. CRON_SECRET evita que cualquiera la dispare.
 */

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  const sb = createClient(url, key);
  const { count, error } = await sb.from("songs").select("id", { count: "exact", head: true });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, songs: count ?? 0, at: new Date().toISOString() });
}
