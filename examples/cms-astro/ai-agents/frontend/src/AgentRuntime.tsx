/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import { useMemo } from 'react';
import { Flash } from '@primer/react';
import {
  DatalayerThemeProvider,
  themeConfigs,
  type ColorMode,
  type ThemeVariant,
} from '@datalayer/primer-addons';
import { AnonymousKeyTimer } from '@datalayer/core/lib/components/anonymous/AnonymousKeyTimer';
import { ChatFloating } from '@datalayer/agent-runtimes/lib/chat/ChatFloating.js';
import { useBrowserInference } from '@datalayer/agent-runtimes/lib/hooks/useBrowserInference.js';
import { browserProtocolConfig } from '@datalayer/agent-runtimes/lib/runtimes/browser/protocol.js';
import { getAgentspecs } from '@datalayer/agent-runtimes/lib/specs/agents/index.js';
import { createCmsAgentTools, type CmsSiteSession } from './tools';

type Props = {
  apiUrl: string;
  siteId: string;
  siteName: string;
  appearanceTheme: ThemeVariant;
  colorMode: ColorMode;
  session?: CmsSiteSession;
};

const spec = (() => {
  const value = getAgentspecs('worker-cms-astro');
  if (!value)
    throw new Error(
      'worker-cms-astro is missing; run `make specs` in agent-runtimes and rebuild it.',
    );
  return value;
})();

function Runtime({
  apiUrl,
  siteId,
  siteName,
  appearanceTheme,
  colorMode,
  session,
}: Props) {
  const { inference, anonymous, needsSignIn } = useBrowserInference(true);
  const tools = useMemo(
    () => (session ? createCmsAgentTools({ apiUrl, siteId, session }) : []),
    [apiUrl, session, siteId],
  );
  const instructions = useMemo(
    () =>
      session
        ? spec.systemPrompt
        : `${spec.systemPrompt}\n\nCMS frontend tools are unavailable because the visitor is not signed in to this site. Do not claim to call them and do not emit tool-call markup. Ask the visitor to sign in before reading or changing CMS content.`,
    [session],
  );
  const protocol = useMemo(
    () =>
      browserProtocolConfig({
        agentId: spec.id,
        instructions,
        model: spec.model,
        frontendTools: tools,
        inference,
      }),
    [inference, instructions, tools],
  );
  const suggestions = useMemo(
    () =>
      (spec.suggestions ?? []).map((item) => ({
        title: item.summary || item.text,
        message: item.text,
      })),
    [],
  );

  // `useBrowserInference` may be backed either by the visitor's anonymous
  // token or by an IAM member token. `needsSignIn` already describes both
  // cases, while checking `anonymous.token` would leave signed-in IAM members
  // stuck in the launching state.
  const inferenceReady = !needsSignIn;
  const inferenceFailed = anonymous.status === 'failed';

  const timer = anonymous.expiresAt ? (
    <AnonymousKeyTimer
      expiresAt={anonymous.expiresAt}
      grantedMs={anonymous.grantedMs}
      label="AI key"
    />
  ) : null;

  return (
    <>
      {inferenceFailed && (
        <Flash
          variant="danger"
          sx={{ position: 'fixed', right: '20px', bottom: '88px', zIndex: 1001, maxWidth: 460 }}
        >
          The CMS agent could not obtain an anonymous inference key.
        </Flash>
      )}
      <ChatFloating
        protocol={protocol}
        useStore={false}
        themeVariant={appearanceTheme}
        colorMode={colorMode}
        title={spec.name}
        description={`${spec.welcomeMessage ?? spec.description} Current site: ${siteName}.${
          session ? '' : ' Sign in to the CMS to enable content tools.'
        }`}
        suggestions={suggestions}
        position="bottom-right"
        defaultViewMode="floating-small"
        width={440}
        height={620}
        showModelSelector={false}
        showToolsMenu={Boolean(session)}
        showSkillsMenu={false}
        showTokenUsage
        enableEphemeralNotebook={false}
        launching={!inferenceReady}
        launchingMessage={
          inferenceFailed ? 'Anonymous AI access is unavailable.' : 'Preparing secure AI access…'
        }
        panelProps={{ headerContent: timer }}
        buttonTooltip={session ? `Author ${siteName} with AI` : `Explore ${siteName} with AI`}
      />
    </>
  );
}

export default function AgentRuntime(props: Props) {
  const config = themeConfigs[props.appearanceTheme];
  return (
    <DatalayerThemeProvider
      colorMode={props.colorMode}
      theme={config.primerTheme}
      themeStyles={config.themeStyles}
    >
      <Runtime {...props} />
    </DatalayerThemeProvider>
  );
}
