import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/docs/',
  title: 'OpenCLI',
  description: 'Make any website or Electron App your CLI — AI-powered, account-safe, self-healing.',

  head: [
    ['meta', { property: 'og:title', content: 'OpenCLI Documentation' }],
    ['meta', { property: 'og:description', content: 'Make any website or Electron App your CLI.' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],

  locales: {
    root: {
      label: 'English',
      lang: 'en',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/guide/getting-started' },
          { text: 'Adapters', link: '/adapters/' },
          { text: 'Developer', link: '/developer/contributing' },
          { text: 'Advanced', link: '/advanced/cdp' },
        ],
        sidebar: {
          '/guide/': [
            {
              text: 'Guide',
              items: [
                { text: 'Getting Started', link: '/guide/getting-started' },
                { text: 'Installation', link: '/guide/installation' },
                { text: 'Comparison', link: '/comparison' },
                { text: 'Browser Bridge', link: '/guide/browser-bridge' },
                { text: 'Troubleshooting', link: '/guide/troubleshooting' },
                { text: 'Add an Electron App CLI', link: '/guide/electron-app-cli' },
                { text: 'Plugins', link: '/guide/plugins' },
              ],
            },
          ],
          '/adapters/': [
            {
              text: 'Adapters Overview',
              items: [
                { text: 'All Adapters', link: '/adapters/' },
              ],
            },
            {
              text: 'Browser Adapters',
              collapsed: false,
              items: [
                { text: 'Twitter / X', link: '/adapters/browser/twitter' },
                { text: 'Reddit', link: '/adapters/browser/reddit' },
                { text: 'Bilibili', link: '/adapters/browser/bilibili' },
                { text: 'Zhihu', link: '/adapters/browser/zhihu' },
                { text: 'Xiaohongshu', link: '/adapters/browser/xiaohongshu' },
                { text: 'Weibo', link: '/adapters/browser/weibo' },
                { text: 'YouTube', link: '/adapters/browser/youtube' },
                { text: 'Xueqiu', link: '/adapters/browser/xueqiu' },
                { text: 'V2EX', link: '/adapters/browser/v2ex' },
                { text: 'Bloomberg', link: '/adapters/browser/bloomberg' },
                { text: 'LinkedIn', link: '/adapters/browser/linkedin' },
                { text: 'Coupang', link: '/adapters/browser/coupang' },
                { text: 'BOSS Zhipin', link: '/adapters/browser/boss' },
                { text: 'Ctrip', link: '/adapters/browser/ctrip' },
                { text: 'Reuters', link: '/adapters/browser/reuters' },
                { text: 'Web of Science', link: '/adapters/browser/webofscience' },
                { text: 'SMZDM', link: '/adapters/browser/smzdm' },
                { text: 'Jike', link: '/adapters/browser/jike' },
                { text: 'Jimeng', link: '/adapters/browser/jimeng' },
                { text: 'Yollomi', link: '/adapters/browser/yollomi' },
                { text: 'LINUX DO', link: '/adapters/browser/linux-do' },
                { text: 'Chaoxing', link: '/adapters/browser/chaoxing' },
                { text: 'Grok', link: '/adapters/browser/grok' },
                { text: 'WeRead', link: '/adapters/browser/weread' },
                { text: 'Douban', link: '/adapters/browser/douban' },
                { text: 'Sina Blog', link: '/adapters/browser/sinablog' },
                { text: 'Substack', link: '/adapters/browser/substack' },
                { text: 'Pixiv', link: '/adapters/browser/pixiv' },
                { text: 'Douban', link: '/adapters/browser/douban' },
                { text: 'Doubao', link: '/adapters/browser/doubao' },
                { text: 'Facebook', link: '/adapters/browser/facebook' },
                { text: 'Google', link: '/adapters/browser/google' },
                { text: 'IMDb', link: '/adapters/browser/imdb' },
                { text: 'Instagram', link: '/adapters/browser/instagram' },
                { text: 'JD.com', link: '/adapters/browser/jd' },
                { text: 'Medium', link: '/adapters/browser/medium' },
                { text: 'TikTok', link: '/adapters/browser/tiktok' },
                { text: 'Web (Generic)', link: '/adapters/browser/web' },
                { text: 'Weixin', link: '/adapters/browser/weixin' },
              ],
            },
            {
              text: 'Public API Adapters',
              collapsed: false,
              items: [
                { text: 'HackerNews', link: '/adapters/browser/hackernews' },
                { text: 'Dev.to', link: '/adapters/browser/devto' },
                { text: 'Dictionary', link: '/adapters/browser/dictionary' },
                { text: 'BBC', link: '/adapters/browser/bbc' },
                { text: 'Apple Podcasts', link: '/adapters/browser/apple-podcasts' },
                { text: 'Xiaoyuzhou', link: '/adapters/browser/xiaoyuzhou' },
                { text: 'Yahoo Finance', link: '/adapters/browser/yahoo-finance' },
                { text: 'arXiv', link: '/adapters/browser/arxiv' },
                { text: 'paperreview.ai', link: '/adapters/browser/paperreview' },
                { text: 'Barchart', link: '/adapters/browser/barchart' },
                { text: 'Hugging Face', link: '/adapters/browser/hf' },
                { text: 'Sina Finance', link: '/adapters/browser/sinafinance' },
                { text: 'Stack Overflow', link: '/adapters/browser/stackoverflow' },
                { text: 'Wikipedia', link: '/adapters/browser/wikipedia' },
                { text: 'Lobsters', link: '/adapters/browser/lobsters' },
                { text: 'Steam', link: '/adapters/browser/steam' },
              ],
            },
            {
              text: 'Desktop Adapters',
              collapsed: false,
              items: [
                { text: 'Cursor', link: '/adapters/desktop/cursor' },
                { text: 'Codex', link: '/adapters/desktop/codex' },
                { text: 'Antigravity', link: '/adapters/desktop/antigravity' },
                { text: 'ChatGPT', link: '/adapters/desktop/chatgpt' },
                { text: 'ChatWise', link: '/adapters/desktop/chatwise' },
                { text: 'Notion', link: '/adapters/desktop/notion' },
                { text: 'Discord', link: '/adapters/desktop/discord' },
                { text: 'Doubao App', link: '/adapters/desktop/doubao-app' },
              ],
            },
          ],
          '/developer/': [
            {
              text: 'Developer Guide',
              items: [
                { text: 'Contributing', link: '/developer/contributing' },
                { text: 'Testing', link: '/developer/testing' },
                { text: 'Architecture', link: '/developer/architecture' },
                { text: 'YAML Adapter Guide', link: '/developer/yaml-adapter' },
                { text: 'TypeScript Adapter Guide', link: '/developer/ts-adapter' },
                { text: 'AI Workflow', link: '/developer/ai-workflow' },
              ],
            },
          ],
          '/advanced/': [
            {
              text: 'Advanced',
              items: [
                { text: 'Chrome DevTools Protocol', link: '/advanced/cdp' },
                { text: 'Electron Apps', link: '/advanced/electron' },
                { text: 'Remote Chrome', link: '/advanced/remote-chrome' },
                { text: 'Download Support', link: '/advanced/download' },
              ],
            },
          ],
        },
      },
    },
    zh: {
      label: '中文',
      lang: 'zh-CN',
      link: '/zh/',
      themeConfig: {
        nav: [
          { text: '指南', link: '/zh/guide/getting-started' },
          { text: '适配器', link: '/zh/adapters/' },
          { text: '开发者', link: '/zh/developer/contributing' },
          { text: '进阶', link: '/zh/advanced/cdp' },
        ],
        sidebar: {
          '/zh/guide/': [
            {
              text: '指南',
              items: [
                { text: '快速开始', link: '/zh/guide/getting-started' },
                { text: '安装', link: '/zh/guide/installation' },
                { text: 'Browser Bridge', link: '/zh/guide/browser-bridge' },
                { text: '给新 Electron 应用生成 CLI', link: '/zh/guide/electron-app-cli' },
                { text: '插件', link: '/zh/guide/plugins' },
              ],
            },
          ],
          '/zh/adapters/': [
            {
              text: '适配器概览',
              items: [
                { text: '所有适配器', link: '/zh/adapters/' },
              ],
            },
          ],
          '/zh/developer/': [
            {
              text: '开发者指南',
              items: [
                { text: '贡献指南', link: '/zh/developer/contributing' },
              ],
            },
          ],
          '/zh/advanced/': [
            {
              text: '进阶',
              items: [
                { text: 'Chrome DevTools Protocol', link: '/zh/advanced/cdp' },
              ],
            },
          ],
        },
      },
    },
  },

  themeConfig: {
    search: {
      provider: 'local',
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/jackwener/opencli' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/@jackwener/opencli' },
    ],

    editLink: {
      pattern: 'https://github.com/jackwener/opencli/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the Apache-2.0 License.',
      copyright: 'Copyright © 2024-present jackwener',
    },
  },
})
