---
name: moshboard-site
description: Capture a live website's motion (looking first and asking which), take a snapshot of it, or read its fonts, for a site frame on a Moshboard board, using the user's own Chrome. Use when asked to "capture motion", "snapshot", or "read the fonts" of a website on a Moshboard board, or when the Moshboard website hands over an instruction mentioning a site frame.
---

# Live sites on a Moshboard board

The Moshboard website can't drive a browser, so these jobs come to you. One script does the browser work and writes the files the app reads; the board in the browser updates by itself as soon as it's done.

Run commands from the folder that holds this `.claude/` folder. `<board>` is the board's folder (the one with `board.json`), or `.` when `board.json` is right here. Frame ids are in `board.json`.

```
node .claude/skills/moshboard-site/moshboard-tools.mjs <command> <board> <frameId> [options]
```

The first run sets up a browser driver next to the script (about a minute, once). It uses the installed Google Chrome; if Chrome is missing, tell the user to install it.

## Capture motion

Look first, then ask. Which motion matters, and whether to rebuild it, are the user's call: don't pick for them and don't measure until they've chosen. A hint in their message ("I'm thinking of the menu") is a starting point, not an order.

1. `elements <board> <frameId>` lists what's on the site's first screen: each candidate's `selector`, its text `label`, whether it `moves` (declares a transition or animation) and its likely `trigger`. It also saves a screenshot (path in the output): look at it.
2. Tell the user, in plain words, what moves and what sets each one off (hover, click, load, scroll), a few at most, and ask which one they want. If nothing on the first screen moves, say so and ask what they had in mind.
3. Once they've chosen: `capture <board> <frameId> --selector "<selector>" --trigger <trigger>` fires the trigger and measures the real timing (declared transitions, running animations, what changed, and a screen recording), links the capture to the site frame and adds a starting code frame next to it that replays the timing. Its values are exact. If nothing moved, say what you tried and ask before trying something else.
4. Say in a sentence or two what was measured (what moves, how long, the easing), then ask whether they want it rebuilt. Only if they do, suggest `/recreate <board> <the scaffold id>`; rebuilding is its own back-and-forth, not part of the capture.

## Snapshot

`snapshot <board> <frameId>` saves a full-page picture of a site that doesn't allow previews and shows it in its block. It also reads the site's fonts, for the board's font suggestions.

## Fonts

`fonts <board> <frameId>` reads the fonts a site sets its text in (for a site that does show live), for the board's font suggestions.
