/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The origin policy.
 *
 * What these check is the boundary rather than the syntax: that the page's own
 * origin never needs naming, that everything else does, that a pattern cannot
 * accidentally mean more than it says, and that the doors which are *not*
 * `defineRemotePlugin` — a container registered by name, a hot update — go
 * through the same gate. A policy with one door open is not a policy.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ANY_ORIGIN,
  OriginNotAllowedError,
  assertOriginAllowed,
  getAllowedOrigins,
  isOriginAllowed,
  resolveOrigin,
  scriptSrcForAllowedOrigins,
  setAllowedOrigins,
} from '../origins';

/** Stand a page up, so that "same origin" means something. */
function onPage<T>(href: string, body: () => T): T {
  const original = (globalThis as Record<string, unknown>).location;
  (globalThis as Record<string, unknown>).location = { href, origin: new URL(href).origin };
  try {
    return body();
  } finally {
    (globalThis as Record<string, unknown>).location = original;
  }
}

afterEach(() => {
  setAllowedOrigins([]);
});

describe('the floor', () => {
  it('always passes the page’s own origin, named or not', () => {
    onPage('https://app.example/page', () => {
      expect(isOriginAllowed('https://app.example/remotes/x.js')).toBe(true);
      expect(isOriginAllowed('/remotes/x.js')).toBe(true);
      expect(getAllowedOrigins()).toEqual([]);
    });
  });

  it('refuses every other origin until it is named', () => {
    onPage('https://app.example/page', () => {
      expect(isOriginAllowed('https://cdn.acme.com/x.js')).toBe(false);
      setAllowedOrigins(['https://cdn.acme.com']);
      expect(isOriginAllowed('https://cdn.acme.com/x.js')).toBe(true);
    });
  });

  it('refuses a protocol-relative URL, which a browser loads cross-origin', () => {
    // `//evil.example/x.js` has no scheme, so "does it look absolute?" answers
    // *local* — and the browser fetches it from evil.example anyway. Resolving
    // against the page is the only way to learn where an import would go.
    onPage('https://app.example/page', () => {
      expect(resolveOrigin('//evil.example/x.js')).toBe('https://evil.example');
      expect(isOriginAllowed('//evil.example/x.js')).toBe(false);
    });
  });

  it('refuses an opaque origin, which cannot be named by anyone', () => {
    // A `data:` URL is same-privilege code from nowhere. It serialises to the
    // origin `null`, and allowing `null` would allow every one of them.
    onPage('https://app.example/page', () => {
      setAllowedOrigins(['null', 'data:']);
      expect(isOriginAllowed('data:text/javascript,export default 1')).toBe(false);
    });
  });

  it('has nothing to check when there is no page and the URL is relative', () => {
    // A test, or a server-side render. There is no origin here and nothing a
    // check could protect — refusing would only break rendering on a server.
    expect(isOriginAllowed('/remotes/x.js')).toBe(true);
    expect(isOriginAllowed('https://cdn.acme.com/x.js')).toBe(false);
  });
});

describe('patterns', () => {
  it('reads a written origin whether or not it carries a path or a slash', () => {
    onPage('https://app.example/page', () => {
      setAllowedOrigins(['https://cdn.acme.com/', 'http://localhost:8799/api']);
      expect(isOriginAllowed('https://cdn.acme.com/charts.js')).toBe(true);
      expect(isOriginAllowed('http://localhost:8799/x.js')).toBe(true);
    });
  });

  it('matches subdomains with a wildcard, as a CSP source does', () => {
    onPage('https://app.example/page', () => {
      setAllowedOrigins(['https://*.acme.com']);
      expect(isOriginAllowed('https://cdn.acme.com/x.js')).toBe(true);
      expect(isOriginAllowed('https://a.b.acme.com/x.js')).toBe(true);
      // The apex is not a subdomain, and neither is a lookalike that merely
      // ends in the same letters.
      expect(isOriginAllowed('https://acme.com/x.js')).toBe(false);
      expect(isOriginAllowed('https://evilacme.com/x.js')).toBe(false);
      // Scheme and port are part of an origin, so they are part of the match.
      expect(isOriginAllowed('http://cdn.acme.com/x.js')).toBe(false);
      expect(isOriginAllowed('https://cdn.acme.com:8443/x.js')).toBe(false);
    });
  });

  it('reads a wildcard only where a wildcard may be', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onPage('https://app.example/page', () => {
      // A glob in a *path* is not a subdomain wildcard. Reading `*.` anywhere
      // in the string would turn this entry into "every subdomain of
      // cdn.acme.com" — a widening nobody wrote, which is worse than an entry
      // that simply fails.
      setAllowedOrigins(['https://cdn.acme.com/assets/*.js']);
      expect(isOriginAllowed('https://evil.cdn.acme.com/x.js')).toBe(false);
      // It is still that origin, read as one.
      expect(isOriginAllowed('https://cdn.acme.com/x.js')).toBe(true);
    });
    warn.mockRestore();
  });

  it('allows everything only when a host types so', () => {
    onPage('https://app.example/page', () => {
      setAllowedOrigins([ANY_ORIGIN]);
      expect(isOriginAllowed('https://anywhere.example/x.js')).toBe(true);
      expect(scriptSrcForAllowedOrigins()).toBe('*');
    });
  });

  it('drops an unreadable entry with a warning, and stays closed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onPage('https://app.example/page', () => {
      // No scheme: the most common way to write this wrong. Failing closed and
      // naming the entry beats failing open, and beats taking the shell down
      // at module scope over a misplaced character.
      setAllowedOrigins(['cdn.acme.com']);
      expect(isOriginAllowed('https://cdn.acme.com/x.js')).toBe(false);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('cdn.acme.com'));
    });
    warn.mockRestore();
  });
});

describe('the host policy and a per-call list', () => {
  it('adds rather than replaces, so one call cannot loosen or tighten the page', () => {
    onPage('https://app.example/page', () => {
      setAllowedOrigins(['https://cdn.acme.com']);
      // The call's list widens it for this load…
      expect(isOriginAllowed('https://plugins.example.com/x.js', ['https://plugins.example.com'])).toBe(true);
      // …and the standing policy still holds for one that names something else.
      expect(isOriginAllowed('https://cdn.acme.com/x.js', ['https://plugins.example.com'])).toBe(true);
      // Nothing about the call leaks into the page's own policy.
      expect(getAllowedOrigins()).toEqual(['https://cdn.acme.com']);
    });
  });
});

describe('assertOriginAllowed', () => {
  it('names the origin and what was being loaded', () => {
    onPage('https://app.example/page', () => {
      let error: unknown;
      try {
        assertOriginAllowed('https://evil.example/x.js', [], '@acme/charts');
      } catch (thrown) {
        error = thrown;
      }
      expect(error).toBeInstanceOf(OriginNotAllowedError);
      const refusal = error as OriginNotAllowedError;
      // Typed, so a host can tell a refusal from a network failure rather than
      // matching on the text of a message.
      expect(refusal.origin).toBe('https://evil.example');
      expect(refusal.message).toContain('@acme/charts');
      expect(refusal.message).toContain('https://evil.example');
    });
  });
});

describe('scriptSrcForAllowedOrigins', () => {
  it('writes the same list as a CSP source, so the two cannot drift', () => {
    // The runtime check gates what Reactor fetches; the CSP is what the
    // browser enforces, including the chunks a container pulls in afterwards,
    // which nothing in a page can gate. Written from one list.
    setAllowedOrigins(['https://cdn.acme.com/', 'https://*.plugins.example.com']);
    expect(scriptSrcForAllowedOrigins()).toBe(
      "'self' https://cdn.acme.com https://*.plugins.example.com",
    );
  });
});
