/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Activation events: when a plugin becomes active.
 *
 * A plugin that is installed is not therefore running. Between the two sits a
 * declared condition — "when the application starts", "when this view is
 * opened", "when anyone reads this contribution point" — and the reactor holds
 * the plugin's module on the wire until that condition is met.
 *
 * This is what keeps a large plugin set affordable. A workspace with thirty
 * plugins pays, at first paint, for the handful that answer `onStartup`; the
 * rest arrive when something actually asks for them. Crucially the *manifest*
 * is there the whole time, so the plugin can be listed, described, drawn on the
 * graph and switched off while its code has never been fetched.
 *
 * Two ways an event fires, and both are in the table this module implements:
 *
 * - **the reactor triggers it** — `onStartup` during `start()`;
 * - **use of contributed functionality triggers it** — reading a contribution
 *   point fires `onContributionPoint:<id>`, so a plugin that only matters once
 *   somebody looks at a point loads exactly then, and the host that looked did
 *   not have to know the plugin existed.
 *
 * Deactivation is the same idea run backwards, and it is a genuinely different
 * thing from being *disabled*. Disabled is a person's decision and it sticks:
 * no event brings a disabled plugin back. Deactivated says only that the
 * condition it came up for has passed — it keeps its place in the list, keeps
 * its module, and comes back the next time one of its activation events fires.
 * See {@link matchesDeactivation} for the one asymmetry between them.
 *
 * The vocabulary is open. `onView:notebook` and `onCommand:compact` are
 * conventions this module offers helpers for, not a closed set the reactor
 * enforces — an application is free to fire `onProjectOpen` and have plugins
 * wait for it.
 *
 * @module core/activation
 */

import type { ContributionPoint } from './contributions';

/**
 * An activation event, as declared by a plugin or fired by the application.
 *
 * A bare `string` rather than a union: the reactor matches events, it does not
 * own the vocabulary, and a closed union would make every application-specific
 * event a type error in the framework.
 */
export type ActivationEvent = string;

/**
 * Activate as soon as the platform starts.
 *
 * The right answer for a plugin that must exist before the first paint — the
 * shell's own furniture, a service everything else builds on.
 */
export const ON_STARTUP: ActivationEvent = 'onStartup';

/**
 * Activate on anything, starting with startup.
 *
 * The default when a plugin declares no events at all, which keeps the simple
 * case simple: a plugin that says nothing about activation behaves the way it
 * did before activation events existed.
 */
export const ON_ANY: ActivationEvent = '*';

/**
 * Fired when somebody reads a contribution point.
 *
 * The interesting one, because it inverts the dependency: a toolbar that reads
 * its items causes the plugins that fill it to load, without naming any of
 * them.
 */
export function onContributionPoint(
  point: ContributionPoint<any> | string,
): ActivationEvent {
  return `onContributionPoint:${typeof point === 'string' ? point : point.id}`;
}

/** Fired by an application that opens a view by id. A convention, not a rule. */
export function onView(viewType: string): ActivationEvent {
  return `onView:${viewType}`;
}

/** Fired by an application that runs a command by id. A convention, not a rule. */
export function onCommand(commandId: string): ActivationEvent {
  return `onCommand:${commandId}`;
}

/**
 * Fired when a backend plugin on the other tier comes up or goes away.
 *
 * Most plugins never need it: declaring `requiredBackendPlugins` is enough,
 * because `setBackendPlugins` stands those down and brings them back on the
 * platform's own. This is for the other case — a plugin that wants to *react*
 * to a backend plugin it does not require, which is what
 * `optionalBackendPlugins` describes.
 */
export function onBackendPlugin(pluginName: string): ActivationEvent {
  return `onBackendPlugin:${pluginName}`;
}

/**
 * Whether a plugin declaring these events should activate on this one.
 *
 * `'*'` matches everything, including startup. Everything else is an exact
 * match: prefix matching would make `onView:note` activate on
 * `onView:notebook`, which is a bug that only shows up in someone else's
 * application.
 */
export function matchesActivation(
  declared: readonly ActivationEvent[] | undefined,
  event: ActivationEvent,
): boolean {
  // Nothing declared means the old behaviour — up at startup, always.
  if (!declared || declared.length === 0) {
    return event === ON_STARTUP;
  }
  return declared.some((candidate) => candidate === ON_ANY || candidate === event);
}

/**
 * Whether a plugin declaring these deactivation events should stand down.
 *
 * The asymmetry with {@link matchesActivation} is deliberate and is the whole
 * difference between the two: an empty activation list means "at startup",
 * because a plugin with no opinion should run. An empty *deactivation* list
 * means **never**, because a plugin with no opinion should stay running — the
 * defaults have to point in opposite directions or every plugin that said
 * nothing would be torn down by the first event anyone fired.
 */
export function matchesDeactivation(
  declared: readonly ActivationEvent[] | undefined,
  event: ActivationEvent,
): boolean {
  if (!declared || declared.length === 0) {
    return false;
  }
  return declared.some((candidate) => candidate === ON_ANY || candidate === event);
}

/**
 * Whether these events include startup.
 *
 * Separate from {@link matchesActivation} only for readability at the call
 * site in the reactor, where "does this go up now?" is the question being
 * asked.
 */
export function activatesAtStartup(
  declared: readonly ActivationEvent[] | undefined,
): boolean {
  return matchesActivation(declared, ON_STARTUP);
}
