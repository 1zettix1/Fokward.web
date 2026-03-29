// ============================================================
// FOKWARD.STW — Backend Server
// Maneja: MercadoPago, emails de notificación, webhooks
// ============================================================

const express = require('express');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ============================================================
// CONFIGURACIÓN — COMPLETAR CON TUS DATOS
// ============================================================
const CONFIG = {
  // MercadoPago — obtené estas en https://www.mercadopago.com.ar/developers
  MP_ACCESS_TOKEN: 'TU_ACCESS_TOKEN_AQUI',       // APP_USR-...
  MP_PUBLIC_KEY: 'TU_PUBLIC_KEY_AQUI',            // APP_USR-...

  // URL de tu tienda (donde MP va a redirigir al cliente)
  STORE_URL: 'https://TU-DOMINIO.com',

  // Email donde recibís las notificaciones de venta
  OWNER_EMAIL: 'tu@email.com',

  // Configuración del email que envía (Gmail recomendado)
  EMAIL_USER: 'tu@gmail.com',
  EMAIL_PASS: 'tu-contraseña-de-aplicacion-gmail', // No es tu contraseña normal
  // Para obtenerla: Gmail → Seguridad → Verificación en 2 pasos → Contraseñas de app

  PORT: 3000,
};

// ============================================================
// MERCADOPAGO SETUP
// ============================================================
const mp = new MercadoPagoConfig({ accessToken: CONFIG.MP_ACCESS_TOKEN });

// ============================================================
// NODEMAILER SETUP
// ============================================================
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: CONFIG.EMAIL_USER,
    pass: CONFIG.EMAIL_PASS,
  },
});

// ============================================================
// CREAR PREFERENCIA DE PAGO
// POST /api/create-preference
// ============================================================
app.post('/api/create-preference', async (req, res) => {
  const { customer, address, shipping, items, total } = req.body;

  try {
    const preference = new Preference(mp);

    const mpItems = items.map(item => ({
      id: String(item.id),
      title: `${item.name} — Talle: ${item.size} / Color: ${item.color}`,
      quantity: item.qty,
      unit_price: item.price,
      currency_id: 'ARS',
    }));

    // Agregar costo de envío como ítem
    mpItems.push({
      id: 'shipping',
      title: `Envío ${shipping.carrier.toUpperCase()}`,
      quantity: 1,
      unit_price: shipping.price,
      currency_id: 'ARS',
    });

    const preferenceData = {
      items: mpItems,
      payer: {
        name: customer.firstName,
        surname: customer.lastName,
        email: customer.email,
        phone: { area_code: '54', number: customer.phone },
        identification: { type: 'DNI', number: customer.dni },
        address: {
          street_name: address.street,
          street_number: parseInt(address.number),
          zip_code: address.postalCode,
        },
      },
      back_urls: {
        success: `${CONFIG.STORE_URL}/?status=approved`,
        failure: `${CONFIG.STORE_URL}/?status=failure`,
        pending: `${CONFIG.STORE_URL}/?status=pending`,
      },
      auto_return: 'approved',
      notification_url: `${CONFIG.STORE_URL}/api/webhook`,
      metadata: {
        customer,
        address,
        shipping,
        items,
        total,
      },
      statement_descriptor: 'FOKWARD STW',
    };

    const result = await preference.create({ body: preferenceData });

    // Guardar orden en memoria (en producción usá una DB)
    pendingOrders[result.id] = { customer, address, shipping, items, total, preferenceId: result.id };

    res.json({ init_point: result.init_point, preference_id: result.id });

  } catch (err) {
    console.error('Error creando preferencia MP:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// WEBHOOK DE MERCADOPAGO
// POST /api/webhook
// ============================================================
const pendingOrders = {}; // En producción: reemplazar con base de datos

app.post('/api/webhook', async (req, res) => {
  res.sendStatus(200); // Responder rápido a MP

  const { type, data } = req.body;
  if (type !== 'payment') return;

  try {
    const payment = new Payment(mp);
    const paymentData = await payment.get({ id: data.id });

    if (paymentData.status !== 'approved') return;

    // Recuperar datos de la orden
    const order = pendingOrders[paymentData.preference_id] || paymentData.metadata;
    if (!order) return;

    // Enviar email de notificación al dueño
    await sendSaleNotification(paymentData, order);

    // Enviar confirmación al cliente
    await sendClientConfirmation(order, paymentData.id);

    // Limpiar orden pendiente
    delete pendingOrders[paymentData.preference_id];

  } catch (err) {
    console.error('Error en webhook:', err);
  }
});

// ============================================================
// EMAIL AL DUEÑO — notificación de venta
// ============================================================
async function sendSaleNotification(payment, order) {
  const { customer, address, shipping, items, total } = order;

  const itemsList = items.map(i =>
    `• ${i.name} — Talle: ${i.size} / Color: ${i.color} — x${i.qty} — ${formatPrice(i.price * i.qty)}`
  ).join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1a0e07; color: white; padding: 0;">
      <div style="background: #2c1a0e; padding: 30px; text-align: center;">
        <h1 style="font-size: 36px; letter-spacing: 4px; margin: 0; color: white;">FOKWARD<span style="color:#e07b2a;">.</span>STW</h1>
        <p style="color: #e07b2a; margin: 8px 0 0; letter-spacing: 2px; text-transform: uppercase; font-size: 13px;">Nueva venta</p>
      </div>
      <div style="padding: 30px; background: #f5efe8; color: #1a0e07;">
        <h2 style="color: #e07b2a; border-bottom: 2px solid #3d2510; padding-bottom: 12px;">✅ ¡Vendiste!</h2>
        
        <h3 style="color: #3d2510; margin-top: 24px;">👤 Datos del cliente</h3>
        <table style="width:100%; border-collapse: collapse;">
          <tr><td style="padding:6px 0; font-weight:bold; width:35%;">Nombre completo:</td><td>${customer.firstName} ${customer.lastName}</td></tr>
          <tr><td style="padding:6px 0; font-weight:bold;">DNI:</td><td>${customer.dni}</td></tr>
          <tr><td style="padding:6px 0; font-weight:bold;">Email:</td><td>${customer.email}</td></tr>
          <tr><td style="padding:6px 0; font-weight:bold;">Teléfono/WhatsApp:</td><td>${customer.phone}</td></tr>
        </table>
        
        <h3 style="color: #3d2510; margin-top: 24px;">📦 Dirección de envío</h3>
        <table style="width:100%; border-collapse: collapse;">
          <tr><td style="padding:6px 0; font-weight:bold; width:35%;">Calle:</td><td>${address.street} ${address.number}${address.apartment ? ', ' + address.apartment : ''}</td></tr>
          <tr><td style="padding:6px 0; font-weight:bold;">Ciudad:</td><td>${address.city}</td></tr>
          <tr><td style="padding:6px 0; font-weight:bold;">Provincia:</td><td>${address.province}</td></tr>
          <tr><td style="padding:6px 0; font-weight:bold;">Código Postal:</td><td>${address.postalCode}</td></tr>
          <tr><td style="padding:6px 0; font-weight:bold;">Transporte:</td><td style="color:#e07b2a; font-weight:bold;">${shipping.carrier.toUpperCase()} — ${formatPrice(shipping.price)}</td></tr>
        </table>
        
        <h3 style="color: #3d2510; margin-top: 24px;">🛍️ Productos vendidos</h3>
        <div style="background: white; padding: 16px; border-left: 4px solid #e07b2a;">
          ${items.map(i => `
            <div style="padding: 8px 0; border-bottom: 1px solid #e0d5cc;">
              <strong>${i.name}</strong><br>
              <span style="color:#5c3820;">Talle: ${i.size} · Color: ${i.color} · Cantidad: ${i.qty}</span><br>
              <span style="color:#e07b2a; font-weight:bold;">${formatPrice(i.price * i.qty)}</span>
            </div>
          `).join('')}
          <div style="margin-top:12px; font-size:12px; color:#888;">Envío ${shipping.carrier.toUpperCase()}: ${formatPrice(shipping.price)}</div>
        </div>
        
        <div style="background: #1a0e07; color: white; padding: 20px; margin-top: 20px; text-align: center;">
          <div style="font-size: 13px; color: #a89080; margin-bottom: 4px;">TOTAL COBRADO</div>
          <div style="font-size: 36px; color: #e07b2a; font-weight: bold;">${formatPrice(total)}</div>
          <div style="font-size: 12px; color: #a89080; margin-top: 4px;">ID de pago MP: ${payment.id}</div>
        </div>
      </div>
      <div style="background: #2c1a0e; padding: 20px; text-align: center;">
        <p style="color: #a89080; font-size: 12px; margin: 0;">FOKWARD.STW · fokward.stw@gmail.com</p>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: `"FOKWARD Store" <${CONFIG.EMAIL_USER}>`,
    to: CONFIG.OWNER_EMAIL,
    subject: `✅ Nueva venta — ${customer.firstName} ${customer.lastName} — ${formatPrice(total)}`,
    html,
    text: `NUEVA VENTA\n\nCliente: ${customer.firstName} ${customer.lastName}\nDNI: ${customer.dni}\nEmail: ${customer.email}\nTel: ${customer.phone}\n\nDirección: ${address.street} ${address.number}, ${address.city}, ${address.province} (CP: ${address.postalCode})\nEnvío: ${shipping.carrier} — ${formatPrice(shipping.price)}\n\nProductos:\n${itemsList}\n\nTOTAL: ${formatPrice(total)}\nID MP: ${payment.id}`,
  });

  console.log(`✅ Email de venta enviado — ${customer.firstName} ${customer.lastName} — ${formatPrice(total)}`);
}

// ============================================================
// EMAIL AL CLIENTE — confirmación de compra
// ============================================================
async function sendClientConfirmation(order, paymentId) {
  const { customer, items, shipping, total } = order;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1a0e07; color: white; padding: 0;">
      <div style="background: #2c1a0e; padding: 30px; text-align: center;">
        <h1 style="font-size: 36px; letter-spacing: 4px; margin: 0; color: white;">FOKWARD<span style="color:#e07b2a;">.</span>STW</h1>
      </div>
      <div style="padding: 30px; background: #f5efe8; color: #1a0e07;">
        <h2 style="color: #e07b2a;">¡Gracias por tu compra, ${customer.firstName}!</h2>
        <p>Recibimos tu pedido y te vamos a contactar por WhatsApp al <strong>${customer.phone}</strong> para coordinar el envío.</p>
        
        <div style="background: white; padding: 16px; border-left: 4px solid #e07b2a; margin: 20px 0;">
          ${items.map(i => `
            <div style="padding: 8px 0; border-bottom: 1px solid #e0d5cc;">
              <strong>${i.name}</strong> — Talle ${i.size} / Color ${i.color} x${i.qty}<br>
              <span style="color:#e07b2a;">${formatPrice(i.price * i.qty)}</span>
            </div>
          `).join('')}
          <div style="margin-top:8px; font-size:13px; color:#888;">Envío ${shipping.carrier.toUpperCase()}: ${formatPrice(shipping.price)}</div>
          <div style="font-size:18px; font-weight:bold; margin-top:8px;">Total: ${formatPrice(total)}</div>
        </div>
        
        <p style="font-size:13px; color:#888;">N° de pago: ${paymentId}</p>
        <p>¿Dudas? Escribinos a nuestro <a href="https://wa.me/541123989195" style="color:#e07b2a;">WhatsApp</a></p>
      </div>
      <div style="background: #2c1a0e; padding: 20px; text-align: center;">
        <p style="color: #a89080; font-size: 12px; margin: 0;">@fokward.stw · @fokward.sbl</p>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: `"FOKWARD Store" <${CONFIG.EMAIL_USER}>`,
    to: customer.email,
    subject: `Confirmación de compra — FOKWARD.STW`,
    html,
  });
}

// ============================================================
// UTILS
// ============================================================
function formatPrice(n) {
  return '$' + Number(n).toLocaleString('es-AR');
}

// ============================================================
// START SERVER
// ============================================================
app.listen(CONFIG.PORT, () => {
  console.log(`🚀 FOKWARD Store corriendo en http://localhost:${CONFIG.PORT}`);
});
