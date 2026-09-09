/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The segmented control over the shell's view point.
 *
 * It shows nothing at all until a plugin contributes a view: an empty
 * workspace is an empty control, not a fake one. Each contributed view is one
 * button; `None` is implicit and first. Gating comes from the host through
 * `describe` — a view that cannot open right now stays focusable and says
 * why, rather than disappearing.
 *
 * @module ViewSelector
 */

import type { ComponentType, JSX, ReactNode } from "react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Box, SegmentedControl } from "@primer/react";
import type { ContributionPoint } from "@datalayer/reactor";
import { useContributions } from "@datalayer/reactor/react";
import {
  NONE_VIEW,
  chooseView,
  getViewChoice,
  setViewOptions,
  subscribeViewChoice,
} from "./viewChoice";

/** What the selector needs to know about one view, however the host types it. */
export type ShellViewDescriptor = {
  /** Stable id — what `chooseView` is called with. */
  id: string;
  title: string;
  icon?: ComponentType<unknown>;
  /** Ordering in the control. Lower is earlier. */
  order?: number;
  /** Whether it can be chosen right now. */
  disabled?: boolean;
  /** Why it cannot be, for the disabled button's tooltip. */
  disabledReason?: string;
  /**
   * A live figure shown beside the title — "Notebook (4)".
   *
   * The host computes it, so the selector says something true about the
   * thing behind the view rather than only naming it.
   */
  badge?: string;
  /**
   * What the hover card shows for this view — a real overlay, not a
   * tooltip, so it can carry a list. Nothing given means no card.
   */
  details?: ReactNode;
};

export type ViewSelectorProps = {
  /** The point the views arrive through. */
  point: ContributionPoint<unknown>;
  /** How a contributed value reads as a descriptor, given the host context. */
  describe: (value: unknown, context: unknown) => ShellViewDescriptor;
  /** The host context handed to `describe` — the slot's props, usually. */
  context: unknown;
  noneLabel: string;
  ariaLabel: string;
  /**
   * Whether "none" is offered. True by default — the loop's chat stands on
   * its own beside an empty editor. False for a host whose views *are* the
   * application: the control then draws only the views, and not at all until
   * there are two, since a choice of one is furniture.
   */
  allowNone?: boolean;
};

export function ViewSelector({
  point,
  describe,
  context,
  noneLabel,
  ariaLabel,
  allowNone = true,
}: ViewSelectorProps): JSX.Element | null {
  const contributions = useContributions(point);
  const choice = useSyncExternalStore(subscribeViewChoice, getViewChoice);

  /*
   * The hover card. One card for whichever view the pointer is on, kept
   * open while the pointer is on the card itself, closed a beat after it
   * leaves either — the same manners as any hover overlay that carries
   * content worth reading.
   */
  const [hovered, setHovered] = useState<string | null>(null);
  const closeTimer = useRef<number | null>(null);
  const clearCloseTimer = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const openCard = (id: string) => {
    clearCloseTimer();
    setHovered(id);
  };
  const scheduleClose = () => {
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => {
      setHovered(null);
      closeTimer.current = null;
    }, 250);
  };
  useEffect(() => clearCloseTimer, []);

  const ordered = useMemo(
    () =>
      contributions
        .map((entry) => describe(entry.value, context))
        .sort((left, right) => (left.order ?? 100) - (right.order ?? 100)),
    [contributions, describe, context],
  );

  // Published for the cycle command, which runs outside React and cannot
  // read contributions itself.
  useEffect(() => {
    setViewOptions(
      ordered.map((view) => view.id),
      allowNone,
    );
  }, [ordered, allowNone]);

  if (ordered.length < (allowNone ? 1 : 2)) {
    // Nothing to choose between. A control with one option is furniture, and
    // the views arrive with the plugins that contribute them.
    return null;
  }

  const hoveredView = ordered.find(
    (view) => view.id === hovered && view.details,
  );

  return (
    <Box
      sx={{
        // Held to the trailing edge of whatever row the slot renders it in:
        // the selector is chrome about the workspace, not about the work.
        marginLeft: "auto",
        display: "flex",
        alignItems: "center",
        // The hover card positions itself against this box.
        position: "relative",
      }}
    >
      <SegmentedControl aria-label={ariaLabel} size="small">
        {allowNone ? (
          <SegmentedControl.Button
            selected={choice.viewId === NONE_VIEW}
            onClick={() => chooseView(NONE_VIEW)}
          >
            {noneLabel}
          </SegmentedControl.Button>
        ) : null}
        {ordered.map((view) => (
          <SegmentedControl.Button
            key={view.id}
            selected={choice.viewId === view.id}
            // `aria-disabled` rather than `disabled`: a disabled button is
            // not focusable, so a keyboard or screen-reader user would never
            // hear *why* the view is unavailable. It stays focusable, the
            // title explains, and the handler declines.
            aria-disabled={view.disabled || undefined}
            title={view.disabled ? view.disabledReason : view.title}
            // Primer types this as its own icon shape; a contribution may
            // bring any component, which is the point of the extension point.
            leadingIcon={view.icon as never}
            onMouseEnter={view.details ? () => openCard(view.id) : undefined}
            onMouseLeave={view.details ? scheduleClose : undefined}
            onClick={() => {
              if (!view.disabled) {
                chooseView(view.id);
              }
            }}
          >
            {view.badge ? `${view.title} (${view.badge})` : view.title}
          </SegmentedControl.Button>
        ))}
      </SegmentedControl>
      {hoveredView ? (
        <Box
          onMouseEnter={clearCloseTimer}
          onMouseLeave={scheduleClose}
          sx={{
            position: "absolute",
            top: "calc(100% + 6px)",
            // The selector lives at the trailing edge of a header, so the
            // card grows leftward rather than off the viewport.
            right: 0,
            minWidth: 260,
            maxWidth: 380,
            maxHeight: 320,
            overflowY: "auto",
            p: 2,
            bg: "canvas.overlay",
            border: "1px solid",
            borderColor: "border.default",
            borderRadius: 2,
            boxShadow: "shadow.large",
            zIndex: 40,
            fontSize: 0,
            color: "fg.default",
            textAlign: "left",
          }}
        >
          {hoveredView.details}
        </Box>
      ) : null}
    </Box>
  );
}

export default ViewSelector;
