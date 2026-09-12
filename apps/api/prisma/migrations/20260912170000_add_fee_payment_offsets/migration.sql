-- Additive immutable refund/reversal ledger for original fee payments.
CREATE TYPE "FeePaymentOffsetType" AS ENUM ('REFUND', 'REVERSAL');

ALTER TABLE "FeePayment"
  ADD CONSTRAINT "FeePayment_organizationId_id_feeId_key"
  UNIQUE ("organizationId", "id", "feeId");

CREATE TABLE "FeePaymentOffset" (
    "organizationId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "feePaymentId" TEXT NOT NULL,
    "feeId" TEXT NOT NULL,
    "type" "FeePaymentOffsetType" NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "reference" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeePaymentOffset_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FeePaymentOffset_amountPaise_positive_check" CHECK ("amountPaise" > 0)
);

CREATE UNIQUE INDEX "FeePaymentOffset_organizationId_idempotencyKey_key"
  ON "FeePaymentOffset"("organizationId", "idempotencyKey");
CREATE INDEX "FeePaymentOffset_organizationId_feePaymentId_createdAt_idx"
  ON "FeePaymentOffset"("organizationId", "feePaymentId", "createdAt");
CREATE INDEX "FeePaymentOffset_organizationId_feeId_createdAt_idx"
  ON "FeePaymentOffset"("organizationId", "feeId", "createdAt");
CREATE INDEX "FeePaymentOffset_organizationId_type_createdAt_idx"
  ON "FeePaymentOffset"("organizationId", "type", "createdAt");

ALTER TABLE "FeePaymentOffset"
  ADD CONSTRAINT "FeePaymentOffset_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FeePaymentOffset_feePayment_fkey"
  FOREIGN KEY ("organizationId", "feePaymentId", "feeId")
  REFERENCES "FeePayment"("organizationId", "id", "feeId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FeePaymentOffset_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "FeePaymentOffset_cumulative_cap_check_fn"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    original_amount INTEGER;
    existing_total BIGINT;
BEGIN
    SELECT payment."amountPaise"
      INTO original_amount
      FROM "FeePayment" AS payment
     WHERE payment."organizationId" = NEW."organizationId"
       AND payment."id" = NEW."feePaymentId"
       AND payment."feeId" = NEW."feeId"
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    SELECT COALESCE(SUM(o."amountPaise"), 0)
      INTO existing_total
      FROM "FeePaymentOffset" AS o
     WHERE o."organizationId" = NEW."organizationId"
       AND o."feePaymentId" = NEW."feePaymentId";

    IF existing_total + NEW."amountPaise" > original_amount THEN
        RAISE EXCEPTION 'Payment offsets cannot exceed original payment amount'
            USING ERRCODE = '23514', CONSTRAINT = 'FeePaymentOffset_cumulative_cap_check';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "FeePaymentOffset_cumulative_cap_check"
BEFORE INSERT ON "FeePaymentOffset"
FOR EACH ROW
EXECUTE FUNCTION "FeePaymentOffset_cumulative_cap_check_fn"();
