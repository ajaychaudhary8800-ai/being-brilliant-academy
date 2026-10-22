-- Additive, unique link to signed SchoolOS quotation. Existing SaaS invoices are unchanged.
ALTER TABLE "SaaSInvoice" ADD COLUMN "schoolOSQuoteId" TEXT;
CREATE UNIQUE INDEX "SaaSInvoice_schoolOSQuoteId_key" ON "SaaSInvoice"("schoolOSQuoteId");
ALTER TABLE "SaaSInvoice"
  ADD CONSTRAINT "SaaSInvoice_schoolOSQuoteId_fkey"
  FOREIGN KEY ("schoolOSQuoteId") REFERENCES "SchoolOSQuotation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce quote/invoice tenant identity at the database boundary, including any direct SQL writes.
CREATE OR REPLACE FUNCTION schoolos_invoice_quote_tenant_guard_fn()
RETURNS TRIGGER AS $$
DECLARE owner_id TEXT;
BEGIN
  IF NEW."schoolOSQuoteId" IS NULL THEN RETURN NEW; END IF;
  SELECT "organizationId" INTO owner_id
    FROM "SchoolOSQuotation" WHERE "id" = NEW."schoolOSQuoteId";
  IF owner_id IS NULL OR owner_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'SCHOOLOS_INVOICE_QUOTE_TENANT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SaaSInvoice_schoolos_quote_tenant_guard"
BEFORE INSERT OR UPDATE OF "organizationId", "schoolOSQuoteId" ON "SaaSInvoice"
FOR EACH ROW EXECUTE FUNCTION schoolos_invoice_quote_tenant_guard_fn();
