import { useMemo } from 'react'
import { detectMotion, type Detection } from '../../shared/detect-motion.ts'
import { parseParams } from '../../shared/params.ts'
import type { Frame } from '../../shared/types.ts'
import { useStore } from '../store'

const NONE: Detection = { params: [], groups: [] }

export function parseModules(raw: string | undefined): Record<string, string> {
  try {
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/** Motion values found in a frame's code and its modules. Explicit `@param` names win on a clash. */
export function detectFor(frame: Frame, source: string | undefined, modulesRaw: string | undefined): Detection {
  if (!frame.file || source === undefined) return NONE
  // The block and the side panel both scan the same code: do it once per version of it.
  const key = `${frame.file}\n${frame.modules ?? ''}`
  const hit = scans.get(key)
  if (hit && hit.source === source && hit.modulesRaw === modulesRaw) return hit.d
  const d = scan(frame.file, source, modulesRaw)
  scans.set(key, { source, modulesRaw, d })
  return d
}

const scans = new Map<string, { source: string; modulesRaw: string | undefined; d: Detection }>()

function scan(file: string, source: string, modulesRaw: string | undefined): Detection {
  const kind = file.endsWith('.html') ? 'html' : 'tsx'
  const d = detectMotion(source, parseModules(modulesRaw), kind, file.split('/').pop())
  const explicit = new Set(parseParams(source).map((p) => p.name))
  if (!d.params.some((p) => explicit.has(p.name))) return d
  const params = d.params.filter((p) => !explicit.has(p.name))
  return { params, groups: d.groups.map((g) => ({ ...g, params: g.params.filter((p) => !explicit.has(p.name)) })) }
}

/** Detection for a frame, re-run only when its source or modules change. */
export function useDetection(frame: Frame): Detection {
  const source = useStore((s) => (frame.file ? s.files[frame.file] : undefined))
  const modulesRaw = useStore((s) => (frame.modules ? s.files[frame.modules] : undefined))
  return useMemo(() => detectFor(frame, source, modulesRaw), [frame.file, frame.modules, source, modulesRaw])
}
