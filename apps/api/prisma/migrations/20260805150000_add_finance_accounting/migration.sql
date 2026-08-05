-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'INCOME', 'EXPENSE', 'EQUITY');

-- CreateEnum
CREATE TYPE "VoucherType" AS ENUM ('JOURNAL', 'PAYMENT', 'RECEIPT', 'CONTRA', 'PURCHASE', 'REFUND', 'FEE_RECEIPT', 'OPENING');

-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FinanceApprovalStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAID', 'ARCHIVED');

-- CreateTable
CREATE TABLE "FinancialYear" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" DATE NOT NULL,
    "endsAt" DATE NOT NULL,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3),

    CONSTRAINT "FinancialYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "parentId" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AccountGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "openingDebitPaise" BIGINT NOT NULL DEFAULT 0,
    "openingCreditPaise" BIGINT NOT NULL DEFAULT 0,
    "gstin" TEXT,
    "pan" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "financialYearId" TEXT NOT NULL,
    "voucherNumber" TEXT NOT NULL,
    "type" "VoucherType" NOT NULL,
    "date" DATE NOT NULL,
    "narration" TEXT NOT NULL,
    "reference" TEXT,
    "status" "JournalStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceType" TEXT,
    "sourceId" TEXT,
    "createdById" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debitPaise" BIGINT NOT NULL DEFAULT 0,
    "creditPaise" BIGINT NOT NULL DEFAULT 0,
    "description" TEXT,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'OFFICE',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceVendor" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "gstin" TEXT,
    "pan" TEXT,
    "accountId" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FinanceVendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseBill" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "vendorId" TEXT,
    "categoryId" TEXT NOT NULL,
    "expenseAccountId" TEXT NOT NULL,
    "billNumber" TEXT NOT NULL,
    "billDate" DATE NOT NULL,
    "dueDate" DATE,
    "taxablePaise" BIGINT NOT NULL,
    "gstPaise" BIGINT NOT NULL DEFAULT 0,
    "tdsPaise" BIGINT NOT NULL DEFAULT 0,
    "totalPaise" BIGINT NOT NULL,
    "status" "FinanceApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "approverId" TEXT,
    "journalEntryId" TEXT,
    "attachmentName" TEXT,
    "attachmentMime" TEXT,
    "attachmentData" BYTEA,
    "remarks" TEXT,

    CONSTRAINT "ExpenseBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceBankAccount" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "openingBalancePaise" BIGINT NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FinanceBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceBankTransaction" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "journalEntryId" TEXT,
    "transactionDate" DATE NOT NULL,
    "reference" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "direction" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "chequeNumber" TEXT,
    "chequeStatus" TEXT,
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "reconciledAt" TIMESTAMP(3),
    "statementReference" TEXT,

    CONSTRAINT "FinanceBankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeAdjustment" (
    "id" TEXT NOT NULL,
    "feeId" TEXT NOT NULL,
    "journalEntryId" TEXT,
    "type" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "FinanceApprovalStatus" NOT NULL DEFAULT 'APPROVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstConfiguration" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "gstin" TEXT NOT NULL,
    "stateCode" TEXT NOT NULL,
    "defaultRate" DECIMAL(5,2) NOT NULL,
    "tdsRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "effectiveFrom" DATE NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "GstConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinancialYear_branchId_name_key" ON "FinancialYear"("branchId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "AccountGroup_code_key" ON "AccountGroup"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AccountGroup_parentId_name_key" ON "AccountGroup"("parentId", "name");

-- CreateIndex
CREATE INDEX "LedgerAccount_branchId_type_isArchived_idx" ON "LedgerAccount"("branchId", "type", "isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_branchId_code_key" ON "LedgerAccount"("branchId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_branchId_name_key" ON "LedgerAccount"("branchId", "name");

-- CreateIndex
CREATE INDEX "JournalEntry_branchId_date_type_status_idx" ON "JournalEntry"("branchId", "date", "type", "status");

-- CreateIndex
CREATE INDEX "JournalEntry_sourceType_sourceId_idx" ON "JournalEntry"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_branchId_financialYearId_voucherNumber_key" ON "JournalEntry"("branchId", "financialYearId", "voucherNumber");

-- CreateIndex
CREATE INDEX "JournalLine_accountId_idx" ON "JournalLine"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_name_key" ON "ExpenseCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_code_key" ON "ExpenseCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceVendor_branchId_code_key" ON "FinanceVendor"("branchId", "code");

-- CreateIndex
CREATE INDEX "ExpenseBill_branchId_status_billDate_idx" ON "ExpenseBill"("branchId", "status", "billDate");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseBill_branchId_billNumber_key" ON "ExpenseBill"("branchId", "billNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceBankAccount_ledgerAccountId_key" ON "FinanceBankAccount"("ledgerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceBankAccount_branchId_accountNumber_key" ON "FinanceBankAccount"("branchId", "accountNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceBankTransaction_bankAccountId_reference_key" ON "FinanceBankTransaction"("bankAccountId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "FeeAdjustment_reference_key" ON "FeeAdjustment"("reference");

-- CreateIndex
CREATE INDEX "FeeAdjustment_feeId_type_idx" ON "FeeAdjustment"("feeId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "GstConfiguration_branchId_effectiveFrom_key" ON "GstConfiguration"("branchId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "FinancialYear" ADD CONSTRAINT "FinancialYear_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountGroup" ADD CONSTRAINT "AccountGroup_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AccountGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AccountGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceVendor" ADD CONSTRAINT "FinanceVendor_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceVendor" ADD CONSTRAINT "FinanceVendor_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseBill" ADD CONSTRAINT "ExpenseBill_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseBill" ADD CONSTRAINT "ExpenseBill_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "FinanceVendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseBill" ADD CONSTRAINT "ExpenseBill_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseBill" ADD CONSTRAINT "ExpenseBill_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseBill" ADD CONSTRAINT "ExpenseBill_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseBill" ADD CONSTRAINT "ExpenseBill_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceBankAccount" ADD CONSTRAINT "FinanceBankAccount_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceBankAccount" ADD CONSTRAINT "FinanceBankAccount_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceBankTransaction" ADD CONSTRAINT "FinanceBankTransaction_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "FinanceBankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceBankTransaction" ADD CONSTRAINT "FinanceBankTransaction_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeAdjustment" ADD CONSTRAINT "FeeAdjustment_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstConfiguration" ADD CONSTRAINT "GstConfiguration_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
