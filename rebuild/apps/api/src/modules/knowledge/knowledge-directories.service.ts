import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  KnowledgeDirectoryChangeSchema,
  type KnowledgeDirectoryChange,
  type KnowledgeCommunity,
} from '../../../../../packages/contracts/src/knowledge.js';
import type { RequestContext } from '../../../../../packages/contracts/src/index.js';
import { type KnowledgeDb, knowledgeWrite, conflict, event } from './knowledge-core.js';
import { KnowledgeAccess } from './knowledge-access.js';
import { KnowledgeReadService } from './knowledge-read.service.js';
export class KnowledgeDirectoriesService {
  constructor(private readonly db: KnowledgeDb) {}
  async community(slugOrId: string): Promise<KnowledgeCommunity> {
    const c = await this.db
      .selectFrom('communities')
      .select(['id', 'slug', 'name'])
      .where((eb) => eb.or([eb('id', '=', slugOrId), eb('slug', '=', slugOrId)]))
      .executeTakeFirst();
    if (!c) throw new NotFoundException('COMMUNITY_NOT_FOUND');
    const [space, nodes, entries, collections] = await Promise.all([
      this.db
        .selectFrom('knowledge_spaces')
        .selectAll()
        .where('community_id', '=', c.id)
        .executeTakeFirst(),
      this.db
        .selectFrom('knowledge_directory_nodes')
        .select(['id', 'parent_id as parentId', 'title', 'position'])
        .where('community_id', '=', c.id)
        .orderBy('position')
        .execute(),
      this.db
        .selectFrom('knowledge_directory_entries')
        .select(['node_id as nodeId', 'page_id as pageId', 'position'])
        .where('community_id', '=', c.id)
        .orderBy('position')
        .execute(),
      this.db
        .selectFrom('knowledge_collections')
        .select('page_id as pageId')
        .where('community_id', '=', c.id)
        .execute(),
    ]);
    const read = new KnowledgeReadService(this.db);
    const titles = new Map<string, { title: string; available: boolean }>();
    for (const id of new Set([...collections, ...entries].map((r) => r.pageId))) {
      const p = await read.readPublished(id);
      titles.set(id, { title: p?.title ?? '词条不可用', available: !!p });
    }
    return {
      ...c,
      version: space?.version ?? 0,
      nodes,
      entries: entries.map((e) => ({ ...e, ...titles.get(e.pageId)! })),
      collections: collections.map((e) => ({ ...e, ...titles.get(e.pageId)! })),
    };
  }
  async apply(ctx: RequestContext, communityId: string, raw: KnowledgeDirectoryChange) {
    const input = KnowledgeDirectoryChangeSchema.parse(raw);
    return knowledgeWrite(this.db, (tx) =>
      new KnowledgeDirectoriesService(tx).applyIn(ctx, communityId, input),
    );
  }
  async applyIn(ctx: RequestContext, communityId: string, input: KnowledgeDirectoryChange) {
    await new KnowledgeAccess(this.db).assertCommunityOrganizer(ctx, communityId);
    await this.community(communityId);
    const old = await this.db
      .selectFrom('knowledge_spaces')
      .select('version')
      .where('community_id', '=', communityId)
      .executeTakeFirst();
    if ((old?.version ?? 0) !== input.expectedVersion) conflict('ORGANIZATION_CONFLICT');
    const nodeMap = new Map(input.nodes.map((n) => [n.id, n]));
    if (
      nodeMap.size !== input.nodes.length ||
      new Set(input.collections).size !== input.collections.length
    )
      throw new BadRequestException('DUPLICATE_DIRECTORY_ITEM');
    for (const n of input.nodes) {
      const visited = new Set<string>([n.id]);
      let parent = n.parentId;
      while (parent) {
        if (visited.has(parent)) throw new BadRequestException('DIRECTORY_CYCLE');
        visited.add(parent);
        const ancestor = nodeMap.get(parent);
        if (!ancestor) throw new BadRequestException('DIRECTORY_PARENT_NOT_FOUND');
        parent = ancestor.parentId;
      }
    }
    const existing = await this.db
      .selectFrom('knowledge_collections')
      .select('page_id')
      .where('community_id', '=', communityId)
      .execute();
    const existingIds = new Set(existing.map((r) => r.page_id));
    for (const id of input.collections) {
      const p = await this.db
        .selectFrom('knowledge_pages')
        .select(['current_revision_id', 'hidden', 'purged'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!p?.current_revision_id || p.purged || (p.hidden && !existingIds.has(id)))
        throw new BadRequestException('COLLECTION_TARGET_UNAVAILABLE');
    }
    const entries = new Set<string>();
    for (const e of input.entries) {
      const key = e.nodeId + ':' + e.pageId;
      if (!nodeMap.has(e.nodeId) || !input.collections.includes(e.pageId) || entries.has(key))
        throw new BadRequestException('INVALID_DIRECTORY_ENTRY');
      entries.add(key);
    }
    const foreignNodes = input.nodes.length
      ? await this.db
          .selectFrom('knowledge_directory_nodes')
          .select('id')
          .where(
            'id',
            'in',
            input.nodes.map((n) => n.id),
          )
          .where('community_id', '!=', communityId)
          .execute()
      : [];
    if (foreignNodes.length) throw new BadRequestException('DIRECTORY_ID_UNAVAILABLE');
    await this.db
      .deleteFrom('knowledge_directory_entries')
      .where('community_id', '=', communityId)
      .execute();
    await this.db
      .deleteFrom('knowledge_directory_nodes')
      .where('community_id', '=', communityId)
      .execute();
    await this.db
      .deleteFrom('knowledge_collections')
      .where('community_id', '=', communityId)
      .execute();
    if (input.collections.length)
      await this.db
        .insertInto('knowledge_collections')
        .values(input.collections.map((page_id) => ({ community_id: communityId, page_id })))
        .execute();
    if (input.nodes.length)
      await this.db
        .insertInto('knowledge_directory_nodes')
        .values(
          input.nodes.map((n) => ({
            id: n.id,
            community_id: communityId,
            parent_id: n.parentId,
            title: n.title,
            position: n.position,
          })),
        )
        .execute();
    if (input.entries.length)
      await this.db
        .insertInto('knowledge_directory_entries')
        .values(
          input.entries.map((e) => ({
            community_id: communityId,
            node_id: e.nodeId,
            page_id: e.pageId,
            position: e.position,
          })),
        )
        .execute();
    const version = input.expectedVersion + 1;
    await this.db
      .insertInto('knowledge_spaces')
      .values({ community_id: communityId, version })
      .onDuplicateKeyUpdate({ version })
      .execute();
    await event(this.db, ctx, null, 'directory', JSON.stringify({ communityId, input }));
    return { version };
  }
}
