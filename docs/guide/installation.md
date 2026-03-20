# Installation

## Requirements

- **Node.js**: >= 20.0.0
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
```

## Verify Installation

```bash
opencli --version   # Check version
opencli list        # List all commands
opencli doctor      # Diagnose connectivity
```
