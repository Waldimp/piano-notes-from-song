/**
 * Client-side best-effort wake after a successful request INSERT.
 * Never sends request UUIDs or secrets; failures must not fail the upload.
 */

export type SessionAccess = {
  auth: {
    getSession: () => Promise<{ data: { session: { access_token?: string } | null } }>;
  };
};

export async function requestImmediateDispatchWake(
  sb: SessionAccess,
  fetchImpl: typeof fetch = fetch,
  wakePath = "/api/wake-dispatch",
): Promise<"woke" | "skipped" | "failed"> {
  try {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return "skipped";
    const response = await fetchImpl(wakePath, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.ok ? "woke" : "failed";
  } catch {
    return "failed";
  }
}
