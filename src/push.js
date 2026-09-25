// Notifications push (Web Push, clés VAPID) : vendeurs, admin, livreurs, clients.
// Les clés sont créées au premier démarrage et gardées en base (DATA_DIR, conservée aux redéploiements) ;
// VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY dans l'environnement ont la priorité.
const crypto = require('crypto');
const webpush = require('web-push');
const { db, getSetting, setSetting } = require('./db');

let keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
if (!keys.publicKey || !keys.privateKey) {
  keys = { publicKey: getSetting('vapid_public'), privateKey: getSetting('vapid_private') };
  if (!keys.publicKey) { keys = webpush.generateVAPIDKeys(); setSetting('vapid_public', keys.publicKey); setSetting('vapid_private', keys.privateKey); }
}
webpush.setVapidDetails(`mailto:${process.env.ADMIN_EMAIL || 'admin@mireb.online'}`, keys.publicKey, keys.privateKey);

const ROLES = ['admin', 'vendor', 'courier', 'customer'];

function subscribe(sub, role, refId) {
  const ep = sub?.endpoint, k = sub?.keys || {};
  if (!ROLES.includes(role) || !/^https:\/\//.test(ep || '') || !k.p256dh || !k.auth) throw new Error('Abonnement invalide');
  db.prepare(`INSERT INTO push_subs(endpoint,p256dh,auth,role,ref_id) VALUES(?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, role=excluded.role, ref_id=excluded.ref_id`)
    .run(ep, k.p256dh, k.auth, role, refId ?? null);
}
const unsubscribe = (endpoint) => db.prepare('DELETE FROM push_subs WHERE endpoint=?').run(endpoint || '');

// Envoie à tous les appareils d'un rôle (et d'une fiche : vendeur, livreur, commande). Jamais bloquant.
function notify(role, refId, { title, body, url = '/', tag }) {
  const subs = refId == null ? db.prepare('SELECT * FROM push_subs WHERE role=?').all(role)
    : db.prepare('SELECT * FROM push_subs WHERE role=? AND ref_id=?').all(role, refId);
  const payload = JSON.stringify({ title, body, url, tag, icon: `/icons/${{ vendor: 'vendeur', courier: 'livreur', customer: 'boutique' }[role] || 'admin'}-192.png` });
  subs.forEach(s => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 })
    .catch(err => { if ([404, 410].includes(err.statusCode)) unsubscribe(s.endpoint); else console.error('[push]', err.statusCode || err.message); }));
  return subs.length;
}

// Jeton qui prouve qu'un client a bien passé (ou retrouvé) la commande : seul lui peut s'abonner à son suivi
const SECRET = () => process.env.JWT_SECRET || getSetting('vapid_private');
const orderToken = (id) => crypto.createHmac('sha256', SECRET()).update('order:' + id).digest('hex').slice(0, 32);
const checkOrderToken = (id, t) => typeof t === 'string' && t.length === 32 && crypto.timingSafeEqual(Buffer.from(orderToken(id)), Buffer.from(t));

module.exports = { publicKey: keys.publicKey, subscribe, unsubscribe, notify, orderToken, checkOrderToken };
