// « Mon instrument » : tablature (basse, guitare, ukulélé) et transposition, appliquées au .mscx avant le rendu.
//   La tablature est une copie de la portée choisie, ajoutée juste en dessous (nouvelle partie, muette :
//   le son vient toujours de la partition sans tablature). Chaque note reçoit une corde et une case.
//   La transposition décale toutes les notes (hauteur + orthographe), les armures et les accords.

export const TABS = {
  bass4: { label: 'Basse 4 cordes', short: 'Basse', tune: [28, 33, 38, 43], frets: 24, type: 'tab4StrCommon', match: /bass|basse|contreb/i, low: true },
  bass5: { label: 'Basse 5 cordes', short: 'Basse 5', tune: [23, 28, 33, 38, 43], frets: 24, type: 'tab5StrCommon', match: /bass|basse|contreb/i, low: true },
  guitar: { label: 'Guitare', short: 'Guitare', tune: [40, 45, 50, 55, 59, 64], frets: 22, type: 'tab6StrCommon', match: /guit/i },
  uke: { label: 'Ukulélé', short: 'Ukulélé', tune: [67, 60, 64, 69], frets: 15, type: 'tabUkulele', match: /ukul/i },
}
// lire pour un instrument transpositeur : les notes écrites sont décalées, le son ne change pas
export const READ_AS = [
  [0, 'En ut (piano, violon, guitare, flûte…)'],
  [2, 'Si♭ : trompette, clarinette, sax ténor/soprano'],
  [9, 'Mi♭ : sax alto/baryton'],
  [7, 'Fa : cor'],
]

const kids = (el, tag) => Array.from(el.children).filter(c => c.tagName === tag)
const kid = (el, tag) => Array.from(el.children).find(c => c.tagName === tag)
export function shiftLabel(n) {
  if (!n) return 'Tonalité d’origine'
  const a = Math.abs(n), dir = n > 0 ? 'plus aigu' : 'plus grave'
  return (n > 0 ? '+' : '−') + a + ' · ' + (a === 12 ? 'une octave ' + (n > 0 ? 'plus haut' : 'plus bas') : a === 2 ? 'un ton ' + dir : a === 1 ? 'un demi-ton ' + dir : a + ' demi-tons ' + dir)
}

// partie à mettre en tablature : nom de l'instrument, sinon (basse) la plus grave, sinon la première
export function pickTabPart(parts, kind) {
  const T = TABS[kind]; if (!T) return -1
  const ok = parts.filter(p => !p.drum)
  if (!ok.length) return -1
  const named = ok.find(p => T.match.test(p.name))
  if (named) return named.index
  if (T.low) return ok.slice().sort((a, b) => (a.avgPitch ?? 99) - (b.avgPitch ?? 99))[0].index
  return ok[0].index
}

// ---------------------------------------------------------------- transposition
// demi-tons -> décalage en quintes de l'orthographe (tpc) : l'intervalle le plus courant
const FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5]
export function transposeDoc(score, n, parts) {
  n = Math.round(n) | 0
  if (!n) return
  let d = FIFTHS[((n % 12) + 12) % 12]
  // armure principale : on reste entre 6♭ et 6♯ (sinon l'enharmonique : Ré♭ plutôt que Do♯)
  const k0 = score.querySelector('KeySig > accidental, KeySig > concertKey')
  const key = k0 ? parseInt(k0.textContent, 10) || 0 : 0
  if (key + d > 6) d -= 12; else if (key + d < -6) d += 12
  const tpcOk = v => { while (v > 33) v -= 12; while (v < -1) v += 12; return v }
  const keyOk = v => { while (v > 7) v -= 12; while (v < -7) v += 12; return v }
  const drum = []   // une entrée par portée
  kids(score, 'Part').forEach((p, i) => kids(p, 'Staff').forEach(() => drum.push(!!(parts && parts[i] && parts[i].drum))))
  kids(score, 'Staff').forEach((st, i) => {
    if (drum[i]) return
    for (const note of st.getElementsByTagName('Note')) {
      const p = kid(note, 'pitch'); if (p) p.textContent = String(Math.max(0, Math.min(127, parseInt(p.textContent, 10) + n)))
      for (const t of ['tpc', 'tpc2']) { const e = kid(note, t); if (e) e.textContent = String(tpcOk(parseInt(e.textContent, 10) + d)) }
    }
    for (const ks of st.getElementsByTagName('KeySig')) {
      for (const t of ['accidental', 'concertKey', 'actualKey', 'key']) { const e = kid(ks, t); if (e && /^-?\d+$/.test(e.textContent.trim())) e.textContent = String(keyOk(parseInt(e.textContent, 10) + d)) }
    }
    for (const h of st.getElementsByTagName('Harmony')) {
      for (const t of ['root', 'base']) { const e = kid(h, t); if (e && /^-?\d+$/.test(e.textContent.trim())) e.textContent = String(tpcOk(parseInt(e.textContent, 10) + d)) }
    }
  })
}

// ---------------------------------------------------------------- tablature
// cordes : MuseScore numérote 0 = la corde la plus aiguë (ligne du haut)
function fretChord(pitches, T, hand) {
  const n = T.tune.length, used = new Set(), out = []
  const lo = Math.min(...T.tune), hi = Math.max(...T.tune) + T.frets
  for (let p of pitches.slice().sort((a, b) => b - a)) {
    while (p < lo) p += 12
    while (p > hi) p -= 12
    let best = null
    T.tune.forEach((open, s) => {
      const f = p - open
      if (f < 0 || f > T.frets || used.has(s)) return
      const cost = f === 0 ? Math.abs(hand.pos - 1) * 0.6 : Math.abs(f - hand.pos) + f * 0.08
      if (!best || cost < best.cost) best = { s, f, cost }
    })
    if (!best) { out.push(null); continue }
    used.add(best.s); out.push({ pitch: p, string: n - 1 - best.s, fret: best.f })
  }
  const fretted = out.filter(o => o && o.fret > 0)
  if (fretted.length) hand.pos = fretted.reduce((a, o) => a + o.fret, 0) / fretted.length
  return out   // dans l'ordre aigu -> grave
}

// ajoute la tablature de la partie `pi` juste en dessous ; `only` cache la portée d'origine
export function addTab(doc, score, pi, kind, only) {
  const T = TABS[kind]
  const parts = kids(score, 'Part'), src = parts[pi]
  if (!T || !src) return false
  // portée source : la plus grave pour la basse (main gauche du piano), sinon la première
  const srcStaves = kids(src, 'Staff')
  const first = parts.slice(0, pi).reduce((n, p) => n + kids(p, 'Staff').length, 0)
  const k = T.low ? srcStaves.length - 1 : 0
  const body = kids(score, 'Staff'), bsrc = body[first + k]
  if (!bsrc) return false

  // la partie (définition) : copie de l'instrument, une seule portée de tablature
  const part = src.cloneNode(true)
  kids(part, 'Staff').forEach(s => s.remove())
  kids(part, 'show').forEach(s => s.remove())
  const maxId = Math.max(0, ...parts.map(p => parseInt(p.getAttribute('id') || '0', 10)))
  if (src.hasAttribute('id')) part.setAttribute('id', String(maxId + 1))
  const pst = doc.createElement('Staff'); pst.setAttribute('id', '0')
  const stt = doc.createElement('StaffType'); stt.setAttribute('group', 'tablature')
  const add = (el, tag, val) => { const e = doc.createElement(tag); if (val != null) e.textContent = String(val); el.appendChild(e); return e }
  add(stt, 'name', T.type); add(stt, 'lines', T.tune.length); add(stt, 'lineDistance', 1.5)
  // rythme : hampes sous la tablature quand elle est seule (sinon la portée d'origine le montre déjà)
  for (const [k, v] of Object.entries(only ? { stemless: 0, stemsDown: 1, stemsThrough: 0, minimStyle: 1, showRests: 1, timesig: 1 } : { stemless: 1, showRests: 0, timesig: 0 })) add(stt, k, v)
  pst.appendChild(stt)
  part.insertBefore(pst, part.firstElementChild)
  const label = 'Tablature ' + T.short.toLowerCase()
  for (const t of kids(part, 'trackName')) t.textContent = label
  const inst = kid(part, 'Instrument')
  if (inst) {
    for (const t of ['longName', 'shortName', 'trackName']) for (const e of kids(inst, t)) e.textContent = t === 'shortName' ? 'Tab' : label
    for (const t of ['transposeChromatic', 'transposeDiatonic', 'StringData', 'Drum', 'useDrumset', 'clef', 'concertClef', 'transposingClef']) kids(inst, t).forEach(e => e.remove())
    const sd = add(inst, 'StringData'); add(sd, 'frets', T.frets)
    for (const p of T.tune) add(sd, 'string', p)
    // muette : le son vient de la partition sans tablature (voir Viewer.renderVariant)
    for (const ch of kids(inst, 'Channel')) { kids(ch, 'mute').forEach(e => e.remove()); add(ch, 'mute', 1) }
  }
  src.after(part)
  if (only) {
    kids(src, 'show').forEach(s => s.remove())
    const s = doc.createElement('show'); s.textContent = '0'
    src.insertBefore(s, src.firstElementChild ? src.firstElementChild.nextSibling : null)
    for (const st of kids(src, 'Staff')) kids(st, 'isStaffVisible').forEach(e => { e.textContent = '0' })
  }

  // le contenu : copie de la portée, sans ce qui n'a pas de sens en tablature
  const tab = bsrc.cloneNode(true)
  for (const tag of ['VBox', 'HBox', 'TBox', 'FBox']) Array.from(tab.getElementsByTagName(tag)).forEach(e => e.remove())
  // (liaisons, nuances, reprises… : la portée d'origine les montre déjà, et des doublons gêneraient la lecture)
  for (const tag of ['Clef', 'Lyrics', 'Harmony', 'Fingering', 'Dynamic', 'StaffText', 'SystemText', 'RehearsalMark', 'Tempo', 'Text', 'Fermata',
    'Articulation', 'Arpeggio', 'Tremolo', 'ChordLine', 'Spanner', 'Slur', 'Tie', 'endSpanner', 'HairPin', 'Ottava', 'Pedal', 'TextLine', 'Trill',
    'Volta', 'LetRing', 'Vibrato', 'PalmMute', 'Glissando', 'Marker', 'Jump', 'LayoutBreak', 'StaffTypeChange', 'InstrumentChange', 'Breath',
    'Ambitus', 'Bend', 'Image', 'Accidental'])
    Array.from(tab.getElementsByTagName(tag)).forEach(e => e.remove())
  // octave de jeu : toute la partie décalée d'octaves pour tomber au milieu du manche
  //   (comme on lit d'habitude : la basse et la guitare sonnent une octave plus bas que la note écrite)
  const all = Array.from(tab.getElementsByTagName('pitch'), e => +e.textContent).filter(n => n > 0)
  const avg = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0
  const oct = avg ? Math.round((Math.min(...T.tune) + 9 - avg) / 12) * 12 : 0
  const hand = { pos: 2 }
  for (const chord of Array.from(tab.getElementsByTagName('Chord'))) {
    const notes = kids(chord, 'Note')
    const pitches = notes.map(n => parseInt((kid(n, 'pitch') || {}).textContent || '60', 10) + oct)
    const order = pitches.map((p, i) => i).sort((a, b) => pitches[b] - pitches[a])
    const res = fretChord(pitches, T, hand)
    order.forEach((ni, r) => {
      const note = notes[ni], f = res[r]
      if (!f) { if (kids(chord, 'Note').length > 1) note.remove(); return }
      kids(note, 'tpc2').forEach(e => e.remove())
      kid(note, 'pitch').textContent = String(f.pitch)   // à l'octave près (même tpc)
      kids(note, 'fret').forEach(e => e.remove()); kids(note, 'string').forEach(e => e.remove())
      add(note, 'fret', f.fret); add(note, 'string', f.string)
    })
  }
  bsrc.parentNode.insertBefore(tab, body[first + srcStaves.length] || null)

  // renumérotation des portées (définitions et contenu, dans l'ordre)
  let i = 0; for (const p of kids(score, 'Part')) for (const s of kids(p, 'Staff')) s.setAttribute('id', String(++i))
  i = 0; for (const s of kids(score, 'Staff')) s.setAttribute('id', String(++i))
  return true
}
