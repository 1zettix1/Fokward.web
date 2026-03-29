# FOKWARD.STW — Tienda Online

## Archivos del proyecto

```
fokward-store/
├── index.html     → La tienda completa (frontend)
├── server.js      → Backend (pagos + emails)
├── package.json   → Dependencias de Node.js
└── README.md      → Esta guía
```

---

## Paso 1 — Completar credenciales en server.js

Abrí `server.js` y completá el objeto `CONFIG`:

```js
const CONFIG = {
  MP_ACCESS_TOKEN: 'APP_USR-...',     // Tu Access Token de MercadoPago
  MP_PUBLIC_KEY:   'APP_USR-...',     // Tu Public Key de MercadoPago
  STORE_URL:       'https://TU-DOMINIO.com',  // URL donde subís la tienda
  OWNER_EMAIL:     'tu@email.com',    // Donde querés recibir las ventas
  EMAIL_USER:      'tu@gmail.com',    // Gmail desde el que se envían los mails
  EMAIL_PASS:      'abcd efgh ijkl',  // Contraseña de app de Gmail (ver abajo)
};
```

### Cómo obtener contraseña de app de Gmail:
1. Ir a myaccount.google.com
2. Seguridad → Verificación en 2 pasos (activarla si no la tenés)
3. Seguridad → Contraseñas de aplicaciones
4. Crear una nueva → copiar las 16 letras → pegar en EMAIL_PASS

### Cómo obtener credenciales de MercadoPago:
1. Ir a mercadopago.com.ar/developers
2. Mis aplicaciones → tu app
3. Credenciales de producción → copiar Access Token y Public Key

---

## Paso 2 — Instalar dependencias

Necesitás tener Node.js instalado (https://nodejs.org).

```bash
cd fokward-store
npm install
```

---

## Paso 3 — Correr el servidor

```bash
npm start
```

La tienda va a estar disponible en http://localhost:3000

---

## Paso 4 — Subir a internet (hosting gratuito)

### Opción A: Railway (recomendado, gratis)
1. Crear cuenta en railway.app
2. New Project → Deploy from GitHub
3. Subí el proyecto a GitHub primero
4. Railway detecta automáticamente Node.js y lo despliega
5. Te da una URL pública (la ponés en STORE_URL del CONFIG)

### Opción B: Render (también gratis)
1. Crear cuenta en render.com
2. New Web Service → conectar con GitHub
3. Start Command: `node server.js`

### Opción C: VPS propio
- Subir archivos por FTP o Git
- Instalar Node.js en el servidor
- Correr `npm install && npm start`
- Usar PM2 para que no se caiga: `pm2 start server.js`

---

## Paso 5 — Configurar dominio (opcional)

Si tenés un dominio propio (ej: fokward.com.ar):
1. En Railway/Render, agregar dominio personalizado
2. Apuntar el DNS de tu dominio a la IP que te dan

---

## Agregar/editar productos

En `index.html`, buscá el array `const products = [...]`.
Cada producto tiene esta estructura:

```js
{
  id: 10,                          // ID único
  name: 'Nombre del producto',     // Nombre
  line: 'stw',                     // 'stw' o 'sbl'
  category: 'buzos',               // 'buzos', 'remeras' o 'accesorios'
  price: 45000,                    // Precio actual en ARS
  oldPrice: 50000,                 // Precio tachado (null si no hay descuento)
  colors: [
    {name:'Negro', hex:'#1a1a1a'},
    {name:'Blanco', hex:'#f0ece5'},
  ],
  sizes: ['S','M','L','XL','XXL'], // [] si no aplica
  featured: true,                  // true = aparece en la home
  desc: 'Descripción del producto.',
  image: null,                     // URL de la imagen o null
}
```

### Para agregar imágenes:
- Subí las fotos a un hosting de imágenes (ej: imgbb.com es gratis)
- Copiá la URL directa de la imagen
- Pegala en el campo `image: 'https://...'`

---

## Actualizar tabla de precios de envío

En `index.html`, buscá `const shippingZones = {...}`.
Podés actualizar los precios y días de entrega por zona en cualquier momento.

---

## Soporte

WhatsApp: +54 11 2398-9195
Instagram: @fokward.stw / @fokward.sbl
