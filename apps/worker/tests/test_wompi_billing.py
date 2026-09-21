"""Static checks for Wompi billing preparation (no live charges)."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_billing_migration_and_docs_exist():
    sql = (ROOT / "migrations/supabase/0012_wompi_billing.sql").read_text(encoding="utf-8")
    docs = (ROOT / "docs/WOMPI_INTEGRATION.md").read_text(encoding="utf-8")
    checkout = (ROOT / "apps/web/src/app/api/billing/checkout/route.ts").read_text(
        encoding="utf-8"
    )
    webhook = (ROOT / "apps/web/src/app/api/billing/wompi/webhook/route.ts").read_text(
        encoding="utf-8"
    )
    wompi = (ROOT / "apps/web/src/lib/billing/wompi.ts").read_text(encoding="utf-8")

    assert "billing_products" in sql
    assert "billing_purchases" in sql
    assert "billing_events" in sql
    assert "settle_billing_purchase" in sql
    assert "purchase_grant" in sql
    assert "mini_pack" in sql
    assert "2.99" in sql

    assert "requireUser" in checkout
    assert "product_code" in checkout
    assert "wompi_hash" in webhook
    assert "request.text()" in webhook
    assert "/EnlacePago" in wompi
    assert "id.wompi.sv/connect/token" in wompi
    assert "wompi_api" in wompi

    assert "HMAC" in docs
    assert "bloqueado" in docs.lower() or "blocked" in docs.lower()
    assert "refund" in docs.lower()
