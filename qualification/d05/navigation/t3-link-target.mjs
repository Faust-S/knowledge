// Navigation audit only. Resolve the actual browser href, not an inferred route.
export function pagePath(path) {
  if (path.endsWith('/index.html')) return path.slice(0, -'index.html'.length);
  return path.endsWith('/') || path.endsWith('.html') ? path : path + '/';
}

export function linkTarget(raw, base, { origin, canonical, pages, files, protectedPages }) {
  if (typeof raw !== 'string' || !raw.trim()) throw Error('EMPTY_HREF');
  let u;
  try { u = new URL(raw, base); } catch { throw Error('INVALID_HREF'); }
  if (u.protocol === 'mailto:' || u.protocol === 'tel:') {
    if (!u.pathname.trim()) throw Error('EMPTY_CONTACT');
    return { kind: 'contact', href: u.href };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw Error('UNSUPPORTED_SCHEME');
  if (u.username || u.password) throw Error('URL_CREDENTIALS');
  const canonicalHost = new URL(canonical).hostname;
  const sameSite = u.origin === origin ||
    (!u.port && (u.hostname === canonicalHost || u.hostname === 'www.' + canonicalHost));
  if (!sameSite) return { kind: 'external', href: u.href };
  const path = pagePath(u.pathname);
  if (path === '/404/' || path === '/404.html') throw Error('NOT_FOUND_TARGET');
  const request = u.pathname + u.search;
  const href = request + u.hash;
  let fragment = '';
  try { fragment = decodeURIComponent(u.hash.slice(1)); } catch { throw Error('INVALID_FRAGMENT'); }
  const isPage = pages.has(path);
  if (!isPage && !files.has(u.pathname)) throw Error('UNDECLARED_TARGET');
  if (!isPage) return { kind: 'asset', request, href, fragment, path: u.pathname };
  return {
    kind: protectedPages.has(path) ? 'protected' : 'page',
    request, href, fragment, path,
    localClick: u.origin === origin,
  };
}

export function fragmentExists(fragment, ids, names) {
  return !fragment || fragment.toLowerCase() === 'top' || ids.includes(fragment) || names.includes(fragment);
}
