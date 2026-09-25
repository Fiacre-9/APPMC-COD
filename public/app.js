// Mireb COD — interface d'administration (vanilla JS)
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let META = { statuses: [], currency: '$' };
const LABEL = { nouveau: 'Nouveau', en_confirmation: 'En confirmation', confirme: 'Confirmé', en_preparation: 'En préparation',
  expedie: 'Expédié', en_livraison: 'En livraison', livre: 'Livré', paye: 'Payé', annule: 'Annulé', retourne: 'Retourné' };
const SEG = { nouveau: '🆕 Nouveau', actif: '✅ Actif', fidele: '💎 Fidèle', vip: '⭐ VIP', risque: '⚠️ Risque' };
const money = n => `${(+n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${META.currency}`;
const badge = s => `<span class="badge s-${s}">${LABEL[s] || s}</span>`;

async function api(url, method = 'GET', body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401 && url.startsWith('/api')) { showLogin(); throw new Error('Non connecté'); }
  const d = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  if (!r.ok) { toast(d.error || 'Erreur'); throw new Error(d.error); }
  return d;
}
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 2500); }
function modal(html) { $('#mbox').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); }
const formData = f => Object.fromEntries(new FormData(f));

// ---------- Auth ----------
function showLogin() { $('#login').classList.remove('hidden'); $('#app').classList.add('hidden'); }
async function login(e) {
  e.preventDefault();
  try { await api('/auth/login', 'POST', formData(e.target)); boot(); } catch (err) { $('#lerr').textContent = err.message; }
}
async function logout() { await api('/auth/logout', 'POST'); showLogin(); }

// ---------- Navigation ----------
const PAGES = {
  dashboard: ['📊 Tableau de bord', dashboard], orders: ['📦 Commandes COD', orders], crm: ['👥 CRM Clients', crm],
  vendors: ['🏪 Vendeurs', vendors], agents: ['☎️ Agents', agents], couriers: ['🚚 Livreurs', couriers], stock: ['🏷️ Stock', stock], channels: ['📣 Canaux de vente', channels],
  marketing: ['📣 Marketing', marketing], stats: ['📈 Statistiques', stats], kanban: ['🗂️ Pipeline Kanban', kanban], automations: ['⚡ Automatisations', automations],
  tracking: ['📍 Tracking GPS', tracking], sync: ['🔄 Synchronisation', sync], settings: ['⚙️ Paramètres', settings],
};
function go(p) { location.hash = p; }
async function route() {
  const p = PAGES[location.hash.slice(1)] ? location.hash.slice(1) : 'dashboard';
  $('#nav').innerHTML = Object.entries(PAGES).map(([k, [l]]) => `<a class="${k === p ? 'on' : ''}" onclick="go('${k}')">${l}</a>`).join('');
  $('#title').textContent = PAGES[p][0]; document.body.classList.remove('open');
  $('#view').innerHTML = '<p class="mut">Chargement…</p>';
  try { await PAGES[p][1]($('#view')); } catch (e) { $('#view').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
window.onhashchange = route;
async function boot() {
  try { META = await api('/api/meta'); } catch { return; }
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); route();
}

// ---------- Tableau de bord ----------
async function dashboard(v) {
  const d = await api('/api/dashboard');
  const c = d.connectors;
  v.innerHTML = `<div class="grid">
    <div class="card kpi"><b>${d.today.n}</b><span>Commandes aujourd'hui</span></div>
    <div class="card kpi"><b>${d.counts.nouveau}</b><span>À confirmer</span></div>
    <div class="card kpi"><b>${d.counts.en_livraison + d.counts.expedie}</b><span>En cours de livraison</span></div>
    <div class="card kpi"><b>${d.counts.livre}</b><span>Livrées (non payées)</span></div></div>
  <div class="card"><h3>Statuts</h3><div class="row">${Object.entries(d.counts).map(([s, n]) => `${badge(s)} <b>${n}</b>`).join(' ')}</div></div>
  <div class="card"><h3>🔧 Diagnostic système</h3><table>
    ${Object.entries(c).map(([k, ok]) => `<tr><td>${k}</td><td>${ok ? '✅ Configuré' : '⚪ Non configuré (.env)'}</td></tr>`).join('')}
    <tr><td>Commandes non synchronisées</td><td>${d.unsynced}</td></tr></table></div>
  ${d.lowStock.length ? `<div class="card"><h3>⚠️ Stock faible</h3>${d.lowStock.map(p => `${esc(p.name)} : <b>${p.stock}</b>`).join('<br>')}</div>` : ''}`;
}

// ---------- Commandes ----------
let lists = {};
async function loadLists() {
  const [a, c, ch, p] = await Promise.all(['/api/agents', '/api/couriers', '/api/channels', '/api/products'].map(u => api(u)));
  lists = { agents: a, couriers: c, channels: ch, products: p };
}
const opts = (arr, sel, lab) => `<option value="">—</option>` + arr.map(x => `<option value="${x.id}" ${x.id == sel ? 'selected' : ''}>${esc(lab(x))}</option>`).join('');
async function orders(v, filter = {}) {
  await loadLists();
  const qs = new URLSearchParams(filter).toString();
  const rows = await api('/api/orders?' + qs);
  v.innerHTML = `<div class="card row">
    <input id="q" placeholder="Rechercher nom, téléphone, n°" value="${esc(filter.q || '')}">
    <select id="fs"><option value="">Tous les statuts</option>${META.statuses.map(s => `<option value="${s}" ${s === filter.status ? 'selected' : ''}>${LABEL[s]}</option>`).join('')}</select>
    <button onclick="orders($('#view'),{q:$('#q').value,status:$('#fs').value})">Filtrer</button>
    <button onclick="newOrder()">+ Commande</button></div>
  <div class="card tw"><table><tr><th>#</th><th>Client</th><th>Produit</th><th>Montant</th><th>Statut</th><th>Agent</th><th>Livreur</th><th></th></tr>
  ${rows.map(o => `<tr><td>${o.id}</td><td>${o.blacklisted ? '🚫 ' : ''}<b>${esc(o.name)}</b><br><a href="tel:${esc(o.phone)}">${esc(o.phone)}</a><br><span class="mut">${esc(o.city)}</span></td>
    <td>${esc(o.product_name)} × ${o.qty}${o.vendor ? `<br><span class="mut">🏪 ${esc(o.vendor)}</span>` : ''}</td><td>${money(o.amount)}</td>
    <td><select onchange="setStatus(${o.id},this.value)">${META.statuses.map(s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${LABEL[s]}</option>`).join('')}</select></td>
    <td><select onchange="assign(${o.id},{agent_id:this.value})">${opts(lists.agents, o.agent_id, a => a.first_name + ' ' + a.last_name)}</select></td>
    <td><select onchange="assign(${o.id},{courier_id:this.value})">${opts(lists.couriers, o.courier_id, c => c.name)}</select></td>
    <td><button class="sm" onclick="orderDetail(${o.id})">👁</button></td></tr>`).join('') || '<tr><td colspan=8 class="mut">Aucune commande</td></tr>'}
  </table></div>`;
}
async function setStatus(id, status) { await api(`/api/orders/${id}/status`, 'PUT', { status }); toast('Statut mis à jour'); }
async function assign(id, body) { await api(`/api/orders/${id}/assign`, 'PUT', body); toast('Assigné'); }
async function orderDetail(id) {
  const o = await api('/api/orders/' + id);
  modal(`<h3>Commande #${o.id} ${badge(o.status)}</h3>
    <p><b>${esc(o.name)}</b> · <a href="tel:${esc(o.phone)}">${esc(o.phone)}</a> · <a target="_blank" href="https://wa.me/${esc(o.phone).replace(/\D/g, '')}">WhatsApp</a><br>
    ${esc(o.address)}, ${esc(o.city)}<br>${esc(o.product_name)} × ${o.qty} — <b>${money(o.amount)}</b></p>
    <h4>Historique</h4>${o.history.map(h => `<div>${esc(h.created_at)} — ${badge(h.status)} ${esc(h.note)}</div>`).join('')}
    <form class="f" style="margin-top:12px" onsubmit="event.preventDefault();api('/api/orders/${id}/note','POST',formData(this)).then(()=>orderDetail(${id}))">
    <textarea name="note" placeholder="Ajouter une note" required></textarea><button>Ajouter la note</button></form>`);
}
async function newOrder() {
  await loadLists();
  modal(`<h3>Nouvelle commande</h3><form class="f" onsubmit="event.preventDefault();api('/api/orders','POST',formData(this)).then(()=>{closeModal();route()})">
    <input name="name" placeholder="Nom" required><input name="phone" placeholder="Téléphone" required>
    <input name="address" placeholder="Adresse" required><input name="city" placeholder="Ville">
    <select name="product_id">${opts(lists.products, null, p => `${p.name} (${money(p.price)})`)}</select>
    <input name="qty" type="number" value="1" min="1"><select name="channel_id">${opts(lists.channels, null, c => c.name)}</select>
    <button>Créer</button></form>`);
}

// ---------- Kanban ----------
async function kanban(v) {
  const rows = await api('/api/orders');
  v.innerHTML = `<div class="kanban">${META.statuses.map(s => `<div class="col" ondragover="event.preventDefault()" ondrop="drop(event,'${s}')">
    <h4>${LABEL[s]} (${rows.filter(o => o.status === s).length})</h4>
    ${rows.filter(o => o.status === s).map(o => `<div class="kc" draggable="true" ondragstart="event.dataTransfer.setData('id',${o.id})" onclick="orderDetail(${o.id})">
      <b>#${o.id} ${esc(o.name)}</b><br><span class="mut">${esc(o.product_name)} · ${money(o.amount)}</span></div>`).join('')}</div>`).join('')}</div>`;
}
async function drop(e, s) { await setStatus(e.dataTransfer.getData('id'), s); kanban($('#view')); }

// ---------- CRM ----------
async function crm(v) {
  const rows = await api('/api/customers');
  v.innerHTML = `<div class="card tw"><table><tr><th>Client</th><th>Segment</th><th>Score</th><th>Commandes</th><th>Dépensé</th><th>Tags</th><th></th></tr>
  ${rows.map(c => `<tr><td>${c.blacklisted ? '🚫 ' : ''}<b>${esc(c.name)}</b><br>${esc(c.phone)} · ${esc(c.city)}</td><td>${SEG[c.segment]}</td>
    <td>${c.score == null ? '—' : '★'.repeat(Math.round(c.score)) + ` ${c.score}`}</td><td>${c.orders} (${c.delivered} livrées)</td><td>${money(c.spent)}</td>
    <td>${esc(c.tags)}</td><td><button class="sm" onclick="customer(${c.id})">👁</button>
    <button class="sm gray" onclick="api('/api/customers/${c.id}','PUT',{blacklisted:${c.blacklisted ? 0 : 1}}).then(route)">${c.blacklisted ? 'Retirer' : '🚫 Blacklist'}</button></td></tr>`).join('') || '<tr><td colspan=7 class="mut">Aucun client</td></tr>'}</table></div>`;
}
async function customer(id) {
  const c = await api('/api/customers/' + id);
  modal(`<h3>${esc(c.name)} ${SEG[c.segment]}</h3><p>${esc(c.phone)} · ${esc(c.address)} ${esc(c.city)}</p>
  <form class="f" onsubmit="event.preventDefault();api('/api/customers/${id}','PUT',formData(this)).then(()=>{toast('Enregistré');closeModal();route()})">
  <input name="tags" placeholder="Tags (revendeur, grossiste…)" value="${esc(c.tags)}"><textarea name="notes" placeholder="Notes">${esc(c.notes)}</textarea><button>Enregistrer</button></form>
  <h4>Historique</h4>${c.orders.map(o => `<div>#${o.id} ${esc(o.created_at)} · ${esc(o.product_name)} · ${money(o.amount)} ${badge(o.status)}</div>`).join('')}`);
}

// ---------- Agents ----------
async function agents(v) {
  const rows = await api('/api/agents-full');
  v.innerHTML = `<div class="card"><button onclick="agentForm()">+ Ajouter un agent</button></div>
  <div class="card tw"><table><tr><th>Agent</th><th>Contact</th><th>Taux</th><th>Commandes</th><th>Dû</th><th></th></tr>
  ${rows.map(a => `<tr><td><b>${esc(a.first_name)} ${esc(a.last_name)}</b></td><td>${esc(a.phone)}<br>${esc(a.email)}</td><td>${a.commission_rate}%</td>
    <td>${a.orders} (${a.delivered} livrées)</td><td><b>${money(a.due)}</b></td>
    <td><button class="sm" onclick="payAgent(${a.id})">💰 Payer</button> <button class="sm gray" onclick='agentForm(${JSON.stringify(a).replace(/'/g, "&#39;")})'>✏️</button></td></tr>`).join('')}</table></div>`;
}
function agentForm(a = {}) {
  modal(`<h3>${a.id ? 'Modifier' : 'Ajouter'} un agent</h3><form class="f" onsubmit="event.preventDefault();api('/api/agents${a.id ? '/' + a.id : ''}','${a.id ? 'PUT' : 'POST'}',formData(this)).then(()=>{closeModal();route()})">
  <input name="first_name" placeholder="Prénom" value="${esc(a.first_name)}" required><input name="last_name" placeholder="Nom" value="${esc(a.last_name)}">
  <input name="phone" placeholder="Téléphone" value="${esc(a.phone)}"><input name="email" placeholder="Email" value="${esc(a.email)}">
  <label>Taux de commission (%)<input name="commission_rate" type="number" step="0.1" value="${a.commission_rate ?? 5}"></label><button>Enregistrer</button></form>`);
}
async function payAgent(id) {
  const rows = await api(`/api/agents/${id}/commissions`);
  if (!rows.length) return toast('Aucune commission en attente');
  modal(`<h3>Payer les commissions</h3><form onsubmit="event.preventDefault();api('/api/agents/${id}/pay','POST',{ids:[...this.querySelectorAll('input:checked')].map(i=>i.value)}).then(()=>{toast('Paiement enregistré');closeModal();route()})">
  <table>${rows.map(c => `<tr><td><input type="checkbox" value="${c.id}" checked style="width:auto"></td><td>Commande #${c.order_id} — ${esc(c.name)}</td><td>${money(c.amount)}</td></tr>`).join('')}</table>
  <p>Total : <b>${money(rows.reduce((s, c) => s + c.amount, 0))}</b></p><button>✅ Confirmer le paiement</button></form>`);
}

// ---------- Livreurs ----------
async function couriers(v) {
  const rows = await api('/api/couriers-full');
  v.innerHTML = `<div class="card"><button onclick="courierForm()">+ Ajouter un livreur</button></div>
  <div class="card tw"><table><tr><th>Livreur</th><th>Tarif/colis</th><th>Zones</th><th>En cours</th><th>Solde dû</th><th></th></tr>
  ${rows.map(c => `<tr><td><b>${esc(c.name)}</b><br>${esc(c.company)} · ${esc(c.phone)}</td><td>${money(c.fee_per_parcel)}</td><td>${esc(c.zones)}</td>
    <td>${c.active}</td><td><b>${money(c.balance)}</b></td>
    <td><button class="sm" onclick="courierPay(${c.id})">💳 Paiement</button> <button class="sm gray" onclick='courierForm(${JSON.stringify(c).replace(/'/g, "&#39;")})'>✏️</button></td></tr>`).join('')}</table></div>`;
}
function courierForm(c = {}) {
  modal(`<h3>${c.id ? 'Modifier' : 'Ajouter'} un livreur</h3><form class="f" onsubmit="event.preventDefault();api('/api/couriers${c.id ? '/' + c.id : ''}','${c.id ? 'PUT' : 'POST'}',formData(this)).then(()=>{closeModal();route()})">
  <input name="name" placeholder="Nom" value="${esc(c.name)}" required><input name="company" placeholder="Société" value="${esc(c.company)}">
  <input name="phone" placeholder="Téléphone" value="${esc(c.phone)}"><label>Tarif par colis<input name="fee_per_parcel" type="number" step="0.01" value="${c.fee_per_parcel ?? 0}"></label>
  <input name="zones" placeholder="Zones : Kinshasa, Gombe, Lemba" value="${esc(c.zones)}"><button>Enregistrer</button></form>`);
}
function courierPay(id) {
  modal(`<h3>Enregistrer un versement</h3><form class="f" onsubmit="event.preventDefault();api('/api/couriers/${id}/payment','POST',formData(this)).then(r=>{toast('Nouveau solde : '+money(r.balance));closeModal();route()})">
  <input name="amount" type="number" step="0.01" placeholder="Montant reçu" required><button>Valider</button></form>`);
}

// ---------- Tracking GPS ----------
async function tracking(v) {
  const rows = await api('/api/couriers-full');
  v.innerHTML = `<div class="card tw"><table><tr><th>Livreur</th><th>Auto-assign</th><th>Statut</th><th>Dernière position</th><th>En cours</th><th>App livreur</th></tr>
  ${rows.map(c => `<tr><td><b>${esc(c.name)}</b><br><span class="mut">${esc(c.zones)}</span></td>
    <td><input type="checkbox" style="width:auto" ${c.auto_assign ? 'checked' : ''} onchange="api('/api/couriers/${c.id}','PUT',{auto_assign:this.checked?1:0}).then(()=>toast('Enregistré'))"></td>
    <td>${c.online ? '🟢 En ligne' : '⚪ Hors ligne'}</td>
    <td>${c.last_lat ? `<a target="_blank" href="https://maps.google.com/?q=${c.last_lat},${c.last_lng}">📍 Voir</a><br><span class="mut">${esc(c.last_seen)}</span>` : '—'}</td>
    <td>${c.active}</td><td><button class="sm" onclick="genLink(${c.id},'${esc(c.phone)}')">🔑 Générer</button></td></tr>`).join('')}</table></div>
  <p class="mut">Avec l'auto-assignation, chaque commande « Confirmé » part au livreur le moins chargé de la ville du client.</p>`;
}
async function genLink(id, phone) {
  const { link } = await api(`/api/couriers/${id}/token`, 'POST');
  modal(`<h3>Lien app livreur</h3><p><code>${esc(link)}</code></p><div class="row">
  <button onclick="navigator.clipboard.writeText('${link}');toast('Copié')">📋 Copier</button>
  <a class="btn" target="_blank" href="https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent('Votre app livreur Mireb : ' + link)}">📲 Envoyer par WhatsApp</a></div>`);
}

// ---------- Stock ----------
let PRODS = [];
async function stock(v) {
  const [p, m] = await Promise.all([api('/api/products'), api('/api/stock-moves')]); PRODS = p;
  const optsTxt = x => { try { return JSON.parse(x.options || '[]').map(g => `${esc(g.name)} : ${g.values.map(o => esc(o.label) + (o.stock != null ? ` <small class="${o.stock ? 'mut' : 'err'}">(${o.stock})</small>` : '')).join(', ')}`).join('<br>'); } catch { return ''; } };
  v.innerHTML = `<div class="card"><div class="row"><h3 style="margin:0">Produits</h3><button style="flex:0 0 auto" onclick="adminProduct()">+ Ajouter un produit</button></div>
    <div class="tw"><table><tr><th></th><th>Produit</th><th>Prix</th><th>Stock</th><th>Variantes</th><th>Vendeur</th><th></th></tr>
    ${p.map(x => `<tr><td>${x.image ? `<img src="${esc(x.image)}" style="width:44px;height:44px;object-fit:cover;border-radius:6px">` : ''}</td>
      <td>${x.active ? '' : '🙈 '}<b>${esc(x.name)}</b>${x.slug ? `<br><a class="mut" target="_blank" href="/p/${esc(x.slug)}">/p/${esc(x.slug)}</a>` : ''}</td>
      <td>${money(x.price)}${x.compare_price > x.price ? `<br><s class="mut">${money(x.compare_price)}</s>` : ''}</td><td><b>${x.stock}</b></td>
      <td style="font-size:12px">${optsTxt(x) || '—'}</td><td>${x.vendor ? '🏪 ' + esc(x.vendor) : '<span class="mut">Boutique</span>'}</td>
      <td style="white-space:nowrap"><button class="sm" onclick="adminProduct(${x.id})">✏️</button> <button class="sm gray" onclick="adminDelProduct(${x.id})">🗑</button></td></tr>`).join('')
      || '<tr><td colspan=7 class="mut">Aucun produit</td></tr>'}</table></div></div>
  <div class="card"><h3>Mouvement de stock</h3><form class="row" onsubmit="event.preventDefault();api('/api/stock-moves','POST',formData(this)).then(route)">
    <select name="product_id">${p.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
    <select name="type"><option value="entree">Entrée</option><option value="sortie">Sortie</option></select>
    <input name="qty" type="number" placeholder="Quantité" required><input name="note" placeholder="Note"><button>Enregistrer</button></form>
    <div class="tw"><table>${m.map(x => `<tr><td>${esc(x.created_at)}</td><td>${esc(x.name)}</td><td>${x.qty > 0 ? '+' : ''}${x.qty}</td><td>${esc(x.note)}</td></tr>`).join('')}</table></div></div>`;
}
async function adminProduct(id) {
  const [cats, vendors] = await Promise.all([api('/api/categories'), api('/api/vendors')]);
  ProductEditor.open({ product: PRODS.find(x => x.id === id), categories: cats, vendors,
    save: d => api('/api/products' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', d).then(() => route()) });
}
async function adminDelProduct(id) {
  if (!confirm('Supprimer ce produit ? (masqué s\'il a déjà des commandes)')) return;
  await api('/api/products/' + id, 'DELETE'); route();
}

// ---------- Vendeurs (multivendeur) ----------
async function vendors(v) {
  const rows = await api('/api/vendors');
  v.innerHTML = `<div class="card"><p>Les vendeurs créent leur compte eux-mêmes sur <a target="_blank" href="/vendeur/">${location.origin}/vendeur/</a>.
    Chacun gère ses produits et voit uniquement ses commandes. Marketplace publique : <a target="_blank" href="/boutique">${location.origin}/boutique</a></p></div>
  <div class="card tw"><table><tr><th>Boutique</th><th>Contact</th><th>Produits</th><th>Commandes</th><th>CA livré</th><th>Statut</th></tr>
  ${rows.map(x => `<tr><td><b>${esc(x.shop_name)}</b><br><a target="_blank" href="/boutique/${esc(x.slug)}">/boutique/${esc(x.slug)}</a></td>
    <td>${esc(x.email)}<br>${esc(x.phone)}</td><td>${x.products}</td><td>${x.orders}</td><td>${money(x.ca)}</td>
    <td>${x.active ? '✅ Actif' : '⛔ Suspendu'}<br><button class="sm gray" onclick="api('/api/vendors/${x.id}','PUT',{active:${x.active ? 0 : 1}}).then(route)">
    ${x.active ? 'Suspendre' : 'Réactiver'}</button></td></tr>`).join('') || '<tr><td colspan=6 class="mut">Aucun vendeur inscrit</td></tr>'}</table></div>`;
}

// ---------- Marketing : catégories + Meta (Facebook / Instagram) ----------
const GOOGLE_CATS = ['Apparel & Accessories', 'Apparel & Accessories > Clothing', 'Apparel & Accessories > Shoes', 'Apparel & Accessories > Handbags, Wallets & Cases',
  'Apparel & Accessories > Jewelry', 'Apparel & Accessories > Clothing Accessories', 'Health & Beauty > Personal Care > Cosmetics', 'Health & Beauty > Personal Care',
  'Health & Beauty > Health Care', 'Electronics', 'Electronics > Communications > Telephony > Mobile Phones', 'Home & Garden', 'Home & Garden > Kitchen & Dining',
  'Home & Garden > Decor', 'Baby & Toddler', 'Toys & Games', 'Sporting Goods', 'Food, Beverages & Tobacco > Food Items', 'Vehicles & Parts', 'Furniture', 'Hardware'];
async function marketing(v) {
  const [m, cats] = await Promise.all([api('/api/marketing'), api('/api/categories')]);
  const base = m.base_url || location.origin, feed = `${base}/feeds/meta.csv`, ls = m.last_sync;
  const utm = (canal, camp) => `${base}/boutique?canal=${canal}&utm_source=facebook&utm_medium=paid&utm_campaign=${encodeURIComponent(camp)}`;
  v.innerHTML = `<datalist id="gcats">${GOOGLE_CATS.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
  <div class="grid">
    <div class="card kpi"><b>${m.stats.eligible}</b><span>Produits envoyables à Meta</span></div>
    <div class="card kpi"><b>${m.stats.in_stock}</b><span>En stock (diffusables en pub)</span></div>
    <div class="card kpi"><b>${m.stats.skipped.length}</b><span>Exclus (sans photo…)</span></div>
    <div class="card kpi"><b>${ls ? (ls.ok ? '✅' : '❌') : '—'}</b><span>${ls ? 'Synchro ' + new Date(ls.at).toLocaleString('fr-FR') : 'Jamais synchronisé'}</span></div></div>
  ${!m.base_url ? '<div class="card err">⚠️ Variable BASE_URL absente sur le serveur : les liens produits envoyés à Meta seraient incomplets.</div>' : ''}

  <div class="card"><h3>🔗 Connexion Meta (Facebook / Instagram)</h3>
  <p class="mut">Gestionnaire d'événements → Pixel (ID) · Gestionnaire de ventes → Catalogue (ID) · Paramètres de l'entreprise → Utilisateurs système →
    Générer un jeton avec les autorisations <code>catalog_management</code> et <code>ads_management</code>.</p>
  <form class="f" id="metaf" onsubmit="event.preventDefault();saveMeta(this)">
    <div class="row"><label>ID du Pixel<input name="meta_pixel_id" inputmode="numeric" value="${esc(m.meta_pixel_id)}" placeholder="123456789012345"></label>
      <label>ID du catalogue<input name="meta_catalog_id" inputmode="numeric" value="${esc(m.meta_catalog_id)}" placeholder="987654321098765"></label></div>
    <label>Jeton d'accès (utilisateur système)<input name="meta_access_token" type="password" autocomplete="off"
      placeholder="${m.token_set ? '✅ Enregistré — laisser vide pour le garder, « - » pour l’effacer' : 'EAAB…'}"></label>
    <label>Jeton API Conversions (facultatif, sinon le jeton ci-dessus)<input name="meta_capi_token" type="password" autocomplete="off"
      placeholder="${m.capi_token_set ? '✅ Enregistré' : 'Gestionnaire d’événements → Paramètres → Générer un jeton'}"></label>
    <div class="row"><label>Devise (ISO)<input name="currency_code" maxlength="3" value="${esc(m.currency_code || 'USD')}" placeholder="USD, CDF, XOF…"></label>
      <label>Marque par défaut<input name="meta_brand" value="${esc(m.meta_brand)}" placeholder="Mireb"></label></div>
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="meta_autosync" style="width:auto" ${m.meta_autosync === '1' ? 'checked' : ''}>
      Synchroniser automatiquement le catalogue (à chaque modification de produit + chaque heure)</label>
    <div class="row"><button>Enregistrer</button><button type="button" class="gray" onclick="metaAction('test')">🔌 Tester la connexion</button></div></form></div>

  <div class="card"><h3>🛍️ Catalogue produits</h3>
    <p><b>Option 1 — Flux automatique (le plus simple, sans jeton)</b> : Gestionnaire de ventes → Catalogue → Sources de données →
      Ajouter des articles → <i>Flux de données</i> → <i>Programmé</i> → coller cette adresse, fréquence <b>toutes les heures</b> :</p>
    <p><code>${esc(feed)}</code> <button class="sm" onclick="navigator.clipboard.writeText('${esc(feed)}').then(()=>toast('Copié'))">Copier</button>
      <a class="btn sm gray" href="/feeds/meta.csv" target="_blank" style="padding:4px 8px;font-size:12px">Voir</a></p>
    <p><b>Option 2 — Synchronisation directe (API)</b> : envoie tout de suite les produits, prix, stocks et photos, et retire les produits masqués.</p>
    <div class="row"><button onclick="metaAction('sync')">🔄 Synchroniser maintenant</button>
      <button class="gray" onclick="metaAction('product-sets')">🧩 Créer les ensembles de produits par catégorie</button></div>
    ${ls && !ls.ok ? `<p class="err">Dernière erreur : ${esc(ls.error)}</p>` : ''}
    ${ls && ls.ok ? `<p class="mut">Dernier envoi : ${ls.sent} produits, ${ls.deleted} retirés.</p>` : ''}
    ${m.stats.skipped.length ? `<details><summary>${m.stats.skipped.length} produit(s) non envoyé(s)</summary>${m.stats.skipped.map(s => `<div>#${s.id} ${esc(s.name)} — <span class="err">${esc(s.reason)}</span></div>`).join('')}</details>` : ''}
    ${m.stats.no_category ? `<p class="mut">⚠️ ${m.stats.no_category} produit(s) sans catégorie Google : Meta les classera moins bien.</p>` : ''}</div>

  <div class="card"><h3>🏷️ Catégories (boutique + Meta)</h3>
    <p class="mut">Chaque catégorie apparaît dans la boutique et chez les vendeurs. La <b>catégorie Google</b> est transmise à Meta
      (<code>google_product_category</code>) ; chaque catégorie devient un <b>ensemble de produits</b> pour vos campagnes.</p>
    <div class="tw"><table><tr><th>Icône</th><th>Nom</th><th>Catégorie Google / Meta</th><th>Produits</th><th></th></tr>
    ${cats.map(c => `<tr><td><input value="${esc(c.icon)}" style="width:52px;text-align:center" id="ci-${c.slug}"></td>
      <td><input value="${esc(c.name)}" id="cn-${c.slug}"></td>
      <td><input list="gcats" value="${esc(c.google_category)}" id="cg-${c.slug}" placeholder="ex : Apparel & Accessories > Shoes"></td>
      <td>${c.products}</td><td style="white-space:nowrap"><button class="sm" onclick="saveCat('${c.slug}')">💾</button>
      <button class="sm gray" onclick="delCat('${c.slug}',${c.products})">🗑</button></td></tr>`).join('')}</table></div>
    <form class="row" style="margin-top:10px" onsubmit="event.preventDefault();api('/api/categories','POST',formData(this)).then(()=>{toast('Catégorie ajoutée');route()})">
      <input name="icon" placeholder="🎁" style="flex:0 0 60px;text-align:center"><input name="name" placeholder="Nouvelle catégorie" required>
      <input name="google_category" list="gcats" placeholder="Catégorie Google (facultatif)"><button>+ Ajouter</button></form></div>

  <div class="card"><h3>🚀 Créer une campagne catalogue (Advantage+)</h3><ol>
    <li>Connectez le catalogue ci-dessus (flux ou synchronisation) et le <b>Pixel</b> (il envoie <i>ViewContent</i> sur chaque page produit et <i>Purchase</i> à chaque commande, aussi par l'API Conversions).</li>
    <li>Gestionnaire de ventes → Catalogue → <b>Événements</b> : reliez le Pixel au catalogue (les <code>content_ids</code> correspondent aux ID produits).</li>
    <li>Gestionnaire de publicités → <b>Créer</b> → objectif <b>Ventes</b> → <b>Campagne catalogue Advantage+</b> → choisissez le catalogue puis un <b>ensemble de produits</b> (une catégorie ou « Promotions »).</li>
    <li>Optimisation : <b>Achat</b> (Purchase). Chaque commande passée depuis la pub est comptée et suivie par canal.</li></ol>
    <p><b>Liens de suivi pour vos pubs</b> (les commandes apparaissent par canal dans Statistiques) :</p>
    ${m.channels.length ? m.channels.map(ch => `<div style="margin:6px 0"><b>${esc(ch.name)}</b> : <code>${esc(utm(ch.id, ch.name))}</code></div>`).join('')
      : '<p class="mut">Créez d\'abord un canal (ex : « Facebook Ads ») dans 📣 Canaux de vente.</p>'}</div>`;
}
async function saveMeta(f) {
  const d = formData(f); d.meta_autosync = f.meta_autosync.checked ? '1' : '0';
  if (!d.meta_access_token) delete d.meta_access_token; if (!d.meta_capi_token) delete d.meta_capi_token;
  await api('/api/marketing', 'PUT', d); toast('Enregistré'); route();
}
async function metaAction(a) {
  toast('Envoi à Meta…');
  const r = await api('/api/marketing/' + a, 'POST');
  if (a === 'test') toast(`✅ Catalogue « ${r.catalog.name} » (${r.catalog.product_count} produits)${r.pixel ? r.pixel.error ? ' · Pixel : ' + r.pixel.error : ' · Pixel « ' + r.pixel.name + ' »' : ''}`);
  if (a === 'sync') { toast(`✅ ${r.sent} produits envoyés, ${r.deleted} retirés`); route(); }
  if (a === 'product-sets') toast(`✅ ${r.created.length} ensemble(s) créé(s), ${r.existing} déjà présent(s)`);
}
async function saveCat(slug) {
  await api('/api/categories/' + slug, 'PUT', { icon: $('#ci-' + slug).value, name: $('#cn-' + slug).value, google_category: $('#cg-' + slug).value });
  toast('Catégorie enregistrée');
}
async function delCat(slug, n) {
  if (!confirm(n ? `${n} produit(s) resteront en ligne sans catégorie. Supprimer ?` : 'Supprimer cette catégorie ?')) return;
  await api('/api/categories/' + slug, 'DELETE'); route();
}

// ---------- Canaux ----------
async function channels(v) {
  const rows = await api('/api/channels');
  v.innerHTML = `<div class="card"><form class="row" onsubmit="event.preventDefault();api('/api/channels','POST',formData(this)).then(route)">
    <input name="name" placeholder="Ex : Facebook Ads, TikTok" required><button>+ Canal</button></form></div>
  <div class="card tw"><table><tr><th>ID</th><th>Canal</th><th>Lien à mettre dans la pub</th></tr>
  ${rows.map(c => `<tr><td>${c.id}</td><td>${esc(c.name)}</td><td><code>${location.origin}/commande.html?product_id=ID&amp;canal=${c.id}</code><br>
    <span class="mut">ou sur WordPress : https://votre-site.com/produit/?mireb_canal=${c.id}</span></td></tr>`).join('')}</table></div>`;
}

// ---------- Statistiques ----------
async function stats(v, days = 30) {
  const s = await api('/api/stats?days=' + days); const t = s.totals;
  const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';
  const max = Math.max(1, ...s.daily.map(d => d.n));
  v.innerHTML = `<div class="card row"><select onchange="stats($('#view'),this.value)">${[7, 30, 90, 365].map(d => `<option ${d == days ? 'selected' : ''} value="${d}">${d} jours</option>`).join('')}</select>
    <a class="btn" href="/api/export.csv">⬇️ Export CSV</a></div>
  <div class="grid"><div class="card kpi"><b>${t.n}</b><span>Commandes</span></div><div class="card kpi"><b>${pct(t.confirme, t.n)}</b><span>Taux de confirmation</span></div>
    <div class="card kpi"><b>${pct(t.livre, t.confirme)}</b><span>Taux de livraison</span></div><div class="card kpi"><b>${money(t.ca)}</b><span>Chiffre d'affaires</span></div></div>
  <div class="card"><h3>Commandes par jour</h3>${s.daily.map(d => `<div class="row" style="flex-wrap:nowrap"><span style="flex:0 0 90px">${d.d}</span>
    <div style="flex:1"><div class="bar" style="width:${d.n / max * 100}%"></div></div><span style="flex:0 0 40px">${d.n}</span></div>`).join('') || '<p class="mut">Pas de données</p>'}</div>
  <div class="card tw"><h3>Par canal</h3><table>${s.byChannel.map(c => `<tr><td>${esc(c.name)}</td><td>${c.n} commandes</td><td>${pct(c.livre, c.n)} livrées</td></tr>`).join('')}</table></div>
  <div class="card tw"><h3>Par agent</h3><table>${s.byAgent.map(c => `<tr><td>${esc(c.name)}</td><td>${c.n} commandes</td><td>${pct(c.livre, c.n)} livrées</td></tr>`).join('')}</table></div>`;
}

// ---------- Automatisations ----------
async function automations(v) {
  const [rows, log] = await Promise.all([api('/api/automations'), api('/api/automation-log')]);
  v.innerHTML = `<div class="card"><button onclick="autoForm()">+ Nouvelle automatisation</button>
    <p class="mut">Variables : {id} {nom} {telephone} {adresse} {ville} {produit} {montant} {devise} {statut}</p></div>
  <div class="card tw"><table><tr><th>Actif</th><th>Nom</th><th>Déclencheur</th><th>Canal</th><th></th></tr>
  ${rows.map(a => `<tr><td><input type="checkbox" style="width:auto" ${a.active ? 'checked' : ''} onchange="api('/api/automations/${a.id}','PUT',{active:this.checked?1:0}).then(()=>toast('Enregistré'))"></td>
    <td><b>${esc(a.name)}</b><br><span class="mut">${esc(a.template)}</span></td>
    <td>${LABEL[a.trigger.replace('status:', '')]}${a.delay_hours ? ` depuis ${a.delay_hours}h` : ''}</td><td>${a.channel} → ${a.target}</td>
    <td><button class="sm gray" onclick='autoForm(${JSON.stringify(a).replace(/'/g, "&#39;")})'>✏️</button>
    <button class="sm gray" onclick="api('/api/automations/${a.id}','DELETE').then(route)">🗑</button></td></tr>`).join('')}</table></div>
  <div class="card tw"><h3>Journal</h3><table>${log.map(l => `<tr><td>${esc(l.created_at)}</td><td>${esc(l.name)}</td><td>#${l.order_id}</td><td>${l.ok ? '✅' : '❌'} ${esc(l.info)}</td></tr>`).join('') || '<tr><td class="mut">Vide</td></tr>'}</table></div>`;
}
function autoForm(a = {}) {
  modal(`<h3>Automatisation</h3><form class="f" onsubmit="event.preventDefault();api('/api/automations${a.id ? '/' + a.id : ''}','${a.id ? 'PUT' : 'POST'}',formData(this)).then(()=>{closeModal();route()})">
  <input name="name" placeholder="Nom" value="${esc(a.name)}" required>
  <label>Quand la commande passe au statut<select name="trigger">${META.statuses.map(s => `<option value="status:${s}" ${a.trigger === 'status:' + s ? 'selected' : ''}>${LABEL[s]}</option>`).join('')}</select></label>
  <label>Délai (heures, 0 = immédiat)<input name="delay_hours" type="number" value="${a.delay_hours ?? 0}"></label>
  <select name="channel">${['whatsapp', 'sms', 'email'].map(c => `<option ${a.channel === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
  <select name="target"><option value="client">Client</option><option value="admin" ${a.target === 'admin' ? 'selected' : ''}>Admin</option></select>
  <textarea name="template" rows="4" required>${esc(a.template)}</textarea><input type="hidden" name="active" value="${a.active ?? 1}"><button>Enregistrer</button></form>`);
}

// ---------- Synchronisation ----------
async function sync(v) {
  const d = await api('/api/dashboard');
  v.innerHTML = `<div class="card"><p>WooCommerce : ${d.connectors.woocommerce ? '✅ connecté' : '⚪ non configuré — renseignez WC_URL, WC_KEY, WC_SECRET dans .env'}</p>
  <p>Commandes non synchronisées : <b>${d.unsynced}</b></p><div class="row">
  <button onclick="runSync('products')">📥 Importer les produits</button><button onclick="runSync('pull')">📥 Récupérer les commandes</button>
  <button onclick="runSync('push')">📤 Rattraper les non synchronisées</button></div>
  <p class="mut">Synchronisation automatique toutes les 5 minutes. Webhook temps réel : <code>${location.origin}/public/webhooks/woocommerce</code> (sujet « Commande créée »).</p></div>`;
}
async function runSync(k) { const r = await api('/api/sync/' + k, 'POST'); toast(JSON.stringify(r)); route(); }

// ---------- Paramètres ----------
async function settings(v) {
  const s = await api('/api/settings');
  v.innerHTML = `<div class="card"><h3>Formulaire COD — Pages produit</h3><form class="f" onsubmit="event.preventDefault();api('/api/settings','PUT',formData(this)).then(()=>toast('Enregistré'))">
  <label>Nom de la boutique<input name="shop_name" value="${esc(s.shop_name)}"></label>
  <label>Couleur du bouton<input name="form_color" type="color" value="${esc(s.form_color || '#e8342a')}"></label>
  <label>Texte du bouton<input name="form_button" value="${esc(s.form_button)}" placeholder="Commander — Paiement à la livraison"></label>
  <label>Sous-titre<input name="form_subtitle" value="${esc(s.form_subtitle)}"></label>
  <label>Badge urgence<input name="form_badge" value="${esc(s.form_badge)}" placeholder="Offre limitée"></label>
  <label>Texte de garantie<input name="form_guarantee" value="${esc(s.form_guarantee)}"></label><button>Enregistrer</button></form></div>
  <div class="card"><h3>Intégrer le formulaire</h3><p>Page hébergée : <code>${location.origin}/commande.html?product_id=1</code></p>
  <p>Sur n'importe quel site (WordPress, landing page) :</p>
  <code>&lt;div data-mireb-form data-product="1" data-canal="1"&gt;&lt;/div&gt;&lt;script src="${location.origin}/widget.js"&gt;&lt;/script&gt;</code></div>
  <div class="card"><h3>📱 Applications Android (Google Play)</h3>
  <p class="mut">Après avoir créé l'app sur PWABuilder, collez ici une ligne par application : <b>nom du package</b> puis <b>empreinte SHA-256</b>
  (fichier <code>assetlinks.json</code> du paquet ou Play Console → Intégrité de l'application → Signature). Vérification :
  <a target="_blank" href="/.well-known/assetlinks.json">${location.origin}/.well-known/assetlinks.json</a></p>
  <form class="f" onsubmit="event.preventDefault();api('/api/settings','PUT',formData(this)).then(()=>toast('Enregistré'))">
  <textarea name="android_apps" rows="3" placeholder="online.mireb.boutique 14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5">${esc(s.android_apps)}</textarea>
  <button>Enregistrer</button></form></div>
  <div class="card"><h3>Mot de passe admin</h3><form class="row" onsubmit="event.preventDefault();api('/auth/password','POST',formData(this)).then(()=>toast('Modifié'))">
  <input name="password" type="password" placeholder="Nouveau mot de passe" required minlength="8"><button>Changer</button></form></div>`;
}

boot();
