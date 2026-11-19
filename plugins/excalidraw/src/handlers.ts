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
 * The half of the Excalidraw tools that changes a drawing.
 *
 * An operation in `operations.ts` validates what it was given and hands it to
 * the executor; the executor finds these handlers, built for the host that
 * keeps the drawings. Each one reads a scene from the host, changes it as
 * plain data, and writes it back.
 *
 * Two rules shape everything here.
 *
 * **Ids are the contract.** Excalidraw's own converter regenerates element
 * ids by default, which would mean the ids a caller wrote in one call meant
 * nothing in the next. Every skeleton is given an explicit id before
 * conversion and converted with `regenerateIds: false`, so an id a caller
 * chose — or read back from a scene — keeps working.
 *
 * **Bindings are not decoration.** An arrow between two shapes in Excalidraw
 * is not a line that happens to touch them: it is bound at both ends, and
 * each shape lists it in `boundElements`. Get that wrong and the arrow looks
 * right until somebody drags a box, at which point it stays behind. So
 * arrows between existing elements go through `bindArrow`, which writes both
 * halves of the relationship and computes the geometry.
 *
 * @module handlers
 */

import type { ExcalidrawConverters, ExcalidrawDrawingHost } from './host';
import {
  describeScene,
  liveElements,
  touchElement,
  withBoundText,
  type ExcalidrawElementData,
  type ExcalidrawScene,
} from './scene';

/** Excalidraw's default gap between a shape and an arrow bound to it. */
const BINDING_GAP = 4;

/** One handler: the validated arguments of a call, and its answer. */
export type ExcalidrawToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

/** The answer every mutating tool gives. */
const sceneResult = (
  blockId: string,
  scene: ExcalidrawScene,
  extra?: Record<string, unknown>,
) => ({
  success: true,
  blockId,
  elementCount: liveElements(scene).length,
  ...extra,
});

// ============================================================================
// Skeletons into elements
// ============================================================================

/** Ids we hand out when the caller did not name an element. */
let generated = 0;
const newId = (): string =>
  `dla-${Date.now().toString(36)}-${(generated += 1).toString(36)}`;

/**
 * Turn the tool's element shape into the one Excalidraw's converter takes.
 *
 * The tool's shape is flatter on purpose — `label` instead of
 * `label: {text}`, `startId` instead of `start: {id}` — because a flat
 * parameter is one a model gets right first time. This is where that is
 * traded back.
 */
export function toSkeleton(element: Record<string, any>, id: string): Record<string, any> {
  const { label, startId, endId, fontSize, text, children, name, ...rest } = element;

  const skeleton: Record<string, any> = { ...rest, id };

  if (element.type === 'text') {
    skeleton.text = text ?? label ?? '';
    if (fontSize) {
      skeleton.fontSize = fontSize;
    }
  } else if (label) {
    skeleton.label = fontSize ? { text: label, fontSize } : { text: label };
  }

  if (element.type === 'arrow' || element.type === 'line') {
    // Only ids that belong to this batch can be resolved by the converter;
    // anything else is bound afterwards, against the live scene.
    if (startId) {
      skeleton.start = { id: startId };
    }
    if (endId) {
      skeleton.end = { id: endId };
    }
  }

  if (element.type === 'frame' || element.type === 'magicframe') {
    skeleton.children = children ?? [];
    if (name) {
      skeleton.name = name;
    }
  }

  return skeleton;
}

/**
 * Convert a batch of tool elements into real Excalidraw elements.
 *
 * Returns the elements and the ids they were given, in the order they were
 * asked for, so a caller can say what it made.
 */
function convertElements(
  converters: ExcalidrawConverters,
  elements: Record<string, any>[],
  existingIds: Set<string>,
): { elements: ExcalidrawElementData[]; ids: string[] } {
  const ids: string[] = [];
  const skeletons = elements.map((element) => {
    // An id the caller chose is kept — that is how they refer to it next
    // time — unless the drawing already has one, in which case keeping it
    // would overwrite an existing element.
    let id = String(element.id ?? '').trim();
    if (!id || existingIds.has(id)) {
      id = newId();
    }
    existingIds.add(id);
    ids.push(id);
    return toSkeleton(element, id);
  });

  const converted = converters.convertToExcalidrawElements(skeletons, {
    regenerateIds: false,
  });

  return { elements: [...converted], ids };
}

// ============================================================================
// Arrows between shapes
// ============================================================================

/** The centre of an element. */
const centreOf = (element: ExcalidrawElementData) => ({
  x: Number(element.x ?? 0) + Number(element.width ?? 0) / 2,
  y: Number(element.y ?? 0) + Number(element.height ?? 0) / 2,
});

/**
 * Where a line from `from` to `towards` leaves `from`'s box.
 *
 * Excalidraw recomputes this itself the moment anybody drags either shape;
 * what it needs from us is a starting geometry that already looks right, so
 * the drawing is correct before it is ever touched.
 */
export function edgePoint(
  from: ExcalidrawElementData,
  towards: { x: number; y: number },
): { x: number; y: number } {
  const centre = centreOf(from);
  const dx = towards.x - centre.x;
  const dy = towards.y - centre.y;
  if (dx === 0 && dy === 0) {
    return centre;
  }
  const halfWidth = Number(from.width ?? 0) / 2 + BINDING_GAP;
  const halfHeight = Number(from.height ?? 0) / 2 + BINDING_GAP;
  // Scale the direction until it touches whichever side it reaches first.
  const scale = Math.min(
    dx === 0 ? Infinity : Math.abs(halfWidth / dx),
    dy === 0 ? Infinity : Math.abs(halfHeight / dy),
  );
  return { x: centre.x + dx * scale, y: centre.y + dy * scale };
}

/** Note on a shape that an arrow is attached to it. */
function addBoundElement(element: ExcalidrawElementData, arrowId: string): ExcalidrawElementData {
  const bound = Array.isArray(element.boundElements) ? [...element.boundElements] : [];
  if (!bound.some((entry: any) => entry?.id === arrowId)) {
    bound.push({ id: arrowId, type: 'arrow' });
  }
  return touchElement({ ...element, boundElements: bound });
}

/**
 * Bind an arrow to the two elements it runs between, in the live scene.
 *
 * Both halves: the arrow's `startBinding`/`endBinding`, and each shape's
 * `boundElements`. Excalidraw needs both — the first is how the arrow finds
 * its shapes, the second is how a shape knows to drag its arrows along.
 */
export function bindArrow(
  scene: ExcalidrawScene,
  arrow: ExcalidrawElementData,
  fromId: string,
  toId: string,
): ExcalidrawElementData {
  const from = scene.elements.find((element) => element.id === fromId);
  const to = scene.elements.find((element) => element.id === toId);
  if (!from || !to) {
    const missing = !from ? fromId : toId;
    throw new Error(
      `No element '${missing}' in this drawing. ` +
        'Call excalidrawReadScene to see the element ids it holds.',
    );
  }

  const start = edgePoint(from, centreOf(to));
  const end = edgePoint(to, centreOf(from));

  const bound = {
    ...arrow,
    x: start.x,
    y: start.y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
    points: [
      [0, 0],
      [end.x - start.x, end.y - start.y],
    ],
    startBinding: { elementId: fromId, focus: 0, gap: BINDING_GAP },
    endBinding: { elementId: toId, focus: 0, gap: BINDING_GAP },
  };

  scene.elements = scene.elements.map((element) => {
    if (element.id === fromId || element.id === toId) {
      return addBoundElement(element, String(arrow.id));
    }
    return element;
  });

  return bound;
}

// ============================================================================
// Pure changes to a scene
// ============================================================================

/**
 * Add elements to a scene, binding the arrows whose ends are shapes already
 * in it. Answers the ids made, in the order asked.
 */
export function addToScene(
  scene: ExcalidrawScene,
  asked: Record<string, any>[],
  converters: ExcalidrawConverters,
): string[] {
  const existingIds = new Set(scene.elements.map((element) => String(element.id)));

  /*
   * An arrow whose ends name shapes already in the drawing cannot be bound by
   * the converter, which only knows about the batch it was handed. Those are
   * converted plainly and bound afterwards, against the live scene.
   */
  const batchIds = new Set(asked.map((element) => String(element.id ?? '')).filter(Boolean));
  const deferred = new Map<number, { fromId: string; toId: string }>();
  const prepared = asked.map((element, index) => {
    const { startId, endId } = element;
    const crossesBatch =
      (element.type === 'arrow' || element.type === 'line') &&
      startId &&
      endId &&
      (!batchIds.has(String(startId)) || !batchIds.has(String(endId)));
    if (crossesBatch) {
      deferred.set(index, { fromId: String(startId), toId: String(endId) });
      const { startId: _s, endId: _e, ...rest } = element;
      return rest;
    }
    return element;
  });

  const converted = convertElements(converters, prepared, existingIds);
  scene.elements = [...scene.elements, ...converted.elements];

  for (const [index, ends] of deferred) {
    const arrowId = converted.ids[index];
    const arrow = scene.elements.find((element) => element.id === arrowId);
    if (arrow) {
      const boundArrow = bindArrow(scene, arrow, ends.fromId, ends.toId);
      scene.elements = scene.elements.map((element) =>
        element.id === arrowId ? boundArrow : element,
      );
    }
  }
  return converted.ids;
}

/**
 * Change elements by id. Refuses the whole batch when an id is wrong: half a
 * batch is a drawing nobody asked for.
 */
export function updateInScene(scene: ExcalidrawScene, updates: Record<string, any>[]): void {
  // A shape's text lives in a separate element bound inside it, so "set the
  // text of this rectangle" has to be redirected to that element.
  const boundTextOf = new Map<string, string>();
  for (const element of scene.elements) {
    if (element?.type === 'text' && element?.containerId) {
      boundTextOf.set(String(element.containerId), String(element.id));
    }
  }

  const byId = new Map<string, Record<string, any>>();
  const missing: string[] = [];
  for (const update of updates) {
    const id = String(update.id);
    const target = scene.elements.find((element) => element.id === id);
    if (!target) {
      missing.push(id);
      continue;
    }
    const { id: _ignored, text, ...fields } = update;
    const redirect = target.type !== 'text' && boundTextOf.get(id);
    if (text !== undefined) {
      if (redirect) {
        byId.set(redirect, { ...(byId.get(redirect) ?? {}), text, originalText: text });
      } else {
        fields.text = text;
        fields.originalText = text;
      }
    }
    if (Object.keys(fields).length > 0) {
      byId.set(id, { ...(byId.get(id) ?? {}), ...fields });
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `No element(s) ${missing.map((id) => `'${id}'`).join(', ')} in this drawing. ` +
        'Call excalidrawReadScene to see the element ids it holds.',
    );
  }

  scene.elements = scene.elements.map((element) => {
    const fields = byId.get(String(element.id));
    return fields ? touchElement({ ...element, ...fields }) : element;
  });
}

/**
 * Remove elements by id, with the text bound inside them, detaching the
 * arrows that pointed at them. Answers how many elements went.
 */
export function deleteFromScene(scene: ExcalidrawScene, elementIds: string[]): number {
  const asked = new Set(elementIds.map(String));

  // Text bound inside a deleted shape goes with it; an orphaned label would
  // hang in mid-air where its box used to be.
  const removed = new Set(asked);
  for (const element of scene.elements) {
    if (element?.containerId && asked.has(String(element.containerId))) {
      removed.add(String(element.id));
    }
  }

  const before = scene.elements.length;
  scene.elements = scene.elements
    .filter((element) => !removed.has(String(element.id)))
    // An arrow that pointed at a deleted shape keeps its shape but loses the
    // binding, and every survivor forgets the arrows that went with it.
    .map((element) => {
      const patch: Record<string, any> = {};
      if (removed.has(String(element.startBinding?.elementId))) {
        patch.startBinding = null;
      }
      if (removed.has(String(element.endBinding?.elementId))) {
        patch.endBinding = null;
      }
      if (Array.isArray(element.boundElements)) {
        const kept = element.boundElements.filter(
          (entry: any) => !removed.has(String(entry?.id)),
        );
        if (kept.length !== element.boundElements.length) {
          patch.boundElements = kept;
        }
      }
      return Object.keys(patch).length > 0 ? touchElement({ ...element, ...patch }) : element;
    });
  return before - scene.elements.length;
}

/** Draw a bound arrow between two elements. Answers the arrow's id. */
export function connectInScene(
  scene: ExcalidrawScene,
  args: { fromId: string; toId: string; label?: string; strokeColor?: string; strokeStyle?: string },
  converters: ExcalidrawConverters,
): string {
  const existingIds = new Set(scene.elements.map((element) => String(element.id)));
  const { elements: made, ids } = convertElements(
    converters,
    [
      {
        type: 'arrow',
        x: 0,
        y: 0,
        ...(args.label ? { label: args.label } : {}),
        ...(args.strokeColor ? { strokeColor: args.strokeColor } : {}),
        ...(args.strokeStyle ? { strokeStyle: args.strokeStyle } : {}),
      },
    ],
    existingIds,
  );
  const arrowId = ids[0];
  scene.elements = [...scene.elements, ...made];
  const arrow = scene.elements.find((element) => element.id === arrowId);
  const bound = bindArrow(scene, arrow as ExcalidrawElementData, args.fromId, args.toId);
  scene.elements = scene.elements.map((element) => (element.id === arrowId ? bound : element));
  return arrowId;
}

/** Set the canvas: its colour, and its grid (0 turns it off). */
export function setCanvas(
  scene: ExcalidrawScene,
  args: { viewBackgroundColor?: string; gridSize?: number },
): void {
  if (args.viewBackgroundColor !== undefined) {
    scene.appState.viewBackgroundColor = args.viewBackgroundColor;
  }
  if (args.gridSize !== undefined) {
    // Excalidraw reads a falsy grid size as "no grid", which is what 0 means
    // to a caller.
    scene.appState.gridSize = Number(args.gridSize) || null;
  }
}

/** Turn Mermaid source into Excalidraw elements and files. */
async function mermaidToScene(
  converters: ExcalidrawConverters,
  source: string,
  fontSize: number | undefined,
): Promise<{ elements: ExcalidrawElementData[]; files: Record<string, any> }> {
  if (!converters.parseMermaidToExcalidraw) {
    throw new Error(
      'This host does not convert Mermaid: it was given no parseMermaidToExcalidraw.',
    );
  }
  let parsed;
  try {
    parsed = await converters.parseMermaidToExcalidraw(source, { fontSize });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `That Mermaid source did not parse: ${message}. ` +
        'Flowcharts, sequence diagrams and class diagrams are the ones that convert to shapes.',
      { cause: error },
    );
  }
  return {
    elements: [...converters.convertToExcalidrawElements(parsed.elements as Record<string, any>[])],
    files: (parsed.files ?? {}) as Record<string, any>,
  };
}

// ============================================================================
// The handlers
// ============================================================================

/**
 * Every Excalidraw handler, keyed by the operation the executor looks up,
 * over one host.
 */
export function createExcalidrawToolHandlers(
  host: ExcalidrawDrawingHost,
  converters: ExcalidrawConverters,
): Record<string, ExcalidrawToolHandler> {
  const change = async (
    blockId: string,
    edit: (scene: ExcalidrawScene) => Record<string, unknown> | void,
  ) => {
    const scene = await host.readDrawing(blockId);
    const extra = edit(scene) ?? {};
    await host.writeDrawing(blockId, scene);
    return sceneResult(blockId, scene, extra);
  };

  return {
    excalidrawInsertNode: async (args) => {
      const asked = (args.elements as Record<string, any>[] | undefined) ?? [];
      const scene: ExcalidrawScene = { elements: [], appState: {}, files: {} };
      const createdIds = asked.length > 0 ? addToScene(scene, asked, converters) : [];
      const blockId = await host.insertDrawing(scene, {
        afterId: String(args.afterId ?? 'BOTTOM'),
        width: args.width as number | undefined,
        height: args.height as number | undefined,
      });
      return sceneResult(blockId, scene, {
        createdIds,
        message: `Drawing inserted with ${scene.elements.length} element(s)`,
      });
    },

    excalidrawListDrawings: async () => {
      const drawings = (await host.listDrawings()).map((drawing) => ({
        blockId: drawing.id,
        elementCount: liveElements(drawing.scene).length,
        description: describeScene(drawing.scene),
        width: drawing.width,
        height: drawing.height,
      }));
      return { drawings, count: drawings.length };
    },

    excalidrawReadScene: async (args) => {
      const blockId = String(args.blockId);
      const scene = await host.readDrawing(blockId);
      const live = liveElements(scene);
      return {
        blockId,
        elementCount: live.length,
        elements: args.detail === 'full' ? live : withBoundText(live),
        appState: scene.appState,
        description: describeScene(scene),
      };
    },

    excalidrawAddElements: async (args) =>
      change(String(args.blockId), (scene) => {
        const createdIds = addToScene(
          scene,
          (args.elements as Record<string, any>[]) ?? [],
          converters,
        );
        return { createdIds, message: `Added ${createdIds.length} element(s)` };
      }),

    excalidrawUpdateElements: async (args) =>
      change(String(args.blockId), (scene) => {
        const updates = (args.updates as Record<string, any>[]) ?? [];
        updateInScene(scene, updates);
        return { message: `Updated ${updates.length} element(s)` };
      }),

    excalidrawDeleteElements: async (args) =>
      change(String(args.blockId), (scene) => ({
        message: `Removed ${deleteFromScene(scene, args.elementIds as string[])} element(s)`,
      })),

    excalidrawConnectElements: async (args) =>
      change(String(args.blockId), (scene) => {
        const fromId = String(args.fromId);
        const toId = String(args.toId);
        const arrowId = connectInScene(
          scene,
          {
            fromId,
            toId,
            label: args.label as string | undefined,
            strokeColor: args.strokeColor as string | undefined,
            strokeStyle: args.strokeStyle as string | undefined,
          },
          converters,
        );
        return { createdIds: [arrowId], message: `Connected '${fromId}' to '${toId}'` };
      }),

    excalidrawSetAppState: async (args) =>
      change(String(args.blockId), (scene) => {
        setCanvas(scene, {
          viewBackgroundColor: args.viewBackgroundColor as string | undefined,
          gridSize: args.gridSize as number | undefined,
        });
        return { message: 'Canvas updated' };
      }),

    excalidrawResize: async (args) => {
      const blockId = String(args.blockId);
      const width = args.width === undefined ? 'inherit' : Number(args.width);
      const height = args.height === undefined ? 'inherit' : Number(args.height);
      await host.resizeDrawing(blockId, width, height);
      const scene = await host.readDrawing(blockId);
      return sceneResult(blockId, scene, {
        message:
          width === 'inherit' && height === 'inherit'
            ? 'Drawing sized to its content'
            : `Drawing sized to ${width} x ${height}`,
      });
    },

    excalidrawClearScene: async (args) =>
      change(String(args.blockId), (scene) => {
        const removed = liveElements(scene).length;
        scene.elements = [];
        scene.files = {};
        return { message: `Emptied the drawing (${removed} element(s) removed)` };
      }),

    excalidrawFromMermaid: async (args) => {
      const { elements, files } = await mermaidToScene(
        converters,
        String(args.mermaid),
        args.fontSize ? Number(args.fontSize) : undefined,
      );
      const createdIds = elements.map((element) => String(element.id));
      // Replacing a drawing, or making one.
      if (args.blockId) {
        return change(String(args.blockId), (scene) => {
          scene.elements = elements;
          scene.files = files;
          return {
            createdIds,
            message: `Drawing replaced with ${elements.length} element(s) from Mermaid`,
          };
        });
      }
      const scene: ExcalidrawScene = { elements, appState: {}, files };
      const blockId = await host.insertDrawing(scene, { afterId: String(args.afterId ?? 'BOTTOM') });
      return sceneResult(blockId, scene, {
        createdIds,
        message: `Drawing inserted with ${elements.length} element(s) from Mermaid`,
      });
    },
  };
}
