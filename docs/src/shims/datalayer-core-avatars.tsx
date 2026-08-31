/*
 * Copyright (c) 2025-2026 Datalayer, Inc.
 * Distributed under the terms of the Modified BSD License.
 */

/**
 * Stand-in for `@datalayer/core/lib/components/avatars`.
 *
 * The music example's shop plugin draws a generated avatar per song, and takes
 * it from `@datalayer/core`. That package carries the whole Datalayer/Jupyter
 * client with it, which is a great deal of bundle for one `<svg>` — so the
 * documentation site aliases that one import to this file (see the
 * `reactor-music-demo` webpack plugin in `docusaurus.config.js`).
 *
 * The props and the default palette are copied from the original so the plugin
 * source stays untouched: the example is documented as it is written, not as a
 * fork of itself.
 */

import React from 'react';
import BoringAvatars from 'boring-avatars';

type VariantType =
  | 'marble'
  | 'beam'
  | 'pixel'
  | 'sunset'
  | 'ring'
  | 'bauhaus'
  | undefined;

type BoringAvatarProps = {
  displayName?: string;
  variant?: VariantType;
  size?: number;
  square?: boolean;
  style?: object;
  colors?: string[];
};

const DEFAULT_COLORS = [
  '#000000',
  '#146A7C',
  '#16A085',
  '#1ABC9C',
  '#2ECC71',
  '#59595C',
  '#92A1C6',
  '#C20D90',
  '#C271B4',
  '#F0AB3D',
];

export const BoringAvatar = ({
  displayName = '',
  variant = 'bauhaus',
  size = 40,
  square = false,
  style,
  colors,
}: BoringAvatarProps) => (
  <span style={{ ...(style || {}) }}>
    <BoringAvatars
      size={size}
      name={String(displayName ?? '')}
      variant={variant}
      square={square}
      colors={colors ?? DEFAULT_COLORS}
    />
  </span>
);

export default BoringAvatar;
