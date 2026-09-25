const router = require('express').Router();
const crypto = require('crypto');
const { db, STATUSES, getSetting, setSetting } = require('../db');
const S = require('../services');
const conn = require('../connectors');

const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => res.status(400).json({ error: e.message }));
const pick = (o, keys) => keys.reduce((a, k) => (o[k] !== undefined && (a[k] = o[k]), a), {});

function crud(table, fields) {
  router.get(`/${table}`, (req, res) => res.json(db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all()));
  router.post(`/${table}`, wrap((req, res) => {
    const d = pick(req.body, fields); const k = Object.keys(d);
    const id = db.prepare(`INSERT INTO ${table}(${k}) VALUES(${k.map(() => '?')})`).run(...Object.values(d)).lastInsertRowid;
    res.json({ id });
  }));
  router.put(`/${table}/:id`, wrap((req, res) => {
    const d = pick(req.body, fields); const k = Object.keys(d);
    if (k.length) db.prepare(`UPDATE ${table} SET ${k.map(x => x + '=?')} WHERE id=?`).run(...Object.values(d), req.params.id);
    res.json({ ok: true });
  }));
  router.delete(`/${table}/:id`, (req, res) => { db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id); res.json({ ok: true }); });
}

// ---------- Tableau de bord + diagnostic ----------
router.get('/dashboard', (req, res) => {
  const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
  db.prepare('SELECT status, COUNT(*) n FROM orders GROUP BY status').all().forEach(r => counts[r.status] = r.n);
  const today = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) ca FROM orders WHERE date(created_at)=date('now')`).get();
  const lowStock = db.prepare('SELECT * FROM products WHERE stock<=5 ORDER BY stock').all();
  res.json({ counts, today, lowStock, connectors: conn.status(),
    unsynced: db.prepare('SELECT COUNT(*) n FROM orders WHERE synced=0').get().n });
});

// ---------- Commandes ----------
router.get('/orders', (req, res) => {
  const { status, q } = req.query; const w = []; const p = [];
  if (status) { w.push('o.status=?'); p.push(status); }
  if (q) { w.push('(o.name LIKE ? OR o.phone LIKE ? OR o.id=?)'); p.push(`%${q}%`, `%${q}%`, q); }
  res.json(db.prepare(`SELECT o.*, a.first_name||' '||COALESCE(a.last_name,'') agent, c.name courier, ch.name channel, cu.blacklisted
    FROM orders o LEFT JOIN agents a ON a.id=o.agent_id LEFT JOIN couriers c ON c.id=o.courier_id
    LEFT JOIN channels ch ON ch.id=o.channel_id LEFT JOIN customers cu ON cu.id=o.customer_id
    ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY o.id DESC LIMIT 500`).all(...p));
});
router.get('/orders/:id', (req, res) => res.json({ ...db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id),
  history: db.prepare('SELECT * FROM order_history WHERE order_id=? ORDER BY id').all(req.params.id) }));
router.post('/orders', wrap((req, res) => res.json({ id: S.createOrder(req.body) })));
router.put('/orders/:id/status', wrap((req, res) => {
  if (!STATUSES.includes(req.body.status)) throw new Error('Statut invalide');
  S.setStatus(+req.params.id, req.body.status, req.body.note || ''); res.json({ ok: true });
}));
router.put('/orders/:id/assign', wrap((req, res) => {
  const { agent_id, courier_id } = req.body;
  if (agent_id !== undefined) db.prepare('UPDATE orders SET agent_id=? WHERE id=?').run(agent_id || null, req.params.id);
  if (courier_id !== undefined) db.prepare('UPDATE orders SET courier_id=? WHERE id=?').run(courier_id || null, req.params.id);
  res.json({ ok: true });
}));
router.post('/orders/:id/note', wrap((req, res) => {
  const o = db.prepare('SELECT status FROM orders WHERE id=?').get(req.params.id);
  db.prepare('INSERT INTO order_history(order_id,status,note) VALUES(?,?,?)').run(req.params.id, o.status, req.body.note);
  res.json({ ok: true });
}));

// ---------- CRM ----------
router.get('/customers', (req, res) => res.json(db.prepare('SELECT * FROM customers ORDER BY id DESC').all()
  .map(c => ({ ...c, ...S.customerStats(c.id) }))));
router.get('/customers/:id', (req, res) => res.json({ ...db.prepare('SELECT * FROM customers WHERE id=?').get(req.params.id),
  ...S.customerStats(req.params.id), orders: db.prepare('SELECT * FROM orders WHERE customer_id=? ORDER BY id DESC').all(req.params.id) }));
router.put('/customers/:id', wrap((req, res) => {
  const d = pick(req.body, ['name', 'address', 'city', 'tags', 'notes', 'blacklisted']); const k = Object.keys(d);
  db.prepare(`UPDATE customers SET ${k.map(x => x + '=?')} WHERE id=?`).run(...Object.values(d), req.params.id); res.json({ ok: true });
}));

// ---------- Agents + commissions ----------
crud('agents', ['first_name', 'last_name', 'phone', 'email', 'commission_rate', 'active']);
router.get('/agents-full', (req, res) => res.json(db.prepare('SELECT * FROM agents ORDER BY id DESC').all().map(a => ({ ...a,
  due: S.agentDue(a.id), orders: db.prepare('SELECT COUNT(*) n FROM orders WHERE agent_id=?').get(a.id).n,
  delivered: db.prepare(`SELECT COUNT(*) n FROM orders WHERE agent_id=? AND status IN ('livre','paye')`).get(a.id).n }))));
router.get('/agents/:id/commissions', (req, res) => res.json(db.prepare(`SELECT c.*, o.amount order_amount, o.name FROM commissions c
  JOIN orders o ON o.id=c.order_id WHERE c.agent_id=? AND c.paid=0`).all(req.params.id)));
router.post('/agents/:id/pay', wrap((req, res) => {
  const ids = (req.body.ids || []).map(Number);
  const st = db.prepare(`UPDATE commissions SET paid=1, paid_at=CURRENT_TIMESTAMP WHERE id=? AND agent_id=?`);
  db.transaction(() => ids.forEach(i => st.run(i, req.params.id)))();
  res.json({ ok: true, due: S.agentDue(req.params.id) });
}));

// ---------- Livreurs ----------
crud('couriers', ['name', 'company', 'phone', 'fee_per_parcel', 'zones', 'auto_assign']);
router.get('/couriers-full', (req, res) => res.json(db.prepare('SELECT * FROM couriers ORDER BY id DESC').all().map(c => ({ ...c,
  balance: S.courierBalance(c.id), active: db.prepare(`SELECT COUNT(*) n FROM orders WHERE courier_id=? AND status IN
  ('confirme','en_preparation','expedie','en_livraison')`).get(c.id).n,
  online: c.last_seen && (Date.now() - new Date(c.last_seen + 'Z')) < 5 * 60e3 }))));
router.post('/couriers/:id/payment', wrap((req, res) => {
  db.prepare('INSERT INTO courier_payments(courier_id,amount) VALUES(?,?)').run(req.params.id, +req.body.amount);
  res.json({ balance: S.courierBalance(req.params.id) });
}));
router.post('/couriers/:id/token', (req, res) => {
  const t = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE couriers SET app_token=? WHERE id=?').run(t, req.params.id);
  res.json({ link: `${process.env.BASE_URL || ''}/livreur/?t=${t}` });
});

// ---------- Stock, produits, canaux ----------
crud('products', ['name', 'price', 'stock', 'wc_id']);
crud('channels', ['name']);
router.get('/stock-moves', (req, res) => res.json(db.prepare(`SELECT m.*, p.name FROM stock_moves m LEFT JOIN products p ON p.id=m.product_id
  ORDER BY m.id DESC LIMIT 200`).all()));
router.post('/stock-moves', wrap((req, res) => {
  const q = Math.abs(+req.body.qty) * (req.body.type === 'sortie' ? -1 : 1);
  S.moveStock(+req.body.product_id, q, req.body.type, req.body.note || ''); res.json({ ok: true });
}));

// ---------- Automatisations ----------
crud('automations', ['name', 'trigger', 'channel', 'target', 'template', 'delay_hours', 'active']);
router.get('/automation-log', (req, res) => res.json(db.prepare(`SELECT l.*, a.name FROM automation_log l LEFT JOIN automations a
  ON a.id=l.automation_id ORDER BY l.id DESC LIMIT 100`).all()));

// ---------- Statistiques ----------
router.get('/stats', (req, res) => {
  const days = +req.query.days || 30; const since = `-${days} days`;
  const q = (sql) => db.prepare(sql).all(since);
  res.json({
    daily: q(`SELECT date(created_at) d, COUNT(*) n, COALESCE(SUM(CASE WHEN status IN ('livre','paye') THEN amount END),0) ca
      FROM orders WHERE created_at>=datetime('now',?) GROUP BY d ORDER BY d`),
    totals: db.prepare(`SELECT COUNT(*) n, SUM(status IN ('livre','paye')) livre, SUM(status IN ('annule','retourne')) echec,
      SUM(status NOT IN ('nouveau','en_confirmation','annule')) confirme,
      COALESCE(SUM(CASE WHEN status IN ('livre','paye') THEN amount END),0) ca FROM orders WHERE created_at>=datetime('now',?)`).get(since),
    byChannel: q(`SELECT COALESCE(c.name,'Direct') name, COUNT(*) n, SUM(o.status IN ('livre','paye')) livre FROM orders o
      LEFT JOIN channels c ON c.id=o.channel_id WHERE o.created_at>=datetime('now',?) GROUP BY o.channel_id`),
    byAgent: q(`SELECT a.first_name||' '||COALESCE(a.last_name,'') name, COUNT(*) n, SUM(o.status IN ('livre','paye')) livre FROM orders o
      JOIN agents a ON a.id=o.agent_id WHERE o.created_at>=datetime('now',?) GROUP BY o.agent_id`),
  });
});
router.get('/export.csv', (req, res) => {
  const rows = db.prepare('SELECT id,created_at,name,phone,city,product_name,qty,amount,status FROM orders ORDER BY id DESC').all();
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=commandes-mireb.csv');
  res.send('﻿' + [Object.keys(rows[0] || { id: 0 }).join(';'), ...rows.map(r => Object.values(r).map(esc).join(';'))].join('\n'));
});

// ---------- Synchronisation WooCommerce ----------
router.post('/sync/products', wrap(async (req, res) => res.json({ imported: await S.importProducts() })));
router.post('/sync/pull', wrap(async (req, res) => res.json({ imported: await S.pullOrders() })));
router.post('/sync/push', wrap(async (req, res) => res.json(await S.pushUnsynced())));

// ---------- Paramètres ----------
const SETTINGS = ['form_color', 'form_button', 'form_subtitle', 'form_badge', 'form_guarantee', 'shop_name'];
router.get('/settings', (req, res) => res.json(Object.fromEntries(SETTINGS.map(k => [k, getSetting(k)]))));
router.put('/settings', (req, res) => { SETTINGS.forEach(k => req.body[k] !== undefined && setSetting(k, req.body[k])); res.json({ ok: true }); });
router.get('/meta', (req, res) => res.json({ statuses: STATUSES, currency: process.env.CURRENCY || '$', connectors: conn.status() }));

module.exports = router;
