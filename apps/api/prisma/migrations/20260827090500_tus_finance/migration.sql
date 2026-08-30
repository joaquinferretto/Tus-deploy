-- PR6 is additive. Existing payment, snapshot, evidence, freeze, and ledger
-- history remains authoritative and is never rewritten or destructively rolled
-- back when a financial gate is revoked.
ALTER TABLE "TusReconciliationRecord"
  ADD COLUMN IF NOT EXISTS "evidenceId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "actorId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "correlationId" TEXT NOT NULL DEFAULT '';

-- Financial corrections are represented by new entries linked to the original
-- entry. Database enforcement keeps the ledger append-only for every writer.
CREATE OR REPLACE FUNCTION tus_ledger_entry_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'TusLedgerEntry is append-only; preserve ledger history with a compensating entry';
END;
$$;

DROP TRIGGER IF EXISTS tus_ledger_entry_append_only_trigger ON "TusLedgerEntry";
CREATE TRIGGER tus_ledger_entry_append_only_trigger
  BEFORE UPDATE OR DELETE ON "TusLedgerEntry"
  FOR EACH ROW
  EXECUTE FUNCTION tus_ledger_entry_append_only();

COMMENT ON TABLE "TusLedgerEntry" IS 'Append-only financial ledger; corrections must preserve history with linked compensating entries';
COMMENT ON TABLE "TusFinancialFreeze" IS 'Fail-closed dispute, chargeback, refund, reserve, and operational risk freezes';
