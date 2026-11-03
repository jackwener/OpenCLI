# Installation

## Requirements

- **Node.js**: >= 21.0.0, or **Bun** >= 1.0
- **Chrome** running and logged into the target site (for browser commands)

## Install via npm (Recommended)

```bash
npm install -g @jackwener/opencli
```

## Install the Browser Bridge Extension

For browser commands, install **OpenCLI** from the [Chrome Web Store](https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk) (recommended). See [Browser Bridge setup](./browser-bridge) for manual installation and verification.

## Install from Source

```bash
git clone git@github.com:jackwener/opencli.git
cd opencli
npm install
npm run build
npm link      # Link binary globally
opencli list  # Now you can use it anywhere!
```

## Update

```bash
npm install -g @jackwener/opencli@latest

# If you use the packaged OpenCLI skills, refresh them too
npx skills add jackwener/opencli
```

Or refresh only the skills you actually use:

```bash
npx skills add jackwener/opencli --skill opencli-adapter-author
npx skills add jackwener/opencli --skill opencli-autofix
npx skills add jackwener/opencli --skill opencli-browser
npx skills add jackwener/opencli --skill opencli-usage
npx skills add jackwener/opencli --skill smart-search
```

OpenCLI no longer ships the sitemap skills. An older `opencli-sitemap-author` copy may remain in an
agent's separate skills directory after an upgrade. If it remains, use the agent's removal flow if
available; otherwise remove only the `opencli-sitemap-author` directory (for example,
`~/.agents/skills/opencli-sitemap-author`). The location varies by agent; keep the rest of the
skills directory.

## Verify Installation

```bash
opencli --version   # Check version
opencli list        # List all commands
opencli doctor      # Diagnose connectivity
```
