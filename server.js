// ============================================================
// FOKWARD.STW — Backend Server v2
// Auth: SQLite + JWT + bcrypt
// Pagos: MercadoPago | Emails: Nodemailer
// ============================================================
const express  = require('express');
const path     = require('path');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const CONFIG = {
  MP_ACCESS_TOKEN: process.env.MP_ACCESS_TOKEN,
  MP_PUBLIC_KEY:   process.env.MP_PUBLIC_KEY,
  STORE_URL:       process.env.STORE_URL || 'https://fokwardweb-production.up.railway.app',
  OWNER_EMAIL:     process.env.OWNER_EMAIL,
  EMAIL_USER:      process.env.EMAIL_USER,
  EMAIL_PASS:      process.env.EMAIL_PASS,
  JWT_SECRET:      process.env.JWT_SECRET || 'fokward_jwt_secret_2026',
  PORT:            process.env.PORT || 3000,
};

// ── SQLite ───────────────────────────────────────────────────
const db = new Database('fokward.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    firstName TEXT NOT NULL,
    lastName  TEXT NOT NULL,
    email     TEXT UNIQUE NOT NULL,
    password  TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now')),
    role      TEXT DEFAULT 'user'
  );
  UPDATE users SET role='admin' WHERE email='peladaster572@gmail.com';

  CREATE TABLE IF NOT EXISTS products (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    data      TEXT NOT NULL,
    updatedAt TEXT DEFAULT (datetime('now'))
  );
`);

// ── Product helpers ───────────────────────────────────────────
function dbGetProducts() {
  const rows = db.prepare('SELECT id, data FROM products ORDER BY id ASC').all();
  return rows.map(r => ({ id: r.id, ...JSON.parse(r.data) }));
}

function dbSaveProduct(data) {
  const { id, ...rest } = data;
  if (id) {
    db.prepare('UPDATE products SET data=?, updatedAt=datetime(\'now\') WHERE id=?')
      .run(JSON.stringify(rest), id);
    return { id, ...rest };
  } else {
    const r = db.prepare('INSERT INTO products (data) VALUES (?)').run(JSON.stringify(rest));
    return { id: r.lastInsertRowid, ...rest };
  }
}

function dbDeleteProduct(id) {
  db.prepare('DELETE FROM products WHERE id=?').run(id);
}

function dbInitProducts(defaultProducts) {
  const count = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  if (count === 0) {
    // Seed with default products from frontend
    const insert = db.prepare('INSERT INTO products (id, data) VALUES (?, ?)');
    const insertMany = db.transaction((prods) => {
      for (const p of prods) {
        const { id, ...rest } = p;
        insert.run(id, JSON.stringify(rest));
      }
    });
    insertMany(defaultProducts);
    console.log('✅ Productos inicializados en DB:', defaultProducts.length);
  }
}

// ── MercadoPago ──────────────────────────────────────────────
const mp = new MercadoPagoConfig({ accessToken: CONFIG.MP_ACCESS_TOKEN });

// ── Nodemailer ───────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: CONFIG.EMAIL_USER, pass: CONFIG.EMAIL_PASS },
});

// ── Auth middleware ──────────────────────────────────────────
function auth(req, res, next) {
  const token = (req.headers['authorization'] || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try { req.user = jwt.verify(token, CONFIG.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token inválido' }); }
}

// ── REGISTER ─────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { firstName, lastName, email, password } = req.body;
  if (!firstName || !lastName || !email || !password)
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  if (password.length < 6)
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  try {
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email))
      return res.status(400).json({ error: 'El email ya está registrado' });
    const hash = await bcrypt.hash(password, 10);
    const r = db.prepare('INSERT INTO users (firstName,lastName,email,password) VALUES (?,?,?,?)').run(firstName,lastName,email,hash);
    const role  = email === 'peladaster572@gmail.com' ? 'admin' : 'user';
    if (role === 'admin') db.prepare("UPDATE users SET role='admin' WHERE id=?").run(r.lastInsertRowid);
    const token = jwt.sign({ id:r.lastInsertRowid, email, firstName, lastName, role }, CONFIG.JWT_SECRET, { expiresIn:'30d' });
    res.json({ token, user:{ id:r.lastInsertRowid, firstName, lastName, email, role } });

  } catch(e) { console.error(e); res.status(500).json({ error:'Error al registrar' }); }
});

// ── LOGIN ────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error:'Campos requeridos' });
  try {
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(400).json({ error:'Email o contraseña incorrectos' });
    const token = jwt.sign({ id:user.id, email:user.email, firstName:user.firstName, lastName:user.lastName, role:user.role||'user' }, CONFIG.JWT_SECRET, { expiresIn:'30d' });
    res.json({ token, user:{ id:user.id, firstName:user.firstName, lastName:user.lastName, email:user.email, role:user.role||'user' } });
  } catch(e) { console.error(e); res.status(500).json({ error:'Error al iniciar sesión' }); }
});

// ── GET PROFILE ──────────────────────────────────────────────
app.get('/api/auth/profile', auth, (req, res) => {
  const user = db.prepare('SELECT id,firstName,lastName,email,createdAt FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error:'Usuario no encontrado' });
  res.json({ user });
});

// ── UPDATE PROFILE ───────────────────────────────────────────
app.put('/api/auth/profile', auth, async (req, res) => {
  const { firstName, lastName, email, currentPassword, newPassword } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error:'Usuario no encontrado' });
  try {
    let passwordField = user.password;
    if (newPassword) {
      if (!currentPassword) return res.status(400).json({ error:'Ingresá tu contraseña actual' });
      if (!(await bcrypt.compare(currentPassword, user.password))) return res.status(400).json({ error:'Contraseña actual incorrecta' });
      if (newPassword.length < 6) return res.status(400).json({ error:'Mínimo 6 caracteres' });
      passwordField = await bcrypt.hash(newPassword, 10);
    }
    if (email && email !== user.email && db.prepare('SELECT id FROM users WHERE email=? AND id!=?').get(email, user.id))
      return res.status(400).json({ error:'Email ya en uso' });
    db.prepare('UPDATE users SET firstName=?,lastName=?,email=?,password=? WHERE id=?')
      .run(firstName||user.firstName, lastName||user.lastName, email||user.email, passwordField, user.id);
    const updated = db.prepare('SELECT id,firstName,lastName,email,createdAt FROM users WHERE id=?').get(user.id);
    const token = jwt.sign({ id:updated.id, email:updated.email, firstName:updated.firstName, lastName:updated.lastName }, CONFIG.JWT_SECRET, { expiresIn:'30d' });
    res.json({ user:updated, token });
  } catch(e) { console.error(e); res.status(500).json({ error:'Error al actualizar' }); }
});

// ── MERCADOPAGO ──────────────────────────────────────────────
const pendingOrders = {};
app.post('/api/create-preference', async (req, res) => {
  const { customer, address, shipping, items, total } = req.body;
  try {
    const preference = new Preference(mp);
    const mpItems = [
      ...items.map(item => ({ id:String(item.id), title:`${item.name} — ${item.size}/${item.color}`, quantity:item.qty, unit_price:item.price, currency_id:'ARS' })),
      { id:'shipping', title:`Envío ${shipping.carrier.toUpperCase()}`, quantity:1, unit_price:shipping.price, currency_id:'ARS' }
    ];
    const result = await preference.create({ body:{
      items: mpItems,
      payer:{ name:customer.firstName, surname:customer.lastName, email:customer.email,
        phone:{ area_code:'54', number:customer.phone },
        identification:{ type:'DNI', number:customer.dni },
        address:{ street_name:address.street, street_number:parseInt(address.number), zip_code:address.postalCode } },
      back_urls:{ success:`${CONFIG.STORE_URL}/?status=approved`, failure:`${CONFIG.STORE_URL}/?status=failure`, pending:`${CONFIG.STORE_URL}/?status=pending` },
      auto_return:'approved',
      notification_url:`${CONFIG.STORE_URL}/api/webhook`,
      metadata:{ customer, address, shipping, items, total },
      statement_descriptor:'FOKWARD STW',
    }});
    pendingOrders[result.id] = { customer, address, shipping, items, total };
    res.json({ init_point:result.init_point, preference_id:result.id });
  } catch(e) { console.error('Error MP:',e); res.status(500).json({ error:e.message }); }
});

// ── WEBHOOK ──────────────────────────────────────────────────
app.post('/api/webhook', async (req, res) => {
  res.sendStatus(200);
  if (req.body.type !== 'payment') return;
  try {
    const payment = new Payment(mp);
    const pd = await payment.get({ id:req.body.data.id });
    if (pd.status !== 'approved') return;
    const order = pendingOrders[pd.preference_id] || pd.metadata;
    if (!order) return;
    await sendSaleNotification(pd, order);
    await sendClientConfirmation(order, pd.id);
    delete pendingOrders[pd.preference_id];
  } catch(e) { console.error('Webhook error:',e); }
});

// ── EMAILS ───────────────────────────────────────────────────
const fp = n => '$' + Number(n).toLocaleString('es-AR');

async function sendSaleNotification(payment, order) {
  const { customer, address, shipping, items, total } = order;
  await transporter.sendMail({
    from:`"FOKWARD Store" <${CONFIG.EMAIL_USER}>`,
    to: CONFIG.OWNER_EMAIL,
    subject:`✅ Nueva venta — ${customer.firstName} ${customer.lastName} — ${fp(total)}`,
    html:`<div style="font-family:Arial;max-width:600px;margin:0 auto;">
      <div style="background:#2c1a0e;padding:24px;text-align:center;"><h1 style="color:white;font-size:32px;letter-spacing:3px;margin:0;">FOKWARD<span style="color:#e07b2a;">.</span>STW</h1><p style="color:#e07b2a;margin:6px 0 0;text-transform:uppercase;font-size:12px;letter-spacing:2px;">Nueva venta ✅</p></div>
      <div style="padding:24px;background:#f5efe8;">
        <h3 style="color:#3d2510;">👤 Cliente</h3>
        <p><b>Nombre:</b> ${customer.firstName} ${customer.lastName}<br><b>DNI:</b> ${customer.dni}<br><b>Email:</b> ${customer.email}<br><b>Tel/WA:</b> ${customer.phone}</p>
        <h3 style="color:#3d2510;">📦 Dirección de envío</h3>
        <p>${address.street} ${address.number}${address.apartment?', '+address.apartment:''}<br>${address.city}, ${address.province} — CP ${address.postalCode}<br><b>Transporte:</b> ${shipping.carrier.toUpperCase()} — ${fp(shipping.price)}</p>
        <h3 style="color:#3d2510;">🛍️ Productos</h3>
        ${items.map(i=>`<div style="padding:8px 0;border-bottom:1px solid #ddd;"><b>${i.name}</b> — Talle ${i.size} / ${i.color} x${i.qty} — <b style="color:#e07b2a;">${fp(i.price*i.qty)}</b></div>`).join('')}
        <div style="margin-top:20px;background:#1a0e07;padding:20px;text-align:center;"><p style="color:#a89080;margin:0;font-size:12px;">TOTAL COBRADO</p><p style="color:#e07b2a;font-size:32px;font-weight:bold;margin:4px 0;">${fp(total)}</p><p style="color:#a89080;font-size:11px;margin:0;">ID MercadoPago: ${payment.id}</p></div>
      </div></div>`
  });
}

async function sendClientConfirmation(order, paymentId) {
  const { customer, items, shipping, total } = order;
  await transporter.sendMail({
    from:`"FOKWARD Store" <${CONFIG.EMAIL_USER}>`,
    to: customer.email,
    subject:`Confirmación de compra — FOKWARD.STW`,
    html:`<div style="font-family:Arial;max-width:600px;margin:0 auto;">
      <div style="background:#2c1a0e;padding:24px;text-align:center;"><h1 style="color:white;font-size:32px;letter-spacing:3px;margin:0;">FOKWARD<span style="color:#e07b2a;">.</span>STW</h1></div>
      <div style="padding:24px;background:#f5efe8;">
        <h2 style="color:#e07b2a;">¡Gracias por tu compra, ${customer.firstName}!</h2>
        <p>Recibimos tu pedido. Te contactamos por WhatsApp al <b>${customer.phone}</b>.</p>
        ${items.map(i=>`<div style="padding:8px 0;border-bottom:1px solid #ddd;"><b>${i.name}</b> — ${i.size}/${i.color} x${i.qty} — ${fp(i.price*i.qty)}</div>`).join('')}
        <p style="margin-top:12px;">Envío ${shipping.carrier.toUpperCase()}: ${fp(shipping.price)}<br><b>Total: ${fp(total)}</b></p>
        <p style="font-size:11px;color:#888;">N° pago: ${paymentId}</p>
      </div></div>`
  });
}


// ── Admin middleware ──────────────────────────────────────────
function adminAuth(req, res, next) {
  const token = (req.headers['authorization'] || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    const user = jwt.verify(token, CONFIG.JWT_SECRET);
    if (user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos de admin' });
    req.user = user;
    next();
  } catch { res.status(401).json({ error: 'Token inválido' }); }
}

// ── PRODUCTS API ─────────────────────────────────────────────

// GET all products (public) — frontend loads these on start
app.get('/api/products', (req, res) => {
  try {
    res.json(dbGetProducts());
  } catch(e) { console.error(e); res.status(500).json({ error: 'Error cargando productos' }); }
});

// INIT products from frontend defaults (called once on first load)
app.post('/api/products/init', (req, res) => {
  try {
    dbInitProducts(req.body);
    res.json({ ok: true, count: dbGetProducts().length });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// CREATE product (admin)
app.post('/api/admin/products', adminAuth, (req, res) => {
  try {
    const product = dbSaveProduct(req.body);
    res.json(product);
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// UPDATE product (admin)
app.put('/api/admin/products/:id', adminAuth, (req, res) => {
  try {
    const product = dbSaveProduct({ ...req.body, id: parseInt(req.params.id) });
    res.json(product);
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// DELETE product (admin)
app.delete('/api/admin/products/:id', adminAuth, (req, res) => {
  try {
    dbDeleteProduct(parseInt(req.params.id));
    res.json({ ok: true });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// GET all users (admin)
app.get('/api/admin/users', adminAuth, (req, res) => {
  const users = db.prepare('SELECT id, firstName, lastName, email, role, createdAt FROM users ORDER BY createdAt DESC').all();
  res.json(users);
});

app.listen(CONFIG.PORT, () => console.log(`🚀 FOKWARD Store en http://localhost:${CONFIG.PORT}`));
