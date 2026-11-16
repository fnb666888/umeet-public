import { parseMarkdown } from './parse.ts';
export function normalizeMarkdown(source: string): unknown {
  function clean(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => key !== 'position')
          .map(([key, value]) => [key, clean(value)]),
      );
    return value;
  }
  return clean(parseMarkdown(source));
}
