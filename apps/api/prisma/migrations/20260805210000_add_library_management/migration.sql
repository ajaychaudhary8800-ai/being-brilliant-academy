-- CreateEnum
CREATE TYPE "LibraryCopyStatus" AS ENUM ('AVAILABLE', 'ISSUED', 'RESERVED', 'LOST', 'DAMAGED', 'DISPOSED');

-- CreateEnum
CREATE TYPE "LibraryMemberType" AS ENUM ('STUDENT', 'TEACHER', 'STAFF');

-- CreateEnum
CREATE TYPE "LibraryLoanStatus" AS ENUM ('ISSUED', 'RETURNED', 'OVERDUE', 'LOST', 'DAMAGED');

-- CreateTable
CREATE TABLE "LibraryCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LibraryCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryAuthor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "biography" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LibraryAuthor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryPublisher" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,

    CONSTRAINT "LibraryPublisher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryShelf" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "rack" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,

    CONSTRAINT "LibraryShelf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryBook" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "publisherId" TEXT,
    "isbn" TEXT,
    "title" TEXT NOT NULL,
    "edition" TEXT,
    "language" TEXT NOT NULL DEFAULT 'English',
    "publicationYear" INTEGER,
    "description" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LibraryBook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryBookAuthor" (
    "bookId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,

    CONSTRAINT "LibraryBookAuthor_pkey" PRIMARY KEY ("bookId","authorId")
);

-- CreateTable
CREATE TABLE "LibraryBookCopy" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "shelfId" TEXT,
    "accessionNumber" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "qrCode" TEXT NOT NULL,
    "purchasePricePaise" INTEGER NOT NULL DEFAULT 0,
    "acquiredAt" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "LibraryCopyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "condition" TEXT NOT NULL DEFAULT 'GOOD',

    CONSTRAINT "LibraryBookCopy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryMember" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipNumber" TEXT NOT NULL,
    "type" "LibraryMemberType" NOT NULL,
    "borrowLimit" INTEGER NOT NULL,
    "loanDays" INTEGER NOT NULL,
    "finePerDayPaise" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LibraryMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryLoan" (
    "id" TEXT NOT NULL,
    "copyId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "returnedAt" TIMESTAMP(3),
    "renewedCount" INTEGER NOT NULL DEFAULT 0,
    "status" "LibraryLoanStatus" NOT NULL DEFAULT 'ISSUED',
    "finePaise" INTEGER NOT NULL DEFAULT 0,
    "finePaidPaise" INTEGER NOT NULL DEFAULT 0,
    "remarks" TEXT,

    CONSTRAINT "LibraryLoan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryReservation" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "LibraryReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryFinePayment" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mode" "PaymentMode" NOT NULL,

    CONSTRAINT "LibraryFinePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryDigitalResource" (
    "id" TEXT NOT NULL,
    "bookId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "accessRole" "Role",
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LibraryDigitalResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryVendor" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LibraryVendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryPurchase" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "purchaseDate" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPricePaise" INTEGER NOT NULL,

    CONSTRAINT "LibraryPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryStockVerification" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "LibraryStockVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryStockVerificationItem" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "copyId" TEXT NOT NULL,
    "found" BOOLEAN NOT NULL,
    "condition" TEXT,

    CONSTRAINT "LibraryStockVerificationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryDisposal" (
    "id" TEXT NOT NULL,
    "copyId" TEXT NOT NULL,
    "disposedAt" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "proceedsPaise" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LibraryDisposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LibraryCategory_name_key" ON "LibraryCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryCategory_code_key" ON "LibraryCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryAuthor_name_key" ON "LibraryAuthor"("name");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryPublisher_name_key" ON "LibraryPublisher"("name");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryShelf_branchId_code_key" ON "LibraryShelf"("branchId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryBook_isbn_key" ON "LibraryBook"("isbn");

-- CreateIndex
CREATE INDEX "LibraryBook_branchId_title_isArchived_idx" ON "LibraryBook"("branchId", "title", "isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryBookCopy_accessionNumber_key" ON "LibraryBookCopy"("accessionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryBookCopy_barcode_key" ON "LibraryBookCopy"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryBookCopy_qrCode_key" ON "LibraryBookCopy"("qrCode");

-- CreateIndex
CREATE INDEX "LibraryBookCopy_bookId_status_idx" ON "LibraryBookCopy"("bookId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryMember_userId_key" ON "LibraryMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryMember_membershipNumber_key" ON "LibraryMember"("membershipNumber");

-- CreateIndex
CREATE INDEX "LibraryMember_branchId_type_active_idx" ON "LibraryMember"("branchId", "type", "active");

-- CreateIndex
CREATE INDEX "LibraryLoan_memberId_status_idx" ON "LibraryLoan"("memberId", "status");

-- CreateIndex
CREATE INDEX "LibraryLoan_dueAt_status_idx" ON "LibraryLoan"("dueAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryReservation_bookId_memberId_status_key" ON "LibraryReservation"("bookId", "memberId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryFinePayment_receiptNumber_key" ON "LibraryFinePayment"("receiptNumber");

-- CreateIndex
CREATE INDEX "LibraryDigitalResource_type_isArchived_idx" ON "LibraryDigitalResource"("type", "isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryVendor_branchId_code_key" ON "LibraryVendor"("branchId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryPurchase_vendorId_invoiceNumber_bookId_key" ON "LibraryPurchase"("vendorId", "invoiceNumber", "bookId");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryStockVerificationItem_verificationId_copyId_key" ON "LibraryStockVerificationItem"("verificationId", "copyId");

-- AddForeignKey
ALTER TABLE "LibraryShelf" ADD CONSTRAINT "LibraryShelf_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryBook" ADD CONSTRAINT "LibraryBook_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryBook" ADD CONSTRAINT "LibraryBook_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "LibraryCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryBook" ADD CONSTRAINT "LibraryBook_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "LibraryPublisher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryBookAuthor" ADD CONSTRAINT "LibraryBookAuthor_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "LibraryBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryBookAuthor" ADD CONSTRAINT "LibraryBookAuthor_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "LibraryAuthor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryBookCopy" ADD CONSTRAINT "LibraryBookCopy_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "LibraryBook"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryBookCopy" ADD CONSTRAINT "LibraryBookCopy_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "LibraryShelf"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryMember" ADD CONSTRAINT "LibraryMember_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryMember" ADD CONSTRAINT "LibraryMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryLoan" ADD CONSTRAINT "LibraryLoan_copyId_fkey" FOREIGN KEY ("copyId") REFERENCES "LibraryBookCopy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryLoan" ADD CONSTRAINT "LibraryLoan_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LibraryMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryReservation" ADD CONSTRAINT "LibraryReservation_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "LibraryBook"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryReservation" ADD CONSTRAINT "LibraryReservation_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LibraryMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryFinePayment" ADD CONSTRAINT "LibraryFinePayment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "LibraryLoan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryDigitalResource" ADD CONSTRAINT "LibraryDigitalResource_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "LibraryBook"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryVendor" ADD CONSTRAINT "LibraryVendor_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryPurchase" ADD CONSTRAINT "LibraryPurchase_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "LibraryBook"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryPurchase" ADD CONSTRAINT "LibraryPurchase_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "LibraryVendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryStockVerificationItem" ADD CONSTRAINT "LibraryStockVerificationItem_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "LibraryStockVerification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryStockVerificationItem" ADD CONSTRAINT "LibraryStockVerificationItem_copyId_fkey" FOREIGN KEY ("copyId") REFERENCES "LibraryBookCopy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryDisposal" ADD CONSTRAINT "LibraryDisposal_copyId_fkey" FOREIGN KEY ("copyId") REFERENCES "LibraryBookCopy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
