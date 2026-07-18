import React, { useMemo, useState } from 'react';
import { Button, Heading, Text } from '@primer/react';
import { AppearanceControlsWithStore, Box, useThemeStore } from '@datalayer/primer-addons';
import { buildReactorFromExtensions } from '../../../src';
import { ReactorProvider, ReactorSlot, useReactorPlatform } from '../../../src/react';
import { StatusBannerExtension } from './plugins/statusBannerExtension';
import { WelcomeCardExtension } from './plugins/welcomeCardExtension';

function RuntimeControls() {
  const reactor = useReactorPlatform();
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(reactor.listExtensions().map((name) => [name, reactor.isEnabled(name)])),
  );

  const toggle = (name: string) => {
    if (reactor.isEnabled(name)) {
      reactor.disable(name);
    } else {
      reactor.enable(name);
    }
    setEnabled(Object.fromEntries(reactor.listExtensions().map((n) => [n, reactor.isEnabled(n)])));
  };

  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 3 }}>
      {reactor.listExtensions().map((name) => (
        <Button key={name} variant={enabled[name] ? 'invisible' : 'primary'} onClick={() => toggle(name)}>
          {enabled[name] ? `Disable ${name}` : `Enable ${name}`}
        </Button>
      ))}
    </Box>
  );
}

function AppHeader() {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        px: 3,
        py: 2,
        borderBottom: '1px solid',
        borderColor: 'border.default',
        bg: 'canvas.default',
      }}
    >
      <Heading as="h1" sx={{ fontSize: 3, m: 0 }}>
        Datalayer Reactor
      </Heading>
      <AppearanceControlsWithStore useStore={useThemeStore} />
    </Box>
  );
}

export function App() {
  const reactor = useMemo(
    () =>
      buildReactorFromExtensions([
        WelcomeCardExtension,
        StatusBannerExtension,
      ]),
    [],
  );

  return (
    <ReactorProvider reactor={reactor}>
      <AppHeader />
      <Box sx={{ maxWidth: 980, mx: 'auto', px: 3, py: 4 }}>
        <Box
          sx={{
            border: '1px solid',
            borderColor: 'border.default',
            borderRadius: 2,
            p: 3,
            bg: 'canvas.subtle',
          }}
        >
          <Heading as="h2" sx={{ fontSize: [4, 5], mb: 2 }}>
            Frontend plugins
          </Heading>
          <Text as="p" sx={{ color: 'fg.muted', fontSize: 2 }}>
            Extension runtime with a React bridge and dynamic plugin lifecycle.
          </Text>
          <RuntimeControls />
        </Box>

        <Box
          sx={{
            mt: 3,
            display: 'grid',
            gridTemplateColumns: ['1fr', '1fr', '1.2fr 0.8fr'],
            gap: 3,
          }}
        >
          <Box>
            <ReactorSlot slot="main" />
          </Box>
          <Box>
            <ReactorSlot slot="sidebar" />
          </Box>
        </Box>
      </Box>
    </ReactorProvider>
  );
}
