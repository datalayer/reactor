/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Gates — one plugin asking the others whether something may happen.
 *
 * A contribution point answers "what do plugins offer?". A gate answers a
 * question that comes up just as often and has no good home otherwise: *may I
 * do this, and if not, what do I tell the person?*
 *
 * The case that produced it: a chat plugin needs to know whether there is an
 * agent to talk to. It cannot know — the sandbox plugin knows, because only
 * some of the places code runs bring an agent. Without something like this the
 * chat has to import the sandbox to ask, and the two stop being separable,
 * which makes the whole plugin model a decoration.
 *
 * A gate is a contribution point whose contributions are answers, plus the one
 * rule worth enforcing centrally: **a refusal must carry a reason**. Disabled
 * controls with no explanation are the standard failure of plugin systems, and
 * making the reason part of the type is the cheapest place to prevent it.
 *
 * ```ts
 * // The asking plugin declares the question.
 * export const CanChat = defineGate<Workspace>('chat.usable');
 *
 * // Any plugin answers it.
 * contribute(CanChat, {
 *   check: workspace => hasAgent(workspace) || 'No agent in the browser',
 * });
 *
 * // The asker reads one verdict.
 * const verdict = reactor.checkGate(CanChat, workspace);
 * if (!verdict.allowed) show(verdict.reason);
 * ```
 *
 * Nothing listening means allowed: a workspace with no sandbox plugin has a
 * working chat, and a gate nobody answers must never be a wall.
 *
 * @module core/gates
 */

import { defineContributionPoint, type ContributionPoint } from './contributions';

/**
 * What one plugin answers.
 *
 * `true` allows. A string refuses *and says why* — there is no way to refuse
 * without one, which is the point.
 */
export type GateAnswer = true | string;

/** A plugin's answer to a gate, given whatever context the asker passes. */
export type GateCheck<C> = {
  /** Called on every ask. Keep it cheap: hosts call this during render. */
  check: (context: C) => GateAnswer;
};

/**
 * A named question, typed by the context its answerers receive.
 *
 * Structurally a contribution point, so everything that already works on points
 * — ordering, disposal with the plugin, the plugin graph — works on gates
 * without knowing they are gates.
 */
export type Gate<C> = ContributionPoint<GateCheck<C>>;

/** What the asker gets back. */
export type GateVerdict = {
  allowed: boolean;
  /** The first refusal's reason. Undefined when allowed. */
  reason?: string;
  /** Which plugin refused first, for hosts that show provenance. */
  blockedBy?: string;
  /**
   * Every refusal, in contribution order.
   *
   * The first is what a person should be shown — one reason is actionable, a
   * list of them is a wall — but a host that wants to explain everything at
   * once can.
   */
  refusals: readonly { plugin: string; reason: string }[];
};

/**
 * Declare a gate.
 *
 * ```ts
 * export const CanCheckout = defineGate<Cart>('shop.checkout');
 * ```
 */
export function defineGate<C = void>(id: string): Gate<C> {
  return defineContributionPoint<GateCheck<C>>(id);
}

/** Whether an answer refuses. */
function isRefusal(answer: GateAnswer): answer is string {
  return answer !== true;
}

/**
 * Resolve a gate from the answers already read out of the registry.
 *
 * Exposed for hosts that hold the contributions themselves — a React hook
 * subscribing to the point, say — so they do not have to re-implement the
 * rule. `reactor.checkGate` is the ordinary way in.
 */
export function resolveGate<C>(
  answers: readonly { plugin: string; value: GateCheck<C> }[],
  context: C,
): GateVerdict {
  const refusals: { plugin: string; reason: string }[] = [];

  for (const answer of answers) {
    let result: GateAnswer;
    try {
      result = answer.value.check(context);
    } catch (error) {
      // A plugin that throws while answering has refused, and said something
      // unhelpful. Swallowing it would let a broken plugin silently allow
      // whatever it was supposed to guard.
      result = error instanceof Error ? error.message : String(error);
    }
    if (isRefusal(result)) {
      refusals.push({ plugin: answer.plugin, reason: result });
    }
  }

  const first = refusals[0];
  return {
    allowed: refusals.length === 0,
    reason: first?.reason,
    blockedBy: first?.plugin,
    refusals,
  };
}
