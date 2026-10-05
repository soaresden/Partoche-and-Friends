// Aperçu 30 s depuis le tableau (repris de Partoche) : démarre au refrain si on le trouve,
// sinon au passage le plus riche. Un seul aperçu à la fois.
import { MsczFile } from './partoche/score.js'
import { parseMidi } from './partoche/midi.js'
import { Player } from './partoche/audio.js'

let WM = null
async function engine() {
  if (!WM) { WM = (await import('../lib/webmscore.mjs')).default; await WM.ready }
  return WM
}
const player = new Player()
const startOf = new Map()   // id -> { t, how }
let cur = null              // { id, timer, tick, onState }

export const previewing = () => cur && cur.id
export function stopPreview() {
  if (!cur) return
  const p = cur; cur = null
  clearTimeout(p.timer); clearInterval(p.tick)
  try { player.pause(); if (player.master && player.ctx) player.master.gain.setValueAtTime(0.8, player.ctx.currentTime) } catch { }
  p.onState(null, 0)
}

// getBytes() -> Uint8Array ; onState(state 'loading'|'playing'|null, progression 0..1, info)
export async function togglePreview(id, name, getBytes, onState) {
  if (cur && cur.id === id) { stopPreview(); return }
  stopPreview()
  const me = cur = { id, onState }
  onState('loading', 0)
  try {
    { const c = player.ensureCtx(); if (c.state !== 'running') c.resume() }   // iPad : dans le geste
    const mf = new MsczFile(await getBytes(), name)
    const W = await engine()
    const sc = await W.load('mscz', mf.build({ visible: mf.parts.map(() => true), names: 'off' }), [], false)
    const midi = parseMidi(await sc.saveMidi(true, true))
    sc.destroy()
    if (cur !== me) return
    const staffPart = []; mf.parts.forEach(p => p.staves.forEach(() => staffPart.push(p.index)))
    player.setScore(midi, mf.parts.length, ti => staffPart[Math.min(ti, staffPart.length - 1)] ?? 0, mf.parts.map(() => ({ volume: 1 })))
    player.rate = 1; player.setLoop(null)
    let st = startOf.get(id)
    if (!st) { st = findChorus(player.notes, player.duration); startOf.set(id, st) }
    await player.loadInstruments()
    if (cur !== me) return
    player.seek(st.t)
    player.master.gain.setValueAtTime(0.8, player.ctx.currentTime)
    await player.play()
    const LEN = 30, t0 = performance.now(), end = Math.min(LEN, Math.max(3, player.duration - st.t))
    onState('playing', 0, st)
    me.tick = setInterval(() => onState('playing', Math.min(1, (performance.now() - t0) / 1000 / end), st), 250)
    me.timer = setTimeout(() => {   // fondu de sortie
      try { player.master.gain.setTargetAtTime(0, player.ctx.currentTime, 0.6) } catch { }
      me.timer = setTimeout(() => { if (cur === me) stopPreview() }, 2200)
    }, (end - 2) * 1000)
    player.onEnd = () => { if (cur === me) stopPreview() }
  } catch (e) {
    console.warn('aperçu', e)
    if (cur === me) { stopPreview(); throw e }
  }
}

/** Le refrain : la phrase (~8 s) qui revient le plus, en privilégiant les passages denses et en évitant l'intro. */
function findChorus(notes, duration) {
  const STEP = 0.5, L = 16
  const n = Math.ceil(duration / STEP)
  if (n < L * 2 + 4) return { t: 0, how: 'début' }
  const chroma = Array.from({ length: n }, () => new Float32Array(12))
  const energy = new Float32Array(n)
  for (const x of notes) {
    const a = Math.floor(x.t / STEP), b = Math.min(n - 1, Math.floor((x.t + Math.min(x.d, 2)) / STEP))
    const w = x.vel / 127
    for (let i = a; i <= b; i++) { if (x.prog >= 0) chroma[i][x.key % 12] += w; energy[i] += w }
  }
  for (const c of chroma) { let m = 0; for (const v of c) m += v * v; m = Math.sqrt(m) || 1; for (let k = 0; k < 12; k++) c[k] /= m }
  const sim = (i, j) => { let s = 0; for (let k = 0; k < 12; k++) s += chroma[i][k] * chroma[j][k]; return s }
  const segE = new Float32Array(n)
  for (let i = 0; i + L <= n; i++) { let e = 0; for (let k = 0; k < L; k++) e += energy[i + k]; segE[i] = e }
  const maxE = Math.max(...segE) || 1
  const minStart = Math.floor(5 / STEP)
  let best = -1, bestScore = 0, bestReps = 0
  const lastStart = Math.max(minStart, Math.floor((duration - 25) / STEP))
  for (let s = minStart; s + L <= n && s <= lastStart; s += 2) {
    if (segE[s] < maxE * 0.35) continue
    let reps = 0
    for (let t = 0; t + L <= n; t += 2) {
      if (Math.abs(t - s) < L) continue
      let acc = 0
      for (let k = 0; k < L; k++) acc += sim(s + k, t + k)
      if (acc / L > 0.88) { reps++; t += L - 2 }
    }
    const score = reps * (0.6 + 0.4 * segE[s] / maxE)
    if (score > bestScore * 1.15) { bestScore = score; best = s; bestReps = reps }
  }
  if (best >= 0 && bestReps >= 1) {
    let s = best
    for (let k = 0; k < 4 && s > minStart && energy[s - 1] >= energy[s] * 0.5; k++) s--
    return { t: s * STEP, how: 'refrain' }
  }
  let dense = 0
  for (let i = minStart; i + L <= n; i++) if (segE[i] > segE[dense]) dense = i
  return { t: dense * STEP, how: 'passage le plus riche' }
}
