import React, { useState } from 'react';
import { Box, Button, Heading, Text } from '@primer/react';
import { defineExtension } from '../../../../src';

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
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 3,
        p: 4,
        background: 'rgba(255, 255, 255, 0.8)',
      }}
    >
      <Heading as="h2" sx={{ fontFamily: 'Fraunces, serif', fontSize: 4, mb: 2 }}>
        Plugin A: Welcome Card
      </Heading>
      <Text as="p" sx={{ display: 'block', color: 'fg.muted', mb: 3 }}>
        This component is rendered through ReactorSlot from an extension output.
      </Text>
      <Button variant="primary" onClick={onBackendAction} disabled={isLoading}>
        {isLoading ? 'Calling backend...' : 'Call greeting-plugin'}
      </Button>
      <Text as="p" sx={{ display: 'block', color: 'fg.subtle', mt: 3 }}>
        {resultMessage}
      </Text>
    </Box>
  );
}

export const WelcomeCardExtension = defineExtension({
  name: '@demo/welcome-card',
  version: '1.0.0',
  requiredBackendPlugins: ['greeting-plugin'],
  build() {
    return {
      components: [
        {
          slot: 'main',
          id: 'welcome-card',
          Component: (props) => <WelcomeCard {...props} />,
          requiredBackendPlugins: ['greeting-plugin'],
        },
      ],
    };
  },
});
