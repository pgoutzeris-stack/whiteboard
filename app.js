/* ════════════════════════════════════════════════════════════════
   ROOTS WHITEBOARD – Single-file application
   ════════════════════════════════════════════════════════════════ */

/* ─── Supabase ─────────────────────────────────────────────── */
const SUPABASE_URL  = 'https://csmguwcvzreefluhahyu.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNzbWd1d2N2enJlZWZsdWhhaHl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5NjM0ODcsImV4cCI6MjA5MjUzOTQ4N30.Fiafx7XBaQZXUX3bKQIBH7znBHx3B51yL-bftOHsL4Q';
const { createClient } = supabase;
const ROOTS_EMBEDDED_AUTH = window.parent !== window;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: !ROOTS_EMBEDDED_AUTH,
    autoRefreshToken: !ROOTS_EMBEDDED_AUTH,
    detectSessionInUrl: false,
    ...(ROOTS_EMBEDDED_AUTH ? {} : { storage: window.localStorage }),
  }
});
window.__rootsSupabaseClient = sb;
if (document.documentElement.classList.contains('in-iframe') && window.RootsUserBridge?.syncAuthFromParentStorage) {
  void window.RootsUserBridge.syncAuthFromParentStorage();
}
try {
  if (window.self !== window.top) document.documentElement.classList.add('in-iframe');
} catch {
  document.documentElement.classList.add('in-iframe');
}

/* ─── State ────────────────────────────────────────────────── */
const State = {
  user: null,
  profile: null,
  currentScreen: 'login',
  dashView: 'my-boards',
  boards: [],
  searchQuery: '',
  authMode: 'signin', // or 'signup'
  // Board state
  board: null,                   // current board row
  objects: new Map(),            // id -> object
  spatialDirty: true,            // re-index next render
  selected: new Set(),           // selected object ids
  hoverId: null,
  tool: 'select',
  prevTool: null,
  zoom: 1,
  panX: 0,
  panY: 0,
  isPanning: false,
  panStart: null,
  // Drawing state
  isDrawing: false,
  draftObject: null,             // object being created
  isDragging: false,             // dragging existing
  dragStart: null,
  dragInitial: null,             // snapshot of selected objects before drag
  isResizing: false,
  resizeHandle: null,            // 'n','ne','e','se','s','sw','w','nw'
  isRotating: false,
  marqueeStart: null,
  isMarquee: false,
  // Style state for new objects
  style: {
    fill: '#ffffff',
    stroke: '#0f172a',
    strokeWidth: 2,
    text: '#0f172a',
    fontSize: 16,
    fontFamily: 'Circular Std',
    bold: false,
    italic: false,
    underline: false,
    stickyColor: '#fef3c7'
  },
  // Undo/redo
  history: [],
  historyIndex: -1,
  // Realtime
  presenceChannel: null,
  dbChannel: null,
  presence: new Map(),           // user_id -> {name, color, cursor:{x,y}, ...}
  cursorPos: {x:0, y:0},
  // Misc
  saveTimer: null,
  thumbnailTimer: null,
  commentMode: false,
  workshopMode: false,
  workshopIndex: 0,
  clipboard: null,
  inlineEditing: null,           // {objId, el}
};

/* Color palettes */
const STICKY_COLORS = ['#fef3c7','#fce7f3','#d1fae5','#dbeafe','#ede9fe','#fed7aa','#fecaca','#f5f5f4'];
const FILL_COLORS = ['#ffffff','#f1f5f9','#e2e8f0','#94a3b8','#0f172a','#206efb','#10b981','#dc2626','#f59e0b','#a855f7','#ec4899','#06b6d4','#14b8a6','#84cc16'];
const STROKE_COLORS = ['#0f172a','#475569','#94a3b8','#cbd5e1','#206efb','#10b981','#dc2626','#f59e0b','#a855f7','#ec4899'];
const PRESENCE_COLORS = ['#206efb','#10b981','#f59e0b','#dc2626','#a855f7','#ec4899','#06b6d4','#14b8a6','#84cc16','#f97316'];

/* Templates */
const TEMPLATES = [
  { key: 'blank', name: 'Leer', desc: 'Starte mit einem leeren Canvas.', icon: 'fa-square-plus' },
  { key: 'brainstorm', name: 'Brainstorming', desc: 'Sticky-Notes-Cluster für freie Ideen-Sammlung.', icon: 'fa-lightbulb' },
  { key: 'kanban', name: 'Kanban-Board', desc: 'Drei Spalten: To Do · In Arbeit · Erledigt.', icon: 'fa-columns' },
  { key: 'retro', name: 'Retrospektive', desc: 'Gut gelaufen · Schlecht gelaufen · Aktionen.', icon: 'fa-rotate' },
  { key: 'mindmap', name: 'Mindmap', desc: 'Zentrales Thema mit Ästen für Unter-Ideen.', icon: 'fa-diagram-project' },
  { key: 'journey', name: 'Customer Journey', desc: 'Phasen, Touchpoints, Emotionen.', icon: 'fa-route' },
  { key: 'swot', name: 'SWOT-Analyse', desc: 'Stärken · Schwächen · Chancen · Risiken.', icon: 'fa-table-cells' },
  { key: 'flowchart', name: 'Flowchart', desc: 'Prozess-Diagramm mit Start, Schritten, Entscheidungen.', icon: 'fa-share-nodes' }
];

/* ════════════════════════════════════════════════════════════
   UTILS
   ════════════════════════════════════════════════════════════ */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const uid = () => crypto.randomUUID();
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ── ROOTS Dialog (confirm + prompt) – self-contained, ersetzt window.confirm/prompt ──
function _rootsDlgEnsure(){
  if(document.getElementById('roots-dlg-overlay'))return;
  var css="#roots-dlg-overlay{display:none;position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);align-items:center;justify-content:center;padding:1.25rem}#roots-dlg-overlay.open{display:flex}#roots-dlg-box{background:var(--bg,#fff);border:1px solid var(--line,#e2e8f0);border-radius:20px;box-shadow:var(--shadow-modal,0 20px 60px rgba(15,23,42,.2));max-width:380px;width:100%;padding:1.75rem 1.5rem 1.5rem;text-align:center;font-family:inherit;animation:rootsDlgIn .2s cubic-bezier(.22,1,.36,1)}@keyframes rootsDlgIn{from{opacity:0;transform:scale(.95) translateY(10px)}to{opacity:1;transform:none}}#roots-dlg-icon{width:48px;height:48px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-size:1.15rem;margin:0 auto .85rem;background:#fef2f2;color:#dc2626}#roots-dlg-icon.warning{background:#fffbeb;color:#d97706}#roots-dlg-icon.info{background:var(--brand-light,#eff6ff);color:var(--brand,#206efb)}#roots-dlg-title{font-size:1.05rem;font-weight:700;color:var(--ink,#0f172a);margin:0 0 .4rem}#roots-dlg-desc{font-size:.875rem;color:var(--muted,#64748b);line-height:1.5;margin:0 0 1.25rem}#roots-dlg-input{width:100%;height:44px;padding:0 .9rem;border:1px solid var(--line,#e2e8f0);border-radius:10px;font-family:inherit;font-size:.95rem;color:var(--ink,#0f172a);background:var(--bg,#fff);outline:none;box-sizing:border-box;margin:0 0 1.25rem}#roots-dlg-input:focus{border-color:var(--brand,#206efb)}#roots-dlg-actions{display:flex;gap:.6rem}#roots-dlg-cancel{flex:1;padding:.75rem 1rem;border:1px solid var(--line,#e2e8f0);border-radius:10px;background:transparent;font-family:inherit;font-weight:600;font-size:.875rem;color:var(--ink,#0f172a);cursor:pointer}#roots-dlg-cancel:hover{border-color:var(--brand,#206efb);color:var(--brand,#206efb)}#roots-dlg-ok{flex:1;padding:.75rem 1rem;border:none;border-radius:10px;font-family:inherit;font-weight:600;font-size:.875rem;color:#fff;background:#dc2626;cursor:pointer}#roots-dlg-ok:hover{opacity:.88}#roots-dlg-ok.warning{background:#d97706}#roots-dlg-ok.info{background:var(--brand,#206efb)}";
  var st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
  var ov=document.createElement('div');ov.id='roots-dlg-overlay';
  ov.innerHTML='<div id="roots-dlg-box"><div id="roots-dlg-icon"></div><h2 id="roots-dlg-title"></h2><p id="roots-dlg-desc"></p><input id="roots-dlg-input" style="display:none"/><div id="roots-dlg-actions"><button type="button" id="roots-dlg-cancel">Abbrechen</button><button type="button" id="roots-dlg-ok">OK</button></div></div>';
  document.body.appendChild(ov);
}
function rootsConfirm(o){o=o||{};return new Promise(function(res){_rootsDlgEnsure();var ov=document.getElementById('roots-dlg-overlay'),ic=document.getElementById('roots-dlg-icon'),ok=document.getElementById('roots-dlg-ok'),ca=document.getElementById('roots-dlg-cancel'),inp=document.getElementById('roots-dlg-input');inp.style.display='none';var v=o.variant||'danger';document.getElementById('roots-dlg-title').textContent=o.title||'Wirklich fortfahren?';var d=document.getElementById('roots-dlg-desc');d.textContent=o.desc||'';d.style.display=o.desc?'':'none';ic.className=v==='danger'?'':v;ic.innerHTML='<i class="fa-solid '+(o.icon||'fa-trash')+'"></i>';ok.className=v==='danger'?'':v;ok.textContent=o.okLabel||'Bestätigen';ov.classList.add('open');var done=function(val){ov.classList.remove('open');ok.onclick=ca.onclick=ov.onclick=null;document.removeEventListener('keydown',k);res(val)};var k=function(e){if(e.key==='Escape')done(false)};ok.onclick=function(){done(true)};ca.onclick=function(){done(false)};ov.onclick=function(e){if(e.target===ov)done(false)};document.addEventListener('keydown',k)})}
function rootsPrompt(o){o=o||{};return new Promise(function(res){_rootsDlgEnsure();var ov=document.getElementById('roots-dlg-overlay'),ic=document.getElementById('roots-dlg-icon'),ok=document.getElementById('roots-dlg-ok'),ca=document.getElementById('roots-dlg-cancel'),inp=document.getElementById('roots-dlg-input');document.getElementById('roots-dlg-title').textContent=o.title||'Eingabe';var d=document.getElementById('roots-dlg-desc');d.textContent=o.label||'';d.style.display=o.label?'':'none';ic.className='info';ic.innerHTML='<i class="fa-solid '+(o.icon||'fa-pen')+'"></i>';ok.className='info';ok.textContent=o.okLabel||'Speichern';inp.style.display='';inp.value=o.value||'';ov.classList.add('open');setTimeout(function(){inp.focus();inp.select()},50);var done=function(val){ov.classList.remove('open');ok.onclick=ca.onclick=ov.onclick=inp.onkeydown=null;document.removeEventListener('keydown',k);res(val)};var k=function(e){if(e.key==='Escape')done(null)};ok.onclick=function(){done(inp.value)};ca.onclick=function(){done(null)};ov.onclick=function(e){if(e.target===ov)done(null)};inp.onkeydown=function(e){if(e.key==='Enter'){e.preventDefault();done(inp.value)}};document.addEventListener('keydown',k)})}

function toast(msg, type='info'){
  const c = $('#toast-container'); if(!c) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const ic = type==='error'?'fa-circle-exclamation':type==='success'?'fa-circle-check':type==='warn'?'fa-triangle-exclamation':'fa-circle-info';
  el.innerHTML = `<i class="fa-solid ${ic}"></i><span>${escapeHtml(msg)}</span>`;
  c.appendChild(el);
  setTimeout(()=>{ el.classList.add('fade-out'); setTimeout(()=>el.remove(),250); }, 3000);
}
function escapeHtml(s){ return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function showScreen(name){
  $$('.screen').forEach(s => {
    s.classList.remove('active');
    s.style.display = 'none';
  });
  const el = $('#screen-'+name);
  if (el) {
    el.classList.add('active');
    el.style.display = name === 'board' ? 'block' : 'flex';
  }
  State.currentScreen = name;
}
function initials(name){ if(!name) return '?'; return name.trim().split(/\s+/).map(w=>w[0]||'').slice(0,2).join('').toUpperCase(); }
function formatRelative(d){
  if(!d) return '';
  const diff = (Date.now() - new Date(d).getTime())/1000;
  if(diff<60) return 'gerade eben';
  if(diff<3600) return Math.floor(diff/60)+' Min.';
  if(diff<86400) return Math.floor(diff/3600)+' Std.';
  if(diff<604800) return Math.floor(diff/86400)+' Tage';
  return new Date(d).toLocaleDateString('de-DE',{day:'numeric',month:'short',year:'numeric'});
}

/* Modal helpers */
function openModal(id){ const m = document.getElementById(id); if(m) m.classList.add('visible'); }
function closeModal(id){ const m = document.getElementById(id); if(m) m.classList.remove('visible'); }
window.closeModal = closeModal;

function confirmDialog(title, text, danger=true){
  return new Promise(resolve => {
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    const yes = $('#confirm-yes'), no = $('#confirm-no');
    yes.className = danger ? 'btn-danger' : 'btn-primary';
    yes.style.flex = '1';
    const cleanup = (val) => {
      closeModal('modal-confirm');
      yes.onclick = null; no.onclick = null;
      resolve(val);
    };
    yes.onclick = ()=>cleanup(true);
    no.onclick = ()=>cleanup(false);
    openModal('modal-confirm');
  });
}

/* ════════════════════════════════════════════════════════════
   AUTH
   ════════════════════════════════════════════════════════════ */
async function loadProfile(){
  if(!State.user) return;
  State.profile = {
    id: State.user.id,
    email: State.user.email,
    full_name: State.user.user_metadata?.full_name || State.user.email,
    position: '',
    avatar_url: null,
    app_role: 'reader',
  };
  renderHeaderUser();
  try {
    const { data } = await sb.schema('users').from('profiles')
      .select('id,email,full_name,position,avatar_url,app_role')
      .eq('id', State.user.id).maybeSingle();
    if (data) State.profile = data;
  } catch (_) {}
  renderHeaderUser();
}

function renderHeaderUser(){
  const p = State.profile || {};
  const av = $('#user-avatar');
  const nm = $('#user-name-topbar');
  const name = p.full_name || p.email || '…';
  if (nm) nm.textContent = p.position ? `${name} · ${p.position}` : name;
  if (!av) return;
  if (p.avatar_url) {
    av.innerHTML = `<img src="${p.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="" />`;
    av.style.background = 'transparent';
  } else {
    av.textContent = initials(p.full_name || p.email);
    av.style.background = '';
  }
}

async function handleLogin(e){
  e.preventDefault();
  const email = $('#login-email').value.trim();
  const password = $('#login-password').value;
  const name = $('#login-name').value.trim();
  const btn = $('#btn-login');
  const alert = $('#login-alert');
  alert.classList.remove('visible');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch spin"></i> ' + (State.authMode==='signup'?'Registrieren…':'Anmelden…');
  try {
    if(State.authMode === 'signup'){
      if(!name){ throw new Error('Bitte gib deinen Namen ein.'); }
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: name } } });
      if(error) throw error;
      if(data?.user && !data.session){
        alert.textContent = 'Bitte bestätige deine E-Mail-Adresse.';
        alert.style.background = 'var(--success-light)';
        alert.style.color = 'var(--success)';
        alert.style.borderLeftColor = 'var(--success)';
        alert.classList.add('visible');
      }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if(error) throw error;
    }
  } catch(err){
    alert.textContent = err.message || 'Anmeldung fehlgeschlagen.';
    alert.style.background = 'var(--danger-light)';
    alert.style.color = 'var(--danger)';
    alert.style.borderLeftColor = 'var(--danger)';
    alert.classList.add('visible');
  } finally {
    btn.disabled = false;
    btn.innerHTML = State.authMode==='signup' ? '<i class="fa-solid fa-user-plus"></i> Registrieren' : '<i class="fa-solid fa-arrow-right-to-bracket"></i> Anmelden';
  }
}

function setAuthMode(mode){
  State.authMode = mode;
  $('#g-name').style.display = mode==='signup' ? 'block' : 'none';
  $('#login-title').textContent = mode==='signup' ? 'Konto erstellen' : 'Whiteboard';
  $('#login-sub').textContent = mode==='signup' ? 'Lege ein neues ROOTS-Konto an.' : 'Melde dich mit deinem ROOTS-Konto an';
  $('#btn-login').innerHTML = mode==='signup' ? '<i class="fa-solid fa-user-plus"></i> Registrieren' : '<i class="fa-solid fa-arrow-right-to-bracket"></i> Anmelden';
  $('#link-toggle').textContent = mode==='signup' ? 'Zur Anmeldung' : 'Registrieren';
  $('#login-alert').classList.remove('visible');
}

async function handleLogout(){
  if (document.documentElement.classList.contains('in-iframe')) {
    try {
      window.parent.postMessage({ type: 'roots-request-signout' }, 'https://pgoutzeris-stack.github.io');
    } catch (_) {}
    return;
  }
  await sb.auth.signOut();
}

/* ════════════════════════════════════════════════════════════
   DASHBOARD
   ════════════════════════════════════════════════════════════ */
async function loadBoards(){
  if(!State.user) return;
  let q = sb.from('wb_boards').select('*').order('updated_at',{ascending:false});
  const { data, error } = await q;
  if(error){ toast(error.message, 'error'); return; }
  State.boards = data || [];
  renderBoardsView();
}

function renderBoardsView(){
  const grid = $('#boards-grid');
  const view = State.dashView;
  const q = State.searchQuery.trim().toLowerCase();
  $('#dash-view-title').textContent = {
    'my-boards':'Meine Boards','shared':'Geteilt mit mir','favorites':'Favoriten',
    'recent':'Zuletzt geöffnet','templates':'Vorlagen','trash':'Papierkorb'
  }[view] || 'Boards';

  if(view === 'templates'){
    grid.style.display = 'none';
    let cont = $('#templates-view'); if(!cont){ cont = document.createElement('div'); cont.id='templates-view'; cont.className='templates-grid'; $('#dash-content').appendChild(cont); }
    cont.innerHTML = TEMPLATES.map(t => `
      <div class="template-card" data-template="${t.key}">
        <div class="template-icon"><i class="fa-solid ${t.icon}"></i></div>
        <div class="template-name">${escapeHtml(t.name)}</div>
        <div class="template-desc">${escapeHtml(t.desc)}</div>
      </div>`).join('');
    cont.style.display = 'grid';
    cont.querySelectorAll('.template-card').forEach(c => c.onclick = () => createBoardFromTemplate(c.dataset.template));
    return;
  } else {
    const tv = $('#templates-view'); if(tv) tv.style.display = 'none';
    grid.style.display = 'grid';
  }

  let list = State.boards.slice();
  if(view === 'my-boards') list = list.filter(b => b.owner_id === State.user.id);
  if(view === 'shared') list = list.filter(b => b.owner_id !== State.user.id);
  if(view === 'recent') list = list.slice().sort((a,b)=> new Date(b.last_opened_at||0) - new Date(a.last_opened_at||0)).slice(0,12);
  if(q) list = list.filter(b => (b.title||'').toLowerCase().includes(q) || (b.description||'').toLowerCase().includes(q));

  if(list.length === 0){
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <i class="fa-solid fa-table-cells-large"></i>
      <h3>Keine Boards</h3>
      <p>Erstelle dein erstes Whiteboard mit dem Button oben rechts.</p>
    </div>`;
    return;
  }

  grid.innerHTML = `
    <div class="create-card" id="create-card-empty"><i class="fa-solid fa-plus"></i> Neues Board</div>
  ` + list.map(b => `
    <div class="board-card" data-id="${b.id}">
      <div class="board-thumb">
        ${b.thumbnail ? `<img src="${b.thumbnail}" alt="" />` : `<div class="board-thumb-empty"><i class="fa-regular fa-image"></i></div>`}
      </div>
      <div class="board-actions">
        <button class="board-action-btn" data-act="rename" data-id="${b.id}" title="Umbenennen"><i class="fa-solid fa-pen"></i></button>
        <button class="board-action-btn" data-act="duplicate" data-id="${b.id}" title="Duplizieren"><i class="fa-regular fa-clone"></i></button>
        <button class="board-action-btn" data-act="delete" data-id="${b.id}" title="Löschen"><i class="fa-solid fa-trash"></i></button>
      </div>
      <div class="board-meta">
        <div class="board-name">${escapeHtml(b.title || 'Unbenannt')}</div>
        <div class="board-sub"><i class="fa-regular fa-clock" style="font-size:.7rem"></i> ${formatRelative(b.updated_at)}</div>
      </div>
    </div>
  `).join('');

  grid.querySelector('#create-card-empty').onclick = () => openModal('modal-new-board');
  grid.querySelectorAll('.board-card').forEach(c => {
    c.onclick = (e) => {
      if(e.target.closest('.board-action-btn')) return;
      openBoard(c.dataset.id);
    };
  });
  grid.querySelectorAll('.board-action-btn').forEach(b => {
    b.onclick = (e) => {
      e.stopPropagation();
      const id = b.dataset.id;
      const act = b.dataset.act;
      if(act === 'rename') renameBoard(id);
      if(act === 'duplicate') duplicateBoard(id);
      if(act === 'delete') deleteBoard(id);
    };
  });
}

async function renameBoard(id){
  const b = State.boards.find(x => x.id === id);
  if(!b) return;
  const name = await rootsPrompt({ title: 'Board umbenennen', label: 'Neuer Name', value: b.title || '', okLabel: 'Speichern' });
  if(!name) return;
  const { error } = await sb.from('wb_boards').update({ title: name }).eq('id', id);
  if(error){ toast(error.message,'error'); return; }
  b.title = name;
  renderBoardsView();
  toast('Board umbenannt', 'success');
}

async function duplicateBoard(id){
  const b = State.boards.find(x => x.id === id);
  if(!b) return;
  const { data: newBoard, error } = await sb.from('wb_boards').insert({
    owner_id: State.user.id,
    title: (b.title||'Board') + ' (Kopie)',
    description: b.description,
    background: b.background
  }).select().single();
  if(error){ toast(error.message,'error'); return; }
  // Copy objects
  const { data: objs } = await sb.from('wb_objects').select('*').eq('board_id', id);
  if(objs && objs.length){
    const copies = objs.map(o => ({
      board_id: newBoard.id, type: o.type, x: o.x, y: o.y, width: o.width, height: o.height,
      rotation: o.rotation, z_index: o.z_index, data: o.data, created_by: State.user.id
    }));
    await sb.from('wb_objects').insert(copies);
  }
  await loadBoards();
  toast('Board dupliziert', 'success');
}

async function deleteBoard(id){
  const b = State.boards.find(x => x.id === id);
  if(!b) return;
  const ok = await confirmDialog('Board löschen?', `"${b.title}" wird unwiderruflich gelöscht.`);
  if(!ok) return;
  const { error } = await sb.from('wb_boards').delete().eq('id', id);
  if(error){ toast(error.message,'error'); return; }
  State.boards = State.boards.filter(x => x.id !== id);
  renderBoardsView();
  toast('Board gelöscht', 'success');
}

async function createBoardFromTemplate(key){
  closeModal('modal-new-board');
  const tpl = TEMPLATES.find(t => t.key === key);
  const { data: board, error } = await sb.from('wb_boards').insert({
    owner_id: State.user.id,
    title: (tpl?.name === 'Leer' ? 'Neues Board' : tpl?.name || 'Neues Board'),
    template_key: key
  }).select().single();
  if(error){ toast(error.message,'error'); return; }
  // Insert template objects
  const tplObjs = templateObjects(key, board.id);
  if(tplObjs.length){
    await sb.from('wb_objects').insert(tplObjs);
  }
  await loadBoards();
  openBoard(board.id);
}

function templateObjects(key, boardId){
  const o = (type, x, y, w, h, data={}, z=0) => ({
    board_id: boardId, type, x, y, width: w, height: h, z_index: z, data, created_by: State.user.id
  });
  const text = (x,y,t,size=16,bold=true) => o('text', x, y, 200, 30, {text:t, fontSize:size, bold});
  const sticky = (x,y,t,c) => o('sticky', x, y, 180, 180, {text:t||'', color:c||'#fef3c7'});
  if(key === 'kanban'){
    const arr = [];
    const cols = ['To Do', 'In Arbeit', 'Erledigt'];
    cols.forEach((c, i) => {
      const x = 100 + i*420;
      arr.push(o('frame', x, 100, 380, 600, {name:c, color:'#f1f5f9'}));
      arr.push(text(x+20, 120, c, 18));
    });
    return arr;
  }
  if(key === 'retro'){
    const arr = [];
    const cols = [['Gut gelaufen','#d1fae5'],['Schlecht gelaufen','#fecaca'],['Aktionen','#dbeafe']];
    cols.forEach(([n,c], i) => {
      const x = 100 + i*420;
      arr.push(o('frame', x, 100, 380, 600, {name:n, color:c}));
      arr.push(text(x+20, 120, n, 18));
    });
    return arr;
  }
  if(key === 'brainstorm'){
    const arr = [text(400, 100, 'Brainstorming – Thema', 22)];
    const colors = ['#fef3c7','#fce7f3','#d1fae5','#dbeafe','#ede9fe','#fed7aa'];
    for(let i=0;i<6;i++){
      arr.push(sticky(100 + (i%3)*220, 200 + Math.floor(i/3)*220, '', colors[i]));
    }
    return arr;
  }
  if(key === 'swot'){
    const arr = [];
    const quads = [['Stärken','#d1fae5',0,0],['Schwächen','#fecaca',1,0],['Chancen','#dbeafe',0,1],['Risiken','#fef3c7',1,1]];
    quads.forEach(([n,c,cx,cy]) => {
      arr.push(o('frame', 100+cx*420, 100+cy*340, 400, 320, {name:n, color:c}));
      arr.push(text(120+cx*420, 120+cy*340, n, 16));
    });
    return arr;
  }
  if(key === 'mindmap'){
    const cx = 600, cy = 400;
    const arr = [
      o('circle', cx-80, cy-40, 160, 80, {fill:'#206efb', text:'Zentralthema', textColor:'#ffffff', fontSize:16, bold:true})
    ];
    const angles = [0, Math.PI/3, 2*Math.PI/3, Math.PI, 4*Math.PI/3, 5*Math.PI/3];
    angles.forEach((a, i) => {
      const x = cx + Math.cos(a)*220, y = cy + Math.sin(a)*180;
      arr.push(o('circle', x-60, y-30, 120, 60, {fill:'#eff6ff', text:'Idee '+(i+1), textColor:'#206efb', fontSize:14}));
    });
    return arr;
  }
  if(key === 'journey'){
    const phases = ['Bewusstsein','Überlegung','Entscheidung','Erlebnis','Bindung'];
    const arr = [text(100, 80, 'Customer Journey', 22)];
    phases.forEach((p, i) => {
      const x = 100 + i*240;
      arr.push(o('rect', x, 140, 200, 80, {fill:'#dbeafe', text:p, fontSize:14, bold:true, textColor:'#206efb'}));
      arr.push(o('rect', x, 240, 200, 200, {fill:'#ffffff', text:'Touchpoints…', fontSize:12, textColor:'#475569'}));
    });
    return arr;
  }
  if(key === 'flowchart'){
    return [
      o('rect', 200, 100, 160, 60, {fill:'#10b981', text:'Start', textColor:'#fff', fontSize:14, bold:true}),
      o('rect', 200, 220, 160, 60, {fill:'#206efb', text:'Schritt 1', textColor:'#fff', fontSize:14}),
      o('diamond', 200, 340, 160, 100, {fill:'#f59e0b', text:'Entscheidung?', textColor:'#fff', fontSize:13}),
      o('rect', 200, 480, 160, 60, {fill:'#dc2626', text:'Ende', textColor:'#fff', fontSize:14, bold:true})
    ];
  }
  return [];
}

function renderNewBoardModal(){
  $('#new-board-templates').innerHTML = TEMPLATES.map(t => `
    <div class="template-card" data-template="${t.key}">
      <div class="template-icon"><i class="fa-solid ${t.icon}"></i></div>
      <div class="template-name">${escapeHtml(t.name)}</div>
      <div class="template-desc">${escapeHtml(t.desc)}</div>
    </div>`).join('');
  $('#new-board-templates').querySelectorAll('.template-card').forEach(c =>
    c.onclick = () => createBoardFromTemplate(c.dataset.template)
  );
}

/* ════════════════════════════════════════════════════════════
   BOARD VIEW + CANVAS
   ════════════════════════════════════════════════════════════ */
let bgCanvas, mainCanvas, uiCanvas, bgCtx, mainCtx, uiCtx, mmCanvas, mmCtx;
let canvasWrap;
let dpr = window.devicePixelRatio || 1;

async function openBoard(id){
  // Load board
  const { data: board, error } = await sb.from('wb_boards').select('*').eq('id', id).single();
  if(error){ toast(error.message, 'error'); return; }
  State.board = board;
  await sb.from('wb_boards').update({ last_opened_at: new Date().toISOString() }).eq('id', id);

  // Load objects
  const { data: objs } = await sb.from('wb_objects').select('*').eq('board_id', id);
  State.objects.clear();
  (objs || []).forEach(o => State.objects.set(o.id, o));
  State.selected.clear();

  // Reset view
  State.zoom = 1; State.panX = 0; State.panY = 0;
  pushHistory(true); // save initial state

  // Switch screen
  showScreen('board');
  $('#board-title').value = board.title || 'Unbenannt';

  // Resize canvases
  initCanvas();
  scheduleRender();

  // Wire realtime
  setupRealtime();

  // Fit to content
  if(State.objects.size > 0) setTimeout(zoomToFit, 100);
}

function initCanvas(){
  canvasWrap = $('#canvas-wrap');
  bgCanvas = $('#canvas-bg');
  mainCanvas = $('#canvas-main');
  uiCanvas = $('#canvas-ui');
  mmCanvas = $('#minimap-canvas');
  bgCtx = bgCanvas.getContext('2d');
  mainCtx = mainCanvas.getContext('2d');
  uiCtx = uiCanvas.getContext('2d');
  mmCtx = mmCanvas.getContext('2d');
  resizeCanvas();
}

function resizeCanvas(){
  const w = canvasWrap.clientWidth;
  const h = canvasWrap.clientHeight;
  [bgCanvas, mainCanvas, uiCanvas].forEach(c => {
    c.width = w * dpr;
    c.height = h * dpr;
    c.style.width = w + 'px';
    c.style.height = h + 'px';
  });
  bgCtx.setTransform(dpr,0,0,dpr,0,0);
  mainCtx.setTransform(dpr,0,0,dpr,0,0);
  uiCtx.setTransform(dpr,0,0,dpr,0,0);
  const mw = mmCanvas.clientWidth, mh = mmCanvas.clientHeight;
  mmCanvas.width = mw * dpr; mmCanvas.height = mh * dpr;
  mmCtx.setTransform(dpr,0,0,dpr,0,0);
}

/* ─── Coordinate transforms ─────────────────────── */
function screenToWorld(sx, sy){
  return { x: (sx - State.panX) / State.zoom, y: (sy - State.panY) / State.zoom };
}
function worldToScreen(wx, wy){
  return { x: wx * State.zoom + State.panX, y: wy * State.zoom + State.panY };
}

/* ─── Rendering ─────────────────────── */
let renderRAF = null;
function scheduleRender(){ if(renderRAF) return; renderRAF = requestAnimationFrame(() => { renderRAF = null; render(); }); }

function render(){
  if(!bgCtx) return;
  const w = bgCanvas.clientWidth, h = bgCanvas.clientHeight;
  // Background
  bgCtx.clearRect(0,0,w,h);
  drawBackground(bgCtx, w, h);
  // Main objects
  mainCtx.clearRect(0,0,w,h);
  mainCtx.save();
  mainCtx.translate(State.panX, State.panY);
  mainCtx.scale(State.zoom, State.zoom);
  const sorted = Array.from(State.objects.values()).sort((a,b)=> (a.z_index||0) - (b.z_index||0));
  for(const obj of sorted){
    if(!isInViewport(obj, w, h)) continue;
    drawObject(mainCtx, obj);
  }
  // Workshop highlight (dim outside current frame)
  if(State.workshopMode){
    const frames = sorted.filter(o => o.type === 'frame');
    const cur = frames[State.workshopIndex];
    if(cur){
      mainCtx.fillStyle = 'rgba(15,23,42,.6)';
      mainCtx.beginPath();
      mainCtx.rect(-1e6,-1e6, 2e6, 2e6);
      mainCtx.rect(cur.x, cur.y, cur.width, cur.height);
      mainCtx.fill('evenodd');
    }
  }
  mainCtx.restore();
  // UI layer (selection handles, marquee, hover, cursors)
  drawUI();
  // Minimap
  drawMinimap();
  // HTML overlay transform (for inline text editors)
  const ov = $('#canvas-overlay');
  if(ov) ov.style.transform = `translate(${State.panX}px, ${State.panY}px) scale(${State.zoom})`;
}

function isInViewport(obj, w, h){
  if(obj.type === 'path' || obj.type === 'line' || obj.type === 'arrow'){
    // Use bounding box from data.bbox or width/height
    const b = getBBox(obj);
    const tl = worldToScreen(b.x, b.y);
    const br = worldToScreen(b.x + b.w, b.y + b.h);
    return !(br.x < -50 || tl.x > w+50 || br.y < -50 || tl.y > h+50);
  }
  const tl = worldToScreen(obj.x, obj.y);
  const br = worldToScreen(obj.x + (obj.width||0), obj.y + (obj.height||0));
  return !(br.x < -50 || tl.x > w+50 || br.y < -50 || tl.y > h+50);
}

function getBBox(obj){
  if(obj.type === 'path' && obj.data?.points){
    const pts = obj.data.points;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const p of pts){ minX=Math.min(minX,p[0]); minY=Math.min(minY,p[1]); maxX=Math.max(maxX,p[0]); maxY=Math.max(maxY,p[1]); }
    return { x: minX-4, y: minY-4, w: (maxX-minX)+8, h: (maxY-minY)+8 };
  }
  return { x: obj.x, y: obj.y, w: obj.width||0, h: obj.height||0 };
}

function drawBackground(ctx, w, h){
  ctx.fillStyle = '#f4f7fb';
  // App-bg in dark mode handled by CSS; canvas fill in light only for export consistency
  if(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches){
    ctx.fillStyle = '#0b1220';
  }
  ctx.fillRect(0,0,w,h);
  const bgType = State.board?.background || 'dots';
  if(bgType === 'plain') return;
  const gridSize = 32 * State.zoom;
  if(gridSize < 6) return;
  ctx.fillStyle = 'rgba(148,163,184,.45)';
  ctx.strokeStyle = 'rgba(148,163,184,.25)';
  const offX = (State.panX % gridSize + gridSize) % gridSize;
  const offY = (State.panY % gridSize + gridSize) % gridSize;
  if(bgType === 'dots'){
    for(let x = offX; x < w; x += gridSize){
      for(let y = offY; y < h; y += gridSize){
        ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI*2); ctx.fill();
      }
    }
  } else if(bgType === 'grid'){
    ctx.lineWidth = 1;
    for(let x = offX; x < w; x += gridSize){
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
    }
    for(let y = offY; y < h; y += gridSize){
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
    }
  }
}

function drawObject(ctx, obj){
  const d = obj.data || {};
  ctx.save();
  if(obj.rotation){
    ctx.translate(obj.x + obj.width/2, obj.y + obj.height/2);
    ctx.rotate(obj.rotation * Math.PI/180);
    ctx.translate(-(obj.x + obj.width/2), -(obj.y + obj.height/2));
  }
  if(obj.type === 'sticky'){
    ctx.fillStyle = d.color || '#fef3c7';
    ctx.shadowColor = 'rgba(0,0,0,.12)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    if(d.text){ drawWrappedText(ctx, d.text, obj.x+12, obj.y+12, obj.width-24, obj.height-24, d.fontSize||16, d.textColor||'#0f172a', d.bold, d.italic, 'left'); }
  } else if(obj.type === 'rect' || obj.type === 'frame'){
    const isFrame = obj.type === 'frame';
    ctx.fillStyle = d.fill || (isFrame ? '#ffffff' : '#ffffff');
    ctx.strokeStyle = d.stroke || '#0f172a';
    ctx.lineWidth = (d.strokeWidth ?? (isFrame?1:2)) / State.zoom * State.zoom;
    if(d.fill !== 'transparent') ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
    if(isFrame){
      ctx.strokeStyle = '#cbd5e1';
      ctx.setLineDash([4,4]);
    }
    if(d.strokeWidth !== 0) ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
    ctx.setLineDash([]);
    if(isFrame && d.name){
      ctx.fillStyle = '#475569';
      ctx.font = 'bold 13px "Circular Std", system-ui';
      ctx.fillText(d.name, obj.x + 8, obj.y - 6);
    }
    if(d.text){ drawWrappedText(ctx, d.text, obj.x+10, obj.y+10, obj.width-20, obj.height-20, d.fontSize||16, d.textColor||'#0f172a', d.bold, d.italic, 'center'); }
  } else if(obj.type === 'circle'){
    ctx.fillStyle = d.fill || '#ffffff';
    ctx.strokeStyle = d.stroke || '#0f172a';
    ctx.lineWidth = (d.strokeWidth ?? 2);
    ctx.beginPath();
    ctx.ellipse(obj.x + obj.width/2, obj.y + obj.height/2, obj.width/2, obj.height/2, 0, 0, Math.PI*2);
    if(d.fill !== 'transparent') ctx.fill();
    if(d.strokeWidth !== 0) ctx.stroke();
    if(d.text){ drawWrappedText(ctx, d.text, obj.x+12, obj.y+12, obj.width-24, obj.height-24, d.fontSize||16, d.textColor||'#0f172a', d.bold, d.italic, 'center'); }
  } else if(obj.type === 'triangle'){
    ctx.fillStyle = d.fill || '#ffffff';
    ctx.strokeStyle = d.stroke || '#0f172a';
    ctx.lineWidth = (d.strokeWidth ?? 2);
    ctx.beginPath();
    ctx.moveTo(obj.x + obj.width/2, obj.y);
    ctx.lineTo(obj.x + obj.width, obj.y + obj.height);
    ctx.lineTo(obj.x, obj.y + obj.height);
    ctx.closePath();
    if(d.fill !== 'transparent') ctx.fill();
    if(d.strokeWidth !== 0) ctx.stroke();
  } else if(obj.type === 'diamond'){
    ctx.fillStyle = d.fill || '#ffffff';
    ctx.strokeStyle = d.stroke || '#0f172a';
    ctx.lineWidth = (d.strokeWidth ?? 2);
    ctx.beginPath();
    ctx.moveTo(obj.x + obj.width/2, obj.y);
    ctx.lineTo(obj.x + obj.width, obj.y + obj.height/2);
    ctx.lineTo(obj.x + obj.width/2, obj.y + obj.height);
    ctx.lineTo(obj.x, obj.y + obj.height/2);
    ctx.closePath();
    if(d.fill !== 'transparent') ctx.fill();
    if(d.strokeWidth !== 0) ctx.stroke();
    if(d.text){ drawWrappedText(ctx, d.text, obj.x+obj.width*0.2, obj.y+obj.height*0.3, obj.width*0.6, obj.height*0.4, d.fontSize||14, d.textColor||'#0f172a', d.bold, d.italic, 'center'); }
  } else if(obj.type === 'text'){
    drawWrappedText(ctx, d.text || 'Text', obj.x, obj.y, obj.width, obj.height, d.fontSize||16, d.textColor||'#0f172a', d.bold, d.italic, d.align||'left', d.underline);
  } else if(obj.type === 'line' || obj.type === 'arrow'){
    const x1 = obj.x, y1 = obj.y;
    const x2 = obj.x + obj.width, y2 = obj.y + obj.height;
    ctx.strokeStyle = d.stroke || '#0f172a';
    ctx.lineWidth = d.strokeWidth || 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    if(obj.type === 'arrow'){
      const angle = Math.atan2(y2-y1, x2-x1);
      const ah = 12;
      ctx.fillStyle = d.stroke || '#0f172a';
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - ah * Math.cos(angle - Math.PI/6), y2 - ah * Math.sin(angle - Math.PI/6));
      ctx.lineTo(x2 - ah * Math.cos(angle + Math.PI/6), y2 - ah * Math.sin(angle + Math.PI/6));
      ctx.closePath();
      ctx.fill();
    }
  } else if(obj.type === 'path'){
    const pts = d.points || [];
    if(pts.length < 2){ ctx.restore(); return; }
    ctx.strokeStyle = d.stroke || '#0f172a';
    ctx.lineWidth = d.strokeWidth || 3;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for(let i=1; i<pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  } else if(obj.type === 'image'){
    if(!obj._img && d.src){
      obj._img = new Image();
      obj._img.onload = () => scheduleRender();
      obj._img.src = d.src;
    }
    if(obj._img && obj._img.complete){
      ctx.drawImage(obj._img, obj.x, obj.y, obj.width, obj.height);
    } else {
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '13px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('Bild lädt…', obj.x + obj.width/2, obj.y + obj.height/2);
    }
  }
  if(obj.locked){
    ctx.fillStyle = 'rgba(148,163,184,.7)';
    ctx.font = '12px "Font Awesome 6 Free"';
    ctx.fillText('🔒', obj.x + obj.width - 16, obj.y + 14);
  }
  ctx.restore();
}

function drawWrappedText(ctx, text, x, y, w, h, size, color, bold, italic, align, underline){
  ctx.save();
  let weight = bold ? '700' : '400';
  let style = italic ? 'italic' : 'normal';
  ctx.font = `${style} ${weight} ${size}px "Circular Std", system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align || 'left';
  ctx.textBaseline = 'top';
  const lines = wrapText(ctx, text, w);
  const lineH = size * 1.3;
  const totalH = lines.length * lineH;
  let yOff = y;
  // If align center horizontally also center vertically when used in shapes
  if(align === 'center'){
    yOff = y + (h - totalH) / 2;
  }
  lines.forEach((ln, i) => {
    let tx = x;
    if(align === 'center') tx = x + w/2;
    if(align === 'right') tx = x + w;
    const ty = yOff + i*lineH;
    ctx.fillText(ln, tx, ty);
    if(underline){
      const wMetric = ctx.measureText(ln).width;
      let ux = tx;
      if(align === 'center') ux = tx - wMetric/2;
      if(align === 'right') ux = tx - wMetric;
      ctx.fillRect(ux, ty + size*0.95, wMetric, 1);
    }
  });
  ctx.restore();
}
function wrapText(ctx, text, maxW){
  const result = [];
  const paragraphs = String(text).split('\n');
  for(const para of paragraphs){
    const words = para.split(' ');
    let line = '';
    for(const w of words){
      const test = line ? line + ' ' + w : w;
      if(ctx.measureText(test).width > maxW && line){
        result.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if(line) result.push(line);
    if(!para) result.push('');
  }
  return result;
}

function drawUI(){
  const w = uiCanvas.clientWidth, h = uiCanvas.clientHeight;
  uiCtx.clearRect(0,0,w,h);
  uiCtx.save();
  uiCtx.translate(State.panX, State.panY);
  uiCtx.scale(State.zoom, State.zoom);
  // Selection rectangles
  for(const id of State.selected){
    const obj = State.objects.get(id);
    if(!obj) continue;
    const b = getBBox(obj);
    uiCtx.strokeStyle = '#206efb';
    uiCtx.lineWidth = 1.5 / State.zoom;
    uiCtx.setLineDash([4 / State.zoom, 2 / State.zoom]);
    uiCtx.strokeRect(b.x - 2/State.zoom, b.y - 2/State.zoom, b.w + 4/State.zoom, b.h + 4/State.zoom);
    uiCtx.setLineDash([]);
    // Resize handles (only for non-line types when single selection)
    if(State.selected.size === 1 && !['line','arrow','path'].includes(obj.type)){
      const s = 8 / State.zoom;
      const handles = [
        [b.x, b.y, 'nw'], [b.x+b.w/2, b.y, 'n'], [b.x+b.w, b.y, 'ne'],
        [b.x+b.w, b.y+b.h/2, 'e'], [b.x+b.w, b.y+b.h, 'se'],
        [b.x+b.w/2, b.y+b.h, 's'], [b.x, b.y+b.h, 'sw'], [b.x, b.y+b.h/2, 'w']
      ];
      uiCtx.fillStyle = '#fff';
      uiCtx.strokeStyle = '#206efb';
      uiCtx.lineWidth = 1.5 / State.zoom;
      handles.forEach(([hx,hy]) => {
        uiCtx.fillRect(hx - s/2, hy - s/2, s, s);
        uiCtx.strokeRect(hx - s/2, hy - s/2, s, s);
      });
      // Rotation handle
      const rx = b.x + b.w/2, ry = b.y - 24/State.zoom;
      uiCtx.beginPath();
      uiCtx.moveTo(b.x + b.w/2, b.y);
      uiCtx.lineTo(rx, ry);
      uiCtx.stroke();
      uiCtx.beginPath();
      uiCtx.arc(rx, ry, s, 0, Math.PI*2);
      uiCtx.fill();
      uiCtx.stroke();
    }
  }
  // Hover outline
  if(State.hoverId && !State.selected.has(State.hoverId) && !State.isDragging){
    const obj = State.objects.get(State.hoverId);
    if(obj){
      const b = getBBox(obj);
      uiCtx.strokeStyle = '#206efb';
      uiCtx.lineWidth = 1 / State.zoom;
      uiCtx.strokeRect(b.x, b.y, b.w, b.h);
    }
  }
  // Marquee
  if(State.isMarquee && State.marqueeStart && State.cursorPos){
    const a = State.marqueeStart, b = State.cursorPos;
    const x = Math.min(a.x,b.x), y = Math.min(a.y,b.y);
    const w = Math.abs(b.x-a.x), h2 = Math.abs(b.y-a.y);
    uiCtx.fillStyle = 'rgba(32,110,251,.08)';
    uiCtx.strokeStyle = '#206efb';
    uiCtx.lineWidth = 1 / State.zoom;
    uiCtx.fillRect(x,y,w,h2);
    uiCtx.strokeRect(x,y,w,h2);
  }
  // Draft object
  if(State.draftObject){
    drawObject(uiCtx, State.draftObject);
  }
  uiCtx.restore();
  // Live cursors (in screen coords)
  drawLiveCursors();
}

function drawLiveCursors(){
  // remove existing cursor elements then re-add
  const wrap = canvasWrap;
  if(!wrap) return;
  let layer = wrap.querySelector('.cursors-layer');
  if(!layer){ layer = document.createElement('div'); layer.className='cursors-layer'; layer.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:150'; wrap.appendChild(layer); }
  const existing = new Map();
  layer.querySelectorAll('.live-cursor').forEach(e => existing.set(e.dataset.uid, e));
  State.presence.forEach((p, uid) => {
    if(uid === State.user.id || !p.cursor) { existing.delete(uid); return; }
    let el = existing.get(uid);
    if(!el){
      el = document.createElement('div');
      el.className = 'live-cursor';
      el.dataset.uid = uid;
      el.innerHTML = `<svg viewBox="0 0 24 24" fill="${p.color}"><path d="M5.5 3.5 9 21l3-7.5 7.5-3z"/></svg><div class="live-cursor-label" style="background:${p.color}">${escapeHtml(p.name||'Gast')}</div>`;
      layer.appendChild(el);
    }
    const s = worldToScreen(p.cursor.x, p.cursor.y);
    el.style.transform = `translate(${s.x}px, ${s.y}px)`;
    existing.delete(uid);
  });
  // Remove leftover
  existing.forEach(el => el.remove());
}

function drawMinimap(){
  const mw = mmCanvas.clientWidth, mh = mmCanvas.clientHeight;
  mmCtx.clearRect(0,0,mw,mh);
  if(State.objects.size === 0){
    mmCtx.fillStyle = '#f4f7fb';
    mmCtx.fillRect(0,0,mw,mh);
    $('#minimap-viewport').style.display = 'none';
    return;
  }
  // Compute world bounds
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const o of State.objects.values()){
    const b = getBBox(o);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  // Include current viewport
  const wt = screenToWorld(0,0), wb = screenToWorld(canvasWrap.clientWidth, canvasWrap.clientHeight);
  minX = Math.min(minX, wt.x); minY = Math.min(minY, wt.y);
  maxX = Math.max(maxX, wb.x); maxY = Math.max(maxY, wb.y);
  const pad = 50;
  minX-=pad; minY-=pad; maxX+=pad; maxY+=pad;
  const scale = Math.min(mw / (maxX-minX), mh / (maxY-minY));
  mmCtx.fillStyle = '#f4f7fb';
  mmCtx.fillRect(0,0,mw,mh);
  // Draw simplified objects
  for(const o of State.objects.values()){
    const b = getBBox(o);
    const x = (b.x - minX) * scale, y = (b.y - minY) * scale;
    const w = Math.max(2, b.w * scale), h = Math.max(2, b.h * scale);
    const d = o.data || {};
    mmCtx.fillStyle = d.color || d.fill || '#cbd5e1';
    if(o.type === 'sticky') mmCtx.fillStyle = d.color || '#fef3c7';
    if(o.type === 'frame'){ mmCtx.fillStyle = 'rgba(203,213,225,.4)'; mmCtx.strokeStyle = '#94a3b8'; mmCtx.lineWidth = 0.5; mmCtx.strokeRect(x,y,w,h); }
    if(o.type === 'text') mmCtx.fillStyle = '#475569';
    if(o.type !== 'frame') mmCtx.fillRect(x,y,w,h);
  }
  // Draw viewport overlay
  const vx = (wt.x - minX) * scale;
  const vy = (wt.y - minY) * scale;
  const vw = (wb.x - wt.x) * scale;
  const vh = (wb.y - wt.y) * scale;
  const vp = $('#minimap-viewport');
  vp.style.display = 'block';
  vp.style.left = vx + 'px';
  vp.style.top = vy + 'px';
  vp.style.width = vw + 'px';
  vp.style.height = vh + 'px';
}

/* ─── Hit testing ─────────────────────── */
function hitTest(wx, wy){
  const sorted = Array.from(State.objects.values()).sort((a,b)=> (b.z_index||0) - (a.z_index||0));
  for(const obj of sorted){
    if(obj.locked) continue;
    if(hitObject(obj, wx, wy)) return obj;
  }
  return null;
}
function hitObject(obj, x, y){
  const slack = 4 / State.zoom;
  if(obj.type === 'circle'){
    const cx = obj.x + obj.width/2, cy = obj.y + obj.height/2;
    const rx = obj.width/2, ry = obj.height/2;
    return ((x-cx)*(x-cx))/(rx*rx) + ((y-cy)*(y-cy))/(ry*ry) <= 1.05;
  }
  if(obj.type === 'line' || obj.type === 'arrow'){
    const x1 = obj.x, y1 = obj.y, x2 = obj.x + obj.width, y2 = obj.y + obj.height;
    const dist = pointToLineDist(x, y, x1, y1, x2, y2);
    return dist < 6 / State.zoom;
  }
  if(obj.type === 'path'){
    const pts = obj.data?.points || [];
    for(let i=0; i<pts.length-1; i++){
      if(pointToLineDist(x, y, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]) < (obj.data.strokeWidth || 3) + 4/State.zoom) return true;
    }
    return false;
  }
  if(obj.type === 'diamond'){
    const cx = obj.x + obj.width/2, cy = obj.y + obj.height/2;
    const dx = Math.abs(x-cx)/(obj.width/2), dy = Math.abs(y-cy)/(obj.height/2);
    return dx + dy <= 1.05;
  }
  if(obj.type === 'triangle'){
    // Simple bbox
    return x >= obj.x - slack && x <= obj.x + obj.width + slack && y >= obj.y - slack && y <= obj.y + obj.height + slack;
  }
  if(obj.type === 'frame'){
    // Only hit on border
    const inOuter = x >= obj.x - slack && x <= obj.x + obj.width + slack && y >= obj.y - slack && y <= obj.y + obj.height + slack;
    const inInner = x >= obj.x + 12 && x <= obj.x + obj.width - 12 && y >= obj.y + 32 && y <= obj.y + obj.height - 12;
    return inOuter && !inInner;
  }
  return x >= obj.x - slack && x <= obj.x + obj.width + slack && y >= obj.y - slack && y <= obj.y + obj.height + slack;
}
function pointToLineDist(px, py, x1, y1, x2, y2){
  const A = px - x1, B = py - y1, C = x2 - x1, D = y2 - y1;
  const dot = A*C + B*D, lenSq = C*C + D*D;
  let param = lenSq ? dot / lenSq : -1;
  param = clamp(param, 0, 1);
  const xx = x1 + param*C, yy = y1 + param*D;
  return Math.hypot(px - xx, py - yy);
}
function hitHandle(wx, wy){
  if(State.selected.size !== 1) return null;
  const id = Array.from(State.selected)[0];
  const obj = State.objects.get(id);
  if(!obj || ['line','arrow','path'].includes(obj.type)) return null;
  const b = getBBox(obj);
  const s = 12 / State.zoom;
  const handles = [
    [b.x, b.y, 'nw'], [b.x+b.w/2, b.y, 'n'], [b.x+b.w, b.y, 'ne'],
    [b.x+b.w, b.y+b.h/2, 'e'], [b.x+b.w, b.y+b.h, 'se'],
    [b.x+b.w/2, b.y+b.h, 's'], [b.x, b.y+b.h, 'sw'], [b.x, b.y+b.h/2, 'w']
  ];
  for(const [hx,hy,name] of handles){
    if(Math.abs(wx-hx) < s/2 && Math.abs(wy-hy) < s/2) return name;
  }
  // Rotation handle
  const rx = b.x + b.w/2, ry = b.y - 24/State.zoom;
  if(Math.hypot(wx - rx, wy - ry) < s/2) return 'rotate';
  return null;
}

/* ─── Pointer / interaction ─────────────────────── */
function setTool(name){
  const old = State.tool;
  State.tool = name;
  $$('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === name));
  canvasWrap.className = 'canvas-wrap tool-' + name;
  if(name !== old){
    State.draftObject = null;
    if(name !== 'select') State.selected.clear();
    scheduleRender();
    renderPropsPanel();
  }
}

function onCanvasMouseDown(e){
  if(e.button === 1 || (e.button === 0 && e.altKey)){ // middle or alt-click = pan
    startPan(e);
    return;
  }
  const rect = canvasWrap.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const wp = screenToWorld(sx, sy);
  State.cursorPos = wp;

  if(State.tool === 'hand'){
    startPan(e); return;
  }

  if(State.tool === 'select'){
    // Check resize/rotate handles
    const handle = hitHandle(wp.x, wp.y);
    if(handle){
      if(handle === 'rotate'){
        State.isRotating = true;
        State.dragStart = wp;
        State.dragInitial = snapshotSelected();
      } else {
        State.isResizing = true;
        State.resizeHandle = handle;
        State.dragStart = wp;
        State.dragInitial = snapshotSelected();
      }
      return;
    }
    const hit = hitTest(wp.x, wp.y);
    if(hit){
      if(!State.selected.has(hit.id) && !e.shiftKey) State.selected.clear();
      State.selected.add(hit.id);
      State.isDragging = true;
      State.dragStart = wp;
      State.dragInitial = snapshotSelected();
      renderPropsPanel();
    } else {
      if(!e.shiftKey) State.selected.clear();
      State.isMarquee = true;
      State.marqueeStart = wp;
      renderPropsPanel();
    }
    scheduleRender();
    return;
  }

  if(State.tool === 'comment'){
    rootsPrompt({ title: 'Kommentar', label: 'Dein Kommentar', okLabel: 'Hinzufügen', icon: 'fa-comment' }).then(function(text){ if(text && text.trim()){ addComment(wp.x, wp.y, text.trim()); } });
    setTool('select');
    return;
  }

  // Drawing tools
  if(['sticky','text','rect','circle','triangle','diamond','line','arrow','frame'].includes(State.tool)){
    State.isDrawing = true;
    State.dragStart = wp;
    State.draftObject = buildDraftObject(State.tool, wp);
    scheduleRender();
    return;
  }
  if(State.tool === 'path'){
    State.isDrawing = true;
    State.draftObject = {
      id: 'draft', type: 'path', x: wp.x, y: wp.y, width: 0, height: 0,
      data: { points: [[wp.x, wp.y]], stroke: State.style.stroke, strokeWidth: 3 },
      z_index: nextZ()
    };
    return;
  }
  if(State.tool === 'image'){
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => {
      if(!inp.files[0]) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const maxW = 400;
          const ratio = img.naturalHeight / img.naturalWidth;
          const w = Math.min(maxW, img.naturalWidth);
          const h = w * ratio;
          createObject({ type:'image', x: wp.x - w/2, y: wp.y - h/2, width: w, height: h, data: { src: reader.result } });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(inp.files[0]);
    };
    inp.click();
    setTool('select');
  }
}

function buildDraftObject(type, wp){
  const z = nextZ();
  if(type === 'sticky'){
    return { id: 'draft', type, x: wp.x, y: wp.y, width: 180, height: 180, data: { color: State.style.stickyColor, text: '' }, z_index: z };
  }
  if(type === 'text'){
    return { id: 'draft', type, x: wp.x, y: wp.y, width: 200, height: 30, data: { text: 'Text', fontSize: State.style.fontSize, textColor: State.style.text, bold: State.style.bold, italic: State.style.italic, underline: State.style.underline, align: 'left' }, z_index: z };
  }
  if(type === 'frame'){
    return { id: 'draft', type, x: wp.x, y: wp.y, width: 1, height: 1, data: { name: 'Frame', color: '#f8fafc' }, z_index: -10 };
  }
  if(type === 'line' || type === 'arrow'){
    return { id: 'draft', type, x: wp.x, y: wp.y, width: 0, height: 0, data: { stroke: State.style.stroke, strokeWidth: State.style.strokeWidth }, z_index: z };
  }
  return { id: 'draft', type, x: wp.x, y: wp.y, width: 1, height: 1, data: { fill: State.style.fill, stroke: State.style.stroke, strokeWidth: State.style.strokeWidth }, z_index: z };
}

function nextZ(){
  let max = 0;
  State.objects.forEach(o => { if(o.z_index > max) max = o.z_index; });
  return max + 1;
}

function snapshotSelected(){
  const snap = new Map();
  State.selected.forEach(id => {
    const o = State.objects.get(id);
    if(o) snap.set(id, JSON.parse(JSON.stringify({x:o.x,y:o.y,width:o.width,height:o.height,rotation:o.rotation,data:o.data})));
  });
  return snap;
}

function onCanvasMouseMove(e){
  const rect = canvasWrap.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const wp = screenToWorld(sx, sy);
  State.cursorPos = wp;
  broadcastCursor(wp);

  if(State.isPanning){ doPan(e); return; }

  if(State.isDrawing && State.draftObject){
    const d = State.draftObject;
    if(d.type === 'path'){
      d.data.points.push([wp.x, wp.y]);
      scheduleRender();
      return;
    }
    if(d.type === 'line' || d.type === 'arrow'){
      d.width = wp.x - d.x;
      d.height = wp.y - d.y;
    } else {
      const w = wp.x - State.dragStart.x, h = wp.y - State.dragStart.y;
      d.x = Math.min(State.dragStart.x, wp.x);
      d.y = Math.min(State.dragStart.y, wp.y);
      d.width = Math.abs(w) || 1;
      d.height = Math.abs(h) || 1;
    }
    scheduleRender();
    return;
  }

  if(State.isDragging){
    const dx = wp.x - State.dragStart.x;
    const dy = wp.y - State.dragStart.y;
    State.dragInitial.forEach((init, id) => {
      const o = State.objects.get(id);
      if(o){ o.x = init.x + dx; o.y = init.y + dy; }
    });
    scheduleRender();
    return;
  }

  if(State.isResizing && State.selected.size === 1){
    const id = Array.from(State.selected)[0];
    const o = State.objects.get(id);
    const init = State.dragInitial.get(id);
    if(!o || !init) return;
    const dx = wp.x - State.dragStart.x, dy = wp.y - State.dragStart.y;
    let nx = init.x, ny = init.y, nw = init.width, nh = init.height;
    const h = State.resizeHandle;
    if(h.includes('e')) nw = init.width + dx;
    if(h.includes('w')){ nw = init.width - dx; nx = init.x + dx; }
    if(h.includes('s')) nh = init.height + dy;
    if(h.includes('n')){ nh = init.height - dy; ny = init.y + dy; }
    if(nw < 10){ nw = 10; if(h.includes('w')) nx = init.x + init.width - 10; }
    if(nh < 10){ nh = 10; if(h.includes('n')) ny = init.y + init.height - 10; }
    if(e.shiftKey && !['n','s','e','w'].includes(h)){
      // Maintain aspect ratio
      const ar = init.width / init.height;
      if(Math.abs(dx) > Math.abs(dy)) nh = nw / ar; else nw = nh * ar;
    }
    o.x = nx; o.y = ny; o.width = nw; o.height = nh;
    scheduleRender();
    return;
  }

  if(State.isRotating){
    const id = Array.from(State.selected)[0];
    const o = State.objects.get(id);
    const init = State.dragInitial.get(id);
    if(!o) return;
    const cx = init.x + init.width/2, cy = init.y + init.height/2;
    const angle = Math.atan2(wp.y - cy, wp.x - cx) * 180/Math.PI + 90;
    o.rotation = e.shiftKey ? Math.round(angle/15)*15 : angle;
    scheduleRender();
    return;
  }

  if(State.isMarquee){
    scheduleRender();
    return;
  }

  // Hover detection
  if(State.tool === 'select'){
    const hit = hitTest(wp.x, wp.y);
    const newHover = hit ? hit.id : null;
    if(newHover !== State.hoverId){
      State.hoverId = newHover;
      // Update cursor for handle
      const handle = hitHandle(wp.x, wp.y);
      if(handle){
        const cursorMap = { n:'ns-resize', s:'ns-resize', e:'ew-resize', w:'ew-resize', ne:'nesw-resize', sw:'nesw-resize', nw:'nwse-resize', se:'nwse-resize', rotate:'crosshair' };
        canvasWrap.style.cursor = cursorMap[handle] || 'default';
      } else {
        canvasWrap.style.cursor = hit ? 'move' : 'default';
      }
      scheduleRender();
    }
  }
}

function onCanvasMouseUp(e){
  if(State.isPanning){ endPan(); return; }

  if(State.isDrawing && State.draftObject){
    const d = State.draftObject;
    State.draftObject = null;
    State.isDrawing = false;
    // Normalize and create
    if(d.type === 'path'){
      if(d.data.points.length < 2){ scheduleRender(); return; }
      // Compute bounds
      const pts = d.data.points;
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      pts.forEach(p=>{ minX=Math.min(minX,p[0]); minY=Math.min(minY,p[1]); maxX=Math.max(maxX,p[0]); maxY=Math.max(maxY,p[1]); });
      d.x = minX; d.y = minY; d.width = maxX-minX; d.height = maxY-minY;
      createObject(d);
    } else if(d.type === 'line' || d.type === 'arrow'){
      if(Math.abs(d.width) < 5 && Math.abs(d.height) < 5){ scheduleRender(); return; }
      createObject(d);
    } else {
      if(d.width < 8 || d.height < 8){
        // Use default size for small drag (sticky/text)
        if(d.type === 'sticky'){ d.width = 180; d.height = 180; }
        else if(d.type === 'text'){ d.width = 200; d.height = 30; }
        else { scheduleRender(); return; }
      }
      createObject(d);
      if(d.type === 'sticky' || d.type === 'text'){
        // Start inline edit
        setTimeout(() => startInlineEdit(d.id), 50);
      }
    }
    setTool('select');
    return;
  }

  if(State.isDragging){
    State.isDragging = false;
    // Persist changes
    const updates = [];
    State.selected.forEach(id => {
      const o = State.objects.get(id);
      const init = State.dragInitial.get(id);
      if(o && init && (o.x !== init.x || o.y !== init.y)){
        updates.push({ id, x: o.x, y: o.y });
      }
    });
    if(updates.length){ pushHistory(); persistObjects(updates); }
  }

  if(State.isResizing){
    State.isResizing = false;
    const updates = [];
    State.selected.forEach(id => {
      const o = State.objects.get(id);
      const init = State.dragInitial.get(id);
      if(o && init){
        updates.push({ id, x: o.x, y: o.y, width: o.width, height: o.height });
      }
    });
    if(updates.length){ pushHistory(); persistObjects(updates); }
  }

  if(State.isRotating){
    State.isRotating = false;
    const updates = [];
    State.selected.forEach(id => {
      const o = State.objects.get(id);
      updates.push({ id, rotation: o.rotation });
    });
    if(updates.length){ pushHistory(); persistObjects(updates); }
  }

  if(State.isMarquee){
    State.isMarquee = false;
    const a = State.marqueeStart, b = State.cursorPos;
    if(!a) return;
    const x1 = Math.min(a.x,b.x), y1 = Math.min(a.y,b.y);
    const x2 = Math.max(a.x,b.x), y2 = Math.max(a.y,b.y);
    State.objects.forEach(o => {
      const bb = getBBox(o);
      if(bb.x >= x1 && bb.y >= y1 && bb.x+bb.w <= x2 && bb.y+bb.h <= y2){
        State.selected.add(o.id);
      }
    });
    State.marqueeStart = null;
    renderPropsPanel();
    scheduleRender();
  }
}

function onCanvasDoubleClick(e){
  const rect = canvasWrap.getBoundingClientRect();
  const wp = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  const hit = hitTest(wp.x, wp.y);
  if(hit && (['sticky','text','rect','circle','triangle','diamond','frame'].includes(hit.type))){
    startInlineEdit(hit.id);
  }
}

/* Pan handling */
function startPan(e){
  State.isPanning = true;
  State.panStart = { x: e.clientX, y: e.clientY, panX: State.panX, panY: State.panY };
  canvasWrap.classList.add('panning');
}
function doPan(e){
  State.panX = State.panStart.panX + (e.clientX - State.panStart.x);
  State.panY = State.panStart.panY + (e.clientY - State.panStart.y);
  scheduleRender();
}
function endPan(){
  State.isPanning = false;
  canvasWrap.classList.remove('panning');
}

/* Wheel zoom */
function onCanvasWheel(e){
  e.preventDefault();
  if(e.ctrlKey || e.metaKey){
    // Pinch zoom
    const rect = canvasWrap.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const wp = screenToWorld(sx, sy);
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    setZoom(State.zoom * factor, wp.x, wp.y);
  } else {
    // Pan
    State.panX -= e.deltaX;
    State.panY -= e.deltaY;
    scheduleRender();
  }
}
function setZoom(z, fixWX, fixWY){
  const oldZ = State.zoom;
  z = clamp(z, 0.1, 8);
  State.zoom = z;
  if(fixWX !== undefined){
    State.panX = (State.panX - fixWX*oldZ) * (z/oldZ) + fixWX*z;
    State.panY = (State.panY - fixWY*oldZ) * (z/oldZ) + fixWY*z;
  }
  $('#zoom-level').textContent = Math.round(z*100) + '%';
  scheduleRender();
}

function zoomToFit(){
  if(State.objects.size === 0){
    State.zoom = 1; State.panX = 0; State.panY = 0;
    setZoom(1);
    return;
  }
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const o of State.objects.values()){
    const b = getBBox(o);
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x+b.w); maxY = Math.max(maxY, b.y+b.h);
  }
  const pad = 80;
  const w = canvasWrap.clientWidth, h = canvasWrap.clientHeight;
  const z = Math.min((w - 2*pad) / (maxX-minX), (h - 2*pad) / (maxY-minY), 2);
  State.zoom = clamp(z, 0.1, 2);
  State.panX = (w - (maxX-minX) * State.zoom) / 2 - minX * State.zoom;
  State.panY = (h - (maxY-minY) * State.zoom) / 2 - minY * State.zoom;
  $('#zoom-level').textContent = Math.round(State.zoom*100) + '%';
  scheduleRender();
}

/* ─── Object CRUD + persistence ─────────────────────── */
async function createObject(obj){
  const id = uid();
  const newObj = {
    id, board_id: State.board.id,
    type: obj.type, x: obj.x, y: obj.y, width: obj.width, height: obj.height,
    rotation: obj.rotation || 0, z_index: obj.z_index ?? nextZ(),
    data: obj.data || {}, locked: false, created_by: State.user.id, version: 1,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  };
  State.objects.set(id, newObj);
  State.selected.clear();
  State.selected.add(id);
  pushHistory();
  scheduleRender(); renderPropsPanel();
  // Save to DB
  const { error } = await sb.from('wb_objects').insert({
    id, board_id: State.board.id, type: newObj.type, x: newObj.x, y: newObj.y,
    width: newObj.width, height: newObj.height, rotation: newObj.rotation,
    z_index: newObj.z_index, data: newObj.data, created_by: State.user.id
  });
  if(error){ console.warn('Insert failed', error); toast(error.message, 'error'); }
  scheduleBoardTouch();
}

const persistObjects = debounce(async (updates) => {
  for(const u of updates){
    const { id, ...patch } = u;
    await sb.from('wb_objects').update({ ...patch, updated_by: State.user.id }).eq('id', id);
  }
  scheduleBoardTouch();
}, 200);

async function deleteSelected(){
  if(State.selected.size === 0) return;
  const ids = Array.from(State.selected);
  pushHistory();
  ids.forEach(id => State.objects.delete(id));
  State.selected.clear();
  scheduleRender(); renderPropsPanel();
  await sb.from('wb_objects').delete().in('id', ids);
  scheduleBoardTouch();
}

async function duplicateSelected(){
  if(State.selected.size === 0) return;
  const newIds = new Set();
  const inserts = [];
  for(const id of State.selected){
    const o = State.objects.get(id); if(!o) continue;
    const nid = uid();
    const copy = JSON.parse(JSON.stringify(o));
    copy.id = nid; copy.x += 20; copy.y += 20; copy.z_index = nextZ();
    State.objects.set(nid, copy);
    newIds.add(nid);
    inserts.push({ id: nid, board_id: State.board.id, type: copy.type, x: copy.x, y: copy.y,
      width: copy.width, height: copy.height, rotation: copy.rotation, z_index: copy.z_index,
      data: copy.data, created_by: State.user.id });
  }
  State.selected = newIds;
  pushHistory();
  scheduleRender(); renderPropsPanel();
  await sb.from('wb_objects').insert(inserts);
  scheduleBoardTouch();
}

function selectAll(){
  State.selected.clear();
  State.objects.forEach((_,id) => State.selected.add(id));
  renderPropsPanel(); scheduleRender();
}

function copySelected(){
  const arr = [];
  State.selected.forEach(id => { const o = State.objects.get(id); if(o) arr.push(JSON.parse(JSON.stringify(o))); });
  State.clipboard = arr;
}
async function pasteClipboard(){
  if(!State.clipboard || State.clipboard.length === 0) return;
  const newIds = new Set();
  const inserts = [];
  for(const tpl of State.clipboard){
    const nid = uid();
    const o = JSON.parse(JSON.stringify(tpl));
    o.id = nid; o.x += 24; o.y += 24; o.z_index = nextZ();
    State.objects.set(nid, o);
    newIds.add(nid);
    inserts.push({ id: nid, board_id: State.board.id, type: o.type, x: o.x, y: o.y,
      width: o.width, height: o.height, rotation: o.rotation, z_index: o.z_index,
      data: o.data, created_by: State.user.id });
  }
  State.selected = newIds;
  pushHistory();
  scheduleRender(); renderPropsPanel();
  await sb.from('wb_objects').insert(inserts);
  scheduleBoardTouch();
}

async function changeSelectedStyle(patch){
  const updates = [];
  State.selected.forEach(id => {
    const o = State.objects.get(id);
    if(!o) return;
    o.data = { ...(o.data||{}), ...patch };
    updates.push({ id, data: o.data });
  });
  scheduleRender(); renderPropsPanel();
  for(const u of updates){
    await sb.from('wb_objects').update({ data: u.data, updated_by: State.user.id }).eq('id', u.id);
  }
  scheduleBoardTouch();
}

async function changeZOrder(action){
  // action: 'forward','backward','front','back'
  const sorted = Array.from(State.objects.values()).sort((a,b)=>a.z_index-b.z_index);
  const updates = [];
  if(action === 'front'){
    let z = nextZ();
    State.selected.forEach(id => { const o = State.objects.get(id); if(o){ o.z_index = ++z; updates.push({id, z_index: o.z_index}); }});
  } else if(action === 'back'){
    let z = Math.min(...sorted.map(o=>o.z_index)) - 1;
    State.selected.forEach(id => { const o = State.objects.get(id); if(o){ o.z_index = z--; updates.push({id, z_index: o.z_index}); }});
  } else if(action === 'forward'){
    State.selected.forEach(id => { const o = State.objects.get(id); if(o){ o.z_index += 1; updates.push({id, z_index: o.z_index}); }});
  } else if(action === 'backward'){
    State.selected.forEach(id => { const o = State.objects.get(id); if(o){ o.z_index -= 1; updates.push({id, z_index: o.z_index}); }});
  }
  scheduleRender();
  for(const u of updates){
    await sb.from('wb_objects').update({ z_index: u.z_index, updated_by: State.user.id }).eq('id', u.id);
  }
  scheduleBoardTouch();
}

async function toggleLockSelected(){
  const updates = [];
  State.selected.forEach(id => {
    const o = State.objects.get(id);
    if(!o) return;
    o.locked = !o.locked;
    updates.push({id, locked: o.locked});
  });
  scheduleRender(); renderPropsPanel();
  for(const u of updates){
    await sb.from('wb_objects').update({ locked: u.locked, updated_by: State.user.id }).eq('id', u.id);
  }
}

/* ─── Inline editing ─────────────────────── */
function startInlineEdit(objId){
  const obj = State.objects.get(objId);
  if(!obj) return;
  const d = obj.data || {};
  const overlay = $('#canvas-overlay');
  const el = document.createElement('div');
  el.className = 'inline-text-edit' + (obj.type === 'sticky' ? ' sticky' : '');
  el.contentEditable = 'true';
  el.spellcheck = false;
  el.style.left = obj.x + 'px';
  el.style.top = obj.y + 'px';
  el.style.width = obj.width + 'px';
  el.style.minHeight = obj.height + 'px';
  el.style.fontSize = (d.fontSize || (obj.type==='text'?16:14)) + 'px';
  el.style.color = d.textColor || '#0f172a';
  el.style.fontWeight = d.bold ? '700' : '400';
  el.style.fontStyle = d.italic ? 'italic' : 'normal';
  el.style.textAlign = d.align || (['rect','circle','diamond'].includes(obj.type) ? 'center' : 'left');
  if(obj.type==='sticky'){ el.style.background = d.color || '#fef3c7'; }
  el.textContent = d.text || '';
  overlay.appendChild(el);
  el.focus();
  // place caret end
  const range = document.createRange(); range.selectNodeContents(el); range.collapse(false);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  State.inlineEditing = { objId, el };
  el.onblur = () => commitInlineEdit();
  el.onkeydown = (e) => {
    if(e.key === 'Escape'){ e.preventDefault(); el.blur(); }
    if(e.key === 'Enter' && e.metaKey){ e.preventDefault(); el.blur(); }
  };
}
async function commitInlineEdit(){
  if(!State.inlineEditing) return;
  const { objId, el } = State.inlineEditing;
  const obj = State.objects.get(objId);
  if(obj){
    obj.data = obj.data || {};
    obj.data.text = el.innerText;
    await sb.from('wb_objects').update({ data: obj.data, updated_by: State.user.id }).eq('id', objId);
    scheduleBoardTouch();
  }
  el.remove();
  State.inlineEditing = null;
  scheduleRender();
}

/* ─── Properties panel ─────────────────────── */
function renderPropsPanel(){
  const panel = $('#props-panel');
  if(State.selected.size === 0){ panel.classList.remove('visible'); return; }
  panel.classList.add('visible');

  const objs = Array.from(State.selected).map(id => State.objects.get(id)).filter(Boolean);
  const first = objs[0];
  const allSame = (key) => objs.every(o => o.type === first.type);
  const type = allSame('type') ? first.type : 'mixed';
  const d = first.data || {};

  let html = '';
  // Color/Style based on type
  if(type === 'sticky'){
    html += `<div class="props-section"><div class="props-label">Farbe</div><div class="color-grid">`;
    STICKY_COLORS.forEach(c => {
      html += `<div class="color-swatch ${d.color===c?'active':''}" data-act="sticky-color" data-color="${c}" style="background:${c}"></div>`;
    });
    html += `</div></div>`;
  }
  if(['rect','circle','triangle','diamond','frame'].includes(type)){
    html += `<div class="props-section"><div class="props-label">Füllung</div><div class="color-grid">`;
    FILL_COLORS.forEach(c => {
      html += `<div class="color-swatch ${d.fill===c?'active':''}" data-act="fill" data-color="${c}" style="background:${c==='#ffffff'?'#ffffff':c};border:${c==='#ffffff'?'1px solid #e2e8f0':'0'}"></div>`;
    });
    html += `<div class="color-swatch ${d.fill==='transparent'?'active':''}" data-act="fill" data-color="transparent" style="background:repeating-linear-gradient(45deg,#fff,#fff 4px,#e2e8f0 4px,#e2e8f0 8px)"></div>`;
    html += `</div></div>`;
    html += `<div class="props-section"><div class="props-label">Rahmen</div><div class="color-grid">`;
    STROKE_COLORS.forEach(c => {
      html += `<div class="color-swatch ${d.stroke===c?'active':''}" data-act="stroke" data-color="${c}" style="background:${c}"></div>`;
    });
    html += `</div></div>`;
    html += `<div class="props-section"><div class="props-label">Linienstärke</div><div class="stroke-row">`;
    [1,2,3,5].forEach(w => {
      html += `<button class="stroke-btn ${d.strokeWidth===w?'active':''}" data-act="strokeWidth" data-w="${w}"><div style="width:18px;height:${w}px;background:var(--ink)"></div></button>`;
    });
    html += `</div></div>`;
  }
  if(type === 'text' || ['sticky','rect','circle','diamond','frame'].includes(type)){
    html += `<div class="props-section"><div class="props-label">Text</div><div class="font-controls">
      <div style="display:flex;gap:6px">
        <input type="number" min="8" max="120" value="${d.fontSize||16}" data-act="fontSize" style="flex:1" />
        <select data-act="align" style="flex:1">
          <option value="left" ${d.align==='left'?'selected':''}>Links</option>
          <option value="center" ${d.align==='center'?'selected':''}>Mitte</option>
          <option value="right" ${d.align==='right'?'selected':''}>Rechts</option>
        </select>
      </div>
      <div class="text-style-row">
        <button class="text-style-btn ${d.bold?'active':''}" data-act="bold"><b>B</b></button>
        <button class="text-style-btn ${d.italic?'active':''}" data-act="italic"><i>I</i></button>
        <button class="text-style-btn ${d.underline?'active':''}" data-act="underline"><u>U</u></button>
      </div>
      <div class="color-grid">
        ${STROKE_COLORS.map(c=>`<div class="color-swatch ${d.textColor===c?'active':''}" data-act="textColor" data-color="${c}" style="background:${c}"></div>`).join('')}
      </div>
    </div></div>`;
  }
  if(['line','arrow','path'].includes(type)){
    html += `<div class="props-section"><div class="props-label">Farbe</div><div class="color-grid">`;
    STROKE_COLORS.forEach(c => {
      html += `<div class="color-swatch ${d.stroke===c?'active':''}" data-act="stroke" data-color="${c}" style="background:${c}"></div>`;
    });
    html += `</div></div>`;
    html += `<div class="props-section"><div class="props-label">Linienstärke</div><div class="stroke-row">`;
    [1,2,3,5,8].forEach(w => {
      html += `<button class="stroke-btn ${d.strokeWidth===w?'active':''}" data-act="strokeWidth" data-w="${w}"><div style="width:18px;height:${w}px;background:var(--ink)"></div></button>`;
    });
    html += `</div></div>`;
  }
  // Actions
  html += `<div class="props-section"><div class="props-label">Aktionen</div><div class="props-actions">
    <button class="props-action" data-act="duplicate"><i class="fa-regular fa-clone"></i> Dupl.</button>
    <button class="props-action" data-act="forward"><i class="fa-solid fa-arrow-up"></i> Vor</button>
    <button class="props-action" data-act="backward"><i class="fa-solid fa-arrow-down"></i> Zurück</button>
    <button class="props-action" data-act="lock"><i class="fa-solid fa-${first.locked?'unlock':'lock'}"></i> ${first.locked?'Entsperr.':'Sperren'}</button>
    <button class="props-action danger" data-act="delete"><i class="fa-regular fa-trash-can"></i> Löschen</button>
  </div></div>`;

  panel.innerHTML = html;
  panel.querySelectorAll('[data-act]').forEach(el => {
    el.onclick = () => {
      const act = el.dataset.act;
      if(act === 'sticky-color') changeSelectedStyle({ color: el.dataset.color });
      else if(act === 'fill') changeSelectedStyle({ fill: el.dataset.color });
      else if(act === 'stroke') changeSelectedStyle({ stroke: el.dataset.color });
      else if(act === 'strokeWidth') changeSelectedStyle({ strokeWidth: parseInt(el.dataset.w) });
      else if(act === 'bold') changeSelectedStyle({ bold: !d.bold });
      else if(act === 'italic') changeSelectedStyle({ italic: !d.italic });
      else if(act === 'underline') changeSelectedStyle({ underline: !d.underline });
      else if(act === 'textColor') changeSelectedStyle({ textColor: el.dataset.color });
      else if(act === 'duplicate') duplicateSelected();
      else if(act === 'forward') changeZOrder('forward');
      else if(act === 'backward') changeZOrder('backward');
      else if(act === 'lock') toggleLockSelected();
      else if(act === 'delete') deleteSelected();
    };
  });
  panel.querySelectorAll('input[type=number],select').forEach(el => {
    el.onchange = () => {
      const act = el.dataset.act;
      if(act === 'fontSize') changeSelectedStyle({ fontSize: parseInt(el.value) });
      if(act === 'align') changeSelectedStyle({ align: el.value });
    };
  });
}

/* ─── Undo/Redo ─────────────────────── */
function pushHistory(initial=false){
  const snapshot = Array.from(State.objects.values()).map(o => JSON.parse(JSON.stringify({
    id:o.id,type:o.type,x:o.x,y:o.y,width:o.width,height:o.height,rotation:o.rotation,
    z_index:o.z_index,data:o.data,locked:o.locked
  })));
  if(!initial){
    State.history = State.history.slice(0, State.historyIndex + 1);
  }
  State.history.push(snapshot);
  if(State.history.length > 100) State.history.shift();
  else State.historyIndex++;
}

async function undo(){
  if(State.historyIndex <= 0) return;
  State.historyIndex--;
  await restoreSnapshot(State.history[State.historyIndex]);
}
async function redo(){
  if(State.historyIndex >= State.history.length - 1) return;
  State.historyIndex++;
  await restoreSnapshot(State.history[State.historyIndex]);
}
async function restoreSnapshot(snapshot){
  // Compute diff
  const newMap = new Map(snapshot.map(o => [o.id, o]));
  const oldIds = new Set(State.objects.keys());
  const newIds = new Set(newMap.keys());
  const toDelete = [...oldIds].filter(id => !newIds.has(id));
  const toUpsert = snapshot;
  // Update local state
  State.objects.clear();
  snapshot.forEach(o => State.objects.set(o.id, { ...o, board_id: State.board.id }));
  State.selected.clear();
  scheduleRender(); renderPropsPanel();
  // Persist
  if(toDelete.length){ await sb.from('wb_objects').delete().in('id', toDelete); }
  for(const o of toUpsert){
    await sb.from('wb_objects').upsert({
      id:o.id, board_id: State.board.id, type:o.type, x:o.x, y:o.y, width:o.width, height:o.height,
      rotation:o.rotation, z_index:o.z_index, data:o.data, locked:o.locked, updated_by: State.user.id
    });
  }
  scheduleBoardTouch();
}

/* ─── Save board metadata (title, thumbnail) ─────────────────────── */
const scheduleBoardTouch = debounce(async () => {
  if(!State.board) return;
  await sb.from('wb_boards').update({ updated_at: new Date().toISOString() }).eq('id', State.board.id);
  // Update thumbnail (rarely)
  if(!State.thumbnailTimer){
    State.thumbnailTimer = setTimeout(() => {
      saveThumbnail();
      State.thumbnailTimer = null;
    }, 5000);
  }
}, 1000);

async function saveThumbnail(){
  try {
    const url = await renderBoardImage(320, 200, 'jpeg', 0.7);
    await sb.from('wb_boards').update({ thumbnail: url }).eq('id', State.board.id);
  } catch(e){ console.warn('thumbnail', e); }
}

async function renderBoardImage(maxW, maxH, format='png', quality=0.92, area='all'){
  // Determine bounds
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  let pool;
  if(area === 'selection'){
    pool = Array.from(State.selected).map(id => State.objects.get(id)).filter(Boolean);
  } else if(area === 'viewport'){
    const w0 = screenToWorld(0,0), w1 = screenToWorld(canvasWrap.clientWidth, canvasWrap.clientHeight);
    minX = w0.x; minY = w0.y; maxX = w1.x; maxY = w1.y;
    pool = Array.from(State.objects.values());
  } else {
    pool = Array.from(State.objects.values());
  }
  if(area !== 'viewport'){
    if(pool.length === 0){ minX = 0; minY = 0; maxX = 800; maxY = 600; }
    else for(const o of pool){ const b = getBBox(o); minX=Math.min(minX,b.x); minY=Math.min(minY,b.y); maxX=Math.max(maxX,b.x+b.w); maxY=Math.max(maxY,b.y+b.h); }
  }
  const pad = 32;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const ww = maxX - minX, hh = maxY - minY;
  const scale = Math.min(maxW / ww, maxH / hh);
  const cw = Math.round(ww * scale), ch = Math.round(hh * scale);
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const cx = c.getContext('2d');
  cx.fillStyle = '#ffffff';
  cx.fillRect(0,0,cw,ch);
  cx.save();
  cx.scale(scale, scale);
  cx.translate(-minX, -minY);
  // Save state then mock
  const oldZ = State.zoom, oldPx = State.panX, oldPy = State.panY;
  State.zoom = 1; State.panX = 0; State.panY = 0;
  const sorted = Array.from(State.objects.values()).sort((a,b)=>(a.z_index||0)-(b.z_index||0));
  for(const o of sorted){
    if(area === 'selection' && !State.selected.has(o.id)) continue;
    drawObject(cx, o);
  }
  State.zoom = oldZ; State.panX = oldPx; State.panY = oldPy;
  cx.restore();
  return c.toDataURL('image/'+format, quality);
}

/* ─── Realtime ─────────────────────── */
async function setupRealtime(){
  if(State.dbChannel){ try { await sb.removeChannel(State.dbChannel); } catch{} }
  if(State.presenceChannel){ try { await sb.removeChannel(State.presenceChannel); } catch{} }
  // DB changes
  State.dbChannel = sb.channel('db:board:' + State.board.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'wb_objects', filter: 'board_id=eq.'+State.board.id }, payload => {
      handleObjectChange(payload);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'wb_comments', filter: 'board_id=eq.'+State.board.id }, () => {
      loadComments();
    })
    .subscribe();
  // Presence
  const myColor = PRESENCE_COLORS[Math.floor(Math.random()*PRESENCE_COLORS.length)];
  State.presenceChannel = sb.channel('presence:board:' + State.board.id, {
    config: { presence: { key: State.user.id }, broadcast: { self: false } }
  });
  State.presenceChannel
    .on('presence', { event: 'sync' }, () => {
      const all = State.presenceChannel.presenceState();
      State.presence.clear();
      Object.values(all).flat().forEach(p => {
        State.presence.set(p.user_id, p);
      });
      renderPresenceBar();
    })
    .on('broadcast', { event: 'cursor' }, ({ payload }) => {
      const p = State.presence.get(payload.user_id) || { ...payload };
      p.cursor = payload.cursor;
      State.presence.set(payload.user_id, p);
      drawLiveCursors();
    })
    .subscribe(async (status) => {
      if(status === 'SUBSCRIBED'){
        await State.presenceChannel.track({
          user_id: State.user.id,
          name: State.profile?.full_name || State.user.email,
          email: State.user.email,
          avatar_url: State.profile?.avatar_url || null,
          color: myColor
        });
      }
    });
  loadComments();
}

function handleObjectChange(p){
  const { eventType, new: row, old: oldRow } = p;
  if(eventType === 'INSERT' || eventType === 'UPDATE'){
    if(row.updated_by && row.updated_by === State.user.id) return; // ignore own
    State.objects.set(row.id, row);
    scheduleRender();
  } else if(eventType === 'DELETE'){
    if(oldRow?.id) { State.objects.delete(oldRow.id); State.selected.delete(oldRow.id); scheduleRender(); renderPropsPanel(); }
  }
}

const broadcastCursor = throttle((wp) => {
  if(!State.presenceChannel || !State.user) return;
  State.presenceChannel.send({
    type: 'broadcast', event: 'cursor',
    payload: {
      user_id: State.user.id,
      name: State.profile?.full_name || State.user.email,
      color: State.presence.get(State.user.id)?.color || '#206efb',
      cursor: { x: wp.x, y: wp.y }
    }
  });
}, 50);
function throttle(fn, ms){ let last = 0; return (...a) => { const now = Date.now(); if(now - last >= ms){ last = now; fn(...a); } }; }

function renderPresenceBar(){
  const bar = $('#board-presence');
  bar.innerHTML = '';
  State.presence.forEach((p, uid) => {
    if(uid === State.user.id) return;
    const av = document.createElement('div');
    av.className = 'presence-avatar';
    av.style.background = p.color || '#206efb';
    av.style.color = '#fff';
    av.title = p.name || 'Gast';
    if(p.avatar_url){
      av.innerHTML = `<img src="${p.avatar_url}" alt="" />`;
    } else {
      av.textContent = initials(p.name || 'G');
    }
    av.onclick = () => focusOnUser(uid);
    bar.appendChild(av);
  });
}
function focusOnUser(uid){
  const p = State.presence.get(uid);
  if(!p?.cursor) return;
  // Center viewport on user cursor
  const w = canvasWrap.clientWidth, h = canvasWrap.clientHeight;
  State.panX = w/2 - p.cursor.x * State.zoom;
  State.panY = h/2 - p.cursor.y * State.zoom;
  scheduleRender();
}

/* ─── Comments ─────────────────────── */
async function loadComments(){
  const { data } = await sb.from('wb_comments').select('*').eq('board_id', State.board.id).order('created_at',{ascending:true});
  State.comments = data || [];
  renderCommentsList();
  renderCommentPins();
}
function renderCommentsList(){
  const list = $('#comments-list');
  if(!State.comments || State.comments.length === 0){
    list.innerHTML = '<div class="empty-state" style="padding:2rem 1rem"><i class="fa-regular fa-comment"></i><h3>Keine Kommentare</h3><p>Klicke auf das Kommentar-Werkzeug, dann auf eine Stelle im Board.</p></div>';
    return;
  }
  const top = State.comments.filter(c => !c.parent_id);
  list.innerHTML = top.map(c => `
    <div class="comment-card" data-id="${c.id}">
      <div class="comment-head">
        <div class="comment-avatar">${initials('U')}</div>
        <div class="comment-author">${escapeHtml(getUserName(c.created_by))}</div>
        <div class="comment-time">${formatRelative(c.created_at)}</div>
      </div>
      <div class="comment-text">${escapeHtml(c.content)}</div>
      <div class="comment-actions">
        <button class="comment-action" data-act="goto">An Stelle springen</button>
        ${c.resolved ? `<button class="comment-action" data-act="unresolve">Erneut öffnen</button>` : `<button class="comment-action" data-act="resolve">Erledigen</button>`}
        ${c.created_by === State.user.id ? `<button class="comment-action" data-act="delete">Löschen</button>` : ''}
      </div>
    </div>
  `).join('');
  list.querySelectorAll('.comment-card').forEach(card => {
    card.querySelectorAll('.comment-action').forEach(b => {
      b.onclick = async () => {
        const id = card.dataset.id;
        const c = State.comments.find(x => x.id === id);
        if(!c) return;
        if(b.dataset.act === 'goto' && c.x != null){
          const w = canvasWrap.clientWidth, h = canvasWrap.clientHeight;
          State.panX = w/2 - c.x * State.zoom;
          State.panY = h/2 - c.y * State.zoom;
          scheduleRender();
        }
        if(b.dataset.act === 'resolve'){ await sb.from('wb_comments').update({ resolved: true }).eq('id', id); loadComments(); }
        if(b.dataset.act === 'unresolve'){ await sb.from('wb_comments').update({ resolved: false }).eq('id', id); loadComments(); }
        if(b.dataset.act === 'delete'){ await sb.from('wb_comments').delete().eq('id', id); loadComments(); }
      };
    });
  });
}
function renderCommentPins(){
  // Add HTML pins as canvas overlay
  let layer = canvasWrap.querySelector('.comments-pins-layer');
  if(!layer){
    layer = document.createElement('div');
    layer.className = 'comments-pins-layer';
    layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:80';
    canvasWrap.appendChild(layer);
  }
  layer.innerHTML = '';
  (State.comments || []).filter(c => !c.parent_id && c.x != null && !c.resolved).forEach((c, i) => {
    const s = worldToScreen(c.x, c.y);
    const pin = document.createElement('div');
    pin.className = 'comment-pin';
    pin.style.left = s.x + 'px';
    pin.style.top = s.y + 'px';
    pin.style.pointerEvents = 'auto';
    pin.innerHTML = `<span>${i+1}</span>`;
    pin.title = c.content;
    pin.onclick = () => $('#comments-panel').classList.add('visible');
    layer.appendChild(pin);
  });
}
function getUserName(uid){
  if(uid === State.user.id) return State.profile?.full_name || 'Du';
  const p = State.presence.get(uid);
  return p?.name || 'Mitglied';
}
async function addComment(x, y, text){
  await sb.from('wb_comments').insert({
    board_id: State.board.id, content: text, x, y, created_by: State.user.id
  });
  loadComments();
}

/* ─── Snapshots / Version history ─────────────────────── */
async function loadSnapshots(){
  const { data } = await sb.from('wb_snapshots').select('id,label,created_at,created_by').eq('board_id', State.board.id).order('created_at',{ascending:false});
  const list = $('#history-list');
  if(!data || data.length === 0){
    list.innerHTML = '<div class="empty-state" style="padding:1.5rem"><i class="fa-solid fa-clock-rotate-left"></i><h3>Keine Versionen</h3><p>Erstelle deinen ersten Snapshot oben.</p></div>';
    return;
  }
  list.innerHTML = data.map(s => `
    <div class="history-item" data-id="${s.id}">
      <i class="fa-solid fa-camera" style="color:var(--brand)"></i>
      <div class="history-item-info">
        <div class="history-item-label">${escapeHtml(s.label || 'Snapshot')}</div>
        <div class="history-item-meta">${formatRelative(s.created_at)}</div>
      </div>
      <div class="history-item-actions">
        <button class="props-action" data-act="restore"><i class="fa-solid fa-rotate-left"></i></button>
        <button class="props-action danger" data-act="delete"><i class="fa-regular fa-trash-can"></i></button>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('.history-item').forEach(item => {
    item.querySelectorAll('[data-act]').forEach(b => {
      b.onclick = async (e) => {
        e.stopPropagation();
        const id = item.dataset.id;
        if(b.dataset.act === 'restore'){
          const ok = await confirmDialog('Version wiederherstellen?','Alle aktuellen Änderungen werden überschrieben.');
          if(!ok) return;
          const { data: snap } = await sb.from('wb_snapshots').select('data').eq('id', id).single();
          if(snap?.data){
            await restoreSnapshot(snap.data);
            toast('Version wiederhergestellt', 'success');
            closeModal('modal-history');
          }
        }
        if(b.dataset.act === 'delete'){
          if(await confirmDialog('Snapshot löschen?','Diese Aktion ist endgültig.')){
            await sb.from('wb_snapshots').delete().eq('id', id);
            loadSnapshots();
          }
        }
      };
    });
  });
}
async function createSnapshot(){
  const label = $('#snapshot-label').value.trim() || `Snapshot ${new Date().toLocaleString('de-DE')}`;
  const data = Array.from(State.objects.values()).map(o => ({
    id:o.id,type:o.type,x:o.x,y:o.y,width:o.width,height:o.height,rotation:o.rotation,
    z_index:o.z_index,data:o.data,locked:o.locked
  }));
  await sb.from('wb_snapshots').insert({
    board_id: State.board.id, label, data, created_by: State.user.id
  });
  $('#snapshot-label').value = '';
  loadSnapshots();
  toast('Snapshot erstellt', 'success');
}

/* ─── Share dialog ─────────────────────── */
async function openShareDialog(){
  $('#share-link').value = window.location.origin + window.location.pathname + '?board=' + State.board.id;
  $('#share-public').checked = !!State.board.is_public;
  await loadMembers();
  openModal('modal-share');
}
async function loadMembers(){
  const { data: members } = await sb.from('wb_board_members').select('*').eq('board_id', State.board.id);
  const list = $('#share-members-list');
  // Owner first
  const ownerHtml = `
    <div class="share-member">
      <div class="share-member-avatar">${initials(State.profile?.full_name || State.user.email)}</div>
      <div class="share-member-info">
        <div class="share-member-name">${escapeHtml(State.profile?.full_name || State.user.email)} (du)</div>
        <div class="share-member-mail">${escapeHtml(State.user.email)}</div>
      </div>
      <span style="font-size:.75rem;color:var(--muted);text-transform:uppercase;font-weight:600">Eigentümer</span>
    </div>`;
  list.innerHTML = ownerHtml + (members || []).map(m => `
    <div class="share-member" data-uid="${m.user_id}">
      <div class="share-member-avatar">${initials(m.user_id.slice(0,2))}</div>
      <div class="share-member-info">
        <div class="share-member-name">${escapeHtml(m.user_id)}</div>
        <div class="share-member-mail">Mitglied</div>
      </div>
      <select data-uid="${m.user_id}">
        <option value="editor" ${m.role==='editor'?'selected':''}>Editor</option>
        <option value="commenter" ${m.role==='commenter'?'selected':''}>Kommentator</option>
        <option value="viewer" ${m.role==='viewer'?'selected':''}>Betrachter</option>
      </select>
      <button class="share-member-remove" data-uid="${m.user_id}" title="Entfernen"><i class="fa-solid fa-xmark"></i></button>
    </div>
  `).join('');
  list.querySelectorAll('select').forEach(s => s.onchange = async () => {
    await sb.from('wb_board_members').update({ role: s.value }).eq('board_id', State.board.id).eq('user_id', s.dataset.uid);
  });
  list.querySelectorAll('.share-member-remove').forEach(b => b.onclick = async () => {
    await sb.from('wb_board_members').delete().eq('board_id', State.board.id).eq('user_id', b.dataset.uid);
    loadMembers();
  });
}
async function inviteMember(){
  const email = $('#share-invite-email').value.trim();
  const role = $('#share-invite-role').value;
  if(!email) return;
  // Look up user_id by email from users.profiles
  const { data: prof } = await sb.schema('users').from('profiles').select('id').eq('email', email).maybeSingle();
  if(!prof){ toast('Kein ROOTS-Konto mit dieser E-Mail.', 'error'); return; }
  const { error } = await sb.from('wb_board_members').upsert({
    board_id: State.board.id, user_id: prof.id, role, added_by: State.user.id
  });
  if(error){ toast(error.message, 'error'); return; }
  $('#share-invite-email').value = '';
  loadMembers();
  toast('Mitglied hinzugefügt', 'success');
}

/* ─── Export ─────────────────────── */
async function doExport(){
  const format = $('#export-format').value;
  const area = $('#export-area').value;
  const scale = parseInt($('#export-scale').value);
  if(format === 'json'){
    const data = {
      board: { id: State.board.id, title: State.board.title, background: State.board.background },
      objects: Array.from(State.objects.values()).map(o => ({...o, board_id: undefined, created_at: undefined, updated_at: undefined, created_by: undefined, updated_by: undefined}))
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, (State.board.title || 'board') + '.json');
  } else if(format === 'svg'){
    const svg = exportSVG(area);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    downloadBlob(blob, (State.board.title || 'board') + '.svg');
  } else {
    const dataUrl = await renderBoardImage(2560*scale/2, 1600*scale/2, format, format==='jpeg'?0.92:undefined, area);
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = (State.board.title || 'board') + '.' + format;
    a.click();
  }
  closeModal('modal-export');
  toast('Export abgeschlossen', 'success');
}
function downloadBlob(blob, filename){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}
function exportSVG(area){
  let pool = Array.from(State.objects.values());
  if(area === 'selection') pool = pool.filter(o => State.selected.has(o.id));
  if(pool.length === 0) return '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"></svg>';
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  pool.forEach(o => { const b=getBBox(o); minX=Math.min(minX,b.x); minY=Math.min(minY,b.y); maxX=Math.max(maxX,b.x+b.w); maxY=Math.max(maxY,b.y+b.h); });
  const pad = 24;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const w = maxX - minX, h = maxY - minY;
  const parts = pool.map(o => objectToSVG(o));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${w} ${h}" width="${w}" height="${h}">
  <rect x="${minX}" y="${minY}" width="${w}" height="${h}" fill="#ffffff"/>
  ${parts.join('\n  ')}
</svg>`;
}
function objectToSVG(o){
  const d = o.data || {};
  const txt = (x,y,w,h,size=14,color='#0f172a',bold=false,italic=false) => d.text ? `<text x="${x+(w/2)}" y="${y+h/2}" font-family="Circular Std, system-ui" font-size="${size}" font-weight="${bold?700:400}" font-style="${italic?'italic':'normal'}" fill="${color}" text-anchor="middle" dominant-baseline="middle">${escapeHtml(d.text).slice(0,80)}</text>` : '';
  if(o.type==='rect'||o.type==='frame') return `<rect x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" fill="${d.fill||'#fff'}" stroke="${d.stroke||'#0f172a'}" stroke-width="${d.strokeWidth||2}"/>` + txt(o.x,o.y,o.width,o.height,d.fontSize,d.textColor,d.bold,d.italic);
  if(o.type==='sticky') return `<rect x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" fill="${d.color||'#fef3c7'}"/>` + (d.text?`<foreignObject x="${o.x+10}" y="${o.y+10}" width="${o.width-20}" height="${o.height-20}"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Circular Std;font-size:${d.fontSize||14}px;color:${d.textColor||'#0f172a'};">${escapeHtml(d.text)}</div></foreignObject>`:'');
  if(o.type==='circle') return `<ellipse cx="${o.x+o.width/2}" cy="${o.y+o.height/2}" rx="${o.width/2}" ry="${o.height/2}" fill="${d.fill||'#fff'}" stroke="${d.stroke||'#0f172a'}" stroke-width="${d.strokeWidth||2}"/>` + txt(o.x,o.y,o.width,o.height,d.fontSize,d.textColor,d.bold,d.italic);
  if(o.type==='diamond') return `<polygon points="${o.x+o.width/2},${o.y} ${o.x+o.width},${o.y+o.height/2} ${o.x+o.width/2},${o.y+o.height} ${o.x},${o.y+o.height/2}" fill="${d.fill||'#fff'}" stroke="${d.stroke||'#0f172a'}" stroke-width="${d.strokeWidth||2}"/>` + txt(o.x,o.y,o.width,o.height,d.fontSize,d.textColor,d.bold,d.italic);
  if(o.type==='triangle') return `<polygon points="${o.x+o.width/2},${o.y} ${o.x+o.width},${o.y+o.height} ${o.x},${o.y+o.height}" fill="${d.fill||'#fff'}" stroke="${d.stroke||'#0f172a'}" stroke-width="${d.strokeWidth||2}"/>`;
  if(o.type==='text') return `<text x="${o.x}" y="${o.y + (d.fontSize||16)}" font-family="Circular Std, system-ui" font-size="${d.fontSize||16}" font-weight="${d.bold?700:400}" font-style="${d.italic?'italic':'normal'}" fill="${d.textColor||'#0f172a'}">${escapeHtml(d.text||'Text')}</text>`;
  if(o.type==='line') return `<line x1="${o.x}" y1="${o.y}" x2="${o.x+o.width}" y2="${o.y+o.height}" stroke="${d.stroke||'#0f172a'}" stroke-width="${d.strokeWidth||2}"/>`;
  if(o.type==='arrow'){ const ang = Math.atan2(o.height, o.width); const x2 = o.x+o.width, y2 = o.y+o.height; const ah = 12; return `<line x1="${o.x}" y1="${o.y}" x2="${x2}" y2="${y2}" stroke="${d.stroke||'#0f172a'}" stroke-width="${d.strokeWidth||2}"/><polygon points="${x2},${y2} ${x2-ah*Math.cos(ang-Math.PI/6)},${y2-ah*Math.sin(ang-Math.PI/6)} ${x2-ah*Math.cos(ang+Math.PI/6)},${y2-ah*Math.sin(ang+Math.PI/6)}" fill="${d.stroke||'#0f172a'}"/>`; }
  if(o.type==='path'){ const pts = (d.points||[]).map(p=>p.join(',')).join(' L '); return pts ? `<path d="M ${pts}" fill="none" stroke="${d.stroke||'#0f172a'}" stroke-width="${d.strokeWidth||3}" stroke-linecap="round" stroke-linejoin="round"/>` : ''; }
  if(o.type==='image' && d.src) return `<image x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" href="${d.src}"/>`;
  return '';
}

/* ─── Workshop mode ─────────────────────── */
function toggleWorkshop(){
  State.workshopMode = !State.workshopMode;
  $('#workshop-bar').classList.toggle('visible', State.workshopMode);
  if(State.workshopMode){
    State.workshopIndex = 0;
    workshopGoto(0);
  } else {
    scheduleRender();
  }
}
function workshopGoto(idx){
  const frames = Array.from(State.objects.values()).filter(o => o.type === 'frame').sort((a,b)=>a.x-b.x);
  if(frames.length === 0){
    $('#ws-info').textContent = 'Keine Frames';
    return;
  }
  idx = clamp(idx, 0, frames.length-1);
  State.workshopIndex = idx;
  const f = frames[idx];
  const w = canvasWrap.clientWidth, h = canvasWrap.clientHeight;
  const pad = 80;
  const z = Math.min((w - 2*pad) / f.width, (h - 2*pad) / f.height);
  State.zoom = clamp(z, 0.1, 3);
  State.panX = (w - f.width * State.zoom) / 2 - f.x * State.zoom;
  State.panY = (h - f.height * State.zoom) / 2 - f.y * State.zoom;
  $('#zoom-level').textContent = Math.round(State.zoom*100) + '%';
  $('#ws-info').textContent = (idx+1) + ' / ' + frames.length;
  scheduleRender();
}

/* ─── Keyboard ─────────────────────── */
function onKeyDown(e){
  if(State.currentScreen !== 'board') return;
  if(State.inlineEditing) return; // let editor handle
  const t = e.target;
  if(t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
  const meta = e.metaKey || e.ctrlKey;
  // Tools
  if(!meta){
    if(e.key === 'v') return setTool('select');
    if(e.key === 'h') return setTool('hand');
    if(e.key === 'n') return setTool('sticky');
    if(e.key === 't') return setTool('text');
    if(e.key === 'r') return setTool('rect');
    if(e.key === 'o') return setTool('circle');
    if(e.key === 'a') return setTool('arrow');
    if(e.key === 'l') return setTool('line');
    if(e.key === 'p') return setTool('path');
    if(e.key === 'f') return setTool('frame');
    if(e.key === '?'){ openModal('modal-help'); e.preventDefault(); return; }
    if(e.key === ' '){
      if(State.tool !== 'hand'){ State.prevTool = State.tool; setTool('hand'); e.preventDefault(); return; }
    }
    if(e.key === 'Delete' || e.key === 'Backspace'){ deleteSelected(); e.preventDefault(); return; }
    if(e.key === 'Escape'){ State.selected.clear(); renderPropsPanel(); scheduleRender(); return; }
  }
  if(meta){
    if(e.key === 'z' && !e.shiftKey){ undo(); e.preventDefault(); return; }
    if((e.key === 'z' && e.shiftKey) || e.key === 'y'){ redo(); e.preventDefault(); return; }
    if(e.key === 'c'){ copySelected(); e.preventDefault(); return; }
    if(e.key === 'v'){ pasteClipboard(); e.preventDefault(); return; }
    if(e.key === 'd'){ duplicateSelected(); e.preventDefault(); return; }
    if(e.key === 'a'){ selectAll(); e.preventDefault(); return; }
    if(e.key === '0'){ setZoom(1, canvasWrap.clientWidth/2/State.zoom - State.panX/State.zoom, canvasWrap.clientHeight/2/State.zoom - State.panY/State.zoom); e.preventDefault(); return; }
    if(e.key === '1'){ zoomToFit(); e.preventDefault(); return; }
    if(e.key === '='){ setZoom(State.zoom*1.2); e.preventDefault(); return; }
    if(e.key === '-'){ setZoom(State.zoom/1.2); e.preventDefault(); return; }
    if(e.key === '.'){ toggleWorkshop(); e.preventDefault(); return; }
  }
}
function onKeyUp(e){
  if(e.key === ' ' && State.prevTool){ setTool(State.prevTool); State.prevTool = null; }
}

/* ─── Wire UI events ─────────────────────── */
function wireEvents(){
  // Auth
  $('#form-login').addEventListener('submit', handleLogin);
  $('#link-toggle').onclick = () => setAuthMode(State.authMode === 'signin' ? 'signup' : 'signin');
  const logoutBtn = $('#btn-logout');
  if (logoutBtn) logoutBtn.onclick = handleLogout;
  // Dashboard nav
  $$('.dash-nav-item').forEach(b => b.onclick = () => {
    $$('.dash-nav-item').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    State.dashView = b.dataset.view;
    renderBoardsView();
  });
  $('#dash-search').addEventListener('input', e => { State.searchQuery = e.target.value; renderBoardsView(); });
  $('#btn-new-board').onclick = () => openModal('modal-new-board');

  // Board topbar
  $('#btn-back-to-dash').onclick = async () => {
    if(State.dbChannel) try { await sb.removeChannel(State.dbChannel); } catch{}
    if(State.presenceChannel) try { await sb.removeChannel(State.presenceChannel); } catch{}
    State.dbChannel = null; State.presenceChannel = null; State.presence.clear();
    showScreen('dashboard');
    await loadBoards();
  };
  $('#board-title').addEventListener('change', async (e) => {
    if(!State.board) return;
    await sb.from('wb_boards').update({ title: e.target.value }).eq('id', State.board.id);
    State.board.title = e.target.value;
  });
  $('#btn-undo').onclick = undo;
  $('#btn-redo').onclick = redo;
  $('#btn-toggle-comments').onclick = () => $('#comments-panel').classList.toggle('visible');
  $('#btn-history').onclick = () => { loadSnapshots(); openModal('modal-history'); };
  $('#btn-create-snapshot').onclick = createSnapshot;
  $('#btn-export').onclick = () => openModal('modal-export');
  $('#btn-do-export').onclick = doExport;
  $('#btn-workshop').onclick = toggleWorkshop;
  $('#btn-help').onclick = () => openModal('modal-help');
  $('#btn-share').onclick = openShareDialog;
  $('#btn-copy-link').onclick = () => {
    $('#share-link').select();
    navigator.clipboard.writeText($('#share-link').value);
    toast('Link kopiert', 'success');
  };
  $('#btn-invite').onclick = inviteMember;
  $('#share-public').onchange = async (e) => {
    await sb.from('wb_boards').update({ is_public: e.target.checked }).eq('id', State.board.id);
    State.board.is_public = e.target.checked;
  };

  // Tool palette
  $$('.tool-btn').forEach(b => b.onclick = () => setTool(b.dataset.tool));

  // Zoom
  $('#btn-zoom-in').onclick = () => setZoom(State.zoom * 1.2);
  $('#btn-zoom-out').onclick = () => setZoom(State.zoom / 1.2);
  $('#zoom-level').onclick = () => setZoom(1);
  $('#btn-zoom-fit').onclick = zoomToFit;

  // Minimap click → pan
  $('#minimap').onclick = (e) => {
    const rect = $('#minimap').getBoundingClientRect();
    const rx = (e.clientX - rect.left) / rect.width;
    const ry = (e.clientY - rect.top) / rect.height;
    // Determine world bounds same as drawMinimap
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const o of State.objects.values()){
      const b = getBBox(o);
      minX = Math.min(minX,b.x); minY = Math.min(minY,b.y);
      maxX = Math.max(maxX,b.x+b.w); maxY = Math.max(maxY,b.y+b.h);
    }
    if(!isFinite(minX)){ return; }
    const pad = 50; minX-=pad; minY-=pad; maxX+=pad; maxY+=pad;
    const wx = minX + rx*(maxX-minX), wy = minY + ry*(maxY-minY);
    const w = canvasWrap.clientWidth, h = canvasWrap.clientHeight;
    State.panX = w/2 - wx * State.zoom;
    State.panY = h/2 - wy * State.zoom;
    scheduleRender();
  };

  // Workshop bar
  $('#ws-prev').onclick = () => workshopGoto(State.workshopIndex - 1);
  $('#ws-next').onclick = () => workshopGoto(State.workshopIndex + 1);
  $('#ws-exit').onclick = toggleWorkshop;

  // Canvas pointer events
  // We attach to canvasWrap parent because canvases have pointer-events:none
  function attachCanvasEvents(){
    canvasWrap.addEventListener('mousedown', onCanvasMouseDown);
    canvasWrap.addEventListener('mousemove', onCanvasMouseMove);
    window.addEventListener('mouseup', onCanvasMouseUp);
    canvasWrap.addEventListener('dblclick', onCanvasDoubleClick);
    canvasWrap.addEventListener('wheel', onCanvasWheel, { passive: false });
    canvasWrap.addEventListener('contextmenu', e => e.preventDefault());
  }
  // Defer until board screen shown
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  // For canvas: attach when board view inits
  State._attachCanvasEvents = attachCanvasEvents;

  // Resize
  window.addEventListener('resize', () => { if(State.currentScreen === 'board'){ resizeCanvas(); scheduleRender(); } });
}

/* ─── Bootstrap ─────────────────────── */
let _wbBootstrapped = false;

async function onAuthSession(session) {
  if (session) {
    State.user = session.user;
    try {
      await loadProfile();
      showScreen('dashboard');
      await loadBoards();
      const params = new URLSearchParams(location.search);
      const bid = params.get('board');
      if (bid) openBoard(bid);
    } catch (e) {
      console.error('Whiteboard onAuthSession', e);
      toast(e.message || 'Whiteboard konnte nicht geladen werden', 'error');
    }
    return;
  }
  if (document.documentElement.classList.contains('in-iframe')) return;
  showScreen('login');
}

function applyProfileFromParent(profile) {
  if (!profile?.id) return;
  if (State.user && profile.id !== State.user.id) return;
  State.profile = { ...(State.profile || {}), ...profile };
  if (!State.user && profile.id) {
    State.user = { id: profile.id, email: profile.email || '' };
  }
  renderHeaderUser();
}

async function bootstrap(){
  if (_wbBootstrapped) return;
  _wbBootstrapped = true;
  wireEvents();
  renderNewBoardModal();

  const inIframe = document.documentElement.classList.contains('in-iframe');
  if (inIframe) {
    const logoutBtn = $('#btn-logout');
    if (logoutBtn) logoutBtn.style.display = 'none';
    showScreen('login');
    const loginCard = document.querySelector('#screen-login .login-card');
    if (loginCard) {
      loginCard.innerHTML = '<div style="text-align:center;padding:3rem 1rem;color:var(--muted)"><i class="fa-solid fa-circle-notch fa-spin" style="font-size:2rem;color:var(--brand);margin-bottom:1rem;display:block"></i><span>Whiteboard wird geladen…</span></div>';
    }
  }

  // Hijack initCanvas hook
  const origInitCanvas = initCanvas;
  initCanvas = function(){
    origInitCanvas();
    if(!canvasWrap._wired){
      State._attachCanvasEvents();
      canvasWrap._wired = true;
    }
  };

  window.addEventListener('message', (e) => {
    if (e.origin !== 'https://pgoutzeris-stack.github.io') return;
    if (e.data?.type === 'roots-profile-updated' && e.data.profile) {
      applyProfileFromParent(e.data.profile);
    }
  });

  window.addEventListener('roots-auth-ready', (e) => {
    if (e.detail?.session) void onAuthSession(e.detail.session);
  });

  if (inIframe) {
    setTimeout(() => {
      if (State.currentScreen === 'login' && window.RootsUserBridge?.syncAuthFromParentStorage) {
        void window.RootsUserBridge.syncAuthFromParentStorage();
      }
    }, 800);
  }

  window.addEventListener('roots-auth-signed-out', () => {
    State.user = null;
    State.profile = null;
    State.boards = [];
    if (inIframe) {
      showScreen('login');
      const loginCard = document.querySelector('#screen-login .login-card');
      if (loginCard) {
        loginCard.innerHTML = '<div style="text-align:center;padding:2rem 1rem;color:var(--muted)"><i class="fa-solid fa-lock" style="font-size:2rem;color:var(--brand);margin-bottom:1rem;display:block"></i><strong style="display:block;color:var(--ink);margin-bottom:.5rem">Anmeldung erforderlich</strong>Bitte melde dich im ROOTS Intranet an.</div>';
      }
    } else {
      showScreen('login');
    }
  });

  if (!inIframe) {
    const { data: { session } } = await sb.auth.getSession();
    await onAuthSession(session);
    sb.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        State.user = null; State.profile = null; State.boards = [];
        await onAuthSession(null);
        return;
      }
      if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED')) {
        await onAuthSession(session);
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', bootstrap);
if(document.readyState !== 'loading') bootstrap();
