/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */


/**
 * Zod utility functions for tool parameter validation.
 *
 * Moved here from `@datalayer/jupyter-react/tools` (6 November 2026), so
 * that every host's tools are described to a model the same way.
 *
 * @module tools/zodUtils
 */

import { z } from 'zod';

/** A Zod error, whichever Zod made it: it carries `issues`. */
const isZodError = (error: unknown): error is z.ZodError =>
  typeof error === 'object' && error !== null && Array.isArray((error as { issues?: unknown }).issues);
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolParameters } from './schema';

/**
 * A JSON Schema fragment describing one parameter.
 */
type JsonSchemaNode = Record<string, unknown>;

/** Zod v3 keeps its innards on `_def`, Zod v4 on `_def` or `def`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const defOf = (field: any) => field?._def ?? field?.def;

/**
 * What kind of schema this is, across both Zod versions.
 *
 * v3 answers with a class name (`ZodString`), v4 with a lowercase tag
 * (`string`). Callers compare against both.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const kindOf = (field: any): string | undefined => {
  const def = defOf(field);
  return def?.typeName ?? def?.type;
};

/** The `.describe()` text, wherever the Zod version keeps it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const descriptionOf = (field: any): string | undefined =>
  defOf(field)?.description ?? field?.description;

/**
 * Strip the wrappers that say *how* a value arrives rather than *what* it is.
 *
 * `optional`, `default`, `nullable`, `readonly`, and the `preprocess` pipe all
 * wrap another schema. JSON Schema has no equivalent for most of them — what
 * an LLM needs is the shape underneath plus whether the field is required —
 * so they are peeled off here.
 *
 * The description is collected on the way down. `.describe()` can sit on
 * either side of `.optional()` depending on the order they were written, and
 * Zod v4 puts it on the instance rather than on `_def`; the outermost one
 * found wins, which is the one the author wrote last.
 */
function unwrap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  field: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): { schema: any; optional: boolean; nullable: boolean; description?: string } {
  let schema = field;
  let optional = false;
  let nullable = false;
  let description: string | undefined;

  for (let depth = 0; schema && depth < 20; depth += 1) {
    description = description ?? descriptionOf(schema);
    const kind = kindOf(schema);
    const def = defOf(schema);

    if (
      kind === 'ZodOptional' ||
      kind === 'optional' ||
      kind === 'ZodDefault' ||
      kind === 'default'
    ) {
      optional = true;
      schema = def?.innerType;
      continue;
    }
    if (kind === 'ZodNullable' || kind === 'nullable') {
      // Null is a value the tool accepts: kept, and said beside the type.
      nullable = true;
      schema = def?.innerType;
      continue;
    }
    if (kind === 'ZodReadonly' || kind === 'readonly') {
      schema = def?.innerType;
      continue;
    }
    if (kind === 'ZodEffects' || kind === 'effects') {
      // v3: preprocess, refine and transform all wrap the schema the input is read with.
      schema = def?.schema ?? def?.innerType;
      continue;
    }
    if (kind === 'pipe') {
      // v4: `preprocess` is a pipe whose `in` is the transform and whose `out`
      // is the real schema; any other pipe (`.transform`, `.pipe`) is read
      // by its input, which is what a caller has to send.
      const inKind = kindOf(def?.in);
      schema = inKind === 'transform' || inKind === 'ZodTransform' ? def?.out : (def?.in ?? def?.out);
      continue;
    }
    break;
  }

  return { schema, optional, nullable, description };
}

/** The literal values of an enum, across both Zod versions. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const enumValuesOf = (field: any): unknown[] => {
  const def = defOf(field);
  const values =
    def?.values ??
    field?.options ??
    (def?.entries ? Object.keys(def.entries) : null) ??
    (field?.enum ? Object.keys(field.enum) : null) ??
    [];
  return Array.isArray(values) ? values : Object.keys(values ?? {});
};

/**
 * One Zod field as a JSON Schema node.
 *
 * Recursive, which is the whole point: a tool that takes a list of drawing
 * elements needs `items` to describe an object with its own properties, not
 * the string this used to fall back to. `depth` stops a self-referential
 * schema from running forever; six levels is deeper than any tool parameter
 * anybody should be writing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fieldToJsonSchema(field: any, depth = 0): JsonSchemaNode {
  const { schema, nullable, description } = unwrap(field);
  const node = fieldNode(schema, depth);
  if (description) {
    node.description = description;
  }
  if (nullable) {
    // `null` beside the type when there is one type; as a branch otherwise.
    if (typeof node.type === 'string') {
      node.type = [node.type, 'null'];
      if (Array.isArray(node.enum)) {
        node.enum = [...node.enum, null];
      }
    } else if (Array.isArray(node.anyOf)) {
      node.anyOf = [...(node.anyOf as unknown[]), { type: 'null' }];
    } else {
      node.anyOf = [{ ...node }, { type: 'null' }];
      delete node.type;
    }
  }
  return node;
}

/** The node of an unwrapped schema: its type, enum, items, properties or branches. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fieldNode(schema: any, depth: number): JsonSchemaNode {
  const node: JsonSchemaNode = {};

  if (!schema || depth > 6) {
    node.type = 'string';
    return node;
  }

  const kind = kindOf(schema);
  const def = defOf(schema);

  switch (true) {
    case kind === 'ZodString' || kind === 'string':
      node.type = 'string';
      break;

    case kind === 'ZodNumber' || kind === 'number' || kind === 'int':
      node.type = 'number';
      break;

    case kind === 'ZodBoolean' || kind === 'boolean':
      node.type = 'boolean';
      break;

    case kind === 'ZodNull' || kind === 'null':
      node.type = 'null';
      break;

    case kind === 'ZodEnum' || kind === 'enum' || kind === 'nativeEnum': {
      node.type = 'string';
      node.enum = enumValuesOf(schema);
      break;
    }

    case kind === 'ZodLiteral' || kind === 'literal': {
      const values = Array.isArray(def?.values)
        ? def.values
        : [def?.value].filter(value => value !== undefined);
      const [first] = values;
      node.type =
        typeof first === 'number'
          ? 'number'
          : typeof first === 'boolean'
            ? 'boolean'
            : 'string';
      node.enum = values;
      break;
    }

    case kind === 'ZodArray' || kind === 'array': {
      node.type = 'array';
      node.items = fieldToJsonSchema(def?.element ?? def?.type, depth + 1);
      break;
    }

    case kind === 'ZodObject' || kind === 'object': {
      Object.assign(node, objectToJsonSchema(schema, depth));
      break;
    }

    case kind === 'ZodRecord' || kind === 'record': {
      // An open map of keys. JSON Schema says "an object", and saying more
      // than that about keys nobody has named would be a guess.
      node.type = 'object';
      break;
    }

    case kind === 'ZodUnion' || kind === 'union': {
      const options: unknown[] = def?.options ?? [];
      const branches = options.map(option =>
        fieldToJsonSchema(option, depth + 1)
      );
      // A union of literals of one type is an enum, which reads far better to
      // a model than the same thing spelled as a list of one-value branches;
      // literals of several types stay branches, so that `0` beside `'auto'`
      // is still a number.
      const literals =
        branches.every(branch => Array.isArray(branch.enum) && branch.enum.length > 0) &&
        new Set(branches.map(branch => branch.type)).size === 1;
      if (literals && branches.length > 0) {
        node.type = branches[0].type;
        node.enum = branches.flatMap(branch => branch.enum as unknown[]);
      } else if (branches.length > 0) {
        node.anyOf = branches;
      } else {
        node.type = 'string';
      }
      break;
    }

    case kind === 'ZodAny' ||
      kind === 'any' ||
      kind === 'ZodUnknown' ||
      kind === 'unknown':
      // Deliberately typeless: "anything goes" is what the schema said.
      break;

    default:
      // Unknown construct. A string is the safest thing to promise.
      node.type = 'string';
      break;
  }

  return node;
}

/** An object schema's `properties` and `required`, recursively. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function objectToJsonSchema(schema: any, depth: number): JsonSchemaNode {
  const rawShape = defOf(schema)?.shape;
  const shape = typeof rawShape === 'function' ? rawShape() : rawShape;
  const properties: Record<string, JsonSchemaNode> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape ?? {})) {
    properties[key] = fieldToJsonSchema(value, depth + 1);
    if (!unwrap(value).optional) {
      required.push(key);
    }
  }

  return { type: 'object', properties, required };
}

/**
 * Converts a Zod schema to ToolDefinition parameters (JSON Schema format).
 *
 * This enables a single source of truth: define the schema once with Zod,
 * and automatically generate the JSON Schema for LLM tool calling.
 *
 * Nested structure survives the conversion: an object's properties, an
 * array's element type, and unions are all described rather than flattened
 * to `string`. That matters for any tool whose parameters are richer than a
 * bag of scalars — a list of drawing elements, say — because the model only
 * sees this JSON Schema, not the Zod schema it came from.
 *
 * @param schema - Zod schema defining the tool's input parameters
 * @returns JSON Schema object compatible with ToolDefinition.parameters
 *
 * @example
 * ```typescript
 * const schema = z.object({
 *   index: z.number().int().describe('Cell index'),
 *   source: z.string().describe('Cell content')
 * });
 *
 * const parameters = zodToToolParameters(schema);
 * // Returns: { type: 'object', properties: {...}, required: [...] }
 * ```
 */
export function zodToToolParameters(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any
): ToolParameters {
  // Manual conversion for Zod v3/v4 compatibility
  // zod-to-json-schema@3.x doesn't fully support Zod v4
  const kind = kindOf(schema);
  if ((kind === 'ZodObject' || kind === 'object') && defOf(schema)?.shape) {
    return objectToJsonSchema(schema, 0) as unknown as ToolParameters;
  }

  // Fallback to zod-to-json-schema for other schema types
  // Note: This may not work correctly with Zod v4
  const jsonSchema = zodToJsonSchema(schema, {
    target: 'openApi3',
    $refStrategy: 'none',
  }) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };

  const schemaProperties = jsonSchema.properties || {};
  const requiredFields = jsonSchema.required || [];

  return {
    type: 'object' as const,
    properties: schemaProperties,
    required: requiredFields,
  };
}

/**
 * Validates parameters using a Zod schema with user-friendly error messages.
 *
 * This replaces manual type guard functions with automatic runtime validation.
 * On validation failure, throws a descriptive error that helps both developers
 * and LLMs understand what went wrong.
 *
 * @param schema - Zod schema to validate against
 * @param params - Unknown parameters to validate
 * @param operationName - Name of the operation (for error messages)
 * @returns Validated parameters with proper TypeScript type
 * @throws Error with detailed validation failure information
 *
 * @example
 * ```typescript
 * const schema = z.object({ index: z.number().int() });
 *
 * // Valid params
 * const validated = validateWithZod(schema, { index: 5 }, 'readCell');
 * // Returns: { index: 5 } with type { index: number }
 *
 * // Invalid params
 * validateWithZod(schema, { index: 'invalid' }, 'readCell');
 * // Throws: Error: Invalid parameters for readCell:
 * //   - index: Expected number, received string
 * ```
 */
export function validateWithZod<T>(
  schema: z.ZodType<T>,
  params: unknown,
  operationName: string
): T {
  try {
    // Parse and validate parameters
    return schema.parse(params);
  } catch (error) {
    // Read by its shape, not by `instanceof`: the schema may come from another copy of Zod than this one.
    if (isZodError(error)) {
      // Convert Zod validation errors to user-friendly format
      const issues = error.issues
        .map(issue => {
          // Build path string (e.g., "cells[0].type" for nested errors)
          const path = issue.path.length > 0 ? issue.path.join('.') : 'root';

          return `  - ${path}: ${issue.message}`;
        })
        .join('\n');

      throw new Error(
        `Invalid parameters for ${operationName}:\n${issues}\n\n` +
          `Received: ${JSON.stringify(params)}`,
        { cause: error }
      );
    }

    // Re-throw non-Zod errors
    throw error;
  }
}
