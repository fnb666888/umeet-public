export function recordLink(value: string): { title: string; href: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('title' in parsed) ||
    !('href' in parsed) ||
    typeof parsed.title !== 'string' ||
    typeof parsed.href !== 'string' ||
    !parsed.title.trim() ||
    !/^\/(wiki|p|posts)\/[a-zA-Z0-9-]+$/.test(parsed.href)
  )
    return null;
  return { title: parsed.title, href: parsed.href };
}
