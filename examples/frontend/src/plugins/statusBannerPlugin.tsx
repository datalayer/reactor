/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import React, { useState, useSyncExternalStore } from 'react';
import { Button, Label, Text } from '@primer/react';
import { Box } from '@datalayer/primer-addons';
import { definePlugin, signal } from '../../../../src';
import { useReactorPlatform, useSignalValue } from '../../../../src/react';
import { WelcomeCardPlugin, type WelcomeCardOutput } from './welcomeCardPlugin';

type StatusConfig = {
  status: 'Ready' | 'Paused';
};

// Fallback used only when Plugin A is unavailable (e.g. disabled at runtime).
const NO_CLICKS = signal(0);

function StatusBanner({ status }: { status: string }) {
  const [runtimeStatus, setRuntimeStatus] = useState(status);

  // Read Plugin A's output through the reactor. Re-render on reactor changes so
  // we re-resolve the output when Plugin A is enabled/disabled at runtime.
  const reactorPlatform = useReactorPlatform();
  useSyncExternalStore(reactorPlatform.subscribe, reactorPlatform.getRevision);
  const welcomeAvailable = reactorPlatform.isEnabled(WelcomeCardPlugin.name);
  const welcome = reactorPlatform.getOutput<WelcomeCardOutput>(WelcomeCardPlugin.name);
  const welcomeClicks = useSignalValue(welcome?.clicks ?? NO_CLICKS);

  const onToggleStatus = () => {
    setRuntimeStatus((current) => (current === 'Ready' ? 'Paused' : 'Ready'));
  };

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        p: 3,
        bg: 'canvas.subtle',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
        }}
      >
        <Text>Plugin B: Runtime status panel</Text>
        <Label variant={runtimeStatus === 'Ready' ? 'success' : 'attention'}>{runtimeStatus}</Label>
        <Button size="small" onClick={onToggleStatus}>
          Toggle State
        </Button>
      </Box>
      <Text sx={{ color: 'fg.muted' }}>
        Plugin A clicks (via reactor dependency):{' '}
        <Text as="span" sx={{ fontWeight: 'bold', color: 'fg.default' }}>
          {welcomeAvailable ? welcomeClicks : '— (Plugin A disabled)'}
        </Text>
      </Text>
    </Box>
  );
}

export const StatusBannerPlugin = definePlugin<StatusConfig, unknown, { components: Array<any> }>({
  name: '@demo/status-banner',
  version: '1.0.0',
  // Plugin B depends on Plugin A: the reactor auto-includes Plugin A (even if it
  // is not listed explicitly) and builds it first, so its output — and the
  // shared `clicks` signal — is available when Plugin B renders.
  dependencies: [WelcomeCardPlugin],
  config: {
    status: 'Ready',
  },
  build({ config }) {
    return {
      components: [
        {
          slot: 'sidebar',
          id: 'status-banner',
          Component: () => <StatusBanner status={config.status} />,
        },
      ],
    };
  },
});
