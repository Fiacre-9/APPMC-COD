const router = require('express').Router();
const crypto = require('crypto');
const { db, getSetting } = require('../db');
const S = require('../services');

// Formulaire COD public (landing page, widget, page produit)
router.post('/lead', (req, res) => {
  const { name, phone, address, city, product_id, qty, canal } = req.body;
  if (!name || !phone || !address) return res.status(400).json({ error: 'Nom, téléphone et adresse sont obligatoires' });
  if (!/^[+\d][\d\s-]{7,}$/.test(phone)) return res.status(400).json({ error: 'Téléphone invalide' });
  const id = S.createOrder({ name, phone, address, city, product_id, qty, channel_id: canal || null });
  res.json({ ok: true, id, message: 'Merci ! Un conseiller vous appelle très vite pour confirmer.' });
});

router.get('/form-config', (req, res) => res.json({ color: getSetting('form_color', '#e8342a'),
  button: getSetting('form_button', 'Commander — Paiement à la livraison'), subtitle: getSetting('form_subtitle', 'Remplissez le formulaire, vous payez à la réception'),
  badge: getSetting('form_badge', ''), guarantee: getSetting('form_guarantee', '✅ Paiement à la livraison · Livraison rapide'),
  product: req.query.product_id ? db.prepare('SELECT id,name,price FROM products WHERE id=? OR wc_id=?').get(req.query.product_id, req.query.product_id) : null }));

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

module.exports = router;
