import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request } from 'node:https';

const privateNetworks = new BlockList();
for (const [ip, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['192.0.2.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  privateNetworks.addSubnet(ip, prefix, 'ipv4');
export function isPublicAddress(ip: string) {
  if (isIP(ip) === 4) return !privateNetworks.check(ip, 'ipv4');
  if (isIP(ip) === 6) {
    const first = Number.parseInt(ip.split(':')[0] || '0', 16);
    return first >= 0x2000 && first <= 0x3fff && !ip.toLowerCase().startsWith('2001:db8:');
  }
  return false;
}
export function sourceHosts(env: NodeJS.ProcessEnv = process.env) {
  return new Set([
    'api.github.com',
    ...(env.INTEREST_SOURCE_HOSTS || '')
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  ]);
}
export function validateSourceUrl(raw: string, hosts = sourceHosts()) {
  const url = new URL(raw);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    isIP(url.hostname) ||
    !hosts.has(url.hostname.toLowerCase())
  )
    throw new Error('SOURCE_HOST_NOT_ALLOWED');
  return url;
}
export type SourceResponse = { value: unknown; etag: string | null; notModified: boolean };
export type SourceFetcher = (url: string, etag?: string | null) => Promise<SourceResponse>;
export const fetchSource: SourceFetcher = async (raw, etag) => {
  let url = validateSourceUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
      throw new Error('SOURCE_ADDRESS_NOT_PUBLIC');
    const address = addresses[0]!;
    const result = await new Promise<{
      status: number;
      headers: Record<string, string | string[] | undefined>;
      body: string;
    }>((resolve, reject) => {
      // Pin the validated address while retaining original TLS server identity and Host.
      const req = request(
        {
          hostname: address.address,
          family: address.family,
          servername: url.hostname,
          port: 443,
          path: url.pathname + url.search,
          method: 'GET',
          agent: false,
          headers: {
            Host: url.hostname,
            'User-Agent': 'Umeet-Community/1.0',
            Accept:
              'application/json, application/feed+json, application/rss+xml, application/atom+xml',
            'Accept-Encoding': 'identity',
            ...(etag ? { 'If-None-Match': etag } : {}),
          },
        },
        (res) => {
          const buffers: Buffer[] = [];
          let bytes = 0;
          res.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 1_000_000) {
              res.destroy(new Error('SOURCE_RESPONSE_TOO_LARGE'));
              return;
            }
            buffers.push(chunk);
          });
          res.on('error', reject);
          res.on('end', () =>
            resolve({
              status: res.statusCode || 0,
              headers: res.headers,
              body: Buffer.concat(buffers).toString('utf8'),
            }),
          );
        },
      );
      req.setTimeout(10000, () => req.destroy(new Error('SOURCE_TIMEOUT')));
      req.on('error', reject);
      req.end();
    });
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      if (typeof result.headers.location !== 'string') throw new Error('SOURCE_REDIRECT_INVALID');
      url = validateSourceUrl(new URL(result.headers.location, url).href);
      continue;
    }
    const nextEtag =
      typeof result.headers.etag === 'string' ? result.headers.etag.slice(0, 300) : null;
    if (result.status === 304)
      return { value: null, etag: nextEtag || etag || null, notModified: true };
    if (result.status !== 200) throw new Error('SOURCE_HTTP_' + result.status);
    const contentType = String(result.headers['content-type'] || '').toLowerCase();
    if (!contentType.includes('json') && !contentType.includes('xml'))
      throw new Error('SOURCE_FORMAT_INVALID');
    return {
      value: contentType.includes('json') ? JSON.parse(result.body) : result.body,
      etag: nextEtag,
      notModified: false,
    };
  }
  throw new Error('SOURCE_REDIRECT_LIMIT');
};
export function canonicalUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('INVALID_ARTICLE_URL');
  if (url.username || url.password || isIP(url.hostname) || url.hostname === 'localhost')
    throw new Error('INVALID_ARTICLE_URL');
  url.hash = '';
  for (const key of [...url.searchParams.keys()])
    if (/^utm_/i.test(key) || ['fbclid', 'gclid'].includes(key)) url.searchParams.delete(key);
  return url.href;
}
export function plainSource(value: unknown, max: number) {
  return typeof value === 'string'
    ? value
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : '';
}
