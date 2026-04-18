import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withMermaid } from 'vitepress-plugin-mermaid';

const pkg = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../package.json', import.meta.url)),
    'utf-8',
  ),
) as { version: string };

const referenceSidebar = [
  { text: 'Architecture', link: '/architecture' },
  { text: 'Contributing', link: '/development' },
  { text: 'Changelog', link: '/changelog' },
];

export default withMermaid({
  title: 'pkg',
  description:
    'Package Node.js projects into single executables — no runtime, no npm, cross-compiled for Linux, macOS, and Windows.',
  lang: 'en-US',
  base: '/pkg/',
  cleanUrls: true,
  lastUpdated: true,
  sitemap: {
    hostname: 'https://yao-pkg.github.io/pkg/',
  },
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
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],
  themeConfig: {
    logo: '/logo.png',
    siteTitle: 'pkg',
    nav: [
      { text: 'Guide', link: '/guide/getting-started', activeMatch: '/guide/' },
      { text: 'Recipes', link: '/guide/recipes' },
      { text: 'SEA vs Standard', link: '/guide/sea-vs-standard' },
      { text: 'Architecture', link: '/architecture' },
      {
        text: `v${pkg.version}`,
        items: [
          { text: 'Changelog', link: '/changelog' },
          { text: 'Migration from vercel/pkg', link: '/guide/migration' },
          { text: 'Contributing', link: '/development' },
          { text: 'npm', link: 'https://www.npmjs.com/package/@yao-pkg/pkg' },
          { text: 'Issues', link: 'https://github.com/yao-pkg/pkg/issues' },
        ],
      },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Learn',
          items: [
            { text: 'What is pkg?', link: '/guide/' },
            { text: 'Getting started', link: '/guide/getting-started' },
            { text: 'SEA vs Standard', link: '/guide/sea-vs-standard' },
            { text: 'pkg vs Bun vs Deno', link: '/guide/vs-bun-deno' },
            { text: 'Migration from vercel/pkg', link: '/guide/migration' },
          ],
        },
        {
          text: 'Build',
          items: [
            { text: 'Targets', link: '/guide/targets' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'CLI options', link: '/guide/options' },
            { text: 'Output & debug', link: '/guide/output' },
            { text: 'Bytecode', link: '/guide/bytecode' },
            { text: 'Compression', link: '/guide/compression' },
            { text: 'SEA mode', link: '/guide/sea-mode' },
            { text: 'Environment vars', link: '/guide/environment' },
            { text: 'Build from source', link: '/guide/build' },
          ],
        },
        {
          text: 'Run',
          items: [
            { text: 'Packaged app usage', link: '/guide/packaged-app' },
            { text: 'Snapshot filesystem', link: '/guide/snapshot-fs' },
            { text: 'Detecting assets', link: '/guide/detecting-assets' },
            { text: 'Native addons', link: '/guide/native-addons' },
            { text: 'ESM support', link: '/guide/esm' },
            { text: 'Custom Node.js binary', link: '/guide/custom-node' },
            { text: 'Node.js API', link: '/guide/api' },
          ],
        },
        {
          text: 'Cookbook',
          items: [
            { text: 'Recipes', link: '/guide/recipes' },
            { text: 'Troubleshooting', link: '/guide/troubleshooting' },
          ],
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
      '/architecture': referenceSidebar,
      '/development': referenceSidebar,
      '/changelog': referenceSidebar,
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
    outline: { level: [2, 4] },
  },
  mermaid: {
    // theme intentionally unset — vitepress-plugin-mermaid auto-switches
    // between 'default' (light) and 'dark' based on VitePress appearance
    themeVariables: {
      // keep in sync with the font-size override in custom.css so mermaid's
      // node-size measurements match the rendered text and labels don't clip
      fontSize: '15px',
    },
    flowchart: {
      htmlLabels: true,
      useMaxWidth: true,
      padding: 12,
    },
  },
  mermaidPlugin: {
    class: 'mermaid-diagram',
  },
});
