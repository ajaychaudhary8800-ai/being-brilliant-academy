-- CreateTable
CREATE TABLE "AssetCategory" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "defaultUsefulLifeMonths" INTEGER NOT NULL,
    "defaultDepreciationMethod" TEXT NOT NULL DEFAULT 'STRAIGHT_LINE',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AssetCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnterpriseAsset" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "serialNumber" TEXT,
    "barcode" TEXT,
    "qrCode" TEXT,
    "sourceModule" TEXT,
    "sourceEntityId" TEXT,
    "building" TEXT,
    "floor" TEXT,
    "room" TEXT,
    "custodianEmployeeId" TEXT,
    "purchaseDate" DATE,
    "purchaseCostPaise" INTEGER NOT NULL,
    "residualValuePaise" INTEGER NOT NULL DEFAULT 0,
    "usefulLifeMonths" INTEGER NOT NULL,
    "depreciationMethod" TEXT NOT NULL DEFAULT 'STRAIGHT_LINE',
    "warrantyEndsAt" DATE,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "condition" TEXT NOT NULL DEFAULT 'GOOD',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnterpriseAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetTransfer" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "fromBranchId" TEXT,
    "toBranchId" TEXT NOT NULL,
    "fromLocation" TEXT,
    "toLocation" TEXT,
    "transferredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',

    CONSTRAINT "AssetTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetWarranty" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "startsAt" DATE NOT NULL,
    "endsAt" DATE NOT NULL,
    "terms" TEXT,
    "documentName" TEXT,
    "documentMime" TEXT,
    "documentData" BYTEA,

    CONSTRAINT "AssetWarranty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetDisposal" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "disposedAt" DATE NOT NULL,
    "method" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "proceedsPaise" INTEGER NOT NULL DEFAULT 0,
    "approvedBy" TEXT NOT NULL,

    CONSTRAINT "AssetDisposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryStore" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "managerEmployeeId" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "InventoryStore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLocation" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "building" TEXT,
    "room" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "InventoryLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItemCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isConsumable" BOOLEAN NOT NULL DEFAULT true,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "InventoryItemCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL,
    "barcode" TEXT,
    "minimumStock" INTEGER NOT NULL DEFAULT 0,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "reorderQuantity" INTEGER NOT NULL DEFAULT 0,
    "trackLots" BOOLEAN NOT NULL DEFAULT false,
    "trackExpiry" BOOLEAN NOT NULL DEFAULT false,
    "sourceModule" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryStockLot" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "expiryDate" DATE,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "unitCostPaise" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InventoryStockLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryVendor" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "gstin" TEXT,
    "address" TEXT,
    "financeVendorId" TEXT,
    "rating" INTEGER,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "InventoryVendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryPurchaseRequest" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requiredBy" DATE NOT NULL,
    "justification" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryPurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryPurchaseRequestLine" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "estimatedUnitCostPaise" INTEGER NOT NULL,

    CONSTRAINT "InventoryPurchaseRequestLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryPurchaseOrder" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "orderDate" DATE NOT NULL,
    "expectedAt" DATE,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "subtotalPaise" INTEGER NOT NULL,
    "taxPaise" INTEGER NOT NULL DEFAULT 0,
    "totalPaise" INTEGER NOT NULL,
    "financeEntryId" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryPurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryPurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
    "unitCostPaise" INTEGER NOT NULL,
    "taxPercent" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InventoryPurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryGoodsReceipt" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'POSTED',

    CONSTRAINT "InventoryGoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryGoodsReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "expiryDate" DATE,
    "quantity" INTEGER NOT NULL,
    "acceptedQuantity" INTEGER NOT NULL,
    "rejectedQuantity" INTEGER NOT NULL DEFAULT 0,
    "unitCostPaise" INTEGER NOT NULL,

    CONSTRAINT "InventoryGoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryStockMovement" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCostPaise" INTEGER NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "issuedToModule" TEXT,
    "issuedToId" TEXT,
    "performedById" TEXT NOT NULL,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryStockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetMaintenanceTicket" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "assetId" TEXT,
    "ticketNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "technicianEmployeeId" TEXT,
    "reportedById" TEXT NOT NULL,
    "estimatedCostPaise" INTEGER NOT NULL DEFAULT 0,
    "actualCostPaise" INTEGER NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AssetMaintenanceTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreventiveMaintenanceSchedule" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "frequencyDays" INTEGER NOT NULL,
    "nextDueAt" DATE NOT NULL,
    "lastCompletedAt" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PreventiveMaintenanceSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceWorkOrder" (
    "id" TEXT NOT NULL,
    "workOrderNumber" TEXT NOT NULL,
    "ticketId" TEXT,
    "scheduleId" TEXT,
    "technicianEmployeeId" TEXT,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
    "laborCostPaise" INTEGER NOT NULL DEFAULT 0,
    "partsCostPaise" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "serviceNotes" TEXT,

    CONSTRAINT "MaintenanceWorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnualMaintenanceContract" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT,
    "providerName" TEXT NOT NULL,
    "contractNumber" TEXT NOT NULL,
    "startsAt" DATE NOT NULL,
    "endsAt" DATE NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "coverage" TEXT NOT NULL,
    "documentName" TEXT,
    "documentMime" TEXT,
    "documentData" BYTEA,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "AnnualMaintenanceContract_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssetCategory_branchId_code_key" ON "AssetCategory"("branchId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "EnterpriseAsset_assetCode_key" ON "EnterpriseAsset"("assetCode");

-- CreateIndex
CREATE UNIQUE INDEX "EnterpriseAsset_serialNumber_key" ON "EnterpriseAsset"("serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "EnterpriseAsset_barcode_key" ON "EnterpriseAsset"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "EnterpriseAsset_qrCode_key" ON "EnterpriseAsset"("qrCode");

-- CreateIndex
CREATE INDEX "EnterpriseAsset_branchId_status_idx" ON "EnterpriseAsset"("branchId", "status");

-- CreateIndex
CREATE INDEX "EnterpriseAsset_sourceModule_sourceEntityId_idx" ON "EnterpriseAsset"("sourceModule", "sourceEntityId");

-- CreateIndex
CREATE INDEX "AssetTransfer_assetId_transferredAt_idx" ON "AssetTransfer"("assetId", "transferredAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryStore_branchId_code_key" ON "InventoryStore"("branchId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLocation_storeId_code_key" ON "InventoryLocation"("storeId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItemCategory_code_key" ON "InventoryItemCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_sku_key" ON "InventoryItem"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_barcode_key" ON "InventoryItem"("barcode");

-- CreateIndex
CREATE INDEX "InventoryItem_categoryId_name_idx" ON "InventoryItem"("categoryId", "name");

-- CreateIndex
CREATE INDEX "InventoryStockLot_expiryDate_idx" ON "InventoryStockLot"("expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryStockLot_itemId_locationId_lotNumber_key" ON "InventoryStockLot"("itemId", "locationId", "lotNumber");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryVendor_branchId_code_key" ON "InventoryVendor"("branchId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPurchaseRequest_requestNumber_key" ON "InventoryPurchaseRequest"("requestNumber");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPurchaseRequestLine_requestId_itemId_key" ON "InventoryPurchaseRequestLine"("requestId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPurchaseOrder_orderNumber_key" ON "InventoryPurchaseOrder"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPurchaseOrderLine_orderId_itemId_key" ON "InventoryPurchaseOrderLine"("orderId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryGoodsReceipt_receiptNumber_key" ON "InventoryGoodsReceipt"("receiptNumber");

-- CreateIndex
CREATE INDEX "InventoryStockMovement_itemId_createdAt_idx" ON "InventoryStockMovement"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryStockMovement_referenceType_referenceId_idx" ON "InventoryStockMovement"("referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetMaintenanceTicket_ticketNumber_key" ON "AssetMaintenanceTicket"("ticketNumber");

-- CreateIndex
CREATE INDEX "AssetMaintenanceTicket_branchId_status_priority_idx" ON "AssetMaintenanceTicket"("branchId", "status", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceWorkOrder_workOrderNumber_key" ON "MaintenanceWorkOrder"("workOrderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AnnualMaintenanceContract_contractNumber_key" ON "AnnualMaintenanceContract"("contractNumber");

-- AddForeignKey
ALTER TABLE "AssetCategory" ADD CONSTRAINT "AssetCategory_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnterpriseAsset" ADD CONSTRAINT "EnterpriseAsset_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnterpriseAsset" ADD CONSTRAINT "EnterpriseAsset_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AssetCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetTransfer" ADD CONSTRAINT "AssetTransfer_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "EnterpriseAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetWarranty" ADD CONSTRAINT "AssetWarranty_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "EnterpriseAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetDisposal" ADD CONSTRAINT "AssetDisposal_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "EnterpriseAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryStore" ADD CONSTRAINT "InventoryStore_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLocation" ADD CONSTRAINT "InventoryLocation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "InventoryStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "InventoryItemCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryStockLot" ADD CONSTRAINT "InventoryStockLot_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryStockLot" ADD CONSTRAINT "InventoryStockLot_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryVendor" ADD CONSTRAINT "InventoryVendor_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryPurchaseRequest" ADD CONSTRAINT "InventoryPurchaseRequest_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "InventoryStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryPurchaseRequest" ADD CONSTRAINT "InventoryPurchaseRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryPurchaseRequestLine" ADD CONSTRAINT "InventoryPurchaseRequestLine_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "InventoryPurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryPurchaseRequestLine" ADD CONSTRAINT "InventoryPurchaseRequestLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryPurchaseOrder" ADD CONSTRAINT "InventoryPurchaseOrder_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "InventoryStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryPurchaseOrder" ADD CONSTRAINT "InventoryPurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "InventoryVendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryPurchaseOrderLine" ADD CONSTRAINT "InventoryPurchaseOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "InventoryPurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryPurchaseOrderLine" ADD CONSTRAINT "InventoryPurchaseOrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryGoodsReceipt" ADD CONSTRAINT "InventoryGoodsReceipt_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "InventoryStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryGoodsReceipt" ADD CONSTRAINT "InventoryGoodsReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "InventoryPurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryGoodsReceiptLine" ADD CONSTRAINT "InventoryGoodsReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "InventoryGoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryGoodsReceiptLine" ADD CONSTRAINT "InventoryGoodsReceiptLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "InventoryPurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryGoodsReceiptLine" ADD CONSTRAINT "InventoryGoodsReceiptLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryStockMovement" ADD CONSTRAINT "InventoryStockMovement_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "InventoryStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryStockMovement" ADD CONSTRAINT "InventoryStockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryStockMovement" ADD CONSTRAINT "InventoryStockMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryStockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryStockMovement" ADD CONSTRAINT "InventoryStockMovement_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryStockMovement" ADD CONSTRAINT "InventoryStockMovement_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryStockMovement" ADD CONSTRAINT "InventoryStockMovement_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetMaintenanceTicket" ADD CONSTRAINT "AssetMaintenanceTicket_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetMaintenanceTicket" ADD CONSTRAINT "AssetMaintenanceTicket_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "EnterpriseAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreventiveMaintenanceSchedule" ADD CONSTRAINT "PreventiveMaintenanceSchedule_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "EnterpriseAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceWorkOrder" ADD CONSTRAINT "MaintenanceWorkOrder_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "AssetMaintenanceTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceWorkOrder" ADD CONSTRAINT "MaintenanceWorkOrder_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "PreventiveMaintenanceSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
