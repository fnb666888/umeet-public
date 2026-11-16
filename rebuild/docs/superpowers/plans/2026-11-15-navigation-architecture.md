# Unified navigation and resource architecture

Goal: preserve identity and useful content across routes, give every client module one read lifecycle, remove duplicate initialization and measure route readiness under realistic transitions.

Completed and deployed. Measured boundaries are recorded in docs/operations/navigation-architecture-2026-11-15.md. Authenticated community full-snapshot pagination remains future work; this release unifies its navigation lifetime and resource invalidation. Some business forms retain local state over the shared transport. Production authenticated flows were validated with QA fixtures locally.

Architecture: retain Next/Nest/MySQL and current business contracts. Introduce one account-scoped resource service and hook, one bounded intent prefetch scheduler/route registry, and one persistent community provider at the root. Canonical community routes use /community/... with legacy hashes supported. Public first-paint reads avoid the full account snapshot. Authorization and all writes continue to run on the server.

Alternatives considered: a complete framework rewrite would repeat business logic and increase regression risk; adding per-page caches preserves today's inconsistency. The shared layer with compatible route migration is the implementation choice under the user's direct refactor authorization.

Constraints: no credentials or private data in persistent browser storage; memory entries scoped by device/account/version; no shared server cache of authenticated responses; no paid infrastructure/schema migrations; preserve unsaved drafts, query parameters, reply anchors, back/forward and old URLs. Retain current unrelated working tree changes. No speculative claim of instant cold network reads.

Review focus: identity switches during in-flight reads; permission loss after cached display; writes invalidating another module; stale refresh failures retaining content only for transient failures; new URLs with old hash actions; public HTML containing no private fields.

- [x] Build resource client with canonical keys, shared pending reads, bounded memory, subscriptions, domain invalidation and safe stale refresh. Test cancellation, writes, errors, identity and mounted consumers.
- [x] Migrate admin, Wiki, interest, community governance, account and governance reads to the client and shared hook, keeping business error messages and sensitive-read policies.
- [x] Centralize route preparation with two background slots, intent priority and cancellation of queued work after identity changes; remove scattered eager prefetch loops.
- [x] Persist community state across native pages; introduce canonical community route adapter and keep old hash/bookmark behavior. Test server entry and cross-route/browser history.
- [x] Decouple public first paint from account snapshot construction; verify hidden content, authored names and bootstrap payload limits with API tests.
- [x] Run frontend/type/API checks, production build, route readiness and click regression including slow reads/identity; record failures as failures. Deploy isolated release, health/authorization/public navigation checks and document boundaries.
