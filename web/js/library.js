// La maxi-bibliothèque : l'union des dossiers de tous les membres.
// Rien n'est jamais écrit chez quelqu'un d'autre : chacun écrit son !Moi.json et ses Notes/,
// et l'appli fusionne ce que tout le monde a publié (sans conflit possible).
import { PublicFolder } from './partoche/pcloud.js'
import { SCORES, MINE, NOTES } from './cloud.js'
import { lsSet, lsGet } from './partoche/store.js'
import { fromFileName, cachedArtist, guessArtist, searchPaused } from './artist.js'

export const STATUS = {
  envie: { icon: '💡', label: 'Envie de le jouer' },
  encours: { icon: '🛠️', label: 'Je bosse dessus' },
  pret: { icon: '✅', label: 'Prêt à jouer' },
}

export const scoreId = (memberId, fileName) => memberId + '/' + fileName
export const notesPath = id => NOTES + id.replace(/[\\/:*?"<>|]/g, '~') + '.json'
export const prettyTitle = name => name.replace(/\.mscz$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^./, c => c.toUpperCase())
export const normTitle = t => (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)|v\d+\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

// même lien de partage = même personne (le code du lien, quelle que soit la forme e./u./my.pcloud)
export const linkCode = l => (String(l || '').match(/code=([A-Za-z0-9]+)/) || [])[1] || ''

export function emptyIndex(me) {
  return { v: 1, group: null, me, knows: [], scores: {}, work: {}, comments: [], updated: 0 }
}

// un ami : son dossier public + son !Moi.json
class Peer {
  constructor(card) { this.card = card; this.id = card.id; this.index = null; this.folder = null; this.error = ''; this.loadedAt = 0 }
  async load(force) {
    if (!force && Date.now() - this.loadedAt < 15000) return this
    try {
      const f = this.folder || new PublicFolder(this.card.link, this.card.pw)
      await f.list()
      this.folder = f
      const fr = f.folder('Friends')
      const idx = fr && (fr.contents || []).find(c => !c.isfolder && c.name === '!Moi.json')
      this.index = idx ? JSON.parse(await f.text(idx.fileid)) : null
      this.error = ''
    } catch (e) { this.error = e.message || String(e) }
    this.loadedAt = Date.now()
    return this
  }
  scores() {
    const p = this.folder && this.folder.folder('MSCZ')
    return p ? (p.contents || []).filter(m => !m.isfolder && /\.mscz$/i.test(m.name)).map(meta => ({ meta })).map(({ meta }) => ({ name: meta.name, size: meta.size, hash: String(meta.hash || ''), fileid: meta.fileid })) : []
  }
  async bytes(name) { const s = this.scores().find(x => x.name === name); if (!s) throw new Error('partition introuvable chez ' + this.card.name); return this.folder.bytes(s.fileid) }
  async notes(id) {
    const fr = this.folder && this.folder.folder('Friends')
    const n = fr && (fr.contents || []).find(c => c.isfolder && c.name === 'Notes'); if (!n) return null
    const want = notesPath(id).slice(NOTES.length)
    const f = (n.contents || []).find(c => c.name === want); if (!f) return null
    try { return JSON.parse(await this.folder.text(f.fileid)) } catch { return null }
  }
}

export class Library {
  constructor(space, index) {
    this.space = space      // mon espace (cloud.js)
    this.index = index      // mon !Moi.json
    this.peers = new Map()  // id -> Peer
    this.forgetMyGhosts()
  }
  // mon lien = moi : une ancienne identité à moi (autre navigateur, config refaite) n'est pas un autre membre
  myCode() { return linkCode(this.me.link) || linkCode(this.space.root && this.space.root.link) }
  // l'admin = celui qui a créé le collectif ; lui seul peut retirer quelqu'un
  adminId() { return (this.index.group && this.index.group.admin) || '' }
  isAdmin() { return !!this.adminId() && this.adminId() === this.me.id }
  removedSet() {
    const a = this.adminId()
    const src = this.isAdmin() ? this.index : (this.peers.get(a) || {}).index
    return new Set(((src && src.removed) || []).map(x => x.code || x.id))
  }
  isRemoved(card) { const r = this.removedSet(); return r.has(linkCode(card.link)) || r.has(card.id) }
  async remove(id) {
    if (!this.isAdmin()) throw new Error('seul l’admin du collectif peut retirer quelqu’un')
    const k = this.index.knows.find(x => x.id === id); if (!k) return
    this.index.removed = (this.index.removed || []).concat({ id: k.id, code: linkCode(k.link), name: k.name, at: Date.now() })
    this.index.knows = this.index.knows.filter(x => x.id !== id)
    this.peers.delete(id)
    await this.save()
  }
  isMe(card) { const c = this.myCode(); return !!card && (card.id === this.me.id || (!!c && linkCode(card.link) === c)) }
  forgetMyGhosts() {
    const before = this.index.knows.length
    this.index.knows = this.index.knows.filter(k => !this.isMe(k))
    // et un seul membre par lien de partage (le plus récent gagne)
    const seen = new Map()
    for (const k of this.index.knows) seen.set(linkCode(k.link) || k.id, k)
    this.index.knows = [...seen.values()]
    return this.index.knows.length !== before
  }
  get me() { return this.index.me }
  async save() {
    this.index.updated = Date.now()
    lsSet('maf:index', this.index)   // copie dans ce navigateur : un F5 retrouve toujours mon profil
    await this.space.put(MINE + '!Moi.json', JSON.stringify(this.index, null, 1))
  }

  // ---- membres ----
  // un membre qu'on découvre (invitation, relais, ou cité dans le !Moi.json d'un autre)
  learn(card) {
    if (!card || !card.id || !card.link || this.isMe(card) || this.isRemoved(card)) return false
    // même lien qu'un membre connu sous un autre id (il a refait sa config) : on met à jour la même personne
    const k = this.index.knows.find(x => x.id === card.id) || this.index.knows.find(x => linkCode(x.link) === linkCode(card.link))
    if (k && k.id !== card.id) { this.peers.delete(k.id); k.id = card.id }
    if (k) { const changed = ['name', 'emoji', 'color', 'link', 'pw'].some(f => card[f] && card[f] !== k[f]); Object.assign(k, card); if (changed && this.peers.has(card.id)) this.peers.get(card.id).card = k; return changed }
    this.index.knows.push({ id: card.id, name: card.name, emoji: card.emoji, color: card.color, link: card.link, pw: card.pw || '' })
    return true
  }
  members() { return [this.me, ...this.index.knows] }
  member(id) { return this.members().find(m => m.id === id) }
  peer(id) {
    const k = this.index.knows.find(x => x.id === id); if (!k) return null
    if (!this.peers.has(id)) this.peers.set(id, new Peer(k))
    return this.peers.get(id)
  }
  // recharge tous les amis ; propage les membres qu'ils connaissent (bouche-à-oreille)
  async refresh(force) {
    await this.space.refresh()
    let learned = false
    for (let round = 0; round < 3; round++) {
      const ps = this.index.knows.map(k => this.peer(k.id))
      await Promise.all(ps.map(p => p.load(force)))
      let more = false
      for (const p of ps) {
        if (!p.index) continue
        if (p.index.me) this.learn({ ...p.index.me, link: p.card.link, pw: p.card.pw })
        const g = p.index.group
        if (g && this.index.group && g.id === this.index.group.id && g.admin && !this.index.group.admin) { this.index.group.admin = g.admin; learned = true }
        for (const k of p.index.knows || []) if (!this.index.knows.some(x => x.id === k.id) && this.learn(k)) more = learned = true
      }
      if (!more) break
    }
    // retiré par quelqu'un du collectif : on ne le lit plus
    const n = this.index.knows.length
    this.index.knows = this.index.knows.filter(k => !this.isRemoved(k))
    if (this.index.knows.length !== n) learned = true
    if (learned) await this.save()
    return learned
  }

  // ---- partitions ----
  scores() {
    const out = []
    const add = (m, list, meta) => {
      for (const f of list) {
        const info = (meta && meta[f.name]) || {}
        const ff = fromFileName(f.name)
        const title = info.title || (ff ? ff.title : prettyTitle(f.name))
        // artiste : corrigé à la main > dans la partition / le nom du fichier > deviné (🔮)
        const fix = (lsGet('maf:artistFix', {}) || {})[normTitle(title)]
        let artist = fix || info.artist || info.composer || (ff && ff.artist) || '', guessed = !fix && !!info.artistGuessed
        if (!artist) { const g = cachedArtist(title); if (g) { artist = g; guessed = true } }
        out.push({ id: scoreId(m.id, f.name), owner: m, name: f.name, size: f.size, hash: f.hash, title, composer: info.composer || '', artist, guessed, basedOn: info.basedOn || '', addedAt: info.addedAt || 0, mine: m.id === this.me.id })
      }
    }
    add(this.me, this.space.list(SCORES).filter(f => /\.mscz$/i.test(f.name)), this.index.scores)
    for (const k of this.index.knows) { const p = this.peers.get(k.id); if (p && p.folder) add(k, p.scores(), p.index && p.index.scores) }
    return out
  }
  // morceaux = partitions regroupées par titre (les versions de chacun d'un même morceau)
  pieces() {
    const byKey = new Map()
    const all = this.scores()
    const root = s => { let x = s, n = 0; while (x.basedOn && n++ < 5) { const b = all.find(y => y.id === x.basedOn); if (!b) break; x = b } return x }
    for (const s of all) {
      const k = normTitle(root(s).title) || s.id
      if (!byKey.has(k)) byKey.set(k, { key: k, title: root(s).title, versions: [] })
      const piece = byKey.get(k)
      if (!piece.versions.some(v => v.hash && v.hash === s.hash && v.owner.id === s.owner.id)) piece.versions.push(s)
    }
    for (const p of byKey.values()) {
      p.versions.sort((a, b) => (a.basedOn ? 1 : 0) - (b.basedOn ? 1 : 0) || a.addedAt - b.addedAt)
      const sure = p.versions.find(v => v.artist && !v.guessed), any = p.versions.find(v => v.artist)
      p.artist = (sure || any || {}).artist || ''; p.guessed = !sure && !!any
      p.work = this.workOn(p.versions.map(v => v.id))
      p.comments = this.commentsOn(p.versions.map(v => v.id))
    }
    return [...byKey.values()].sort((a, b) => a.title.localeCompare(b.title, 'fr'))
  }
  // ---- artistes : deviner ceux qui manquent (une recherche à la fois), garder les miens dans !Moi.json ----
  async guessMissing(onFound) {
    if (this._guessing) return; this._guessing = true
    try {
      let changed = false
      for (const p of this.pieces()) {
        if (p.artist) continue
        if (searchPaused()) break   // trop de recherches : on reprendra à la prochaine actualisation
        const a = await guessArtist(p.title)
        if (!a) continue
        for (const v of p.versions) if (v.mine) { const i = this.index.scores[v.name] = this.index.scores[v.name] || {}; if (!i.artist) { i.artist = a; i.artistGuessed = true; i.title = i.title || v.title; changed = true } }
        onFound && onFound()
      }
      if (changed) await this.save()
    } finally { this._guessing = false }
  }
  // corriger l'artiste / le titre d'un morceau : chez moi c'est publié, sinon gardé dans ce navigateur
  async setArtist(piece, artist) {
    artist = artist.trim()
    const fix = lsGet('maf:artistFix', {}) || {}; if (artist) fix[normTitle(piece.title)] = artist; else delete fix[normTitle(piece.title)]; lsSet('maf:artistFix', fix)
    let mine = false
    for (const v of piece.versions) if (v.mine) { const i = this.index.scores[v.name] = this.index.scores[v.name] || {}; i.artist = artist; i.artistGuessed = false; i.title = i.title || v.title; mine = true }
    if (mine) await this.save()
  }
  async setTitle(piece, title) {
    title = title.trim(); if (!title) return
    for (const v of piece.versions) if (v.mine) { const i = this.index.scores[v.name] = this.index.scores[v.name] || {}; i.title = title }
    await this.save()
  }

  // ---- tags Partoche (Settings/!Settings.json, lu seulement) -> mon statut, le même dans tous mes groupes ----
  //   À faire -> 💡 envie · En cours -> 🛠️ je bosse dessus · Maîtrisé -> ✅ prêt. Un statut choisi dans Friends prime.
  async importPartocheTags() {
    let d = null
    try { d = await this.space.getJson('Settings/!Settings.json') } catch { return 0 }
    const tags = (d && d.global && d.global.tags) || {}
    const MAP = { todo: 'envie', wip: 'encours', done: 'pret' }
    let n = 0
    const seen = new Set()
    for (const [rel, t] of Object.entries(tags)) {
      const st = MAP[t]; if (!st) continue
      const id = scoreId(this.me.id, rel.split('/').pop()); seen.add(id)
      const w = this.index.work[id]
      if (w && w.src !== 'partoche') continue            // choisi dans Friends : on n'y touche pas
      if (!w || w.status !== st) { this.index.work[id] = { ...(w || {}), status: st, src: 'partoche', at: Date.now() }; n++ }
    }
    for (const [id, w] of Object.entries(this.index.work)) if (w.src === 'partoche' && id.startsWith(this.me.id + '/') && !seen.has(id)) { delete this.index.work[id]; n++ }
    if (n) await this.save()
    return n
  }

  async bytes(s) { return s.owner.id === this.me.id ? this.space.getBytes(SCORES + s.name) : this.peer(s.owner.id).bytes(s.name) }
  async addScore(file, info) {
    let name = file.name.replace(/[\\/:*?"<>|]/g, '_')
    if (this.space.index[SCORES + name] && info.basedOn) name = name.replace(/\.mscz$/i, '') + ' (' + this.me.name + ').mscz'
    await this.space.put(SCORES + name, file)
    this.index.scores[name] = { title: info.title || prettyTitle(name), composer: info.composer || '', basedOn: info.basedOn || '', addedAt: Date.now() }
    await this.save()
    return scoreId(this.me.id, name)
  }
  async removeScore(s) {
    if (!s.mine) throw new Error('seul ' + s.owner.name + ' peut retirer cette partition')
    await this.space.remove(SCORES + s.name)
    delete this.index.scores[s.name]
    await this.save()
  }

  // ---- qui bosse quoi (chacun publie son propre travail) ----
  workOn(ids) {
    const out = []
    for (const m of this.members()) {
      const idx = m.id === this.me.id ? this.index : (this.peers.get(m.id) || {}).index
      if (!idx || !idx.work) continue
      for (const id of ids) { const w = idx.work[id]; if (w && (w.status || w.part)) out.push({ member: m, score: id, ...w }) }
    }
    return out
  }
  async setWork(id, patch) {
    const w = Object.assign({}, this.index.work[id], patch, { at: Date.now() }); delete w.src
    if (!w.status && !w.part) delete this.index.work[id]; else this.index.work[id] = w
    await this.save()
  }

  // ---- commentaires (le fil d'un morceau = l'union des commentaires de chacun) ----
  commentsOn(ids) {
    const out = []
    for (const m of this.members()) {
      const idx = m.id === this.me.id ? this.index : (this.peers.get(m.id) || {}).index
      for (const c of (idx && idx.comments) || []) if (ids.includes(c.score)) out.push({ ...c, member: m })
    }
    return out.sort((a, b) => a.at - b.at)
  }
  async comment(id, text) { this.index.comments.push({ score: id, at: Date.now(), text: text.slice(0, 2000) }); await this.save() }

  // ---- annotations : les miennes (écriture) + celles des autres (lecture) ----
  // Fichier de notes : { v: 2, score, by, updated, ink: { <variantKey>: pages } }
  //   (les annotations dépendent de la vue : pistes affichées + noms des notes, comme dans Partoche)
  // Ancien format accepté : { v: 1, pages } = annotations de la vue par défaut.
  async myNotes(id) { try { return notesInk(await this.space.getJson(notesPath(id))) } catch { return null } }
  async saveNotes(id, ink) { await this.space.put(notesPath(id), JSON.stringify({ v: 2, score: id, by: this.me.id, updated: Date.now(), ink })) }
  async friendsNotes(id) {
    const out = []
    await Promise.all(this.index.knows.map(async k => {
      const p = this.peer(k.id); if (!p.folder) return
      const n = await p.notes(id)
      const ink = notesInk(n)
      if (ink) out.push({ member: k, ink, updated: n.updated })
    }))
    return out
  }
}

// contenu d'un fichier de notes -> { <variantKey>: pages } (format v2) ou tableau de pages (ancien format) ; null si vide
const hasInk = pages => Array.isArray(pages) && pages.some(pg => pg && pg.length)
export function notesInk(n) {
  if (!n) return null
  if (n.ink && typeof n.ink === 'object' && !Array.isArray(n.ink)) {
    const ink = {}
    for (const [k, pages] of Object.entries(n.ink)) if (hasInk(pages)) ink[k] = pages
    return Object.keys(ink).length ? ink : null
  }
  const pages = Array.isArray(n.ink) ? n.ink : n.pages
  return hasInk(pages) ? pages : null
}
