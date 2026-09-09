/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Agent tools: what a plugin offers an AI agent, declared by the plugin.
 *
 * A plugin's commands are things a person does from a palette or a keystroke.
 * The same things are what an agent working beside that person should be able
 * to do — open the deck, go to slide four, present — and the plugin is the one
 * that knows which of its commands make sense as tools, what to call them, and
 * what argument each takes. So the plugin says so, here, as a contribution to
 * a point the reactor defines, and every host that wants to hand a plugin's
 * capabilities to an agent reads one place.
 *
 * What a host does with a bundle is its business. A chat host turns each
 * command into a tool whose handler is `reactor.executeCommand(command, args)`;
 * a host with a richer implementation of some tool keeps the bundle's name and
 * description and supplies its own handler. The bundle's `toolset` is the
 * least-privilege list — a harness that admits client tools by name admits
 * these.
 *
 * The Python tier has the same vocabulary: a plugin's `provide_agent_tools`
 * hook returns the same shape, and `GET /plugins/agent-tools` lists it, so a
 * server-side agent runtime can learn a plugin's tools from the host that
 * serves it.
 *
 * @module core/agentTools
 */

import type { ReactorPlatform } from './reactor';
import { defineContributionPoint, type Contribution } from './contributions';

/** One command of a plugin, as a tool an agent may call. */
export type AgentCommandTool = {
  /** What the model calls the tool. Letters, digits and underscores. */
  name: string;
  /** The reactor command it executes. */
  command: string;
  /** What the model is told the tool does. */
  description: string;
  /** JSON Schema of the command's argument, passed whole. None for a command that takes none. */
  parameters?: Record<string, unknown>;
};

/** What one plugin offers an agent. */
export type AgentToolBundle = {
  /** The bundle's id — the plugin's short name, usually. */
  id: string;
  version?: string;
  /** For a person reading a list of bundles. */
  name: string;
  description?: string;
  /** The plugin these are the commands of. */
  plugin?: string;
  /**
   * The tool names the bundle grants, in order. Normally every command's name;
   * a bundle may list fewer to offer a narrower set under the same id.
   */
  toolset: string[];
  commands: AgentCommandTool[];
};

/** Where plugins put their bundles. Defined once, here, for every host. */
export const AgentTools = defineContributionPoint<AgentToolBundle>('reactor.agentTools');

/**
 * A bundle from a plugin's commands, with the bookkeeping filled in.
 *
 * `toolset` defaults to every command's name, which is what a bundle means
 * unless it says otherwise.
 */
export function defineAgentTools(
  bundle: Omit<AgentToolBundle, 'toolset'> & { toolset?: string[] },
): AgentToolBundle {
  const seen = new Set<string>();
  for (const command of bundle.commands) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(command.name)) {
      throw new Error(
        `${bundle.id}: tool name '${command.name}' must be letters, digits and underscores.`,
      );
    }
    if (seen.has(command.name)) {
      throw new Error(`${bundle.id}: tool name '${command.name}' is declared twice.`);
    }
    seen.add(command.name);
  }
  return { ...bundle, toolset: bundle.toolset ?? bundle.commands.map((command) => command.name) };
}

/** Every bundle contributed to a platform, in contribution order. */
export function agentToolBundles(reactor: ReactorPlatform): AgentToolBundle[] {
  return reactor.getContributions(AgentTools).map((entry: Contribution<AgentToolBundle>) => entry.value);
}

/** The bundle of one id, if a plugin contributed it. */
export function agentToolBundle(reactor: ReactorPlatform, id: string): AgentToolBundle | undefined {
  return agentToolBundles(reactor).find((bundle) => bundle.id === id);
}
