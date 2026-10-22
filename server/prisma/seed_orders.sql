-- ============================================================================
-- SQL SEED SCRIPT FOR 50,000 ORDERS (SINGLE TABLE ONLY)
-- Columns: customerName, customerEmail, status, amount, createdAt, items (1-5 line items in JSONB)
-- Execution time: ~2-4 seconds
-- ============================================================================

-- 1. Ensure OrderStatus enum exists
DO $$ BEGIN
    CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Drop secondary order_items table if it exists (Single Table Architecture)
DROP TABLE IF EXISTS "order_items" CASCADE;

-- 3. Ensure single orders table exists
CREATE TABLE IF NOT EXISTS "orders" (
    "id" SERIAL PRIMARY KEY,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "amount" DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "items" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Ensure items column exists if table was created previously
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "items" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 4. Truncate table for clean 50,000 dataset
TRUNCATE TABLE "orders" RESTART IDENTITY;

-- 5. Generate 50,000 Orders with 1-5 Line Items embedded as JSONB
DO $$
DECLARE
    v_total_orders INT := 50000;
    first_names TEXT[] := ARRAY[
        'James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda',
        'William', 'Elizabeth', 'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
        'Thomas', 'Sarah', 'Charles', 'Karen', 'Christopher', 'Nancy', 'Daniel', 'Lisa'
    ];
    last_names TEXT[] := ARRAY[
        'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
        'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
        'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White'
    ];
    domains TEXT[] := ARRAY['gmail.com', 'yahoo.com', 'outlook.com', 'example.com', 'company.org'];
    statuses "OrderStatus"[] := ARRAY['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']::"OrderStatus"[];
    products TEXT[] := ARRAY[
        'Ultra Gaming Laptop', 'Wireless Noise-Canceling Headphones', 'Ergonomic Office Chair',
        '4K Ultra HD Monitor', 'Mechanical Keyboard', 'Wireless Ergonomic Mouse',
        'USB-C Multiport Dock', 'External 2TB NVMe SSD', 'Smart Fitness Watch',
        'HD Streaming Webcam', 'Studio Condenser Mic', 'Aluminum Laptop Stand',
        'Fast Wireless Charger', 'Bluetooth Conference Speaker', 'Screen Cleaning Kit'
    ];
    fn_len INT := array_length(first_names, 1);
    ln_len INT := array_length(last_names, 1);
    dm_len INT := array_length(domains, 1);
    st_len INT := array_length(statuses, 1);
    pr_len INT := array_length(products, 1);
BEGIN
    RAISE NOTICE 'Generating 50,000 orders with 1-5 line items in JSONB...';

    WITH raw_orders AS (
        SELECT
            i AS id,
            first_names[1 + floor(random() * fn_len)::int] AS fname,
            last_names[1 + floor(random() * ln_len)::int]  AS lname,
            domains[1 + floor(random() * dm_len)::int]     AS dom,
            statuses[1 + floor(random() * st_len)::int]    AS stat,
            NOW() - (random() * interval '180 days')       AS created_ts
        FROM generate_series(1, v_total_orders) AS s(i)
    ),
    order_items_aggregate AS (
        SELECT
            ro.id AS order_id,
            jsonb_agg(
                jsonb_build_object(
                    'productName', products[1 + floor(random() * pr_len)::int],
                    'quantity', (1 + floor(random() * 4))::int,
                    'unitPrice', round((15 + (random() * 485))::numeric, 2),
                    'lineTotal', round(((1 + floor(random() * 4)) * (15 + (random() * 485)))::numeric, 2)
                )
            ) AS items_json,
            round(SUM(((1 + floor(random() * 4)) * (15 + (random() * 485)))::numeric), 2) AS total_amount
        FROM raw_orders ro
        CROSS JOIN LATERAL generate_series(1, (1 + floor(random() * 5))::int) AS itm(seq)
        GROUP BY ro.id
    )
    INSERT INTO "orders" ("id", "customerName", "customerEmail", "amount", "status", "items", "createdAt", "updatedAt")
    SELECT
        ro.id,
        ro.fname || ' ' || ro.lname,
        lower(ro.fname) || '.' || lower(ro.lname) || ro.id || '@' || ro.dom,
        oia.total_amount,
        ro.stat,
        oia.items_json,
        ro.created_ts,
        ro.created_ts
    FROM raw_orders ro
    JOIN order_items_aggregate oia ON oia.order_id = ro.id;

    PERFORM setval(pg_get_serial_sequence('orders', 'id'), v_total_orders);
    RAISE NOTICE '50,000 orders successfully generated!';
END $$;

-- 6. Ensure Performance Indexes Exist
CREATE INDEX IF NOT EXISTS "orders_status_createdAt_idx" ON "orders"("status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "orders_status_amount_idx"    ON "orders"("status", "amount" DESC);
CREATE INDEX IF NOT EXISTS "orders_createdAt_idx"        ON "orders"("createdAt" DESC);
CREATE INDEX IF NOT EXISTS "orders_amount_idx"           ON "orders"("amount" DESC);

-- Trigram GIN indexes for fast fuzzy/substring search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "idx_orders_customer_name_trgm"  ON "orders" USING gin ("customerName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_orders_customer_email_trgm" ON "orders" USING gin ("customerEmail" gin_trgm_ops);

-- Update statistics for PostgreSQL query planner
ANALYZE "orders";

-- 7. Ensure Stored Procedure returns items JSON
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
    items JSONB,
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
        fo."items",
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

-- 8. Verification Output
SELECT
    to_char(count(*), 'FM999,999') AS total_orders,
    to_char(sum("amount"), 'FM$999,999,999.00') AS total_amount,
    (SELECT jsonb_pretty("items") FROM "orders" LIMIT 1) AS sample_order_items
FROM "orders";
