/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * How a result goes back to the model: as the object it is, or as TOON,
 * which a model reads more easily than JSON.
 *
 * @module tools/formatter
 */

import { encode } from '@toon-format/toon';

/**
 * Format a tool's result for its reader.
 *
 * @param data - The result
 * @param format - `json` for the object itself; TOON otherwise, the default, since most tool calls are a model's
 */
export function formatResponse<T>(data: T, format?: 'json' | 'toon'): T | string {
  // Return JSON (structured object) if explicitly requested
  if (format === 'json') {
    return data;
  }
  // Default to TOON format - encode as human/LLM-readable string
  // This is the default because most tool operations are called by LLMs
  return encode(data);
}
