// FlexPay (FlexPaie) — paiement en ligne des produits numériques : Mobile Money et carte bancaire.
// Variables d'environnement (jamais dans le code) : FLEXPAY_TOKEN (jeton Bearer), FLEXPAY_MERCHANT (code marchand, ex. MARCO_SERVICE).
// Le paiement n'est JAMAIS considéré comme réussi sur la seule foi d'un rappel (callback) : on revérifie toujours via l'API de vérification.
const URLS = {
  mobile: process.env.FLEXPAY_MOBILE_URL || 'https://backend.flexpay.cd/api/rest/v1/paymentService',
  card: process.env.FLEXPAY_CARD_URL || 'https://cardpayment.flexpay.cd/v1.1/pay',
  check: process.env.FLEXPAY_CHECK_URL || 'https://apicheck.flexpaie.com/api/rest/v1/check/',
};
const cfg = () => ({ token: process.env.FLEXPAY_TOKEN || '', merchant: process.env.FLEXPAY_MERCHANT || '' });
const enabled = () => !!(cfg().token && cfg().merchant);
const CURRENCIES = ['USD', 'CDF'];

// Numéro au format FlexPay : 243 + 9 chiffres (accepte 0812345678, 812345678, +243 812 345 678…)
function normalizePhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 && d.startsWith('0')) d = '243' + d.slice(1);
  if (d.length === 9) d = '243' + d;
  if (!/^243\d{9}$/.test(d)) throw new Error('Numéro Mobile Money invalide (ex : 0812345678)');
  return d;
}

async function call(url, { method = 'POST', body, auth = true } = {}) {
  const c = cfg();
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(auth ? { Authorization: `Bearer ${c.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let j; try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 300) }; }
  if (!r.ok) throw new Error(`FlexPay ${r.status} : ${j.message || j.raw || 'erreur'}`);
  return j;
}

// Mobile Money : le client reçoit une demande de confirmation (code PIN) sur son téléphone
async function mobile({ phone, amount, currency, reference, callbackUrl }) {
  if (!enabled()) throw new Error('Paiement en ligne non configuré (FLEXPAY_TOKEN / FLEXPAY_MERCHANT)');
  const j = await call(URLS.mobile, { body: { merchant: cfg().merchant, type: '1', phone: normalizePhone(phone), reference,
    amount: String(amount), currency, callbackUrl } });
  if (String(j.code) !== '0' || !j.orderNumber) throw new Error(j.message || 'Paiement refusé par FlexPay');
  return { orderNumber: j.orderNumber, message: j.message };
}

// Carte bancaire : FlexPay renvoie une page de paiement sécurisée vers laquelle on redirige le client
async function card({ amount, currency, reference, description, callbackUrl, returnUrl, homeUrl }) {
  if (!enabled()) throw new Error('Paiement en ligne non configuré (FLEXPAY_TOKEN / FLEXPAY_MERCHANT)');
  const j = await call(URLS.card, { auth: false, body: { authorization: `Bearer ${cfg().token}`, merchant: cfg().merchant, reference,
    amount: String(amount), currency, description: String(description || '').slice(0, 100), callback_url: callbackUrl,
    approve_url: returnUrl, cancel_url: returnUrl, decline_url: returnUrl, home_url: homeUrl } });
  if (String(j.code) !== '0' || !j.url) throw new Error(j.message || 'Paiement par carte indisponible');
  return { orderNumber: j.orderNumber || '', url: j.url };
}

// Statut réel d'une transaction : 'paid' | 'failed' | 'pending'
// FlexPay : transaction.status "0" = réussie, "1" = échouée, autre = en attente
// (à ajuster ici si la documentation de votre contrat indique d'autres codes).
async function check(orderNumber) {
  if (!orderNumber) return { state: 'pending' };
  const j = await call(URLS.check + encodeURIComponent(orderNumber), { method: 'GET' });
  const t = j.transaction || {};
  const s = String(t.status ?? '');
  const state = String(j.code) === '0' && s === '0' ? 'paid' : s === '1' ? 'failed' : 'pending';
  return { state, amount: t.amount, currency: t.currency, reference: t.reference, raw: j };
}

module.exports = { enabled, CURRENCIES, normalizePhone, mobile, card, check };
