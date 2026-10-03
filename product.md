# Moshboard

**A moodboard whose references stay alive, and whose output is a spec engineers can build from.**

## The problem

Design references start out moving and end up still. A designer finds a hover on a live site, a transition in a Cosmos clip, or a component on 21st.dev, and it goes onto a board as a screenshot. What made it worth saving (the timing, the easing, the spring, how the page reacts) is gone by the time it reaches a developer. Handoff then becomes "make it feel like this," a link, and several rounds of back and forth.

Figma, Pinterest, Are.na and Cosmos are good at collecting. None of them can tell you that a reference uses 420ms on `cubic-bezier(0.16, 1, 0.3, 1)`, and none can give you something to tune until it feels right.

## What Moshboard is

A local, keyboard-first canvas where every kind of reference keeps working:

| Reference | On the board |
|---|---|
| Image | Dropped, pasted, or pulled from a Pinterest / Cosmos / Dribbble / Are.na link |
| Video | Plays inline; mark the motion with **I / O** and analyze it |
| Website | Live and interactive, or a full-page snapshot if the site blocks embedding; render at 375 / 768 / 1280px |
| Component | Paste React code, a registry URL, or an `npx shadcn add …` command and it runs on the canvas, including Chakra / MUI / Mantine components and three.js / R3F scenes |
| Text, notes, palettes, color and font swatches | First-class blocks for intent, type and color |

Everything runs on your machine. A board is a folder (`boards/<name>/`) with a `board.json` and plain files, so it can be versioned, diffed and edited by hand or by an agent.

## The core loop: from reference to tuned code

1. **Collect.** Drop, paste or link anything.
2. **Measure.** Moshboard gets real numbers out of a reference instead of guessing:
   - **Video:** ffmpeg finds the bursts of motion in a marked segment, fits an easing curve, and builds a keyframe contact sheet.
   - **Website:** Playwright drives the real page (hover, click, focus, scroll, load) and records its exact CSS transitions, keyframe animations and property changes.
   - **Component:** timing literals are read from the source, and a probe inside the running frame measures CSS transitions and Web Animations, including values that come from a theme or library.
3. **Recreate.** `/recreate <board> <frameId>` in Claude Code writes a coded copy of the reference, seeded with the measured values, places it next to the original and links the two.
4. **Tune.** Each timing value gets a control in the side panel: a draggable timeline for duration, delay and stagger, a curve editor for easing, a pad for springs, and sliders for distances and colors. Press **R** to replay the reference and the copy side by side.
5. **Save.** **⌘S** writes the tuned values back into the source. Values measured at runtime are saved with the frame, so library code is never touched.
6. **Export.** One command produces the handoff.

## The output

Export covers the whole canvas or just a selection plus whatever is linked to it:

- **`design.md`**: intent (from notes), palettes, swatches, type and visual references
- **`motion.md`**: each interaction with its trigger, what it animates, and exact durations, delays, easings and springs, marked as measured or estimated
- **`tokens.css` / `tokens.json`**: colors, fonts (Google Fonts imports included) and motion tokens
- **`snippets/`**: a standalone copy of each recreated component with the tuned values inlined

This is the part a moodboard never had: a deliverable an engineer, or an AI coding agent, can build from without guessing.

## Built for working with AI

Moshboard assumes you have an agent next to you:

- Boards are plain files, and the app reloads live when they change on disk. Claude Code can add frames, write components and rearrange the board while you watch.
- `CLAUDE.md` and the `/recreate` skill give the agent the board format and the workflow.
- Notes linked to a reference become instructions ("only the card lift, ignore the background").
- When a component needs setup it doesn't have (a provider, a theme), the error card copies a ready-made fix prompt for Claude Code. Designers never have to read a stack trace.
- The exported `motion.md` and `tokens.css` work well as context for an agent building the real product.

## The board helps you decide

- **Palettes come from your references.** Generate picks a balanced set (a dark, a light, the main accents) from the board's images, videos and site snapshots, or from just the frames you select. Lock a color to keep it.
- **Font suggestions come from your references.** The font picker reads the fonts that the board's sites and components actually use and offers them first.
- **Linking** groups a reference with its copies and notes, so replay, export and recreate treat them as a unit.

## How it feels

Dark, quiet and fast. Inspired by Linear and Figma, not by social feeds:

- A very dark canvas with monochrome selection; the references supply the color.
- ⌘K reaches everything, with commands that change based on what's selected. Every action has a key.
- Tactile tuning controls modeled on Teenage Engineering hardware, with a detent sound on each step.
- A dock-style toolbar, tidy-up into a grid, undo and redo on everything.

## Who it's for

- **Product and motion designers** who collect interaction references and are tired of handing off "make it feel like this."
- **Design engineers** who prototype in code and want measured values, not eyeballed ones.
- **Small teams building with AI agents** who need a visual brief the agent can read.

## Why it wins

| | Pinterest / Are.na / Cosmos | Figma / FigJam | Moshboard |
|---|---|---|---|
| Live sites and video | Thumbnails or links | Static or embedded | Live, interactive, measurable |
| Runnable components | No | No | Yes, from code, a registry or shadcn |
| Measured motion | No | No | Yes, from video, sites and running code |
| Tunable recreations | No | Prototype approximations | Real code with live controls |
| Handoff | A link | Inspect panel, static values | `motion.md`, tokens, snippets |
| Works with agents | No | Through plugins | Natively: plain files, live reload, skills |
| Where data lives | Their cloud | Their cloud | Your disk |

## In one line

**Collect what moves, measure it, recreate it, tune it, and hand off the exact numbers.**
