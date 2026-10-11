/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Renderers and tool bindings: who draws a display, and which tool results
 * are displays.
 *
 * A plugin that knows how to draw a display type contributes a renderer for
 * it to {@link Renderers}. Several may claim one type; the highest `rank`
 * wins, then the one registered first, and only among those whose version
 * range admits the display's version. Every plugin keeps its own renderer:
 * none draws another's types, and disabling a plugin takes its renderers
 * with it.
 *
 * A tool result becomes a display one of two ways. A result that carries one
 * in `_meta["reactor.ui/display"]` (an MCP tool result, say) is that display.
 * Otherwise a plugin may bind a tool name to a display type in
 * {@link ToolBindings}, and the raw result is wrapped as a display of that
 * type. Neither: the host draws the tool call its own way.
 *
 * Framework-free: a renderer's `component` and `load` are typed by the
 * caller. `@datalayer/reactor/ui/react` draws them.
 *
 * @module ui/renderers
 */

import { defineContributionPoint, type Contribution } from '../core/contributions';
import type { ReactorPlatformView } from '../core/plugin';
import { DISPLAY_META_KEY, isDisplay, type Display } from './wire';

/** The versions of a display type a renderer draws, both ends inclusive. */
export type VersionRange = { min?: number; max?: number };

/**
 * A renderer for one display type.
 *
 * Give `component` to draw eagerly, or `load` to keep the renderer out of the
 * host's bundle until a display of the type turns up.
 */
export type RendererContribution<C = unknown> = {
  type: string;
  versions?: VersionRange;
  /** Higher wins. Defaults to `0`. */
  rank?: number;
  component?: C;
  load?: () => Promise<{ default: C }>;
};

/**
 * A tool whose plain result is a display of `type`.
 *
 * `tool` is the tool's name, or a pattern for a family of names — a gateway
 * prefixes the tools it serves (`pap_sign_in`, `mcp.pap_sign_in`).
 */
export type ToolBinding = {
  tool: string | RegExp;
  type: string;
  version?: number;
};

/** Where plugins put their renderers. */
export const Renderers = defineContributionPoint<RendererContribution>('reactor.ui.renderer');

/** Where plugins bind tool names to display types. */
export const ToolBindings = defineContributionPoint<ToolBinding>('reactor.ui.toolBinding');

/** Whether a version falls in a range. No range admits every version. */
export function versionInRange(version: number, range: VersionRange | undefined): boolean {
  if (!range) {
    return true;
  }
  return (range.min === undefined || version >= range.min) && (range.max === undefined || version <= range.max);
}

/**
 * The renderer for a display among these contributions: the type matches, the
 * version is in range, the highest rank wins, then contribution order.
 */
export function pickRenderer<C>(
  entries: readonly Contribution<RendererContribution<C>>[],
  display: Pick<Display, 'type' | 'version'>,
): Contribution<RendererContribution<C>> | undefined {
  const version = display.version ?? 1;
  let best: Contribution<RendererContribution<C>> | undefined;
  for (const entry of entries) {
    if (entry.value.type !== display.type || !versionInRange(version, entry.value.versions)) {
      continue;
    }
    // Strictly higher only: on a tie, the earlier contribution keeps it.
    if (!best || (entry.value.rank ?? 0) > (best.value.rank ?? 0)) {
      best = entry;
    }
  }
  return best;
}

/** The renderer a platform's plugins offer for a display, if any. */
export function resolveRenderer<C = unknown>(
  platform: Pick<ReactorPlatformView, 'getContributions'>,
  display: Pick<Display, 'type' | 'version'>,
): Contribution<RendererContribution<C>> | undefined {
  return pickRenderer(
    platform.getContributions(Renderers) as Contribution<RendererContribution<C>>[],
    display,
  );
}

/** A tool call's result, as a host hands it over. */
export type ToolResultInput = {
  toolName: string;
  result?: unknown;
  /** The call's id: the id of a display wrapped from a bound tool's result. */
  toolCallId?: string;
};

function parsedObject(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trimStart();
  if (!trimmed.startsWith('{')) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

/**
 * The display a tool result carries in `_meta["reactor.ui/display"]`.
 *
 * A result that is a JSON string is read as the object it encodes; MCP tool
 * results often arrive serialized.
 */
export function embeddedDisplay(result: unknown): Display | undefined {
  const value = parsedObject(result);
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const meta = (value as { _meta?: unknown })._meta;
  if (typeof meta !== 'object' || meta === null) {
    return undefined;
  }
  const display = (meta as Record<string, unknown>)[DISPLAY_META_KEY];
  return isDisplay(display) ? display : undefined;
}

/** Whether a binding names this tool. */
export function bindingMatches(binding: ToolBinding, toolName: string): boolean {
  if (typeof binding.tool === 'string') {
    return binding.tool === toolName;
  }
  // A global or sticky pattern remembers where it stopped; start it over.
  binding.tool.lastIndex = 0;
  return binding.tool.test(toolName);
}

function textOf(result: unknown): string {
  if (result === undefined || result === null) {
    return '';
  }
  if (typeof result === 'string') {
    return result;
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

/**
 * What a tool call is, as a display: the one its result embeds, else one
 * wrapped from its result by the first binding that names the tool, else
 * nothing — the host draws it its own way.
 *
 * A wrapped display's `data` is `{ toolName, result }`, its `text` the result
 * as text. A call still running has no result yet; a binding still names it,
 * so a renderer can draw the call as it goes.
 */
export function resolveToolResult(
  platform: Pick<ReactorPlatformView, 'getContributions'>,
  input: ToolResultInput,
): Display | undefined {
  const embedded = embeddedDisplay(input.result);
  if (embedded) {
    return embedded;
  }
  const binding = platform
    .getContributions(ToolBindings)
    .find((entry) => bindingMatches(entry.value, input.toolName));
  if (!binding) {
    return undefined;
  }
  return {
    type: binding.value.type,
    version: binding.value.version ?? 1,
    id: input.toolCallId ?? input.toolName,
    text: textOf(input.result),
    data: { toolName: input.toolName, result: input.result },
  };
}
