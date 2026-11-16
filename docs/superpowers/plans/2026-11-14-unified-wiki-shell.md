# Unified Wiki Shell Implementation Plan

**Goal:** Keep the community header, navigation, subscriptions and account controls unchanged while visiting Wiki; remove the marked empty-result reset control from administration.

**Architecture:** Render knowledge routes inside the existing CommunityApplication shell with an optional content slot. Use the shared community providers for navigation and account state. Keep /knowledge as the single Wiki homepage and redirect the former hash homepage to it, retaining compatibility for existing article links.

**Tech Stack:** Next.js, React, TypeScript, existing CSS and Vitest.

**Spec:** User browser comments 1–4 in this chat, 2026-11-14.

## Constraints

- Preserve existing Wiki articles, editors, governance, learning routes and data.
- Keep community search, notifications, avatar menu, subscription order and mobile navigation.
- Do not expose separate new/old Wiki entry points.
- Remove the reset button from content and user management empty states; retain the filters and empty-state message.

## Review Focus

- Header/sidebar markup must match community pages, including on article and editing routes.
- Community links on native knowledge URLs must return to the root hash routes.
- Former Wiki homepage and board Wiki hash URLs must resolve to canonical knowledge pages.
- Narrow screens must use the community menu; knowledge CSS must not restyle the shared shell.
- Removing the administrative reset control must not affect search or status filters.

## Tasks

- [x] Add an optional content slot to CommunityApplication and use it for knowledge routes.
- [x] Normalize shared shell links and handle hash navigation from native routes.
- [x] Merge former Wiki home navigation into /knowledge and remove old/new explanatory UI.
- [x] Remove the administration reset control and its unused CSS.
- [x] Add focused shell regression coverage; run type checks and relevant web tests.
- [x] Verify community, Wiki index/article, legacy index redirect and administration in the browser.
