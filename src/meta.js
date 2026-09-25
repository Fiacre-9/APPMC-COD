// Marketing Meta (Facebook / Instagram) : catalogue produits, ensembles de produits par catégorie,
// Pixel + API Conversions. Réglages dans Admin → Marketing (table settings, clé d'accès jamais renvoyée au navigateur).
const crypto = require('crypto');
const { db, getSetting, setSetting, categories } = require('./db');

const GRAPH = 'https://graph.facebook.com/v21.0';
const cfg = () => ({
  pixel: getSetting('meta_pixel_id'), catalog: getSetting('meta_catalog_id'), token: getSetting('meta_access_token'),
  capiToken: getSetting('meta_capi_token') || getSetting('meta_access_token'), currency: (getSetting('currency_code') || 'USD').toUpperCase(),
  brand: getSetting('meta_brand') || getSetting('shop_name') || 'Mireb', autosync: getSetting('meta_autosync', '1') === '1',
  base: (process.env.BASE_URL || '').replace(/\/$/, ''),
});

// Texte brut d'une description Markdown (Meta n'affiche pas le Markdown)
const plain = (t) => String(t || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/^#+\s*/gm, '').replace(/[*_`>]/g, '').replace(/^\s*[-•]\s+/gm, '• ').replace(/\n{3,}/g, '\n\n').trim();
const photos = (p) => { try { const g = JSON.parse(p.gallery || '[]'); return g.length ? g : (p.image ? [p.image] : []); } catch { return p.image ? [p.image] : []; } };
const money = (n, cur) => `${(+n || 0).toFixed(2)} ${cur}`;

// Produits visibles au format catalogue Meta (id = id du produit = content_ids du Pixel)
function catalogItems() {
  const c = cfg(), cats = Object.fromEntries(categories().map(x => [x.slug, x]));
  const rows = db.prepare(`SELECT p.*, v.shop_name FROM products p LEFT JOIN vendors v ON v.id=p.vendor_id
    WHERE p.active=1 AND (p.vendor_id IS NULL OR v.active=1) ORDER BY p.id`).all();
  const items = [], skipped = [];
  for (const p of rows) {
    const imgs = photos(p).map(u => /^https?:/.test(u) ? u : c.base + u);
    if (!imgs.length) { skipped.push({ id: p.id, name: p.name, reason: 'pas de photo' }); continue; }
    if (!c.base) { skipped.push({ id: p.id, name: p.name, reason: 'BASE_URL manquant' }); continue; }
    const promo = p.compare_price > p.price, cat = cats[p.category];
    items.push({
      id: String(p.id), title: String(p.name).slice(0, 150),
      description: (plain(p.short_description) || plain(p.description) || p.name).slice(0, 5000),
      availability: p.stock > 0 ? 'in stock' : 'out of stock', condition: 'new',
      price: money(promo ? p.compare_price : p.price, c.currency), ...(promo ? { sale_price: money(p.price, c.currency) } : {}),
      link: `${c.base}/p/${p.slug}?utm_source=facebook&utm_medium=catalog`, image_link: imgs[0],
      ...(imgs.length > 1 ? { additional_image_link: imgs.slice(1, 10) } : {}), brand: (p.shop_name || c.brand).slice(0, 100),
      google_product_category: cat?.google_category || '', product_type: cat?.name || 'Autres',
      inventory: Math.max(0, p.stock | 0), custom_label_0: p.category || 'autres', custom_label_1: (p.shop_name || c.brand).slice(0, 100),
      custom_label_2: promo ? 'promo' : 'prix normal',
    });
  }
  return { items, skipped };
}

// Flux CSV que le Gestionnaire de ventes Meta peut relire automatiquement (« flux de données programmé »)
function feedCsv() {
  const cols = ['id', 'title', 'description', 'availability', 'condition', 'price', 'sale_price', 'link', 'image_link', 'additional_image_link',
    'brand', 'google_product_category', 'product_type', 'inventory', 'custom_label_0', 'custom_label_1', 'custom_label_2'];
  const q = (v) => `"${String(Array.isArray(v) ? v.join(',') : v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...catalogItems().items.map(it => cols.map(k => q(it[k])).join(','))].join('\n');
}

async function graph(method, path, params = {}, token = cfg().token) {
  if (!token) throw new Error('Clé d\'accès Meta manquante (Marketing → Connexion Meta)');
  const body = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])), access_token: token });
  const url = method === 'GET' ? `${GRAPH}/${path}?${body}` : `${GRAPH}/${path}`;
  const r = await fetch(url, method === 'GET' ? {} : { method, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`Meta : ${j.error?.error_user_msg || j.error?.message || r.status}`);
  return j;
}

async function test() {
  const c = cfg(); if (!c.catalog) throw new Error('Identifiant du catalogue manquant');
  const cat = await graph('GET', c.catalog, { fields: 'name,product_count' });
  const px = c.pixel ? await graph('GET', c.pixel, { fields: 'name' }, c.capiToken).catch(e => ({ error: e.message })) : null;
  return { catalog: cat, pixel: px };
}

// Synchronisation directe : crée/met à jour les produits visibles, retire ceux masqués ou supprimés
async function sync() {
  const c = cfg(); if (!c.catalog) throw new Error('Identifiant du catalogue manquant');
  const { items, skipped } = catalogItems();
  const before = JSON.parse(getSetting('meta_synced_ids', '[]')), now = new Set(items.map(i => i.id));
  const requests = [...items.map(data => ({ method: 'UPDATE', data })), ...before.filter(id => !now.has(id)).map(id => ({ method: 'DELETE', data: { id } }))];
  const handles = [];
  try {
    for (let i = 0; i < requests.length; i += 1000) {
      const r = await graph('POST', `${c.catalog}/items_batch`, { item_type: 'PRODUCT_ITEM', requests: requests.slice(i, i + 1000) });
      handles.push(...(r.handles || []));
    }
    setSetting('meta_synced_ids', JSON.stringify([...now]));
    const res = { at: new Date().toISOString(), ok: true, sent: items.length, deleted: requests.length - items.length, skipped: skipped.length, handles };
    setSetting('meta_last_sync', JSON.stringify(res)); return { ...res, skippedList: skipped };
  } catch (e) {
    setSetting('meta_last_sync', JSON.stringify({ at: new Date().toISOString(), ok: false, error: e.message })); throw e;
  }
}

// Après chaque modification de produit : une synchronisation groupée quelques secondes plus tard
let timer = null;
function scheduleSync() {
  const c = cfg(); if (!c.autosync || !c.catalog || !c.token) return;
  clearTimeout(timer); timer = setTimeout(() => sync().catch(e => console.error('[meta]', e.message)), 15000);
}

// Ensembles de produits (un par catégorie + promotions) pour les campagnes catalogue Advantage+
async function createProductSets() {
  const c = cfg(); if (!c.catalog) throw new Error('Identifiant du catalogue manquant');
  const existing = new Set(((await graph('GET', `${c.catalog}/product_sets`, { fields: 'name', limit: '500' })).data || []).map(s => s.name));
  const used = new Set(catalogItems().items.map(i => i.custom_label_0));
  const wanted = categories().filter(x => used.has(x.slug)).map(x => ({ name: `${c.brand} — ${x.name}`, filter: { custom_label_0: { eq: x.slug } } }));
  wanted.push({ name: `${c.brand} — Promotions`, filter: { custom_label_2: { eq: 'promo' } } });
  const created = [];
  for (const s of wanted) if (!existing.has(s.name)) { await graph('POST', `${c.catalog}/product_sets`, s); created.push(s.name); }
  return { created, existing: wanted.length - created.length };
}

// API Conversions (serveur) : même event_id que le Pixel du navigateur → Meta déduplique
const sha = (v) => crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');
function capi(eventName, { eventId, url, ip, ua, fbp, fbc, phone, name, city, value, contentIds = [], numItems = 1 }) {
  const c = cfg(); if (!c.pixel || !c.capiToken) return;
  const digits = String(phone || '').replace(/\D/g, ''), first = String(name || '').trim().split(/\s+/)[0];
  const user_data = { client_ip_address: ip, client_user_agent: ua, ...(fbp ? { fbp } : {}), ...(fbc ? { fbc } : {}),
    ...(digits ? { ph: [sha(digits)] } : {}), ...(first ? { fn: [sha(first)] } : {}), ...(city ? { ct: [sha(String(city).replace(/\s+/g, ''))] } : {}) };
  graph('POST', `${c.pixel}/events`, { data: [{ event_name: eventName, event_time: Math.floor(Date.now() / 1000), event_id: eventId,
    action_source: 'website', event_source_url: url, user_data,
    custom_data: { currency: c.currency, value: +value || 0, content_ids: contentIds.map(String), content_type: 'product', num_items: numItems } }] }, c.capiToken)
    .catch(e => console.error('[meta capi]', e.message));
}

module.exports = { cfg, catalogItems, feedCsv, test, sync, scheduleSync, createProductSets, capi };
