/**
 * Cliente Supabase del navegador (modo nube). Usa la clave anon/publishable:
 * lo que protege los datos son las politicas RLS + el login, no la clave.
 *
 * Modo nube = hay NEXT_PUBLIC_SUPABASE_URL. Sin ella, la app trabaja contra
 * el backend FastAPI local (modo local), como hasta ahora.
 */

import { type SupabaseClient, createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isCloudMode = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error("Supabase no configurado (NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY)");
  }
  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        // La sesion se guarda en el navegador y el token se renueva solo:
        // no caduca mientras no se cierre sesion (config por defecto de Supabase).
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}
