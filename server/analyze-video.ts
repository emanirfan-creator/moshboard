import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { analyzeFrames } from '../shared/analyze-motion.ts'
import type { Region, Segment, VideoAnalysis } from '../shared/types.ts'

const FPS = 30
const W = 192

function run(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args)
    const out: Buffer[] = []
    const err: Buffer[] = []
    p.stdout.on('data', (c: Buffer) => out.push(c))
    p.stderr.on('data', (c: Buffer) => err.push(c))
    p.on('error', reject)
    p.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out))
      else reject(new Error(`${cmd} failed: ${Buffer.concat(err).toString().split('\n').slice(-4).join(' ')}`))
    })
  })
}

async function probe(file: string) {
  const out = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration',
    '-of', 'json',
    file,
  ])
  const j = JSON.parse(out.toString())
  return { width: j.streams[0].width as number, height: j.streams[0].height as number, duration: +j.format.duration }
}

/** Motion timing from a clip (shared/analyze-motion.ts), with frames from ffmpeg, plus a contact sheet. */
export async function analyzeVideo(boardDir: string, src: string, id: string, segment?: Segment, region?: Region): Promise<VideoAnalysis> {
  const file = path.resolve(boardDir, src)
  if (!file.startsWith(boardDir + path.sep) || !fs.existsSync(file)) throw new Error(`video not found: ${src}`)
  const info = await probe(file)
  const seg: Segment = segment && segment.out > segment.in ? segment : { in: 0, out: info.duration }
  // An area picked on the video: only that part is read.
  const r = region && region.w > 0.02 && region.h > 0.02 ? region : undefined
  const srcW = info.width * (r?.w ?? 1)
  const srcH = info.height * (r?.h ?? 1)
  const h = Math.max(2, Math.round((W * srcH) / srcW / 2) * 2)
  const span = ['-ss', String(seg.in), '-t', String(seg.out - seg.in)]
  const crop = r ? `crop=iw*${r.w}:ih*${r.h}:iw*${r.x}:ih*${r.y},` : ''

  const raw = await run('ffmpeg', [
    '-v', 'error', ...span, '-i', file,
    '-vf', `fps=${FPS},${crop}scale=${W}:${h},format=gray`,
    '-f', 'rawvideo', '-',
  ])
  const { bursts, primary, energy, read } = analyzeFrames(raw, W, h, seg, FPS)

  const sheetRel = `assets/${id}.sheet.png`
  const sheetFps = Math.min(FPS, 24 / Math.max(0.1, seg.out - seg.in))
  await run('ffmpeg', [
    '-v', 'error', '-y', ...span, '-i', file,
    '-vf', `fps=${sheetFps},scale=240:-2,tile=6x4:padding=6:margin=6:color=0x2a2b30`,
    '-frames:v', '1', path.join(boardDir, sheetRel),
  ])

  const analysis: VideoAnalysis = {
    source: src,
    fps: FPS,
    segment: seg,
    bursts,
    primary,
    energy,
    contactSheet: sheetRel,
    read,
    ...(r ? { region: r } : {}),
  }
  fs.writeFileSync(path.join(boardDir, `assets/${id}.analysis.json`), JSON.stringify(analysis, null, 2) + '\n')
  return analysis
}
