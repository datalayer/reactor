import React, { useState } from 'react';
import { Box, Button, Heading, Text } from '@primer/react';
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
      <Button variant="primary" onClick={onPrimaryAction}>Execute Local Action</Button>
      <Text as="p" sx={{ display: 'block', color: 'fg.muted', mt: 3 }}>
        Clicks: {clickedCount}
      </Text>
      <Text as="p" sx={{ display: 'block', color: 'fg.subtle', mt: 1 }}>
        {lastActionMessage}
      </Text>
    </Box>
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
