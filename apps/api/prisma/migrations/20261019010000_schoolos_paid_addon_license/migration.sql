-- Immutable paid add-on license ledger. No data seeding or subscription mutation.
CREATE TABLE "SchoolOSAddonLicense" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "units" INTEGER NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchoolOSAddonLicense_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SchoolOSAddonLicense_valid_check" CHECK (
    "category" IN ('MODULE', 'CAPACITY') AND "units" > 0
    AND "periodEnd" > "periodStart"
    AND (("category" = 'CAPACITY' AND "code" IN ('students','users','branches'))
      OR ("category" = 'MODULE' AND "code" IN
        ('lms','crm','examinations','communication','hr_payroll','finance','library',
         'inventory','analytics','transport','hostel','multi_branch','white_label','custom_domain')))
  )
);
CREATE UNIQUE INDEX "SchoolOSAddonLicense_invoiceId_category_code_key"
  ON "SchoolOSAddonLicense"("invoiceId","category","code");
CREATE INDEX "SchoolOSAddonLicense_organizationId_category_code_periodEnd_idx"
  ON "SchoolOSAddonLicense"("organizationId","category","code","periodEnd");
ALTER TABLE "SchoolOSAddonLicense"
  ADD CONSTRAINT "SchoolOSAddonLicense_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolOSAddonLicense"
  ADD CONSTRAINT "SchoolOSAddonLicense_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "SaaSInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION schoolos_license_paid_guard_fn()
RETURNS TRIGGER AS $$
DECLARE invoice_tenant TEXT;
DECLARE invoice_status TEXT;
DECLARE invoice_quote TEXT;
BEGIN
 SELECT "organizationId","status"::TEXT,"schoolOSQuoteId" INTO invoice_tenant,invoice_status,invoice_quote
 FROM "SaaSInvoice" WHERE "id"=NEW."invoiceId";
 IF invoice_tenant IS NULL OR invoice_tenant <> NEW."organizationId"
   OR invoice_status <> 'PAID' OR invoice_quote IS NULL OR invoice_quote <> NEW."quoteId" THEN
   RAISE EXCEPTION 'SCHOOLOS_LICENSE_REQUIRES_PAID_TENANT_QUOTE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SchoolOSAddonLicense_paid_guard"
  BEFORE INSERT OR UPDATE ON "SchoolOSAddonLicense"
  FOR EACH ROW EXECUTE FUNCTION schoolos_license_paid_guard_fn();
