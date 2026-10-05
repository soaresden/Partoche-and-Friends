// Le tuto de Paf dans une fenêtre flottante, déplaçable et redimensionnable, par-dessus l'appli :
// on suit les étapes tout en faisant les manipulations à côté.
import { lsGet, lsSet } from './partoche/store.js'

let win = null
export const tutoOpen = () => !!win

export function openTuto() {
  if (win) { win.classList.add('flash'); setTimeout(() => win && win.classList.remove('flash'), 400); return }
  win = document.createElement('div')
  win.className = 'tutowin'
  win.innerHTML = `<div class="tw-bar"><span class="tw-title">🐶 Le tuto de Paf</span>
      <a class="tw-btn" href="tuto.html" target="_blank" rel="noopener" title="Ouvrir en grand">↗</a>
      <button class="tw-btn tw-close" title="Fermer">✕</button></div>
    <iframe src="tuto.html?embed=1" title="Le tuto de Paf"></iframe>`
  document.body.appendChild(win)
  // position / taille mémorisées (sur grand écran)
  const p = lsGet('maf:tutowin', null)
  if (p && innerWidth > 700) Object.assign(win.style, { left: clampX(p.x, p.w) + 'px', top: clampY(p.y) + 'px', width: p.w + 'px', height: p.h + 'px' })
  win.querySelector('.tw-close').onclick = closeTuto
  drag(win, win.querySelector('.tw-bar'))
  new ResizeObserver(save).observe(win)
}
export function closeTuto() { if (win) { win.remove(); win = null } }

const clampX = (x, w) => Math.max(0, Math.min(innerWidth - Math.min(w || 380, innerWidth), x))
const clampY = y => Math.max(0, Math.min(innerHeight - 60, y))
function save() {
  if (!win || innerWidth <= 700) return
  const r = win.getBoundingClientRect()
  lsSet('maf:tutowin', { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) })
}
// déplacer en tenant la barre de titre (souris ou doigt)
function drag(el, handle) {
  handle.addEventListener('pointerdown', e => {
    if (e.target.closest('.tw-btn') || innerWidth <= 700) return
    const r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top
    el.classList.add('dragging'); handle.setPointerCapture(e.pointerId)
    const move = ev => { el.style.left = clampX(ev.clientX - dx, r.width) + 'px'; el.style.top = clampY(ev.clientY - dy) + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto' }
    const up = () => { el.classList.remove('dragging'); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); save() }
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up)
  })
}
