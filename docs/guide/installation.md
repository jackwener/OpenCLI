# Installation

## Requirements

- **Node.js**: >= 21.0.0, or **Bun** >= 1.0
- **Chrome** running and logged into the target site (for browser commands)

## Install via npm (Recommended)

```bash
npm install -g @jackwener/opencli
```

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

## Verify Installation

```bash
opencli --version   # Check version
opencli list        # List all commands
opencli doctor      # Diagnose connectivity
```
