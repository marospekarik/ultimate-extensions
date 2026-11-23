Makes the light/dark theme global: switching it in one Ultimate project switches it in every project on this machine.

The chosen theme lives in `~/.ultimate/theme.json`. Each open page polls it every 2 s and applies a change by running the shell's "Toggle light and dark theme" command when it differs; a theme switched by the user (the "Toggle light and dark theme" command) is written back once. A change that came from the file is never written again, so open tabs do not fight. The shell still keeps `ultimate.theme` in `localStorage`, so the first paint after a reload uses the last applied theme.

Personal extension: lives in `~/.ultimate/extensions/theme-sync/`, loads in every project. Turn it off with `{ "extensions": { "disable": ["theme-sync"] } }`.
