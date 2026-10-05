// Partoche and Friends — interface
import { openSpace, takeOAuthRedirect, hasPcloud, pcloudLoginUrl, forgetPcloud, currentPcloud, adoptPcloud, MINE, sharedFolders, createShared, checkLink, setMyRoot, clientId, setClientId, redirectUri, findExisting } from './cloud.js'
import { newGroup, readInvite, inviteUrl, randomId, Relay, makeDeviceLink, readDeviceLink, openDeviceLink } from './group.js'
import { Library, emptyIndex, STATUS, normTitle } from './library.js'
import { Viewer, scoreInfo } from './viewer.js'
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
  if (!kind) return inv ? setupStart('link') : step('Welcome')
  if (kind === 'pcloud' && !hasPcloud()) return lsGet('maf:intent', '') ? setupSpace() : setupStart()
  try {
    step('', 'Ouverture de ton espace…')
    space = await openSpace(kind)
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
  adoptPcloud(d.pcloud); setClientId(d.c)
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
async function startMain(justJoined) {
  show('main'); applyTheme(lib.me.color)
  $('#groupTitle').textContent = lib.index.group.name
  $('#spaceInfo').textContent = space.kind === 'demo' ? 'mode démo · rien n’est partagé' : `pCloud · dossier « ${(space.root || {}).name || ''} »`
  if (space.kind === 'pcloud' && !lib.me.link) { try { await publishMyLink(); await lib.save() } catch (e) { toast('Lien de partage impossible : ' + e.message, 6000) } }
  if (!lib.index.group.admin && !lib.index.knows.length) { lib.index.group.admin = lib.me.id; lib.save().catch(() => { }) }
  renderAll()
  relay = new Relay(lib.index.group, () => lib.me, onRelay)
  if (space.kind === 'pcloud') relay.start()
  await refresh(true)
  if (justJoined && lib.index.knows.length) relay.send({ ev: 'index' })
  if (justJoined && !lib.index.knows.length && space.kind === 'pcloud') setTimeout(() => $('#btnInvite').click(), 600)
}
async function refresh(force) {
  $('#btnRefresh').classList.add('spin')
  try { await lib.refresh(force) } catch (e) { console.warn(e) }
  $('#btnRefresh').classList.remove('spin')
  renderAll()
}
$('#btnRefresh').onclick = () => refresh(true)
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
  $('#memberDots').innerHTML = lib.members().map(m => avatar(m)).join('')
  const sel = $('#filterMember'), v = sel.value
  sel.innerHTML = '<option value="">Tout le monde</option>' + lib.members().map(m => `<option value="${esc(m.id)}">${esc(m.emoji || '')} ${esc(m.name)}</option>`).join('')
  sel.value = v
}
function renderAll() { paintDots(); renderList() }

for (const b of $$('.tabs [data-tab]')) b.onclick = () => { tab = b.dataset.tab; $$('.tabs [data-tab]').forEach(x => x.classList.toggle('on', x === b)); renderList() }
$('#search').oninput = () => renderList()
$('#filterMember').onchange = () => renderList()

function renderList() {
  const L = $('#list')
  L.classList.remove('as-table')
  if (tab === 'members') return renderMembers()
  const q = normTitle($('#search').value), who = $('#filterMember').value
  let pieces = lib.pieces()
  if (q) pieces = pieces.filter(p => normTitle(p.title + ' ' + p.versions.map(v => v.composer).join(' ')).includes(q))
  if (who) pieces = pieces.filter(p => p.versions.some(v => v.owner.id === who) || p.work.some(w => w.member.id === who))
  if (tab === 'work') pieces = pieces.filter(p => p.work.length).sort((a, b) => Math.max(...b.work.map(w => w.at || 0)) - Math.max(...a.work.map(w => w.at || 0)))
  if (!pieces.length) {
    L.innerHTML = `<div class="empty">${tab === 'work' ? 'Personne ne bosse encore sur un morceau.<br>Ouvre une partition et indique « Je bosse dessus ».' : 'Aucune partition pour l’instant.<br>Ajoute les tiennes avec <b>＋ Partition</b>, invite tes amis avec <b>🤝 Inviter</b>.'}</div>`
    return
  }
  // tableau : une ligne par morceau, une colonne par personne (moi en premier)
  const mem = lib.members()
  const STEPS_ST = ['', 'envie', 'encours', 'pret']
  const cell = (p, m) => {
    const vs = p.versions.filter(v => v.owner.id === m.id)
    const w = p.work.find(x => x.member.id === m.id) || {}
    const st = STATUS[w.status]
    const has = vs.length ? '<span class="has" title="a la partition dans son dossier">📄</span>' : ''
    const inner = (st ? `<span class="st" title="${esc(st.label)}">${st.icon}</span>` : '') + has + (w.part ? `<small>${esc(w.part)}</small>` : '')
    return inner || '<span class="none">·</span>'
  }
  L.classList.add('as-table')
  L.innerHTML = `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th class="c-title">Morceau</th>${mem.map(m => `<th class="c-mem" style="--c:${esc(m.color || '#888')}">${avatar(m)}<span>${esc(m.id === lib.me.id ? 'Moi' : m.name)}</span></th>`).join('')}<th class="c-com">💬</th></tr></thead>
    <tbody>${pieces.map((p, i) => {
      const comp = p.versions.find(v => v.composer)
      const last = p.comments[p.comments.length - 1]
      return `<tr data-i="${i}">
        <th class="c-title"><b>${esc(p.title)}</b>${comp ? `<small>${esc(comp.composer)}</small>` : ''}</th>
        ${mem.map(m => `<td class="c-mem${m.id === lib.me.id ? ' mine' : ''}" style="--c:${esc(m.color || '#888')}"${m.id === lib.me.id ? ' title="Clique pour changer ton statut"' : ''}>${cell(p, m)}</td>`).join('')}
        <td class="c-com" title="${last ? esc(last.member.name + ' : ' + last.text) : ''}">${p.comments.length || ''}</td>
      </tr>`
    }).join('')}</tbody></table></div>
    <p class="legend">💡 envie · 🛠️ je bosse dessus · ✅ prêt · 📄 a la partition · clique sur ta colonne pour changer ton statut, sur le reste pour ouvrir la fiche</p>`
  for (const tr of $$('#list tbody tr')) tr.onclick = async e => {
    const p = pieces[+tr.dataset.i]
    if (e.target.closest('td.mine')) {   // ma colonne : statut suivant, sans ouvrir la fiche
      const w = p.work.find(x => x.member.id === lib.me.id) || {}
      const next = STEPS_ST[(STEPS_ST.indexOf(w.status || '') + 1) % STEPS_ST.length]
      await lib.setWork(w.score || p.versions[0].id, { status: next, part: w.part || '' })
      relay && relay.send({ ev: 'index' }); renderList(); return
    }
    openPiece(p)
  }
}

function renderMembers() {
  // collectif créé avant les admins, avec déjà plusieurs membres : son créateur se déclare (le premier gagne)
  const claim = !lib.adminId() ? `<article class="card member-card"><div>👑 Ce collectif n'a pas encore d'admin.</div><div class="muted">C'est toi qui l'as créé ? Déclare-toi admin : tu pourras retirer des membres.</div><div><button class="small primary" id="btnClaimAdmin">👑 Je suis le créateur, devenir admin</button></div></article>` : ''
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
function openPiece(p) { piece = p; renderPiece(); if (!$('#pieceDlg').open) $('#pieceDlg').showModal() }
$('#pdStatus').innerHTML = '<option value="">—</option>' + Object.entries(STATUS).map(([k, s]) => `<option value="${k}">${s.icon} ${s.label}</option>`).join('')

function renderPiece() {
  piece = lib.pieces().find(p => p.key === piece.key) || piece
  $('#pdTitle').textContent = piece.title
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
  el.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true })
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
  const { url, pin } = await makeDeviceLink({ pcloud: currentPcloud(), c: clientId(), index: lib.index })
  qr($('#deviceQr'), url); $('#devicePin').textContent = pin; $('#deviceOut').value = url
  $('#meDlg').close(); $('#deviceDlg').showModal()
}
$('#btnCopyInvite').onclick = async () => { try { await navigator.clipboard.writeText($('#inviteOut').value); toast('Lien copié') } catch { $('#inviteOut').select() } }
$('#btnShareInvite').onclick = () => navigator.share ? navigator.share({ title: 'Partoche and Friends', text: `Rejoins « ${lib.index.group.name} » sur Partoche and Friends`, url: $('#inviteOut').value }).catch(() => { }) : $('#btnCopyInvite').click()

$('#btnMe').onclick = async () => {
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
  onInkChange: pages => scheduleSave(pages),
  onStatus: t => { $('#vStatus').hidden = !t; $('#vStatus').textContent = t },
})
let layers = [], saveT = 0, savePages = null
async function openViewer(s) {
  current = s
  show('viewer')
  $('#vTitle').textContent = s.title
  $('#vOwner').innerHTML = ' · ' + esc(s.basedOn ? 'version de ' + s.owner.name : 'chez ' + s.owner.name)
  $('#vSaved').textContent = ''; $('#vPlay').textContent = '▶'
  setPen(false)
  if (relay) { relay.here = s.id; relay.send({ ev: 'hello' }) }
  layers = []; paintLayers(); renderChat(true)
  try {
    const [bytes, mine] = await Promise.all([lib.bytes(s), lib.myNotes(s.id)])
    await viewer.open(bytes, s.name, (mine && mine.pages) || [], [])
    loadLayers()
  } catch (e) { console.error(e); toast('Ouverture impossible : ' + (e.message || e), 6000) }
}
async function loadLayers(onlyId) {
  if (onlyId) { const p = lib.peer(onlyId); if (p) await p.load(true) }
  const got = await lib.friendsNotes(current.id)
  const off = new Set(layers.filter(l => !l.visible).map(l => l.id))
  layers = got.map(n => ({ id: n.member.id, who: (n.member.emoji || '') + ' ' + n.member.name, color: n.member.color, data: n.pages, updated: n.updated, visible: !off.has(n.member.id) }))
  viewer.setLayers(layers); paintLayers()
}
function paintLayers() {
  const here = lib.index.knows.filter(k => relay && relay.isOnline(k.id) && (relay.online.get(k.id) || {}).score === (current && current.id))
  $('#vLayers').innerHTML = layers.map((l, i) => `<span class="chip ${l.visible ? '' : 'off'}" data-l="${i}" style="--c:${esc(l.color)}" title="annoté ${ago(l.updated || 0)}">${esc(l.who)} ✎</span>`).join('') +
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
  const t = $('#chatIn').value.trim(), p = pieceOfCurrent(); if (!t || !p) return
  $('#chatIn').value = ''
  await lib.comment(p.versions[0].id, t)
  relay && relay.send({ ev: 'index', score: current.id })
  renderChat(true)
}
// sur petit écran le chat se replie ; le bouton 💬 l'ouvre / le ferme
$('#vChatBtn').onclick = () => $('#viewer').classList.toggle('chat-open')
setInterval(() => { if (current && !document.hidden) renderChat() }, 30000)   // « il y a 2 min » à jour

function setPen(on) {
  viewer.ink.setEnabled(on); viewer.ink.color = lib.me.color || '#138a4a'
  $('#vTools').hidden = !on; $('#vPen').classList.toggle('on', on)
}
$('#vPen').onclick = () => setPen($('#vTools').hidden)
for (const b of $$('#vTools [data-tool]')) b.onclick = () => { viewer.ink.setTool(b.dataset.tool); $$('#vTools [data-tool]').forEach(x => x.classList.toggle('on', x === b)) }
$('#vUndo').onclick = () => viewer.ink.undo()
$('#vPlay').onclick = async () => { $('#vPlay').textContent = (await viewer.togglePlay()) ? '⏸' : '▶' }
viewer.player.onEnd = () => $('#vPlay').textContent = '▶'
addEventListener('resize', () => viewer.ink.resize())

function scheduleSave(pages) {
  savePages = pages; $('#vSaved').textContent = '…'
  clearTimeout(saveT); saveT = setTimeout(flushSave, 1500)
}
async function flushSave() {
  if (!savePages || !current) return
  const id = current.id, pages = savePages; savePages = null
  try {
    await lib.saveNotes(id, pages)
    $('#vSaved').textContent = space.kind === 'demo' ? 'Enregistré (démo)' : 'Enregistré · visible par le collectif'
    relay && relay.send({ ev: 'ink', score: id })
  } catch (e) { $('#vSaved').textContent = '⚠️ non enregistré'; toast('Enregistrement impossible : ' + e.message, 6000); savePages = savePages || pages }
}
$('#vBack').onclick = async () => {
  clearTimeout(saveT); await flushSave()
  viewer.close(); current = null
  if (relay) { relay.here = ''; relay.send({ ev: 'hello' }) }
  show('main'); renderAll()
}
addEventListener('pagehide', () => { if (savePages) flushSave() })

// ouverture animée : ~2,6 s (ou un clic), puis l'appli
{
  const sp = $('#splash'), bye = () => { if (!sp || sp.classList.contains('out')) return; sp.classList.add('out'); setTimeout(() => sp.remove(), 600) }
  if (sp) { sp.onclick = bye; setTimeout(bye, 2600) }
}
boot()
