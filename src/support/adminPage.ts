// The admin page for support: the threads, one open thread, a reply box, and
// "ask for feedback". One person uses it, from a phone as often as a laptop.
//
// Served as static HTML by GET /admin/support; it holds no data and asks for
// ADMIN_TOKEN once, keeping it in localStorage. Everything a tester wrote is
// untrusted text and reaches the DOM through textContent only -- never
// innerHTML -- so a message cannot become markup on the admin's screen.
export function adminPageHtml(): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Support · Podcapp</title>
<style>
:root{--ink:#1C1B22;--muted:#77747E;--line:rgba(28,27,34,.09);--bg:#EFECF9;--card:#fff;--accent:#5B51A8;--tint:rgba(124,108,220,.12);--danger:#B54334;--warn:#9A6B00;--warnbg:rgba(154,107,0,.10)}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Inter Tight",system-ui,sans-serif;color:var(--ink);background:var(--bg)}
button{font:inherit;border:1px solid var(--line);background:var(--card);border-radius:10px;padding:8px 12px;cursor:pointer;color:var(--ink)}
button.primary{background:var(--ink);color:#fff;border-color:var(--ink)}
button:disabled{opacity:.5;cursor:default}
textarea,input[type=password]{font:inherit;width:100%;border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--card);color:var(--ink)}
textarea{resize:vertical;min-height:72px}
.shell{max-width:1100px;margin:0 auto;padding:16px;display:grid;grid-template-columns:320px minmax(0,1fr);gap:16px;min-height:100vh}
.panel{background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;min-height:0}
.head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;border-bottom:1px solid var(--line)}
.head h1,.head h2{font-size:16px;margin:0;font-weight:600}
.thread{padding:11px 14px;border-bottom:1px solid var(--line);cursor:pointer}
.thread.active{background:var(--tint)}
.thread .top{display:flex;justify-content:space-between;gap:8px;font-size:13px}
.thread .who{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.thread.unread .who::after{content:" ●";color:var(--accent)}
.thread .last{color:var(--muted);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meta{color:var(--muted);font-size:12px}
.banner{margin:10px 14px 0;padding:8px 10px;border-radius:10px;background:var(--warnbg);color:var(--warn);font-size:12px}
.msgs{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:8px;min-height:240px}
.b{max-width:78%;padding:8px 12px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word}
.b.user{align-self:flex-start;background:#F1EFF6}
.b.admin{align-self:flex-end;background:var(--ink);color:#fff}
.b .t{display:block;font-size:11px;opacity:.6;margin-top:3px}
.compose{border-top:1px solid var(--line);padding:12px;display:flex;flex-direction:column;gap:8px}
.row{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.who-list{max-height:260px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:6px 10px}
.who-list label{display:flex;gap:8px;align-items:center;padding:4px 0;font-size:14px}
.nopush{color:var(--danger);font-size:12px}
.err{color:var(--danger);font-size:13px}
.empty{color:var(--muted);padding:24px 14px;text-align:center}
.login{max-width:380px;margin:18vh auto;padding:20px;background:var(--card);border-radius:16px;border:1px solid var(--line);display:flex;flex-direction:column;gap:10px}
.back{display:none}
@media (max-width:760px){
  .shell{grid-template-columns:minmax(0,1fr);padding:10px}
  .shell.reading #list{display:none}
  .shell:not(.reading) #view{display:none}
  .back{display:inline-block}
}
</style>
</head>
<body>
<div id="login" class="login" hidden>
  <h2 style="margin:0;font-size:18px">Support Podcapp</h2>
  <p class="meta" style="margin:0">Colle la valeur d'ADMIN_TOKEN. Elle reste dans ce navigateur.</p>
  <input id="token" type="password" autocomplete="off" placeholder="ADMIN_TOKEN">
  <button class="primary" id="enter">Entrer</button>
  <div id="loginErr" class="err"></div>
</div>

<div id="app" class="shell" hidden>
  <section id="list" class="panel">
    <div class="head"><h1>Fils</h1><button id="askBtn">Demander un feedback</button></div>
    <div id="broadcasts"></div>
    <div id="threads"></div>
    <div class="head" style="border-top:1px solid var(--line);border-bottom:0"><span class="meta" id="status"></span><button id="logout" style="padding:4px 10px;font-size:13px">Sortir</button></div>
  </section>

  <section id="view" class="panel">
    <div class="empty" id="placeholder">Choisis un fil, ou demande un feedback.</div>

    <div id="threadPane" hidden style="display:flex;flex-direction:column;flex:1;min-height:0">
      <div class="head"><button class="back" data-back>‹ Fils</button><h2 id="threadTitle"></h2><span class="meta" id="threadMeta"></span></div>
      <div class="msgs" id="msgs"></div>
      <div class="compose">
        <textarea id="reply" placeholder="Répondre…"></textarea>
        <div class="row"><span class="meta">⌘↩ pour envoyer</span><button class="primary" id="send">Envoyer</button></div>
        <div id="replyErr" class="err"></div>
      </div>
    </div>

    <div id="askPane" hidden style="display:flex;flex-direction:column;flex:1;min-height:0">
      <div class="head"><button class="back" data-back>‹ Fils</button><h2>Demander un feedback</h2><span></span></div>
      <div class="compose" style="border-top:0">
        <textarea id="askBody" placeholder="Qu'as-tu pensé du briefing de ce matin ? Trop long, trop court ?" style="min-height:110px"></textarea>
        <div class="row"><span class="meta" id="askCount"></span><span><button id="all" style="padding:4px 10px;font-size:13px">Tous</button> <button id="none" style="padding:4px 10px;font-size:13px">Aucun</button></span></div>
        <div class="who-list" id="who"></div>
        <p class="meta" style="margin:0">Arrive comme un message de toi dans leur fil, avec une notification pour ceux qui les ont activées. Les réponses arrivent ici.</p>
        <div class="row"><span></span><button class="primary" id="askSend">Envoyer</button></div>
        <div id="askErr" class="err"></div>
      </div>
    </div>
  </section>
</div>

<script>
(() => {
  const KEY = 'podcapp-admin-token'
  const $ = (id) => document.getElementById(id)
  let token = ''
  try { token = localStorage.getItem(KEY) || '' } catch {}
  let data = { threads: [], recipients: [], broadcasts: [], admin_user_ids: [] }
  let openUser = null
  let mode = 'none'

  function el(tag, cls, text) {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }
  function when(iso) {
    const d = new Date(iso)
    const today = new Date().toDateString() === d.toDateString()
    return today ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                 : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  }
  function label(email, userId) { return email || ('Apple relais · ' + userId.slice(0, 8)) }

  async function api(path, init) {
    const res = await fetch('/admin/support' + path, {
      ...init,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    })
    const body = await res.json().catch(() => ({}))
    if (res.status === 401) { signOut('Jeton refusé.'); throw new Error('denied') }
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status))
    return body
  }

  function signOut(message) {
    token = ''
    try { localStorage.removeItem(KEY) } catch {}
    $('app').hidden = true
    $('login').hidden = false
    $('loginErr').textContent = message || ''
  }

  async function refresh() {
    try {
      data = await api('/threads')
      $('status').textContent = 'À jour ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      renderList()
      if (mode === 'thread' && openUser) await loadThread(openUser, false)
    } catch (e) {
      if (e.message !== 'denied') $('status').textContent = 'Erreur : ' + e.message
    }
  }

  function renderList() {
    const b = $('broadcasts'); b.replaceChildren()
    for (const x of data.broadcasts.slice(0, 3)) {
      const n = el('div', 'banner')
      n.textContent = 'Feedback du ' + when(x.sent_at) + ' — envoyé à ' + x.sent + ', ' + x.replied + ' réponse' + (x.replied > 1 ? 's' : '') + ' · « ' + x.body.slice(0, 60) + (x.body.length > 60 ? '…' : '') + ' »'
      b.append(n)
    }
    const t = $('threads'); t.replaceChildren()
    if (data.threads.length === 0) t.append(el('div', 'empty', 'Aucun message pour l’instant.'))
    for (const x of data.threads) {
      const n = el('div', 'thread' + (x.unread ? ' unread' : '') + (x.user_id === openUser && mode === 'thread' ? ' active' : ''))
      const top = el('div', 'top')
      top.append(el('span', 'who', label(x.email, x.user_id)), el('span', 'meta', when(x.last_at)))
      n.append(top, el('div', 'last', (x.last_author === 'admin' ? 'Toi : ' : '') + x.last_body))
      n.onclick = () => openThread(x.user_id)
      t.append(n)
    }
  }

  function show(which) {
    mode = which
    $('placeholder').hidden = which !== 'none'
    $('threadPane').hidden = which !== 'thread'
    $('askPane').hidden = which !== 'ask'
    $('app').classList.toggle('reading', which !== 'none')
  }

  async function openThread(userId) {
    openUser = userId
    show('thread')
    const who = data.recipients.find((r) => r.user_id === userId) || data.threads.find((r) => r.user_id === userId) || {}
    $('threadTitle').textContent = label(who.email, userId)
    $('threadMeta').textContent = (who.language || '').toUpperCase() + (who.devices === 0 ? ' · pas de push' : '')
    $('msgs').replaceChildren(el('div', 'empty', 'Chargement…'))
    await loadThread(userId, true)
    renderList()
  }

  async function loadThread(userId, scroll) {
    const { messages } = await api('/threads/' + userId)
    if (openUser !== userId) return
    const box = $('msgs')
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40
    box.replaceChildren()
    for (const m of messages) {
      const n = el('div', 'b ' + m.author, m.body)
      n.append(el('span', 't', when(m.created_at)))
      box.append(n)
    }
    if (scroll || atBottom) box.scrollTop = box.scrollHeight
  }

  async function sendReply() {
    const body = $('reply').value.trim()
    if (!body || !openUser) return
    $('send').disabled = true; $('replyErr').textContent = ''
    try {
      await api('/threads/' + openUser, { method: 'POST', body: JSON.stringify({ body }) })
      $('reply').value = ''
      await loadThread(openUser, true)
      refresh()
    } catch (e) { if (e.message !== 'denied') $('replyErr').textContent = e.message }
    $('send').disabled = false
  }

  function openAsk() {
    openUser = null
    show('ask')
    const who = $('who'); who.replaceChildren()
    for (const r of data.recipients) {
      const l = el('label')
      const box = document.createElement('input')
      box.type = 'checkbox'; box.value = r.user_id
      box.checked = !data.admin_user_ids.includes(r.user_id)
      box.onchange = countAsk
      l.append(box, el('span', '', label(r.email, r.user_id) + ' · ' + (r.language || '').toUpperCase()))
      if (r.devices === 0) l.append(el('span', 'nopush', 'pas de push'))
      who.append(l)
    }
    countAsk()
    renderList()
  }
  function picked() { return [...$('who').querySelectorAll('input:checked')].map((x) => x.value) }
  function countAsk() {
    const ids = picked()
    const reachable = data.recipients.filter((r) => ids.includes(r.user_id) && r.devices > 0).length
    $('askCount').textContent = ids.length + ' destinataire' + (ids.length > 1 ? 's' : '') + ', dont ' + reachable + ' avec notifications'
  }
  async function sendAsk() {
    const body = $('askBody').value.trim()
    const ids = picked()
    $('askErr').textContent = ''
    if (!body) { $('askErr').textContent = 'Écris la question d’abord.'; return }
    if (ids.length === 0) { $('askErr').textContent = 'Choisis au moins un destinataire.'; return }
    $('askSend').disabled = true
    try {
      const r = await api('/broadcast', { method: 'POST', body: JSON.stringify({ body, user_ids: ids }) })
      $('askBody').value = ''
      $('askErr').textContent = ''
      await refresh()
      show('none')
      $('status').textContent = 'Envoyé à ' + r.sent
    } catch (e) { if (e.message !== 'denied') $('askErr').textContent = e.message }
    $('askSend').disabled = false
  }

  $('enter').onclick = async () => {
    token = $('token').value.trim()
    if (!token) return
    try { await api('/threads'); try { localStorage.setItem(KEY, token) } catch {}; start() }
    catch (e) { if (e.message !== 'denied') $('loginErr').textContent = e.message }
  }
  $('token').onkeydown = (e) => { if (e.key === 'Enter') $('enter').click() }
  $('logout').onclick = () => signOut('')
  $('send').onclick = sendReply
  $('reply').onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendReply() }
  $('askBtn').onclick = openAsk
  $('askSend').onclick = sendAsk
  $('all').onclick = () => { $('who').querySelectorAll('input').forEach((x) => x.checked = true); countAsk() }
  $('none').onclick = () => { $('who').querySelectorAll('input').forEach((x) => x.checked = false); countAsk() }
  document.querySelectorAll('[data-back]').forEach((b) => b.onclick = () => { openUser = null; show('none'); renderList() })

  let timer = null
  function start() {
    $('login').hidden = true
    $('app').hidden = false
    show('none')
    refresh()
    clearInterval(timer)
    timer = setInterval(refresh, 20000)
  }
  if (token) start(); else signOut('')
})()
</script>
</body>
</html>`
}
