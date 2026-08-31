/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The extension: a group of related plugins, installed as one thing.
 *
 * The unit of *function* is the plugin. The unit of *delivery* is the
 * extension. A notebook capability is not one plugin — it is an editor, a
 * toolbar, a set of commands, maybe a status item — and nobody wants to
 * install four things to get one capability, or to reason about a plugin list
 * where those four sit at the same level as everything else.
 *
 * So an extension is deliberately thin. It has a name, a presentation, and
 * plugins. It has no lifecycle of its own, contributes nothing, and cannot be
 * activated: unwrapping it hands the platform exactly the plugins it holds,
 * and from that moment the reactor deals only in plugins. Grouping is a fact
 * about *where a plugin came from*, recorded on the plugin's manifest, and the
 * only things that read it are the ones presenting a list to a person.
 *
 * That thinness is the point. An extension that could contribute, or be
 * disabled, or run code, would be a second kind of plugin — and then every
 * question the reactor answers would have two answers.
 *
 * ```ts
 * export const NotebookExtension = defineExtension({
 *   name: '@app/notebook-extension',
 *   displayName: 'Notebooks',
 *   plugins: [NotebookEditorPlugin, NotebookToolbarPlugin, NotebookCommandsPlugin],
 * });
 *
 * const reactor = buildReactorFromPlugins([NotebookExtension, ShellPlugin]);
 * ```
 *
 * @module core/extension
 */

import type { PluginPresentation } from './plugin';
import type { PlatformPluginRef } from './reactor';

/**
 * A group of plugins that ship, and are installed, together.
 *
 * Note what is absent: no phases, no contributions, no config, no enabled
 * flag. See the module note — an extension is a package, not a participant.
 */
export interface ReactorExtension extends PluginPresentation {
  /** The identifier the extension is known by, e.g. `@app/notebook`. */
  name: string;
  version?: string;
  /** The plugins it delivers. Lazy references are as welcome as eager ones. */
  plugins: PlatformPluginRef[];
}

/**
 * Declare an extension grouping several plugins.
 *
 * @throws if it has no name, or delivers no plugins — an extension with
 * nothing in it is always a mistake, and one that fails at build time is
 * cheaper than one that silently contributes nothing.
 */
export function defineExtension(extension: ReactorExtension): ReactorExtension {
  if (!extension.name) {
    throw new Error('defineExtension: an extension needs a name');
  }
  if (!Array.isArray(extension.plugins) || extension.plugins.length === 0) {
    throw new Error(
      `defineExtension: ${extension.name} must group at least one plugin`,
    );
  }
  return extension;
}

/** Whether a reference is an extension rather than a plugin. */
export function isExtension(ref: unknown): ref is ReactorExtension {
  return (
    typeof ref === 'object' &&
    ref !== null &&
    typeof (ref as ReactorExtension).name === 'string' &&
    Array.isArray((ref as ReactorExtension).plugins)
  );
}

/** What a host shows for an extension: its own presentation, plus its members. */
export type ExtensionManifest = PluginPresentation & {
  name: string;
  version?: string;
  /** Names of the plugins it delivers, in declaration order. */
  plugins: string[];
};
