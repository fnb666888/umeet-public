# Umeet · Turn conversations into shared knowledge

[简体中文](README.md) · [Contribute](CONTRIBUTING.md) · [Issues](https://github.com/fnb666888/umeet-public/issues) · [0BSD](LICENSE)

**An open source community for students and interest groups, connecting discussion, mutual help, shared knowledge, and governance.**

A useful answer should live longer than a feed. Umeet helps people find peers and start conversations, then turn experience into collaboratively maintained wikis and learning paths. From study groups to campus clubs, help us explore what a community can become.

## What we are building

- Discussion: boards, posts, replies, search, and personal records.
- Knowledge collaboration: wikis, Markdown and math editing, revisions, diffs, and review.
- Governance: reports, permissions, member management, and administration.
- Identity and messaging: guest/member identities, sessions, account switching, and sign-in methods.
- Exploration: interest discovery, news, and AI-assisted forecasting, requiring your own external service configuration.

The project is under active development. Existing code and tests do not imply full production validation. Real WeChat devices, email/SMS providers, external AI, and deployment environments require separate verification.

## Code map

**`rebuild/` is the main development area** for the current website and API: Next.js / React, NestJS, MySQL, Kysely, and TypeScript. The WeChat mini program lives in `apps/miniprogram/`. The root Vue admin and API are earlier implementations with separate commands and database settings.

| Directory | Contents |
| --- | --- |
| `rebuild/apps/web/` | Website and administration |
| `rebuild/apps/api/` | API, identity, governance, background jobs |
| `rebuild/packages/` | Shared contracts and Markdown tools |
| `rebuild/tests/` | Browser flow verification |
| `apps/miniprogram/` | Native TypeScript WeChat mini program |
| `makers-agent/` | Experimental AI agent module |
| `rebuild/deploy/` | Deployment templates |

## Run locally

Requirements: Node.js 24, npm, and Docker. This database is for local development and binds to loopback only.

```bash
git clone https://github.com/fnb666888/umeet-public.git
cd umeet-public/rebuild
npm ci
docker run --name umeet-dev-mysql -e MYSQL_ALLOW_EMPTY_PASSWORD=yes -p 127.0.0.1:19316:3306 -d mysql:8.0
```

Wait for MySQL to become ready. Copy `.env.example` to `.env` in the current directory, then run:

```bash
npx tsx scripts/prepare-local.ts
node --env-file=.env --import tsx apps/api/src/main.ts
```

In another terminal, from `rebuild/`, start the website:

```bash
node --env-file=.env node_modules/next/dist/bin/next dev apps/web --hostname 127.0.0.1 --port 5178
```

Open <http://127.0.0.1:5178>. The API runs at `http://127.0.0.1:3188`. Email and SMS are disabled by default; registration requires a delivery provider. See the [authentication guide](rebuild/docs/operations/authentication.md). Keep development databases off the public internet.

For the mini program, run `npm ci` and `npm run build --workspace=@umeet/miniprogram` from the repository root. Set your own AppID and open the repository root in WeChat DevTools. Development builds use local `5178/api/mobile`; physical devices need a reachable address. Before release, replace the example production domain in `apps/miniprogram/src/config.ts` and configure WeChat domain allowlists.

## Build it with us

You do not need to understand the entire codebase. Start with a confusing page, a missing setup step, or a small reproducible issue.

- Users and organizers: share workflows, collaboration problems, and knowledge worth preserving.
- Designers and writers: improve mobile interaction, accessibility, copy, documentation, and translation.
- Developers: fix bugs, test permission boundaries, improve navigation and performance, or verify deployment and integrations.

Browse [Issues](https://github.com/fnb666888/umeet-public/issues) or open one with your idea. Discuss larger features and scope first; small fixes can go straight to a PR. See [CONTRIBUTING.md](CONTRIBUTING.md).

Useful starting areas include reproducible setup, account and permission boundaries, knowledge collaboration, mobile accessibility, and verified deployment documentation. These are invitations to contribute, rather than delivery commitments.

## Checks and tests

From `rebuild/`, run `npm run check`, `npm run build:api`, and `npm run build:web`. API integration tests require a separate local MySQL test database, defaulting to `127.0.0.1:19316/umeet_rebuild_test`. `TEST_MYSQL_URL` can select another database that passes safety checks. Never use production data. See [rebuild/README.md](rebuild/README.md) for details.

## Public snapshot and license

This sanitized snapshot excludes the original private Git history, production credentials, runtime data, and screenshots. Domains, AppIDs, and resource identifiers are examples. Production Secrets and release activation were not transferred.

Original code uses [0BSD](LICENSE): you may use, modify, redistribute, and commercialize it without attribution or publishing your changes. Third-party dependencies and assets retain their own licenses; existing Lucide license files are preserved. Original contributions use the same license.
