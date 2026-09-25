// Connecteurs externes : WooCommerce, WhatsApp Cloud API, SMS (Twilio), Email (SMTP)
const nodemailer = require('nodemailer');
const e = process.env;

// ---------- WooCommerce REST API v3 ----------
const woo = {
  enabled: () => !!(e.WC_URL && e.WC_KEY && e.WC_SECRET),
  async request(method, endpoint, body) {
    const url = `${e.WC_URL.replace(/\/$/, '')}/wp-json/wc/v3/${endpoint}`;
    const auth = Buffer.from(`${e.WC_KEY}:${e.WC_SECRET}`).toString('base64');
    const r = await fetch(url, { method, headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error(`WooCommerce ${r.status}: ${await r.text()}`);
    return r.json();
  },
  products: (page = 1) => woo.request('GET', `products?per_page=100&page=${page}`),
  orders: (after) => woo.request('GET', `orders?per_page=100${after ? `&after=${after}` : ''}`),
  createOrder: (o) => woo.request('POST', 'orders', o),
  updateOrderStatus: (id, status) => woo.request('PUT', `orders/${id}`, { status }),
};

// Correspondance statuts Mireb -> statuts WooCommerce
const WC_STATUS = { nouveau: 'pending', en_confirmation: 'on-hold', confirme: 'processing', en_preparation: 'processing',
  expedie: 'processing', en_livraison: 'processing', livre: 'completed', paye: 'completed', annule: 'cancelled', retourne: 'refunded' };

// ---------- WhatsApp Cloud API ----------
const whatsapp = {
  enabled: () => !!(e.WA_TOKEN && e.WA_PHONE_ID),
  async send(to, text) {
    const r = await fetch(`https://graph.facebook.com/v20.0/${e.WA_PHONE_ID}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${e.WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace(/\D/g, ''), type: 'text', text: { body: text } }) });
    if (!r.ok) throw new Error(`WhatsApp ${r.status}: ${await r.text()}`);
    return r.json();
  },
};

// ---------- SMS via Twilio ----------
const sms = {
  enabled: () => !!(e.TWILIO_SID && e.TWILIO_TOKEN && e.TWILIO_FROM),
  async send(to, text) {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${e.TWILIO_SID}/Messages.json`, {
      method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${e.TWILIO_SID}:${e.TWILIO_TOKEN}`).toString('base64') },
      body: new URLSearchParams({ To: to, From: e.TWILIO_FROM, Body: text }) });
    if (!r.ok) throw new Error(`SMS ${r.status}: ${await r.text()}`);
    return r.json();
  },
};

// ---------- Email SMTP ----------
let transporter;
const email = {
  enabled: () => !!e.SMTP_HOST,
  async send(to, subject, text) {
    transporter ||= nodemailer.createTransport({ host: e.SMTP_HOST, port: +e.SMTP_PORT || 587,
      secure: +e.SMTP_PORT === 465, auth: { user: e.SMTP_USER, pass: e.SMTP_PASS } });
    return transporter.sendMail({ from: e.SMTP_FROM || e.SMTP_USER, to, subject, text });
  },
};

async function send(channel, to, text, subject = 'Mireb COD') {
  const c = { whatsapp, sms, email }[channel];
  if (!c) throw new Error('Canal inconnu: ' + channel);
  if (!c.enabled()) throw new Error(`Connecteur ${channel} non configuré (.env)`);
  return channel === 'email' ? c.send(to, subject, text) : c.send(to, text);
}

const status = () => ({ woocommerce: woo.enabled(), whatsapp: whatsapp.enabled(), sms: sms.enabled(), email: email.enabled() });

module.exports = { woo, WC_STATUS, whatsapp, sms, email, send, status };
