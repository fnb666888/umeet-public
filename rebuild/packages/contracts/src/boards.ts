export const legacyBoardCommunities: Record<string, string> = {
  daily: 'campus',
  questions: 'questions',
  market: 'market',
  treehole: 'hollow',
  buddies: 'activities',
  resources: 'resources',
};

export function communitySlug(board: string): string {
  return legacyBoardCommunities[board] ?? board;
}

export function boardSlug(community: string): string {
  return (
    Object.keys(legacyBoardCommunities).find(
      (board) => legacyBoardCommunities[board] === community,
    ) ?? community
  );
}

export type BoardSummary = {
  id: string;
  slug: string;
  name: string;
  description: string;
  rules: string[];
  state: 'open' | 'closed';
  moderatorId?: string | null;
};
