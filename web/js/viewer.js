// Lecteur complet repris de Partoche (js/app.js, section « LECTEUR »), adapté au collectif :
//   rendu MuseScore (webmscore) page par page, 4 mises en page, zoom, curseur qui suit la musique,
//   barre de lecture en bas (vitesse, boucle A–B, suivi), pistes (affichage, muet, solo, volume, instrument),
//   noms des notes, bandeau d'annotation complet, accordeur.
//   Les annotations dépendent de la « vue » (pistes affichées + noms des notes) : { <variantKey>: pages }.
//   Mes annotations sont modifiables ; celles des amis sont des calques en lecture seule (Ink.setLayers).
// Rien de prof / élève / Android ici : la sauvegarde passe par onInkChange (app.js -> library.js).
import { MsczFile } from './partoche/score.js'
import { parseMidi } from './partoche/midi.js'
import { Player, GM } from './partoche/audio.js'
import { Ink } from './partoche/ink.js'
import { Tuner } from './partoche/tuner.js'
import { lsGet, lsSet } from './partoche/store.js'

let WM = null
async function engine() {
  if (!WM) { WM = (await import('../lib/webmscore.mjs')).default; await WM.ready }
  return WM
}

const debounce = (fn, ms) => { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) } }
const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') }

// clé d'une « vue » : pistes affichées + options des noms de notes (même format que Partoche)
export const variantKey = o => [o.visible.map(v => v ? 1 : 0).join(''), o.names, o.octave ? 1 : 0, o.above ? 1 : 0, o.hideManual ? 1 : 0].join('-')

const LAYOUTS = ['vertical', 'two', 'horizontal', 'line']
const LAYOUT_ICON = { vertical: '#i-1up', two: '#i-2up', horizontal: '#i-hup', line: '#i-lineup' }
const isHoriz = l => l === 'horizontal' || l === 'line'
const SOUNDS = [['', 'Son d’origine'], [0, '🎹 Piano'], [40, '🎻 Violon'], [41, '🎻 Alto'], [42, '🎻 Violoncelle'], [43, 'Contrebasse'], [48, 'Cordes (ensemble)'], [73, '🪈 Flûte'], [71, 'Clarinette'], [68, 'Hautbois'], [65, '🎷 Saxophone'], [56, '🎺 Trompette'], [60, 'Cor'], [24, '🎸 Guitare'], [46, 'Harpe'], [52, '🎤 Voix (aah)'], [19, 'Orgue'], [21, 'Accordéon'], [12, 'Marimba'], [8, 'Célesta'], [4, 'Piano électrique']]
const TOOL_ICON = { pen: '#i-pen', hl: '#i-hl', text: '#i-text', eraser: '#i-eraser' }
const DEFAULT_PALETTE = ['#d11a2a', '#1f5fd6', '#138a4a', '#8b5a2b']
const DEFAULT_EMOJIS = [
  ['〰️', 'Vibrato'], ['🔔', 'Laisser résonner'], ['⏸️', 'Pause / silence'], ['🫁', 'Respirer'],
  ['⏱️', 'Tempo / métronome'], ['🐢', 'Ralentir'], ['🐇', 'Accélérer'], ['⚓', 'Garder le tempo'],
  ['📈', 'Crescendo'], ['📉', 'Decrescendo'], ['🔊', 'Fort'], ['🤫', 'Doux'],
  ['🌊', 'Legato / lié'], ['✂️', 'Détaché / staccato'],
  ['🪶', 'Léger'], ['💪', 'Appuyé'], ['❤️', 'Expressif'], ['🎯', 'Justesse'],
  ['👂', 'Écouter'], ['👀', 'Attention'], ['⚠️', 'Passage difficile'], ['🔁', 'À travailler'],
  ['🔄', 'Changement de position'], ['😮‍💨', 'Détendre'], ['⭐', 'Bien joué'], ['❓', 'À revoir'],
]
const G_KEY = 'maf:viewer'          // préférences du lecteur (toutes partitions) : outils, couleurs, emojis, volume…
const PREFS_KEY = 'maf:vprefs:'     // + nom|taille : réglages propres à une partition (pistes, sons, vitesse, zoom…)

export class Viewer {
  constructor(root, { onInkChange, onStatus, toast } = {}) {
    this.root = root
    this.onInkChange = onInkChange || (() => { })
    this.onStatus = onStatus || (() => { })
    this.toast = toast || ((m, ms) => { this.onStatus(m); clearTimeout(this._tt); this._tt = setTimeout(() => this.onStatus(''), ms || 2500) })
    this.scroller = root.querySelector('.scroller')
    this.pagesEl = root.querySelector('.pages')
    this.player = new Player()
    this.ink = new Ink(this.scroller, () => this._inkChanged())
    this.V = null               // état de la partition ouverte
    this.layers = []            // calques des amis (toutes vues)
    this.inkOn = false
    this.memberColor = ''
    this.G = Object.assign({ follow: true, vol: 1 }, lsGet(G_KEY, {}) || {})
    this.renderQ = []; this.rendering = false
    this.userScrollAt = 0; this.seekDragging = false
    this._wire()
  }

  // ---------------------------------------------------------------- outils
  $(s) { return this.root.querySelector(s) }
  $$(s) { return [...this.root.querySelectorAll(s)] }
  get visibleNow() { return !this.root.hidden }
  saveG() { lsSet(G_KEY, this.G) }
  busy(t) { this.onStatus(t || '') }

  // la couleur du membre devient la première couleur du stylo
  setMemberColor(c) {
    if (!/^#[0-9a-f]{6}$/i.test(c || '')) return
    const G = this.G
    c = c.toLowerCase()
    this.memberColor = c
    G.palette = [c, ...(G.palette || DEFAULT_PALETTE).filter(x => x.toLowerCase() !== c)]
    G.color = c   // à chaque ouverture, le stylo repart de ma couleur
    this.ink.color = G.color
    if (this.ink.tool === 'eraser' || this.ink.tool === 'hl') { this.ink.setTool('pen'); G.tool = 'pen' }
    this.saveG(); this.renderSwatches(); this.paintInkbar()
  }

  // ---------------------------------------------------------------- ouverture
  // myInk : { <variantKey>: pages } (format actuel) ou tableau de pages (ancien format = vue par défaut)
  async open(bytes, name, myInk, layers) {
    this.close()
    this.busy('Mise en page de la partition…')
    const mf = new MsczFile(bytes, name)
    const G = this.G
    const fileKey = name + '|' + mf.bytes.length
    const prefs = lsGet(PREFS_KEY + fileKey, null) || {}
    const defVisible = mf.parts.map(p => p.visible !== false)
    const V = this.V = {
      mf, fileKey, tok: 0, score: null, midiReady: false,
      visible: (prefs.visible && prefs.visible.length === mf.parts.length) ? prefs.visible : defVisible.slice(),
      mix: (prefs.mix && prefs.mix.length === mf.parts.length) ? prefs.mix : mf.parts.map(() => ({ volume: 1, muted: false, solo: false })),
      sound: prefs.sound || {},
      rate: prefs.rate || 1, zoom: prefs.zoom || 1,
      layout: LAYOUTS.includes(prefs.layout) ? prefs.layout : (LAYOUTS.includes(G.layout) ? G.layout : 'vertical'),
      loop: null, loopPick: null, svg: new Map(),
      notes: Object.assign({ names: 'off', octave: false, above: false, hideManual: true }, prefs.notes || {}),
      ink: {},
    }
    if (!V.visible.some(Boolean)) V.visible[0] = true
    // vue par défaut (celle de l'ancien lecteur) : pistes d'origine, sans noms de notes
    V.defaultKey = variantKey({ visible: defVisible, names: 'off', octave: false, above: false, hideManual: false })
    if (Array.isArray(myInk)) { if (myInk.some(p => p && p.length)) V.ink[V.defaultKey] = myInk }
    else if (myInk && typeof myInk === 'object') V.ink = JSON.parse(JSON.stringify(myInk))
    this.layers = layers || []
    V.renderedVisible = V.visible.slice()
    this.applyZoom(); this.applyLayout()
    this.player.rate = V.rate; this.player.setRate(V.rate); this.updateSpeedUI()
    this.player.setLoop(null); this.$('#vLoopBtn').classList.remove('on'); this.paintLoopBar()
    this.setInk(false)
    this.setPlayIcon(false)
    this.$('#vCur').textContent = '0:00'; this.$('#vSeek').value = 0
    this.buildTrackList()
    this.updateNamesUI()
    this.scroller.scrollTop = 0; this.scroller.scrollLeft = 0
    await this.renderVariant(true)
    return { parts: mf.parts.map(p => p.name), pages: V.npages || 0 }
  }

  // calques des amis : [{ id, who, color, data, updated, visible }] ; data = { <variantKey>: pages } ou tableau (vue par défaut)
  setLayers(layers) { this.layers = layers || []; this._applyLayers() }
  _layerPages(data) {
    const V = this.V; if (!V || !data) return null
    if (Array.isArray(data)) return V.key === V.defaultKey ? data : null
    return data[V.key] || null
  }
  _applyLayers() {
    if (!this.V) return this.ink.setLayers([])
    this.ink.setLayers(this.layers.map(L => ({ who: L.who, color: L.color, visible: L.visible, data: this.toView(this._layerPages(L.data), false) })))
  }

  savePrefs() {
    const V = this.V; if (!V) return
    lsSet(PREFS_KEY + V.fileKey, { visible: V.visible, mix: V.mix, rate: V.rate, zoom: V.zoom, layout: V.layout, notes: V.notes, sound: V.sound || {} })
  }

  variantOpts() {
    const N = this.V.notes
    return { visible: this.V.visible.slice(), names: N.names, octave: N.octave, above: N.above, hideManual: N.names !== 'off' && N.hideManual }
  }

  async renderVariant(first) {
    const V = this.V; if (!V) return
    const tok = ++V.tok
    const opts = this.variantOpts()
    this.busy(first ? 'Mise en page de la partition…' : 'Mise à jour de la partition…')
    let sc, npages, pos
    try {
      const bytes = V.mf.build(opts)
      const W = await engine()
      sc = await W.load('mscz', bytes, [], true)
      if (tok !== V.tok || this.V !== V) { sc.destroy(); return }
      npages = await sc.npages()
      pos = await sc.measurePositions()
      if (!V.midiReady) {
        const midiBytes = await sc.saveMidi(true, true)
        V.midi = parseMidi(midiBytes); this.setupPlayer(V.midi)
        V.midiReady = true
        setTimeout(() => { if (this.V === V) this.ensureSounds(true) }, 50)   // préchargement des instruments
      }
    } catch (e) {
      console.error(e)
      this.busy(''); this.toast('Erreur de rendu MuseScore : ' + (e.message || e), 5000)
      return
    }
    if (tok !== V.tok || this.V !== V) { sc.destroy(); return }
    const scroller = this.scroller
    const ratio = scroller.scrollHeight > scroller.clientHeight ? scroller.scrollTop / scroller.scrollHeight : 0
    if (V.score) { try { V.score.destroy() } catch { } }
    for (const u of V.svg.values()) URL.revokeObjectURL(u)
    V.svg = new Map()
    V.score = sc; V.key = variantKey(opts); V.npages = npages
    V.renderedVisible = opts.visible.slice()
    V.pos = pos
    V.events = pos.events.slice().sort((a, b) => a.position - b.position)
    V.elements = new Map(pos.elements.map(e => [e.id, e]))
    V.PW = pos.pageSize.width; V.PH = pos.pageSize.height
    V.lastMeasure = -1
    this.buildPages()
    scroller.scrollTop = ratio * scroller.scrollHeight
    this.busy('')
    this.drawLoopMarks()
    this.updateCursor(true)
    requestAnimationFrame(() => this.kickVisible())
  }

  // pages / lignes visibles : rendu tout de suite (filet de sécurité de l'observateur)
  kickVisible() {
    const V = this.V
    if (!V || !V.score || !this.visibleNow) return
    const r = this.scroller.getBoundingClientRect(), mx = r.width, my = r.height
    const els = V.tiles ? V.tiles.map(t => t.wrap) : V.pageEls
    ;(els || []).forEach((el, k) => {
      if (!el) return
      const b = el.getBoundingClientRect()
      if (b.right > r.left - mx && b.left < r.right + mx && b.bottom > r.top - my && b.top < r.bottom + my) {
        const i = V.tiles ? V.tiles[k].page : k
        if (!V.svg.has(i)) this.requestPage(i); else { const img = (V.tiles ? V.tiles[k].el : el).querySelector('img'); if (img && !img.getAttribute('src')) this.setImg(i) }
      }
    })
  }

  // ---------------------------------------------------------------- pages
  buildPages() {
    const V = this.V
    this.pageObserver.disconnect()
    this.renderQ.length = 0
    this.pagesEl.innerHTML = ''
    const els = []
    V.tiles = V.layout === 'line' ? this.computeTiles() : null
    if (V.tiles) {
      // ligne continue : une tuile par système (fenêtre sur la page entière), alignées de gauche à droite
      V.pageEls = []; V.pageTiles = []
      V.tiles.forEach((t, k) => {
        const w = document.createElement('div'); w.className = 'tile'
        const d = document.createElement('div')
        d.className = 'page'; d.dataset.i = t.page; d.dataset.tile = k
        w.dataset.i = t.page; w.dataset.tile = k
        d.innerHTML = `<div class="loading">…</div><img alt=""><span class="pnum">${k + 1} / ${V.tiles.length}</span>`
        w.appendChild(d); this.pagesEl.appendChild(w); els.push(d); t.el = d; t.wrap = w
        if (!V.pageEls[t.page]) V.pageEls[t.page] = d
        ;(V.pageTiles[t.page] = V.pageTiles[t.page] || []).push(d)
        this.pageObserver.observe(w)
      })
      this.sizeTiles()
    } else {
      for (let i = 0; i < V.npages; i++) {
        const d = document.createElement('div')
        d.className = 'page'; d.dataset.i = i
        d.style.aspectRatio = `${V.PW} / ${V.PH}`
        d.innerHTML = `<div class="loading">Page ${i + 1}…</div><img alt=""><span class="pnum">${i + 1} / ${V.npages}</span>`
        this.pagesEl.appendChild(d); els.push(d)
        this.pageObserver.observe(d)
      }
      V.pageEls = els; V.pageTiles = null
    }
    V.cursorEl = document.createElement('div'); V.cursorEl.className = 'cursor'; V.cursorEl.innerHTML = '<i></i>'
    this.ink.attach(els, this.toView(V.ink[V.key] || null, true), null, V.tiles ? V.tiles.map(t => ({ y0: t.y0, y1: t.y1 })) : undefined)
    this._applyLayers()
    this.ink.setEnabled(this.inkOn)
  }

  // systèmes de la partition -> tuiles { page, y0, y1 (fenêtre visible), o0, o1 (zone « propriétaire » des annotations) }
  computeTiles() {
    const V = this.V
    const sys = []
    for (const e of [...V.elements.values()].sort((a, b) => a.page - b.page || a.y - b.y)) {
      let s = sys.find(q => q.page === e.page && Math.abs(q.y - e.y) < 3)
      if (!s) sys.push(s = { page: e.page, y: e.y, y2: e.y + e.sy })
      else { s.y = Math.min(s.y, e.y); s.y2 = Math.max(s.y2, e.y + e.sy) }
    }
    sys.sort((a, b) => a.page - b.page || a.y - b.y)
    if (!sys.length) return null
    const padT = 0.05 * V.PH, padB = 0.045 * V.PH
    const tiles = sys.map((q, k) => {
      const prev = sys[k - 1], next = sys[k + 1]
      const o0 = prev && prev.page === q.page ? (prev.y2 + q.y) / 2 : 0
      const o1 = next && next.page === q.page ? (q.y2 + next.y) / 2 : V.PH
      return { page: q.page, y0: Math.max(o0, q.y - padT) / V.PH, y1: Math.min(o1, q.y2 + padB) / V.PH, o0: o0 / V.PH, o1: o1 / V.PH }
    })
    // la fenêtre de chaque ligne s'agrandit pour montrer les annotations qui lui appartiennent (les miennes et celles des amis)
    const srcs = [V.ink[V.key] || [], ...this.layers.map(L => this._layerPages(L.data) || [])]
    for (const src of srcs) (src || []).forEach((pg, p) => {
      for (const o of pg || []) {
        const ys = o.t === 'text' ? [o.y - 0.03, o.y + 0.01] : (o.p || []).map(q => q[1])
        if (!ys.length) continue
        const y = objY(o), lo = Math.min(...ys) - 0.006, hi = Math.max(...ys) + 0.006
        const t = tiles.find(t => t.page === p && y >= t.o0 && y < t.o1); if (!t) continue
        t.y0 = Math.max(t.o0, Math.min(t.y0, lo)); t.y1 = Math.min(t.o1, Math.max(t.y1, hi))
      }
    })
    return tiles
  }
  sizeTiles() {
    const V = this.V
    if (!V || !V.tiles) return
    const th = Math.max(120, (this.scroller.clientHeight - 28) * V.zoom)
    const maxCrop = Math.max(...V.tiles.map(t => t.y1 - t.y0))
    const pageH = th / maxCrop, pageW = pageH * V.PW / V.PH
    for (const t of V.tiles) {
      Object.assign(t.wrap.style, { width: pageW + 'px', height: (t.y1 - t.y0) * pageH + 'px' })
      Object.assign(t.el.style, { width: pageW + 'px', height: pageH + 'px', top: -t.y0 * pageH + 'px' })
    }
  }
  // annotations par page <-> par tuile (ligne continue)
  toView(data, own) {
    const V = this.V
    if (!V || !V.tiles || !data) return data
    return V.tiles.map(t => {
      const pg = data[t.page] || []
      return own ? pg.filter(o => { const y = objY(o); return y >= t.o0 && y < t.o1 }) : pg
    })
  }
  serializeInk() {
    const V = this.V
    const arr = this.ink.serialize()
    if (!V.tiles) return arr
    const out = Array.from({ length: V.npages }, () => [])
    arr.forEach((list, k) => { const t = V.tiles[k]; if (t) out[t.page].push(...list) })
    return out
  }
  // une annotation a changé : on met à jour la vue courante et on prévient l'appli (qui enregistre)
  _inkChanged() {
    const V = this.V
    if (!V || !V.key) return
    const pages = this.serializeInk()
    if (pages.some(p => p && p.length)) V.ink[V.key] = pages
    else delete V.ink[V.key]
    this.onInkChange(V.ink)
  }
  pageElFor(el) {
    const V = this.V
    if (!V.pageTiles) return V.pageEls[el.page]
    const y = (el.y + el.sy / 2) / V.PH
    const ts = V.tiles.filter(t => t.page === el.page)
    const t = ts.find(t => y >= t.o0 && y < t.o1) || ts[0]
    return t && t.el
  }
  relayoutPages() {
    const V = this.V
    if (!V || !V.score) return
    const pages = this.serializeInk()
    if (pages.some(p => p.length)) V.ink[V.key] = pages
    this.buildPages()
    for (const i of V.svg.keys()) this.setImg(i)
    this.drawLoopMarks(); this.updateCursor(true)
  }
  requestPage(i) {
    const V = this.V
    if (!V || !V.score) return
    if (V.svg.has(i)) return this.setImg(i)
    if (!this.renderQ.includes(i)) this.renderQ.push(i)
    this.pumpRender()
  }
  async pumpRender() {
    if (this.rendering) return
    this.rendering = true
    while (this.renderQ.length) {
      const V = this.V; if (!V) break
      const cur = this.visiblePage()
      this.renderQ.sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur))
      const i = this.renderQ.shift()
      const key = V.key, sc = V.score
      if (!sc) continue
      this.renderBar(true, 'Chargement de la page ' + (i + 1) + ' / ' + V.npages + '…')
      try {
        const svg = await sc.saveSvg(i, true)
        if (this.V !== V || V.key !== key || V.score !== sc) continue
        V.svg.set(i, URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })))
        this.setImg(i)
      } catch (e) { console.warn('page', i, e) }
    }
    this.rendering = false
    this.renderBar(false)
  }
  renderBar(on, txt) {
    const b = this.$('#vRenderBar'); if (!b) return
    b.hidden = !on; if (txt) b.querySelector('span').textContent = txt
  }
  setImg(i) {
    const V = this.V
    const list = V.pageTiles ? (V.pageTiles[i] || []) : [V.pageEls[i]]
    const url = V.svg.get(i)
    for (const el of list) {
      if (!el) continue
      const img = el.querySelector('img')
      if (img.src !== url) {
        img.onload = () => { const l = el.querySelector('.loading'); if (l) l.remove() }
        img.src = url
      }
    }
  }
  visibleInkPage() {
    const V = this.V
    if (!V || !V.tiles) return this.visiblePage()
    const r = this.scroller.getBoundingClientRect(), midx = r.left + r.width / 2
    let best = 0, bd = 1e9
    V.tiles.forEach((t, k) => { const b = t.wrap.getBoundingClientRect(); const d = midx < b.left ? b.left - midx : midx > b.right ? midx - b.right : 0; if (d < bd) { bd = d; best = k } })
    return best
  }
  visiblePage() {
    const V = this.V
    if (!V || !V.pageEls) return 0
    const r = this.scroller.getBoundingClientRect()
    const mid = r.top + r.height / 2, midx = r.left + r.width / 2
    let best = 0, bd = 1e9
    V.pageEls.forEach((el, i) => {
      if (!el) return
      const b = el.getBoundingClientRect()
      const d = (mid < b.top ? b.top - mid : mid > b.bottom ? mid - b.bottom : 0) + (midx < b.left ? b.left - midx : midx > b.right ? midx - b.right : 0)
      if (d < bd) { bd = d; best = i }
    })
    return best
  }

  // ---------------------------------------------------------------- zoom / disposition
  applyZoom() {
    this.pagesEl.style.setProperty('--zoom', this.V.zoom)
    this.sizeTiles()
    requestAnimationFrame(() => this.ink.resize())
  }
  setZoom(z, keepCenter = true) {
    const V = this.V; if (!V) return
    const scroller = this.scroller
    z = Math.max(0.4, Math.min(3.5, z))
    const cy = (scroller.scrollTop + scroller.clientHeight / 2) / Math.max(1, scroller.scrollHeight)
    const cx = (scroller.scrollLeft + scroller.clientWidth / 2) / Math.max(1, scroller.scrollWidth)
    V.zoom = z; this.applyZoom()
    if (keepCenter) {
      scroller.scrollTop = cy * scroller.scrollHeight - scroller.clientHeight / 2
      scroller.scrollLeft = cx * scroller.scrollWidth - scroller.clientWidth / 2
    }
    this.savePrefs()
  }
  setVh() { this.pagesEl.style.setProperty('--vh', this.scroller.clientHeight + 'px') }
  applyLayout() {
    const V = this.V
    this.setVh()
    this.pagesEl.classList.toggle('two', V.layout === 'two')
    this.pagesEl.classList.toggle('horiz', V.layout === 'horizontal')
    this.pagesEl.classList.toggle('line', V.layout === 'line')
    this.scroller.classList.toggle('horiz', isHoriz(V.layout))
    this.$('#vLayoutBtn use').setAttribute('href', LAYOUT_ICON[V.layout] || '#i-1up')
    this.$$('#vLayoutPop [data-l]').forEach(b => b.classList.toggle('on', b.dataset.l === V.layout))
    requestAnimationFrame(() => this.ink.resize())
  }
  setLayout(l) {
    const V = this.V
    if (!V || l === V.layout) return
    const pg = this.visiblePage()
    const rebuild = l === 'line' || V.layout === 'line'
    V.layout = l; this.G.layout = l; this.saveG(); this.applyLayout(); this.savePrefs()
    if (rebuild) this.relayoutPages()
    requestAnimationFrame(() => {
      const el = V.pageEls && V.pageEls[pg]; if (!el) return
      if (isHoriz(l)) { this.scroller.scrollTop = 0; this.scroller.scrollLeft = (l === 'line' ? el.parentElement.offsetLeft : el.offsetLeft) - 14 }
      else { this.scroller.scrollLeft = 0; this.scroller.scrollTop = el.offsetTop - 14 }
      this.kickVisible()
    })
  }

  // ---------------------------------------------------------------- lecture
  makeTrackToPart(mf, midi) {
    const staffPart = []
    mf.parts.forEach(p => p.staves.forEach(() => staffPart.push(p.index)))
    const byName = new Map(mf.parts.map(p => [p.name.toLowerCase(), p.index]))
    const nTracks = midi.tracks.length
    return (ti, tr) => {
      if (nTracks === staffPart.length) return staffPart[ti]
      const n = (tr.name || '').toLowerCase()
      if (byName.has(n)) return byName.get(n)
      return staffPart[Math.min(ti, staffPart.length - 1)] ?? 0
    }
  }
  // son de chaque partie / portée (main droite, main gauche…) : « s<portée> » prime sur « p<partie> »
  makeProgFor(mf, midi) {
    const staffOf = []; mf.parts.forEach(p => p.staves.forEach(() => staffOf.push(staffOf.length)))
    const perStaff = midi.tracks.length === staffOf.length
    const snd = this.V.sound || {}
    return (ti, part, orig) => {
      const k = perStaff ? snd['s' + ti] : undefined
      const v = k != null && k !== '' ? k : snd['p' + part]
      return v != null && v !== '' ? +v : orig
    }
  }
  async changeSound(key, val) {
    const V = this.V, player = this.player
    V.sound = V.sound || {}
    if (val === '' || val == null) delete V.sound[key]; else V.sound[key] = +val
    this.savePrefs()
    const wasPlaying = player.playing, pos = player.position
    if (wasPlaying) { player.pause(); this.setPlayIcon(false) }
    this.setupPlayer(V.midi)
    if (pos) try { player.seek(pos) } catch { }
    this.toast('🎼 Son changé', 1500)
    await this.ensureSounds(true)
  }
  soundSelect(key) {
    const V = this.V
    const sel = document.createElement('select'); sel.className = 'sndsel'; sel.title = 'Son à la lecture'
    sel.innerHTML = '<optgroup label="Courants">' + SOUNDS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('') + '</optgroup>'
      + '<optgroup label="Tous les instruments">' + GM.map((g, i) => `<option value="${i}">${i + 1}. ${g.replace(/_/g, ' ').replace(/\b\w/, c => c.toUpperCase())}</option>`).join('') + '</optgroup>'
    sel.value = V.sound && V.sound[key] != null ? String(V.sound[key]) : ''
    sel.onchange = () => this.changeSound(key, sel.value)
    return sel
  }
  setupPlayer(midi) {
    const V = this.V, mf = V.mf
    this.player.setScore(midi, mf.parts.length, this.makeTrackToPart(mf, midi), V.mix, this.makeProgFor(mf, midi))
    this.player.setRate(V.rate)
    this.$('#vDur').textContent = fmt(this.player.duration)
    V.soundsReady = null
  }
  async ensureSounds(background) {
    const V = this.V
    if (!V.soundsReady) {
      V.soundsLoading = true
      V.soundsReady = this.player.loadInstruments((d, n) => { V.soundsProgress = n ? `${d}/${n}` : '' }).then(failed => {
        V.soundsLoading = false
        if (failed) this.toast('Hors-ligne : certains instruments utilisent un son de synthèse', 4000)
      })
    }
    if (!background && V.soundsLoading) {
      const t = setInterval(() => { if (V.soundsLoading) this.busy('Chargement des instruments… ' + (V.soundsProgress || '')) }, 300)
      await V.soundsReady
      clearInterval(t); this.busy('')
    }
    return V.soundsReady
  }
  setPlayIcon(on) { this.$('#vPlay use').setAttribute('href', on ? '#i-pause' : '#i-play') }

  // lecture / pause ; renvoie true si ça joue
  async togglePlay() {
    const V = this.V, player = this.player
    if (!V || !V.midiReady) return false
    if (player.playing) { player.pause(); this.setPlayIcon(false); return false }
    { const c = player.ensureCtx(); if (c.state !== 'running') c.resume() }   // iPad/iPhone : tout de suite dans le geste
    await this.ensureSounds()
    if (this.V !== V) return false
    await player.play()
    this.setPlayIcon(true)
    if (V.loop) { const p = player.position; if (p < V.loop.a - 0.05 || p > V.loop.b) player.seek(V.loop.a) }
    this.updateCursor(true)
    if (V.loop && player.position <= V.loop.a + 0.3) this.frameLoop(true)
    else if (this.G.follow) this.scrollToCursor(true, true)
    this._loop()
    return true
  }
  stop() { this.player.stop(); this.setPlayIcon(false) }
  _loop() {
    this.updateCursor(false)
    if (this.player.playing) requestAnimationFrame(() => this._loop())
  }
  eventIndexAt(ms) {
    const ev = this.V.events; let lo = 0, hi = ev.length - 1
    if (!ev.length) return -1
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ev[m].position <= ms) lo = m; else hi = m - 1 }
    return lo
  }
  updateCursor(force) {
    const V = this.V, player = this.player
    if (!V || !V.events) return
    const t = player.position
    this.$('#vCur').textContent = fmt(t)
    if (!this.seekDragging) this.$('#vSeek').value = player.duration ? Math.round(t / player.duration * 1000) : 0
    const idx = this.eventIndexAt(t * 1000)
    if (idx < 0) return
    const ev = V.events[idx]
    const el = V.elements.get(ev.elid)
    if (!el) return
    const next = V.events[idx + 1]
    const end = next ? next.position : player.duration * 1000
    const frac = Math.max(0, Math.min(1, (t * 1000 - ev.position) / Math.max(1, end - ev.position)))
    const c = V.cursorEl
    const pageEl = this.pageElFor(el)
    if (!pageEl) return
    if (c.parentElement !== pageEl) pageEl.appendChild(c)
    c.style.display = (player.playing || t > 0) ? 'block' : 'none'
    c.style.left = (el.x / V.PW * 100) + '%'
    c.style.top = (el.y / V.PH * 100) + '%'
    c.style.width = (el.sx / V.PW * 100) + '%'
    c.style.height = (el.sy / V.PH * 100) + '%'
    c.firstChild.style.left = (frac * 100) + '%'
    if (idx !== V.lastMeasure || force) {
      const wrapped = V.loop && V.lastMeasure != null && idx < V.lastMeasure && idx <= V.loop.ia + 1
      V.lastMeasure = idx
      if (player.playing && wrapped) this.frameLoop(true)          // la boucle repart : on revient au début du passage
      else if (player.playing && this.G.follow) this.scrollToCursor(false)
    }
  }
  scrollToCursor(forceNow, instant) {
    const V = this.V; if (!V) return
    const c = V.cursorEl, ink = this.ink
    if (!c || !c.parentElement || c.style.display === 'none') return
    if (!forceNow && performance.now() - this.userScrollAt < 2500) return
    // on ne fait pas défiler la page sous le stylet pendant qu'on écrit
    if (!forceNow && (ink.current || ink.sel || performance.now() - ink.lastActivity < 2500)) return
    this.frameRect(c.getBoundingClientRect(), instant)
  }
  // amène un rectangle (mesure, boucle…) dans la zone visible, quel que soit le zoom
  frameRect(cr, instant) {
    const scroller = this.scroller
    const sr = scroller.getBoundingClientRect()
    const top = cr.top - sr.top, bottom = cr.bottom - sr.top
    let dy = 0
    if (cr.height > sr.height * 0.8) dy = top - sr.height * 0.05
    else if (top < sr.height * 0.08 || bottom > sr.height * 0.88) dy = top - sr.height * 0.22
    let dx = 0
    const left = cr.left - sr.left, right = cr.right - sr.left
    if (scroller.scrollWidth > scroller.clientWidth + 4 && (left < 20 || right > sr.width - 10)) dx = cr.width > sr.width * 0.8 ? left - 20 : left - sr.width * 0.1
    if (dy || dx) scroller.scrollBy({ top: dy, left: dx, behavior: instant ? 'auto' : 'smooth' })
  }
  // boucle : cadrer tout le passage (ou au moins son début s'il est plus grand que l'écran)
  frameLoop(instant) {
    const scroller = this.scroller
    const ms = this.$$('.loopmark'); if (!ms.length) return
    const rs = ms.map(m => m.getBoundingClientRect())
    const u = { top: Math.min(...rs.map(r => r.top)), left: Math.min(...rs.map(r => r.left)), bottom: Math.max(...rs.map(r => r.bottom)), right: Math.max(...rs.map(r => r.right)) }
    u.width = u.right - u.left; u.height = u.bottom - u.top
    const sr = scroller.getBoundingClientRect()
    const r0 = rs[0]
    const fits = u.height <= sr.height * 0.8 && u.width <= sr.width - 20
    const tgt = fits ? u : { top: r0.top, bottom: r0.bottom, left: r0.left, right: r0.right, width: r0.width, height: r0.height }
    const sy = tgt.top - sr.top - sr.height * (fits ? Math.max(0.05, (0.9 - tgt.height / sr.height) / 2) : 0.15)
    let sx = 0
    if (scroller.scrollWidth > scroller.clientWidth + 4) {
      const left = tgt.left - sr.left
      if (left < 20 || tgt.right - sr.left > sr.width - 10) sx = left - 20
    }
    scroller.scrollBy({ top: sy, left: sx, behavior: instant ? 'auto' : 'smooth' })
  }

  // ---------------------------------------------------------------- boucle A–B
  drawLoopMarks(ia, ib) {
    const V = this.V
    this.$$('.loopmark').forEach(m => m.remove())
    if (!V || !V.events) return
    if (ia == null) { if (!V.loop) return; ia = V.loop.ia; ib = V.loop.ib }
    const seen = new Set()
    for (let k = ia; k <= ib; k++) {
      const el = V.elements.get(V.events[k].elid)
      if (!el || seen.has(el.id)) continue; seen.add(el.id)
      const m = document.createElement('div'); m.className = 'loopmark'
      Object.assign(m.style, { left: el.x / V.PW * 100 + '%', top: el.y / V.PH * 100 + '%', width: el.sx / V.PW * 100 + '%', height: el.sy / V.PH * 100 + '%' })
      const pe = this.pageElFor(el); pe && pe.appendChild(m)
    }
  }
  // 1) bouton boucle  2) toucher la mesure de début  3) la mesure de fin (re-toucher pour ajuster)  4) « Boucler »
  paintLoopBar() {
    const V = this.V, P = V && V.loopPick, bar = this.$('#vLoopBar')
    bar.hidden = !P
    if (!P) return
    const n = k => 'mesure ' + (k + 1)
    this.$('#vLoopMsg').textContent = P.a == null ? 'Touche la mesure de début'
      : P.b == null ? `Début : ${n(P.a)} · touche la mesure de fin`
        : `De ${n(P.a)} à ${n(P.b)} · touche pour ajuster`
    this.$('#vLoopGo').disabled = P.a == null
    this.$('#vLoopCancel').textContent = V.loop ? 'Arrêter la boucle' : 'Annuler'
  }
  pickLoop(k) {
    const P = this.V.loopPick
    if (P.a == null) P.a = k
    else if (P.b == null) { if (k < P.a) { P.b = P.a; P.a = k } else P.b = k }
    else if (k < P.a) P.a = k
    else if (k > P.b) P.b = k
    else if (k - P.a < P.b - k) P.a = k
    else P.b = k
    this.drawLoopMarks(P.a, P.b == null ? P.a : P.b)
    this.paintLoopBar()
  }
  startLoopPick() {
    const V = this.V
    V.loopPick = { a: null, b: null }
    if (V.loop) { V.loopPick.a = V.loop.ia; V.loopPick.b = V.loop.ib }
    this.$('#vLoopBtn').classList.add('on')
    if (this.inkOn) this.setInk(false)
    this.paintLoopBar()
  }
  cancelLoopPick() {
    const V = this.V
    V.loopPick = null; this.paintLoopBar()
    this.$('#vLoopBtn').classList.toggle('on', !!V.loop)
    this.drawLoopMarks()
  }
  clearLoop() {
    const V = this.V
    V.loop = null; V.loopPick = null; this.player.setLoop(null); this.paintLoopBar()
    this.$('#vLoopBtn').classList.remove('on'); this.drawLoopMarks()
  }

  // ---------------------------------------------------------------- vitesse / volume
  updateSpeedUI() {
    const v = Math.round(this.player.rate * 100)
    this.$('#vSpeedLbl').textContent = v + ' %'; this.$('#vSpeedVal').textContent = v + ' %'; this.$('#vSpeed').value = v
    this.$$('#vSpeedPop [data-s]').forEach(b => b.classList.toggle('on', +b.dataset.s === v))
  }
  setRate(v) { this.player.setRate(v / 100); if (this.V) this.V.rate = v / 100; this.updateSpeedUI(); this.savePrefs() }
  paintVol() {
    const v = Math.round((this.G.vol || 1) * 100)
    this.$('#vMasterVol').value = v
    this.$('#vMasterVolLbl').textContent = v + ' %'
    this.$('#vMasterVolLbl').classList.toggle('hot', v > 100)
    this.$('#vMasterWarn').hidden = v <= 100
  }

  // ---------------------------------------------------------------- pistes
  buildTrackList() {
    const V = this.V, player = this.player
    const list = this.$('#vTrackList'); list.innerHTML = ''
    V.mf.parts.forEach((p, i) => {
      const m = V.mix[i]
      const row = document.createElement('div')
      row.className = 'track'
      row.innerHTML = `
        <label class="show"><input type="checkbox"><span class="nm"></span></label>
        <button class="btn icon mute" title="Son"><svg class="ic"><use href="#i-vol"/></svg></button>
        <button class="btn icon solo" title="Solo">S</button>
        <div class="vol"><input type="range" min="0" max="100" step="1"></div>`
      row.querySelector('.nm').textContent = p.name
      const cb = row.querySelector('.show input'), mute = row.querySelector('.mute'), solo = row.querySelector('.solo'), vol = row.querySelector('.vol input')
      const paint = () => {
        cb.checked = !!V.visible[i]
        row.classList.toggle('hiddenpart', !V.visible[i])
        mute.classList.toggle('off', m.muted); mute.querySelector('use').setAttribute('href', m.muted ? '#i-mute' : '#i-vol')
        solo.classList.toggle('on', m.solo)
        vol.value = Math.round(m.volume * 100)
      }
      cb.onchange = () => { V.visible[i] = cb.checked; paint(); this.visibilityChanged() }
      mute.onclick = () => { m.muted = !m.muted; player.setPart(i, { muted: m.muted }); paint(); this.savePrefs() }
      solo.onclick = () => { m.solo = !m.solo; player.setPart(i, { solo: m.solo }); paint(); this.savePrefs() }
      vol.oninput = () => { m.volume = vol.value / 100; player.setPart(i, { volume: m.volume }); if (m.muted && m.volume > 0) { m.muted = false; player.setPart(i, { muted: false }) } paint(); this.savePrefs() }
      paint()
      list.appendChild(row)
      // son à la lecture : toute la partie, ou chaque portée (ex. piano : main droite au violon, main gauche au piano)
      const first = V.mf.parts.slice(0, i).reduce((n, q) => n + q.staves.length, 0)
      const snd = document.createElement('div'); snd.className = 'trsnd'
      if (p.staves.length > 1 && V.midi && V.midi.tracks.length === V.mf.parts.reduce((n, q) => n + q.staves.length, 0)) {
        p.staves.forEach((_, k) => {
          const lab = document.createElement('label')
          lab.textContent = p.staves.length === 2 ? (k === 0 ? '🫱 Main droite' : '🫲 Main gauche') : 'Portée ' + (k + 1)
          lab.appendChild(this.soundSelect('s' + (first + k))); snd.appendChild(lab)
        })
      } else { const lab = document.createElement('label'); lab.textContent = '🔈 Son'; lab.appendChild(this.soundSelect('p' + i)); snd.appendChild(lab) }
      list.appendChild(snd)
    })
    this.$('#vNoneWarn').hidden = V.visible.some(Boolean)
  }
  // les cases cochées s'appliquent à la partition quand on ferme le panneau (croix)
  visibilityChanged() {
    const V = this.V
    const any = V.visible.some(Boolean)
    this.$('#vNoneWarn').hidden = any
    this.$('#vApplyHint').hidden = !any || JSON.stringify(V.visible) === JSON.stringify(V.renderedVisible)
  }
  openTracks() { this.closePops(); this.paintVol(); this.$('#vTracks').classList.add('open'); this.$('#vTracksBtn').classList.add('on') }
  closeTracks() {
    const V = this.V
    this.$('#vTracks').classList.remove('open'); this.$('#vTracksBtn').classList.remove('on')
    if (!V) return
    if (!V.visible.some(Boolean) && V.renderedVisible) { V.visible = V.renderedVisible.slice(); this.buildTrackList(); return }
    if (JSON.stringify(V.visible) !== JSON.stringify(V.renderedVisible)) { this.savePrefs(); this.renderVariant(false) }
    this.$('#vApplyHint').hidden = true
  }
  setAllMix(fn) {
    const V = this.V
    V.mix.forEach((m, i) => { fn(m, i); this.player.setPart(i, { muted: m.muted, solo: m.solo }) })
    this.buildTrackList(); this.savePrefs()
  }

  // ---------------------------------------------------------------- noms de notes
  updateNamesUI() {
    const V = this.V, N = V ? V.notes : { names: 'off' }
    this.$$('#vNamesSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === N.names))
    this.$('#vNamesLbl').textContent = N.names === 'letter' ? 'A B C' : N.names === 'solfege' ? 'Do Ré Mi' : 'Notes'
    this.$('#vNamesBtn').classList.toggle('on', N.names !== 'off')
    this.$('#vOptOctave').checked = !!N.octave; this.$('#vOptAbove').checked = !!N.above; this.$('#vOptHideManual').checked = N.hideManual !== false
    this.$('#vRowManual').hidden = !(V && V.mf.hasManualNames)
    for (const s of ['#vOptOctave', '#vOptAbove', '#vOptHideManual']) { this.$(s).disabled = N.names === 'off'; this.$(s).parentElement.style.opacity = N.names === 'off' ? .45 : 1 }
  }

  // ---------------------------------------------------------------- popovers
  togglePop(sel, anchor, dir) {
    const pop = this.$(sel)
    const wasOpen = !pop.hidden
    this.closePops()
    if (wasOpen) return
    pop.hidden = false
    const r = anchor.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight
    const left = Math.min(innerWidth - pw - 8, Math.max(8, r.left + r.width / 2 - pw / 2))
    pop.style.left = left + 'px'
    pop.style.top = Math.max(8, dir === 'up' ? r.top - ph - 8 : r.bottom + 8) + 'px'
    anchor.classList.add('popopen')
  }
  closePops() {
    this.$$(':scope > .pop').forEach(p => p.hidden = true)
    this.$$('.popopen').forEach(b => b.classList.remove('popopen'))
  }

  // ---------------------------------------------------------------- annotations
  setInk(on) {
    this.inkOn = on
    this.ink.setEnabled(on)
    this.$('#vInkbar').hidden = !on
    this.$$('#vModeSeg button').forEach(b => b.classList.toggle('on', b.dataset.m === (on ? 'pen' : 'hand')))
    if (on && this.V && this.V.loopPick) this.cancelLoopPick()
    if (!on) { this.closePops(); this.ink.deselect && this.ink.deselect() }
  }
  renderSwatches() {
    const G = this.G, ink = this.ink
    const box = this.$('#vSwatches'); box.innerHTML = ''
    box.classList.toggle('editing', !!this.editingColors)
    for (const c of G.palette) {
      const b = document.createElement('button')
      b.className = 'swatch'; b.style.setProperty('--c', c); b.dataset.color = c; b.title = c === this.memberColor ? 'Ma couleur' : c
      b.onclick = () => {
        if (this.editingColors) {
          if (G.palette.length <= 1) { this.toast('Garde au moins une couleur'); return }
          G.palette = G.palette.filter(x => x !== c)
          if (G.color === c) { G.color = ink.color = G.palette[0] }
          this.saveG(); this.renderSwatches(); this.paintInkbar(); return
        }
        ink.color = G.color = c
        if (ink.setSelectedColor(c)) { this.saveG(); this.paintInkbar(); return }
        if (ink.tool === 'eraser' || ink.tool === 'hl') { ink.setTool('pen'); G.tool = 'pen' }
        this.saveG(); this.paintInkbar()
      }
      box.appendChild(b)
    }
  }
  paintInkbar() {
    const ink = this.ink
    this.$('#vToolIcon').setAttribute('href', TOOL_ICON[ink.tool] || '#i-pen')
    const emo = ink.tool === 'emoji', shp = ink.tool === 'shape'
    this.$('#vToolSvg').style.display = emo || shp ? 'none' : ''
    this.$('#vToolEmo').hidden = !emo && !shp
    if (emo) this.$('#vToolEmo').textContent = ink.emoji || ''
    if (shp) { const sb = this.$(`#vShapeRow [data-shape="${ink.shape}"] svg`); this.$('#vToolEmo').innerHTML = sb ? sb.outerHTML : '' }
    this.$$('#vShapeRow [data-shape]').forEach(b => b.classList.toggle('on', shp && b.dataset.shape === ink.shape))
    this.$('#vToolPop [data-tool=emoji] .emo').textContent = ink.emoji || '〰️'
    const dot = this.$('#vToolDot')
    dot.style.display = ink.tool === 'eraser' || emo ? 'none' : ''
    dot.style.setProperty('--s', (3 + ink.size * 2) + 'px')
    dot.style.setProperty('--c', ink.tool === 'hl' ? '#ffd400' : ink.color)
    this.$$('#vToolPop [data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === ink.tool))
    this.$$('#vToolPop [data-size]').forEach(b => b.classList.toggle('on', +b.dataset.size === ink.size))
    this.$('#vSizeRow').hidden = ink.tool === 'eraser' || ink.tool === 'hl'
    this.$$('#vInkbar .swatch').forEach(b => b.classList.toggle('on', b.dataset.color === ink.color && !this.editingColors && ink.tool !== 'eraser' && ink.tool !== 'hl'))
    this.$('#vOptFinger').checked = !!this.G.fingerScroll
    this.$('#vEditColorsLbl').textContent = this.editingColors ? 'Terminer' : 'Retirer des couleurs'
  }
  renderEmojis() {
    const G = this.G, ink = this.ink
    const box = this.$('#vEmojiGrid'); box.innerHTML = ''
    for (const it of G.emojis) {
      const b = document.createElement('button')
      b.innerHTML = '<b></b><small></small>'
      b.querySelector('b').textContent = it.e; b.querySelector('small').textContent = it.l || ''
      b.title = 'Appui long : retirer de la liste'
      b.classList.toggle('on', !this.emojiCb && it.e === ink.emoji && ink.tool === 'emoji')
      b.onclick = () => this.pickEmoji(it.e)
      longPress(b, () => {
        if (G.emojis.length <= 1) return
        G.emojis = G.emojis.filter(x => x !== it); this.saveG(); this.renderEmojis(); this.toast('Emoji retiré de la liste')
      })
      box.appendChild(b)
    }
  }
  openEmojiPop(cb) {
    this.emojiCb = cb
    this.renderEmojis()
    this.closePops()
    this.togglePop('#vEmojiPop', this.$('#vToolBtn'), 'down')
  }
  pickEmoji(e) {
    this.closePops()
    if (this.emojiCb) { const cb = this.emojiCb; this.emojiCb = null; cb(e); return }
    this.ink.emoji = this.G.emoji = e
    this.ink.setTool('emoji'); this.G.tool = 'emoji'; this.saveG(); this.paintInkbar()
    this.toast('Touche la partition pour poser ' + e + ' · touche un emoji posé pour le déplacer / agrandir', 3000)
  }
  promptText(title, init, cb, placeholder) {
    const dlg = this.$('#vTextDlg'), ta = this.$('#vTextIn')
    dlg.querySelector('h3').textContent = title
    ta.placeholder = placeholder || ''
    ta.rows = title === 'Texte' ? 3 : 1
    ta.value = init || ''
    dlg.hidden = false
    setTimeout(() => { ta.focus(); ta.select() }, 50)
    const done = v => { dlg.hidden = true; this.$('#vTextOk').onclick = this.$('#vTextCancel').onclick = null; ta.blur(); cb(v) }
    this.$('#vTextOk').onclick = () => done(ta.value)
    this.$('#vTextCancel').onclick = () => done(null)
  }

  // ---------------------------------------------------------------- accordeur
  openTuner() {
    if (this.player.playing) { this.player.pause(); this.setPlayIcon(false) }
    if (!this.tuner) this.tuner = new Tuner(this.$('#vTuner'), { get: () => this.G.tuner || {}, set: v => { this.G.tuner = v; this.saveG() } })
    this.$('#vTuner').hidden = false
    this.tuner.start()
  }
  closeTuner() {
    this.$('#vTuner').hidden = true
    if (this.tuner) this.tuner.stop()
  }

  // ---------------------------------------------------------------- fermeture
  close() {
    try { this.player.setLoop(null); this.player.stop() } catch { }
    this.setPlayIcon(false)
    const V = this.V
    if (V) {
      this.savePrefs()
      V.tok++
      if (V.score) { try { V.score.destroy() } catch { } V.score = null }
      for (const u of V.svg.values()) URL.revokeObjectURL(u)
    }
    this.V = null
    this.renderQ.length = 0
    this.pageObserver.disconnect()
    this.pagesEl.innerHTML = ''
    this.setInk(false)
    this.closePops(); this.$('#vTracks').classList.remove('open'); this.$('#vTracksBtn').classList.remove('on')
    this.$('#vLoopBar').hidden = true; this.$('#vLoopBtn').classList.remove('on')
    this.$('#vTextDlg').hidden = true
    this.closeTuner()
    this.renderBar(false)
    this.ink.attach([], [], null)
    this.ink.setLayers([])
  }

  // ---------------------------------------------------------------- branchements (une seule fois)
  _wire() {
    const $ = s => this.$(s), $$ = s => this.$$(s)
    const scroller = this.scroller, player = this.player, ink = this.ink, G = this.G

    // pages : rendu à l'approche de l'écran
    this.pageObserver = new IntersectionObserver(ents => {
      for (const e of ents) {
        if (e.isIntersecting) this.requestPage(+e.target.dataset.i)
        else if (this.V && this.V.tiles && e.target.dataset.tile != null) {   // ligne continue : on libère l'image des tuiles loin de l'écran
          const img = e.target.querySelector('img'); if (img && img.getAttribute('src')) img.removeAttribute('src')
        }
      }
    }, { root: scroller, rootMargin: '120% 120%' })
    setInterval(() => this.kickVisible(), 800)

    // zoom / mise en page
    $('#vZin').onclick = () => this.V && this.setZoom(this.V.zoom * 1.2)
    $('#vZout').onclick = () => this.V && this.setZoom(this.V.zoom / 1.2)
    $('#vLayoutBtn').onclick = e => { if (this.V) this.applyLayout(); this.togglePop('#vLayoutPop', e.currentTarget, 'down') }
    $$('#vLayoutPop [data-l]').forEach(b => b.onclick = () => { this.closePops(); this.setLayout(b.dataset.l) })
    // molette verticale -> défilement horizontal en mode « Horizontal » (PC)
    scroller.addEventListener('wheel', e => {
      const V = this.V
      if (!V || !isHoriz(V.layout) || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      if (scroller.scrollHeight <= scroller.clientHeight + 2) { e.preventDefault(); scroller.scrollLeft += e.deltaY }
    }, { passive: false })
    // pincer pour zoomer (2 doigts), même en mode stylo ; Ctrl + molette au PC
    let pinch = null
    scroller.addEventListener('touchstart', e => {
      if (e.touches.length === 2 && this.V) {
        const [a, b] = e.touches
        pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: this.V.zoom }
      }
    }, { passive: true })
    scroller.addEventListener('touchmove', e => {
      if (pinch && e.touches.length === 2) {
        e.preventDefault()
        const [a, b] = e.touches
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
        const z = pinch.z * d / pinch.d
        const mx = (a.clientX + b.clientX) / 2, my = (a.clientY + b.clientY) / 2
        if (!pinch.raf) pinch.raf = requestAnimationFrame(() => {
          if (!pinch) return
          pinch.raf = 0; this.setZoom(z)
          if (ink._pan) ink._pan = { x: mx, y: my, st: scroller.scrollTop, sl: scroller.scrollLeft }
        })
      }
    }, { passive: false })
    scroller.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null })
    scroller.addEventListener('wheel', e => { if (e.ctrlKey && this.V) { e.preventDefault(); this.setZoom(this.V.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)) } }, { passive: false })
    let resizeT; addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (this.V) { this.setVh(); this.sizeTiles() } ink.resize() }, 150) })

    // lecture
    $('#vPlay').onclick = () => this.togglePlay()
    player.onEnd = () => { this.setPlayIcon(false); this.updateCursor(true) }
    $('#vStart').onclick = () => {
      const V = this.V; if (!V) return
      player.seek(V.loop ? V.loop.a : 0); this.updateCursor(true)
      if (V.loop) this.frameLoop(false); else { this.scroller.scrollTo({ top: 0, left: 0, behavior: 'smooth' }) }
    }
    $('#vSeek').addEventListener('input', e => { if (!this.V) return; player.seek(e.target.value / 1000 * player.duration); this.updateCursor(true) })
    $('#vSeek').addEventListener('pointerdown', () => { this.seekDragging = true })
    addEventListener('pointerup', () => { this.seekDragging = false })
    for (const ev of ['wheel', 'touchstart', 'pointerdown']) scroller.addEventListener(ev, () => { this.userScrollAt = performance.now() }, { passive: true })
    $('#vFollow').onclick = () => { G.follow = !G.follow; this.saveG(); $('#vFollow').classList.toggle('on', G.follow); if (G.follow) this.scrollToCursor(true) }
    $('#vFollow').classList.toggle('on', G.follow !== false)

    // souris = main : cliquer-glisser fait défiler la partition (molette du milieu : même en mode stylo)
    let mpan = null
    scroller.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse' || !this.V) return
      if (!(e.button === 1 || (e.button === 0 && !this.inkOn))) return
      if (e.target.closest('button, input, .tsel, .pop')) return
      mpan = { x: e.clientX, y: e.clientY, st: scroller.scrollTop, sl: scroller.scrollLeft, moved: false, id: e.pointerId }
      e.preventDefault()
    })
    addEventListener('pointermove', e => {
      if (!mpan || e.pointerId !== mpan.id) return
      const dx = e.clientX - mpan.x, dy = e.clientY - mpan.y
      if (!mpan.moved && Math.hypot(dx, dy) < 5) return
      if (!mpan.moved) { mpan.moved = true; scroller.classList.add('grabbing') }
      scroller.scrollTop = mpan.st - dy; scroller.scrollLeft = mpan.sl - dx
      e.preventDefault()
    })
    addEventListener('pointerup', e => {
      if (!mpan || e.pointerId !== mpan.id) return
      if (mpan.moved) { const stop = ev => { ev.stopPropagation(); ev.preventDefault() }; addEventListener('click', stop, { capture: true, once: true }); setTimeout(() => removeEventListener('click', stop, { capture: true }), 50) }
      mpan = null; scroller.classList.remove('grabbing')
    })
    // toucher une mesure = aller à cette mesure (ou choisir la boucle)
    this.pagesEl.addEventListener('click', e => {
      const V = this.V
      if (this.inkOn || !V || !V.events) return
      const pageEl = e.target.closest('.page'); if (!pageEl) return
      const i = +pageEl.dataset.i
      const r = pageEl.getBoundingClientRect()
      const x = (e.clientX - r.left) / r.width * V.PW, y = (e.clientY - r.top) / r.height * V.PH
      let hit = null
      for (const el of V.elements.values()) {
        if (el.page === i && x >= el.x && x <= el.x + el.sx && y >= el.y - 10 && y <= el.y + el.sy + 10) { hit = el; break }
      }
      if (!hit) return
      const occ = V.events.map((ev, k) => ({ ev, k })).filter(o => o.ev.elid === hit.id)
      if (!occ.length) return
      const now = player.position * 1000
      occ.sort((a, b) => Math.abs(a.ev.position - now) - Math.abs(b.ev.position - now))
      const target = occ[0]
      if (V.loopPick) { this.pickLoop(target.k); return }
      player.seek(target.ev.position / 1000)
      this.updateCursor(true)
    })

    // boucle
    $('#vLoopGo').onclick = () => {
      const V = this.V, P = V && V.loopPick; if (!P || P.a == null) return
      const a = P.a, b = P.b == null ? P.a : P.b
      V.loopPick = null; this.paintLoopBar()
      const start = V.events[a].position / 1000
      const end = (V.events[b + 1] ? V.events[b + 1].position : player.duration * 1000) / 1000
      V.loop = { a: start, b: end, ia: a, ib: b }
      player.setLoop(start, end)
      player.seek(start)
      $('#vLoopBtn').classList.add('on')
      this.drawLoopMarks(); this.updateCursor(true)
      requestAnimationFrame(() => this.frameLoop(false))
      this.toast('Boucle activée · touche ⟲ pour la modifier ou l’arrêter')
    }
    $('#vLoopCancel').onclick = () => { const V = this.V; if (!V) return; if (V.loop && V.loopPick) { this.clearLoop(); this.toast('Boucle désactivée') } else this.cancelLoopPick() }
    $('#vLoopBtn').onclick = () => { const V = this.V; if (!V || !V.events) return; if (V.loopPick) this.cancelLoopPick(); else this.startLoopPick() }

    // vitesse
    $('#vSpeed').addEventListener('input', e => this.setRate(+e.target.value))
    $$('#vSpeedPop [data-s]').forEach(b => b.onclick = () => this.setRate(+b.dataset.s))
    $('#vSpeedBtn').onclick = e => this.togglePop('#vSpeedPop', e.currentTarget, 'up')

    // volume général (jusqu'à 300 %, avec avertissement)
    player.setBoost(G.vol || 1); this.paintVol()
    $('#vMasterVol').addEventListener('input', e => {
      let v = +e.target.value; if (Math.abs(v - 100) <= 5) v = 100   // un petit « cran » à 100 %
      G.vol = v / 100; player.setBoost(G.vol); this.paintVol()
    })
    $('#vMasterVol').addEventListener('change', () => this.saveG())

    // pistes
    $('#vAllShow').onclick = () => { const V = this.V; if (!V) return; V.visible = V.visible.map(() => true); this.buildTrackList(); this.visibilityChanged() }
    $('#vAllHide').onclick = () => { const V = this.V; if (!V) return; V.visible = V.visible.map(() => false); this.buildTrackList(); this.visibilityChanged() }
    $('#vAllSound').onclick = () => this.V && this.setAllMix(m => { m.muted = false; m.solo = false })
    $('#vAllMute').onclick = () => this.V && this.setAllMix(m => { m.muted = true; m.solo = false })
    $('#vSoundVisible').onclick = () => this.V && this.setAllMix((m, i) => { m.muted = !this.V.visible[i]; m.solo = false })
    $('#vTracksBtn').onclick = () => { if (!this.V) return; if ($('#vTracks').classList.contains('open')) this.closeTracks(); else this.openTracks() }
    $('#vTracks [data-close]').onclick = () => this.closeTracks()

    // noms des notes : réglage propre à chaque partition
    const rerenderSoon = debounce(() => { if (this.V && this.V.visible.some(Boolean)) this.renderVariant(false) }, 900)
    $$('#vNamesSeg button').forEach(b => b.onclick = () => {
      const V = this.V
      if (!V || V.notes.names === b.dataset.v) return
      V.notes.names = b.dataset.v; this.savePrefs(); this.updateNamesUI(); rerenderSoon()
    })
    for (const [id, k] of [['#vOptOctave', 'octave'], ['#vOptAbove', 'above'], ['#vOptHideManual', 'hideManual']]) {
      $(id).onchange = e => { const V = this.V; if (!V) return; V.notes[k] = e.target.checked; this.savePrefs(); this.updateNamesUI(); if (V.notes.names !== 'off') rerenderSoon() }
    }
    $('#vNamesBtn').onclick = e => this.togglePop('#vNamesPop', e.currentTarget, 'down')

    // popovers : un toucher ailleurs les ferme
    document.addEventListener('pointerdown', e => {
      if (!e.target.closest('.pop') && !e.target.closest('.popopen')) this.closePops()
    })

    // mode main / stylo
    $$('#vModeSeg button').forEach(b => b.onclick = () => { this.closePops(); this.setInk(b.dataset.m === 'pen') })

    // outils d'annotation (préférences gardées dans ce navigateur)
    if (!Array.isArray(G.palette) || !G.palette.length) G.palette = DEFAULT_PALETTE.slice()
    if (!G.palette.includes(G.color)) G.color = G.palette[0]
    ink.tool = (G.tool === 'text' || G.tool === 'emoji') ? 'pen' : (G.tool || 'pen'); ink.shape = G.shape || 'ellipse'; ink.color = G.color; ink.size = G.size || 2; ink.fingerDraws = !G.fingerScroll
    if (!Array.isArray(G.emojis) || !G.emojis.length) G.emojis = DEFAULT_EMOJIS.map(([e, l]) => ({ e, l }))
    ink.emoji = G.emoji || G.emojis[0].e
    ink.onPickEmoji = cb => this.openEmojiPop(cb)
    ink.onEditText = (init, cb) => this.promptText('Texte', init, cb, 'Écris ton annotation…')
    $('#vToolBtn').onclick = e => this.togglePop('#vToolPop', e.currentTarget, 'down')
    $('#vMoreBtn').onclick = e => this.togglePop('#vMorePop', e.currentTarget, 'down')
    $$('#vToolPop [data-tool]').forEach(b => b.onclick = () => {
      if (b.dataset.tool === 'emoji') { this.openEmojiPop(null); return }
      ink.setTool(b.dataset.tool); G.tool = b.dataset.tool; this.saveG(); this.paintInkbar()
      if (b.dataset.tool === 'text') { this.closePops(); this.toast('Touche la page pour écrire · touche un texte pour le déplacer, tourner ou agrandir', 3500) }
      if (b.dataset.tool === 'eraser' || b.dataset.tool === 'hl') this.closePops()
    })
    $$('#vShapeRow [data-shape]').forEach(b => b.onclick = () => {
      ink.setTool('shape'); ink.shape = G.shape = b.dataset.shape; G.tool = 'shape'; this.saveG(); this.paintInkbar(); this.closePops()
    })
    $$('#vToolPop [data-size]').forEach(b => b.onclick = () => { ink.size = G.size = +b.dataset.size; ink.setSelectedSize(+b.dataset.size); this.saveG(); this.paintInkbar(); this.closePops() })
    $('#vColorPick').addEventListener('change', e => {
      const c = e.target.value.toLowerCase()
      if (!G.palette.includes(c)) G.palette.push(c)
      G.color = ink.color = c; this.editingColors = false
      if (ink.tool === 'eraser' || ink.tool === 'hl') { ink.setTool('pen'); G.tool = 'pen' }
      this.saveG(); this.renderSwatches(); this.paintInkbar(); this.closePops()
    })
    $('#vEditColors').onclick = () => { this.editingColors = !this.editingColors; this.renderSwatches(); this.paintInkbar(); this.closePops(); if (this.editingColors) this.toast('Touche une couleur pour la retirer · ⋯ puis « Terminer »', 3500) }
    $('#vOptFinger').onchange = e => { G.fingerScroll = e.target.checked; ink.fingerDraws = !G.fingerScroll; this.saveG() }
    $('#vUndo').onclick = () => ink.undo()
    $('#vRedo').onclick = () => ink.redo()
    $('#vClearPage').onclick = () => { this.closePops(); ink.clearPage(this.visibleInkPage()); this.toast('Page effacée (Annuler pour revenir)') }
    $('#vEmojiAdd').onclick = () => {
      this.promptText('Ajouter un emoji', '', t => {
        t = (t || '').trim(); if (!t) return
        const [e, ...rest] = t.split(/\s+/)
        if (!G.emojis.some(x => x.e === e)) G.emojis.push({ e, l: rest.join(' ') })
        this.saveG(); this.pickEmoji(e)
      }, 'Colle un emoji, puis un nom (ex. « 🎵 Chanter »)')
    }
    $('#vEmojiReset').onclick = () => { G.emojis = DEFAULT_EMOJIS.map(([e, l]) => ({ e, l })); this.saveG(); this.renderEmojis(); this.toast('Liste d’emoji réinitialisée') }
    this.renderSwatches(); this.paintInkbar()

    // accordeur
    $('#vTunerBtn').onclick = () => this.openTuner()
    $('#vTunerClose').onclick = () => this.closeTuner()

    // iPad / iPhone : le son ne peut démarrer que pendant un geste -> on « réveille » l'audio au premier toucher
    const unlock = () => { try { const c = player.ensureCtx(); if (c.state !== 'running') c.resume() } catch { } removeEventListener('pointerdown', unlock, true) }
    addEventListener('pointerdown', unlock, true)

    document.addEventListener('visibilitychange', () => { if (document.hidden && player.playing) { player.pause(); this.setPlayIcon(false) } })
    // clavier : espace = lecture, Échap = fermer ce qui est ouvert, Ctrl+Z / Ctrl+Y
    document.addEventListener('keydown', e => {
      if (!this.visibleNow || !this.V) return
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return
      if (e.code === 'Space') { e.preventDefault(); this.togglePlay() }
      else if (e.key === 'Escape') {
        if (!$('#vTuner').hidden) this.closeTuner()
        else if (!$('#vTextDlg').hidden) $('#vTextCancel').click()
        else if ($$(':scope > .pop').some(p => !p.hidden)) this.closePops()
        else if ($('#vTracks').classList.contains('open')) this.closeTracks()
        else if (this.V.loopPick) this.cancelLoopPick()
        else if (this.inkOn) this.setInk(false)
      }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? ink.redo() : ink.undo() }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); ink.redo() }
    })
  }
}

// position verticale « propriétaire » d'une annotation (pour la ligne continue)
const objY = o => o.t === 'text' ? o.y : (o.p && o.p.length ? o.p.reduce((a, q) => a + q[1], 0) / o.p.length : 0)

// appui long (retirer un emoji de la liste)
function longPress(el, fn) {
  let t = 0
  el.addEventListener('pointerdown', () => { t = setTimeout(() => { t = -1; fn() }, 650) })
  const end = () => { if (t > 0) clearTimeout(t) }
  el.addEventListener('pointerup', end); el.addEventListener('pointerleave', end); el.addEventListener('pointercancel', end)
  el.addEventListener('click', e => { if (t === -1) { e.stopImmediatePropagation(); e.preventDefault(); t = 0 } }, true)
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
