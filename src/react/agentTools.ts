/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The agent tools plugins contributed, for a host component to read.
 *
 * @module react/agentTools
 */

import { useMemo } from 'react';
import { AgentTools, type AgentToolBundle } from '../core/agentTools';
import { useContributions } from './host';

/** Every bundle contributed to the platform this tree is mounted in, live. */
export function useAgentToolBundles(): AgentToolBundle[] {
  const entries = useContributions(AgentTools);
  return useMemo(() => entries.map((entry) => entry.value), [entries]);
}
