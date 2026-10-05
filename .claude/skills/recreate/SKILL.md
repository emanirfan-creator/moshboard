---
name: recreate
description: Recreate a Moshboard reference (video, live site, or image) as a tunable code frame next to it on the board. Use when the user runs /recreate <board> <frameId>, or asks to "copy", "replicate", or "code up" a reference on the Moshboard canvas.
---

# /recreate <board> <frameId>

Turn one reference frame into a **coded copy** with `@param` handles, placed next to it and linked to it. The user then tunes it side by side in the app, so aim for structure and motion character first. Exact values get dialed in on the canvas.

## Where the board is

Paths below are relative to the board folder, `<boards>/<board>/` (the one holding `board.json`). In the Moshboard folder itself that's `boards/<board>/`. In an app repo, boards sit wherever Moshboard was pointed with `MOSHBOARD_BOARDS` (often `design/<board>/`); find `<board>/board.json` if it isn't obvious. In a folder connected to Moshboard in the browser (this skill sits in its `.claude/`), each board is a subfolder next to `.claude/`, or, when `board.json` is right there, the folder itself is the board.

In that browser version, "Analyze motion" and "Capture motion…" aren't available yet. If a video has no `analysis`, work from the clip itself (pull frames with `ffmpeg` if it's installed) and say the timings are estimates.

## 1. Read the reference

- `board.json`: find the frame by `id`. Note its `type`, `src`, `segment`, `analysis` (its `read` says what kind of video it is and every move; `motionKind` on the frame overrides the kind), `label`, and any `note` frames linked to this id: a `links` entry with `"ref": "<id>"` (or, on older boards, `"link": "<id>"`). They hold the user's intent; follow them. Also read any open `comments` (top-level in `board.json`) with `"on": "<id>"`: the user's feedback on it, first message then replies.
- **video**: if `analysis` is missing, ask the user to select the video and press "Analyze motion" (or mark a segment with I/O first). Then read:
  - `assets/<id>.analysis.json`: `primary.startMs`, `primary.durationMs`, `primary.ease.bezier`, and `bursts` (several bursts usually mean stagger or a sequence).
  - `assets/<id>.sheet.png`: the keyframe contact sheet (6×4, left→right, top→bottom, evenly spaced across the segment). **Look at it.** It's how you see what moves, in what order, and how far.
- **url**: read `assets/<id>.capture.json` if present. Its transitions and animations are **exact**; use those numbers as-is. If there's no capture, ask the user to run "Capture motion…" from ⌘K. A scaffold frame linked to the site may already exist; improve that frame rather than adding a duplicate.
- **image**: static reference. Recreate the layout and visual style; only add motion if a linked note asks for it.

## 2. Write the frame

Create `frames/<frameId>-copy.tsx` (React) or `.html` for plain CSS work.

Conventions:
- Default export a component (tsx). Tailwind v4 classes work, plus shadcn tokens (`bg-background`, `text-foreground`, `bg-primary`, `text-muted-foreground`, `border-border`). Frames render inside a block whose inner panel is `#1b1c1f`; keep the component background transparent unless the reference has its own surface.
- Any npm package can be imported by name (it resolves through esm.sh): `motion/react`, `lucide-react`, etc. `@/lib/utils` provides `cn`.
- Put **every timing value** behind a param, one per line, in comments at the top:
  ```
  /* @param duration 420ms 80..1600 */
  /* @param delay 0ms 0..800 */
  /* @param stagger 60ms 0..300 */
  /* @param ease cubic-bezier(0.16, 1, 0.3, 1) */
  /* @param spring stiffness=400 damping=30 */
  /* @param distance 16px 0..64 */
  /* @param tint #5e6ad2 */
  /* @param mix 0.3 0..1 blur|sharp */   (a share between two parts: the first part's share, shown as a split control)
  /* @trigger hover | click | mount | scroll | loop */
  /* @animates transform, opacity */
  ```
  Names `duration`, `delay`, `stagger` (ms) get the draggable timeline. `ease` gets the curve editor and `spring` gets the spring pad. Always give numbers a `min..max` range that comfortably brackets the estimate.
- Read params as CSS vars (`var(--p-duration)`, `var(--p-ease)`) or in JS with `import { useParams } from 'moodboard'`. `useParams()` returns ms as numbers, eases as `[x1,y1,x2,y2]` and springs as ready-to-use motion transitions (`{ type: 'spring', stiffness, damping }`). Divide ms by 1000 for motion's `duration`.
- If the trigger is `mount`, the user's Replay (R) remounts the frame, so mount animations are the easiest to compare. For hover/click references, either keep the real trigger, or add a mount-driven loop (wrapped in a `// demo loop` comment) so the copy can replay next to the video.
- Seed values from the analysis: `duration ≈ primary.durationMs`, `ease = primary.ease.bezier`, `delay = primary.startMs − segment.in*1000` when relevant, and `stagger` from the spacing between bursts.

## 3. Add it to the board

Edit `board.json` and append:
```json
{ "id": "<frameId>-copy", "type": "code", "file": "frames/<frameId>-copy.tsx",
  "label": "<ref label> (copy)", "link": "<frameId>",
  "x": <ref.x + ref.w + 48>, "y": <ref.y>, "w": <ref.w>, "h": <ref.h> }
```
Keep the existing JSON formatting (2-space indent). The app hot-reloads from disk, so the frame appears live. `"link"` is the simple way to link the copy to its reference: the app turns it into a numbered link (joining the reference's first link) when it reads the board.

## 4. Hand back

Tell the user, in a sentence or two, which params you exposed and which values are estimates versus exact (from a capture). Remind them: select the copy, press **R** to replay both together, adjust the controls in the right-hand panel, then press **⌘S** to save the values into the code.
