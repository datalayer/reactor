import React from 'react';
import { Button, Text } from '@primer/react';
import { Box, Card } from '@datalayer/primer-addons';
import { defineExtension, signal, type Signal } from '../../../../src';
import { useSignalValue } from '../../../../src/react';

/**
 * Reactive state that Plugin A publishes through its build output.
 *
 * Because these are reactor `signal`s (not React state), any other plugin that
 * depends on Plugin A can read `reactor.getOutput('@demo/welcome-card')` and
 * subscribe to them — see the status-banner plugin (Plugin B).
 */
export type WelcomeCardOutput = {
  clicks: Signal<number>;
  lastAction: Signal<string>;
  components: Array<{
    slot: string;
    id: string;
    Component: React.ComponentType;
  }>;
};

function WelcomeCard({
  clicks,
  lastAction,
}: {
  clicks: Signal<number>;
  lastAction: Signal<string>;
}) {
  const clickedCount = useSignalValue(clicks);
  const lastActionMessage = useSignalValue(lastAction);

  const onPrimaryAction = () => {
    clicks.value = clicks.peek() + 1;
    lastAction.value = `Local frontend action executed at ${new Date().toLocaleTimeString()}.`;
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

export const WelcomeCardExtension = defineExtension<Record<string, never>, unknown, WelcomeCardOutput>({
  name: '@demo/welcome-card',
  version: '1.0.0',
  build() {
    // Shared reactive state, exposed on the build output so dependent plugins
    // can observe it through the reactor.
    const clicks = signal(0);
    const lastAction = signal('No action yet.');
    return {
      clicks,
      lastAction,
      components: [
        {
          slot: 'main',
          id: 'welcome-card',
          Component: () => <WelcomeCard clicks={clicks} lastAction={lastAction} />,
        },
      ],
    };
  },
});
