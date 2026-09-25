require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const { db } = require('./db');
const S = require('./services');
const conn = require('./connectors');

// Sans JWT_SECRET, clé aléatoire : les sessions expirent à chaque redémarrage mais ne sont pas falsifiables
const SECRET = process.env.JWT_SECRET || require('crypto').randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) console.warn('⚠️  JWT_SECRET non défini dans .env — clé temporaire utilisée');
const app = express();
app.use(express.json({ limit: '12mb', verify: (req, _r, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// CORS pour le formulaire public intégrable (WordPress, landing pages)
app.use('/public', (req, res, next) => {
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, x-token' });
  req.method === 'OPTIONS' ? res.end() : next();
});

// Compte admin initial
if (!db.prepare('SELECT COUNT(*) n FROM users').get().n) {
  db.prepare('INSERT INTO users(email,password) VALUES(?,?)').run(process.env.ADMIN_EMAIL || 'admin@mireb.online',
    bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10));
}
// Modèles d'automatisation par défaut
if (!db.prepare('SELECT COUNT(*) n FROM automations').get().n) {
  const ins = db.prepare('INSERT INTO automations(name,trigger,channel,target,template,delay_hours,active) VALUES(?,?,?,?,?,?,0)');
  ins.run('SMS confirmation client', 'status:confirme', 'sms', 'client', 'Bonjour {nom}, votre commande #{id} ({produit}) est confirmée. Montant à payer à la livraison : {montant} {devise}.', 0);
  ins.run('WhatsApp confirmation client', 'status:confirme', 'whatsapp', 'client', 'Bonjour {nom} 👋 Votre commande #{id} est confirmée ! Notre livreur vous contactera. Montant : {montant} {devise}.', 0);
  ins.run('Alerte admin : non confirmée 24h', 'status:nouveau', 'email', 'admin', 'La commande #{id} de {nom} ({telephone}) est toujours "Nouveau" depuis 24h.', 24);
  ins.run('Remerciement après livraison', 'status:livre', 'whatsapp', 'client', 'Merci {nom} pour votre confiance ! 🙏 N\'hésitez pas à recommander.', 0);
}

// ---------- Auth ----------
app.post('/auth/login', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(req.body.email);
  if (!u || !bcrypt.compareSync(req.body.password || '', u.password)) return res.status(401).json({ error: 'Identifiants incorrects' });
  res.cookie('token', jwt.sign({ id: u.id, email: u.email }, SECRET, { expiresIn: '7d' }), { httpOnly: true, sameSite: 'lax' });
  res.json({ ok: true });
});
app.post('/auth/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });
app.post('/auth/password', auth, (req, res) => {
  if ((req.body.password || '').length < 8) return res.status(400).json({ error: '8 caractères minimum' });
  db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(req.body.password, 10), req.user.id); res.json({ ok: true });
});
function auth(req, res, next) {
  try {
    req.user = jwt.verify(req.cookies.token || '', SECRET);
    if (req.user.vid) throw new Error('jeton vendeur'); // un jeton vendeur n'ouvre jamais l'admin
    next();
  }
  catch { res.status(401).json({ error: 'Non connecté' }); }
}

app.use('/api', auth, require('./routes/api'));
app.use('/public', require('./routes/public'));
app.use('/vendor', require('./routes/vendor')(SECRET));
app.use(require('./routes/shop'));
app.use(require('./routes/pwa'));
app.use('/uploads', express.static(require('./uploads').dir, { maxAge: '30d' }));
app.get('/health', (req, res) => res.json({ ok: true, connectors: conn.status() }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Erreurs inattendues : message JSON, jamais de trace serveur envoyée au navigateur
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.expose ? err.message : 'Erreur serveur' });
});

// ---------- Tâches planifiées ----------
cron.schedule('*/10 * * * *', () => S.runDelayedAutomations());
cron.schedule('*/5 * * * *', async () => {
  if (!conn.woo.enabled()) return;
  try { await S.pullOrders(); await S.pushUnsynced(); } catch (e) { console.error('[sync]', e.message); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Mireb COD en ligne sur http://localhost:${PORT}`));
