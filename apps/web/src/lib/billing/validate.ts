/**
 * Pure webhook gate checks (no network). Used by processWompiWebhook + unit tests.
 */
export type EnvironmentGateInput = {
  webhookEsProductiva: boolean | undefined;
  txEsReal: boolean | undefined;
  expectProductive: boolean;
};

export function environmentMatches(input: EnvironmentGateInput): {
  ok: boolean;
  code?: string;
} {
  if (Boolean(input.webhookEsProductiva) !== input.expectProductive) {
    return { ok: false, code: "wrong_environment" };
  }
  if (input.txEsReal !== undefined && Boolean(input.txEsReal) !== input.expectProductive) {
    return { ok: false, code: "wrong_environment_tx" };
  }
  return { ok: true };
}

export function aplicativoMatches(
  webhookAplicativoId: string | undefined,
  expectedAplicativoId: string
): boolean {
  if (!webhookAplicativoId) return true; // optional field; confirmed via S2S tx
  return webhookAplicativoId === expectedAplicativoId;
}

export function isApprovedTransaction(tx: {
  esAprobada?: boolean;
}): boolean {
  return Boolean(tx.esAprobada);
}
