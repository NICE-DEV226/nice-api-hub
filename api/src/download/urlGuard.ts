import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { errors } from '../errors.js';

const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv6');
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true; // not an IP at all: refuse
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) must be judged as IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return PRIVATE.check(mapped[1]!, 'ipv4');
  return PRIVATE.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * SSRF guard for media URLs that came from a third party. Only http(s), and every address the
 * host resolves to must be public. (DNS rebinding between this check and the connection cannot
 * be excluded from inside the process: also deny private egress at the network level.)
 */
export async function assertPublicHttpUrl(raw: string, allowPrivate = false): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw errors.blockedUrl('The media URL is malformed.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw errors.blockedUrl('Only http(s) media URLs are allowed.');
  if (allowPrivate) return url;

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw errors.blockedUrl('The media host does not resolve.');
  if (addresses.some((a) => isPrivateAddress(a.address))) throw errors.blockedUrl('The media host resolves to a private address.');
  return url;
}
