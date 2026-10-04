# Moshboard

A moodboard where references can be live: videos, websites and runnable components. Motion references get recreated as code you can tune, and the board exports exact specs (`design.md`, `motion.md`, `tokens.css`, `snippets/`). Runs on your own computer.

## Setup (one time)

Install these free tools:

- [Node.js](https://nodejs.org) 24 or newer
- pnpm: `npm install -g pnpm`
- ffmpeg: `brew install ffmpeg` (Mac). Needed for video analysis and GIFs.
- [Google Chrome](https://www.google.com/chrome/). Needed for website capture and snapshots.
- [Claude Code](https://claude.com/claude-code) (optional). Needed for `/recreate`.

Then get the code and install it:

```bash
git clone https://github.com/emanirfan-creator/moshboard.git
cd moshboard
pnpm install
```

To get updates later, run `git pull` and then `pnpm install` in that folder.

## Start

```bash
pnpm dev
```

Open http://localhost:5180. Boards are saved in the `boards/` folder on your computer. Each canvas has its own address, like `http://localhost:5180/#my-board`.

## The basics

- Press **⌘K** for the command menu. Everything can be done from there.
- Press **?** to see all keyboard shortcuts.
- Select a frame to see its controls in the panel on the right.
- New here? ⌘K → **Open the example board** shows a reference that's been measured, recreated and tuned.

### Adding things

- **Images and videos:** drag files in, paste with ⌘V, or press **A**.
- **Links:** paste a Pinterest, Cosmos, Dribbble, Are.na or website link. Media links are downloaded onto the board; websites show live (or as a snapshot if the site blocks embedding).
- **Components:** paste an `npx shadcn@latest add …` command, a registry link, or plain React code. It runs live on the canvas.
- **Text, notes, palettes, color and font swatches:** from ⌘K → Add.
- **Palettes come from your board.** A new palette, and every press of **Generate**, picks balanced colors from the board's images, videos and site snapshots: a dark, a light and the board's main accents. Select some references first to use only those. Lock a color to keep it.

### Recreating motion with Claude (`/recreate`)

1. For a video: select it, optionally mark the part you care about with **I** (start) and **O** (end), then ⌘K → **Analyze motion**.
   For a website: ⌘K → **Capture motion…**, click the element on the page screenshot, and choose what sets it off (hover, click, focus, scroll, load).
2. ⌘K → **Copy /recreate command**.
3. Open Claude Code in this folder (or in your project, if its boards live there) and paste it. It looks like:

   ```
   /recreate <board> <frameId>
   ```

4. A coded copy appears next to the reference, linked to it. Tune its timing, easing and springs with the controls under the frame, press **R** to replay both side by side, and **⌘S** to save the tuned values into the code.

Add a note linked to a reference (select both → ⌘K → **Link to reference**) to tell Claude what to focus on.

A link can hold more than two things: select something already linked plus a new frame → **Add to link**. **Unlink** on a copy or note removes just that one; on the reference it releases the whole group.

### Exporting

⌘K → **Export spec** writes `design.md`, `motion.md` (in the [Design Harness](#using-it-in-your-own-project) motion format), `interactions.md` (how each animation was measured), `tokens.css`, `tokens.json`, `snippets/` and `presets/` (ready-made transitions for motion/framer-motion and GSAP) into `boards/<board>/export/`. Select frames first to export only those.

⌘K → **Share as a page** makes one HTML file of the whole canvas that anyone can open in a browser: clips play, components run, and live sites stay live.

Each reference and its copy show their progress (measured → recreated → tuned) in the header, and the selected one shows its next step as a button.

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
| ⌃⌥T | Arrange the selection the way you last did (again: next shape) |
| ← ↑ → ↓ | Move a block inside a layout (it trades places) |
| L | Go to a linked block (again: the next one); clicking a link line goes to its other end |
| ⌥← | Back to where you were before the jump |
| ↵ | Crop a picture in a layout |
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
- **Palette:** Generate new colors (from the board), Split into swatches, Merge into one palette
- **Arrange:** Arrange as grid, in columns or in rows
- **Frame:** Link to reference, Add to link, Unlink, Duplicate, Delete
- **Canvas:** Fit to screen, Control sounds on/off, Export spec, New canvas, Show / hide sidebar, Go to another canvas

## Using it in your own project

Install Moshboard once, then keep each project's boards inside that project, next to its code. Claude Code working in the project can then read the board and its exported specs.

1. In the Moshboard folder, start it pointed at a folder in your project:

   ```bash
   MOSHBOARD_BOARDS=~/projects/my-app/design pnpm dev
   ```

   Boards are saved in `my-app/design/<board>/`. Commit them with the rest of the project.

2. Make `/recreate` work in any project (one time):

   ```bash
   pnpm skill:install
   ```

3. Export writes into the board's folder (`my-app/design/<board>/export/`). From the terminal, `--out` writes somewhere else:

   ```bash
   MOSHBOARD_BOARDS=~/projects/my-app/design pnpm export <board> --out ~/projects/my-app/docs/design
   ```

4. Tell Claude where the specs are. Add this to the project's `CLAUDE.md`:

   ```markdown
   ## Design
   The moodboard and its specs live in `design/<board>/` (made with Moshboard).
   Before building UI, read `design/<board>/export/design.md` and `motion.md`.
   Use the colors, fonts and spacing in `tokens.css`, and the timing and easing in `motion.md`.
   Coded references are in `export/snippets/`.
   ```

## Working with Claude Code

Claude Code can edit the board files directly (`boards/<board>/board.json` and `frames/`). Changes show up live in the app. `CLAUDE.md` and `.claude/skills/recreate/` are included, so Claude knows how the project works.
