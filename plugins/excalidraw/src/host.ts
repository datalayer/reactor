/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 * BSD 3-Clause License
 */

/*
 * Copyright (c) 2021-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * Where drawings live, and what Excalidraw does for the tools.
 *
 * The tools do not know whether a drawing is a block in a Lexical document, a
 * canvas on a page, or a file on a server. They ask a host, which keeps the
 * drawings and answers for them by id, and they are handed Excalidraw's two
 * converters rather than importing Excalidraw: it is a browser bundle several
 * megabytes wide, and the host that renders drawings has it already.
 *
 * @module host
 */

import type { ExcalidrawElementData, ExcalidrawScene } from './scene';

/** One drawing as a host lists it. */
export interface ExcalidrawHostedDrawing {
  /** The id the tools address it by (`blockId`). */
  id: string;
  scene: ExcalidrawScene;
  /** Its rendered size, when the host keeps one. */
  width?: number;
  height?: number;
}

/** Where a new drawing goes, and how large it is rendered. */
export interface ExcalidrawPlacement {
  /** 'TOP', 'BOTTOM' or the id to insert after, for a host that orders drawings. */
  afterId?: string;
  width?: number;
  height?: number;
}

/**
 * What keeps the drawings.
 *
 * Every method that names a drawing throws when there is none of that id,
 * with a message that tells the model what to do next: the tools pass it on
 * as it is.
 */
export interface ExcalidrawDrawingHost {
  /** Every drawing, in the host's order. */
  listDrawings(): Promise<ExcalidrawHostedDrawing[]>;
  /** The scene of one drawing. */
  readDrawing(id: string): Promise<ExcalidrawScene>;
  /** Replace the scene of one drawing. */
  writeDrawing(id: string, scene: ExcalidrawScene): Promise<void>;
  /** Make a new drawing; answers its id. */
  insertDrawing(scene: ExcalidrawScene, placement: ExcalidrawPlacement): Promise<string>;
  /** Set how large a drawing is rendered; `'inherit'` sizes it by content. */
  resizeDrawing(id: string, width: number | 'inherit', height: number | 'inherit'): Promise<void>;
}

/**
 * Excalidraw's own conversions, handed in by the host.
 *
 * `convertToExcalidrawElements` from `@excalidraw/excalidraw`, and
 * `parseMermaidToExcalidraw` from `@excalidraw/mermaid-to-excalidraw` — the
 * second only for a host that offers `excalidrawFromMermaid`.
 */
export interface ExcalidrawConverters {
  convertToExcalidrawElements: (
    skeletons: Record<string, any>[],
    options?: { regenerateIds?: boolean },
  ) => readonly ExcalidrawElementData[] | ExcalidrawElementData[];
  parseMermaidToExcalidraw?: (
    source: string,
    options?: { fontSize?: number },
  ) => Promise<{ elements: unknown[]; files?: Record<string, unknown> }>;
}

/**
 * A host that keeps its drawings in memory, in insertion order.
 *
 * What a page with a canvas or two needs, and what the tests use. `onChange`
 * is told after every write, so a view can redraw.
 */
export function createMemoryDrawingHost(
  options: {
    /** Drawings to start with. */
    drawings?: ExcalidrawHostedDrawing[];
    /** Told after every change, with the drawing's id. */
    onChange?: (id: string) => void;
    /** How a new drawing's id is made. */
    newId?: () => string;
  } = {},
): ExcalidrawDrawingHost & {
  /** The drawing of an id, or undefined: for a view, which does not throw. */
  get(id: string): ExcalidrawHostedDrawing | undefined;
  /**
   * Put a drawing in, or replace the one of its id, at the end if it is new:
   * what a view does when a person draws, or a page restores what it had.
   */
  set(drawing: ExcalidrawHostedDrawing): void;
} {
  const drawings = new Map<string, ExcalidrawHostedDrawing>();
  for (const drawing of options.drawings ?? []) {
    drawings.set(drawing.id, drawing);
  }
  let counter = drawings.size;
  const newId = options.newId ?? (() => `drawing-${(counter += 1)}`);
  const changed = (id: string) => options.onChange?.(id);

  const require = (id: string): ExcalidrawHostedDrawing => {
    const found = drawings.get(id);
    if (!found) {
      throw new Error(
        `No drawing '${id}'. Call excalidrawListDrawings to find the drawings there are.`,
      );
    }
    return found;
  };

  return {
    get: (id) => drawings.get(id),
    set: (drawing) => {
      drawings.set(drawing.id, { ...drawing, scene: structuredClone(drawing.scene) });
      changed(drawing.id);
    },
    listDrawings: async () => [...drawings.values()],
    readDrawing: async (id) => structuredClone(require(id).scene),
    writeDrawing: async (id, scene) => {
      require(id).scene = structuredClone(scene);
      changed(id);
    },
    insertDrawing: async (scene, placement) => {
      let id = newId();
      while (drawings.has(id)) {
        id = newId();
      }
      const drawing: ExcalidrawHostedDrawing = {
        id,
        scene: structuredClone(scene),
        width: placement.width,
        height: placement.height,
      };
      const entries = [...drawings.entries()];
      const after = placement.afterId;
      const at =
        after === 'TOP'
          ? 0
          : after && after !== 'BOTTOM' && drawings.has(after)
            ? entries.findIndex(([key]) => key === after) + 1
            : entries.length;
      entries.splice(at, 0, [id, drawing]);
      drawings.clear();
      for (const [key, value] of entries) {
        drawings.set(key, value);
      }
      changed(id);
      return id;
    },
    resizeDrawing: async (id, width, height) => {
      const drawing = require(id);
      drawing.width = width === 'inherit' ? undefined : width;
      drawing.height = height === 'inherit' ? undefined : height;
      changed(id);
    },
  };
}
