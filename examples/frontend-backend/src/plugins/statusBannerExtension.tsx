/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import React, { useState } from 'react';
import { Button, Label, Text } from '@primer/react';
import { Box } from '@datalayer/primer-addons';
import { defineExtension } from '../../../../src';

type StatusConfig = {
  status: 'Ready' | 'Paused';
};

type BackendPluginProps = {
  backendBaseUrl?: string;
};

function StatusBanner({ status, backendBaseUrl = 'http://localhost:8788' }: { status: string } & BackendPluginProps) {
  const [stateMessage, setStateMessage] = useState(status);
  const [counterValue, setCounterValue] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const onCheckStatus = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${backendBaseUrl}/plugins/status-plugin/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'status',
          payload: {},
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `HTTP ${response.status}`);
      }

      const data = (await response.json()) as { state?: string; counter?: number };
      const nextState = data.state ?? 'unknown';
      setStateMessage(nextState.toLowerCase() === 'ready' ? 'Backend Ready' : nextState);
      setCounterValue(typeof data.counter === 'number' ? data.counter : null);
    } catch (error) {
      setStateMessage(`backend error: ${error instanceof Error ? error.message : 'unknown error'}`);
      setCounterValue(null);
    } finally {
      setIsLoading(false);
    }
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
        alignItems: 'stretch',
        gap: 2,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
        <Text>Plugin B: Runtime status panel</Text>
        <Label variant={stateMessage.startsWith('ready') ? 'success' : 'attention'}>{stateMessage}</Label>
        <Button size="small" onClick={onCheckStatus} disabled={isLoading}>
          {isLoading ? 'Checking...' : 'Check backend status'}
        </Button>
      </Box>
      <Text sx={{ color: 'fg.muted' }}>
        Backend counter: {counterValue ?? 'not fetched yet'}
      </Text>
    </Box>
  );
}

export const StatusBannerExtension = defineExtension<StatusConfig, unknown, { components: Array<any> }>({
  name: '@demo/status-banner',
  version: '1.0.0',
  requiredBackendPlugins: ['status-plugin'],
  dependencies: [],
  config: {
    status: 'Ready',
  },
  build({ config }) {
    return {
      components: [
        {
          slot: 'sidebar',
          id: 'status-banner',
          Component: (props) => <StatusBanner status={config.status} {...props} />,
          requiredBackendPlugins: ['status-plugin'],
        },
      ],
    };
  },
});
