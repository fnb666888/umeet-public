import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { remarkKnowledgeHeadings } from './knowledge-headings';
import { KnowledgeReference } from './KnowledgeReference';
// No raw HTML plugin. KaTeX does not trust author-provided URLs or HTML commands.
export function KnowledgeMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="knowledge-prose">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkMath, remarkKnowledgeHeadings]}
        rehypePlugins={[
          [
            rehypeKatex,
            { trust: false, strict: 'error', throwOnError: false, maxExpand: 1000, maxSize: 20 },
          ],
        ]}
        components={{
          a: ({ href, children }) => {
            const match = href && /^\/knowledge\/([a-zA-Z0-9_-]+)(?:#.*)?$/.exec(href);
            return match?.[1] ? (
              <KnowledgeReference pageId={match[1]} href={href!}>
                {children}
              </KnowledgeReference>
            ) : (
              <a href={href} rel="nofollow ugc noreferrer">
                {children}
              </a>
            );
          },
          img: ({ src, alt }) => (
            <img src={src} alt={alt ?? ''} loading="lazy" referrerPolicy="no-referrer" />
          ),
        }}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
