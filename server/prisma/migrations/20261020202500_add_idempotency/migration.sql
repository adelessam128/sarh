-- AlterTable: add idempotencyKey to orders
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

-- CreateIndex: unique constraint on idempotencyKey
CREATE UNIQUE INDEX IF NOT EXISTS "orders_idempotencyKey_key" ON "orders"("idempotencyKey");

-- CreateTable: idempotency_records
CREATE TABLE IF NOT EXISTS "idempotency_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex: unique constraint on key
CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_records_key_key" ON "idempotency_records"("key");

