import { describe, it, expect } from 'vitest';
import {
  KnowledgeRelationSchema,
  KnowledgeRevisionSchema,
  KnowledgeDraftSchema,
  relationKinds,
} from '../src/knowledge.js';
describe('knowledge contracts', () => {
  it('fixes the four meanings and versions body and relations together', () => {
    expect(relationKinds).toEqual(['prerequisite', 'approximation_of', 'applied_to', 'related']);
    expect(KnowledgeRelationSchema.safeParse({ type: 'invented', targetPageId: 'x' }).success).toBe(
      false,
    );
    expect(
      KnowledgeRevisionSchema.safeParse({
        title: '校园卡补办',
        summary: '步骤',
        markdown: '# 材料',
        template: 'handbook',
        relations: [],
        baseRevisionId: null,
        changeNote: '初稿',
        idempotencyKey: 'create-001',
      }).success,
    ).toBe(true);
  });
  it('does not accept forged draft ownership or unbounded input', () => {
    expect(
      KnowledgeDraftSchema.safeParse({
        editingTaskId: 'new',
        expectedVersion: 0,
        ownerId: 'other',
        content: {},
      }).success,
    ).toBe(false);
    expect(KnowledgeRelationSchema.safeParse({ type: 'related', targetPageId: '' }).success).toBe(
      false,
    );
  });
});
