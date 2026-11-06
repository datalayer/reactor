/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * The Zod → JSON Schema conversion every tool definition goes through.
 *
 * This is the only description of a tool the model ever sees: the Zod schema
 * stays in the process, the JSON Schema is what crosses the wire. So anything
 * the conversion flattens is a parameter the model has to guess at, and the
 * two things it used to flatten were the ones that matter most for a tool
 * whose input is more than a bag of scalars — the shape of an array's
 * elements, and the properties of a nested object.
 *
 * Moved with the conversion from jupyter-react (6 November 2026).
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { validateWithZod, zodToToolParameters } from '../zodUtils';

describe('what the model is told a tool takes', () => {
  it('describes the elements of an array, not just that it is an array', () => {
    const schema = z.object({
      elements: z
        .array(
          z.object({
            type: z.enum(['rectangle', 'ellipse']).describe('Shape'),
            x: z.number(),
            label: z.string().optional(),
          })
        )
        .describe('The shapes to draw'),
    });

    const parameters = zodToToolParameters(schema);
    const elements = parameters.properties.elements as Record<string, any>;

    expect(elements.type).toBe('array');
    expect(elements.description).toBe('The shapes to draw');
    // The part that used to be `{ type: 'string' }`.
    expect(elements.items.type).toBe('object');
    expect(elements.items.properties.type).toEqual({
      description: 'Shape',
      type: 'string',
      enum: ['rectangle', 'ellipse'],
    });
    expect(elements.items.properties.x).toEqual({ type: 'number' });
    // Optional inside a nested object is still optional.
    expect(elements.items.required).toEqual(['type', 'x']);
  });

  it('descends into a nested object', () => {
    const schema = z.object({
      style: z.object({
        strokeColor: z.string().describe('CSS colour'),
        opacity: z.number().optional(),
      }),
    });

    const style = zodToToolParameters(schema).properties.style as Record<
      string,
      any
    >;

    expect(style.type).toBe('object');
    expect(style.properties.strokeColor.description).toBe('CSS colour');
    expect(style.required).toEqual(['strokeColor']);
  });

  it('keeps a description that was written before a wrapper', () => {
    /*
     * `z.preprocess(coerce, z.number().describe(...))` puts the description
     * on the inner schema. Reading only the outer one dropped it, so two of
     * the notebook tools shipped an undescribed `index` parameter.
     */
    const schema = z.object({
      index: z.preprocess(
        value => (typeof value === 'string' ? Number(value) : value),
        z.number().int().describe('Cell index (0-based)')
      ),
    });

    expect(zodToToolParameters(schema).properties.index).toEqual({
      description: 'Cell index (0-based)',
      type: 'number',
    });
  });

  it('reads a union of literals as one enum', () => {
    const schema = z.object({
      align: z.union([z.literal('left'), z.literal('center')]),
    });

    expect(zodToToolParameters(schema).properties.align).toEqual({
      type: 'string',
      enum: ['left', 'center'],
    });
  });

  it('offers a mixed union as alternatives', () => {
    const schema = z.object({
      width: z.union([z.number(), z.literal('inherit')]),
    });

    const width = zodToToolParameters(schema).properties.width as Record<
      string,
      any
    >;
    expect(width.anyOf).toEqual([
      { type: 'number' },
      { type: 'string', enum: ['inherit'] },
    ]);
  });

  it('still flattens an open map to an object, as before', () => {
    // A record's keys are not knowable, so there is nothing truthful to say
    // beyond "an object" — this is the one place flattening is right.
    const schema = z.object({
      metadata: z.record(z.string(), z.unknown()).optional(),
    });

    expect(zodToToolParameters(schema).properties.metadata).toEqual({
      type: 'object',
    });
    expect(zodToToolParameters(schema).required).toEqual([]);
  });

  it('promises nothing about a value the schema left open', () => {
    const schema = z.object({ payload: z.unknown() });

    expect(zodToToolParameters(schema).properties.payload).toEqual({});
  });

  it('keeps null beside the type of a nullable field, as a value the tool accepts', () => {
    const schema = z.object({
      value: z.string().nullable(),
      kind: z.enum(['a', 'b']).nullable().optional(),
    });
    const parameters = zodToToolParameters(schema);
    expect(parameters.properties.value).toEqual({ type: ['string', 'null'] });
    expect(parameters.properties.kind).toEqual({ type: ['string', 'null'], enum: ['a', 'b', null] });
    expect(parameters.required).toEqual(['value']);
  });

  it('describes an ordinary pipe by its input, and a preprocess by the schema after it', () => {
    const schema = z.object({
      count: z.number().transform(String),
      index: z.preprocess(value => (typeof value === 'string' ? Number(value) : value), z.number()),
    });
    const parameters = zodToToolParameters(schema);
    // What a caller sends is a number, whatever the transform makes of it.
    expect(parameters.properties.count).toEqual({ type: 'number' });
    expect(parameters.properties.index).toEqual({ type: 'number' });
  });

  it('keeps literals of several types as branches, so that 0 beside auto is still a number', () => {
    const schema = z.object({ width: z.union([z.literal('auto'), z.literal(0)]) });
    expect(zodToToolParameters(schema).properties.width).toEqual({
      anyOf: [
        { type: 'string', enum: ['auto'] },
        { type: 'number', enum: [0] },
      ],
    });
  });

  it('stops rather than recursing forever', () => {
    // A schema deep enough to prove the guard fires without hanging the run.
    let deep: z.ZodTypeAny = z.string();
    for (let level = 0; level < 30; level += 1) {
      deep = z.object({ next: deep });
    }

    expect(() => zodToToolParameters(z.object({ root: deep }))).not.toThrow();
  });
});

describe('what a tool is told when its parameters are wrong', () => {
  it('names each issue by its path, and the parameters received', () => {
    const schema = z.object({ index: z.number().int(), source: z.string() });
    expect(validateWithZod(schema, { index: 1, source: 'x' }, 'updateCell')).toEqual({ index: 1, source: 'x' });
    expect(() => validateWithZod(schema, { index: 'one' }, 'updateCell')).toThrow(/Invalid parameters for updateCell[\s\S]*index[\s\S]*source[\s\S]*Received: \{"index":"one"\}/);
  });

  it('reads a Zod error by its shape, so a schema from another copy of Zod is refused the same way', () => {
    const foreign = {
      parse: () => {
        throw { issues: [{ path: ['x'], message: 'wanted' }] };
      },
    } as unknown as z.ZodType<unknown>;
    expect(() => validateWithZod(foreign, {}, 'op')).toThrow(/Invalid parameters for op:\n  - x: wanted/);
  });
});
