// Mon espace : là où j'écris (mon pCloud, ou le navigateur en mode démo).
// Compatible Partoche : on réutilise le MÊME dossier que celui partagé avec la prof.
// On lit les partitions dans MSCZ/ et on n'écrit que dans Friends/ (MesNotes, Settings, Prof restent à Partoche).
//
//   <dossier Partoche>/
//   ├── MSCZ/                 les partitions (communes avec Partoche)
//   ├── MesNotes/ Settings/ Prof/   … Partoche, pas touché
//   └── Friends/
//       ├── !Moi.json         profil, collectif, membres connus, infos de mes partitions, mon travail, mes commentaires
//       └── Notes/<id>.json   mes annotations « Friends », une par partition (la mienne ou celle d'un ami)
//
// Lire le dossier d'un ami : son lien de partage (+ mot de passe), sans compte.
// Écrire chez moi : pCloud exige d'être connecté (même un lien « dépôt : tout le monde » répond « Please provide 'auth' »).
import { unzipSync } from '../lib/fflate.js'
import { idbGet, idbSet, idbKeys, lsGet, lsSet } from './partoche/store.js'
import { PublicFolder, parseLink } from './partoche/pcloud.js'

const CFG = window.MAF_CONFIG || {}
export const SCORES = 'MSCZ/', MINE = 'Friends/', NOTES = 'Friends/Notes/'
const TOKEN_KEY = 'maf:pcloud', ROOT_KEY = 'maf:root'

// ---------------------------------------------------------------------
//  Connexion pCloud (OAuth « implicit » : le jeton reste dans ce navigateur)
// ---------------------------------------------------------------------
// identifiant de l'appli pCloud : config.local.js (ce PC) ou config.js, sinon tapé à la config / reçu dans l'invitation
export const clientId = () => CFG.pcloudClientId || lsGet('maf:clientId', '')
export function setClientId(id) { if (id) lsSet('maf:clientId', String(id).trim()) }
export const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '')
export function pcloudLoginUrl() {
  const redirect = redirectUri()
  return `https://my.pcloud.com/oauth2/authorize?client_id=${encodeURIComponent(clientId())}&response_type=token&redirect_uri=${encodeURIComponent(redirect)}`
}
// au retour de pCloud : #access_token=…&hostname=eapi.pcloud.com&locationid=2
export function takeOAuthRedirect() {
  const h = new URLSearchParams(location.hash.slice(1))
  const token = h.get('access_token')
  if (!token) return false
  lsSet(TOKEN_KEY, { token, api: 'https://' + (h.get('hostname') || 'api.pcloud.com') })
  history.replaceState(null, '', location.pathname + location.search)
  return true
}
export const hasPcloud = () => !!(lsGet(TOKEN_KEY, null) || {}).token
export function forgetPcloud() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(ROOT_KEY) }
// connexion transmise par un autre de mes appareils (QR code)
export const currentPcloud = () => ({ ...lsGet(TOKEN_KEY, null), root: lsGet(ROOT_KEY, null) })
export function adoptPcloud(p) {
  if (p && p.token) lsSet(TOKEN_KEY, { token: p.token, api: p.api || 'https://api.pcloud.com' })
  if (p && p.root) lsSet(ROOT_KEY, p.root)
}
// le dossier partagé choisi : { folderid, name, link, pw }
export const myRoot = () => lsGet(ROOT_KEY, null)
export function setMyRoot(r) { lsSet(ROOT_KEY, r) }

async function api(base, token, method, params = {}, init) {
  const q = new URLSearchParams({ ...params, access_token: token }).toString()
  const d = await (await fetch(`${base}/${method}?${q}`, init)).json()
  if (d.result !== 0) { const e = new Error(d.error || 'pCloud ' + d.result); e.code = d.result; throw e }
  return d
}

// Dossiers déjà partagés par lien (pour reprendre son dossier Partoche) — Partoche en premier
export async function sharedFolders() {
  const { token, api: base } = lsGet(TOKEN_KEY, {})
  const l = (await api(base, token, 'listpublinks')).publinks || []
  return l.filter(x => x.metadata && x.metadata.isfolder)
    .map(x => ({ folderid: x.metadata.folderid, name: x.metadata.name, link: x.link }))
    .sort((a, b) => (/partoche/i.test(b.name) ? 1 : 0) - (/partoche/i.test(a.name) ? 1 : 0))
}
// Déjà configuré (autre appareil, autre navigateur) ? On cherche Friends/!Moi.json dans mes dossiers partagés :
// s'il existe, tout est dedans (profil, collectif, mot de passe du lien) -> rien à refaire.
export async function findExisting() {
  const { token, api: base } = lsGet(TOKEN_KEY, {})
  const kid = (f, name, folder) => (f.contents || []).find(c => !!c.isfolder === folder && c.name === name)
  for (const f of await sharedFolders()) {
    try {
      const root = (await api(base, token, 'listfolder', { folderid: f.folderid })).metadata
      const fr = kid(root, 'Friends', true); if (!fr) continue
      const moi = kid((await api(base, token, 'listfolder', { folderid: fr.folderid })).metadata, '!Moi.json', false); if (!moi) continue
      let txt = null
      try { const r = await fetch(`${base}/gettextfile?${new URLSearchParams({ fileid: moi.fileid, access_token: token })}`); const t = await r.text(); if (r.ok && !/^\s*\{\s*"result"\s*:\s*[1-9]/.test(t)) txt = t } catch { }
      if (txt == null) {
        const z = unzipSync(new Uint8Array(await (await fetch(`${base}/getzip?${new URLSearchParams({ fileids: moi.fileid, access_token: token })}`)).arrayBuffer()))
        txt = new TextDecoder().decode(z[Object.keys(z).find(n => !n.endsWith('/'))])
      }
      const index = JSON.parse(txt)
      if (index && index.me && index.me.name) return { folder: f, index }
    } catch (e) { console.warn('recherche de', f.name, e) }
  }
  return null
}
// Partir de rien : dossier « Partoche » (+ MSCZ) et son lien de partage
export async function createShared(name = 'Partoche') {
  const { token, api: base } = lsGet(TOKEN_KEY, {})
  const root = (await api(base, token, 'createfolderifnotexists', { path: '/' + name })).metadata
  await api(base, token, 'createfolderifnotexists', { folderid: root.folderid, name: 'MSCZ' })
  const l = await api(base, token, 'getfolderpublink', { folderid: root.folderid })
  return { folderid: root.folderid, name: root.name, link: l.link }
}
// le mot de passe du lien est-il le bon ? (c'est lui que les amis utiliseront pour lire)
//   -> { ok, link, error } : on essaie les deux serveurs (EU / US) et on renvoie le lien sous une forme
//      que tout le monde lira sur le bon serveur (e.pcloud.link = Europe, u.pcloud.link = USA)
export async function checkLink(link, pw) {
  const p = parseLink(link)
  if (!p) return { ok: false, error: 'lien illisible' }
  let last = null
  for (const base of [p.api, p.api.includes('eapi') ? 'https://api.pcloud.com' : 'https://eapi.pcloud.com']) {
    const q = new URLSearchParams({ code: p.code, ...(pw ? { linkpassword: pw } : {}) })
    try {
      const d = await (await fetch(`${base}/showpublink?${q}`)).json()
      if (d.result === 0) return { ok: true, link: `https://${base.includes('eapi') ? 'e' : 'u'}.pcloud.link/publink/show?code=${p.code}` }
      last = d
      if (d.result !== 7001) break   // 7001 = lien inconnu sur ce serveur -> on tente l'autre
    } catch (e) { last = { error: e.message } }
  }
  const why = !last ? 'erreur inconnue'
    : last.result === 1125 ? 'mot de passe incorrect (c’est celui du lien de partage, pas celui de ton compte)'
    : last.result === 2258 ? 'ce lien a un mot de passe : tape-le'
    : last.result === 7001 ? 'lien introuvable chez pCloud'
    : (last.error || 'erreur ' + last.result)
  return { ok: false, error: why }
}
export { parseLink }

class PcloudSpace {
  constructor({ token, api: base }, root) { this.token = token; this.api = base; this.root = root; this.kind = 'pcloud'; this.ids = {}; this.index = null }
  call(method, params, init) { return api(this.api, this.token, method, params, init) }
  async init() {
    if (!this.root) { const e = new Error('dossier à choisir'); e.code = 'NO_ROOT'; throw e }
    const mk = async (parent, name) => (await this.call('createfolderifnotexists', { folderid: parent, name })).metadata.folderid
    this.ids[''] = this.root.folderid
    this.ids['MSCZ/'] = await mk(this.root.folderid, 'MSCZ')
    this.ids['Friends/'] = await mk(this.root.folderid, 'Friends')
    this.ids['Friends/Notes/'] = await mk(this.ids['Friends/'], 'Notes')
    await this.refresh()
    return this
  }
  // mes fichiers utiles : { 'MSCZ/x.mscz': meta, 'Friends/!Moi.json': meta, 'Friends/Notes/…': meta }
  async refresh() {
    const idx = {}
    for (const pre of ['MSCZ/', 'Friends/']) {
      const d = await this.call('listfolder', { folderid: this.ids[pre], recursive: 1 })
      const walk = (f, p) => { for (const c of f.contents || []) c.isfolder ? walk(c, p + c.name + '/') : (idx[p + c.name] = c) }
      walk(d.metadata, pre)
    }
    this.index = idx
    return idx
  }
  folderOf(path) { return this.ids[path.slice(0, path.lastIndexOf('/') + 1)] ?? this.ids[''] }
  async put(path, data) {
    const name = path.split('/').pop()
    const blob = data instanceof Blob ? data : new Blob([typeof data === 'string' ? data : JSON.stringify(data)], { type: 'application/json' })
    const fd = new FormData(); fd.append('file', blob, name)
    const d = await this.call('uploadfile', { folderid: this.folderOf(path), filename: name, nopartial: 1 }, { method: 'POST', body: fd })
    const meta = d.metadata && d.metadata[0]
    if (meta) this.index[path] = meta
    return meta
  }
  // texte d'un de mes fichiers : gettextfile, et si pCloud ou le navigateur le refuse, par getzip (comme les .mscz)
  async getText(path) {
    const m = this.index[path]; if (!m) return null
    try {
      const r = await fetch(`${this.api}/gettextfile?${new URLSearchParams({ fileid: m.fileid, access_token: this.token })}`)
      const t = await r.text()
      if (r.ok && !/^\s*\{\s*"result"\s*:\s*[1-9]/.test(t)) return t
    } catch { }
    const b = await this.getBytes(path)
    if (!b) throw new Error('pCloud : lecture impossible de ' + path)
    return new TextDecoder().decode(b)
  }
  async getJson(path) { const t = await this.getText(path); return t ? JSON.parse(t) : null }
  // les serveurs de fichiers pCloud refusent les autres sites (CORS) : on passe par getzip, comme Partoche
  async getBytes(path) {
    const m = this.index[path]; if (!m) return null
    const r = await fetch(`${this.api}/getzip?${new URLSearchParams({ fileids: m.fileid, access_token: this.token })}`)
    const files = unzipSync(new Uint8Array(await r.arrayBuffer()))
    return files[Object.keys(files).find(n => !n.endsWith('/'))]
  }
  list(prefix) { return Object.entries(this.index).filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/')).map(([p, m]) => ({ path: p, name: p.slice(prefix.length), size: m.size, hash: String(m.hash || ''), modified: m.modified })) }
  async remove(path) { const m = this.index[path]; if (!m) return; await this.call('deletefile', { fileid: m.fileid }); delete this.index[path] }
  // le lien partagé que les amis utilisent pour me lire (celui du dossier choisi, mot de passe tapé à la config)
  async shareLink() { return { link: this.root.link, pw: this.root.pw || '' } }
  async account() { const u = await this.call('userinfo'); return { email: u.email, premium: !!u.premium, folder: this.root.name } }
}

// ---------------------------------------------------------------------
//  Démo : tout reste dans ce navigateur (IndexedDB), rien n'est partagé
// ---------------------------------------------------------------------
class DemoSpace {
  constructor() { this.kind = 'demo'; this.index = {} }
  async init() {
    for (const k of await idbKeys('maf:demo:')) { const v = await idbGet(k); if (v) this.index[k.slice(9)] = v.meta }
    if (!Object.keys(this.index).some(p => p.startsWith(SCORES))) {
      for (const f of ['au-clair-de-la-lune.mscz', 'frere-jacques.mscz', 'ode-a-la-joie.mscz'])
        try { await this.put(SCORES + f, new Blob([await (await fetch('demo/' + f)).arrayBuffer()])) } catch { }
    }
    return this
  }
  async refresh() { return this.index }
  async put(path, data) {
    const blob = data instanceof Blob ? data : new Blob([typeof data === 'string' ? data : JSON.stringify(data)])
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const meta = { size: bytes.length, hash: String(bytes.length * 31 + (bytes[bytes.length >> 1] || 0)), modified: new Date().toUTCString() }
    await idbSet('maf:demo:' + path, { meta, bytes })
    this.index[path] = meta
    return meta
  }
  async getBytes(path) { const v = await idbGet('maf:demo:' + path); return v ? v.bytes : null }
  async getText(path) { const b = await this.getBytes(path); return b ? new TextDecoder().decode(b) : null }
  async getJson(path) { const t = await this.getText(path); return t ? JSON.parse(t) : null }
  list(prefix) { return PcloudSpace.prototype.list.call(this, prefix) }
  async remove(path) { await idbSet('maf:demo:' + path, undefined); delete this.index[path] }
  async shareLink() { return { link: '', pw: '' } }
  async account() { return { email: 'démo (ce navigateur)', premium: false, folder: '' } }
}

export async function openSpace(kind) {
  if (kind === 'pcloud') return new PcloudSpace(lsGet(TOKEN_KEY, {}), myRoot()).init()
  return new DemoSpace().init()
}
