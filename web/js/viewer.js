// Lecteur : rendu MuseScore (webmscore), lecture audio, mes annotations + un calque par ami.
// Briques reprises de Partoche (js/partoche/) ; version volontairement simple (pas de mises en page multiples).
import { MsczFile } from './partoche/score.js'
import { parseMidi } from './partoche/midi.js'
import { Player } from './partoche/audio.js'
import { Ink } from './partoche/ink.js'

let WM = null
async function engine() {
  if (!WM) { WM = (await import('../lib/webmscore.mjs')).default; await WM.ready }
  return WM
}

export class Viewer {
  constructor(root, { onInkChange, onStatus }) {
    this.root = root
    this.scroller = root.querySelector('.scroller')
    this.pagesEl = root.querySelector('.pages')
    this.player = new Player()
    this.ink = new Ink(this.scroller, () => onInkChange && onInkChange(this.ink.serialize()))
    this.ink.onEditText = (init, cb) => cb(prompt('Texte :', init || ''))
    this.onStatus = onStatus || (() => { })
    this.score = null; this.urls = []
  }

  async open(bytes, name, myPages, layers) {
    this.close()
    this.onStatus('Mise en page de la partition…')
    const mf = new MsczFile(bytes, name)
    const W = await engine()
    const sc = await W.load('mscz', mf.build({ visible: mf.parts.map(p => p.visible !== false), names: 'off' }), [], true)
    this.score = sc; this.mf = mf
    const n = await sc.npages()
    const pos = await sc.measurePositions()
    const els = []
    for (let i = 0; i < n; i++) {
      const d = document.createElement('div')
      d.className = 'page'; d.style.aspectRatio = `${pos.pageSize.width} / ${pos.pageSize.height}`
      d.innerHTML = `<div class="loading">Page ${i + 1}…</div><img alt=""><span class="pnum">${i + 1} / ${n}</span>`
      this.pagesEl.appendChild(d); els.push(d)
    }
    this.ink.attach(els, myPages || [], null)
    this.ink.setLayers(layers || [])
    // audio (préparé en arrière-plan)
    const midi = parseMidi(await sc.saveMidi(true, true))
    const staffPart = []; mf.parts.forEach(p => p.staves.forEach(() => staffPart.push(p.index)))
    this.player.setScore(midi, mf.parts.length, (ti) => staffPart[Math.min(ti, staffPart.length - 1)] ?? 0, [], null)
    this.sounds = null
    // pages, une par une
    for (let i = 0; i < n; i++) {
      if (this.score !== sc) return
      this.onStatus(`Page ${i + 1} / ${n}…`)
      const svg = await sc.saveSvg(i, true)
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); this.urls.push(url)
      els[i].querySelector('img').src = url
      els[i].querySelector('.loading').remove()
    }
    this.onStatus('')
    return { parts: mf.parts.map(p => p.name), pages: n }
  }
  setLayers(layers) { this.ink.setLayers(layers) }
  async togglePlay() {
    if (!this.score) return false
    if (this.player.playing) { this.player.pause(); return false }
    const c = this.player.ensureCtx(); if (c.state !== 'running') c.resume()
    if (!this.sounds) { this.onStatus('Chargement des instruments…'); this.sounds = this.player.loadInstruments(); await this.sounds; this.onStatus('') }
    await this.player.play()
    return true
  }
  stop() { this.player.stop() }
  close() {
    try { this.player.stop() } catch { }
    if (this.score) { try { this.score.destroy() } catch { } this.score = null }
    for (const u of this.urls) URL.revokeObjectURL(u)
    this.urls = []; this.pagesEl.innerHTML = ''
    this.ink.setEnabled(false)
  }
}

// titre / compositeur lus dans le .mscz (métadonnées MuseScore)
export function scoreInfo(bytes, name) {
  try {
    const mf = new MsczFile(bytes, name)
    const meta = k => { const m = mf.xml.match(new RegExp(`<metaTag name="${k}">([^<]*)</metaTag>`)); return m ? m[1].trim() : '' }
    const box = mf.xml.match(/<Text>\s*<style>[Tt]itle<\/style>\s*<text>([\s\S]*?)<\/text>/)
    const title = meta('workTitle') || (box ? box[1].replace(/<[^>]*>/g, '').trim() : '')
    return { title, composer: meta('composer'), parts: mf.parts.map(p => p.name) }
  } catch { return { title: '', composer: '', parts: [] } }
}
