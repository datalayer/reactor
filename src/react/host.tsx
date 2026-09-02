/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * React bindings for contribution points.
 *
 * `ReactorSlot` renders everything contributed to a named slot. A host is the
 * other half: it enumerates what plugins *offer* at a contribution point and
 * renders the one the application chose — one view on screen, one page open.
 *
 * @module react/host
 */

import React, {
  Component,
  Suspense,
  useMemo,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from 'react';
import type { Contribution, ContributionPoint } from '../core/contributions';
import { resolveGate, type Gate, type GateVerdict } from '../core/gates';
import { useReactorPlatform } from './reactor';

/** A module loader, as produced by `() => import('./MyView')`. */
export type LazyLoader<P = Record<string, unknown>> = () => Promise<{
  default: ComponentType<P>;
}>;

/**
 * Subscribe to a contribution point and re-render when its contributions change
 * — including contributions made after `start()`, and those withdrawn when an
 * plugin is disabled.
 */
/**
 * Ask a gate, and re-render when the answer could change.
 *
 * The context is passed on every render rather than captured, so the verdict
 * follows the caller's own live data — a plugin that answers from the props it
 * was given stays correct without subscribing to anything.
 *
 * ```tsx
 * const verdict = useGate(CanChat, workspace);
 * <Input disabled={!verdict.allowed} placeholder={verdict.reason ?? 'Ask…'} />
 * ```
 */
export function useGate<C>(gate: Gate<C>, context: C): GateVerdict {
  // Subscribes to the point, so enabling or disabling an answering plugin
  // re-renders the asker.
  const answers = useContributions(gate);
  return useMemo(() => resolveGate(answers, context), [answers, context]);
}

export function useContributions<T>(point: ContributionPoint<T>): Contribution<T>[] {
  const reactorPlatform = useReactorPlatform();
  const revision = useSyncExternalStore(reactorPlatform.subscribe, () =>
    reactorPlatform.getRevision(),
  );
  return useMemo(
    () => reactorPlatform.getContributions(point),
    // `revision` is the snapshot: the contributions array is rebuilt on every
    // call, so it cannot be compared by identity.
    [reactorPlatform, point, revision],
  );
}

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback: (error: Error) => ReactNode;
  /** Remount the boundary when this changes, so a new view gets a clean slate. */
  resetKey?: unknown;
};

type ErrorBoundaryState = { error: Error | null };

class LazyErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(previous: ErrorBoundaryProps) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error);
    }
    return this.props.children;
  }
}

// `React.lazy` needs a stable component identity across renders, so each loader
// gets exactly one lazy component for the lifetime of the module.
const lazyComponents = new WeakMap<LazyLoader<any>, ComponentType<any>>();

function lazyFor<P>(load: LazyLoader<P>): ComponentType<P> {
  const cached = lazyComponents.get(load);
  if (cached) {
    return cached as ComponentType<P>;
  }
  const created = React.lazy(load as LazyLoader<any>) as unknown as ComponentType<P>;
  lazyComponents.set(load, created);
  return created;
}

export type ReactorLazyProps<P = Record<string, unknown>> = {
  load: LazyLoader<P>;
  props?: P;
  /** Rendered while the module loads. */
  fallback?: ReactNode;
  /**
   * Rendered when the module fails to load or throws while rendering. Without
   * one, a broken plugin takes the host down with it.
   */
  errorFallback?: (error: Error) => ReactNode;
};

/**
 * Render a lazily-loaded component with a Suspense boundary and an error
 * boundary. Lazy loading is what keeps a heavy plugin — an editor, a notebook —
 * out of the shell's bundle until someone opens it.
 */
export function ReactorLazy<P = Record<string, unknown>>({
  load,
  props,
  fallback = null,
  errorFallback,
}: ReactorLazyProps<P>) {
  const LazyComponent = useMemo(() => lazyFor<P>(load), [load]);
  const renderError =
    errorFallback ?? ((error: Error) => <>{`Failed to load view: ${error.message}`}</>);

  return (
    <LazyErrorBoundary fallback={renderError} resetKey={load}>
      <Suspense fallback={fallback}>
        <LazyComponent {...((props ?? {}) as P & React.JSX.IntrinsicAttributes)} />
      </Suspense>
    </LazyErrorBoundary>
  );
}

/** How a host gets something renderable out of a contribution. */
export type ViewResolution<P = Record<string, unknown>> =
  | { load: LazyLoader<P>; Component?: undefined }
  | { Component: ComponentType<P>; load?: undefined };

function defaultResolve<T>(value: T): ViewResolution | undefined {
  const candidate = value as { load?: unknown; Component?: unknown } | null;
  if (candidate && typeof candidate.load === 'function') {
    return { load: candidate.load as LazyLoader };
  }
  if (candidate && typeof candidate.Component === 'function') {
    return { Component: candidate.Component as ComponentType };
  }
  return undefined;
}

export type ReactorViewHostProps<T> = {
  point: ContributionPoint<T>;
  /**
   * Contribution id to render (see `ContributeOptions.id`). When it matches
   * nothing — no contribution yet, or its plugin was disabled — `empty` is
   * rendered instead.
   */
  active?: string;
  /** Props handed to the rendered view. */
  props?: Record<string, unknown>;
  /** Rendered while a lazy view loads. */
  fallback?: ReactNode;
  /** Rendered when nothing is active or the active id matches nothing. */
  empty?: ReactNode;
  /** Rendered when the view fails to load or throws. */
  errorFallback?: (error: Error) => ReactNode;
  /**
   * Where the component lives inside a contribution. Defaults to `value.load`
   * (lazy) or `value.Component` (eager).
   */
  resolve?: (value: T) => ViewResolution | undefined;
  /** Full control: render the matched contribution yourself. */
  render?: (contribution: Contribution<T>) => ReactNode;
};

/**
 * Render exactly one contribution from a contribution point — the one whose id
 * is `active`.
 *
 * The reactor holds no opinion about which view should be on screen, or whether
 * it is currently allowed to be: enablement rules live in the application, which
 * decides what to pass as `active`.
 */
export function ReactorViewHost<T>({
  point,
  active,
  props,
  fallback = null,
  empty = null,
  errorFallback,
  resolve = defaultResolve,
  render,
}: ReactorViewHostProps<T>) {
  const contributions = useContributions(point);
  const matched = useMemo(
    () =>
      active === undefined
        ? undefined
        : contributions.find((entry) => entry.id === active),
    [contributions, active],
  );

  if (!matched) {
    return <>{empty}</>;
  }

  if (render) {
    return <>{render(matched)}</>;
  }

  const resolution = resolve(matched.value);
  if (!resolution) {
    return <>{empty}</>;
  }

  if (resolution.load) {
    return (
      <ReactorLazy
        load={resolution.load}
        props={props}
        fallback={fallback}
        errorFallback={errorFallback}
      />
    );
  }

  const Eager = resolution.Component;
  return <Eager {...(props ?? {})} />;
}
