// Basic per-IP limit. Memory is per server instance, so this slows casual abuse only;
// add Vercel Firewall rate limiting for stronger protection.
const hits = new Map();

export function tooMany(req, key, max, windowMs) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const id = key + ':' + ip;
  const now = Date.now();
  const list = (hits.get(id) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(id, list);
  if (hits.size > 5000) hits.clear();
  return list.length > max;
}
