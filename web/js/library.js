// La maxi-bibliothèque : l'union des dossiers de tous les membres.
// Rien n'est jamais écrit chez quelqu'un d'autre : chacun écrit son !Moi.json et ses Notes/,
// et l'appli fusionne ce que tout le monde a publié (sans conflit possible).
import { PublicFolder } from './partoche/pcloud.js'
import { SCORES, MINE, NOTES } from './cloud.js'

export const STATUS = {
  envie: { icon: '💡', label: 'Envie de le jouer' },
  encours: { icon: '🛠️', label: 'Je bosse dessus' },
  pret: { icon: '✅', label: 'Prêt à jouer' },
}

export const scoreId = (memberId, fileName) => memberId + '/' + fileName
export const notesPath = id => NOTES + id.replace(/[\\/:*?"<>|]/g, '~') + '.json'
export const prettyTitle = name => name.replace(/\.mscz$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^./, c => c.toUpperCase())
export const normTitle = t => (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)|v\d+\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

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
  }
  get me() { return this.index.me }
  async save() { this.index.updated = Date.now(); await this.space.put(MINE + '!Moi.json', JSON.stringify(this.index, null, 1)) }

  // ---- membres ----
  // un membre qu'on découvre (invitation, relais, ou cité dans le !Moi.json d'un autre)
  learn(card) {
    if (!card || !card.id || card.id === this.me.id || !card.link) return false
    const k = this.index.knows.find(x => x.id === card.id)
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
        for (const k of p.index.knows || []) if (!this.index.knows.some(x => x.id === k.id) && this.learn(k)) more = learned = true
      }
      if (!more) break
    }
    if (learned) await this.save()
    return learned
  }

  // ---- partitions ----
  scores() {
    const out = []
    const add = (m, list, meta) => {
      for (const f of list) {
        const info = (meta && meta[f.name]) || {}
        out.push({ id: scoreId(m.id, f.name), owner: m, name: f.name, size: f.size, hash: f.hash, title: info.title || prettyTitle(f.name), composer: info.composer || '', basedOn: info.basedOn || '', addedAt: info.addedAt || 0, mine: m.id === this.me.id })
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
      p.work = this.workOn(p.versions.map(v => v.id))
      p.comments = this.commentsOn(p.versions.map(v => v.id))
    }
    return [...byKey.values()].sort((a, b) => a.title.localeCompare(b.title, 'fr'))
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
    const w = Object.assign({}, this.index.work[id], patch, { at: Date.now() })
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
  async myNotes(id) { try { return await this.space.getJson(notesPath(id)) } catch { return null } }
  async saveNotes(id, pages) { await this.space.put(notesPath(id), JSON.stringify({ v: 1, score: id, by: this.me.id, updated: Date.now(), pages })) }
  async friendsNotes(id) {
    const out = []
    await Promise.all(this.index.knows.map(async k => {
      const p = this.peer(k.id); if (!p.folder) return
      const n = await p.notes(id)
      if (n && n.pages && n.pages.some(pg => pg && pg.length)) out.push({ member: k, pages: n.pages, updated: n.updated })
    }))
    return out
  }
}
