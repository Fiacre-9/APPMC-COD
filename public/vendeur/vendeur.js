// Espace vendeur Mireb (vanilla JS) : produits, page produit + formulaire, commandes
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const LABEL = { nouveau: 'Nouveau', en_confirmation: 'En confirmation', confirme: 'Confirmé', en_preparation: 'En préparation',
  expedie: 'Expédié', en_livraison: 'En livraison', livre: 'Livré', paye: 'Payé', annule: 'Annulé', retourne: 'Retourné' };
let ME = { currency: '$', statuses: [] }, MODE = 'login', PRODUCTS = [];
const money = n => `${(+n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${ME.currency}`;
const badge = s => `<span class="badge s-${s}">${LABEL[s] || s}</span>`;

async function api(url, method = 'GET', body) {
  const r = await fetch('/vendor' + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && url.startsWith('/api')) { showLogin(); throw new Error('Non connecté'); }
  if (!r.ok) { toast(d.error || 'Erreur'); throw new Error(d.error || 'Erreur'); }
  return d;
}
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 2500); }
function modal(html) { $('#mbox').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); }
const formData = f => Object.fromEntries(new FormData(f));
function copy(t) { navigator.clipboard.writeText(t).then(() => toast('Copié ✅'), () => prompt('Copiez :', t)); }

// ---------- Connexion / inscription ----------
function showLogin() { $('#login').classList.remove('hidden'); $('#app').classList.add('hidden'); }
function mode(m) {
  MODE = m; const reg = m === 'register';
  document.querySelectorAll('.reg').forEach(e => { e.classList.toggle('hidden', !reg); e.required = reg; });
  $('#t-login').classList.toggle('off', reg); $('#t-reg').classList.toggle('off', !reg);
  $('#abtn').textContent = reg ? 'Créer ma boutique' : 'Se connecter'; $('#lerr').textContent = '';
}
async function auth(e) {
  e.preventDefault();
  try { await api('/auth/' + MODE, 'POST', formData(e.target)); boot(); } catch (err) { $('#lerr').textContent = err.message; }
}
async function logout() { await api('/auth/logout', 'POST'); showLogin(); }

// ---------- Navigation ----------
const PAGES = { home: ['📊 Tableau de bord', home], products: ['🛍️ Mes produits', products], orders: ['📦 Mes commandes', orders], shop: ['🏪 Ma boutique', shop] };
function go(p) { location.hash = p; }
async function route() {
  const p = PAGES[location.hash.slice(1)] ? location.hash.slice(1) : 'home';
  $('#nav').innerHTML = Object.entries(PAGES).map(([k, [l]]) => `<a class="${k === p ? 'on' : ''}" onclick="go('${k}')">${l}</a>`).join('');
  $('#title').textContent = PAGES[p][0]; document.body.classList.remove('open');
  $('#view').innerHTML = '<p class="mut">Chargement…</p>';
  try { await PAGES[p][1]($('#view')); } catch (e) { $('#view').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
window.onhashchange = route;
async function boot() {
  try { ME = await api('/api/me'); } catch { return; }
  $('#shop').textContent = ME.shop_name; $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); route();
}

// ---------- Tableau de bord ----------
async function home(v) {
  const d = await api('/api/dashboard'), t = d.totals;
  v.innerHTML = `<div class="grid">
    <div class="card kpi"><b>${d.products}</b><span>Produits</span></div>
    <div class="card kpi"><b>${t.n}</b><span>Commandes</span></div>
    <div class="card kpi"><b>${t.nouveau || 0}</b><span>À confirmer</span></div>
    <div class="card kpi"><b>${money(t.ca)}</b><span>CA livré</span></div></div>
  <div class="card"><h3>Démarrer</h3><ol>
    <li>Ajoutez un produit dans <a href="#products">Mes produits</a> (photo, prix, description).</li>
    <li>Copiez le <b>lien de la page produit</b> : le formulaire de commande y est déjà intégré.</li>
    <li>Partagez-le sur Facebook, TikTok, WhatsApp… Les commandes arrivent dans <a href="#orders">Mes commandes</a>.</li></ol>
    <p>Votre boutique : <a target="_blank" href="/boutique/${esc(ME.slug)}">${location.origin}/boutique/${esc(ME.slug)}</a></p></div>`;
}

// ---------- Produits ----------
const pageUrl = p => `${location.origin}/p/${p.slug}`;
const widgetCode = p => `<div data-mireb-form data-product="${p.id}"></div>\n<script src="${location.origin}/widget.js"></script>`;
async function products(v) {
  PRODUCTS = await api('/api/products');
  v.innerHTML = `<div class="card"><button onclick="productForm()">+ Ajouter un produit</button></div>
  <div class="card tw"><table><tr><th></th><th>Produit</th><th>Prix</th><th>Stock</th><th>Partager</th><th></th></tr>
  ${PRODUCTS.map(p => `<tr><td>${p.image ? `<img class="pimg" src="${esc(p.image)}">` : '<div class="pimg"></div>'}</td>
    <td><b>${esc(p.name)}</b>${p.active ? '' : '<br><span class="badge s-annule">Masqué</span>'}</td>
    <td>${money(p.price)}${p.compare_price > p.price ? `<br><s class="mut">${money(p.compare_price)}</s>` : ''}</td><td>${p.stock}</td>
    <td><div class="share"><a class="btn" target="_blank" href="/p/${esc(p.slug)}">👁 Page</a>
      <button class="sm" onclick="copy(pageUrl(PRODUCTS.find(x=>x.id==${p.id})))">🔗 Lien</button>
      <a class="btn" target="_blank" href="https://wa.me/?text=${encodeURIComponent(p.name + ' ' + pageUrl(p))}">WhatsApp</a>
      <button class="sm gray" onclick="copy(widgetCode(PRODUCTS.find(x=>x.id==${p.id})))">&lt;/&gt; Code</button></div></td>
    <td><button class="sm gray" onclick="productForm(${p.id})">✏️</button> <button class="sm gray" onclick="delProduct(${p.id})">🗑</button></td></tr>`).join('')
    || '<tr><td colspan=6 class="mut">Aucun produit — ajoutez le premier !</td></tr>'}</table></div>
  <p class="mut">🔗 Lien = page produit avec formulaire de commande. Ajoutez <code>?canal=ID</code> pour suivre une pub. &lt;/&gt; Code = formulaire à coller sur votre propre site.</p>`;
}
function productForm(id) {
  const p = PRODUCTS.find(x => x.id === id) || { active: 1 };
  modal(`<h3>${id ? 'Modifier' : 'Nouveau'} produit</h3><form class="f" onsubmit="saveProduct(event,${id || 0})">
    <label>Photo <input type="file" accept="image/*" onchange="pickImage(this)"></label>
    <img id="prev" class="prev" src="${esc(p.image || '')}" ${p.image ? '' : 'hidden'}><input type="hidden" name="image_data">
    <input name="name" placeholder="Nom du produit" value="${esc(p.name)}" required>
    <div class="row"><input name="price" type="number" step="0.01" min="0" placeholder="Prix de vente" value="${p.price ?? ''}" required>
    <input name="compare_price" type="number" step="0.01" min="0" placeholder="Ancien prix (barré)" value="${p.compare_price ?? ''}"></div>
    <input name="stock" type="number" min="0" placeholder="Stock" value="${p.stock ?? ''}">
    <textarea name="description" rows="5" placeholder="Description, avantages, livraison…">${esc(p.description)}</textarea>
    <label><input type="checkbox" name="active" style="width:auto" ${p.active ? 'checked' : ''}> Visible dans la boutique</label>
    <button>Enregistrer</button></form>`);
}
// Redimensionne la photo côté navigateur (max 1200 px, JPEG) pour des pages rapides
function pickImage(input) {
  const f = input.files[0]; if (!f) return;
  const img = new Image(); img.onload = () => {
    const k = Math.min(1, 1200 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const data = c.toDataURL('image/jpeg', 0.85);
    input.form.image_data.value = data; $('#prev').src = data; $('#prev').hidden = false; URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(f);
}
async function saveProduct(e, id) {
  e.preventDefault(); const d = formData(e.target);
  d.active = e.target.active.checked ? 1 : 0; if (!d.image_data) delete d.image_data;
  d.compare_price = d.compare_price === '' ? null : +d.compare_price; d.stock = +d.stock || 0; d.price = +d.price;
  await api('/api/products' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', d);
  toast('Produit enregistré'); closeModal(); route();
}
async function delProduct(id) { if (confirm('Supprimer ce produit ?')) { await api('/api/products/' + id, 'DELETE'); route(); } }

// ---------- Commandes ----------
async function orders(v, status = '') {
  const rows = await api('/api/orders' + (status ? '?status=' + status : ''));
  v.innerHTML = `<div class="card row"><select onchange="orders($('#view'),this.value)"><option value="">Tous les statuts</option>
    ${ME.statuses.map(s => `<option value="${s}" ${s === status ? 'selected' : ''}>${LABEL[s]}</option>`).join('')}</select></div>
  <div class="card tw"><table><tr><th>#</th><th>Client</th><th>Produit</th><th>Montant</th><th>Statut</th></tr>
  ${rows.map(o => `<tr><td>${o.id}<br><span class="mut">${esc(o.created_at)}</span></td>
    <td><b>${esc(o.name)}</b><br><a href="tel:${esc(o.phone)}">${esc(o.phone)}</a> · <a target="_blank" href="https://wa.me/${esc(o.phone).replace(/\D/g, '')}">WhatsApp</a>
    <br><span class="mut">${esc(o.address)} ${esc(o.city)}</span></td><td>${esc(o.product_name)} × ${o.qty}</td><td>${money(o.amount)}</td>
    <td><select onchange="api('/api/orders/${o.id}/status','PUT',{status:this.value}).then(()=>toast('Statut mis à jour'))">
    ${ME.statuses.map(s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${LABEL[s]}</option>`).join('')}</select></td></tr>`).join('')
    || '<tr><td colspan=5 class="mut">Aucune commande pour le moment</td></tr>'}</table></div>`;
}

// ---------- Ma boutique ----------
async function shop(v) {
  v.innerHTML = `<div class="card"><p>Lien de votre boutique : <a target="_blank" href="/boutique/${esc(ME.slug)}">${location.origin}/boutique/${esc(ME.slug)}</a>
    <button class="sm" onclick="copy('${location.origin}/boutique/${esc(ME.slug)}')">Copier</button></p>
  <form class="f" onsubmit="event.preventDefault();api('/api/me','PUT',formData(this)).then(()=>{toast('Enregistré');boot()})">
    <input name="shop_name" placeholder="Nom de la boutique" value="${esc(ME.shop_name)}" required>
    <input name="phone" placeholder="Téléphone" value="${esc(ME.phone)}"><input name="whatsapp" placeholder="WhatsApp" value="${esc(ME.whatsapp)}">
    <textarea name="description" rows="4" placeholder="Présentation de la boutique">${esc(ME.description)}</textarea>
    <input name="password" type="password" minlength="8" placeholder="Nouveau mot de passe (laisser vide pour ne pas changer)" autocomplete="new-password">
    <button>Enregistrer</button></form></div>`;
}

if (location.hash === '#inscription') mode('register');
boot();
