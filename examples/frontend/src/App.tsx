import React, { useMemo, useState } from 'react';
import { Box, Button, Heading, Text } from '@primer/react';
import { buildPlatformFromExtensions } from '../../../src';
import { ReactorProvider, ReactorSlot, useReactorPlatform } from '../../../src/react';
import { StatusBannerExtension } from './plugins/statusBannerExtension';
import { WelcomeCardExtension } from './plugins/welcomeCardExtension';

function RuntimeControls() {
  const platform = useReactorPlatform();
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(platform.listExtensions().map((name) => [name, platform.isEnabled(name)])),
  );

  const toggle = (name: string) => {
    if (platform.isEnabled(name)) {
      platform.disable(name);
    } else {
      platform.enable(name);
    }
    setEnabled(Object.fromEntries(platform.listExtensions().map((n) => [n, platform.isEnabled(n)])));
  };

  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 3 }}>
      {platform.listExtensions().map((name) => (
        <Button key={name} variant={enabled[name] ? 'invisible' : 'primary'} onClick={() => toggle(name)}>
          {enabled[name] ? `Disable ${name}` : `Enable ${name}`}
        </Button>
      ))}
    </Box>
  );
}

export function App() {
  const platform = useMemo(
    () =>
      buildPlatformFromExtensions([
        WelcomeCardExtension,
        StatusBannerExtension,
      ]),
    [],
  );

  return (
    <ReactorProvider platform={platform}>
      <Box className="layout-shell">
        <Box className="hero-panel">
          <Heading as="h1" sx={{ fontFamily: 'Fraunces, serif', fontSize: [5, 6], mb: 2 }}>
            Datalayer Reactor
          </Heading>
          <Text as="p" sx={{ color: 'fg.muted', fontSize: 2 }}>
            Lexical-style extension runtime with a React bridge and dynamic plugin lifecycle.
          </Text>
          <RuntimeControls />
        </Box>

        <Box className="content-grid">
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
