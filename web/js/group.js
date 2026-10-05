// Le collectif : une clé secrète partagée (dans le lien d'invitation) + la liste des membres.
// Pas de serveur : chaque membre publie dans son !Moi.json les membres qu'il connaît ; on fait l'union.
// Le relais ntfy.sh ne voit que des messages chiffrés (AES-GCM, clé du collectif) sur un sujet tiré de la clé.

import { deflateSync, inflateSync } from '../lib/fflate.js'

const enc = new TextEncoder(), dec = new TextDecoder()
const b64u = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

export const randomId = (n = 9) => b64u(crypto.getRandomValues(new Uint8Array(n)))

export function newGroup(name) { return { id: randomId(6), name: name || 'Mon collectif', key: randomId(16) } }

// ---- invitation : UN seul lien pour tout le collectif ----
//   https://…/#rejoindre=F1.<données compressées>  (ou le code « F1.… » seul, à coller)
//   contient la clé du collectif + la carte de chaque membre (lien de partage) : celui qui rejoint
//   voit tout le monde, et tout le monde le découvre (relais + bouche-à-oreille). Jamais de lien par paire.
//   (c = identifiant de l'appli pCloud : les invités n'ont rien à taper)
export function inviteCode(group, members, clientId) {
  const m = members.filter(x => x.link).map(({ id, name, emoji, color, link, pw }) => ({ id, name, emoji, color, link, pw }))
  return 'F1.' + b64u(deflateSync(enc.encode(JSON.stringify({ g: group, m, c: clientId || '' })), { level: 9 }))
}
export const inviteUrl = (group, members, clientId) => location.origin + location.pathname + '#rejoindre=' + inviteCode(group, members, clientId)
export function readInvite(text) {
  const m = String(text || '').match(/(?:^|rejoindre=|\s)F1\.([A-Za-z0-9_-]+)/)
  if (!m) return null
  try { const o = JSON.parse(dec.decode(inflateSync(unb64u(m[1])))); return o && o.g && o.g.key ? o : null } catch { return null }
}

// ---- appareil de plus (PC -> tablette) : QR code + code à 6 chiffres affiché à côté ----
//   https://…/#appareil=<sel>.<iv>.<chiffré>   chiffré avec PBKDF2(code) ; valable 15 min.
//   Contient la connexion pCloud : la tablette retrouve ensuite tout (profil, collectif) dans !Moi.json.
async function pinKey(pin, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
export async function makeDeviceLink(payload) {
  const pin = String(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000)
  const salt = crypto.getRandomValues(new Uint8Array(8)), iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await pinKey(pin, salt), enc.encode(JSON.stringify({ ...payload, exp: Math.round((Date.now() + 15 * 60000) / 1000) }))))
  return { url: location.origin + location.pathname + '#appareil=' + [salt, iv, ct].map(b64u).join('.'), pin }
}
export function readDeviceLink(text) { const m = String(text || '').match(/appareil=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/); return m ? m[1] : null }
export async function openDeviceLink(s, pin) {
  try {
    const [salt, iv, ct] = s.split('.').map(unb64u)
    const o = JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await pinKey(pin, salt), ct)))
    return (o.exp < 1e11 ? o.exp * 1000 : o.exp) > Date.now() ? o : null
  } catch { return null }
}

// ---- chiffrement des messages du relais ----
const keys = new Map()
async function aesKey(k) {
  if (!keys.has(k)) keys.set(k, crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', enc.encode('maf:' + k)), 'AES-GCM', false, ['encrypt', 'decrypt']))
  return keys.get(k)
}
export async function seal(group, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(group.key), enc.encode(JSON.stringify(obj))))
  return b64u(iv) + '.' + b64u(ct)
}
export async function open(group, s) {
  try {
    const [iv, ct] = String(s).split('.')
    return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, await aesKey(group.key), unb64u(ct))))
  } catch { return null }
}
export async function topicOf(group) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode('topic:' + group.key)))
  return 'maf-' + Array.from(h.slice(0, 12), b => b.toString(16).padStart(2, '0')).join('')
}

// ---- relais temps réel : présence + événements ----
//   { ev:'hello', from }               je suis là (toutes les ~75 s)   · { ev:'bye', from }
//   { ev:'index', from }               mon !Moi.json a changé (partition, statut, commentaire)
//   { ev:'ink', from, score }          mes annotations sur cette partition ont changé
export class Relay {
  constructor(group, me, onMsg) {
    this.group = group; this.me = me; this.onMsg = onMsg
    this.base = (window.MAF_CONFIG && window.MAF_CONFIG.relay) || 'https://ntfy.sh/'
    this.online = new Map()   // id -> { at, card, score }
    this.timer = null; this.sse = null
  }
  async start() {
    this.topic = await topicOf(this.group)
    try {   // qui était là ces 3 dernières minutes ?
      const t = await (await fetch(this.base + this.topic + '/json?poll=1&since=180s', { cache: 'no-store' })).text()
      for (const line of t.split('\n')) { try { const m = JSON.parse(line); if (m.event === 'message') await this._in(m.message, m.time * 1000, true) } catch { } }
    } catch { }
    if (window.EventSource) {
      this.sse = new EventSource(this.base + this.topic + '/sse')
      this.sse.onmessage = ev => { try { const m = JSON.parse(ev.data); if (!m.event || m.event === 'message') this._in(m.message, Date.now(), false) } catch { } }
    }
    const prepBye = async () => { this.byeBody = await seal(this.group, { ev: 'bye', from: this.me() }) }
    this.send({ ev: 'hello' }); prepBye()
    this.timer = setInterval(() => { this.send({ ev: 'hello' }); prepBye(); this._expire() }, 75000)
    // à la fermeture, pas le temps de chiffrer : message « bye » préparé à l'avance
    addEventListener('pagehide', () => { if (this.byeBody && navigator.sendBeacon) navigator.sendBeacon(this.base + this.topic, this.byeBody) })
  }
  async _in(text, at, replay) {
    const o = await open(this.group, text)
    if (!o || !o.from || o.from.id === this.me().id) return
    if (o.ev === 'bye') this.online.delete(o.from.id)
    else this.online.set(o.from.id, { at, card: o.from, score: o.score || (this.online.get(o.from.id) || {}).score })
    this.onMsg(o, replay)
  }
  _expire() { for (const [id, v] of this.online) if (Date.now() - v.at > 200000) this.online.delete(id) }
  isOnline(id) { const v = this.online.get(id); return !!v && Date.now() - v.at < 200000 }
  async send(o) {
    if (navigator.onLine === false || !this.topic) return
    const body = await seal(this.group, { ...o, from: this.me(), score: o.score || this.here || '' })
    fetch(this.base + this.topic, { method: 'POST', body, keepalive: true }).catch(() => { })
  }
}
