# Moshboard

A local moodboard where references can be live: videos, websites, and runnable components. Motion references get recreated as tunable code frames, and the board exports exact specs (`design.md`, `motion.md`, `tokens.css`, `snippets/`).

## Run

- `pnpm dev`: app at http://localhost:5180 (`#<board>` in the URL picks the board)
- `pnpm export <board> [--out <dir>]`: write the spec files (default `boards/<board>/export/`)
- `pnpm typecheck`
- `MOSHBOARD_BOARDS=<dir>` (dev and export) keeps boards in another folder, usually a `design/` folder in an app repo (`server/boards-dir.ts`; relative paths are taken from where the command was run). The client shows that folder as `__BOARDS__`.
- `pnpm build:web`: the website (Vercel Build Output in `.vercel/output`: static app plus the functions in `server/web/`); boards live in a folder the user picks in Chrome
- `pnpm dev:web`: the local app behaving as the website (folder mode), for testing it
- `pnpm skill:install`: links `.claude/skills/recreate` into `~/.claude/skills` so `/recreate` works in any repo

## Layout

- `boards/<board>/board.json`: frames (see `shared/types.ts`). `frames/` holds code frame sources, `assets/` holds uploads, analysis json and contact sheets. The app watches these files, so editing them on disk shows up live.
- `server/`: Vite plugin providing the API (`plugin.ts`), ffmpeg motion analysis (`analyze-video.ts`), Playwright site capture (`capture-url.ts`, uses installed Chrome), and export (`export.ts`, also used by `scripts/export.ts`).
- `shared/params.ts`: the `@param` annotation format (parse, format, lock), shared by the app and the export.
- `shared/props.ts`: a code frame's own component props (read from its props type and destructured defaults) become labeled, grouped controls in the side panel (`src/tuning/PropsInspector.tsx`). Values are saved to the frame's `props` in board.json and passed to the component, not written into the code. A pasted README snippet (imports + bare JSX) becomes a `Preview` component whose literal attributes are its props, typed from the package's `.d.ts` on esm.sh when it has one (`shared/snippet.ts`).
- `src/frames/sandbox.ts`: how code frames run (sandboxed iframe, esm.sh import map with shared React/three/R3F, `moodboard` + `@/lib/utils` modules, plus any `@/…` files from a registry install). Tailwind is compiled per frame on the server (`server/tailwind.ts`, from the classes in the source), falling back to the in-browser build if that fails, so class names built at runtime from data won't get styles.
- Code frames that import a provider-bound library (Chakra, MUI, Mantine: `shared/providers.ts`) render inside its preset; a frame's `wrapper` file (`frames/<id>.wrapper.tsx`, default-exports `Wrapper({ children })`) overrides that for any provider/context. Designers never see the word: the error card copies a fix prompt for Claude Code (`copySetupFix`).
- Motion is found two ways: `shared/detect-motion.ts` reads literals in the source (⌘S writes them back), and the probe in `sandbox.ts` measures CSS transitions/animations and Web Animations in the running frame (`shared/runtime-motion.ts`), which covers theme/library values. Measured values are tuned with a stylesheet inside the frame and saved to the frame's `runtime` in board.json, not to the code.
- `server/media-link.ts`: links to media pages (Cosmos elements, Dribbble, Are.na, direct .mp4/.jpg) are downloaded into `assets/` and become video/image frames (`origin` keeps the source URL). `server/snapshot.ts` snapshots sites that refuse to be framed.
- Deleting a block only removes it from board.json, so undo restores it whole. Opening a canvas (when undo history starts fresh) runs `server/sweep.ts`: files in `assets/`/`frames/` no block uses move to `boards/<board>/.trash/<time>/`, files touched in the last 10 minutes are left alone, and trash older than 30 days is emptied.
- Export (`server/export.ts`) covers the whole canvas, or only selected frame ids plus what they link to. `motion.md` follows the Design Harness motion format (named duration/delay/easing/spring/stagger tokens, patterns that use token names only, Philosophy left to the designer); `design.md` uses the same token-line style plus rules and intent read from notes; `interactions.md` keeps how each animation was measured. Names match `tokens.css` everywhere.
- `server/registry.ts`: resolves `npx shadcn@latest add …` / registry URLs into a component plus the files it imports.
- `.claude/skills/recreate/`: the `/recreate <board> <frameId>` workflow.
- Folder mode (`src/folder/`, `public/folder-sw.js`): the boards folder is picked in the browser (File System Access, Chrome/Edge/Arc) and its handle kept in IndexedDB. A service worker answers `/api/…` and `/media/…` from that folder, so the rest of the client is the same as with the local server; outside edits are watched with `FileSystemObserver`. Connecting writes the recreate skill and an `AGENTS.md` into the folder (never over the user's own). Website only (`VITE_FOLDER_ONLY`); the local app never uses a folder. A deleted or moved folder sends the site back to picking one. Links (Pinterest, Cosmos…), component installs, the Google Fonts list and the embed check run as Vercel functions (`server/web/`, also served by the local server for `dev:web`); the media is saved into the folder by the worker. Analysis, capture, snapshots, site fonts, export, GIF→video and sweep still need the local server.

## Website and local versions

One codebase, two versions. Locally (`pnpm dev`) everything works. The website is `pnpm build:web`, deployed on Vercel (project `moshboard`, team `eman-irfans-projects`) from the `release` branch only.

- Build everything on `main`. A feature that's only for the local app is switched off on the website with `FOLDER_ONLY` (`src/folder/folder.ts`): hide its entry points behind `!FOLDER_ONLY`. Ask "just for me or website too?" when it isn't said.
- "Publish the website" = fast-forward `release` to `main` and push; Vercel builds it. Pushes to `main` only make preview deployments.

## Design rules for the app UI

Very dark grey canvas (`#0f1012`). References sit in node-style blocks (shell + inner panel); text and notes sit directly on the canvas. Monochrome: selection, focus and active states are white/grey, never colored. Inter at 13px. Everything goes through ⌘K or keyboard. The selected frame's controls sit in the docked right-hand panel (`src/tuning/Inspector.tsx`), never over the canvas; each control shows a changed dot (click to reset), the original value and, on a linked copy, the reference's measured timing. Control names come from where the code uses the value (`paramUse` in `shared/params.ts`) and can be renamed by double-click (saved to the frame's `labels`). All tokens live in `src/theme.css`.
