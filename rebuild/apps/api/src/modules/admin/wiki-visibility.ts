import type { DemoWiki } from '../demo/demo.schema.js';

export function publicWiki(wiki: DemoWiki): DemoWiki {
  return {
    ...wiki,
    history: wiki.history.map((entry, index) => {
      const revision = wiki.revisions - index;
      if (wiki.hiddenRevisions?.includes(revision))
        return {
          at: entry['at'],
          reason: '敏感修订已隐藏',
          author: '已隐藏',
          before: {},
          after: {},
          hidden: true,
        };
      if (wiki.hiddenRevisions?.includes(revision - 1)) return { ...entry, before: {} };
      return entry;
    }),
  };
}
