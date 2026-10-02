# Roto

A moodboard where references can be live: videos, websites and runnable components. Motion references get recreated as code you can tune, and the board exports exact specs (`design.md`, `motion.md`, `tokens.css`, `snippets/`). Runs on your own computer.

## Setup (one time)

Install these free tools:

- [Node.js](https://nodejs.org) 24 or newer
- pnpm: `npm install -g pnpm`
- ffmpeg: `brew install ffmpeg` (Mac). Needed for video analysis and GIFs.
- [Google Chrome](https://www.google.com/chrome/). Needed for website capture and snapshots.
- [Claude Code](https://claude.com/claude-code) (optional). Needed for `/recreate`.

Then in this folder:

```bash
pnpm install
```

## Start

```bash
pnpm dev
```

Open http://localhost:5180. Boards are saved in the `boards/` folder on your computer. Each canvas has its own address, like `http://localhost:5180/#my-board`.

## The basics

- Press **⌘K** for the command menu. Everything can be done from there.
- Press **?** to see all keyboard shortcuts.
- Select a frame to see its controls underneath it.

### Adding things

- **Images and videos:** drag files in, paste with ⌘V, or press **A**.
- **Links:** paste a Pinterest, Cosmos, Dribbble, Are.na or website link. Media links are downloaded onto the board; websites show live (or as a snapshot if the site blocks embedding).
- **Components:** paste an `npx shadcn@latest add …` command, a registry link, or plain React code. It runs live on the canvas.
- **Text, notes, palettes, color and font swatches:** from ⌘K → Add.

### Recreating motion with Claude (`/recreate`)

1. For a video: select it, optionally mark the part you care about with **I** (start) and **O** (end), then ⌘K → **Analyze motion**.
   For a website: ⌘K → **Capture motion…**
2. ⌘K → **Copy /recreate command**.
3. Open Claude Code in this folder and paste it. It looks like:

   ```
   /recreate <board> <frameId>
   ```

4. A coded copy appears next to the reference, linked to it. Tune its timing, easing and springs with the controls under the frame, press **R** to replay both side by side, and **⌘S** to save the tuned values into the code.

Add a note linked to a reference (select both → ⌘K → **Link to reference**) to tell Claude what to focus on.

### Exporting

⌘K → **Export spec** writes `design.md`, `motion.md`, `tokens.css`, `tokens.json` and `snippets/` into `boards/<board>/export/`. Select frames first to export only those.

From the terminal:

```bash
pnpm export <board>
```

Add `--out <folder>` to write somewhere else.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| ⌘K | Command menu |
| ? | Show all shortcuts |
| A | Add to canvas |
| ⌘V | Paste image, link or component |
| T / double-click | Write text on the canvas |
| N | Add a note |
| [ | Show / hide sidebar |
| Drag on empty canvas | Select an area |
| Shift + click | Add to selection |
| ⌃⌥T | Tidy up selection into a grid |
| ⌘Z / ⌘⇧Z | Undo / redo |
| H / Space + drag | Pan |
| Pinch / ⌘ + scroll | Zoom |
| ⌘0 | Fit to screen |
| Double-click a frame | Interact with it |
| Esc | Stop interacting / deselect |
| R | Replay selected (and linked) |
| ⌘S | Save tuned values to code |
| I / O | Mark video segment start / end |
| ⌘C / ⌘V | Copy / paste frames |
| ⌘X | Cut |
| ⌘D | Duplicate |
| ⌫ | Delete |

## Command menu (⌘K)

What shows up depends on what's selected.

- **Add:** Image or video, Component, Link, Text, Note, Palette, Color swatch, Font swatch
- **Video:** Analyze motion, Mark segment start / end, Clear segment, Copy /recreate command, Replay with linked copy
- **Site:** Capture motion, Copy /recreate command, Render at 375 / 768 / 1280px wide
- **Code frame:** Replay, Save tuned values to code, Reset tuned values, Detect motion values, Add controls to code, Copy /recreate command
- **Palette:** Generate new colors, Split into swatches, Merge into one palette
- **Arrange:** Tidy up into a grid, Align left, Align top
- **Frame:** Link to reference, Unlink, Duplicate, Delete
- **Canvas:** Fit to screen, Control sounds on/off, Export spec, New canvas, Show / hide sidebar, Go to another canvas

## Working with Claude Code

Claude Code can edit the board files directly (`boards/<board>/board.json` and `frames/`). Changes show up live in the app. `CLAUDE.md` and `.claude/skills/recreate/` are included, so Claude knows how the project works.
