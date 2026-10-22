# SCALE.md — Scaling the Orders Console

## What I Would Keep

I would keep the modular monolith and PostgreSQL initially. With five million orders and a team of three developers, introducing microservices would add deployment, networking, observability, and failure-handling costs before we know whether those costs are justified.

I would also keep server-side filtering, sorting, pagination, and database-enforced idempotency. These address the core problems of large datasets and duplicate creation without requiring a distributed architecture.

## What I Would Change

**Database and queries:** I would measure latency for the most common queries, inspect execution plans, and review index usage with representative data. I would monitor slow queries, connection-pool utilization, database load, and the cost of maintaining indexes during writes. I would evaluate cursor pagination if deep offset pages become expensive, while preserving deterministic ordering.

**Multi-country access:** I would serve static assets through a CDN and measure API latency from both countries. I would store timestamps consistently in UTC and convert them to the agent's intended time zone in the UI. I would not introduce multi-region database writes without a demonstrated availability or latency requirement and a clear consistency strategy.

**Background processing:** I would use an outbox and background workers for non-critical asynchronous work, such as notifications and integrations, when the need arises. The order and its outbox event would be committed in one database transaction. Workers could publish events and retry failures, while consumers would be designed to tolerate duplicate delivery.

**Observability and recovery:** I would add structured logs, request IDs, latency and error metrics, distributed tracing where useful, and alerts for database saturation and elevated failure rates. I would also test backup restoration and recovery procedures rather than relying on backup creation alone.


## How I Would Decide What Comes Next

I would prioritize changes using production measurements: query latency, error rates, database utilization, and user-perceived response times.
