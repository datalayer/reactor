/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import React, { useState } from 'react';
import { Button, Text } from '@primer/react';
import { Box, Card } from '@datalayer/primer-addons';
import { definePlugin } from '../../../../src';

type BackendPluginProps = {
  backendBaseUrl?: string;
};

function WelcomeCard({ backendBaseUrl = 'http://localhost:8788' }: BackendPluginProps) {
  const [resultMessage, setResultMessage] = useState('No backend action yet.');
  const [isLoading, setIsLoading] = useState(false);

  const onBackendAction = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${backendBaseUrl}/plugins/greeting-plugin/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'greet',
          payload: {
            name: 'Reactor User',
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `HTTP ${response.status}`);
      }

      const data = (await response.json()) as { message?: string };
      setResultMessage(data.message ?? 'Greeting action executed.');
    } catch (error) {
      setResultMessage(`Backend call failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card border rounded="medium" shadow="medium">
      <Card.Header
        title="Plugin A: Welcome Card"
        description="This component is rendered through ReactorSlot from an extension output."
      />
      <Card.Content>
        <Box>
          <Text as="p" sx={{ m: 0, color: 'fg.subtle' }}>
            {resultMessage}
          </Text>
        </Box>
      </Card.Content>
      <Card.Actions>
        <Button variant="primary" onClick={onBackendAction} disabled={isLoading}>
          {isLoading ? 'Calling backend...' : 'Call greeting-plugin'}
        </Button>
      </Card.Actions>
    </Card>
  );
}

export const WelcomeCardPlugin = definePlugin({
  name: '@demo/welcome-card',
  version: '1.0.0',
  requiredBackendPlugins: ['greeting-plugin'],
  build() {
    return {
      components: [
        {
          slot: 'main',
          id: 'welcome-card',
          Component: (props: BackendPluginProps) => <WelcomeCard {...props} />,
          requiredBackendPlugins: ['greeting-plugin'],
        },
      ],
    };
  },
});
