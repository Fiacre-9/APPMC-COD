// Comptes agents & livreurs : invitation par email, création / réinitialisation du mot de passe, connexion.
// Identifiant de connexion = l'email de la fiche. Les mots de passe sont stockés hachés (bcrypt).
// Fonctionne même sans SMTP : l'admin reçoit alors le lien à envoyer lui-même (WhatsApp, etc.).
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('./db');
const conn = require('./connectors');
const S = require('./services');

// Secret distinct de celui de l'admin : un jeton agent ne peut jamais ouvrir l'admin.
// Sans JWT_SECRET : clé aléatoire (comme server.js), jamais une valeur connue
const SECRET = (process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex')) + ':acct';
const TABLE = { agent: 'agents', courier: 'couriers' };
const LINK_TTL_MS = 48 * 3600e3;

// ---------- Migration de la base (sans risque, relançable) ----------
function addCol(table, col, def) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
for (const t of Object.values(TABLE)) { addCol(t, 'password', 'TEXT'); addCol(t, 'invite_hash', 'TEXT'); addCol(t, 'invite_expires', 'TEXT'); }
addCol('couriers', 'email', 'TEXT');

// ---------- Outils ----------
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const nameOf = (type, r) => type === 'agent' ? [r.first_name, r.last_name].filter(Boolean).join(' ') : r.name;
const baseUrl = req => (process.env.BASE_URL || `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`).replace(/\/$/, '');
const normEmail = e => String(e || '').trim().toLowerCase();
const DUMMY_HASH = bcrypt.hashSync('mireb-dummy', 10);

// Toutes les fiches (agents et livreurs) qui portent cet email
function findAllByEmail(email) {
  if (!email) return [];
  return Object.keys(TABLE).flatMap(type =>
    db.prepare(`SELECT * FROM ${TABLE[type]} WHERE lower(email)=?`).all(email).map(rec => ({ type, rec })));
}

function makeLink(type, id, req) {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare(`UPDATE ${TABLE[type]} SET invite_hash=?, invite_expires=? WHERE id=?`)
    .run(sha(token), new Date(Date.now() + LINK_TTL_MS).toISOString(), id);
  return `${baseUrl(req)}/compte.html?t=${token}`;
}

async function sendAccessEmail(type, rec, link, req, reset) {
  if (!conn.email.enabled()) throw new Error("L'envoi d'emails n'est pas configuré (variables SMTP_HOST, SMTP_USER, SMTP_PASS sur l'hébergement)");
  const role = type === 'agent' ? 'agent' : 'livreur';
  const text = [
    `Bonjour ${nameOf(type, rec) || ''},`, '',
    reset ? 'Vous avez demandé à réinitialiser votre mot de passe Mireb COD.' : `Un compte ${role} Mireb COD a été créé pour vous.`,
    `Votre identifiant de connexion : ${rec.email}`, '',
    'Choisissez votre mot de passe avec ce lien (valable 48 heures) :', link, '',
    `Ensuite, connectez-vous sur : ${baseUrl(req)}/compte.html`, '',
    "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message."
  ].join('\n');
  await conn.email.send(rec.email, reset ? 'Mireb COD : nouveau mot de passe' : 'Mireb COD : votre accès', text);
}

// Limiteur simple en mémoire : 10 essais / 10 minutes / IP et route (freine le devinage de mots de passe)
const hits = new Map();
const limiter = (req, res, next) => {
  const key = req.ip + req.path, now = Date.now();
  const recent = (hits.get(key) || []).filter(t => now - t < 600e3);
  if (recent.length >= 10) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
  recent.push(now); hits.set(key, recent); next();
};
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 600e3)) hits.delete(k); }, 600e3).unref();

// ====================================================================
// 1) Côté admin (à monter derrière l'authentification admin) : /api/accounts
// ====================================================================
const admin = express.Router();

// Envoie (ou régénère) l'invitation. Renvoie toujours le lien, même si l'email n'a pas pu partir.
admin.post('/:type/:id/invite', async (req, res) => {
  const { type, id } = req.params;
  if (!TABLE[type]) return res.status(400).json({ error: 'Type invalide' });
  const rec = db.prepare(`SELECT * FROM ${TABLE[type]} WHERE id=?`).get(id);
  if (!rec) return res.status(404).json({ error: 'Fiche introuvable' });
  const email = normEmail(rec.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Ajoutez d'abord un email valide à cette fiche (bouton ✏️)" });
  if (findAllByEmail(email).some(f => !(f.type === type && String(f.rec.id) === String(id))))
    return res.status(400).json({ error: 'Cet email est déjà utilisé par un autre agent ou livreur' });
  const link = makeLink(type, rec.id, req);
  let sent = false, reason = '';
  try { await sendAccessEmail(type, rec, link, req, false); sent = true; } catch (e) { reason = e.message; }
  res.json({ sent, reason, link, to: rec.email, phone: rec.phone || '', hasPassword: !!rec.password });
});

// ====================================================================
// 2) Côté public : /compte/api/...
// ====================================================================
const router = express.Router();

// Définir (ou redéfinir) son mot de passe avec le lien reçu
router.post('/api/set-password', limiter, (req, res) => {
  const { token, password } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Lien invalide' });
  if (String(password || '').length < 8) return res.status(400).json({ error: 'Mot de passe : 8 caractères minimum' });
  const h = sha(token);
  for (const type of Object.keys(TABLE)) {
    const rec = db.prepare(`SELECT * FROM ${TABLE[type]} WHERE invite_hash=?`).get(h);
    if (rec && rec.invite_expires && new Date(rec.invite_expires) > new Date()) {
      db.prepare(`UPDATE ${TABLE[type]} SET password=?, invite_hash=NULL, invite_expires=NULL WHERE id=?`).run(bcrypt.hashSync(String(password), 10), rec.id);
      return res.json({ ok: true, email: rec.email });
    }
  }
  res.status(400).json({ error: 'Lien invalide ou expiré. Demandez un nouveau lien.' });
});

// Mot de passe oublié : réponse identique que le compte existe ou non (pas de fuite d'informations)
router.post('/api/forgot', limiter, (req, res) => {
  res.json({ ok: true });
  for (const f of findAllByEmail(normEmail(req.body?.email))) {
    const link = makeLink(f.type, f.rec.id, req);
    sendAccessEmail(f.type, f.rec, link, req, true).catch(e => console.error('[comptes] email non envoyé :', e.message));
  }
});

router.post('/api/login', limiter, (req, res) => {
  const pwd = String(req.body?.password || '');
  const candidates = findAllByEmail(normEmail(req.body?.email));
  // On compare toujours au moins un hash pour que le temps de réponse ne révèle pas si le compte existe
  const found = candidates.find(f => f.rec.password && bcrypt.compareSync(pwd, f.rec.password));
  if (!candidates.length) bcrypt.compareSync(pwd, DUMMY_HASH);
  if (!found) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  const { type, rec } = found;
  if (type === 'agent' && rec.active === 0) return res.status(403).json({ error: "Ce compte est désactivé. Contactez l'administrateur." });
  if (type === 'courier') {
    // Les livreurs utilisent l'app existante (suivi GPS) : on les y envoie avec leur jeton personnel.
    let t = rec.app_token;
    if (!t) { t = crypto.randomBytes(16).toString('hex'); db.prepare('UPDATE couriers SET app_token=? WHERE id=?').run(t, rec.id); }
    return res.json({ ok: true, role: 'courier', redirect: `/livreur/?t=${t}` });
  }
  res.cookie('acct', jwt.sign({ k: 'agent', id: rec.id }, SECRET, { expiresIn: '7d' }),
    { httpOnly: true, sameSite: 'lax', secure: (req.get('x-forwarded-proto') || req.protocol) === 'https' });
  res.json({ ok: true, role: 'agent' });
});

router.post('/api/logout', (req, res) => { res.clearCookie('acct'); res.json({ ok: true }); });

const agentAuth = (req, res, next) => {
  try {
    const p = jwt.verify(req.cookies?.acct || '', SECRET);
    if (p.k !== 'agent') throw new Error('x');
    req.agent = db.prepare('SELECT * FROM agents WHERE id=? AND active=1').get(p.id);
    if (!req.agent) throw new Error('x');
    next();
  } catch { res.status(401).json({ error: 'Non connecté' }); }
};

// ---------- Espace agent de confirmation ----------
// L'agent appelle le client, corrige l'adresse, confirme ou annule, et choisit le livreur.
// Il ne peut JAMAIS marquer « Livré » ni « Payé » (c'est le livreur / l'admin) : la commission se déclenche sur « Livré ».
const AGENT_STATUSES = ['en_confirmation', 'confirme', 'annule'];     // statuts qu'un agent peut poser
const EDITABLE = ['nouveau', 'en_confirmation', 'confirme'];         // tant que la commande est dans ces statuts
const ASSIGNABLE = ['nouveau', 'en_confirmation', 'confirme', 'en_preparation']; // choix / changement de livreur
const QUEUE = ['nouveau', 'en_confirmation'];                        // commandes libres que tout agent peut prendre

const history = (id, status, note) => db.prepare('INSERT INTO order_history(order_id,status,note) VALUES(?,?,?)').run(id, status, note);

router.get('/api/agent/me', agentAuth, (req, res) => res.json({
  name: nameOf('agent', req.agent),
  commission_due: S.agentDue(req.agent.id),
  currency: process.env.CURRENCY || '$',
  couriers: db.prepare(`SELECT c.id, c.name, c.zones, (SELECT COUNT(*) FROM orders WHERE courier_id=c.id
    AND status IN ('confirme','en_preparation','expedie','en_livraison')) load FROM couriers c ORDER BY c.name`).all(),
  orders: db.prepare(`SELECT o.id,o.name,o.phone,o.address,o.city,o.product_name,o.qty,o.amount,o.status,o.created_at,o.agent_id,o.courier_id,c.name courier,cu.blacklisted
    FROM orders o LEFT JOIN couriers c ON c.id=o.courier_id LEFT JOIN customers cu ON cu.id=o.customer_id
    WHERE o.agent_id=? OR (o.agent_id IS NULL AND o.status IN ('nouveau','en_confirmation'))
    ORDER BY o.id DESC LIMIT 150`).all(req.agent.id).map(o => ({ ...o, mine: o.agent_id === req.agent.id, editable: EDITABLE.includes(o.status),
      assignable: ASSIGNABLE.includes(o.status) }))
}));

const mineOrFree = (o, me) => o && (o.agent_id === me.id || (o.agent_id == null && QUEUE.includes(o.status)));

// Prendre en charge une commande libre (un seul agent peut la prendre)
router.post('/api/agent/orders/:id/claim', agentAuth, (req, res) => {
  const r = db.prepare(`UPDATE orders SET agent_id=? WHERE id=? AND agent_id IS NULL AND status IN ('nouveau','en_confirmation')`).run(req.agent.id, req.params.id);
  if (!r.changes) return res.status(409).json({ error: 'Cette commande est déjà prise par un autre agent' });
  history(+req.params.id, db.prepare('SELECT status FROM orders WHERE id=?').get(req.params.id).status, `Prise en charge par ${nameOf('agent', req.agent)}`);
  res.json({ ok: true });
});

// Traiter une commande : statut, livreur, adresse corrigée, note (tout est optionnel)
router.put('/api/agent/orders/:id', agentAuth, (req, res) => {
  const me = req.agent, id = +req.params.id, b = req.body || {}, who = nameOf('agent', me);
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  if (!mineOrFree(o, me)) return res.status(404).json({ error: 'Commande introuvable ou déjà prise par un autre agent' });

  if (b.status !== undefined && b.status !== '') {
    if (!AGENT_STATUSES.includes(b.status)) return res.status(403).json({ error: "Vous ne pouvez pas choisir ce statut" });
    if (!EDITABLE.includes(o.status)) return res.status(403).json({ error: 'Cette commande est déjà en livraison ou terminée : le statut est géré par le livreur' });
  }
  let courier;                                   // undefined = inchangé, null = retirer, objet = nouveau livreur
  if (b.courier_id !== undefined) {
    if (!ASSIGNABLE.includes(o.status)) return res.status(403).json({ error: 'Le livreur ne peut plus être changé pour cette commande' });
    if (b.courier_id === null || b.courier_id === '') courier = null;
    else { courier = db.prepare('SELECT id,name FROM couriers WHERE id=?').get(+b.courier_id); if (!courier) return res.status(400).json({ error: 'Livreur introuvable' }); }
  }
  const address = b.address === undefined ? undefined : String(b.address).trim().slice(0, 300);
  if (address !== undefined && address.length < 3) return res.status(400).json({ error: 'Adresse trop courte' });
  if (address !== undefined && !ASSIGNABLE.includes(o.status)) return res.status(403).json({ error: "L'adresse ne peut plus être modifiée" });
  const note = String(b.note || '').trim().slice(0, 300);

  try {
    db.transaction(() => {
      if (o.agent_id == null) {
        if (!db.prepare('UPDATE orders SET agent_id=? WHERE id=? AND agent_id IS NULL').run(me.id, id).changes) throw new Error('Commande déjà prise par un autre agent');
      }
      if (address !== undefined && address !== o.address) {
        db.prepare('UPDATE orders SET address=?, updated_at=CURRENT_TIMESTAMP, synced=0 WHERE id=?').run(address, id);
        history(id, o.status, `Adresse corrigée par ${who} : ${address}`);
      }
      if (courier !== undefined && (courier ? courier.id : null) !== o.courier_id) {
        db.prepare('UPDATE orders SET courier_id=? WHERE id=?').run(courier ? courier.id : null, id);
        history(id, o.status, courier ? `Affecté au livreur ${courier.name} par ${who}` : `Livreur retiré par ${who}`);
      }
    })();
  } catch (e) { return res.status(409).json({ error: e.message }); }

  if (b.status) S.setStatus(id, b.status, `Par agent ${who}${note ? ' : ' + note : ''}`);   // déclenche l'auto-assignation, le stock, les automatisations
  else if (note) history(id, o.status, `Note de ${who} : ${note}`);

  const after = db.prepare('SELECT o.*, c.name courier FROM orders o LEFT JOIN couriers c ON c.id=o.courier_id WHERE o.id=?').get(id);
  // Le livreur reçoit la notification quand la commande lui est confirmée (comme pour l'affectation depuis l'admin)
  const courierChanged = courier !== undefined && (courier ? courier.id : null) !== o.courier_id;
  if (after.courier_id && ['confirme', 'en_preparation'].includes(after.status) && (courierChanged || (b.status === 'confirme' && o.status !== 'confirme'))) {
    try { S.notifyCourier(after.courier_id, after); } catch (e) { console.error('[comptes] notification livreur :', e.message); }
  }
  res.json({ ok: true, status: after.status, courier: after.courier });
});

module.exports = { admin, router };
