// Scanner un QR code avec la caméra (invitation F1.… ou QR « appareil »).
// Deux lecteurs à la fois, par sécurité : BarcodeDetector (intégré à certains navigateurs, mais parfois présent
// sans jamais rien trouver, ex. dans les vues web Android) ET jsQR (lib/jsQR.js). Le premier qui lit gagne.
// En secours : coller le lien copié sur l'autre appareil.
let jsqr = null
function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR)
  if (!jsqr) jsqr = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'lib/jsQR.js'
    s.onload = () => res(window.jsQR); s.onerror = () => rej(new Error('décodeur QR introuvable'))
    document.head.appendChild(s)
  })
  return jsqr
}

// ouvre la caméra en plein écran ; résout avec le texte lu, ou null si on annule
export function scanQR() {
  return new Promise(async resolve => {
    const box = document.createElement('div'); box.className = 'scanner'
    box.innerHTML = `<video playsinline muted autoplay></video><div class="scan-frame"></div>
      <p class="scan-help">Vise le QR code (invitation ou « Ajouter un appareil »)<br><small>Approche-toi pour qu'il remplisse le carré</small></p>
      <div class="scan-actions"><button class="scan-paste">📋 Coller le lien</button><button class="scan-close">✕ Annuler</button></div>`
    document.body.appendChild(box)
    const video = box.querySelector('video'), help = box.querySelector('.scan-help')
    let stream = null, done = false, timer = 0
    const end = text => {
      if (done) return; done = true
      clearTimeout(timer)
      if (stream) for (const t of stream.getTracks()) t.stop()
      box.remove(); removeEventListener('popstate', onBack); resolve(text)
    }
    const onBack = () => end(null)
    addEventListener('popstate', onBack)
    box.querySelector('.scan-close').onclick = () => end(null)
    box.querySelector('.scan-paste').onclick = async () => {
      let t = ''
      try { t = await navigator.clipboard.readText() } catch { }
      if (!t) t = prompt('Colle ici le lien (invitation ou « Ajouter un appareil ») :') || ''
      if (t.trim()) end(t.trim())
    }
    const decoder = loadJsQR().catch(() => null)   // chargé tout de suite, en parallèle de la caméra
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
    } catch (e) {
      help.innerHTML = 'Caméra indisponible (' + (e.name || 'refusée') + ').<br>Autorise la caméra pour cette appli / ce site, ou utilise « 📋 Coller le lien ».'
      return
    }
    video.srcObject = stream
    await video.play().catch(() => { })
    let bd = null
    if ('BarcodeDetector' in window) { try { bd = new window.BarcodeDetector({ formats: ['qr_code'] }) } catch { bd = null } }
    const decode = await decoder
    if (!bd && !decode) { help.innerHTML = 'Lecture de QR code impossible ici : utilise « 📋 Coller le lien ».'; return }
    const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true })
    let n = 0
    const tick = async () => {
      if (done) return
      n++
      let found = null
      if (video.videoWidth) {
        // 1) le lecteur intégré
        if (bd) { try { const r = await bd.detect(video); if (r && r[0] && r[0].rawValue) found = r[0].rawValue } catch { bd = null } }
        // 2) jsQR : sur le centre de l'image (là où est le carré), puis l'image entière une fois sur deux
        if (!found && decode) {
          const w = video.videoWidth, h = video.videoHeight
          const full = n % 2 === 0, s = full ? Math.max(w, h) : Math.min(w, h) * 0.75
          const sx = full ? 0 : (w - s) / 2, sy = full ? 0 : (h - s) / 2, sw = full ? w : s, sh = full ? h : s
          const k = Math.min(1, 800 / Math.max(sw, sh)); cv.width = Math.round(sw * k); cv.height = Math.round(sh * k)
          cx.drawImage(video, sx, sy, sw, sh, 0, 0, cv.width, cv.height)
          const r = decode(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height, { inversionAttempts: 'attemptBoth' })
          if (r && r.data) found = r.data
        }
      }
      if (found) { navigator.vibrate && navigator.vibrate(60); return end(found) }
      timer = setTimeout(tick, 120)
    }
    tick()
  })
}
