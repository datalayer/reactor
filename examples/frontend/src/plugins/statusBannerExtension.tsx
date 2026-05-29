import React, { useState } from 'react';
import { Box, Button, Label, Text } from '@primer/react';
import { defineExtension } from '../../../../src';

type StatusConfig = {
  status: 'Ready' | 'Paused';
};

function StatusBanner({ status }: { status: string }) {
  const [runtimeStatus, setRuntimeStatus] = useState(status);

  const onToggleStatus = () => {
    setRuntimeStatus((current) => (current === 'Ready' ? 'Paused' : 'Ready'));
  };

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 3,
        p: 3,
        background: 'rgba(255, 255, 255, 0.88)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <Text sx={{ fontFamily: 'IBM Plex Sans, sans-serif' }}>Plugin B: Runtime status panel</Text>
      <Label variant={runtimeStatus === 'Ready' ? 'success' : 'attention'}>{runtimeStatus}</Label>
      <Button size="small" onClick={onToggleStatus}>
        Toggle State
      </Button>
    </Box>
  );
}

export const StatusBannerExtension = defineExtension<StatusConfig, unknown, { components: Array<any> }>({
  name: '@demo/status-banner',
  version: '1.0.0',
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
          Component: () => <StatusBanner status={config.status} />,
        },
      ],
    };
  },
});
