// Partoche and Friends — interface
import { openSpace, takeOAuthRedirect, hasPcloud, pcloudLoginUrl, forgetPcloud, currentPcloud, adoptPcloud, MINE, sharedFolders, createShared, checkLink, setMyRoot, clientId, setClientId, redirectUri, findExisting } from './cloud.js'
import { newGroup, readInvite, inviteUrl, randomId, Relay, makeDeviceLink, readDeviceLink, openDeviceLink } from './group.js'
import { Library, emptyIndex, STATUS, normTitle } from './library.js'
import { Viewer, scoreInfo } from './viewer.js'
import { togglePreview, stopPreview, previewing } from './preview.js'
import { scanQR } from './scan.js'
import { openTuto, closeTuto, tutoOpen } from './tutowin.js'
import { lsGet, lsSet } from './partoche/store.js'

const $ = s => document.querySelector(s)
const $$ = s => [...document.querySelectorAll(s)]
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const CFG = window.MAF_CONFIG || {}
let toastT = 0
function toast(msg, ms = 3000) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms) }
function show(id) { for (const s of $$('.screen')) s.hidden = s.id !== id }
const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'à l’instant' : s < 3600 ? 'il y a ' + Math.round(s / 60) + ' min' : s < 86400 ? 'il y a ' + Math.round(s / 3600) + ' h' : new Date(t).toLocaleDateString('fr-FR') }

let space = null, lib = null, relay = null
let tab = 'all', current = null   // current = partition ouverte dans le lecteur

// =====================================================================
//  DÉMARRAGE
//   Accueil : ⚙️ Configurer  ou  🧪 Mode démo
//   Configurer : ✨ partir de rien (créer un collectif)  ou  🔗 un lien qu'on m'a filé
//   -> connexion pCloud -> profil -> le collectif est créé / rejoint tout seul
//   (ou QR code « appareil » montré par mon PC : tout est repris d'un coup)
// =====================================================================
const STEPS = ['Welcome', 'Start', 'Space', 'Folder', 'Profile', 'Device']
function step(name, err) {
  show('setup')
  for (const s of STEPS) $('#step' + s).hidden = s !== name
  setupMsg(err || '')
}
async function boot() {
  if (takeOAuthRedirect()) lsSet('maf:space', 'pcloud')
  const dev = readDeviceLink(location.hash)
  if (dev) { history.replaceState(null, '', location.pathname + location.search); return setupDevice(dev) }
  const inv = readInvite(location.hash)
  if (inv) { lsSet('maf:invite', inv); lsSet('maf:intent', 'link'); setClientId(inv.c); history.replaceState(null, '', location.pathname + location.search) }

  const kind = lsGet('maf:space', '')
  if (!kind && inv) { lsSet('maf:space', 'guest'); return boot() }   // lien d'invitation, sans compte : on consulte tout de suite
  if (!kind) return step('Welcome')
  if (kind === 'guest' && !lsGet('maf:invite', null)) { localStorage.removeItem('maf:space'); return step('Welcome') }
  if (kind === 'pcloud' && !hasPcloud()) return lsGet('maf:intent', '') ? setupSpace() : setupStart()
  try {
    step('', 'Ouverture de ton espace…')
    space = await openSpace(kind)
    if (kind === 'guest') {   // consultation : le collectif et ses membres viennent de l'invitation
      const gi = lsGet('maf:invite', null), id = lsGet('maf:guestId', '') || randomId(); lsSet('maf:guestId', id)
      lib = new Library(space, { ...emptyIndex({ id, name: 'Invité', emoji: '👀', color: '#64748b', instruments: '' }), group: gi.g })
      for (const m of gi.m) lib.learn(m)
      setClientId(gi.c)
      return startMain()
    }
    let index = null, readErr = null
    // mon profil : dans pCloud ; sinon la copie de ce navigateur ; jamais repartir de zéro s'il existe
    try { index = await space.getJson(MINE + '!Moi.json') } catch (e) { readErr = e; console.error('lecture de !Moi.json', e) }
    const local = lsGet('maf:index', null)
    if (!index && local && local.me && local.me.name) { index = local; if (space.kind === 'pcloud') setTimeout(() => lib && lib.save().catch(() => { }), 3000) }
    if (!index && readErr && space.index && space.index[MINE + '!Moi.json']) { const x = new Error('profil illisible (' + (readErr.message || readErr) + '). Recharge la page dans un instant.'); x.code = 'NO_READ'; throw x }
    if (readErr && index) setTimeout(() => toast('⚠️ Profil relu depuis ce navigateur (pCloud : ' + (readErr.message || readErr) + ')', 8000), 1500)
    lib = new Library(space, index || emptyIndex({ id: randomId(), name: '', emoji: '🎵', color: '#3e8ed0', instruments: '' }))
    if (index && lib.forgetMyGhosts()) await lib.save()
    setupMsg('')
  } catch (e) {
    console.error(e)
    if (e.code === 'NO_ROOT') return setupFolder()
    if (e.code === 'NO_READ') return step('', 'Lecture impossible de ton dossier pCloud : ' + e.message)
    if (kind === 'pcloud') forgetPcloud()
    return setupSpace('Connexion impossible : ' + (e.message || e))
  }
  if (!lib.me.name) return setupProfile()
  finishSetup()
}
function setupMsg(m) { const e = $('#setupErr'); e.hidden = !m; e.textContent = m; e.classList.toggle('err', /impossible|erreur|illisible|incorrect/i.test(m)) }
for (const b of $$('[data-back]')) b.onclick = () => {
  if (b.dataset.back === 'welcome') { localStorage.removeItem('maf:intent'); step('Welcome') } else setupStart()
}

// ---- accueil ----
$('#btnSetup').onclick = () => setupStart()
$('#btnResume').onclick = () => { lsSet('maf:intent', 'resume'); setupSpace() }
$('#btnDemo').onclick = () => { lsSet('maf:space', 'demo'); lsSet('maf:intent', 'new'); boot() }

// ---- 1. partir de rien / j'ai un lien ----
function setupStart(pick) {
  step('Start')
  $('#groupName').value = lsGet('maf:groupName', '')
  pickStart(pick || lsGet('maf:intent', ''))
}
function pickStart(k) {
  for (const b of $$('[data-start]')) b.classList.toggle('on', b.dataset.start === k)
  $('#startNew').hidden = k !== 'new'; $('#startLink').hidden = k !== 'link'
  if (k === 'new') $('#groupName').focus()
  if (k === 'link') { paintInvite(); if (!lsGet('maf:invite', null)) $('#inviteIn').focus() }
  $('#btnStartOk').dataset.k = k || ''
  paintStartOk()
}
function paintStartOk() {
  const k = $('#btnStartOk').dataset.k
  if ($('#btnGuest')) $('#btnGuest').hidden = !(k === 'link' && lsGet('maf:invite', null))
  $('#btnStartOk').disabled = !(k === 'new' || (k === 'link' && lsGet('maf:invite', null)))
}
function paintInvite() {
  const inv = lsGet('maf:invite', null), box = $('#joinBox')
  box.hidden = !inv
  if (inv) box.innerHTML = `✅ Invitation pour <b>${esc(inv.g.name)}</b><br><span class="muted">${inv.m.map(m => `${esc(m.emoji || '🎵')} ${esc(m.name)}`).join(', ') || 'personne encore'}</span>`
}
for (const b of $$('[data-start]')) b.onclick = () => pickStart(b.dataset.start)
$('#inviteIn').oninput = () => {
  const v = $('#inviteIn').value.trim()
  const dev = readDeviceLink(v)
  if (dev) return setupDevice(dev)
  const inv = readInvite(v)
  if (inv) { lsSet('maf:invite', inv); setClientId(inv.c) } else localStorage.removeItem('maf:invite')
  setupMsg(v && !inv ? 'Ce lien d’invitation est illisible : copie-le en entier.' : '')
  paintInvite(); paintStartOk()
}
$('#groupName').oninput = () => lsSet('maf:groupName', $('#groupName').value.trim())
async function scanAndUse() {
  const t = await scanQR(); if (!t) return
  const dev = readDeviceLink(t); if (dev) return setupDevice(dev)
  const inv = readInvite(t)
  if (!inv) return setupMsg('Ce QR code n’est ni une invitation ni un QR « appareil ».')
  lsSet('maf:invite', inv); setClientId(inv.c); lsSet('maf:intent', 'link')
  setupStart('link'); $('#inviteIn').value = t; paintInvite(); paintStartOk()
}
$('#btnScan').onclick = scanAndUse
$('#btnScan2').onclick = scanAndUse
if ($('#btnGuest')) $('#btnGuest').onclick = () => { if (!lsGet('maf:invite', null)) return; lsSet('maf:space', 'guest'); boot() }
$('#btnStartOk').onclick = () => {
  const k = $('#btnStartOk').dataset.k
  lsSet('maf:intent', k)
  if (k === 'new') localStorage.removeItem('maf:invite')
  if (lsGet('maf:space', '') === 'pcloud' && hasPcloud()) return boot()
  setupSpace()
}

// ---- 2. pCloud ----
function setupSpace(err) {
  step('Space', err)
  const inv = lsGet('maf:invite', null)
  const intent = lsGet('maf:intent', '')
  $('#intentRecap').innerHTML = intent === 'resume' ? '🔁 On retrouve ta configuration dans ton pCloud : rien à refaire.'
    : intent === 'link' && inv ? `🔗 Tu vas rejoindre <b>${esc(inv.g.name)}</b>`
    : `✨ Tu vas créer <b>${esc(lsGet('maf:groupName', '') || 'ton collectif')}</b>`
  $('#spaceBack').hidden = intent === 'resume'
  // pas d'identifiant (version en ligne, premier membre) : on le demande, avec l'adresse de retour à déclarer chez pCloud
  $('#clientBox').hidden = !!clientId()
  $('#redirectShow').textContent = redirectUri()
  $('#btnPcloud').disabled = !clientId()
}
$('#clientIdIn').oninput = () => { setClientId($('#clientIdIn').value); $('#btnPcloud').disabled = !$('#clientIdIn').value.trim() }
$('#btnPcloud').onclick = () => { lsSet('maf:space', 'pcloud'); location.href = pcloudLoginUrl() }

// ---- choisir son emoji et sa couleur (profil) : aperçu en direct, la couleur devient celle de l'interface ----
const EMOJIS = ['🎻', '🎸', '🎹', '🥁', '🎺', '🎷', '🪕', '🪗', '🎤', '🪈', '🎧', '🎼', '🎵', '🦊', '🐱', '🐸', '🦄', '🐙', '🔥', '😎', '🌈', '⭐', '🍀', '☕']
const COLORS = ['#1aa35a', '#14b8a6', '#3e8ed0', '#7c5cff', '#c026d3', '#ff4fa3', '#e5484d', '#ff8a3d', '#f5c518', '#8c1d2f', '#a16207', '#64748b']
function applyTheme(c) {
  if (!/^#[0-9a-f]{6}$/i.test(c || '')) return
  document.documentElement.style.setProperty('--accent', c)
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = c
}
function mountLook(p) {
  const em = $('#' + p + 'Emoji'), co = $('#' + p + 'Color')
  const paint = () => {
    const pv = $('#' + p + 'Prev'); pv.textContent = em.value || '🎵'; pv.style.setProperty('--c', co.value)
    $('#' + p + 'PrevName').textContent = $('#' + p + 'Name').value.trim() || 'Toi'
    for (const b of $$('#' + p + 'Emojis button')) b.classList.toggle('on', b.dataset.e === em.value)
    for (const b of $$('#' + p + 'Swatches button')) b.classList.toggle('on', b.dataset.c.toLowerCase() === co.value.toLowerCase())
    const cu = $('#' + p + 'Custom'); if (cu) { cu.value = co.value; cu.parentElement.classList.toggle('on', !COLORS.some(c => c.toLowerCase() === co.value.toLowerCase())) }
    applyTheme(co.value)
  }
  $('#' + p + 'Emojis').innerHTML = EMOJIS.map(e => `<button type="button" data-e="${e}">${e}</button>`).join('') +
    `<input id="${p}EmojiOther" class="emoji-other" maxlength="4" placeholder="+" title="Un autre emoji">`
  $('#' + p + 'Swatches').innerHTML = COLORS.map(c => `<button type="button" data-c="${c}" style="--c:${c}" title="${c}"></button>`).join('') +
    `<label class="swatch-custom" title="Une autre couleur"><input type="color" id="${p}Custom"><span>🎨</span></label>`
  for (const b of $$('#' + p + 'Emojis button')) b.onclick = () => { em.value = b.dataset.e; paint() }
  $('#' + p + 'EmojiOther').oninput = e => { const v = e.target.value.trim(); if (v) { em.value = v; paint() } }
  for (const b of $$('#' + p + 'Swatches button')) b.onclick = () => { co.value = b.dataset.c; paint() }
  $('#' + p + 'Custom').oninput = e => { co.value = e.target.value; paint() }
  $('#' + p + 'Name').addEventListener('input', paint)
  return (emoji, color) => { em.value = emoji || '🎻'; co.value = color || COLORS[0]; $('#' + p + 'EmojiOther').value = EMOJIS.includes(em.value) ? '' : em.value; paint() }
}
const setLookP = mountLook('p'), setLookM = mountLook('m')
// fermer le profil sans enregistrer : on revient à sa couleur
$('#meDlg').addEventListener('close', () => lib && applyTheme(lib.me.color))

// ---- consultation -> contribuer ----
function contribute() {
  closeTuto && closeTuto()
  for (const d of document.querySelectorAll('dialog[open]')) d.close()
  if (!$('#viewer').hidden) $('#vBack').click()
  localStorage.removeItem('maf:space'); lsSet('maf:intent', 'link')
  document.body.classList.remove('guest')
  setupSpace()
}
for (const id of ['#btnContribute', '#btnContribute2']) if ($(id)) $(id).onclick = contribute

// ---- 3. le dossier Partoche (déjà partagé par lien) ----
let folderPick = null
async function setupFolder() {
  // déjà configuré ailleurs ? Friends/!Moi.json contient tout : on reprend sans rien redemander
  step('Folder', 'Recherche d’une configuration existante dans ton pCloud…')
  try {
    const ex = await findExisting()
    if (ex && ex.locked) {
      // config trouvée, mais lisible seulement avec le mot de passe du lien : on présélectionne le dossier
      await listFolders(ex.folder)
      return setupMsg('🔁 Configuration trouvée dans « ' + ex.folder.name + ' » : tape le mot de passe de son lien (ou colle le code Partoche) pour la reprendre.')
    }
    if (ex) {
      const pw = ex.index.me.pw || '', c = await checkLink(ex.folder.link, pw)
      if (c.ok) {
        setMyRoot({ ...ex.folder, link: c.link, pw })
        lsSet('maf:index', ex.index)
        if (ex.index.group) lsSet('maf:intent', 'resume')
        toast(`👋 Re-bonjour ${ex.index.me.name} : configuration retrouvée dans « ${ex.folder.name} »`, 4000)
        return boot()
      }
      setupMsg('Configuration retrouvée dans « ' + ex.folder.name + ' », mais le mot de passe du lien a changé : choisis le dossier et tape le nouveau.')
    }
  } catch (e) { console.warn(e) }
  await listFolders()
}
async function listFolders(pick) {
  step('Folder', 'Recherche de tes dossiers partagés…')
  let list = []
  try { list = await sharedFolders() } catch (e) { setupMsg('Lecture impossible de tes liens pCloud : ' + e.message); return }
  setupMsg(list.length ? '' : 'Aucun dossier partagé par lien dans ton pCloud : crée-en un ci-dessous.')
  $('#folderList').innerHTML = list.map((f, i) => `<button class="choice" data-f="${i}"><b>📁 ${esc(f.name)}</b><span>${esc(f.link)}</span></button>`).join('')
  for (const b of $$('#folderList [data-f]')) b.onclick = () => {
    folderPick = list[+b.dataset.f]
    $$('#folderList [data-f]').forEach(x => x.classList.toggle('on', x === b))
    $('#btnFolderOk').disabled = false; $('#folderPw').focus()
  }
  const pi = pick ? list.findIndex(f => f.folderid === pick.folderid) : list.length === 1 ? 0 : -1
  if (pi >= 0) $$('#folderList [data-f]')[pi].click()
}
async function useFolder(f, pw) {
  setupMsg('Vérification du lien…')
  const c = await checkLink(f.link, pw)
  if (!c.ok) return setupMsg('Lien impossible à ouvrir : ' + c.error + '. (' + f.link + ')')
  setMyRoot({ ...f, link: c.link, pw })
  setupMsg(''); boot()
}
// Le code d'invitation Partoche (« P1.… » ou le lien …/Partoche/#P1.…, envoyé à la prof) contient
// le lien de partage (l) et son mot de passe (p) : on l'accepte à la place du mot de passe.
function partocheCode(txt) {
  const m = String(txt || '').match(/P1\.([A-Za-z0-9_-]+)/); if (!m) return null
  try {
    const b = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))
    const o = JSON.parse(new TextDecoder().decode(Uint8Array.from(b, c => c.charCodeAt(0))))
    return o && o.l ? { link: o.l, pw: o.p || '' } : null
  } catch { return null }
}
$('#btnFolderOk').onclick = () => {
  if (!folderPick) return
  const v = $('#folderPw').value.trim(), pc = partocheCode(v)
  if (!pc) return useFolder(folderPick, v)
  const code = s => (String(s).match(/code=([A-Za-z0-9]+)/) || [])[1]
  if (code(pc.link) !== code(folderPick.link)) return setupMsg('Ce code Partoche concerne un autre lien que le dossier choisi : choisis le bon dossier dans la liste.')
  useFolder(folderPick, pc.pw)
}
$('#folderPw').oninput = () => {
  const pc = partocheCode($('#folderPw').value)
  $('#folderPwHint').hidden = !pc
}
$('#folderPw').onkeydown = e => { if (e.key === 'Enter') $('#btnFolderOk').click() }
$('#btnFolderNew').onclick = async () => {
  try { setupMsg('Création du dossier Partoche…'); useFolder(await createShared('Partoche'), '') }
  catch (e) { setupMsg('Création impossible : ' + e.message) }
}

// ---- 4. profil ----
function setupProfile() {
  step('Profile')
  $('#profileTitle').textContent = space.kind === 'demo' ? 'Comment tu t’appelles ?' : '3. Comment les autres te voient'
  $('#pName').value = lib.me.name || ''; $('#pInstr').value = lib.me.instruments || ''
  setLookP(lib.me.emoji && lib.me.emoji !== '🎵' ? lib.me.emoji : '🎻', lib.me.color && lib.me.color !== '#3e8ed0' ? lib.me.color : COLORS[0])
  $('#pName').focus()
}
$('#btnProfileOk').onclick = async () => {
  const name = $('#pName').value.trim()
  if (!name) return $('#pName').focus()
  Object.assign(lib.me, { name, emoji: $('#pEmoji').value.trim() || '🎵', color: $('#pColor').value, instruments: $('#pInstr').value.trim() })
  await lib.save()
  finishSetup()
}

// ---- appareil de plus (QR code montré par mon PC) : code à 6 chiffres, puis tout est repris ----
let pendingDevice = null
function setupDevice(dev) {
  pendingDevice = dev
  step('Device')
  $('#devPin').value = ''; $('#devPin').focus()
}
$('#btnDevOk').onclick = async () => {
  const pin = $('#devPin').value.replace(/\D/g, '')
  if (pin.length !== 6) return setupMsg('Le code fait 6 chiffres.')
  const d = await openDeviceLink(pendingDevice, pin)
  if (!d) return setupMsg('Code incorrect (ou QR code expiré : régénère-le sur l’autre appareil).')
  // format compact (t, h, f, n, k, p) ou ancien format { pcloud }
  const pc = d.pcloud || { token: d.t, api: d.h === 'e' ? 'https://eapi.pcloud.com' : 'https://api.pcloud.com',
    root: d.f ? { folderid: d.f, name: d.n, link: `https://${d.h}.pcloud.link/publink/show?code=${d.k}`, pw: d.p || '' } : null }
  adoptPcloud(pc); setClientId(d.c)
  if (d.index) lsSet('maf:index', d.index)
  lsSet('maf:space', 'pcloud')
  for (const k of ['maf:invite', 'maf:intent']) localStorage.removeItem(k)
  boot()
}
$('#devPin').onkeydown = e => { if (e.key === 'Enter') $('#btnDevOk').click() }

// ---- puis on crée / rejoint le collectif choisi au début ----
async function finishSetup() {
  const inv = lsGet('maf:invite', null), intent = lsGet('maf:intent', '')
  // dossier déjà relié à ce collectif (autre appareil, retour sur la page) : on reprend tel quel
  if (lib.index.group && (!inv || inv.g.id === lib.index.group.id)) {
    if (inv) { for (const m of inv.m) lib.learn(m); await lib.save() }
    for (const k of ['maf:invite', 'maf:intent', 'maf:groupName']) localStorage.removeItem(k)
    return startMain()
  }
  if (lib.index.group && inv && !confirm(`Ton dossier est déjà relié à « ${lib.index.group.name} ». Le remplacer par « ${inv.g.name} » ?`)) {
    localStorage.removeItem('maf:invite'); return startMain()
  }
  if (inv) return join(inv)
  if (intent === 'resume') { localStorage.removeItem('maf:intent'); toast('Pas de collectif trouvé dans ton pCloud : choisis comment commencer.', 5000) }
  if (intent === 'new' || space.kind === 'demo') return join({ g: { ...newGroup(lsGet('maf:groupName', '') || (space.kind === 'demo' ? 'Collectif démo' : '')), admin: lib.me.id }, m: [] })
  setupStart()
}
async function join(inv) {
  step('', 'Préparation de ton lien de partage…')
  try {
    lib.index.group = inv.g
    for (const m of inv.m) lib.learn(m)
    await publishMyLink()
    await lib.save()
    for (const k of ['maf:invite', 'maf:intent', 'maf:groupName']) localStorage.removeItem(k)
    setupMsg('')
    startMain(true)
  } catch (e) { console.error(e); setupMsg('Erreur : ' + (e.message || e)) }
}
async function publishMyLink() {
  if (space.kind !== 'pcloud') return
  const { link, pw } = await space.shareLink()
  lib.me.link = link; lib.me.pw = pw
}

// =====================================================================
//  BIBLIOTHÈQUE
// =====================================================================
const GUEST = () => space && space.kind === 'guest'
async function startMain(justJoined) {
  show('main'); applyTheme(lib.me.color)
  document.body.classList.toggle('guest', GUEST())
  $('#guestBar').hidden = !GUEST()
  $('#groupTitle').textContent = lib.index.group.name
  $('#spaceInfo').textContent = space.kind === 'demo' ? 'mode démo · rien n’est partagé' : GUEST() ? '👀 consultation · sans compte' : `pCloud · dossier « ${(space.root || {}).name || ''} »`
  if (space.kind === 'pcloud' && !lib.me.link) { try { await publishMyLink(); await lib.save() } catch (e) { toast('Lien de partage impossible : ' + e.message, 6000) } }
  if (!GUEST() && !lib.index.group.admin && !lib.index.knows.length) { lib.index.group.admin = lib.me.id; lib.save().catch(() => { }) }
  renderAll()
  relay = new Relay(lib.index.group, () => lib.me, onRelay)
  relay.readOnly = GUEST()   // en consultation : on écoute (présence, mises à jour), on ne s'annonce pas
  if (space.kind === 'pcloud' || GUEST()) relay.start()
  await refresh(true)
  if (justJoined && lib.index.knows.length) relay.send({ ev: 'index' })
  if (justJoined && !lib.index.knows.length && space.kind === 'pcloud') setTimeout(() => $('#btnInvite').click(), 600)
}
async function refresh(force) {
  $('#btnRefresh').classList.add('spin')
  try { await lib.refresh(force) } catch (e) { console.warn(e) }
  // tags de Partoche (À faire / En cours / Maîtrisé) -> mon statut, partagé avec le groupe
  try { if (await lib.importPartocheTags()) relay && relay.send({ ev: 'index' }) } catch (e) { console.warn('tags Partoche', e) }
  $('#btnRefresh').classList.remove('spin')
  renderAll()
  // titres / compositeurs lus dans mes partitions, puis artistes manquants devinés : en arrière-plan
  let t = 0
  const later = () => { clearTimeout(t); t = setTimeout(() => { if (!$('#stMenu')) renderList() }, 1200) }
  lib.readMyTitles(later).then(n => { if (n) relay && relay.send({ ev: 'index' }) }).catch(e => console.warn('titres', e))
    .then(() => lib.guessMissing(later))
    .then(() => relay && relay.send({ ev: 'index' })).catch(e => console.warn('artistes', e))
}
$('#btnRefresh').onclick = async () => {
  await refresh(true)
  const mine = lib.scores().filter(s => s.mine).length, rows = lib.pieces().length, dup = (lib.dupes || []).filter(s => s.mine)
  const pl = (n, w) => n + ' ' + w + (n > 1 ? 's' : '')
  toast(`⟳ Actualisé : ${pl(rows, 'ligne')} dans le tableau · ${pl(mine, 'fichier')} chez toi` +
    (dup.length ? ` · ${dup.length} en double (même fichier) : ${dup.slice(0, 2).map(s => s.name).join(', ')}` : ''), dup.length ? 7000 : 3500)
}
setInterval(() => { if (!document.hidden && !$('#main').hidden) refresh(false) }, 60000)

// ---- relais : quelqu'un est arrivé / a changé quelque chose ----
async function onRelay(o, replay) {
  const fresh = lib.learn(o.from)
  if (fresh) { await lib.save(); if (!replay) toast(`${o.from.emoji || '🎵'} ${o.from.name} a rejoint le collectif`) }
  if (fresh || o.ev === 'index') { const p = lib.peer(o.from.id); if (p) await p.load(true); renderAll(); if ($('#pieceDlg').open) renderPiece() }
  if (o.ev === 'ink' && current && o.score === current.id) loadLayers(o.from.id)
  if (o.ev === 'index' && current) renderChat()
  if (!replay && o.ev === 'hello' && current) paintLayers()
  paintDots()
}

const avatar = (m, cls = '') => `<span class="avatar ${cls} ${relay && m.id !== lib.me.id && relay.isOnline(m.id) ? 'online' : ''}" style="--c:${esc(m.color || '#888')}" title="${esc(m.name)}">${esc(m.emoji || '🎵')}</span>`
const chip = (m, txt) => `<span class="chip" style="--c:${esc(m.color || '#888')}">${esc(m.emoji || '🎵')} ${esc(txt ?? m.name)}</span>`

function paintDots() {
  $('#memberDots').innerHTML = (GUEST() ? lib.index.knows : lib.members()).map(m => avatar(m)).join('')
  const sel = $('#filterMember'), v = sel.value
  sel.innerHTML = '<option value="">Tout le monde</option>' + lib.members().map(m => `<option value="${esc(m.id)}">${esc(m.emoji || '')} ${esc(m.name)}</option>`).join('')
  sel.value = v
}
function renderAll() { detectNew(); paintDots(); renderList() }

// ---- nouvelles partitions : petite fenêtre « 🎁 trouvée », tag NEW qui clignote jusqu'à l'ouverture ----
let newIds = new Set(lsGet('maf:new', []))
function detectNew() {
  if (!lib) return
  const scores = lib.scores(), ids = scores.map(s => s.id)
  const seen = lsGet('maf:seen', null)
  if (!seen) { lsSet('maf:seen', ids); return }   // 1re fois : tout est connu, rien de « nouveau »
  const known = new Set(seen), fresh = scores.filter(s => !known.has(s.id))
  if (!fresh.length) return
  for (const s of fresh) newIds.add(s.id)
  lsSet('maf:new', [...newIds]); lsSet('maf:seen', [...known, ...fresh.map(s => s.id)])
  newPop(fresh)
}
function newPop(list) {
  const old = $('#newPop'); if (old) old.remove()
  const d = document.createElement('div'); d.id = 'newPop'; d.className = 'newpop'
  const shown = list.slice(0, 3)
  d.innerHTML = `<b>🎁 ${list.length > 1 ? list.length + ' nouvelles partitions trouvées' : 'Nouvelle partition trouvée'}</b>` +
    shown.map(s => `<div>${esc(s.title)} <span class="muted">· ${s.mine ? 'chez toi' : 'chez ' + esc(s.owner.name)}</span></div>`).join('') +
    (list.length > 3 ? `<div class="muted">… et ${list.length - 3} autre${list.length - 3 > 1 ? 's' : ''}</div>` : '')
  d.onclick = () => d.remove()
  document.body.appendChild(d)
  setTimeout(() => d.classList.add('out'), 6000); setTimeout(() => d.remove(), 6600)
}
function markSeen(p) {
  let ch = false
  for (const v of p.versions) if (newIds.delete(v.id)) ch = true
  if (ch) { lsSet('maf:new', [...newIds]); renderList() }
}

for (const b of $$('.tabs [data-tab]')) b.onclick = () => { tab = b.dataset.tab; $$('.tabs [data-tab]').forEach(x => x.classList.toggle('on', x === b)); renderList() }
$('#search').oninput = () => renderList()
$('#filterMember').onchange = () => renderList()
if ($('#filterStatus')) $('#filterStatus').onchange = () => renderList()

// =====================================================================
//  LE TABLEAU : ▶ aperçu · Titre · Artiste · une colonne par personne · 👥 · 💬
//  tri en cliquant sur un en-tête, filtres, menu de statut sur ma case
// =====================================================================
const RANK = { pret: 3, encours: 2, envie: 1 }
let sortBy = lsGet('maf:sort', { k: 'title', d: 1 })
function renderList() {
  const L = $('#list')
  L.classList.remove('as-table')
  if (tab === 'members') return renderMembers()
  // garder la position de défilement (le tableau ne « remonte » plus après un changement)
  const oldWrap = $('#list .tbl-wrap'), keep = oldWrap ? { t: oldWrap.scrollTop, l: oldWrap.scrollLeft } : null
  const val = s => { const e = $(s); return e ? e.value : '' }   // page et script d'âges différents (cache) : pas de plantage
  const q = normTitle(val('#search')), who = val('#filterMember'), fst = val('#filterStatus')
  const mem = GUEST() ? lib.index.knows.slice() : lib.members()
  let pieces = lib.pieces()
  for (const p of pieces) { p.cnt = p.work.filter(w => w.status).length; p.mineW = p.work.find(w => w.member.id === lib.me.id) || null }
  if (q) pieces = pieces.filter(p => normTitle(p.title + ' ' + p.artist + ' ' + p.versions.map(v => v.composer).join(' ')).includes(q))
  if (who) pieces = pieces.filter(p => p.versions.some(v => v.owner.id === who) || p.work.some(w => w.member.id === who))
  if (tab === 'work' || fst === 'any') pieces = pieces.filter(p => p.cnt)
  if (fst === 'mine') pieces = pieces.filter(p => p.mineW && p.mineW.status)
  if (fst === 'free') pieces = pieces.filter(p => !p.cnt)
  if (fst === 'unset') pieces = pieces.filter(p => !(p.mineW && p.mineW.status))
  if (fst && RANK[fst]) pieces = pieces.filter(p => p.work.some(w => w.status === fst))
  // tri
  const d = sortBy.d || 1, txt = (x, y) => (x || '').localeCompare(y || '', 'fr', { sensitivity: 'base' })
  const mRank = (p, id) => { const w = p.work.find(x => x.member.id === id); return (w && RANK[w.status] || 0) + (p.versions.some(v => v.owner.id === id) ? 0.5 : 0) }
  pieces.sort((x, y) => {
    if (sortBy.k === 'artist') {   // sans artiste : toujours à la fin
      if (!x.artist !== !y.artist) return x.artist ? -1 : 1
      return (txt(x.artist, y.artist) || txt(x.title, y.title)) * d
    }
    let r = 0
    if (sortBy.k === 'title') r = txt(x.title, y.title)
    else if (sortBy.k === 'cnt') r = x.cnt - y.cnt
    else if (sortBy.k === 'com') r = x.comments.length - y.comments.length
    else if (sortBy.k.startsWith('m:')) r = mRank(x, sortBy.k.slice(2)) - mRank(y, sortBy.k.slice(2))
    return r * d || txt(x.title, y.title)
  })
  if (!pieces.length) {
    const why = [val('#search') && `la recherche « ${esc(val('#search'))} »`, who && 'le filtre par personne', fst && 'le filtre de statut', tab === 'work' && 'l’onglet Chantiers'].filter(Boolean)
    L.innerHTML = why.length
      ? `<div class="empty">Aucun morceau ne correspond à ${why.join(', ')}.<br><button id="btnShowAll" class="primary" style="margin-top:10px">Tout réafficher</button></div>`
      : GUEST() ? '<div class="empty">Aucune partition visible pour l’instant.<br>Clique sur <b>⟳</b> dans un instant ; si ça reste vide, les dossiers des membres sont peut-être injoignables (👥 Membres).</div>'
      : '<div class="empty">Aucune partition pour l’instant.<br>Ajoute les tiennes avec <b>＋ Partition</b>, invite tes amis avec <b>🤝 Inviter</b>.</div>'
    if ($('#btnShowAll')) $('#btnShowAll').onclick = clearFilters
    return
  }
  const cell = (p, m) => {
    const w = p.work.find(x => x.member.id === m.id) || {}, st = STATUS[w.status]
    const has = p.versions.some(v => v.owner.id === m.id) ? '<span class="has" title="a la partition dans son dossier">📄</span>' : ''
    const inner = (st ? `<span class="st" title="${esc(st.label)}${w.src === 'partoche' ? ' (tag Partoche)' : ''}">${st.icon}</span>` : '') + has + (w.part ? `<small>${esc(w.part)}</small>` : '')
    return inner || '<span class="none">·</span>'
  }
  const arrow = k => sortBy.k === k ? `<i class="sort">${sortBy.d > 0 ? '▲' : '▼'}</i>` : ''
  const pv = previewing()
  L.classList.add('as-table')
  const active = [val('#search') && `« ${esc(val('#search'))} »`, who && ('👤 ' + esc((lib.member(who) || {}).name || '')), fst && esc(($('#filterStatus').selectedOptions[0] || {}).textContent || '')].filter(Boolean)
  L.innerHTML = (active.length ? `<div class="filterbar">🔎 Filtré : ${active.join(' · ')} — ${pieces.length} morceau${pieces.length > 1 ? 'x' : ''} <button id="btnClearFilters">✕ Tout réafficher</button></div>` : '') + `<div class="tbl-wrap"><table class="tbl">
    <thead><tr>
      <th class="c-pv"></th>
      <th class="c-title sortable" data-k="title">Titre ${arrow('title')}</th>
      <th class="c-art sortable" data-k="artist">Artiste ${arrow('artist')}</th>
      ${mem.map(m => `<th class="c-mem sortable" data-k="m:${esc(m.id)}" style="--c:${esc(m.color || '#888')}">${avatar(m)}<span>${esc(m.id === lib.me.id ? 'Moi' : m.name)} ${arrow('m:' + m.id)}</span></th>`).join('')}
      <th class="c-cnt sortable" data-k="cnt" title="Nombre de personnes sur le morceau">👥 ${arrow('cnt')}</th>
      <th class="c-com sortable" data-k="com" title="Messages">💬 ${arrow('com')}</th>
    </tr></thead>
    <tbody>${pieces.map((p, i) => {
      const last = p.comments[p.comments.length - 1], v0 = p.versions[0]
      return `<tr data-i="${i}">
        <td class="c-pv"><button class="pvb${pv === v0.id ? ' playing' : ''}" data-pv="${esc(v0.id)}" title="Aperçu 30 s">${pv === v0.id ? '⏸' : '▶'}</button></td>
        <th class="c-title"><b>${esc(p.title)}</b>${p.versions.some(v => newIds.has(v.id)) ? ' <span class="newtag">NEW</span>' : ''}</th>
        <td class="c-art">${p.artist ? `<span class="art" data-art="${esc(p.artist)}" title="${p.guessed ? 'Deviné d’après le titre : ouvre la fiche pour corriger' : ''}">${esc(p.artist)}${p.guessed ? ' <i>🔮</i>' : ''}</span>` : '<span class="none">?</span>'}</td>
        ${mem.map(m => `<td class="c-mem${m.id === lib.me.id ? ' mine' : ''}" style="--c:${esc(m.color || '#888')}"${m.id === lib.me.id ? ' title="Clique pour choisir ton statut"' : ''}>${cell(p, m)}</td>`).join('')}
        <td class="c-cnt">${p.cnt || ''}</td>
        <td class="c-com" title="${last ? esc(last.member.name + ' : ' + last.text) : ''}">${p.comments.length || ''}</td>
      </tr>`
    }).join('')}</tbody></table></div>
    <p class="legend">${pieces.length} morceau${pieces.length > 1 ? 'x' : ''} · 💡 envie · 🛠️ je bosse dessus · ✅ prêt · 📄 a la partition · 🔮 artiste deviné · clique un en-tête pour trier, ta case pour ton statut, une ligne pour la fiche</p>`
  if (keep) { const w = $('#list .tbl-wrap'); w.scrollTop = keep.t; w.scrollLeft = keep.l }
  if ($('#btnClearFilters')) $('#btnClearFilters').onclick = clearFilters
  for (const th of $$('#list th.sortable')) th.onclick = () => {
    sortBy = sortBy.k === th.dataset.k ? { k: th.dataset.k, d: -sortBy.d } : { k: th.dataset.k, d: th.dataset.k === 'cnt' || th.dataset.k === 'com' || th.dataset.k.startsWith('m:') ? -1 : 1 }
    lsSet('maf:sort', sortBy); renderList()
  }
  for (const tr of $$('#list tbody tr')) tr.onclick = e => {
    const p = pieces[+tr.dataset.i]
    const pvb = e.target.closest('.pvb'); if (pvb) return playPreview(p, pvb)
    const mine = e.target.closest('td.mine'); if (mine) return statusMenu(p, mine)
    openPiece(p)
  }
}

function clearFilters() {
  $('#search').value = ''; if ($('#filterMember')) $('#filterMember').value = ''; if ($('#filterStatus')) $('#filterStatus').value = ''
  if (tab === 'work') $('.tabs [data-tab=all]').click(); else renderList()
}

// ---- menu de statut sur ma case : un clic, je choisis ----
function statusMenu(p, td) {
  closeStatusMenu()
  if (GUEST()) return toast('👀 Mode consultation : connecte ton pCloud (☁️ Contribuer) pour indiquer ce que tu bosses.')
  const w = p.mineW || {}
  const m = document.createElement('div'); m.id = 'stMenu'; m.className = 'stmenu'
  m.innerHTML = `<div class="stm-title">${esc(p.title)}</div>
    ${[['', '—', 'Rien'], ...Object.entries(STATUS).map(([k, s]) => [k, s.icon, s.label])].map(([k, i, l]) => `<button data-st="${k}" class="${(w.status || '') === k ? 'on' : ''}"><span>${i}</span>${esc(l)}</button>`).join('')}
    <label>Ma partie <input id="stmPart" value="${esc(w.part || '')}" placeholder="ex. Basse, Violon 1…"></label>
    <button class="stm-open">Ouvrir la fiche →</button>`
  document.body.appendChild(m)
  const r = td.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight
  m.style.left = Math.max(8, Math.min(innerWidth - mw - 8, r.left + r.width / 2 - mw / 2)) + 'px'
  m.style.top = (r.bottom + mh + 8 > innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6) + 'px'
  const save = async patch => {
    await lib.setWork((w.score) || p.versions[0].id, { status: w.status || '', part: w.part || '', ...patch })
    relay && relay.send({ ev: 'index' }); renderList()
  }
  for (const b of m.querySelectorAll('[data-st]')) b.onclick = async () => { closeStatusMenu(); await save({ status: b.dataset.st, part: $('#stmPart') ? $('#stmPart').value.trim() : (w.part || '') }) }
  const part = m.querySelector('#stmPart')
  part.onkeydown = async e => { if (e.key === 'Enter') { const v = part.value.trim(); closeStatusMenu(); await save({ part: v }) } if (e.key === 'Escape') closeStatusMenu() }
  m.querySelector('.stm-open').onclick = () => { closeStatusMenu(); openPiece(p) }
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0)
}
function outside(e) { const m = $('#stMenu'); if (m && !m.contains(e.target)) closeStatusMenu() }
function closeStatusMenu() { const m = $('#stMenu'); if (m) m.remove(); document.removeEventListener('pointerdown', outside, true) }

// ---- aperçu 30 s ----
function playPreview(p, btn) {
  const v = p.versions[0]
  togglePreview(v.id, v.name, () => lib.bytes(v), (state, pr, st) => {
    const b = $(`#list [data-pv="${CSS.escape(v.id)}"]`) || btn
    b.classList.toggle('loading', state === 'loading'); b.classList.toggle('playing', state === 'playing')
    b.textContent = state === 'playing' ? '⏸' : state === 'loading' ? '…' : '▶'
    b.style.setProperty('--p', pr || 0)
    if (state === 'playing' && pr === 0 && st) toast(`♪ ${p.title} — ${st.how}`, 2500)
  }).catch(() => toast('Aperçu impossible pour cette partition'))
}

function renderMembers() {
  // collectif créé avant les admins, avec déjà plusieurs membres : son créateur se déclare (le premier gagne)
  const claim = !lib.adminId() && !GUEST() ? `<article class="card member-card"><div>👑 Ce collectif n'a pas encore d'admin.</div><div class="muted">C'est toi qui l'as créé ? Déclare-toi admin : tu pourras retirer des membres.</div><div><button class="small primary" id="btnClaimAdmin">👑 Je suis le créateur, devenir admin</button></div></article>` : ''
  const counts = new Map(); for (const s of lib.scores()) counts.set(s.owner.id, (counts.get(s.owner.id) || 0) + 1)
  $('#list').innerHTML = lib.members().map(m => {
    const p = m.id === lib.me.id ? null : lib.peers.get(m.id)
    const idx = m.id === lib.me.id ? lib.index : p && p.index
    const st = m.id === lib.me.id ? 'c’est toi' : p && p.error ? '⚠️ dossier injoignable : ' + p.error : relay && relay.isOnline(m.id) ? '🟢 en ligne' : idx && idx.updated ? 'actif ' + ago(idx.updated) : '…'
    return `<article class="card member-card"><div class="head">${avatar(m)}<div><b>${esc(m.name)}</b><div class="muted">${esc((idx && idx.me && idx.me.instruments) || m.instruments || '')}</div></div></div>
      <div class="meta">📄 ${counts.get(m.id) || 0} partition(s) · ${esc(st)}</div>
      ${m.id === lib.adminId() ? '<div class="muted">👑 admin du collectif</div>' : ''}
      ${m.id === lib.me.id || !lib.isAdmin() ? '' : `<div><button class="danger small" data-kick="${esc(m.id)}">🚪 Retirer du collectif</button></div>`}</article>`
  }).join('') + claim
  if ($('#btnClaimAdmin')) $('#btnClaimAdmin').onclick = async () => {
    if (!confirm('Tu confirmes que c’est toi qui as créé « ' + lib.index.group.name + ' » ?')) return
    lib.index.group.admin = lib.me.id; await lib.save(); relay && relay.send({ ev: 'index' }); renderAll()
  }
  for (const b of $$('#list [data-kick]')) b.onclick = async () => {
    const m = lib.member(b.dataset.kick); if (!m) return
    if (!confirm(`Retirer ${m.name} du collectif ?

Ses partitions et ses notes disparaissent chez tout le monde, et il ne sera plus réajouté.
(Il garde ce qu'il a déjà pu lire. Pour lui couper vraiment l'accès à ton dossier, change aussi le mot de passe de ton lien pCloud.)`)) return
    await lib.remove(m.id); relay && relay.send({ ev: 'index' })
    toast(m.name + ' a été retiré du collectif'); renderAll()
  }
}

// ---- ajouter des partitions ----
$('#btnAdd').onclick = () => $('#fileIn').click()
$('#fileIn').onchange = async () => {
  const files = [...$('#fileIn').files]; $('#fileIn').value = ''
  for (const f of files) {
    toast('Envoi de « ' + f.name + ' » dans ton ' + (space.kind === 'demo' ? 'espace démo' : 'pCloud') + '…', 20000)
    try {
      const info = scoreInfo(new Uint8Array(await f.arrayBuffer()), f.name)
      await lib.addScore(f, info)
    } catch (e) { console.error(e); toast('Échec : ' + (e.message || e), 6000); return }
  }
  toast(files.length > 1 ? files.length + ' partitions ajoutées' : 'Partition ajoutée')
  relay && relay.send({ ev: 'index' })
  renderAll(); if ($('#pieceDlg').open) { piece = lib.pieces().find(p => p.key === piece.key) || piece; renderPiece() }
}

// =====================================================================
//  FICHE D'UN MORCEAU : versions, qui bosse dessus, discussion
// =====================================================================
let piece = null
const rootOf = p => p.versions[0]
function openPiece(p) { piece = p; markSeen(p); renderPiece(); if (!$('#pieceDlg').open) $('#pieceDlg').showModal() }
$('#pdStatus').innerHTML = '<option value="">—</option>' + Object.entries(STATUS).map(([k, s]) => `<option value="${k}">${s.icon} ${s.label}</option>`).join('')

function renderPiece() {
  const ids = new Set(piece.versions.map(v => v.id))
  piece = lib.pieces().find(p => p.key === piece.key) || lib.pieces().find(p => p.versions.some(v => ids.has(v.id))) || piece
  $('#pdTitle').textContent = piece.title
  // titre / artiste : corrigeables (le titre seulement si la partition est chez moi)
  const hasIt = piece.versions.some(v => v.mine)
  $('#pdTitleIn').value = piece.title; $('#pdTitleIn').disabled = !hasIt; $('#pdTitleIn').title = hasIt ? '' : 'Seul celui qui a la partition peut changer le titre'
  $('#pdArtistIn').value = piece.artist || ''
  $('#pdGuess').textContent = piece.guessed ? '🔮 deviné, à vérifier' : ''
  $('#pdMetaSave').hidden = true
  $('#pdVersions').innerHTML = piece.versions.map((v, i) => `<div class="version">${avatar(v.owner)}
      <div class="grow"><b>Chez ${esc(v.owner.name)}</b><div class="muted">${esc(v.name)}${v.size ? ' · ' + Math.round(v.size / 1024) + ' Ko' : ''}</div></div>
      <button data-open="${i}" class="primary">Ouvrir</button><button data-dl="${i}" title="Télécharger">⬇</button>${v.mine ? `<button data-rm="${i}" title="Retirer">🗑</button>` : piece.versions.some(x => x.mine) ? '' : `<button data-cp="${i}" title="Copier dans mon dossier MSCZ">📥 Copier chez moi</button>`}</div>`).join('') +
''
  for (const b of $$('#pdVersions [data-open]')) b.onclick = () => { $('#pieceDlg').close(); openViewer(piece.versions[+b.dataset.open]) }
  for (const b of $$('#pdVersions [data-dl]')) b.onclick = () => download(piece.versions[+b.dataset.dl])
  // copier la partition d'un pote dans mon MSCZ/ : elle devient aussi la mienne (et suit dans tous mes collectifs)
  for (const b of $$('#pdVersions [data-cp]')) b.onclick = async () => {
    const v = piece.versions[+b.dataset.cp]
    b.disabled = true; b.textContent = 'Copie…'
    try {
      const bytes = await lib.bytes(v)
      await lib.addScore(new File([bytes], v.name), { title: v.title, composer: v.composer })
      relay && relay.send({ ev: 'index' }); toast('📥 « ' + v.title + ' » copiée dans ton dossier MSCZ'); renderAll(); renderPiece()
    } catch (e) { toast('Copie impossible : ' + (e.message || e), 6000); b.disabled = false; b.textContent = '📥 Copier chez moi' }
  }
  for (const b of $$('#pdVersions [data-rm]')) b.onclick = async () => {
    const v = piece.versions[+b.dataset.rm]
    if (!confirm('Retirer « ' + v.name + ' » de ton dossier ?')) return
    await lib.removeScore(v); relay && relay.send({ ev: 'index' }); renderAll()
    if (piece.versions.length > 1) renderPiece(); else $('#pieceDlg').close()
  }

  const w = piece.work
  $('#pdWork').innerHTML = w.length ? w.map(x => `<div>${chip(x.member)} ${x.status ? STATUS[x.status].icon + ' ' + STATUS[x.status].label : ''}${x.part ? ' · <b>' + esc(x.part) + '</b>' : ''} <span class="muted">${ago(x.at || 0)}</span></div>`).join('') : '<span class="muted">Personne pour l’instant.</span>'
  const mine = w.find(x => x.member.id === lib.me.id) || {}
  $('#pdStatus').value = mine.status || ''; $('#pdPart').value = mine.part || ''
  $('#pdParts').innerHTML = (piece.parts || []).map(n => `<option value="${esc(n)}">`).join('')
  if (!piece.parts) lib.bytes(rootOf(piece)).then(b => { piece.parts = scoreInfo(b, rootOf(piece).name).parts; $('#pdParts').innerHTML = piece.parts.map(n => `<option value="${esc(n)}">`).join('') }).catch(() => { })

}
// mon statut / ma partie sont publiés sur la version d'origine (le fil du morceau)
async function saveMyWork() {
  const id = (piece.work.find(x => x.member.id === lib.me.id) || {}).score || rootOf(piece).id
  await lib.setWork(id, { status: $('#pdStatus').value, part: $('#pdPart').value.trim() })
  relay && relay.send({ ev: 'index' }); renderAll(); renderPiece()
}
for (const id of ['#pdTitleIn', '#pdArtistIn']) $(id).oninput = () => { $('#pdMetaSave').hidden = false }
$('#pdMetaSave').onclick = async () => {
  const t = $('#pdTitleIn').value.trim(), a = $('#pdArtistIn').value.trim()
  if (!$('#pdTitleIn').disabled && t && t !== piece.title) await lib.setTitle(piece, t)
  if (a !== (piece.artist || '') || piece.guessed) await lib.setArtist({ ...piece, title: t || piece.title }, a)
  relay && relay.send({ ev: 'index' }); toast('Enregistré'); renderAll(); renderPiece()
}
$('#pdStatus').onchange = saveMyWork
$('#pdPart').onchange = saveMyWork

async function download(v) {
  try {
    const b = await lib.bytes(v)
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([b])); a.download = v.name; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  } catch (e) { toast('Téléchargement impossible : ' + e.message, 5000) }
}

// =====================================================================
//  INVITER / PROFIL
// =====================================================================
function qr(el, text) {
  const q = window.qrcode(0, 'L'); q.addData(text); q.make()
  // marge blanche de 4 modules autour (obligatoire pour les lecteurs de QR code)
  el.innerHTML = q.createSvgTag({ cellSize: 4, margin: 16, scalable: true })
}
$('#btnInvite').onclick = () => {
  const demo = space.kind === 'demo'
  const url = demo ? '' : inviteUrl(lib.index.group, lib.members(), clientId())
  $('#inviteOut').value = demo ? 'En mode démo, rien n’est partagé : connecte ton pCloud pour inviter des potes.' : url
  $('#inviteQr').parentElement.hidden = demo
  if (!demo) qr($('#inviteQr'), url)
  $('#inviteDlg').showModal()
}
$('#btnDevice').onclick = async () => {
  if (space.kind !== 'pcloud') return toast('En mode démo, il n’y a rien à transférer.')
  // juste la connexion pCloud (+ dossier) et le Client ID : le profil, la tablette le relit dans pCloud.
  // (tout mettre dans le QR code le rendait trop gros pour être généré)
  try {
    // contenu compact (moins de cases dans le QR = lisible de plus loin)
    const cp = currentPcloud(), r = cp.root || {}
    const code = (String(r.link || '').match(/code=([A-Za-z0-9]+)/) || [])[1] || ''
    const { url, pin } = await makeDeviceLink({ t: cp.token, h: /eapi/.test(cp.api) ? 'e' : 'u', f: r.folderid, n: r.name, k: code, p: r.pw || '', c: clientId() })
    qr($('#deviceQr'), url); $('#devicePin').textContent = pin; $('#deviceOut').value = url
    $('#meDlg').close(); $('#deviceDlg').showModal()
  } catch (e) { console.error(e); toast('QR code impossible : ' + (e.message || e), 6000) }
}
$('#btnCopyInvite').onclick = async () => { try { await navigator.clipboard.writeText($('#inviteOut').value); toast('Lien copié') } catch { $('#inviteOut').select() } }
$('#btnShareInvite').onclick = () => navigator.share ? navigator.share({ title: 'Partoche and Friends', text: `Rejoins « ${lib.index.group.name} » sur Partoche and Friends`, url: $('#inviteOut').value }).catch(() => { }) : $('#btnCopyInvite').click()

$('#btnMe').onclick = async () => {
  if (GUEST()) return $('#guestDlg').showModal()
  $('#mName').value = lib.me.name; $('#mInstr').value = lib.me.instruments || ''
  setLookM(lib.me.emoji, lib.me.color)
  $('#meSpace').textContent = 'Espace : …'
  $('#meDlg').showModal()
  try { const a = await space.account(); $('#meSpace').textContent = `Espace : ${a.email}${space.kind === 'pcloud' ? (lib.me.pw ? ' · lien protégé par mot de passe' : ' · lien sans mot de passe (pCloud gratuit)') : ''}` } catch { }
}
$('#btnMeSave').onclick = async () => {
  Object.assign(lib.me, { name: $('#mName').value.trim() || lib.me.name, emoji: $('#mEmoji').value.trim() || lib.me.emoji, color: $('#mColor').value, instruments: $('#mInstr').value.trim() })
  await lib.save(); relay && relay.send({ ev: 'index' })
  $('#meDlg').close(); applyTheme(lib.me.color); renderAll()
}
$('#btnLeave').onclick = () => {
  if (!confirm('Oublier ce collectif et la connexion pCloud sur cet appareil ?')) return
  localStorage.removeItem('maf:space'); localStorage.removeItem('maf:index'); forgetPcloud(); location.reload()
}

// =====================================================================
//  LECTEUR
// =====================================================================
const viewer = new Viewer($('#viewer'), {
  onInkChange: ink => scheduleSave(ink),
  onStatus: t => { $('#vStatus').hidden = !t; $('#vStatus').textContent = t },
  toast,
})
let layers = [], saveT = 0, saveInk = null
async function openViewer(s) {
  stopPreview(); closeStatusMenu(); navGuard()
  current = s
  show('viewer')
  $('#vTitle').textContent = s.title
  $('#vOwner').innerHTML = ' · ' + esc(s.basedOn ? 'version de ' + s.owner.name : 'chez ' + s.owner.name)
  $('#vSaved').textContent = ''
  viewer.setMemberColor(lib.me.color)   // le stylo prend la couleur du membre
  if (relay) { relay.here = s.id; relay.send({ ev: 'hello' }) }
  layers = []; paintLayers(); renderChat(true)
  try {
    const [bytes, mine] = await Promise.all([lib.bytes(s), lib.myNotes(s.id)])
    if (current !== s) return
    await viewer.open(bytes, s.name, mine, [])
    loadLayers()
  } catch (e) { console.error(e); toast('Ouverture impossible : ' + (e.message || e), 6000) }
}
async function loadLayers(onlyId) {
  if (!current) return
  if (onlyId) { const p = lib.peer(onlyId); if (p) await p.load(true) }
  const got = await lib.friendsNotes(current.id)
  const off = new Set(layers.filter(l => !l.visible).map(l => l.id))
  // data = { <vue>: pages } (ou tableau de pages, ancien format) : le lecteur affiche la vue courante
  layers = got.map(n => ({ id: n.member.id, who: (n.member.emoji || '') + ' ' + n.member.name, color: n.member.color, data: n.ink, updated: n.updated, visible: !off.has(n.member.id) }))
  viewer.setLayers(layers); paintLayers()
}
function paintLayers() {
  const here = lib.index.knows.filter(k => relay && relay.isOnline(k.id) && (relay.online.get(k.id) || {}).score === (current && current.id))
  $('#vLayers').innerHTML = layers.map((l, i) => `<span class="chip ${l.visible ? '' : 'off'}" data-l="${i}" style="--c:${esc(l.color)}" title="annoté ${ago(l.updated || 0)} · toucher pour afficher / masquer">${esc(l.who)} ✎</span>`).join('') +
    here.map(k => `<span class="chip" style="--c:${esc(k.color)}">🟢 ${esc(k.name)} est sur ce morceau</span>`).join('')
  $('#vLayers').hidden = !layers.length && !here.length
  for (const c of $$('#vLayers [data-l]')) c.onclick = () => { const l = layers[+c.dataset.l]; l.visible = !l.visible; viewer.setLayers(layers); paintLayers() }
}
// ---- discussion du morceau, à droite de la partition ----
// (chacun publie ses messages dans son !Moi.json ; le fil = l'union de tout le monde)
const pieceOfCurrent = () => current && lib.pieces().find(p => p.versions.some(v => v.id === current.id))
function renderChat(scroll) {
  const p = pieceOfCurrent(); if (!p) return
  const L = $('#chatList'), atEnd = L.scrollHeight - L.scrollTop - L.clientHeight < 40
  const c = p.comments
  L.innerHTML = c.length ? c.map(x => `<div class="comment${x.member.id === lib.me.id ? ' me' : ''}">${avatar(x.member)}<div class="bubble" style="--c:${esc(x.member.color || '#888')}"><small>${esc(x.member.name)} · ${ago(x.at)}</small>${esc(x.text)}</div></div>`).join('')
    : '<p class="muted">Pas encore de message sur ce morceau. Lance la discussion !</p>'
  $('#vChatN').textContent = c.length || ''
  if (scroll || atEnd) L.scrollTop = 1e6
}
$('#chatForm').onsubmit = async e => {
  e.preventDefault()
  if (GUEST()) return toast('👀 Mode consultation : connecte ton pCloud pour écrire.')
  const t = $('#chatIn').value.trim(), p = pieceOfCurrent(); if (!t || !p) return
  $('#chatIn').value = ''
  await lib.comment(p.versions[0].id, t)
  relay && relay.send({ ev: 'index', score: current.id })
  renderChat(true)
}
// sur petit écran le chat se replie ; le bouton 💬 l'ouvre / le ferme
const chatOpen = () => $('#viewer').classList.contains('chat-open')
function setChat(on) { $('#viewer').classList.toggle('chat-open', on); if (on) { navGuard(); renderChat(true) } }
$('#vChatBtn').onclick = () => setChat(!chatOpen())
$('#chatClose').onclick = () => setChat(false)
// petit écran : toucher la partition referme la discussion
$('#viewer .vbody').addEventListener('pointerdown', e => { if (chatOpen() && !e.target.closest('#vChat') && innerWidth <= 900) setChat(false) }, true)
setInterval(() => { if (current && !document.hidden) renderChat() }, 30000)   // « il y a 2 min » à jour

// mes annotations : { <vue>: pages }, enregistrées 1,5 s après la dernière modification
function scheduleSave(ink) {
  saveInk = ink; $('#vSaved').textContent = '…'
  clearTimeout(saveT); saveT = setTimeout(flushSave, 1500)
}
async function flushSave() {
  if (!saveInk || !current) return
  const id = current.id, ink = saveInk; saveInk = null
  try {
    await lib.saveNotes(id, JSON.parse(JSON.stringify(ink)))
    $('#vSaved').textContent = space.kind === 'demo' ? 'Enregistré (démo)' : 'Enregistré · visible par le collectif'
    relay && relay.send({ ev: 'ink', score: id })
  } catch (e) { $('#vSaved').textContent = '⚠️ non enregistré'; toast('Enregistrement impossible : ' + e.message, 6000); saveInk = saveInk || ink }
}
$('#vBack').onclick = async () => {
  clearTimeout(saveT); await flushSave()
  viewer.close(); current = null
  $('#viewer').classList.remove('chat-open')
  if (relay) { relay.here = ''; relay.send({ ev: 'hello' }) }
  show('main'); renderAll()
}
addEventListener('pagehide', () => { if (saveInk) flushSave() })

// =====================================================================
//  RETOUR : la touche retour d'Android / du navigateur ferme d'abord ce qui est ouvert
//  (menu, fenêtre, partition), au lieu de quitter l'appli
// =====================================================================
// une « garde » dans l'historique : le retour la consomme, on ferme ce qui est ouvert et on la remet
const navGuard = () => { if (!history.state || history.state.paf !== 'g') history.pushState({ paf: 'g' }, '') }
const navArm = () => setTimeout(navGuard, 0)
addEventListener('popstate', () => {
  const d = [...document.querySelectorAll('dialog[open]')].pop()
  if (d) { d.close(); return navArm() }
  if ($('#stMenu')) { closeStatusMenu(); return navArm() }
  if (tutoOpen()) { closeTuto(); return navArm() }
  if (!$('#viewer').hidden && $('#viewer').classList.contains('chat-open') && innerWidth <= 900) { $('#viewer').classList.remove('chat-open'); return navArm() }
  if (!$('#viewer').hidden) { $('#vBack').click(); return navArm() }
  if (!$('#main').hidden && tab !== 'all') { $('.tabs [data-tab=all]').click(); return navArm() }
  // rien d'ouvert : on laisse partir (2e appui = on quitte)
})
navGuard()

// tous les liens vers le tuto l'ouvrent en fenêtre flottante (le ↗ de la fenêtre l'ouvre en grand)
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="tuto.html"]')
  if (!a || a.closest('.tutowin') || e.ctrlKey || e.metaKey) return
  e.preventDefault()
  if ($('#meDlg').open) $('#meDlg').close()
  openTuto(); navGuard()
})

// ouverture animée : ~3 s (ou un clic), puis l'appli
{
  const sp = $('#splash'), bye = () => { if (!sp || sp.classList.contains('out')) return; sp.classList.add('out'); setTimeout(() => sp.remove(), 600) }
  if (sp) { sp.onclick = bye; setTimeout(bye, 3200) }
}
boot()
