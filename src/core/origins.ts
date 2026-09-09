/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Where a remote is allowed to come from.
 *
 * A remote plugin runs in the shell's origin with the shell's privileges: it
 * reads the same cookies, calls the same APIs and draws over the same page.
 * "A URL" is therefore not a detail of delivery, it is the whole trust
 * boundary, and *"anywhere"* is not something anybody should get by accident.
 *
 * So the rule is one sentence: **the page's own origin always passes, and
 * every other origin has to be named.** This module is that sentence,
 * factored out of {@link module:core/remote} because naming an origin is not
 * only a `defineRemotePlugin` concern — a container registered by name, a
 * hot update pointed at a dev server and a backend asked what it has installed
 * are all places where a URL turns into code, and a policy that only covered
 * the first would be a policy with three doors left open.
 *
 * Three things are worth stating plainly, because each is a decision:
 *
 * 1. **The host states it once.** {@link setAllowedOrigins} is the standing
 *    policy for the page. A per-call `allowedOrigins` adds to it for that
 *    plugin; nothing narrows it. A policy that changed depending on which call
 *    site loaded a module would not be a policy, and a caller that could
 *    tighten it could equally have been trusted to state it.
 * 2. **It is a gate, not a sandbox.** Refusing an origin stops Reactor from
 *    fetching a module. It does not stop code that *is* loaded from fetching
 *    whatever it likes afterwards — nothing in a page can. The enforcement is
 *    a Content-Security-Policy, and {@link scriptSrcForAllowedOrigins} exists
 *    so the two are written from the same list rather than kept in step by
 *    hand.
 * 3. **A refusal is a state, not a crash.** The error lands on the plugin's
 *    manifest as `loadError`, so a host can show *"installed, and refused
 *    because of where it is served from"* — which is a different thing to do
 *    about than a slow network.
 *
 * @module core/origins
 */

/**
 * The pattern that allows every origin.
 *
 * It exists so that a development shell can say so *in words a reader can
 * grep for*, rather than reaching around the check. Nothing sets it by
 * default, and a production host that finds it in its own source has found a
 * bug.
 */
export const ANY_ORIGIN = '*';

/** Thrown when a URL resolves to an origin the host has not named. */
export class OriginNotAllowedError extends Error {
  /** The URL that was refused, as it was written. */
  readonly url: string;
  /** The origin it resolved to — which is the thing being refused. */
  readonly origin: string;

  constructor(url: string, origin: string, what = 'a remote') {
    super(
      `Refusing to load ${what} from ${origin}: not an allowed origin. ` +
        'Pass allowedOrigins, or call setAllowedOrigins() from the host, to accept it.',
    );
    this.name = 'OriginNotAllowedError';
    this.url = url;
    this.origin = origin;
  }
}

/**
 * One entry of an allow-list, parsed.
 *
 * `suffix` is the wildcard form — `https://*.acme.com` — and it matches
 * subdomains only, exactly as a Content-Security-Policy source does. A host
 * that also serves from the apex names the apex too; inventing a second
 * meaning for the same syntax would make the CSP and the policy disagree,
 * which is the one thing this must not do.
 */
type OriginRule =
  | { kind: 'any' }
  | { kind: 'exact'; origin: string }
  | { kind: 'suffix'; protocol: string; suffix: string; port: string };

/**
 * Turn one written pattern into a rule.
 *
 * Unparseable patterns are dropped with a warning rather than thrown: a typo
 * in an allow-list should fail *closed* — the origin stays refused — and it
 * should say which entry was the typo. Throwing would take the shell down at
 * module scope over a misplaced character in a list of CDNs.
 */
/**
 * A wildcard, and only in the place a wildcard may be: the leftmost label of
 * the host.
 *
 * Anchored rather than searched for. `https://cdn.acme.com/assets/*.js` is a
 * path with a glob in it, and reading the `*.` anywhere in the string would
 * turn that into *"every subdomain of cdn.acme.com"* — a widening nobody
 * wrote. An allow-list entry that fails to parse must fail closed; one that
 * parses into something broader than it reads is worse than either.
 */
const LEFTMOST_WILDCARD = /^[a-z][a-z0-9+.-]*:\/\/\*\./i;

function parseOriginRule(pattern: string): OriginRule | undefined {
  const written = pattern.trim();
  if (written === ANY_ORIGIN) {
    return { kind: 'any' };
  }
  try {
    if (LEFTMOST_WILDCARD.test(written)) {
      // Parsed by removing the wildcard label, so the rest goes through the
      // same URL parser as everything else — ports, schemes and IDNs included.
      const url = new URL(written.replace('*.', ''));
      return {
        kind: 'suffix',
        protocol: url.protocol,
        suffix: `.${url.hostname}`,
        port: url.port,
      };
    }
    // Written as an origin, but tolerant of a URL: `http://localhost:8799/`
    // and `http://localhost:8799` are the same host saying the same thing,
    // and a trailing slash is the most common way to write it by accident.
    return { kind: 'exact', origin: new URL(written).origin };
  } catch {
    console.warn(
      `[reactor] ignoring an unreadable allowed origin: ${JSON.stringify(pattern)}. ` +
        'Write it with a scheme, e.g. https://cdn.example.com or https://*.example.com.',
    );
    return undefined;
  }
}

function matches(rule: OriginRule, origin: string): boolean {
  if (rule.kind === 'any') {
    return true;
  }
  if (rule.kind === 'exact') {
    return rule.origin === origin;
  }
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return (
    url.protocol === rule.protocol &&
    url.port === rule.port &&
    url.hostname.endsWith(rule.suffix)
  );
}

/** The host's standing policy, as written. */
let policy: readonly string[] = [];

/**
 * State, once, the origins this page will load remotes from.
 *
 * The shell's own origin is always allowed and never needs listing. Everything
 * else does:
 *
 * ```ts
 * setAllowedOrigins(['https://plugins.example.com', 'https://*.cdn.example.com']);
 * ```
 *
 * Replaces the policy rather than adding to it, so a host reads its own source
 * and knows what the answer is. Pass `[]` to go back to same-origin only.
 */
export function setAllowedOrigins(origins: readonly string[]): void {
  policy = [...origins];
}

/** The standing policy, as it was written. For a host that displays it. */
export function getAllowedOrigins(): string[] {
  return [...policy];
}

/**
 * Where a URL would actually load from, or `undefined` when there is nothing
 * to check.
 *
 * Resolved rather than pattern-matched, because *"does this look absolute?"*
 * has a wrong answer: `//evil.example/x.js` is **protocol-relative**, and the
 * browser loads it cross-origin while a `^[a-z]+://` test says it is a local
 * path. Handing the URL to `new URL` with the page as the base is the only way
 * to learn where an import would go.
 *
 * `undefined` means a relative URL with no page to resolve it against — a test
 * or a server-side render. There is no origin there, and nothing a check could
 * protect.
 */
export function resolveOrigin(url: string): string | undefined {
  const base =
    typeof location !== 'undefined' && location?.href ? location.href : undefined;
  if (base) {
    return new URL(url, base).origin;
  }
  return /^[a-z]+:\/\//i.test(url) ? new URL(url).origin : undefined;
}

/** The page's own origin, when there is a page. */
function pageOrigin(): string | undefined {
  const href =
    typeof location !== 'undefined' && location?.href ? location.href : undefined;
  return href ? new URL(href).origin : undefined;
}

/**
 * Would this URL be loaded, or refused?
 *
 * The predicate behind every refusal, exported so that a host can ask *before*
 * it offers. A marketplace listing a plugin from an origin this page will not
 * load should say so beside the listing, rather than let somebody install it
 * and read the reason in `loadError` afterwards.
 *
 * ```tsx
 * <button disabled={!isOriginAllowed(url)}>Install</button>
 * ```
 */
export function isOriginAllowed(url: string, extra: readonly string[] = []): boolean {
  let origin: string | undefined;
  try {
    origin = resolveOrigin(url);
  } catch {
    return false;
  }
  if (origin === undefined || origin === pageOrigin()) {
    return true;
  }
  // `null` is what an opaque origin serialises to — a `data:` URL, or a
  // sandboxed frame. It is not an origin anybody can name, so it cannot be
  // allowed by naming one. (A `blob:` URL is *not* this: it carries the origin
  // of the page that created it, and a page's own blob is same-origin code the
  // page itself made.)
  if (origin === 'null') {
    return false;
  }
  for (const pattern of [...policy, ...extra]) {
    const rule = parseOriginRule(pattern);
    if (rule && matches(rule, origin)) {
      return true;
    }
  }
  return false;
}

/**
 * Refuse a URL whose origin was never named.
 *
 * `what` names the thing being loaded — a plugin, a container, a backend — so
 * that the message says which of a page's several remote-loading seams
 * refused, rather than leaving a reader to guess.
 */
export function assertOriginAllowed(
  url: string,
  extra: readonly string[] = [],
  what = 'a remote',
): void {
  if (isOriginAllowed(url, extra)) {
    return;
  }
  let origin: string;
  try {
    origin = resolveOrigin(url) ?? url;
  } catch {
    throw new OriginNotAllowedError(url, url, what);
  }
  throw new OriginNotAllowedError(url, origin, what);
}

/**
 * The policy, written as a Content-Security-Policy `script-src` value.
 *
 * The runtime check is a gate on what Reactor fetches; the CSP is what the
 * *browser* enforces, including the chunks a container pulls in afterwards,
 * which nothing in a page can gate. Both should say the same thing, so this
 * says it from the same list:
 *
 * ```ts
 * response.setHeader('Content-Security-Policy', `script-src ${scriptSrcForAllowedOrigins()}`);
 * ```
 *
 * `'self'` is always first, because same-origin always passes.
 */
export function scriptSrcForAllowedOrigins(extra: readonly string[] = []): string {
  const sources = ["'self'"];
  for (const pattern of [...policy, ...extra]) {
    const rule = parseOriginRule(pattern);
    if (!rule) {
      continue;
    }
    // A CSP with a `*` source in it is a CSP that permits everything, and
    // writing the rest beside it would only suggest otherwise.
    if (rule.kind === 'any') {
      return '*';
    }
    const source = rule.kind === 'exact' ? rule.origin : written(rule);
    if (!sources.includes(source)) {
      sources.push(source);
    }
  }
  return sources.join(' ');
}

/** A wildcard rule, back in the form a CSP takes. */
function written(rule: { protocol: string; suffix: string; port: string }): string {
  const host = `*${rule.suffix}`;
  return `${rule.protocol}//${host}${rule.port ? `:${rule.port}` : ''}`;
}
