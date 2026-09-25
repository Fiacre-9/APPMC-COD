// Pages publiques : page produit avec formulaire COD, boutique d'un vendeur, marketplace
const router = require('express').Router();
const { db, getSetting } = require('../db');

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = n => `${(+n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${process.env.CURRENCY || '$'}`;
const color = () => getSetting('form_color', '#e8342a');
const VISIBLE = `p.active=1 AND (p.vendor_id IS NULL OR v.active=1)`;

function layout({ title, desc = '', image = '', body }) {
  const c = esc(color());
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="icon" href="/icon.svg">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
${image ? `<meta property="og:image" content="${esc((process.env.BASE_URL || '') + image)}">` : ''}
<style>
:root{--c:${c};--ink:#1d2330;--mut:#6b7280;--line:#e5e7eb;--bg:#f5f6f8}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
a{color:inherit}.top{background:#fff;border-bottom:1px solid var(--line);padding:12px 16px}.top a{text-decoration:none;font-weight:700;color:var(--c)}
.wrap{max-width:1040px;margin:0 auto;padding:16px}
.pp{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start}
.img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px;background:#fff;border:1px solid var(--line)}
.noimg{display:flex;align-items:center;justify-content:center;font-size:64px;color:#cbd5e1}
h1{margin:0 0 8px;font-size:26px}.price{font-size:28px;font-weight:800;color:var(--c)}.old{color:var(--mut);text-decoration:line-through;margin-left:8px;font-size:18px}
.off{background:var(--c);color:#fff;border-radius:99px;padding:2px 10px;font-size:13px;margin-left:8px;vertical-align:middle}
.desc{line-height:1.6;color:#374151;margin:14px 0}.by{color:var(--mut);font-size:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden;text-decoration:none;display:flex;flex-direction:column}
.card img,.card .noimg{width:100%;aspect-ratio:1;object-fit:cover;border-bottom:1px solid var(--line)}.card div{padding:10px}
.card b{display:block;margin-bottom:4px}.card .price{font-size:18px}
.shop{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px}.shop h1{font-size:22px}
.empty{color:var(--mut);text-align:center;padding:40px}
.foot{text-align:center;color:var(--mut);font-size:13px;padding:24px}
@media(max-width:760px){.pp{grid-template-columns:1fr}h1{font-size:22px}}
</style></head><body><div class="top"><a href="/boutique">${esc(getSetting('shop_name', 'Mireb') || 'Mireb')}</a></div>
<div class="wrap">${body}</div><div class="foot">✅ Paiement à la livraison</div></body></html>`;
}

const pic = (p) => p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">` : '<div class="noimg">📦</div>';
const cards = (list) => list.length ? `<div class="grid">${list.map(p => `<a class="card" href="/p/${esc(p.slug)}">${pic(p)}
  <div><b>${esc(p.name)}</b><span class="price">${money(p.price)}</span>${p.compare_price > p.price ? `<span class="old">${money(p.compare_price)}</span>` : ''}</div></a>`).join('')}</div>`
  : '<p class="empty">Aucun produit pour le moment.</p>';

// Page produit : fiche + formulaire de commande lié au produit
router.get('/p/:slug', (req, res) => {
  const p = db.prepare(`SELECT p.*, v.shop_name, v.slug vslug FROM products p LEFT JOIN vendors v ON v.id=p.vendor_id
    WHERE p.slug=? AND ${VISIBLE}`).get(req.params.slug);
  if (!p) return res.status(404).send(layout({ title: 'Produit introuvable', body: '<p class="empty">Ce produit n\'est plus disponible.</p>' }));
  const off = p.compare_price > p.price ? Math.round((1 - p.price / p.compare_price) * 100) : 0;
  const canal = /^\d+$/.test(req.query.canal || '') ? req.query.canal : '';
  res.send(layout({ title: p.name, desc: String(p.description || '').slice(0, 160), image: p.image, body: `<div class="pp">
    <div>${p.image ? `<img class="img" src="${esc(p.image)}" alt="${esc(p.name)}">` : '<div class="img noimg">📦</div>'}</div>
    <div><h1>${esc(p.name)}</h1>
      <div><span class="price">${money(p.price)}</span>${off ? `<span class="old">${money(p.compare_price)}</span><span class="off">-${off}%</span>` : ''}</div>
      ${p.vslug ? `<div class="by">Vendu par <a href="/boutique/${esc(p.vslug)}">${esc(p.shop_name)}</a></div>` : ''}
      ${p.description ? `<div class="desc">${esc(p.description).replace(/\n/g, '<br>')}</div>` : ''}
      <div data-mireb-form data-compact data-product="${p.id}" data-canal="${canal}"></div>
    </div></div><script src="/widget.js"></script>` }));
});

// Boutique d'un vendeur
router.get('/boutique/:slug', (req, res) => {
  const v = db.prepare('SELECT * FROM vendors WHERE slug=? AND active=1').get(req.params.slug);
  if (!v) return res.status(404).send(layout({ title: 'Boutique introuvable', body: '<p class="empty">Cette boutique n\'existe pas.</p>' }));
  const list = db.prepare(`SELECT p.* FROM products p JOIN vendors v ON v.id=p.vendor_id WHERE p.vendor_id=? AND ${VISIBLE} ORDER BY p.id DESC`).all(v.id);
  res.send(layout({ title: v.shop_name, desc: v.description, body: `<div class="shop"><h1>${esc(v.shop_name)}</h1>
    ${v.description ? `<div class="desc">${esc(v.description).replace(/\n/g, '<br>')}</div>` : ''}</div>${cards(list)}` }));
});

// Marketplace : tous les produits de tous les vendeurs
router.get('/boutique', (req, res) => {
  const list = db.prepare(`SELECT p.* FROM products p LEFT JOIN vendors v ON v.id=p.vendor_id WHERE ${VISIBLE} ORDER BY p.id DESC LIMIT 200`).all();
  res.send(layout({ title: getSetting('shop_name', 'Mireb') || 'Boutique', body: cards(list) }));
});

module.exports = router;
