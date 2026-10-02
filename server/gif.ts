// Animated GIFs are motion references: convert them to MP4 so they become video
// frames (scrubbable, segmentable, analyzable) instead of static images.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args)
    let out = ''
    let err = ''
    p.stdout.on('data', (c) => (out += c))
    p.stderr.on('data', (c) => (err += c))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.split('\n').slice(-3).join(' ')))))
  })
}

export async function isAnimatedGif(abs: string) {
  if (!/\.gif$/i.test(abs)) return false
  const out = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-count_packets',
    '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', abs,
  ]).catch(() => '1')
  return Number(out.trim()) > 1
}

/** Pixel size of an image or video file, or null if ffprobe can't read it. */
export async function probeSize(abs: string): Promise<{ width: number; height: number } | null> {
  const out = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', abs,
  ]).catch(() => '')
  const [width, height] = out.trim().split('x').map(Number)
  return width && height ? { width, height } : null
}

/** Convert an animated GIF (board-relative path) to MP4. Returns the new path, or null if it's a still GIF. */
const running = new Map<string, Promise<string | null>>()

export function gifToVideo(boardDir: string, rel: string): Promise<string | null> {
  // Safe to call twice (e.g. two open tabs): share the in-flight job, and if the
  // GIF is already gone but its MP4 exists, just return that.
  const key = path.join(boardDir, rel)
  let job = running.get(key)
  if (!job) {
    job = convert(boardDir, rel).finally(() => running.delete(key))
    running.set(key, job)
  }
  return job
}

async function convert(boardDir: string, rel: string): Promise<string | null> {
  const abs = path.join(boardDir, rel)
  const outRel = rel.replace(/\.gif$/i, '.mp4')
  if (!fs.existsSync(abs)) return fs.existsSync(path.join(boardDir, outRel)) ? outRel : null
  if (!(await isAnimatedGif(abs))) return null
  await run('ffmpeg', [
    '-v', 'error', '-y', '-i', abs,
    '-movflags', 'faststart', '-pix_fmt', 'yuv420p',
    // even dimensions for H.264; keep the GIF's own timing
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-crf', '20',
    path.join(boardDir, outRel),
  ])
  fs.rmSync(abs)
  return outRel
}
