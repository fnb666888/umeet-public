# Community Interest V1 Implementation Plan

**Goal:** Implement the confirmed interest onboarding, transparent recommendations, polls, discover-only news and immutable daily forecasts with zero paid fallback.

**Architecture:** Add normalized MySQL tables, shared Zod contracts and focused Nest services under `modules/community-interest`. Use existing authentication, account context, governance and jobs conventions. Render new pages within the current community shell.

**Tech Stack:** Node 24, TypeScript, NestJS, Kysely/MySQL, Next.js/React, Vitest.

**Spec:** `docs/research/2026-11-14-umeet-v1-requirements-interview.md` and `docs/research/2026-11-14-umeet-v1-technical-design.md`.

## Global Constraints

- Zero new paid subscriptions; provider unavailable means explicitly paused forecasts.
- One new question per Shanghai business day at 08:00; published probability/reasoning never updated.
- Only discover news/forecast areas; existing shell and content remain.
- New interest boards never automatically followed; no rewrite of existing subscriptions.
- News at most five published cards per board/business day; deduplicate.
- Single-choice member polls, one current vote per account, no public voter identities.
- No wallet, tokens, chain transactions, general AI chat or translation features.

## Review Focus

- Preserve legacy user state and current account isolation across new endpoints.
- Freeze poll options concurrently with first vote; enforce deadlines with server time.
- Source fetches must reject private network addresses and unsafe redirects.
- Concurrent scheduler/publish operations must not exceed daily slots or news limits.
- Missing source/provider/permission must not appear as a successful forecast or fabricated data.

## Task 1: Contracts, migration and foundations

Files: `packages/contracts/src/interest.ts`, API migration `035_community_interest.ts`, database types and migration registry, `modules/community-interest/*`.

- [x] Define strict inputs and response types for preferences, polls, news, forecasts and sources.
- [x] Create normalized tables with unique business days, votes, deduplication and quota keys.
- [x] Seed four boards and required Wiki associations without subscribing users.
- [x] Add integration coverage for idempotence, existing state and member restrictions.

## Task 2: Preferences, recommendations and polls

Files: focused interest/poll services and controllers; `apps/api/test/interest.int.test.ts`.

- [x] Persist skipped/completed onboarding, explicit labels, followed boards and negative feedback.
- [x] Rank visible snapshot posts with explicit stable rule reasons; retain existing feeds.
- [x] Implement post-bound polls, deadline/option locking, vote updates and aggregate-only results.
- [x] Test simultaneous votes/edits, revoked content, cross-account behavior and limits.

## Task 3: News and interaction

Files: source fetcher, news service, discover interaction service and focused tests.

- [x] Implement guarded allowlisted JSON/RSS source adapters and configuration controls.
- [x] Persist source states, canonical IDs, deduplicated cards and atomic daily quotas.
- [x] Add paginated read/detail, comments, saved cards, follows and governance integration.
- [x] Test retries, private-address rejection, duplicate/cross-source items, quotas and visibility.

## Task 4: Forecast runtime

Files: forecast service, typed source/template/provider adapters, runtime and operations docs.

- [x] Implement Shanghai daily slots, template readiness, immutable publication, stored evidence and pause states.
- [x] Add bounded free-only provider configuration; validated evidence-backed outputs and usage reservations.
- [x] Implement source-specific resolution with manual review/void and auditable outcomes.
- [x] Test concurrent slots, immutable predictions, quota failures, restarts and resolution conflicts.

## Task 5: Web integration and management

Files: discover components, interest onboarding, polls, community routes/composer/post UI, API proxy and admin views.

- [x] Add boards/news/forecasts tabs with URL state, details and shared shell.
- [x] Add onboarding with skip, explicit interests, recommendation reasons and dislike feedback.
- [x] Add poll authoring/voting and news/forecast comment/save/follow actions.
- [x] Add administrator source/field/provider status, pause and resolution controls.
- [x] Test contracts and web interactions including account transitions and absent integrations.

## Task 6: Verify and deliver

- [x] Run typecheck, relevant integration/web tests and production builds.
- [x] Apply only reviewed additive migrations to local preview, restart and verify UI using CUA.
- [x] Request one independent whole-branch review and resolve actionable issues.
- [x] Commit tested implementation and document actual enabled/paused capabilities and operational prerequisites.

Execution: native implementation in this session; whole-branch review after integration. Existing user instruction authorizes execution of the confirmed plan.


## Verification record — 2026-11-15

- Checkpoint committed first: `d4c55ca`; implementation branch `codex/community-interest-v1`.
- Full suite: 57 files, 207 tests passed. Additional targeted runs passed after review and browser fixes.
- Typecheck and API/web production builds passed.
- Independent whole-branch review found four P2 issues; all fixed and targeted re-review found no remaining actionable P1/P2 findings. Later dynamic-board settings and nullable poll-response fixes were also independently reviewed.
- Browser verified the shared shell, real source cards, skip/reopen interests, saved action, all five saved accounts, administrator status, new AI-board posting and poll creation/first vote/frozen editing. Local test post moved recoverably to trash. Original active helper account restored.
- Preview additive migration preserved existing account/content/state records. Four public metadata sources configured and first fetch successful; no paid provider enabled.
- Running limitations and exact operator configuration: `docs/research/2026-11-15-community-interest-v1-operations.md`. GitHub release forecasting is the first resolver; other fields explicitly remain unready. No deployment or remote push.
