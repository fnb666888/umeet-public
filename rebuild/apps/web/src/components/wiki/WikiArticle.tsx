import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkWikiLinks from '../../../../../packages/markdown/src/remark-wiki-links';
export function WikiArticle({
  markdown,
  communitySlug,
}: {
  markdown: string;
  communitySlug: string;
}) {
  return (
    <div className="wiki-prose">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkMath, [remarkWikiLinks, { communitySlug }]]}
        rehypePlugins={[
          [
            rehypeKatex,
            { trust: false, strict: 'error', throwOnError: false, maxExpand: 1000, maxSize: 20 },
          ],
        ]}
        components={{
          a: ({ children, href }) => (
            <a href={href} rel="nofollow ugc noreferrer">
              {children}
            </a>
          ),
          img: ({ src, alt }) => (
            <img src={src} alt={alt || ''} loading="lazy" referrerPolicy="no-referrer" />
          ),
        }}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
