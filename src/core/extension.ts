import { shallowMergeConfig } from './platform';

export type Dispose = () => void;

export type PeerDependency = {
  name: string;
  optional?: boolean;
};

export type ExtensionRef = ReactorExtension<any, any, any> | ConfiguredExtension<any, any, any>;

export type ConfiguredExtension<C, I, O> = {
  extension: ReactorExtension<C, I, O>;
  config: Partial<C>;
};

export type PhaseContext<C, I, O> = {
  extension: ReactorExtension<C, I, O>;
  config: C;
  state: ExtensionState<C, I, O>;
  platform: ReactorPlatformView;
};

export type ExtensionState<C, I, O> = {
  getConfig: () => C;
  getInit: () => I | undefined;
  getOutput: () => O | undefined;
};

export type ReactorExtension<C, I, O> = {
  name: string;
  version?: string;
  requiredBackendPlugins?: string[];
  config?: C;
  dependencies?: ExtensionRef[];
  peerDependencies?: PeerDependency[];
  conflictsWith?: string[];
  mergeConfig?: (base: C, override: Partial<C>) => C;
  init?: (ctx: PhaseContext<C, I, O>) => I;
  build?: (ctx: PhaseContext<C, I, O>) => O;
  register?: (ctx: PhaseContext<C, I, O>) => void | Dispose;
  afterRegistration?: (ctx: PhaseContext<C, I, O>) => void | Dispose;
};

export type ReactorPlatformView = {
  hasExtension: (name: string) => boolean;
  getOutput: <T = unknown>(name: string) => T | undefined;
  getRequiredBackendPlugins: (name: string) => string[];
  isEnabled: (name: string) => boolean;
};

export function defineExtension<C = Record<string, never>, I = unknown, O = unknown>(
  extension: ReactorExtension<C, I, O>,
): ReactorExtension<C, I, O> {
  return extension;
}

export function configExtension<C, I, O>(
  extension: ReactorExtension<C, I, O>,
  config: Partial<C>,
): ConfiguredExtension<C, I, O> {
  return { extension, config };
}

export function declarePeerDependency(name: string, optional = true): PeerDependency {
  return { name, optional };
}

export function asConfigured<C, I, O>(
  ref: ExtensionRef,
): ConfiguredExtension<C, I, O> {
  if ('extension' in ref) {
    return ref as ConfiguredExtension<C, I, O>;
  }
  return { extension: ref as ReactorExtension<C, I, O>, config: {} };
}

export function mergeWithDefaults<C>(
  extension: ReactorExtension<C, unknown, unknown>,
  override: Partial<C>,
): C {
  const defaults = (extension.config ?? ({} as C)) as C;
  if (extension.mergeConfig) {
    return extension.mergeConfig(defaults, override);
  }
  return shallowMergeConfig(defaults, override);
}
