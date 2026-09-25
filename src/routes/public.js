const router = require('express').Router();
const crypto = require('crypto');
const { db, getSetting } = require('../db');
const S = require('../services');
const push = require('../push');
const meta = require('../meta');

// Formulaire COD public (landing page, widget, page produit)
router.post('/lead', (req, res) => {
  const { name, phone, address, city, product_id, qty, canal, options } = req.body;
  if (!name || !phone || !address) return res.status(400).json({ error: 'Nom, téléphone et adresse sont obligatoires' });
  if (!/^[+\d][\d\s-]{7,}$/.test(phone)) return res.status(400).json({ error: 'Téléphone invalide' });
  // Produit masqué par son vendeur ou vendeur suspendu : plus de commande possible
  if (product_id && db.prepare(`SELECT 1 FROM products p LEFT JOIN vendors v ON v.id=p.vendor_id
    WHERE (p.id=? OR p.wc_id=?) AND (p.active=0 OR v.active=0)`).get(product_id, product_id))
    return res.status(400).json({ error: 'Ce produit n\'est plus disponible' });
  let id;
  try { id = S.createOrder({ name, phone, address, city, product_id, qty: Math.min(99, +qty || 1), options, strictOptions: true, channel_id: canal || null }); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  const o = db.prepare('SELECT amount, qty, product_id FROM orders WHERE id=?').get(id), c = meta.cfg();
  meta.capi('Purchase', { eventId: `order-${id}`, url: req.get('referer') || '', ip: (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim(),
    ua: req.get('user-agent'), fbp: req.cookies?._fbp, fbc: req.cookies?._fbc, phone, name, city, value: o.amount,
    contentIds: o.product_id ? [o.product_id] : [], numItems: o.qty });
  res.json({ ok: true, id, track: push.orderToken(id), value: o.amount, currency: c.currency, content_id: o.product_id ? String(o.product_id) : null,
    message: 'Merci ! Un conseiller vous appelle très vite pour confirmer.' });
});

router.get('/form-config', (req, res) => res.json({ color: getSetting('form_color', '#e8342a'),
  button: getSetting('form_button', 'Commander — Paiement à la livraison'), subtitle: getSetting('form_subtitle', 'Remplissez le formulaire, vous payez à la réception'),
  badge: getSetting('form_badge', ''), guarantee: getSetting('form_guarantee', '✅ Paiement à la livraison · Livraison rapide'),
  currency: process.env.CURRENCY || '$', product: (() => {
    const p = req.query.product_id ? db.prepare('SELECT id,name,price,compare_price,options FROM products WHERE id=? OR wc_id=?').get(req.query.product_id, req.query.product_id) : null;
    return p ? { id: p.id, name: p.name, price: p.price, compare_price: p.compare_price, options: S.productOptions(p) } : null;
  })() }));

// ---------- Notifications push ----------
router.get('/push/key', (req, res) => res.json({ key: push.publicKey }));
// Client : suivi d'une commande (jeton reçu après la commande ou sur la page de suivi)
router.post('/push/subscribe', (req, res) => {
  const { subscription, order_id, token } = req.body;
  if (!push.checkOrderToken(+order_id, token)) return res.status(403).json({ error: 'Lien de suivi invalide' });
  try { push.subscribe(subscription, 'customer', +order_id); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/push/unsubscribe', (req, res) => { push.unsubscribe(req.body.endpoint); res.json({ ok: true }); });

// Webhook WooCommerce (order.created) — Réglages > Avancé > Webhooks
router.post('/webhooks/woocommerce', (req, res) => {
  const secret = process.env.WC_WEBHOOK_SECRET;
  if (secret) {
    const sig = crypto.createHmac('sha256', secret).update(req.rawBody || '').digest('base64');
    if (sig !== req.get('x-wc-webhook-signature')) return res.status(401).end();
  }
  if (req.body?.id && req.body?.billing) S.importWcOrder(req.body);
  res.json({ ok: true });
});

// ---------- API app livreur (auth par jeton) ----------
const courierAuth = (req, res, next) => {
  const c = db.prepare('SELECT * FROM couriers WHERE app_token=?').get(req.get('x-token') || req.query.t || '');
  if (!c) return res.status(401).json({ error: 'Lien invalide' });
  req.courier = c; next();
};
router.get('/courier/me', courierAuth, (req, res) => res.json({ name: req.courier.name,
  orders: db.prepare(`SELECT id,name,phone,address,city,product_name,qty,amount,status FROM orders WHERE courier_id=?
    AND status IN ('confirme','en_preparation','expedie','en_livraison') ORDER BY id`).all(req.courier.id) }));
router.post('/courier/position', courierAuth, (req, res) => {
  db.prepare('UPDATE couriers SET last_lat=?, last_lng=?, last_seen=CURRENT_TIMESTAMP WHERE id=?').run(+req.body.lat, +req.body.lng, req.courier.id);
  res.json({ ok: true });
});
router.post('/courier/orders/:id/:action', courierAuth, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=? AND courier_id=?').get(req.params.id, req.courier.id);
  if (!o) return res.status(404).json({ error: 'Commande introuvable' });
  const map = { livre: 'livre', en_route: 'en_livraison', retour: 'retourne' };
  if (!map[req.params.action]) return res.status(400).json({ error: 'Action invalide' });
  S.setStatus(o.id, map[req.params.action], `Par livreur ${req.courier.name}`);
  res.json({ ok: true });
});

router.post('/courier/push/subscribe', courierAuth, (req, res) => {
  try { push.subscribe(req.body.subscription, 'courier', req.courier.id); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
