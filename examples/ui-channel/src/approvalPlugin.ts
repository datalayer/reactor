/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The page's half of the example, as a plugin: a renderer for the approval
 * type, and a binding that draws a `request_approval` tool's result with it.
 *
 * In an application these come from `@datalayer/reactor`,
 * `@datalayer/reactor/ui` and `@datalayer/reactor/ui/react`; the example
 * imports the reactor's source, as the other examples do.
 */

import { contribution, definePlugin } from '../../../src';
import { Renderers, ToolBindings } from '../../../src/ui';
import { defineRenderer } from '../../../src/react/ui';
import { APPROVAL_TYPE } from './approval';

export const ApprovalsPlugin = definePlugin({
  name: '@example/approvals',
  contributes: [
    contribution(
      Renderers,
      defineRenderer({
        type: APPROVAL_TYPE,
        versions: { min: 1, max: 1 },
        // Out of the host's bundle until an approval turns up.
        load: () => import('./ApprovalCard'),
      }),
    ),
    // A gateway may prefix the tool: `request_approval`, `mcp.request_approval`.
    contribution(ToolBindings, { tool: /(^|[_.:\-/])request_approval$/, type: APPROVAL_TYPE }),
  ],
});
