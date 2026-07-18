import React, { useState } from 'react';
import { Button, Text } from '@primer/react';
import { Box, Card } from '@datalayer/primer-addons';
import { defineExtension } from '../../../../src';

function WelcomeCard() {
  const [clickedCount, setClickedCount] = useState(0);
  const [lastActionMessage, setLastActionMessage] = useState('No action yet.');

  const onPrimaryAction = () => {
    const nextCount = clickedCount + 1;
    setClickedCount(nextCount);
    setLastActionMessage(`Local frontend action executed at ${new Date().toLocaleTimeString()}.`);
  };

  return (
    <Card border rounded="medium" shadow="medium">
      <Card.Header
        title="Plugin A: Welcome Card"
        description="This component is rendered through ReactorSlot from an extension output."
      />
      <Card.Content>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Text as="p" sx={{ m: 0, color: 'fg.muted' }}>
            Clicks: {clickedCount}
          </Text>
          <Text as="p" sx={{ m: 0, color: 'fg.subtle' }}>
            {lastActionMessage}
          </Text>
        </Box>
      </Card.Content>
      <Card.Actions>
        <Button variant="primary" onClick={onPrimaryAction}>
          Execute Local Action
        </Button>
      </Card.Actions>
    </Card>
  );
}

export const WelcomeCardExtension = defineExtension({
  name: '@demo/welcome-card',
  version: '1.0.0',
  build() {
    return {
      components: [
        {
          slot: 'main',
          id: 'welcome-card',
          Component: WelcomeCard,
        },
      ],
    };
  },
});
