/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Draw a display with whichever renderer a plugin contributed for its type.
 *
 * Subscribes to {@link Renderers}, so a renderer that arrives late — a lazy
 * plugin woken by the read — draws on the next revision, and one whose plugin
 * is disabled stops drawing. With no renderer the display's text is drawn: a
 * display always says something.
 *
 * @module react/ui/ReactorDisplay
 */

import { useMemo, type ComponentType, type ReactNode } from 'react';
import { pickRenderer, Renderers, type RendererContribution } from '../../ui/renderers';
import type { UiUpload } from '../../ui/files';
import type { Display, UiAct } from '../../ui/wire';
import { ReactorLazy, useContributions, type LazyLoader } from '../host';

/** What a renderer is drawn with. */
export type RendererProps<C = unknown> = {
  display: Display;
  /** Press an action the display offered. Absent where nothing can be pressed. */
  act?: UiAct;
  /**
   * Upload a file the person chose: its ref, to press with (REACTOR_UI P6).
   * Absent where nothing can be uploaded.
   */
  upload?: UiUpload;
  /** Whatever the host hands its renderers — a chat passes the tool call. */
  context?: C;
};

export type RendererComponent<C = any> = ComponentType<RendererProps<C>>;

/** A renderer contribution whose component is a React component. */
export type ReactRendererContribution<C = any> = RendererContribution<RendererComponent<C>>;

/** Type a renderer contribution for React; returns it unchanged. */
export function defineRenderer<C = any>(
  renderer: ReactRendererContribution<C>,
): ReactRendererContribution<C> {
  if (!renderer.component && !renderer.load) {
    throw new Error(`The renderer for ${renderer.type} needs a component or a load`);
  }
  return renderer;
}

/** The text of a display, as drawn when nothing else can draw it. */
export function DisplayText({ display }: { display: Display }) {
  return (
    <span data-reactor-display-text={display.type} style={{ whiteSpace: 'pre-wrap' }}>
      {display.text}
    </span>
  );
}

export type ReactorDisplayProps<C = unknown> = RendererProps<C> & {
  /** Drawn when no renderer claims the display. Defaults to its text. */
  fallback?: ReactNode;
  /** Drawn while a lazy renderer loads. */
  loading?: ReactNode;
};

export function ReactorDisplay<C = unknown>({
  display,
  act,
  upload,
  context,
  fallback,
  loading = null,
}: ReactorDisplayProps<C>) {
  const entries = useContributions(Renderers);
  const renderer = useMemo(
    () => pickRenderer(entries, display),
    // The type and version decide, not the display's identity.
    [entries, display.type, display.version],
  );
  const text = fallback === undefined ? <DisplayText display={display} /> : fallback;
  if (!renderer) {
    return <>{text}</>;
  }
  const props: RendererProps<C> = { display, act, upload, context };
  const { component, load } = renderer.value as ReactRendererContribution<C>;
  if (component) {
    const Component = component;
    return <Component {...props} />;
  }
  if (load) {
    return (
      <ReactorLazy
        load={load as LazyLoader<RendererProps<C>>}
        props={props}
        fallback={loading}
        errorFallback={() => <>{text}</>}
      />
    );
  }
  return <>{text}</>;
}
