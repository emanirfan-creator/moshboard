---
name: moshboard-site
description: Capture a live website's motion, take a snapshot of it, or read its fonts, for a site frame on a Moshboard board, using the user's own Chrome. Use when asked to "capture motion", "snapshot", or "read the fonts" of a website on a Moshboard board, or when the Moshboard website hands over an instruction mentioning a site frame.
---

# Live sites on a Moshboard board

The Moshboard website can't drive a browser, so these jobs come to you. One script does the browser work and writes the files the app reads; the board in the browser updates by itself as soon as it's done.

Run commands from the folder that holds this `.claude/` folder. `<board>` is the board's folder (the one with `board.json`), or `.` when `board.json` is right here. Frame ids are in `board.json`.

```
node .claude/skills/moshboard-site/moshboard-tools.mjs <command> <board> <frameId> [options]
```

The first run sets up a browser driver next to the script (about a minute, once). It uses the installed Google Chrome; if Chrome is missing, tell the user to install it.

## Capture motion

The user describes the element in words ("the Get started button") and a trigger (hover, click, load, scroll).

1. `elements <board> <frameId>` lists what's on the site's first screen: each candidate's `selector`, its text `label`, whether it `moves` (declares a transition or animation) and its likely `trigger`. It also saves a screenshot (path in the output): look at it to match the user's words to the right candidate. Prefer one that `moves`.
2. `capture <board> <frameId> --selector "<selector>" --trigger <trigger>` fires the trigger and measures the real timing: declared transitions, running animations, what changed, and a screen recording. It links the capture to the site frame and adds a starting code frame next to it that replays the timing. Its values are exact.
3. If nothing moved, try the next likely candidate or trigger once, then tell the user what you tried.

Afterwards, say in a sentence what was captured (property, duration, easing). Suggest `/recreate <board> <the scaffold id>` if they want it rebuilt faithfully.

## Snapshot

`snapshot <board> <frameId>` saves a full-page picture of a site that doesn't allow previews and shows it in its block. It also reads the site's fonts, for the board's font suggestions.

## Fonts

`fonts <board> <frameId>` reads the fonts a site sets its text in (for a site that does show live), for the board's font suggestions.
