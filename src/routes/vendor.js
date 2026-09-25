// Espace vendeur : inscription, connexion, produits et commandes du vendeur uniquement
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { db, STATUSES } = require('../db');
const S = require('../services');
const { saveImage } = require('../uploads');

const wrap = fn => (req, res) => Promise.resolve().then(() => fn(req, res)).catch(e => res.status(400).json({ error: e.message }));
const pick = (o, keys) => keys.reduce((a, k) => (o[k] !== undefined && (a[k] = o[k]), a), {});
const PUBLIC = 'id, shop_name, slug, email, phone, whatsapp, description, active, created_at';

module.exports = (SECRET) => {
  const setCookie = (res, v) => res.cookie('vtoken', jwt.sign({ vid: v.id }, SECRET, { expiresIn: '30d' }), { httpOnly: true, sameSite: 'lax' });

  router.post('/auth/register', wrap((req, res) => {
    const { shop_name, email, password, phone } = req.body;
    if (!shop_name || !email || !phone) throw new Error('Nom de boutique, email et téléphone sont obligatoires');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Email invalide');
    if ((password || '').length < 8) throw new Error('Mot de passe : 8 caractères minimum');
    if (db.prepare('SELECT 1 FROM vendors WHERE email=?').get(email.toLowerCase())) throw new Error('Un compte existe déjà avec cet email');
    const id = db.prepare('INSERT INTO vendors(shop_name,slug,email,password,phone,whatsapp) VALUES(?,?,?,?,?,?)')
      .run(shop_name, S.vendorSlug(shop_name), email.toLowerCase(), bcrypt.hashSync(password, 10), phone, phone).lastInsertRowid;
    setCookie(res, { id }); res.json({ ok: true });
  }));
  router.post('/auth/login', (req, res) => {
    const v = db.prepare('SELECT * FROM vendors WHERE email=?').get(String(req.body.email || '').toLowerCase());
    if (!v || !bcrypt.compareSync(req.body.password || '', v.password)) return res.status(401).json({ error: 'Identifiants incorrects' });
    if (!v.active) return res.status(403).json({ error: 'Compte suspendu — contactez l\'administrateur' });
    setCookie(res, v); res.json({ ok: true });
  });
  router.post('/auth/logout', (req, res) => { res.clearCookie('vtoken'); res.json({ ok: true }); });

  // Toutes les routes suivantes : vendeur connecté et actif
  router.use('/api', (req, res, next) => {
    try {
      const { vid } = jwt.verify(req.cookies.vtoken || '', SECRET);
      req.vendor = db.prepare(`SELECT ${PUBLIC} FROM vendors WHERE id=? AND active=1`).get(vid);
      if (!req.vendor) throw new Error();
      next();
    } catch { res.status(401).json({ error: 'Non connecté' }); }
  });
  const own = (req) => {
    const p = db.prepare('SELECT * FROM products WHERE id=? AND vendor_id=?').get(req.params.id, req.vendor.id);
    if (!p) throw new Error('Produit introuvable'); return p;
  };

  router.get('/api/me', (req, res) => res.json({ ...req.vendor, statuses: STATUSES, currency: process.env.CURRENCY || '$' }));
  router.put('/api/me', wrap((req, res) => {
    const d = pick(req.body, ['shop_name', 'phone', 'whatsapp', 'description']); const k = Object.keys(d);
    if (k.length) db.prepare(`UPDATE vendors SET ${k.map(x => x + '=?')} WHERE id=?`).run(...Object.values(d), req.vendor.id);
    if ((req.body.password || '').length) {
      if (req.body.password.length < 8) throw new Error('Mot de passe : 8 caractères minimum');
      db.prepare('UPDATE vendors SET password=? WHERE id=?').run(bcrypt.hashSync(req.body.password, 10), req.vendor.id);
    }
    res.json({ ok: true });
  }));

  router.get('/api/dashboard', (req, res) => {
    const id = req.vendor.id;
    res.json({
      totals: db.prepare(`SELECT COUNT(*) n, SUM(status='nouveau') nouveau, SUM(status IN ('livre','paye')) livre,
        COALESCE(SUM(CASE WHEN status IN ('livre','paye') THEN amount END),0) ca FROM orders WHERE vendor_id=?`).get(id),
      products: db.prepare('SELECT COUNT(*) n FROM products WHERE vendor_id=?').get(id).n,
    });
  });

  // ---------- Produits ----------
  const FIELDS = ['name', 'price', 'compare_price', 'stock', 'description', 'active'];
  router.get('/api/products', (req, res) => res.json(db.prepare('SELECT * FROM products WHERE vendor_id=? ORDER BY id DESC').all(req.vendor.id)));
  router.post('/api/products', wrap((req, res) => {
    if (!req.body.name) throw new Error('Nom du produit obligatoire');
    const d = pick(req.body, FIELDS);
    if (req.body.image_data) d.image = saveImage(req.body.image_data);
    d.vendor_id = req.vendor.id; const k = Object.keys(d);
    const id = db.prepare(`INSERT INTO products(${k}) VALUES(${k.map(() => '?')})`).run(...Object.values(d)).lastInsertRowid;
    S.productSlug(id); res.json({ id });
  }));
  router.put('/api/products/:id', wrap((req, res) => {
    const p = own(req); const d = pick(req.body, FIELDS);
    if (req.body.image_data) d.image = saveImage(req.body.image_data);
    const k = Object.keys(d);
    if (k.length) db.prepare(`UPDATE products SET ${k.map(x => x + '=?')} WHERE id=?`).run(...Object.values(d), p.id);
    if (d.name && d.name !== p.name) S.productSlug(p.id);
    res.json({ ok: true });
  }));
  router.delete('/api/products/:id', wrap((req, res) => {
    const p = own(req);
    // Un produit déjà commandé est masqué plutôt que supprimé, pour garder l'historique
    if (db.prepare('SELECT 1 FROM orders WHERE product_id=?').get(p.id)) db.prepare('UPDATE products SET active=0 WHERE id=?').run(p.id);
    else db.prepare('DELETE FROM products WHERE id=?').run(p.id);
    res.json({ ok: true });
  }));

  // ---------- Commandes ----------
  router.get('/api/orders', (req, res) => {
    const { status } = req.query;
    res.json(db.prepare(`SELECT id,created_at,name,phone,address,city,product_name,qty,amount,status FROM orders
      WHERE vendor_id=? ${status ? 'AND status=?' : ''} ORDER BY id DESC LIMIT 500`).all(req.vendor.id, ...(status ? [status] : [])));
  });
  router.put('/api/orders/:id/status', wrap((req, res) => {
    if (!STATUSES.includes(req.body.status)) throw new Error('Statut invalide');
    if (!db.prepare('SELECT 1 FROM orders WHERE id=? AND vendor_id=?').get(req.params.id, req.vendor.id)) throw new Error('Commande introuvable');
    S.setStatus(+req.params.id, req.body.status, `Par vendeur ${req.vendor.shop_name}`); res.json({ ok: true });
  }));

  return router;
};
