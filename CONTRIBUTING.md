# Contributing

Thanks for your interest in Claude Prompt Meter!

## Setup

```bash
git clone https://github.com/ryukenshin546-a11y/claude-prompt-meter
cd claude-prompt-meter
npm install
```

Open the folder in VS Code and press `F5` to launch an Extension Development Host with the extension loaded.

## Tests

```bash
npm test          # runs node --test across the test files
```

CI runs the same suite on Linux, macOS, and Windows — path handling is OS-sensitive, so please keep tests passing on all three.

## Pull requests

- Keep changes focused and minimal.
- Match the existing code style (plain JS, no build step).
- Add or update a test for any behavior change.
- Bump the `version` in `package.json` only if asked; releases are tagged by the maintainer.

## Reporting bugs

Open an [issue](https://github.com/ryukenshin546-a11y/claude-prompt-meter/issues) with your OS, VS Code version, and steps to reproduce. The **Diagnostics (copy report)** command in the extension produces a handy report to paste.
