-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED');

-- Enable pg_trgm extension for ultra-fast customer name and email ILIKE searching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateTable
CREATE TABLE "orders" (
    "id" SERIAL NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- Trigram GIN indexes for fast fuzzy & substring search on 50,000+ rows
CREATE INDEX "idx_orders_customer_name_trgm" ON "orders" USING gin ("customerName" gin_trgm_ops);
CREATE INDEX "idx_orders_customer_email_trgm" ON "orders" USING gin ("customerEmail" gin_trgm_ops);

-- B-Tree indexes for status filtering and sorting by date or amount
CREATE INDEX "orders_status_createdAt_idx" ON "orders"("status", "createdAt" DESC);
CREATE INDEX "orders_status_amount_idx" ON "orders"("status", "amount" DESC);
CREATE INDEX "orders_createdAt_idx" ON "orders"("createdAt" DESC);
CREATE INDEX "orders_amount_idx" ON "orders"("amount" DESC);

-- Stored Function / Procedure for Orders search, filter, sort & pagination
CREATE OR REPLACE FUNCTION get_orders_paginated(
    p_search TEXT DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_sort_by TEXT DEFAULT 'createdAt',
    p_sort_dir TEXT DEFAULT 'DESC',
    p_page INT DEFAULT 1,
    p_page_size INT DEFAULT 50
)
RETURNS TABLE (
    id INT,
    "customerName" TEXT,
    "customerEmail" TEXT,
    amount DECIMAL(12, 2),
    status "OrderStatus",
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),
    total_count BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_offset INT;
    v_status_enum "OrderStatus";
    v_clean_search TEXT;
BEGIN
    v_offset := GREATEST(0, (COALESCE(p_page, 1) - 1) * GREATEST(1, p_page_size));
    v_clean_search := NULLIF(TRIM(p_search), '');

    IF p_status IS NOT NULL AND TRIM(p_status) <> '' THEN
        BEGIN
            v_status_enum := TRIM(p_status)::"OrderStatus";
        EXCEPTION WHEN others THEN
            v_status_enum := NULL;
        END;
    ELSE
        v_status_enum := NULL;
    END IF;

    RETURN QUERY
    WITH filtered_orders AS (
        SELECT o.*
        FROM "orders" o
        WHERE
            (v_status_enum IS NULL OR o."status" = v_status_enum)
            AND
            (
                v_clean_search IS NULL
                OR o."customerName" ILIKE ('%' || v_clean_search || '%')
                OR o."customerEmail" ILIKE ('%' || v_clean_search || '%')
            )
    ),
    counted_orders AS (
        SELECT COUNT(*) AS cnt FROM filtered_orders
    )
    SELECT
        fo."id",
        fo."customerName",
        fo."customerEmail",
        fo."amount",
        fo."status",
        fo."createdAt",
        fo."updatedAt",
        co.cnt AS total_count
    FROM filtered_orders fo
    CROSS JOIN counted_orders co
    ORDER BY
        CASE WHEN p_sort_by = 'amount' AND UPPER(p_sort_dir) = 'ASC' THEN fo."amount" END ASC,
        CASE WHEN p_sort_by = 'amount' AND UPPER(p_sort_dir) = 'DESC' THEN fo."amount" END DESC,
        CASE WHEN p_sort_by = 'customerName' AND UPPER(p_sort_dir) = 'ASC' THEN fo."customerName" END ASC,
        CASE WHEN p_sort_by = 'customerName' AND UPPER(p_sort_dir) = 'DESC' THEN fo."customerName" END DESC,
        CASE WHEN (p_sort_by IS NULL OR p_sort_by = 'createdAt') AND UPPER(p_sort_dir) = 'ASC' THEN fo."createdAt" END ASC,
        CASE WHEN (p_sort_by IS NULL OR p_sort_by = 'createdAt') AND UPPER(p_sort_dir) <> 'ASC' THEN fo."createdAt" END DESC,
        fo."id" DESC
    LIMIT GREATEST(1, p_page_size)
    OFFSET v_offset;
END;
$$;
