// Scanner un QR code avec la caméra (invitation F1.… ou QR « appareil »).
// BarcodeDetector quand le navigateur l'a (Chrome Android), sinon jsQR (lib/jsQR.js, chargé à la demande).
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

// ouvre la caméra en plein écran ; résout avec le texte du QR code, ou null si on annule
export function scanQR() {
  return new Promise(async resolve => {
    const box = document.createElement('div'); box.className = 'scanner'
    box.innerHTML = `<video playsinline muted></video><div class="scan-frame"></div>
      <p class="scan-help">Vise le QR code (invitation ou « Ajouter un appareil »)</p>
      <button class="scan-close">✕ Annuler</button>`
    document.body.appendChild(box)
    const video = box.querySelector('video')
    let stream = null, done = false, raf = 0
    const end = text => {
      if (done) return; done = true
      cancelAnimationFrame(raf)
      if (stream) for (const t of stream.getTracks()) t.stop()
      box.remove(); removeEventListener('popstate', onBack); resolve(text)
    }
    const onBack = () => end(null)
    addEventListener('popstate', onBack)
    box.querySelector('.scan-close').onclick = () => end(null)
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
    } catch (e) {
      box.querySelector('.scan-help').textContent = 'Caméra indisponible : autorise-la pour cette appli / ce site, ou colle le lien à la main.'
      return
    }
    video.srcObject = stream
    await video.play().catch(() => { })
    let detect
    if ('BarcodeDetector' in window) {
      try {
        const bd = new window.BarcodeDetector({ formats: ['qr_code'] })
        detect = async () => { const r = await bd.detect(video); return r[0] && r[0].rawValue }
      } catch { }
    }
    if (!detect) {
      const decode = await loadJsQR().catch(() => null)
      if (!decode) { box.querySelector('.scan-help').textContent = 'Impossible de lire les QR codes ici : colle le lien à la main.'; return }
      const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true })
      detect = async () => {
        const w = video.videoWidth, h = video.videoHeight; if (!w) return null
        const k = Math.min(1, 640 / Math.max(w, h)); cv.width = w * k; cv.height = h * k
        cx.drawImage(video, 0, 0, cv.width, cv.height)
        const r = decode(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height, { inversionAttempts: 'dontInvert' })
        return r && r.data
      }
    }
    const loop = async () => {
      if (done) return
      try { const t = await detect(); if (t) { navigator.vibrate && navigator.vibrate(60); return end(t) } } catch { }
      raf = requestAnimationFrame(loop)
    }
    loop()
  })
}
