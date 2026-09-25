const { db } = require('./db');
const conn = require('./connectors');
const push = require('./push');
const cur = () => process.env.CURRENCY || '$';
const fmt = (n) => `${(+n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${cur()}`;

// Messages envoyés au client (notification push) selon le statut de sa commande
const CUSTOMER_PUSH = {
  confirme: (o) => ['✅ Commande confirmée', `Votre commande n°${o.id} (${o.product_name}) est confirmée. À payer à la livraison : ${fmt(o.amount)}.`],
  expedie: (o) => ['📦 Commande expédiée', `Votre commande n°${o.id} est en route vers votre ville.`],
  en_livraison: (o) => ['🚚 Votre colis arrive !', `Le livreur est en route avec votre commande n°${o.id}. Préparez ${fmt(o.amount)}.`],
  livre: (o) => ['🎉 Commande livrée', `Merci pour votre confiance ! Commande n°${o.id} livrée.`],
  annule: (o) => ['Commande annulée', `Votre commande n°${o.id} a été annulée. Contactez-nous en cas de question.`],
};
function notifyCourier(courierId, o) {
  push.notify('courier', courierId, { title: '📦 Nouvelle livraison', body: `Commande n°${o.id} — ${o.name}, ${o.city || o.address} · ${fmt(o.amount)}`,
    url: '/livreur/', tag: `livraison-${o.id}` });
}

// ---------- CRM ----------
function upsertCustomer({ name, phone, address, city }) {
  const p = String(phone || '').trim();
  const ex = db.prepare('SELECT * FROM customers WHERE phone=?').get(p);
  if (ex) {
    db.prepare('UPDATE customers SET name=COALESCE(?,name), address=COALESCE(?,address), city=COALESCE(?,city) WHERE id=?')
      .run(name || null, address || null, city || null, ex.id);
    return ex.id;
  }
  return db.prepare('INSERT INTO customers(name,phone,address,city) VALUES(?,?,?,?)').run(name, p, address, city).lastInsertRowid;
}

function customerStats(id) {
  const s = db.prepare(`SELECT COUNT(*) n, SUM(status IN ('livre','paye')) ok, SUM(status IN ('annule','retourne')) ko,
    COALESCE(SUM(CASE WHEN status IN ('livre','paye') THEN amount END),0) spent FROM orders WHERE customer_id=?`).get(id);
  const done = (s.ok || 0) + (s.ko || 0);
  const score = done ? Math.round(((s.ok || 0) / done) * 5 * 10) / 10 : null;
  let segment = 'nouveau';
  if (s.ko >= 2 && s.ko > s.ok) segment = 'risque';
  else if (s.ok >= 10 || s.spent >= 1000) segment = 'vip';
  else if (s.ok >= 4) segment = 'fidele';
  else if (s.ok >= 1) segment = 'actif';
  return { orders: s.n, delivered: s.ok || 0, failed: s.ko || 0, spent: s.spent, score, segment };
}

// ---------- Boutique : slugs ----------
const slugify = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'produit';
function productSlug(id) {
  const p = db.prepare('SELECT id, name FROM products WHERE id=?').get(id);
  if (p) db.prepare('UPDATE products SET slug=? WHERE id=?').run(`${slugify(p.name)}-${p.id}`, p.id);
}
function vendorSlug(name) {
  const base = slugify(name); let s = base, i = 1;
  while (db.prepare('SELECT 1 FROM vendors WHERE slug=?').get(s)) s = `${base}-${++i}`;
  return s;
}
// Produits existants sans page : on leur attribue une adresse
db.prepare('SELECT id FROM products WHERE slug IS NULL').all().forEach(p => productSlug(p.id));

// ---------- Variantes (taille, couleur…) ----------
// Nettoie ce qu'envoie un vendeur : 5 groupes max, 30 valeurs max, supplément de prix ≥ 0
function normalizeOptions(raw) {
  let list = raw; if (typeof raw === 'string') { try { list = JSON.parse(raw || '[]'); } catch { throw new Error('Variantes invalides'); } }
  if (!Array.isArray(list)) throw new Error('Variantes invalides');
  return list.slice(0, 5).map(g => ({ name: String(g?.name || '').trim().slice(0, 40),
    values: (Array.isArray(g?.values) ? g.values : []).slice(0, 30).map(v => ({ label: String(v?.label ?? v ?? '').trim().slice(0, 40),
      extra: Math.max(0, Math.round((+v?.extra || 0) * 100) / 100),
      // stock par valeur : null = non suivi (illimité), sinon nombre ≥ 0
      stock: v?.stock === '' || v?.stock == null || isNaN(+v.stock) ? null : Math.max(0, Math.floor(+v.stock)) }))
      .filter(v => v.label) })).filter(g => g.name && g.values.length);
}
const productOptions = (p) => { try { return normalizeOptions(p?.options || '[]'); } catch { return []; } };
// Prix unitaire + libellé de la variante choisie ; `strict` = le client doit choisir une valeur par groupe, en stock
function pricing(product, chosen = {}, strict = false, qty = 1) {
  let unit = +product.price || 0; const parts = [], picks = [];
  for (const g of productOptions(product)) {
    const label = chosen?.[g.name], v = g.values.find(x => x.label === label);
    if (!v) { if (strict) throw new Error(`Choisissez : ${g.name}`); continue; }
    if (strict && v.stock != null && v.stock < qty)
      throw new Error(v.stock ? `Plus que ${v.stock} en stock pour ${g.name} : ${v.label}` : `${g.name} : ${v.label} est épuisé`);
    unit += v.extra; parts.push(`${g.name} : ${v.label}`); picks.push({ g: g.name, v: v.label });
  }
  return { unit: Math.round(unit * 100) / 100, variant: parts.join(' · '), picks };
}
// Stock des valeurs de variantes suivies : −qty à la commande, +qty si annulée / retournée
function moveVariantStock(productId, picks, delta) {
  const p = db.prepare('SELECT options FROM products WHERE id=?').get(productId); if (!p || !picks?.length) return;
  const opts = productOptions(p); let changed = false;
  for (const { g, v } of picks) {
    const val = opts.find(x => x.name === g)?.values.find(x => x.label === v);
    if (val && val.stock != null) { val.stock = Math.max(0, val.stock + delta); changed = true; }
  }
  if (changed) db.prepare('UPDATE products SET options=? WHERE id=?').run(JSON.stringify(opts), productId);
}

// ---------- Commandes ----------
function createOrder(d) {
  const product = d.product_id ? db.prepare('SELECT * FROM products WHERE id=? OR wc_id=?').get(d.product_id, d.product_id) : null;
  const qty = Math.min(999, Math.max(1, Math.floor(+d.qty) || 1));
  // Le montant est toujours recalculé ici (prix + suppléments des variantes) : jamais celui envoyé par le navigateur
  const price = product ? pricing(product, d.options, d.strictOptions, qty) : { unit: 0, variant: '', picks: [] };
  const customer_id = upsertCustomer(d);
  const amount = d.amount != null ? +d.amount : Math.round(price.unit * qty * 100) / 100;
  const pname = (product?.name || d.product_name || '') + (price.variant ? ` (${price.variant})` : '');
  const id = db.prepare(`INSERT INTO orders(wc_id,customer_id,product_id,product_name,qty,amount,name,phone,address,city,channel_id,status,vendor_id,variant,options_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(d.wc_id || null, customer_id, product?.id || null, pname,
    qty, amount, d.name, d.phone, d.address, d.city || '', d.channel_id || null, d.status || 'nouveau', product?.vendor_id || null, price.variant,
    JSON.stringify(price.picks)).lastInsertRowid;
  if (product) moveVariantStock(product.id, price.picks, -qty);
  db.prepare('INSERT INTO order_history(order_id,status,note) VALUES(?,?,?)').run(id, d.status || 'nouveau', 'Commande créée');
  if (product) moveStock(product.id, -qty, 'sortie', `Commande #${id}`);
  runAutomations('status:' + (d.status || 'nouveau'), id);
  const note = { title: `🛒 Nouvelle commande n°${id}`, body: `${product?.name || d.product_name || 'Produit'} × ${qty} — ${fmt(amount)} · ${d.name}${d.city ? ', ' + d.city : ''}`, tag: `commande-${id}` };
  if (product?.vendor_id) push.notify('vendor', product.vendor_id, { ...note, url: '/vendeur/#orders' });
  push.notify('admin', null, { ...note, url: '/#orders' });
  return id;
}

function setStatus(id, status, note = '') {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  if (!o) throw new Error('Commande introuvable');
  db.prepare('UPDATE orders SET status=?, updated_at=CURRENT_TIMESTAMP, synced=0 WHERE id=?').run(status, id);
  db.prepare('INSERT INTO order_history(order_id,status,note) VALUES(?,?,?)').run(id, status, note);

  // Commission agent dès "livré"
  if (status === 'livre' && o.agent_id) {
    const a = db.prepare('SELECT * FROM agents WHERE id=?').get(o.agent_id);
    if (a) db.prepare('INSERT OR IGNORE INTO commissions(agent_id,order_id,amount) VALUES(?,?,?)')
      .run(a.id, id, Math.round(o.amount * a.commission_rate) / 100);
  }
  // Restock si annulé / retourné
  if (['annule', 'retourne'].includes(status) && !['annule', 'retourne'].includes(o.status) && o.product_id) {
    moveStock(o.product_id, o.qty, 'entree', `Retour commande #${id}`);
    try { moveVariantStock(o.product_id, JSON.parse(o.options_json || '[]'), o.qty); } catch {}
  }
  // Auto-assignation livreur
  if (status === 'confirme' && !o.courier_id) autoAssign(id);

  runAutomations('status:' + status, id);
  if (CUSTOMER_PUSH[status] && status !== o.status) {
    const [title, body] = CUSTOMER_PUSH[status](o);
    push.notify('customer', id, { title, body, url: `/suivi?n=${id}`, tag: `suivi-${id}` });
  }
  syncOrder(id).catch(() => {});
}

function autoAssign(orderId) {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  const city = (o.city || '').toLowerCase().trim();
  const couriers = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM orders WHERE courier_id=c.id
    AND status IN ('confirme','en_preparation','expedie','en_livraison')) load FROM couriers c WHERE auto_assign=1 ORDER BY load`).all();
  const match = couriers.find(c => c.zones.split(',').map(z => z.trim().toLowerCase()).filter(Boolean).includes(city))
    || couriers.find(c => !c.zones.trim());
  if (match) {
    db.prepare('UPDATE orders SET courier_id=? WHERE id=?').run(match.id, orderId);
    db.prepare('INSERT INTO order_history(order_id,status,note) VALUES(?,?,?)').run(orderId, o.status, `Auto-assigné au livreur ${match.name}`);
    notifyCourier(match.id, o);
  }
  return match?.id || null;
}

// ---------- Stock ----------
function moveStock(product_id, qty, type, note) {
  db.prepare('INSERT INTO stock_moves(product_id,qty,type,note) VALUES(?,?,?,?)').run(product_id, qty, type, note);
  db.prepare('UPDATE products SET stock=MAX(0, stock+?) WHERE id=?').run(qty, product_id); // jamais de stock négatif
}

// ---------- Soldes ----------
const courierBalance = (id) => {
  const collected = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM orders WHERE courier_id=? AND status='livre'`).get(id).s;
  const paid = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM courier_payments WHERE courier_id=?').get(id).s;
  return Math.round((collected - paid) * 100) / 100;
};
const agentDue = (id) => db.prepare('SELECT COALESCE(SUM(amount),0) s FROM commissions WHERE agent_id=? AND paid=0').get(id).s;

// ---------- Automatisations ----------
function render(tpl, o) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => ({ id: o.id, nom: o.name, telephone: o.phone, adresse: o.address, ville: o.city,
    produit: o.product_name, montant: o.amount, devise: process.env.CURRENCY || '$', statut: o.status })[k] ?? '');
}

async function execAutomation(a, o) {
  const to = a.target === 'admin' ? (a.channel === 'email' ? process.env.ADMIN_EMAIL : process.env.ADMIN_PHONE) : (a.channel === 'email' ? null : o.phone);
  let ok = 1, info = 'envoyé';
  try { if (!to) throw new Error('destinataire manquant'); await conn.send(a.channel, to, render(a.template, o), `Commande #${o.id}`); }
  catch (err) { ok = 0; info = err.message; }
  db.prepare('INSERT OR IGNORE INTO automation_log(automation_id,order_id,ok,info) VALUES(?,?,?,?)').run(a.id, o.id, ok, info);
}

function runAutomations(trigger, orderId) {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  db.prepare('SELECT * FROM automations WHERE active=1 AND trigger=? AND delay_hours=0').all(trigger)
    .forEach(a => execAutomation(a, o));
}

// Automatisations différées (ex: commande "nouveau" > 24h) — appelé par le cron
function runDelayedAutomations() {
  db.prepare('SELECT * FROM automations WHERE active=1 AND delay_hours>0').all().forEach(a => {
    const st = a.trigger.replace('status:', '');
    db.prepare(`SELECT o.* FROM orders o WHERE o.status=? AND o.updated_at <= datetime('now', ?)
      AND NOT EXISTS (SELECT 1 FROM automation_log l WHERE l.automation_id=? AND l.order_id=o.id)`)
      .all(st, `-${a.delay_hours} hours`, a.id).forEach(o => execAutomation(a, o));
  });
}

// ---------- Synchronisation WooCommerce ----------
async function syncOrder(id) {
  if (!conn.woo.enabled()) return;
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  const p = o.product_id ? db.prepare('SELECT wc_id FROM products WHERE id=?').get(o.product_id) : null;
  if (!o.wc_id) {
    const wc = await conn.woo.createOrder({ payment_method: 'mireb_cod', payment_method_title: 'Paiement à la livraison',
      status: conn.WC_STATUS[o.status], billing: { first_name: o.name, phone: o.phone, address_1: o.address, city: o.city },
      shipping: { first_name: o.name, address_1: o.address, city: o.city },
      line_items: p?.wc_id ? [{ product_id: p.wc_id, quantity: o.qty }] : [] });
    db.prepare('UPDATE orders SET wc_id=?, synced=1 WHERE id=?').run(wc.id, id);
  } else {
    await conn.woo.updateOrderStatus(o.wc_id, conn.WC_STATUS[o.status]);
    db.prepare('UPDATE orders SET synced=1 WHERE id=?').run(id);
  }
}

async function importProducts() {
  let page = 1, n = 0, list;
  do {
    list = await conn.woo.products(page++);
    for (const p of list) {
      db.prepare(`INSERT INTO products(wc_id,name,price,stock) VALUES(?,?,?,?) ON CONFLICT(wc_id) DO UPDATE SET name=excluded.name, price=excluded.price`)
        .run(p.id, p.name, +p.price || 0, p.stock_quantity || 0); n++;
      const row = db.prepare('SELECT id, slug FROM products WHERE wc_id=?').get(p.id);
      if (!row.slug) productSlug(row.id);
    }
  } while (list.length === 100);
  return n;
}

function importWcOrder(w) {
  if (db.prepare('SELECT id FROM orders WHERE wc_id=?').get(w.id)) return null;
  const li = w.line_items?.[0] || {};
  const canal = w.meta_data?.find(m => m.key === 'mireb_canal')?.value;
  return createOrder({ wc_id: w.id, name: `${w.billing.first_name} ${w.billing.last_name}`.trim(), phone: w.billing.phone,
    address: w.billing.address_1, city: w.billing.city, product_id: li.product_id, product_name: li.name, qty: li.quantity,
    amount: +w.total, channel_id: canal || null });
}

async function pullOrders() {
  const since = db.prepare('SELECT MAX(created_at) m FROM orders WHERE wc_id IS NOT NULL').get().m;
  const list = await conn.woo.orders(since ? new Date(since + 'Z').toISOString() : null);
  return list.map(importWcOrder).filter(Boolean).length;
}

async function pushUnsynced() {
  const ids = db.prepare('SELECT id FROM orders WHERE synced=0').all().map(r => r.id);
  let ok = 0; for (const id of ids) { try { await syncOrder(id); ok++; } catch {} }
  return { total: ids.length, ok };
}

module.exports = { normalizeOptions, productOptions, pricing, notifyCourier, slugify, productSlug, vendorSlug, upsertCustomer, customerStats, createOrder, setStatus, autoAssign, moveStock, courierBalance, agentDue,
  runDelayedAutomations, importProducts, importWcOrder, pullOrders, pushUnsynced, syncOrder };
