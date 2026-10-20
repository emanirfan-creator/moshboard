---
name: moshboard-motions
description: Use an animation saved in Moshboard by its name. Use when the user asks for a saved or named animation ("use bounce out", "make the drawer open like panel open", "what animations did I save?"), or mentions Moshboard animations, motions.md or motions.json.
---

# Saved Moshboard animations

The user tunes animations in Moshboard against real references and saves the good ones under a
name. Moshboard writes them to `motions.md` (and `motions.json`) at the top of a boards folder.
Each one has exact values; use them as they are, never re-estimate or round them.

## 1. Find motions.md

Look in this order and use the first one found:

1. The current project: a `motions.md` that sits beside Moshboard canvases (folders holding a
   `board.json`), often `design/motions.md`. Search for it (`**/motions.md`, skipping
   `node_modules`) and check its first line is `# Saved animations`.
2. Moshboard's own boards folder: `{{BOARDS}}/motions.md`.
3. Neither: ask the user where their Moshboard boards folder is.

## 2. Pick the animation

Match the name the user gave, ignoring case. If it's close but not exact ("bounce" for "bounce
out"), or several fit, say which one you're using. If none fits, list the names that are there.
Each one's line at the top says what it is in plain words (length, curve or spring, feel).

## 3. Use the matching version

Each animation has the same values in three forms. Use the one that fits the project:

- **Motion** when `package.json` has `motion` or `framer-motion` (import from `motion/react`;
  framer-motion is Motion's old name).
- **GSAP** when it has `gsap`.
- **CSS** otherwise. A spring has no CSS version: use Motion for it, or ask.

Keep the code name it's given (`bounceOut`), put it where the project keeps its motion values
(a tokens or constants file; make a small `motion.ts` if there's none) and use it from there, so
the next place that needs it can reuse it. Apply it to the element the user meant: the values
are the timing, the user's request says what moves.

Never edit `motions.md` or `motions.json`: Moshboard writes them. To change a saved animation,
the user tunes and saves it again in Moshboard.
