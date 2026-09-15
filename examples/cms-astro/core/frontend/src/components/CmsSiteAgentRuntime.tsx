/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import { useMemo } from 'react';
import { Flash } from '@primer/react';
import { ThemedProvider, useThemeStore } from '@datalayer/primer-addons';
import { AnonymousKeyTimer } from '@datalayer/core/lib/components/anonymous/AnonymousKeyTimer';
import { ChatFloating } from '@datalayer/agent-runtimes/lib/chat/ChatFloating.js';
import { useBrowserInference } from '@datalayer/agent-runtimes/lib/hooks/useBrowserInference.js';
import { browserProtocolConfig } from '@datalayer/agent-runtimes/lib/runtimes/browser/protocol.js';
import { getAgentspecs } from '@datalayer/agent-runtimes/lib/specs/agents/index.js';
import { createCmsAgentTools } from '../lib/cmsAgent';
import type { CmsSiteSession } from './CmsSiteAgent';

type Props = {
  apiUrl: string;
  siteId: string;
  siteName: string;
  session: CmsSiteSession;
};

const spec = (() => {
  const value = getAgentspecs('worker-cms-astro');
  if (!value) {
    throw new Error(
      'worker-cms-astro is missing; run `make specs` in agent-runtimes and rebuild it.',
    );
  }
  return value;
})();

function Runtime({ apiUrl, siteId, siteName, session }: Props) {
  const { inference, anonymous, needsSignIn } = useBrowserInference(true);
  const tools = useMemo(
    () => createCmsAgentTools({ apiUrl, siteId, session }),
    [apiUrl, session, siteId],
  );
  const protocol = useMemo(
    () =>
      browserProtocolConfig({
        agentId: spec.id,
        instructions: spec.systemPrompt,
        model: spec.model,
        frontendTools: tools,
        inference,
      }),
    [inference, tools],
  );
  const suggestions = useMemo(
    () =>
      (spec.suggestions ?? []).map(item => ({
        title: item.summary || item.text,
        message: item.text,
      })),
    [],
  );

  if (anonymous.status === 'failed') {
    return (
      <Flash
        variant="danger"
        sx={{ position: 'fixed', right: 3, bottom: 3, zIndex: 1001 }}
      >
        The CMS agent could not obtain an anonymous inference key.
      </Flash>
    );
  }
  if (needsSignIn || !anonymous.token) return null;

  const timer = anonymous.expiresAt ? (
    <AnonymousKeyTimer
      expiresAt={anonymous.expiresAt}
      grantedMs={anonymous.grantedMs}
      label="AI key"
    />
  ) : null;

  return (
    <ChatFloating
      protocol={protocol}
      useStore={false}
      title={spec.name}
      description={`${spec.welcomeMessage ?? spec.description} Current site: ${siteName}.`}
      suggestions={suggestions}
      defaultViewMode="floating-small"
      width={440}
      height={620}
      showModelSelector={false}
      showToolsMenu
      showSkillsMenu={false}
      showTokenUsage
      enableEphemeralNotebook={false}
      panelProps={{ headerContent: timer }}
      buttonTooltip={`Author ${siteName} with AI`}
    />
  );
}

export default function CmsSiteAgentRuntime(props: Props) {
  return (
    <ThemedProvider useStore={useThemeStore}>
      <Runtime {...props} />
    </ThemedProvider>
  );
}
