# Orders Console — SARH Technical Assessment

A full-stack order management application built for SARH Business Solutions. It helps operations teams search, filter, sort, and create orders while remaining responsive with 50,000+ records and preventing duplicate order creation.

## Features

### R1 — Large Orders List

- Search orders by customer name or email.
- Filter orders by status.
- Sort orders by creation date or total amount.
- Use server-side pagination to retrieve only the requested page.
- Use TanStack Virtual to render only the visible rows and nearby rows.
- Add database indexes to support search, filtering, and sorting.

**Correctness under rapid filtering:** The application must ensure that a slower, earlier request cannot overwrite the results of a newer filter selection. The implementation should be verified by changing the filter several times quickly and confirming that the displayed results match the latest selection.

### R2 — Create Orders Without Duplicates

- Create orders with customer details and 1–5 line items.
- Validate the submitted data on both the client and server.
- Generate an idempotency key for each logical create operation.
- Hash the request payload and use a database transaction and a unique constraint on the idempotency key to prevent duplicate creation.
- Return the original result when the same key and payload are replayed.

Run the parallel-request test to verify that two simultaneous requests using the same idempotency key produce exactly one order.

See [DECISIONS.md](DECISIONS.md) for the design rationale and limitations.

### R3 — Authentication and Security Review

The contractor's authentication implementation was reviewed, and the following issues were identified:

| Problem | Fix |
|---|---|
| Hardcoded JWT secret | Load the secret from environment configuration. |
| `jwt.decode()` used without signature verification | Verify the token's signature and validate its claims before accepting it. |
| Token accepted from the query string | Accept bearer tokens through the `Authorization` header instead. |
| No explicit token-expiration policy | Configure and validate token expiration. |
| Plain-text password storage and comparison | Store password hashes and verify credentials using a password-hashing library. |
| Admin authorization enforced only in React | Enforce role-based authorization on the server before deleting an order. |
| Unrestricted or insufficiently validated request data | Validate authentication inputs and handle invalid requests safely. |

The API protects order routes with authentication and applies role-based authorization to restricted operations.

**Seeded test accounts**

| Role | Email | Password |
|---|---|---|
| Admin | `admin@sarh.com` | `AdminPass123!` |
| Agent | `agent@sarh.com` | `AgentPass123!` |

These credentials are for local development and testing only.

**Token storage**

The client stores the JWT and user profile in `localStorage`, allowing the session to persist across page reloads. This storage is accessible to JavaScript, so an XSS vulnerability could expose the token; it does not protect against XSS. It also does not replace server-side authorization.

### Order Actions

- **Cancel order:** `PATCH /api/orders/:id/cancel` — available to authenticated Admin and Agent users.
- **Delete order:** `DELETE /api/orders/:id` — restricted to Admin users, with authorization enforced by the backend.

## Database and Performance

**Database:** PostgreSQL, accessed through Prisma.

### Indexing

The database migration adds:

- Trigram GIN indexes for customer-name and customer-email substring searches.
- Composite indexes for status filtering combined with creation-date or amount sorting.
- Indexes for sorting by creation date and amount.

These indexes are intended to reduce the work required by common list queries. Actual performance depends on the query plan and data distribution.

Migration: `server/prisma/migrations/init_orders/migration.sql`

### Pagination and Rendering

The backend returns a single requested page and its matching total count instead of sending the full orders table to the browser. The frontend uses TanStack Virtual to reduce DOM rendering work.

This combines database-level pagination with frontend virtualization; virtualization alone would not prevent the browser from downloading the entire dataset.

## Requirements

- Node.js and npm
- PostgreSQL
- Environment configuration for the database and application secrets

All services are intended to run locally without paid or hosted dependencies.

## Getting Started

### 1. Configure environment variables

Create `server/.env` using the provided `.env.example` as a template.

Configure the PostgreSQL connection string and the required authentication secrets. Do not commit `.env` or real secrets to source control.

Example database URL:

`DATABASE_URL="postgresql://postgres:password@localhost:5432/sarh_db?schema=public"`

Use your own local database credentials.

### 2. Install dependencies

From the repository root, install the project dependencies using the repository's package scripts and workspace structure.

If the frontend and backend have separate package manifests, install dependencies in each directory.

### 3. Apply database migrations

From the directory where the migration script is defined, run:

`npm run prisma:migrate`

### 4. Seed the database

Run:

`npm run seed`

This seeds at least 50,000 orders with customer details, statuses, amounts, creation dates, and line items.

Alternatively, use **Seed 50,000 Orders** in the UI if that action is enabled.

### 5. Start the application

Start the backend:

`npm run dev:server`

Start the frontend in a separate terminal:

`npm run dev:client`

Open [http://localhost:5173](http://localhost:5173).

> Run each command from the directory where its corresponding npm script is defined. Adjust the commands above if the repository uses a different workspace configuration.

## Verification

### R1 — Rapid Filter Changes

1. Open the orders list with the seeded dataset.
2. Change the status filter several times in quick succession.
3. Confirm that the final results correspond to the latest selection, even if earlier requests finish later.
4. Repeat with search and sorting where applicable.

**Expected result:** An outdated response must never replace the results for the current filters.

### R2 — Parallel Idempotency Test

Run:

`npm run test:idempotency`

The test sends two simultaneous create requests with the same idempotency key and verifies that exactly one order is created.

A replay of a successfully processed request returns `201 Created` with `X-Idempotent-Replay: true`.

See `DECISIONS.md` for the chosen behavior when a key is reused with a different payload.

### Submission Evidence

Include a short screen recording or three screenshots showing:

1. The large orders list and rapid-filter test.
2. Order creation and the parallel idempotency test proving that only one order exists.
3. Any additional relevant behavior you want reviewers to see.

## Product Question — "Delete All Cancelled Orders"

Before implementing this action, I would ask whether the goal is to remove cancelled orders from the normal workflow or permanently erase them, and whether any retention, audit, refund, or reporting requirements apply. If the requirement remains unclear, I would propose hiding cancelled orders from the default list while retaining them for authorized users and future audits, rather than permanently deleting business records.

## What I Skipped and Why

- **Optional O1 — Slow stats API:** I ran out of time .
- **Optional O2 — Optimistic create:** I ran out of time.
- **Senior design memo:** See `SCALE.md`.


## Project Structure

```text
.
├── client/                 # React application
├── server/                 # Node.js API
│   └── prisma/
│       └── migrations/     # Database migrations
├── DECISIONS.md            # Design decisions and AI disclosure
├── SCALE.md                # Senior-only design memo
└── README.md
```

## Additional Documentation

- [`DECISIONS.md`](DECISIONS.md) — design decisions, alternatives considered, idempotency limitations, and AI-tool disclosure.
- [`SCALE.md`](SCALE.md) — senior-only design memo for scaling to five million orders and a multi-country team.
