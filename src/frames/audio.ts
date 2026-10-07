import { useSyncExternalStore } from 'react'
import { encodeWav, readSound, soundName, splitAtSilences } from '../../shared/sound.ts'
import type { Clip, SoundReading } from '../../shared/types.ts'
import { api } from '../api'
import { getState, setState, toast } from '../store'

// Sound blocks: playing them (one at a time, like a real deck), measuring them in the page
// (so the website reads them the same as the local app), Spotify's player, and recording a tab.

/** Content size for each kind, before the block's header and padding. */
export const SOUND_SIZE = { w: 424, h: 200 }
export const SPOTIFY_SIZE = { w: 360, h: 250 }
export const PAD = 64
export const PAD_GAP = 6
export const PADS_PER_ROW = 8
/** A row of pads is as wide as its sounds (up to 8 a row). */
export const padsSize = (n: number) => {
  const cols = Math.max(1, Math.min(PADS_PER_ROW, n))
  const rows = Math.max(1, Math.ceil(n / PADS_PER_ROW))
  return { w: cols * PAD + (cols - 1) * PAD_GAP + 24, h: rows * PAD + (rows - 1) * PAD_GAP + 24 }
}

let ctx: AudioContext | null = null
const audioCtx = () => (ctx ??= new AudioContext())

/** A file's samples, mixed to mono. */
async function decode(url: string) {
  const data = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.arrayBuffer()
  })
  return mono(await audioCtx().decodeAudioData(data))
}

function mono(b: AudioBuffer) {
  const x = new Float32Array(b.length)
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c)
    for (let i = 0; i < x.length; i++) x[i] += d[i] / b.numberOfChannels
  }
  return { x, rate: b.sampleRate }
}

/** Measures the sound at `url`. */
export async function measure(url: string): Promise<SoundReading> {
  const { x, rate } = await decode(url)
  return readSound(x, rate)
}

// ── playback ────────────────────────────────────────────

/** What's playing: one sound at a time across the board, keyed by block id (or block:pad). */
interface Playing {
  key: string
  started: number
  length: number
}
let playing: Playing | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
let el: HTMLAudioElement | null = null
let loopKey: string | null = null

/** The sound playing, for drawing the reel and the playhead. */
export const usePlaying = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => playing,
  )

/** Which block is looping (Loop on). */
export const useLooping = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => loopKey,
  )

/**
 * Plays a sound. `speed` changes pitch with it, like a record at 33 or 45. Starting another
 * sound stops this one; a Spotify player playing is paused too.
 */
export function playSound(key: string, url: string, speed = 1) {
  stopSound()
  pauseSpotify()
  const a = new Audio(url)
  a.preservesPitch = false
  a.playbackRate = speed
  el = a
  a.onloadedmetadata = () => {
    if (playing?.key === key) ((playing = { ...playing, length: (a.duration / speed) * 1000 }), emit())
  }
  a.onended = () => {
    if (el !== a) return
    if (loopKey === key) {
      a.currentTime = 0
      a.play().catch(() => {})
      playing = { key, started: performance.now(), length: playing?.length ?? 0 }
      emit()
      return
    }
    playing = null
    el = null
    emit()
  }
  a.play().catch(() => toast('That sound won’t play here', true))
  playing = { key, started: performance.now(), length: 0 }
  emit()
}

export function stopSound() {
  if (el) {
    el.onended = null
    el.pause()
  }
  el = null
  if (playing) ((playing = null), emit())
}

export function setLoop(key: string, on: boolean) {
  loopKey = on ? key : loopKey === key ? null : loopKey
  emit()
}

// ── Spotify ─────────────────────────────────────────────

/** Spotify's own player in the block, driven by its iFrame API (open.spotify.com/embed/iframe-api). */
export interface SpotifyController {
  togglePlay(): void
  pause(): void
  destroy(): void
  addListener(ev: 'playback_update', cb: (e: { data: { isPaused: boolean; position: number; duration: number } }) => void): void
}
interface SpotifyApi {
  createController(el: HTMLElement, opts: { uri: string; width: string | number; height: number }, cb: (c: SpotifyController) => void): void
}

let spotifyApi: Promise<SpotifyApi> | null = null
export function loadSpotify(): Promise<SpotifyApi> {
  return (spotifyApi ??= new Promise((resolve, reject) => {
    const w = window as unknown as { onSpotifyIframeApiReady?: (api: SpotifyApi) => void }
    w.onSpotifyIframeApiReady = resolve
    const s = document.createElement('script')
    s.src = 'https://open.spotify.com/embed/iframe-api/v1'
    s.async = true
    s.onerror = () => ((spotifyApi = null), reject(new Error('Spotify’s player didn’t load')))
    document.head.appendChild(s)
  }))
}

/** Spotify players on the board, so starting one sound pauses the others. */
export const spotifyPlayers = new Map<string, SpotifyController>()
let spotifyOn: string | null = null
export function spotifyPlaying(id: string, on: boolean) {
  if (on) {
    stopSound()
    for (const [k, c] of spotifyPlayers) if (k !== id && spotifyOn === k) c.pause()
    spotifyOn = id
  } else if (spotifyOn === id) spotifyOn = null
}
function pauseSpotify() {
  if (spotifyOn) spotifyPlayers.get(spotifyOn)?.pause()
  spotifyOn = null
}

const SPOTIFY = /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/

/** A Spotify link's kind and id, or null. */
export function spotifyLink(url: string) {
  const m = SPOTIFY.exec(url)
  return m ? { kind: m[1], id: m[2], uri: `spotify:${m[1]}:${m[2]}`, url: `https://open.spotify.com/${m[1]}/${m[2]}` } : null
}

/** Its title, from Spotify's oEmbed (no key needed, and it allows the page to ask). */
export async function spotifyTitle(url: string): Promise<string | undefined> {
  try {
    const r = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`)
    return r.ok ? ((await r.json()) as { title?: string }).title : undefined
  } catch {
    return undefined
  }
}

// ── recording a tab ─────────────────────────────────────

let recorder: MediaRecorder | null = null

/**
 * Records the sound of a tab you pick (Chrome asks which, with "Also share tab audio").
 * Stopping splits it at the silences and saves each sound; `done` gets them, named by how they sound.
 */
export async function recordTab(done: (clips: Clip[]) => void) {
  if (recorder) return stopRecording()
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      // Chrome: offer tabs first, and not this one.
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude',
      systemAudio: 'exclude',
    } as DisplayMediaStreamOptions)
  } catch {
    return // picker closed
  }
  const tracks = stream.getAudioTracks()
  if (!tracks.length) {
    stream.getTracks().forEach((t) => t.stop())
    toast('Pick a tab with “Also share tab audio” on', true)
    return
  }
  const audio = new MediaStream(tracks)
  const chunks: Blob[] = []
  const rec = new MediaRecorder(audio)
  recorder = rec
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  rec.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop())
    recorder = null
    setState({ recording: null })
    try {
      const clips = await saveClips(new Blob(chunks, { type: rec.mimeType }))
      if (!clips.length) return toast('No sounds in that recording', true)
      done(clips)
    } catch (e) {
      toast(`Couldn’t read the recording: ${(e as Error).message}`, true)
    }
  }
  // Ending the share from Chrome's bar stops it too.
  stream.getTracks().forEach((t) => (t.onended = () => stopRecording()))
  rec.start()
  setState({ recording: Date.now() })
}

export function stopRecording() {
  if (recorder?.state === 'recording') recorder.stop()
}

const MAX_CLIPS = 16

async function saveClips(blob: Blob): Promise<Clip[]> {
  const { x, rate } = mono(await audioCtx().decodeAudioData(await blob.arrayBuffer()))
  const parts = splitAtSilences(x, rate).slice(0, MAX_CLIPS)
  const board = getState().boardName
  const used = new Map<string, number>()
  const clips: Clip[] = []
  for (const p of parts) {
    const piece = x.slice(p.start, p.end)
    const sound = readSound(piece, rate)
    const base = soundName(sound)
    const n = (used.get(base) ?? 0) + 1
    used.set(base, n)
    const name = n > 1 ? `${base} ${n}` : base
    const file = new File([encodeWav(piece, rate)], `${name.toLowerCase().replace(/\s+/g, '-')}.wav`, { type: 'audio/wav' })
    const up = await api.upload(board, file)
    clips.push({ src: up.path, name, sound })
  }
  return clips
}
