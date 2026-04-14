import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'pkg',
  description: 'Package Node.js projects into single executables',
  lang: 'en-US',
  base: '/pkg/',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/pkg/logo.png' }],
    ['meta', { name: 'theme-color', content: '#E89B2C' }],
    [
      'meta',
      { property: 'og:title', content: 'pkg — Node.js to single executable' },
    ],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Package your Node.js project into an executable that runs on devices without Node.js installed.',
      },
    ],
    [
      'meta',
      {
        property: 'og:image',
        content: 'https://yao-pkg.github.io/pkg/logo.png',
      },
    ],
  ],
  themeConfig: {
    logo: '/logo.png',
    siteTitle: 'pkg',
    nav: [
      { text: 'Guide', link: '/guide/getting-started', activeMatch: '/guide/' },
      { text: 'SEA vs Standard', link: '/guide/sea-vs-standard' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'Contributing', link: '/development' },
      {
        text: 'v6.14.2',
        items: [
          {
            text: 'Changelog',
            link: 'https://github.com/yao-pkg/pkg/blob/main/CHANGELOG.md',
          },
          { text: 'npm', link: 'https://www.npmjs.com/package/@yao-pkg/pkg' },
          { text: 'Issues', link: 'https://github.com/yao-pkg/pkg/issues' },
        ],
      },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'What is pkg?', link: '/guide/' },
            { text: 'Getting started', link: '/guide/getting-started' },
            { text: 'SEA vs Standard', link: '/guide/sea-vs-standard' },
          ],
        },
        {
          text: 'Packaging',
          items: [
            { text: 'Targets', link: '/guide/targets' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Options', link: '/guide/options' },
            { text: 'Output & debug', link: '/guide/output' },
            { text: 'Bytecode', link: '/guide/bytecode' },
            { text: 'Compression', link: '/guide/compression' },
            { text: 'Build from source', link: '/guide/build' },
            { text: 'SEA mode', link: '/guide/sea-mode' },
            { text: 'Environment vars', link: '/guide/environment' },
          ],
        },
        {
          text: 'Runtime',
          items: [
            { text: 'Packaged app usage', link: '/guide/packaged-app' },
            { text: 'Snapshot filesystem', link: '/guide/snapshot-fs' },
            { text: 'Detecting assets', link: '/guide/detecting-assets' },
            { text: 'Native addons', link: '/guide/native-addons' },
            { text: 'ESM support', link: '/guide/esm' },
            { text: 'Custom Node.js binary', link: '/guide/custom-node' },
            { text: 'API', link: '/guide/api' },
          ],
        },
        {
          text: 'Troubleshooting',
          items: [{ text: 'Common errors', link: '/guide/troubleshooting' }],
        },
        {
          text: 'Advanced',
          items: [
            { text: 'Debug virtual FS', link: '/guide/advanced-debug-vfs' },
            {
              text: 'Windows metadata',
              link: '/guide/advanced-windows-metadata',
            },
          ],
        },
      ],
      '/architecture': [{ text: 'Architecture', link: '/architecture' }],
      '/development': [{ text: 'Development', link: '/development' }],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/yao-pkg/pkg' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/@yao-pkg/pkg' },
    ],
    editLink: {
      pattern: 'https://github.com/yao-pkg/pkg/edit/main/docs-site/:path',
      text: 'Edit this page on GitHub',
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2023-present yao-pkg contributors',
    },
    search: { provider: 'local' },
    outline: { level: [2, 3] },
  },
});
