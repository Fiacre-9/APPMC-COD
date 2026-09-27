// Ventes de produits numériques : paiement FlexPay puis téléchargement sécurisé (table digital_sales, séparée des commandes COD)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, getSetting } = require('./db');
const flexpay = require('./flexpay');

const dir = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'private');
fs.mkdirSync(dir, { recursive: true });
const MAX_DOWNLOADS = 20;
const currency = () => (getSetting('currency_code') || 'USD').toUpperCase();
const base = () => (process.env.BASE_URL || '').replace(/\/$/, '');

// Fichier envoyé par le vendeur/l'admin : stocké hors du dossier public, nom aléatoire
const EXT = /\.(pdf|epub|zip|rar|7z|mp3|m4a|wav|mp4|mov|docx?|xlsx?|pptx?|txt|png|jpe?g|psd|ai|apk)$/i;
function saveFile(buffer, originalName) {
  const name = path.basename(String(originalName || 'fichier')).replace(/[^\p{L}\p{N}._\- ()]/gu, '_').slice(0, 120);
  if (!EXT.test(name)) throw new Error('Format non accepté (PDF, EPUB, ZIP, MP3, MP4, Office, images…)');
  if (!buffer?.length) throw new Error('Fichier vide');
  const stored = crypto.randomBytes(16).toString('hex') + path.extname(name).toLowerCase();
  fs.writeFileSync(path.join(dir, stored), buffer);
  return { digital_file: stored, digital_name: name };
}
const filePath = (stored) => stored && /^[a-f0-9]{32}\.\w+$/.test(stored) ? path.join(dir, stored) : null;

// 1) Crée la vente (montant pris en base, jamais celui du navigateur) puis 2) lance le paiement FlexPay
async function checkout({ product_id, name, phone, email, method, canal }) {
  const p = db.prepare(`SELECT p.* FROM products p LEFT JOIN vendors v ON v.id=p.vendor_id
    WHERE p.id=? AND p.type='digital' AND p.active=1 AND (p.vendor_id IS NULL OR v.active=1)`).get(product_id);
  if (!p) throw new Error('Produit indisponible');
  if (!p.digital_file && !p.digital_url) throw new Error('Ce produit n\'est pas encore prêt au téléchargement');
  if (!String(name || '').trim()) throw new Error('Votre nom est obligatoire');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Email invalide');
  const cur = currency();
  if (!flexpay.CURRENCIES.includes(cur)) throw new Error(`Devise ${cur} non acceptée par FlexPay (USD ou CDF)`);
  if (!['mobile', 'card'].includes(method)) throw new Error('Choisissez Mobile Money ou carte bancaire');
  const phoneN = method === 'mobile' ? flexpay.normalizePhone(phone) : String(phone || '').replace(/[^\d+]/g, '');
  const reference = `MIREB-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const token = crypto.randomBytes(16).toString('hex');
  const id = db.prepare(`INSERT INTO digital_sales(product_id,vendor_id,product_name,name,phone,email,amount,currency,method,reference,token,channel_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(p.id, p.vendor_id, p.name, String(name).trim().slice(0, 100), phoneN, email || '', p.price, cur, method,
    reference, token, /^\d+$/.test(String(canal || '')) ? +canal : null).lastInsertRowid;
  const receipt = `${base()}/achat/${reference}?k=${token}`, callbackUrl = `${base()}/public/flexpay/callback`;
  try {
    if (method === 'mobile') {
      const r = await flexpay.mobile({ phone: phoneN, amount: p.price, currency: cur, reference, callbackUrl });
      db.prepare('UPDATE digital_sales SET order_number=? WHERE id=?').run(r.orderNumber, id);
      return { reference, token, receipt };
    }
    const r = await flexpay.card({ amount: p.price, currency: cur, reference, description: p.name, callbackUrl, returnUrl: receipt, homeUrl: `${base()}/boutique` });
    db.prepare('UPDATE digital_sales SET order_number=? WHERE id=?').run(r.orderNumber, id);
    return { reference, token, receipt, redirect: r.url };
  } catch (e) {
    db.prepare("UPDATE digital_sales SET status='failed' WHERE id=?").run(id); throw e;
  }
}

const bySale = (reference, token) => {
  const s = db.prepare('SELECT * FROM digital_sales WHERE reference=?').get(String(reference || ''));
  return s && token && s.token.length === String(token).length && crypto.timingSafeEqual(Buffer.from(s.token), Buffer.from(String(token))) ? s : null;
};

// Interroge FlexPay (au plus toutes les 4 s par vente) et enregistre le paiement une seule fois
let onPaid = () => {};
async function refresh(sale) {
  if (sale.status !== 'pending' || !sale.order_number) return sale;
  if (sale.last_check && Date.now() - new Date(sale.last_check + 'Z') < 4000) return sale;
  db.prepare('UPDATE digital_sales SET last_check=CURRENT_TIMESTAMP WHERE id=?').run(sale.id);
  const r = await flexpay.check(sale.order_number).catch(e => { console.error('[flexpay]', e.message); return { state: 'pending' }; });
  // Montant et devise vérifiés : un paiement d'un autre montant ne débloque rien
  const amountOk = r.amount == null || Math.abs(+r.amount - sale.amount) < 0.01;
  const curOk = !r.currency || String(r.currency).toUpperCase() === sale.currency;
  if (r.state === 'paid' && amountOk && curOk) {
    const n = db.prepare("UPDATE digital_sales SET status='paid', paid_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").run(sale.id).changes;
    const s = db.prepare('SELECT * FROM digital_sales WHERE id=?').get(sale.id);
    if (n) try { onPaid(s); } catch (e) { console.error('[digital]', e.message); }
    return s;
  }
  if (r.state === 'failed') db.prepare("UPDATE digital_sales SET status='failed' WHERE id=? AND status='pending'").run(sale.id);
  return db.prepare('SELECT * FROM digital_sales WHERE id=?').get(sale.id);
}

module.exports = { dir, MAX_DOWNLOADS, saveFile, filePath, checkout, bySale, refresh, setOnPaid: (fn) => { onPaid = fn; } };
