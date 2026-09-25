// SQLite intégré à Node (>= 22.13) : aucune compilation native, fonctionne sur l'hébergement mutualisé Hostinger
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dir, { recursive: true });
const raw = new DatabaseSync(path.join(dir, 'mireb.db'));
raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// Couche compatible avec l'API better-sqlite3 utilisée dans le projet (prepare/get/all/run, transaction)
const norm = args => args.map(v => v === undefined ? null : typeof v === 'boolean' ? +v : v);
const db = {
  exec: sql => raw.exec(sql),
  prepare(sql) {
    const st = raw.prepare(sql);
    return { get: (...a) => st.get(...norm(a)), all: (...a) => st.all(...norm(a)), run: (...a) => st.run(...norm(a)) };
  },
  transaction: fn => (...a) => {
    raw.exec('BEGIN');
    try { const r = fn(...a); raw.exec('COMMIT'); return r; } catch (err) { raw.exec('ROLLBACK'); throw err; }
  },
};

const STATUSES = ['nouveau', 'en_confirmation', 'confirme', 'en_preparation', 'expedie',
  'en_livraison', 'livre', 'paye', 'annule', 'retourne'];

db.exec(`
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'admin');
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, wc_id INTEGER UNIQUE, name TEXT, price REAL DEFAULT 0, stock INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS stock_moves (id INTEGER PRIMARY KEY, product_id INTEGER, qty INTEGER, type TEXT, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS channels (id INTEGER PRIMARY KEY, name TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY, phone TEXT UNIQUE, name TEXT, address TEXT, city TEXT,
  tags TEXT DEFAULT '', notes TEXT DEFAULT '', blacklisted INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS agents (id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, phone TEXT, email TEXT,
  commission_rate REAL DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS couriers (id INTEGER PRIMARY KEY, name TEXT, company TEXT, phone TEXT, fee_per_parcel REAL DEFAULT 0,
  zones TEXT DEFAULT '', auto_assign INTEGER DEFAULT 0, app_token TEXT, last_lat REAL, last_lng REAL, last_seen TEXT);
CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, wc_id INTEGER UNIQUE, customer_id INTEGER, product_id INTEGER,
  product_name TEXT, qty INTEGER DEFAULT 1, amount REAL DEFAULT 0, name TEXT, phone TEXT, address TEXT, city TEXT,
  status TEXT DEFAULT 'nouveau', agent_id INTEGER, courier_id INTEGER, channel_id INTEGER, synced INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS order_history (id INTEGER PRIMARY KEY, order_id INTEGER, status TEXT, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS commissions (id INTEGER PRIMARY KEY, agent_id INTEGER, order_id INTEGER UNIQUE, amount REAL, paid INTEGER DEFAULT 0,
  paid_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS courier_payments (id INTEGER PRIMARY KEY, courier_id INTEGER, amount REAL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS automations (id INTEGER PRIMARY KEY, name TEXT, trigger TEXT, channel TEXT, target TEXT DEFAULT 'client',
  template TEXT, delay_hours INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS vendors (id INTEGER PRIMARY KEY, shop_name TEXT, slug TEXT UNIQUE, email TEXT UNIQUE, password TEXT,
  phone TEXT, whatsapp TEXT, description TEXT DEFAULT '', active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS push_subs (id INTEGER PRIMARY KEY, endpoint TEXT UNIQUE, p256dh TEXT, auth TEXT,
  role TEXT, ref_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS push_subs_role ON push_subs(role, ref_id);
CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT, icon TEXT DEFAULT '📦',
  google_category TEXT DEFAULT '', position INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS automation_log (id INTEGER PRIMARY KEY, automation_id INTEGER, order_id INTEGER, ok INTEGER, info TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(automation_id, order_id));
`);

// Migrations (colonnes ajoutées pour la boutique multivendeur)
const addCol = (t, c, def) => {
  if (!db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`);
};
addCol('products', 'vendor_id', 'INTEGER');
addCol('products', 'slug', 'TEXT');
addCol('products', 'description', "TEXT DEFAULT ''");
addCol('products', 'image', "TEXT DEFAULT ''");
addCol('products', 'compare_price', 'REAL');
addCol('products', 'active', 'INTEGER DEFAULT 1');
addCol('products', 'category', "TEXT DEFAULT ''");
addCol('products', 'short_description', "TEXT DEFAULT ''");
addCol('products', 'gallery', "TEXT DEFAULT '[]'");
addCol('orders', 'vendor_id', 'INTEGER');
// Date d'ajout des produits (section « Nouveautés ») : remplie automatiquement à chaque création, quel que soit l'auteur
if (!db.prepare('PRAGMA table_info(products)').all().some(x => x.name === 'created_at')) {
  db.exec('ALTER TABLE products ADD COLUMN created_at TEXT');
  db.exec("UPDATE products SET created_at=datetime('now','-30 days')"); // produits existants : pas marqués « nouveaux »
}
db.exec(`CREATE TRIGGER IF NOT EXISTS products_created_at AFTER INSERT ON products WHEN NEW.created_at IS NULL
  BEGIN UPDATE products SET created_at=CURRENT_TIMESTAMP WHERE id=NEW.id; END`);
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS products_slug ON products(slug)');

// Catégories de la boutique (gérées dans Admin → Marketing). google_category = taxonomie Google, reconnue par Meta.
if (!db.prepare('SELECT COUNT(*) n FROM categories').get().n) {
  const ins = db.prepare('INSERT INTO categories(slug,name,icon,google_category,position) VALUES(?,?,?,?,?)');
  [['mode', 'Mode', '👗', 'Apparel & Accessories > Clothing'], ['chaussures', 'Chaussures', '👟', 'Apparel & Accessories > Shoes'],
    ['beaute', 'Beauté', '💄', 'Health & Beauty > Personal Care > Cosmetics'], ['sante', 'Santé', '💊', 'Health & Beauty > Health Care'],
    ['electronique', 'Électronique', '📱', 'Electronics'], ['maison', 'Maison', '🏠', 'Home & Garden'],
    ['cuisine', 'Cuisine', '🍳', 'Home & Garden > Kitchen & Dining'], ['enfants', 'Enfants', '🧸', 'Toys & Games'],
    ['sport', 'Sport', '⚽', 'Sporting Goods'], ['accessoires', 'Accessoires', '👜', 'Apparel & Accessories > Clothing Accessories'],
    ['alimentation', 'Alimentation', '🛒', 'Food, Beverages & Tobacco > Food Items'], ['autres', 'Autres', '📦', ''],
  ].forEach((c, i) => ins.run(...c, i));
}
const categories = () => db.prepare('SELECT slug, name, icon, google_category FROM categories ORDER BY position, id').all();

const getSetting = (k, d = '') => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value ?? d;
const setSetting = (k, v) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));

module.exports = { db, STATUSES, categories, getSetting, setSetting };
