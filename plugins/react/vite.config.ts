// SPDX-License-Identifier: AGPL-3.0-only
// Toolbar vite config
// Copyright (C) 2025 Goetze, Scharpff & Toews GbR

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type PluginOption } from 'vite';
import dts from 'vite-plugin-dts';
import react from '@vitejs/plugin-react-swc';
import preserveDirectives from 'rollup-preserve-directives';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      jsxImportSource: '@stagewise/toolbar/plugin-ui',
    }),
    dts({
      rollupTypes: true,
    }) as PluginOption,
    preserveDirectives(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      'react/jsx-runtime': '@stagewise/toolbar/plugin-ui/jsx-runtime',
      react: '@stagewise/toolbar/plugin-ui',
    },
    mainFields: ['module', 'main'],
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json'],
  },
  esbuild: {
    minifyIdentifiers: false,
    treeShaking: true,
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.tsx'),
      name: 'StagewisePluginExample',
      fileName: (format) => `index.${format}.js`,
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      output: {
        manualChunks: undefined,
        preserveModules: false,
        globals: {
          react: '@stagewise/toolbar/plugin-ui',
          'react/jsx-runtime': '@stagewise/toolbar/plugin-ui/jsx-runtime',
        },
      },
      external: [
        '@stagewise/toolbar',
        '@stagewise/toolbar/plugin-ui',
        '@stagewise/toolbar/plugin-ui/jsx-runtime',
      ],
      treeshake: true,
    },
    minify: false,
    cssMinify: false,
  },
  optimizeDeps: {
    esbuildOptions: {
      mainFields: ['module', 'main'],
    },
  },
});
