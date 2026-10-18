-- Additive, unique link to signed SchoolOS quotation. Existing SaaS invoices are unchanged.
ALTER TABLE "SaaSInvoice" ADD COLUMN "schoolOSQuoteId" TEXT;
CREATE UNIQUE INDEX "SaaSInvoice_schoolOSQuoteId_key" ON "SaaSInvoice"("schoolOSQuoteId");
ALTER TABLE "SaaSInvoice"
  ADD CONSTRAINT "SaaSInvoice_schoolOSQuoteId_fkey"
  FOREIGN KEY ("schoolOSQuoteId") REFERENCES "SchoolOSQuotation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
