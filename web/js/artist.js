// Deviner l'artiste d'un morceau à partir de son titre (et de son nom de fichier).
//   1. « Artiste - Titre.mscz » (ou « Titre - Artiste ») dans le nom du fichier
//   2. recherche iTunes sur le titre (premier morceau d'un medley) : l'artiste qui revient
//      le plus souvent dans les résultats (écarte la plupart des reprises)
// Les résultats sont gardés dans ce navigateur ; une recherche à la fois, sans se presser.
import { lsGet, lsSet } from './partoche/store.js'

const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const CACHE = 'maf:artists'

// « Lady Gaga - Bad Romance.mscz » -> { artist, title }
export function fromFileName(name) {
  const base = String(name || '').replace(/\.mscz$/i, '').replace(/_/g, ' ').trim()
  const m = base.match(/^(.{2,40}?)\s+[-–—]\s+(.{2,})$/)
  return m ? { artist: m[1].trim(), title: m[2].trim() } : null
}

// le morceau principal d'un titre de medley / avec sous-titre
export function searchTitle(title) {
  return String(title || '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .split(/\s[\/|+]\s|\s*\/\s*|\bmedley\b|\bfeat\b|\bft\.?\b|\s[-–—]\s/i)[0]
    .replace(/\b(arr|arrangement|version|piano|violin|violon|guitar|guitare|easy|facile|solo|duo|trio|quartet|quatuor|score|partition|sheet|music)\b\.?/gi, ' ')
    .replace(/\s+/g, ' ').trim()
}

const cache = () => lsGet(CACHE, {}) || {}
export const cachedArtist = title => cache()[norm(searchTitle(title))]

let queue = Promise.resolve()
export function guessArtist(title) {
  const key = norm(searchTitle(title))
  if (!key || key.length < 2) return Promise.resolve(null)
  const c = cache()[key]
  if (c !== undefined) return Promise.resolve(c)
  // une requête à la fois, espacées (le service public limite le rythme)
  queue = queue.then(() => lookup(key, searchTitle(title))).then(r => new Promise(res => setTimeout(() => res(r), 350)))
  return queue
}

async function lookup(key, q) {
  if (cache()[key] !== undefined) return cache()[key]
  let artist = null
  try {
    const d = await (await fetch('https://itunes.apple.com/search?' + new URLSearchParams({ term: q, entity: 'song', limit: 25 }))).json()
    const tally = new Map(), qn = norm(q)
    for (const r of d.results || []) {
      const a = (r.artistName || '').split(/\s*(?:,|&| feat\.? | ft\.? | x )\s*/i)[0].trim()
      if (!a || /various|karaoke|tribute|cover|orchestra|piano|lullab|instrumental/i.test(a)) continue
      const exact = norm(r.trackName).startsWith(qn) ? 2 : 1   // le titre exact compte double
      tally.set(a, (tally.get(a) || 0) + exact)
    }
    const best = [...tally.entries()].sort((x, y) => y[1] - x[1])[0]
    if (best && best[1] >= 2) artist = best[0]
  } catch { return null }   // hors ligne : on réessaiera plus tard
  const c = cache(); c[key] = artist; lsSet(CACHE, c)
  return artist
}
