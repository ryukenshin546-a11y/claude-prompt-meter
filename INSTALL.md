# Re-install Extension

1. VSCode → Extensions (Ctrl+Shift+X)
2. Find "Claude Prompt Meter"
3. Click "Uninstall"
4. Close VSCode completely
5. Delete cache: `rm -rf ~/.vscode/extensions/undefined_publisher.claude-prompt-meter-*`
6. Open VSCode
7. Press F5 (Run Extension Development Host)
8. In new window, open dashboard

OR install from .vsix:
```bash
vsce package
code --install-extension claude-prompt-meter-*.vsix --force
```
