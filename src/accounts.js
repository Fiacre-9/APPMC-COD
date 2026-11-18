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

db.exec(`CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT DEFAULT CURRENT_TIMESTAMP,
  actor_type TEXT, actor_id INTEGER, actor_name TEXT, action TEXT, order_id INTEGER, detail TEXT);
  CREATE INDEX IF NOT EXISTS idx_activity_actor ON activity_log(actor_type, actor_id, at);`);

// ---------- Outils ----------
// Journal : qui a fait quoi, quand (connexions, traitement des commandes…)
function logAct(type, rec, action, orderId, detail) {
  try {
    db.prepare('INSERT INTO activity_log(actor_type,actor_id,actor_name,action,order_id,detail) VALUES(?,?,?,?,?,?)')
      .run(type, rec?.id ?? null, nameOf(type, rec || {}) || '', action, orderId ?? null, detail ?? null);
  } catch (e) { console.error('[comptes] journal :', e.message); }
}
// Début de la période (UTC, même format que CURRENT_TIMESTAMP). 1 jour = depuis minuit à Kinshasa (UTC+1)
function sinceOf(days) {
  const d = Math.min(Math.max(parseInt(days) || 7, 1), 90);
  let t;
  if (d === 1) { const n = new Date(Date.now() + 3600e3); n.setUTCHours(0, 0, 0, 0); t = new Date(n.getTime() - 3600e3); }
  else t = new Date(Date.now() - d * 864e5);
  return t.toISOString().slice(0, 19).replace('T', ' ');
}
// Explique en français pourquoi un email n'est pas parti
function explainMailError(e) {
  const m = String(e?.message || e), c = e?.code || '', r = e?.responseCode;
  if (c === 'EAUTH' || r === 535 || /invalid login|authentication/i.test(m)) return "Le serveur d'email refuse l'identifiant ou le mot de passe. Vérifiez SMTP_USER (adresse complète de la boîte) et SMTP_PASS.";
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED', 'ENOTFOUND'].includes(c) || /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|getaddrinfo/i.test(m)) return "Impossible de joindre le serveur d'email. Vérifiez SMTP_HOST (ex. smtp.hostinger.com) et SMTP_PORT (465).";
  if (/wrong version number|ssl|tls|certificate/i.test(m)) return 'Problème de connexion sécurisée. Essayez SMTP_PORT=465 (SSL) avec le même SMTP_HOST.';
  if (c === 'EENVELOPE' || [501, 550, 553].includes(r) || /sender|not owned|rejected|mailbox/i.test(m)) return "Adresse refusée. SMTP_FROM doit être l'adresse de la boîte SMTP_USER (ex. Mireb COD <ecom@app.mireb.online>), et l'adresse du destinataire doit être valide.";
  return null;
}
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
  let sent = false, reason = '', detail = '';
  try { await sendAccessEmail(type, rec, link, req, false); sent = true; } catch (e) { reason = explainMailError(e) || e.message; detail = e.message; }
  logAct(type, rec, 'invited', null, sent ? 'Email envoyé' : 'Lien créé, email non envoyé');
  res.json({ sent, reason, detail, link, to: rec.email, phone: rec.phone || '', hasPassword: !!rec.password });
});

// Test d'envoi d'email (indique aussi la configuration lue, sans afficher le mot de passe)
admin.post('/email-test', async (req, res) => {
  const to = normEmail(req.body?.to);
  const cfg = { host: process.env.SMTP_HOST || '', port: process.env.SMTP_PORT || '587 (par défaut)', user: process.env.SMTP_USER || '',
    from: process.env.SMTP_FROM || '(identique à SMTP_USER)', password_set: !!process.env.SMTP_PASS };
  if (!conn.email.enabled()) return res.json({ ok: false, reason: "SMTP_HOST n'est pas défini : l'envoi d'emails est désactivé.", cfg });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ error: 'Adresse email invalide' });
  try { await conn.email.send(to, 'Test Mireb COD', "Ceci est un message de test : l'envoi d'emails fonctionne."); res.json({ ok: true, cfg }); }
  catch (e) { res.json({ ok: false, reason: explainMailError(e) || e.message, detail: e.message, cfg }); }
});

// Supprimer un agent ou un livreur (refusé s'il reste de l'argent à régler ou une livraison en cours)
admin.delete('/:type/:id', (req, res) => {
  const { type, id } = req.params;
  if (!TABLE[type]) return res.status(400).json({ error: 'Type invalide' });
  const rec = db.prepare(`SELECT * FROM ${TABLE[type]} WHERE id=?`).get(id);
  if (!rec) return res.status(404).json({ error: 'Fiche introuvable' });
  const name = nameOf(type, rec);
  if (type === 'agent') {
    const due = S.agentDue(rec.id);
    if (due > 0) return res.status(409).json({ error: `${name} a des commissions non payées (${due}). Payez-les avec 💰 avant de supprimer.` });
  } else {
    const busy = db.prepare(`SELECT COUNT(*) n FROM orders WHERE courier_id=? AND status IN ('confirme','en_preparation','expedie','en_livraison')`).get(rec.id).n;
    if (busy) return res.status(409).json({ error: `${name} a ${busy} commande(s) en cours. Réaffectez-les d'abord.` });
    const bal = S.courierBalance(rec.id);
    if (bal !== 0) return res.status(409).json({ error: `${name} a un solde non réglé (${bal}). Enregistrez le versement avec 💳 avant de supprimer.` });
  }
  db.transaction(() => {
    // Les commandes déjà livrées gardent leur historique ; les autres redeviennent libres
    if (type === 'agent') db.prepare(`UPDATE orders SET agent_id=NULL WHERE agent_id=? AND status IN ('nouveau','en_confirmation')`).run(rec.id);
    else db.prepare(`UPDATE orders SET courier_id=NULL WHERE courier_id=? AND status NOT IN ('livre','paye')`).run(rec.id);
    db.prepare(`DELETE FROM ${TABLE[type]} WHERE id=?`).run(rec.id);
  })();
  logAct(type, rec, 'deleted', null, "Supprimé par l'administrateur");
  res.json({ ok: true });
});

// Suivi des activités : résumé par personne + journal récent
const TEXT = {
  agent: { login: () => "s'est connecté(e)", logout: () => "s'est déconnecté(e)", password_set: () => 'a créé son mot de passe',
    invited: (o, d) => `a reçu son accès (${d || 'invitation'})`, deleted: () => 'compte supprimé',
    claim: o => `a pris en charge la commande #${o}`, confirme: o => `a confirmé la commande #${o}`, annule: o => `a annulé la commande #${o}`,
    en_confirmation: o => `doit rappeler le client (commande #${o})`, address: o => `a corrigé l'adresse de la commande #${o}`,
    courier: (o, d) => `${d || 'livreur'} pour la commande #${o}`, note: (o, d) => `a noté sur la commande #${o}${d ? ' : ' + d : ''}` },
  courier: { login: () => "s'est connecté(e)", logout: () => "s'est déconnecté(e)", password_set: () => 'a créé son mot de passe',
    invited: (o, d) => `a reçu son accès (${d || 'invitation'})`, deleted: () => 'compte supprimé',
    en_livraison: o => `est en route (commande #${o})`, livre: o => `a livré la commande #${o}`, retourne: o => `a retourné la commande #${o}` },
};
const isRecent = (ts, ms) => { if (!ts) return false; const t = String(ts); return Date.now() - new Date(t.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? '' : 'Z')).getTime() < ms; };

admin.get('/activity', (req, res) => {
  const type = req.query.type === 'courier' ? 'courier' : 'agent', since = sinceOf(req.query.days);
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const cnt = (id, act) => one(`SELECT COUNT(*) n FROM activity_log WHERE actor_type=? AND actor_id=? AND action=? AND at>=?`, type, id, act, since).n;
  const last = (id, cond) => one(`SELECT MAX(at) t FROM activity_log WHERE actor_type=? AND actor_id=? AND ${cond}`, type, id).t;
  let people;
  if (type === 'agent') {
    people = db.prepare('SELECT * FROM agents ORDER BY first_name').all().map(a => ({
      id: a.id, name: nameOf('agent', a), disabled: a.active === 0, has_account: !!a.password,
      last_login: last(a.id, "action='login'"), last_action: last(a.id, "action NOT IN ('login','logout','password_set','invited')"),
      stats: { logins: cnt(a.id, 'login'), claimed: cnt(a.id, 'claim'), confirmed: cnt(a.id, 'confirme'), cancelled: cnt(a.id, 'annule'), recall: cnt(a.id, 'en_confirmation'),
        delivered: one(`SELECT COUNT(DISTINCT h.order_id) n FROM order_history h JOIN orders o ON o.id=h.order_id WHERE o.agent_id=? AND h.status='livre' AND h.created_at>=?`, a.id, since).n,
        pending: one(`SELECT COUNT(*) n FROM orders WHERE agent_id=? AND status IN ('nouveau','en_confirmation')`, a.id).n } }));
  } else {
    people = db.prepare('SELECT * FROM couriers ORDER BY name').all().map(c => {
      const h = st => one(`SELECT COUNT(DISTINCT h.order_id) n FROM order_history h JOIN orders o ON o.id=h.order_id
        WHERE o.courier_id=? AND h.note LIKE 'Par livreur %' AND h.status=? AND h.created_at>=?`, c.id, st, since).n;
      return { id: c.id, name: c.name, has_account: !!c.password, online: isRecent(c.last_seen, 5 * 60e3), last_seen: c.last_seen,
        last_login: last(c.id, "action='login'"), last_action: c.last_seen,
        stats: { logins: cnt(c.id, 'login'), en_route: h('en_livraison'), delivered: h('livre'), returned: h('retourne'),
          collected: one(`SELECT COALESCE(SUM(o.amount),0) s FROM orders o WHERE o.courier_id=? AND o.status IN ('livre','paye')
            AND o.id IN (SELECT order_id FROM order_history WHERE status='livre' AND created_at>=?)`, c.id, since).s,
          current: one(`SELECT COUNT(*) n FROM orders WHERE courier_id=? AND status IN ('confirme','en_preparation','expedie','en_livraison')`, c.id).n } };
    });
  }
  const ev = db.prepare(`SELECT at, actor_id, actor_name, action, order_id, detail FROM activity_log WHERE actor_type=? AND at>=? ORDER BY id DESC LIMIT 300`).all(type, since)
    .map(e => ({ at: e.at, actor_id: e.actor_id, name: e.actor_name, order_id: e.order_id, text: (TEXT[type][e.action] || (() => e.action))(e.order_id, e.detail) }));
  if (type === 'courier') {
    db.prepare(`SELECT h.created_at at, h.status, h.note, h.order_id, o.courier_id FROM order_history h JOIN orders o ON o.id=h.order_id
      WHERE h.note LIKE 'Par livreur %' AND h.created_at>=? ORDER BY h.id DESC LIMIT 300`).all(since).forEach(h => {
      if (TEXT.courier[h.status]) ev.push({ at: h.at, actor_id: h.courier_id, name: h.note.slice('Par livreur '.length), order_id: h.order_id, text: TEXT.courier[h.status](h.order_id) });
    });
  }
  ev.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));   // le plus récent d'abord (tri stable pour les égalités)
  res.json({ since, people, events: ev.slice(0, 200) });
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
      logAct(type, rec, 'password_set');
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
    logAct('courier', rec, 'login');
    return res.json({ ok: true, role: 'courier', redirect: `/livreur/?t=${t}` });
  }
  logAct('agent', rec, 'login');
  res.cookie('acct', jwt.sign({ k: 'agent', id: rec.id }, SECRET, { expiresIn: '7d' }),
    { httpOnly: true, sameSite: 'lax', secure: (req.get('x-forwarded-proto') || req.protocol) === 'https' });
  res.json({ ok: true, role: 'agent' });
});

router.post('/api/logout', (req, res) => {
  try { const p = jwt.verify(req.cookies?.acct || '', SECRET); const a = db.prepare('SELECT * FROM agents WHERE id=?').get(p.id); if (a) logAct('agent', a, 'logout'); } catch {}
  res.clearCookie('acct'); res.json({ ok: true });
});

// Déconnexion du livreur : son lien personnel est renouvelé (l'app installée ne peut plus se rouvrir toute seule).
// Un livreur sans compte (lien envoyé par l'admin, sans mot de passe) garde son lien : il le quitte seulement de cet appareil.
router.post('/api/courier-logout', limiter, (req, res) => {
  const t = String(req.get('x-token') || req.body?.t || '');
  const rec = /^[a-f0-9]{32}$/.test(t) ? db.prepare('SELECT * FROM couriers WHERE app_token=?').get(t) : null;
  if (!rec) return res.json({ ok: true, account: false });
  logAct('courier', rec, 'logout');
  if (!rec.password) return res.json({ ok: true, account: false });
  db.prepare('UPDATE couriers SET app_token=? WHERE id=?').run(crypto.randomBytes(16).toString('hex'), rec.id);
  res.json({ ok: true, account: true });
});

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
  logAct('agent', req.agent, 'claim', +req.params.id);
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

  if (address !== undefined && address !== o.address) logAct('agent', me, 'address', id, address);
  if (courier !== undefined && (courier ? courier.id : null) !== o.courier_id) logAct('agent', me, 'courier', id, courier ? `a choisi le livreur ${courier.name}` : 'a retiré le livreur');
  if (b.status) logAct('agent', me, b.status, id, note || null);
  else if (note) logAct('agent', me, 'note', id, note);
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
