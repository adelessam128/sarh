# Architecture & Design Decisions

## 1. R2 — Order Creation and Idempotency

**Decision:** Use a client-generated `Idempotency-Key`, a server-computed SHA-256 hash of the normalized request payload, and database-enforced uniqueness. Requests using the same key and payload must not create multiple orders; reusing a key with a different payload must be rejected.

The order creation and idempotency record are handled transactionally so a failed transaction does not leave a successfully committed order without its associated idempotency state. Concurrent requests are handled through database uniqueness and transaction behavior rather than relying on the UI to prevent duplicate submissions.

**Alternative considered:** Disable the submit button and ignore repeated clicks in React. I rejected this because retries, timeouts, refreshes, and concurrent requests can bypass client-side protection.

**Trade-off and limitation:** Idempotency records require a retention policy. Expiring a key too early can allow a delayed retry to create another order, so retention must be chosen according to the business risk and retry window. The parallel-request test verifies that concurrent requests using the same key create exactly one order.

## 2. R1 — Pagination and Large-List Rendering

**Decision:** Apply search, filtering, sorting, and pagination on the server, and use TanStack Virtual to limit the number of rendered rows. This avoids transferring the entire dataset to the browser and reduces DOM rendering work.

Database indexes support the common search and filtering/sorting patterns. Query performance should be evaluated using execution plans and representative data rather than assuming that every index improves every query.

**Alternative considered:** Load all orders and filter or paginate them in React. I rejected this because downloading and processing tens of thousands of records wastes bandwidth and browser resources.

**Trade-off and limitation:** Offset pagination is straightforward and supports page-number navigation, but deep offsets can become expensive. If measurements show this is a problem, I would evaluate cursor pagination while preserving the required sorting and filtering behavior.

## 3. Frontend State Management

**Decision:** Keep transient interface state close to the components that use it, and keep authentication state available to the UI for rendering signed-in and role-specific views. The backend remains responsible for authentication and authorization.

**Alternative considered:** Introduce a global state-management library for all application state. I rejected this because the current application is small enough that the additional abstraction may not justify its maintenance cost.

**Trade-off and limitation:** Local state can become difficult to coordinate as shared workflows grow. If the application develops more complex cross-page state or server-data caching requirements, I would reassess the state-management approach rather than adding a library prematurely.

## AI Tool Disclosure

I used AI assistance to compare pagination and frontend state-management approaches, understand idempotency guarantees and their limitations, and improve my understanding of concurrency and retry behavior. I reviewed the suggested approaches against the assignment requirements and the implementation.
