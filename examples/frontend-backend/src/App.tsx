import React, { useMemo, useState } from 'react';
import { Button, Heading, Text } from '@primer/react';
import { AppearanceControlsWithStore, Box, useThemeStore } from '@datalayer/primer-addons';
import { buildPlatformFromExtensions } from '../../../src';
import { ReactorProvider, ReactorSlot, useReactorPlatform } from '../../../src/react';
import { StatusBannerExtension } from './plugins/statusBannerExtension';
import { WelcomeCardExtension } from './plugins/welcomeCardExtension';

const BACKEND_PLUGIN_NAMES = ['greeting-plugin', 'status-plugin'] as const;

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
  const backendBaseUrl = 'http://localhost:8788';

  const [availableBackendPlugins, setAvailableBackendPlugins] = useState<string[]>([
    'greeting-plugin',
    'status-plugin',
  ]);

  const platform = useMemo(
    () =>
      buildPlatformFromExtensions([
        WelcomeCardExtension,
        StatusBannerExtension,
      ]),
    [],
  );

  const toggleBackendPlugin = (pluginName: string) => {
    setAvailableBackendPlugins((previous) => {
      if (previous.includes(pluginName)) {
        return previous.filter((item) => item !== pluginName);
      }
      return [...previous, pluginName];
    });
  };

  return (
    <ReactorProvider platform={platform} availableBackendPlugins={availableBackendPlugins}>
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
            Frontend + backend plugins
          </Heading>
          <Text as="p" sx={{ color: 'fg.muted', fontSize: 2 }}>
            Combined frontend-backend demo with runtime checks on required backend plugins.
          </Text>
          <RuntimeControls />
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 3 }}>
            {BACKEND_PLUGIN_NAMES.map((pluginName) => {
              const available = availableBackendPlugins.includes(pluginName);
              return (
                <Button
                  key={pluginName}
                  variant={available ? 'default' : 'danger'}
                  onClick={() => toggleBackendPlugin(pluginName)}
                >
                  {available ? `Backend ON: ${pluginName}` : `Backend OFF: ${pluginName}`}
                </Button>
              );
            })}
          </Box>
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
            <ReactorSlot slot="main" props={{ backendBaseUrl }} />
          </Box>
          <Box>
            <ReactorSlot slot="sidebar" props={{ backendBaseUrl }} />
          </Box>
        </Box>
      </Box>
    </ReactorProvider>
  );
}
