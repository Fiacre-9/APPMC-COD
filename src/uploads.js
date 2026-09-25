// Images produits envoyées en data URL (base64), stockées hors du dossier de build pour survivre aux redéploiements
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dir = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'uploads');
fs.mkdirSync(dir, { recursive: true });
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

function saveImage(dataUrl) {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m || !TYPES[m[1]]) throw new Error('Image invalide (JPG, PNG, WEBP ou GIF)');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 3 * 1024 * 1024) throw new Error('Image trop lourde (3 Mo maximum)');
  const name = `${crypto.randomBytes(12).toString('hex')}.${TYPES[m[1]]}`;
  fs.writeFileSync(path.join(dir, name), buf);
  return `/uploads/${name}`;
}

module.exports = { dir, saveImage };
