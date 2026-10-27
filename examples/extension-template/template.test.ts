/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * The extension template's browser half is still a plugin this runtime runs.
 *
 * Its Python half is held to the template's promises by
 * `tests/test_extension_template.py`; this is the other language. The source
 * is read with its placeholders in place — they are only ever inside strings,
 * so the file is valid TypeScript before the generator fills it.
 */

import { describe, expect, it } from 'vitest';

import { buildReactorFromPlugins } from '@datalayer/reactor';
import TemplatePlugin from './template/frontend/src/plugin';

type Output = { components?: Array<{ id: string; slot: string; Component: unknown }> };

describe('examples/extension-template', () => {
  it('builds a plugin that puts one panel in the sidebar', () => {
    expect(TemplatePlugin.name).toBe('__PLUGIN__');

    const reactor = buildReactorFromPlugins([TemplatePlugin]);
    reactor.start();

    const output = reactor.getOutput<Output>('__PLUGIN__');
    expect(output?.components).toHaveLength(1);
    const [panel] = output!.components!;
    expect(panel).toMatchObject({ id: '__NAME__', slot: 'sidebar' });
    expect(typeof panel.Component).toBe('function');
  });
});
