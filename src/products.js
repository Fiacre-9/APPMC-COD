// Enregistrement d'un produit (espace vendeur et admin) : champs, photos, variantes, catégorie
const { db, categories } = require('./db');
const S = require('./services');
const { saveImage } = require('./uploads');

const FIELDS = ['name', 'price', 'compare_price', 'stock', 'short_description', 'description', 'active', 'category', 'options'];
const MAX_PHOTOS = 6;
const pick = (o, keys) => keys.reduce((a, k) => (o[k] !== undefined && (a[k] = o[k]), a), {});
const photosOf = (p) => { try { const g = JSON.parse(p.gallery || '[]'); return g.length ? g : (p.image ? [p.image] : []); } catch { return p.image ? [p.image] : []; } };

// Données prêtes pour la base à partir du formulaire ; `current` = produit existant (modification)
function productInput(body, current = null) {
  if (!current && !String(body.name || '').trim()) throw new Error('Nom du produit obligatoire');
  const d = pick(body, FIELDS);
  if (d.name !== undefined) d.name = String(d.name).trim().slice(0, 200);
  if (d.price !== undefined) d.price = Math.max(0, +d.price || 0);
  if (d.compare_price !== undefined) d.compare_price = d.compare_price === '' || d.compare_price == null ? null : Math.max(0, +d.compare_price || 0);
  if (d.stock !== undefined) d.stock = Math.max(0, Math.floor(+d.stock || 0));
  if (d.active !== undefined) d.active = d.active && d.active !== '0' ? 1 : 0;
  if (d.options !== undefined) d.options = JSON.stringify(S.normalizeOptions(d.options));
  if (d.category && !categories().some(c => c.slug === d.category)) throw new Error('Catégorie inconnue');
  // Photos : on garde celles déjà enregistrées pour ce produit (gallery_keep) + les nouvelles (gallery_new, data URL)
  if (body.gallery_keep !== undefined || body.gallery_new !== undefined || body.image_data) {
    const existing = current ? photosOf(current) : [];
    const keep = (Array.isArray(body.gallery_keep) ? body.gallery_keep : existing).filter(u => existing.includes(u));
    const fresh = [...(Array.isArray(body.gallery_new) ? body.gallery_new : []), ...(body.image_data ? [body.image_data] : [])];
    if (keep.length + fresh.length > MAX_PHOTOS) throw new Error(`${MAX_PHOTOS} photos maximum`);
    const all = [...keep, ...fresh.map(saveImage)];
    d.gallery = JSON.stringify(all); d.image = all[0] || '';
  }
  return d;
}

function createProduct(body, extra = {}) {
  const d = { ...productInput(body), ...extra }, k = Object.keys(d);
  const id = db.prepare(`INSERT INTO products(${k}) VALUES(${k.map(() => '?')})`).run(...Object.values(d)).lastInsertRowid;
  S.productSlug(id); return id;
}
function updateProduct(p, body, extra = {}) {
  const d = { ...productInput(body, p), ...extra }, k = Object.keys(d);
  if (k.length) db.prepare(`UPDATE products SET ${k.map(x => x + '=?')} WHERE id=?`).run(...Object.values(d), p.id);
  if (d.name && d.name !== p.name) S.productSlug(p.id);
}
// Un produit déjà commandé est masqué plutôt que supprimé, pour garder l'historique
function removeProduct(p) {
  if (db.prepare('SELECT 1 FROM orders WHERE product_id=?').get(p.id)) db.prepare('UPDATE products SET active=0 WHERE id=?').run(p.id);
  else db.prepare('DELETE FROM products WHERE id=?').run(p.id);
}

module.exports = { productInput, createProduct, updateProduct, removeProduct, photosOf };
