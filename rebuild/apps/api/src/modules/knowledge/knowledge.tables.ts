import type { Generated } from 'kysely';
export interface KnowledgeTables {
  knowledge_links: { revision_id: string; source_page_id: string; target_page_id: string };
  knowledge_locks: { id: string; version: number };
  knowledge_pages: {
    id: string;
    current_revision_id: string | null;
    hidden: Generated<number>;
    paused: Generated<number>;
    purged: Generated<number>;
    creator_id: string;
    created_at: Date;
  };
  knowledge_revisions: {
    id: string;
    page_id: string;
    author_id: string;
    title: string;
    summary: string;
    markdown: string;
    template: string;
    relations: string;
    change_note: string;
    base_revision_id: string | null;
    idempotency_key: string;
    request_hash: string;
    created_at: Date;
  };
  knowledge_proposals: {
    id: string;
    page_id: string;
    author_id: string;
    state: string;
    reason: string;
    payload: string;
    idempotency_key: string;
    request_hash: string;
    version: number;
    created_at: Date;
  };
  knowledge_drafts: {
    id: string;
    owner_id: string;
    editing_task_id: string;
    page_id: string | null;
    payload: string;
    version: number;
    updated_at: Date;
  };
  knowledge_aliases: { page_id: string; name: string };
  knowledge_revision_relations: {
    revision_id: string;
    source_page_id: string;
    target_page_id: string;
    kind: string;
    conditions: string;
    explanation: string;
    evidence: string;
  };
  knowledge_spaces: { community_id: string; version: number };
  knowledge_collections: { community_id: string; page_id: string };
  knowledge_directory_nodes: {
    id: string;
    community_id: string;
    parent_id: string | null;
    title: string;
    position: number;
  };
  knowledge_directory_entries: {
    community_id: string;
    node_id: string;
    page_id: string;
    position: number;
  };
  knowledge_organization_proposals: {
    id: string;
    community_id: string;
    author_id: string;
    kind: string;
    payload: string;
    state: string;
    reason: string;
    created_at: Date;
  };
  knowledge_routes: {
    id: string;
    community_id: string;
    title: string;
    goal: string;
    version: number;
    updated_at: Date;
  };
  knowledge_route_revisions: {
    id: string;
    route_id: string;
    author_id: string;
    payload: string;
    created_at: Date;
  };
  knowledge_route_steps: {
    id: string;
    route_id: string;
    page_id: string;
    goal: string;
    intro: string;
    position: number;
    confirmed_revision_id: string | null;
  };
  knowledge_disputes: {
    id: string;
    page_id: string;
    author_id: string;
    reason: string;
    state: string;
    created_at: Date;
  };
  knowledge_events: {
    id: string;
    page_id: string | null;
    actor_id: string;
    action: string;
    reason: string;
    created_at: Date;
  };
  knowledge_notification_outbox: {
    id: string;
    route_id: string;
    page_id: string;
    revision_id: string;
    delivered: Generated<number>;
    created_at: Date;
  };
  knowledge_discussions: {
    id: string;
    page_id: string;
    author_id: string;
    body: string;
    created_at: Date;
  };
}
