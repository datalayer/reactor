/*
 * Copyright (c) 2021-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * What the tools do to a drawing.
 *
 * The host and Excalidraw itself are stood in for, which leaves exactly the
 * part worth testing: the bookkeeping between a caller's request and a scene
 * that Excalidraw will still agree with afterwards. Most of that bookkeeping
 * is about relationships the caller never mentions — an arrow is bound at
 * both ends *and* listed on both shapes, a label lives in a separate element
 * that has to be found, deleting a box has to take its label and detach its
 * arrows — and every one of those is a way for a drawing to end up subtly
 * wrong rather than obviously broken.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { createExcalidrawToolHandlers, edgePoint } from '../src/handlers';
import { createMemoryDrawingHost, type ExcalidrawConverters } from '../src/host';
import type { ExcalidrawScene } from '../src/scene';

/**
 * A converter that behaves like Excalidraw's in the ways these handlers rely
 * on — it keeps the ids it is given, defaults a shape's size, and turns a
 * `label` into a bound text element — without pulling in the real one, which
 * is a browser bundle several megabytes wide.
 */
const converters: ExcalidrawConverters = {
  convertToExcalidrawElements: (skeletons) => {
    const out: any[] = [];
    for (const skeleton of skeletons) {
      const { label, start, end, ...rest } = skeleton;
      const element: any = {
        width: 100,
        height: 100,
        strokeColor: '#1e1e1e',
        version: 1,
        ...rest,
      };
      out.push(element);
      if (label?.text) {
        out.push({
          id: `${skeleton.id}-label`,
          type: 'text',
          text: label.text,
          containerId: skeleton.id,
          x: element.x,
          y: element.y,
          version: 1,
        });
        element.boundElements = [{ id: `${skeleton.id}-label`, type: 'text' }];
      }
    }
    return out;
  },
  parseMermaidToExcalidraw: async (source) => {
    if (!source.startsWith('flowchart')) {
      throw new Error('Unknown diagram');
    }
    return { elements: [{ id: 'm1', type: 'rectangle', x: 0, y: 0 }], files: {} };
  },
};

let host = createMemoryDrawingHost();
let handlers = createExcalidrawToolHandlers(host, converters);

/** A drawing the test controls. */
function makeDrawing(id: string, scene: Partial<ExcalidrawScene> = {}) {
  host.set({
    id,
    scene: { elements: scene.elements ?? [], appState: scene.appState ?? {}, files: scene.files ?? {} },
  });
}

const sceneOf = (id: string) => host.get(id)!.scene;

/** One element by id, failing the test rather than the type-checker. */
function elementOf(id: string, elementId: string): any {
  const found = sceneOf(id).elements.find((e: any) => e.id === elementId);
  if (!found) {
    throw new Error(`No element '${elementId}' in drawing '${id}'`);
  }
  return found;
}

beforeEach(() => {
  host = createMemoryDrawingHost();
  handlers = createExcalidrawToolHandlers(host, converters);
});

describe('finding the drawing', () => {
  it('refuses an id that is no drawing, and says how to find one', async () => {
    await expect(handlers.excalidrawReadScene({ blockId: 'nope' })).rejects.toThrow(
      /No drawing 'nope'.*excalidrawListDrawings/,
    );
  });
});

describe('drawing something new', () => {
  it('inserts a drawing and reports the ids it made', async () => {
    const result: any = await handlers.excalidrawInsertNode({
      afterId: 'BOTTOM',
      elements: [{ id: 'box', type: 'rectangle', x: 0, y: 0, label: 'Start' }],
    });

    expect(result.success).toBe(true);
    expect(result.createdIds).toEqual(['box']);
    // The label became its own element, bound to the box.
    const scene = sceneOf(result.blockId);
    expect(scene.elements.map((e: any) => e.type)).toEqual(['rectangle', 'text']);
    expect(scene.elements[1].containerId).toBe('box');
  });

  it('puts a new drawing where it was asked', async () => {
    makeDrawing('a');
    makeDrawing('b');
    const result: any = await handlers.excalidrawInsertNode({ afterId: 'a' });
    const listed: any = await handlers.excalidrawListDrawings({});
    expect(listed.drawings.map((d: any) => d.blockId)).toEqual(['a', result.blockId, 'b']);
  });

  it('keeps the id a caller chose, so the next call can use it', async () => {
    // Excalidraw's converter regenerates ids by default, which would make
    // every id a caller wrote meaningless one call later.
    const result: any = await handlers.excalidrawInsertNode({
      afterId: 'TOP',
      elements: [{ id: 'mine', type: 'ellipse', x: 0, y: 0 }],
    });

    expect(result.createdIds).toEqual(['mine']);
  });

  it('gives an unnamed element an id of its own', async () => {
    const result: any = await handlers.excalidrawInsertNode({
      afterId: 'TOP',
      elements: [{ type: 'diamond', x: 0, y: 0 }],
    });

    expect(result.createdIds[0]).toMatch(/^dla-/);
  });
});

describe('adding to a drawing that exists', () => {
  it('leaves what is already there alone', async () => {
    makeDrawing('1', {
      elements: [{ id: 'old', type: 'rectangle', x: 0, y: 0 }],
    });

    await handlers.excalidrawAddElements({
      blockId: '1',
      elements: [{ id: 'new', type: 'ellipse', x: 200, y: 0 }],
    });

    expect(sceneOf('1').elements.map((e: any) => e.id)).toEqual(['old', 'new']);
  });

  it('will not let a new element overwrite an existing one', async () => {
    // A caller reusing an id it liked would otherwise silently replace a
    // shape somebody else drew.
    makeDrawing('1', {
      elements: [{ id: 'box', type: 'rectangle', x: 0, y: 0 }],
    });

    const result: any = await handlers.excalidrawAddElements({ blockId: '1', elements: [{ id: 'box', type: 'ellipse', x: 50, y: 0 }] },
    );

    expect(result.createdIds[0]).not.toBe('box');
    expect(sceneOf('1').elements).toHaveLength(2);
  });

  it('binds an arrow to shapes that were already in the drawing', async () => {
    /*
     * The converter can only bind within the batch it is handed, so an arrow
     * joining two shapes that are already on the canvas has to be bound
     * afterwards — otherwise it is a line that merely happens to sit between
     * them, and stays put when either is dragged.
     */
    makeDrawing('1', {
      elements: [
        { id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 100 },
        { id: 'b', type: 'rectangle', x: 300, y: 0, width: 100, height: 100 },
      ],
    });

    const result: any = await handlers.excalidrawAddElements({
        blockId: '1',
        elements: [
          { id: 'link', type: 'arrow', x: 0, y: 0, startId: 'a', endId: 'b' },
        ],
      },
    );

    const arrow = elementOf('1', result.createdIds[0]);
    expect(arrow.startBinding.elementId).toBe('a');
    expect(arrow.endBinding.elementId).toBe('b');
    // And both shapes know about it, which is what makes them drag it along.
    for (const id of ['a', 'b']) {
      expect(elementOf('1', id).boundElements).toContainEqual({
        id: arrow.id,
        type: 'arrow',
      });
    }
  });
});

describe('connecting two shapes', () => {
  beforeEach(() => {
    makeDrawing('1', {
      elements: [
        { id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 100 },
        { id: 'b', type: 'rectangle', x: 400, y: 0, width: 100, height: 100 },
      ],
    });
  });

  it('draws the arrow between their facing edges, not their centres', async () => {
    const result: any = await handlers.excalidrawConnectElements({ blockId: '1', fromId: 'a', toId: 'b' },
    );

    const arrow = elementOf('1', result.createdIds[0]);
    // Leaves 'a' at its right edge (100) plus the binding gap, and stops at
    // 'b' at its left edge (400) minus the gap.
    expect(arrow.x).toBeCloseTo(104, 0);
    expect(arrow.x + arrow.points[1][0]).toBeCloseTo(396, 0);
    // Horizontal, because the two boxes are level.
    expect(arrow.points[1][1]).toBeCloseTo(0, 0);
  });

  it('says which shape it could not find', async () => {
    await expect(
      handlers.excalidrawConnectElements({
        blockId: '1',
        fromId: 'a',
        toId: 'ghost',
      }),
    ).rejects.toThrow(/No element 'ghost'/);
  });
});

describe('changing what is there', () => {
  it('moves and recolours by id, leaving the rest untouched', async () => {
    makeDrawing('1', {
      elements: [
        { id: 'a', type: 'rectangle', x: 0, y: 0, version: 3, roughness: 1 },
        { id: 'b', type: 'rectangle', x: 0, y: 0, version: 3 },
      ],
    });

    await handlers.excalidrawUpdateElements({
      blockId: '1',
      updates: [{ id: 'a', x: 50, strokeColor: '#e03131' }],
    });

    const [a, b] = sceneOf('1').elements;
    expect(a.x).toBe(50);
    expect(a.strokeColor).toBe('#e03131');
    // Untouched fields survive, and the version moves on.
    expect(a.roughness).toBe(1);
    expect(a.version).toBe(4);
    expect(b.version).toBe(3);
  });

  it("rewrites a shape's label rather than writing text onto the shape", async () => {
    /*
     * "Rename this box" names the box, but the text is a different element.
     * Writing `text` onto a rectangle would produce a rectangle with a field
     * Excalidraw does not draw, and leave the old label showing.
     */
    makeDrawing('1', {
      elements: [
        { id: 'a', type: 'rectangle', x: 0, y: 0 },
        { id: 'a-label', type: 'text', text: 'Before', containerId: 'a' },
      ],
    });

    await handlers.excalidrawUpdateElements({
      blockId: '1',
      updates: [{ id: 'a', text: 'After' }],
    });

    const [box, label] = sceneOf('1').elements;
    expect(box.text).toBeUndefined();
    expect(label.text).toBe('After');
    expect(label.originalText).toBe('After');
  });

  it('refuses the whole call when an id is wrong', async () => {
    // Half-applying a batch would leave a drawing nobody asked for.
    makeDrawing('1', {
      elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0 }],
    });

    await expect(
      handlers.excalidrawUpdateElements({
        blockId: '1',
        updates: [
          { id: 'a', x: 10 },
          { id: 'ghost', x: 10 },
        ],
      }),
    ).rejects.toThrow(/No element\(s\) 'ghost'/);
    expect(sceneOf('1').elements[0].x).toBe(0);
  });
});

describe('taking things out', () => {
  it("takes a shape's label with it and detaches its arrows", async () => {
    makeDrawing('1', {
      elements: [
        {
          id: 'a',
          type: 'rectangle',
          x: 0,
          y: 0,
          boundElements: [
            { id: 'a-label', type: 'text' },
            { id: 'link', type: 'arrow' },
          ],
        },
        { id: 'a-label', type: 'text', text: 'Start', containerId: 'a' },
        {
          id: 'b',
          type: 'rectangle',
          x: 300,
          y: 0,
          boundElements: [{ id: 'link', type: 'arrow' }],
        },
        {
          id: 'link',
          type: 'arrow',
          x: 0,
          y: 0,
          startBinding: { elementId: 'a', focus: 0, gap: 4 },
          endBinding: { elementId: 'b', focus: 0, gap: 4 },
        },
      ],
    });

    await handlers.excalidrawDeleteElements({
      blockId: '1',
      elementIds: ['a'],
    });

    // The box and its label are gone; the arrow and the other box remain.
    expect(
      sceneOf('1')
        .elements.map((e: any) => e.id)
        .sort(),
    ).toEqual(['b', 'link']);
    const arrow = elementOf('1', 'link');
    expect(arrow.startBinding).toBeNull();
    expect(arrow.endBinding).toEqual({ elementId: 'b', focus: 0, gap: 4 });
    // And 'b' no longer claims an arrow bound to a shape that has gone.
    expect(elementOf('1', 'b').boundElements).toEqual([
      { id: 'link', type: 'arrow' },
    ]);
  });

  it('empties a drawing without removing it', async () => {
    makeDrawing('1', {
      elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0 }],
    });

    const result: any = await handlers.excalidrawClearScene({ blockId: '1' });

    expect(result.elementCount).toBe(0);
    expect(host.get('1')).toBeDefined();
  });
});

describe('the canvas and the frame around it', () => {
  it('sets the background and turns the grid off with a zero', async () => {
    makeDrawing('1');

    await handlers.excalidrawSetAppState({
      blockId: '1',
      viewBackgroundColor: '#fffbe6',
      gridSize: 0,
    });

    const { appState } = sceneOf('1');
    expect(appState.viewBackgroundColor).toBe('#fffbe6');
    // Excalidraw reads a falsy grid size as "no grid".
    expect(appState.gridSize).toBeNull();
  });

  it('sizes the drawing, and goes back to sizing by content', async () => {
    makeDrawing('1');

    await handlers.excalidrawResize({
      blockId: '1',
      width: 640,
      height: 480,
    });
    expect([host.get('1')!.width, host.get('1')!.height]).toEqual([640, 480]);

    await handlers.excalidrawResize({
      blockId: '1',
    });
    expect([host.get('1')!.width, host.get('1')!.height]).toEqual([undefined, undefined]);
  });
});

describe('where an arrow meets a box', () => {
  const box = (x: number, y: number) => ({
    id: 'x',
    type: 'rectangle',
    x,
    y,
    width: 100,
    height: 100,
  });

  it('leaves through the side it is heading for', () => {
    // Straight right: out of the right edge, level with the centre.
    const point = edgePoint(box(0, 0), { x: 500, y: 50 });
    expect(point.x).toBeCloseTo(104, 0);
    expect(point.y).toBeCloseTo(50, 0);
  });

  it('leaves through the top when the target is above', () => {
    const point = edgePoint(box(0, 0), { x: 50, y: -500 });
    expect(point.x).toBeCloseTo(50, 0);
    expect(point.y).toBeCloseTo(-4, 0);
  });

  it('gives up gracefully on two shapes in the same place', () => {
    const point = edgePoint(box(0, 0), { x: 50, y: 50 });
    expect(point).toEqual({ x: 50, y: 50 });
  });
});

describe('from Mermaid', () => {
  it('makes a drawing of the shapes the source converts to', async () => {
    const result: any = await handlers.excalidrawFromMermaid({ mermaid: 'flowchart LR; A-->B' });
    expect(result.createdIds).toEqual(['m1']);
    expect(sceneOf(result.blockId).elements).toHaveLength(1);
  });

  it('replaces a drawing it is pointed at', async () => {
    makeDrawing('1', { elements: [{ id: 'old', type: 'ellipse', x: 0, y: 0 }] });
    await handlers.excalidrawFromMermaid({ blockId: '1', mermaid: 'flowchart TD; A-->B' });
    expect(sceneOf('1').elements.map((e: any) => e.id)).toEqual(['m1']);
  });

  it('passes on why the source did not parse', async () => {
    await expect(handlers.excalidrawFromMermaid({ mermaid: 'nonsense' })).rejects.toThrow(
      /did not parse: Unknown diagram/,
    );
  });

  it('says so when the host converts no Mermaid', async () => {
    const plain = createExcalidrawToolHandlers(host, {
      convertToExcalidrawElements: converters.convertToExcalidrawElements,
    });
    await expect(plain.excalidrawFromMermaid({ mermaid: 'flowchart LR; A-->B' })).rejects.toThrow(
      /no parseMermaidToExcalidraw/,
    );
  });
});
