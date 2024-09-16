# VSBL-l10n

## What it is

For now, a VSCode extension that supports our l10n efforts

## What it does

The extension allows:

- marking a hardcoded string (contained in ' or " chars) as .hardcoded (intentionally hardcoded by the developer), or as .localizable (requires localization).
- moving hardcoded strings to arb files, enabling you to replace these with the arb reference
- searching a file for .localizable strings, and performing the above action upon them in bulk

## How it works

Check `npm run` output; TL;DR:

- `npm run vscode:package` to build an vsix file
- using VSCode, install from VSIX in the overflow menu of the Extensions window, and point it to the VSIX you just made in the previous step
- `VSBL-l10n:` commands are now available to you in the CTRL+SHIFT+P command window

## More instructions

coming

## Author

Danh Tran @ VSBL
James Perih @ VSBL

