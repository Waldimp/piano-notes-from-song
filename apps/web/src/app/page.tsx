"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import AppFooter from "@/components/AppFooter";
import AppHeader from "@/components/AppHeader";
import CloudQueuePanel from "@/components/CloudQueuePanel";
import OnboardingBanner from "@/components/OnboardingBanner";
import SongCard, { PendingCard } from "@/components/SongCard";
import UploadBox from "@/components/UploadBox";
import UsageBanner, { useUsage } from "@/components/UsageBanner";
import { unlockDecision } from "@/lib/beta/preview";
import { type SongSummary, getDataSource } from "@/lib/data";
import { API_URL } from "@/lib/data/local";
import { requestImmediateDispatchWake } from "@/lib/data/wake-after-submit";
import { isCloudMode, supabase } from "@/lib/supabase";
import { mapCreateRequestError } from "@/lib/userMessages";

/** Mientras haya canciones en cola, re-despertar al worker como máximo cada 30 s. */
const REWAKE_INTERVAL_MS = 30_000;

export default function Home() {
  const data = getDataSource();
  const router = useRouter();
  const [items, setItems] = useState<SongSummary[] | null>(null);
  const [jobs, setJobs] = useState<Awaited<ReturnType<typeof data.listJobs>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [cloudReady, setCloudReady] = useState(false);
  const [usageTick, setUsageTick] = useState(0);
  const { usage } = useUsage(usageTick);
  const lastWakeRef = useRef(0);

  const reload = useCallback(() => {
    data
      .listSongs()
      .then((list) => {
        setItems(list);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
    data.listJobs().then(setJobs).catch(() => {});
  }, [data]);

  useEffect(reload, [reload]);

  useEffect(() => {
    if (data.kind !== "local") return;
    fetch(`${API_URL}/health`)
      .then((r) => r.json())
      .then((h) => setCloudReady(Boolean(h.cloud)))
      .catch(() => {});
  }, [data.kind]);

  const hasPending = jobs.some((j) => j.status === "queued" || j.status === "processing");
  const hasQueued = jobs.some((j) => j.status === "queued");

  // Nube: refrescar mientras hay trabajo y, si algo sigue en cola, volver a
  // despertar al worker (fallback del wake inmediato; el cron sigue siendo la red final).
  useEffect(() => {
    if (data.kind !== "cloud" || !hasPending) return;
    const t = setInterval(() => {
      reload();
      if (hasQueued && Date.now() - lastWakeRef.current > REWAKE_INTERVAL_MS) {
        lastWakeRef.current = Date.now();
        void requestImmediateDispatchWake(supabase());
      }
    }, 10_000);
    return () => clearInterval(t);
  }, [data.kind, hasPending, hasQueued, reload]);

  // Tarjetas de trabajo: en curso, listas sin canción visible aún, y errores recientes
  // (un fallo de hace días es ruido: el crédito ya se devolvió).
  const pendingJobs = useMemo(() => {
    const songIds = new Set(items?.map((s) => s.id) ?? []);
    const recent = Date.now() - 48 * 60 * 60 * 1000;
    return jobs.filter((j) => {
      if (j.status === "done") return !(j.transcriptionId && songIds.has(j.transcriptionId));
      if (j.status === "error") return new Date(j.createdAt).getTime() > recent;
      return true;
    });
  }, [items, jobs]);

  const showEmpty =
    data.kind === "cloud"
      ? items !== null && items.length === 0 && pendingJobs.length === 0
      : items !== null && items.length === 0;

  const rename = async (id: string, title: string) => {
    await data.renameSong(id, title).catch((e: Error) => setError(e.message));
    reload();
  };

  const remove = async (id: string) => {
    await data.deleteSong(id).catch((e: Error) => setError(e.message));
    reload();
  };

  const unlock = async (song: SongSummary) => {
    setNotice(null);
    const decision = unlockDecision(song, usage?.plan_code ?? "free", usage?.credit_balance ?? 0);
    if (decision.action !== "unlock") {
      router.push("/pricing");
      return;
    }
    const { data: session } = await supabase().auth.getSession();
    const token = session.session?.access_token;
    if (!token) return;
    const res = await fetch("/api/unlock-song", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ song_id: song.id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(mapCreateRequestError({ code: body.code, message: body.message, error: body.error, status: res.status }));
      return;
    }
    setNotice(`Procesando "${song.title}" completa. Usaste 1 tutorial; te quedan ${decision.creditsAfter}.`);
    setUsageTick((n) => n + 1);
    reload();
  };

  const publish = async (song: SongSummary) => {
    setPublishing(song.id);
    try {
      const res = await fetch(`${API_URL}/api/transcriptions/${song.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: song.title }),
      });
      if (!res.ok) throw new Error((await res.json()).detail ?? res.statusText);
    } catch (e) {
      setError(`No se pudo publicar: ${e instanceof Error ? e.message : e}`);
    } finally {
      setPublishing(null);
    }
  };

  const total = (items?.length ?? 0) + pendingJobs.length;

  return (
    <main className="shell">
      <AppHeader
        title="Tus canciones"
        subtitle={isCloudMode ? "Sube un audio de piano y practícalo con notas que caen." : "Biblioteca local en esta PC"}
        actions={isCloudMode ? <UsageBanner refreshKey={usageTick} /> : undefined}
      />

      <UploadBox
        usage={usage}
        onSubmitted={() => {
          reload();
          setUsageTick((n) => n + 1);
        }}
      />

      {isCloudMode && <OnboardingBanner />}

      {error && (
        <div className="notice" role="alert" style={{ marginTop: "1rem" }}>
          {error}
          {data.kind === "local" && " ¿Está corriendo el backend local?"}
        </div>
      )}
      {notice && (
        <div className="notice gold" role="status" style={{ marginTop: "1rem" }}>
          {notice}
        </div>
      )}

      {showEmpty && (
        <div className="empty" style={{ marginTop: "2rem" }}>
          <h3>Tu biblioteca está vacía</h3>
          <p>Sube tu primera canción y en un minuto tendrás un tutorial interactivo.</p>
        </div>
      )}

      {total > 0 && (
        <>
          <div className="library-head">
            <h2>Biblioteca</h2>
            <span className="count">
              {total} {total === 1 ? "canción" : "canciones"}
            </span>
          </div>
          <ul className="library" aria-label="Tus canciones">
            {pendingJobs.map((j) => (
              <PendingCard key={`job-${j.id}`} job={j} />
            ))}
            {items?.map((song) => (
              <SongCard
                key={song.id}
                song={song}
                onRename={rename}
                onDelete={remove}
                onUnlock={isCloudMode ? unlock : undefined}
                extraActions={
                  data.kind === "local" && cloudReady ? (
                    <button role="menuitem" type="button" disabled={publishing === song.id} onClick={() => void publish(song)}>
                      {publishing === song.id ? "Publicando…" : "Publicar en la nube"}
                    </button>
                  ) : undefined
                }
              />
            ))}
          </ul>
        </>
      )}

      {data.kind === "local" && cloudReady && <CloudQueuePanel onProcessed={reload} />}

      {isCloudMode && <AppFooter />}
    </main>
  );
}
