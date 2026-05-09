require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const nodemailer = require("nodemailer");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, "db.json");
const UPLOAD_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "10mb" }));
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, "public")));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300
}));

app.use(session({
  secret: process.env.SESSION_SECRET || "change_this_secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false
  }
}));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-z0-9.\-_]/gi, "_");
    cb(null, Date.now() + "-" + safe);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }
});

function createDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({
      visitors: 0,
      cartsOpened: 0,
      users: [],
      orders: [],
      coupons: [
        {
          code: "APEX10",
          discountPercent: 10,
          active: true
        }
      ],
      announcements: [
        {
          text: "Grand opening sale: use code APEX10 for 10% off!",
          active: true
        }
      ],
      products: [
        {
          id: Date.now(),
          name: "Custom 3D Print Request",
          category: "Custom",
          price: 24.99,
          discountPercent: 0,
          onSale: false,
          stock: 10,
          sold: 0,
          image: "https://images.unsplash.com/photo-1631744591853-998c4308bbb0?auto=format&fit=crop&w=1200&q=80",
          model: "https://modelviewer.dev/shared-assets/models/Astronaut.glb",
          description: "Send a custom 3D print idea and describe size, color, and design.",
          reviews: []
        }
      ]
    }, null, 2));
  }
}

function loadDB() {
  createDB();
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function finalPrice(product) {
  if (!product.onSale || !product.discountPercent) return Number(product.price);
  return Number(product.price) * (1 - Number(product.discountPercent) / 100);
}

function requireAdmin(req, res, next) {
  if (req.session?.admin === true) return next();
  return res.status(401).json({ error: "Admin login required" });
}

function requireUser(req, res, next) {
  if (req.session?.userId) return next();
  return res.status(401).json({ error: "Customer login required" });
}

async function sendEmail({ to, subject, text }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject,
    text
  });
}

/* Pages */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/admin", (req, res) => {
  res.redirect("/apex-owner-portal.html");
});

/* Site analytics */

app.post("/api/visit", (req, res) => {
  const db = loadDB();
  db.visitors++;
  saveDB(db);
  res.json({ ok: true });
});

app.post("/api/cart-opened", (req, res) => {
  const db = loadDB();
  db.cartsOpened++;
  saveDB(db);
  res.json({ ok: true });
});

/* Customer accounts */

app.post("/api/auth/signup", async (req, res) => {
  const db = loadDB();
  const { username, email, phone, password } = req.body;

  if (!username || !email || !phone || !password) {
    return res.status(400).json({ error: "Missing signup information" });
  }

  const existing = db.users.find(u =>
    u.email.toLowerCase() === email.toLowerCase() ||
    u.username.toLowerCase() === username.toLowerCase()
  );

  if (existing) {
    return res.status(400).json({ error: "Username or email already exists" });
  }

  const user = {
    id: Date.now(),
    username,
    email,
    phone,
    passwordHash: await bcrypt.hash(password, 12),
    verified: false,
    favorites: [],
    createdAt: new Date().toLocaleString()
  };

  db.users.push(user);
  saveDB(db);
  req.session.userId = user.id;

  res.json({
    ok: true,
    user: {
      username: user.username,
      email: user.email,
      phone: user.phone
    }
  });
});

app.post("/api/auth/login", async (req, res) => {
  const db = loadDB();
  const { emailOrUsername, password } = req.body;

  const user = db.users.find(u =>
    u.email.toLowerCase() === String(emailOrUsername).toLowerCase() ||
    u.username.toLowerCase() === String(emailOrUsername).toLowerCase()
  );

  if (!user) return res.status(401).json({ error: "Wrong login" });

  const good = await bcrypt.compare(password, user.passwordHash);
  if (!good) return res.status(401).json({ error: "Wrong login" });

  req.session.userId = user.id;

  res.json({
    ok: true,
    user: {
      username: user.username,
      email: user.email,
      phone: user.phone
    }
  });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/auth/me", (req, res) => {
  if (!req.session?.userId) return res.json({ loggedIn: false });

  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) return res.json({ loggedIn: false });

  res.json({
    loggedIn: true,
    user: {
      username: user.username,
      email: user.email,
      phone: user.phone,
      favorites: user.favorites || []
    }
  });
});

/* Reset password placeholder */

app.post("/api/auth/request-reset", async (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.email.toLowerCase() === String(req.body.email).toLowerCase());

  if (!user) return res.json({ ok: true });

  user.resetCode = String(Math.floor(100000 + Math.random() * 900000));
  saveDB(db);

  try {
    await sendEmail({
      to: user.email,
      subject: "Apex 3D Creations password reset",
      text: `Your reset code is: ${user.resetCode}`
    });
  } catch (err) {
    console.log("Reset email failed:", err.message);
  }

  res.json({ ok: true });
});

app.post("/api/auth/reset-password", async (req, res) => {
  const db = loadDB();
  const { email, code, newPassword } = req.body;

  const user = db.users.find(u =>
    u.email.toLowerCase() === String(email).toLowerCase() &&
    u.resetCode === String(code)
  );

  if (!user) return res.status(400).json({ error: "Invalid reset code" });

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  delete user.resetCode;
  saveDB(db);

  res.json({ ok: true });
});

/* Admin login */

app.post("/api/admin/login", (req, res) => {
  if (req.body.password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Wrong admin password" });
  }

  req.session.admin = true;
  res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  req.session.admin = false;
  res.json({ ok: true });
});

/* Product uploads */

app.post("/api/admin/upload-image", requireAdmin, upload.single("image"), (req, res) => {
  res.json({
    ok: true,
    url: "/uploads/" + req.file.filename
  });
});

app.post("/api/upload-stl", upload.single("stl"), (req, res) => {
  res.json({
    ok: true,
    url: "/uploads/" + req.file.filename
  });
});

/* Products */

app.get("/api/products", (req, res) => {
  const db = loadDB();
  res.json(db.products.map(p => ({ ...p, finalPrice: finalPrice(p) })));
});

app.get("/api/products/search", (req, res) => {
  const db = loadDB();
  const q = String(req.query.q || "").toLowerCase();
  const category = String(req.query.category || "").toLowerCase();

  let products = db.products;

  if (q) {
    products = products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q)
    );
  }

  if (category) {
    products = products.filter(p => p.category.toLowerCase() === category);
  }

  res.json(products.map(p => ({ ...p, finalPrice: finalPrice(p) })));
});

app.get("/api/recommendations", (req, res) => {
  const db = loadDB();
  const products = [...db.products]
    .sort((a, b) => Number(b.sold || 0) - Number(a.sold || 0))
    .slice(0, 4)
    .map(p => ({ ...p, finalPrice: finalPrice(p) }));

  res.json(products);
});

app.post("/api/admin/products", requireAdmin, (req, res) => {
  const db = loadDB();

  const product = {
    id: Date.now(),
    name: req.body.name,
    category: req.body.category || "General",
    price: Number(req.body.price),
    discountPercent: Number(req.body.discountPercent || 0),
    onSale: Boolean(req.body.onSale),
    stock: Number(req.body.stock || 0),
    sold: 0,
    image: req.body.image || "https://via.placeholder.com/1200x800?text=Apex+3D+Product",
    model: req.body.model || "https://modelviewer.dev/shared-assets/models/Astronaut.glb",
    description: req.body.description || "",
    reviews: []
  };

  if (!product.name || !product.price) {
    return res.status(400).json({ error: "Product name and price required" });
  }

  db.products.push(product);
  saveDB(db);

  res.json({ ok: true, product });
});

app.put("/api/admin/products/:id", requireAdmin, (req, res) => {
  const db = loadDB();
  const product = db.products.find(p => p.id === Number(req.params.id));

  if (!product) return res.status(404).json({ error: "Product not found" });

  product.name = req.body.name ?? product.name;
  product.category = req.body.category ?? product.category;
  product.price = Number(req.body.price ?? product.price);
  product.discountPercent = Number(req.body.discountPercent ?? product.discountPercent);
  product.onSale = Boolean(req.body.onSale);
  product.stock = Number(req.body.stock ?? product.stock);
  product.image = req.body.image ?? product.image;
  product.model = req.body.model ?? product.model;
  product.description = req.body.description ?? product.description;

  saveDB(db);
  res.json({ ok: true, product });
});

app.delete("/api/admin/products/:id", requireAdmin, (req, res) => {
  const db = loadDB();
  db.products = db.products.filter(p => p.id !== Number(req.params.id));
  saveDB(db);
  res.json({ ok: true });
});

/* Wishlist */

app.post("/api/wishlist/:productId", requireUser, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.userId);
  const productId = Number(req.params.productId);

  user.favorites = user.favorites || [];

  if (user.favorites.includes(productId)) {
    user.favorites = user.favorites.filter(id => id !== productId);
  } else {
    user.favorites.push(productId);
  }

  saveDB(db);
  res.json({ ok: true, favorites: user.favorites });
});

app.get("/api/wishlist", requireUser, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.userId);
  const favorites = user.favorites || [];

  const products = db.products
    .filter(p => favorites.includes(p.id))
    .map(p => ({ ...p, finalPrice: finalPrice(p) }));

  res.json(products);
});

/* Coupons */

app.get("/api/announcements", (req, res) => {
  const db = loadDB();
  res.json(db.announcements.filter(a => a.active));
});

app.post("/api/coupon/check", (req, res) => {
  const db = loadDB();
  const code = String(req.body.code || "").toUpperCase();

  const coupon = db.coupons.find(c => c.code.toUpperCase() === code && c.active);
  if (!coupon) return res.status(404).json({ error: "Invalid coupon" });

  res.json({ ok: true, coupon });
});

app.post("/api/admin/coupons", requireAdmin, (req, res) => {
  const db = loadDB();

  db.coupons.push({
    code: String(req.body.code || "").toUpperCase(),
    discountPercent: Number(req.body.discountPercent || 0),
    active: true
  });

  saveDB(db);
  res.json({ ok: true });
});

app.post("/api/admin/announcements", requireAdmin, (req, res) => {
  const db = loadDB();

  db.announcements.push({
    text: req.body.text,
    active: true
  });

  saveDB(db);
  res.json({ ok: true });
});

/* Orders */

app.post("/api/order", async (req, res) => {
  const db = loadDB();

  const {
    name,
    phone,
    email,
    streetAddress,
    city,
    state,
    zip,
    notes,
    cart,
    stlUrl,
    couponCode
  } = req.body;

  if (!name || !phone || !email || !streetAddress || !city || !state || !zip) {
    return res.status(400).json({ error: "Missing customer information" });
  }

  if (!cart || !Array.isArray(cart) || cart.length === 0) {
    return res.status(400).json({ error: "Cart is empty" });
  }

  let cleanCart = [];
  let total = 0;

  for (const item of cart) {
    const product = db.products.find(p => p.id === Number(item.id));
    if (!product) continue;

    const qty = Math.max(1, Number(item.qty || 1));
    const price = finalPrice(product);

    cleanCart.push({
      id: product.id,
      name: product.name,
      price: price.toFixed(2),
      qty
    });

    total += price * qty;
    product.stock = Math.max(0, Number(product.stock) - qty);
    product.sold = Number(product.sold || 0) + qty;
  }

  let couponDiscount = 0;

  if (couponCode) {
    const coupon = db.coupons.find(c =>
      c.code.toUpperCase() === String(couponCode).toUpperCase() &&
      c.active
    );

    if (coupon) {
      couponDiscount = Number(coupon.discountPercent);
      total = total * (1 - couponDiscount / 100);
    }
  }

  const order = {
    id: "APEX-" + Date.now(),
    userId: req.session?.userId || null,
    name,
    phone,
    email,
    streetAddress,
    city,
    state,
    zip,
    notes: notes || "",
    stlUrl: stlUrl || "",
    couponCode: couponCode || "",
    couponDiscount,
    cart: cleanCart,
    total: total.toFixed(2),
    status: "Processing",
    paidWith: "PayPal",
    date: new Date().toLocaleString()
  };

  db.orders.push(order);
  saveDB(db);

  try {
    await sendEmail({
      to: process.env.OWNER_EMAIL,
      subject: `New Apex Order ${order.id}`,
      text: `
New Apex Order

Order: ${order.id}
Customer: ${name}
Phone: ${phone}
Email: ${email}

Address:
${streetAddress}
${city}, ${state} ${zip}

Items:
${cleanCart.map(i => `${i.name} x ${i.qty} - $${i.price}`).join("\n")}

Coupon: ${couponCode || "None"}
STL Upload: ${stlUrl || "None"}
Total: $${order.total}
PayPal: ${process.env.PAYPAL_LINK}
`
    });

    await sendEmail({
      to: email,
      subject: `Apex 3D Creations Order ${order.id}`,
      text: `
Thanks for your order!

Order Number: ${order.id}
Status: Processing
Total: $${order.total}

Finish payment here:
${process.env.PAYPAL_LINK}
`
    });
  } catch (err) {
    console.log("Email failed:", err.message);
  }

  res.json({
    ok: true,
    orderId: order.id,
    paypal: process.env.PAYPAL_LINK
  });
});

app.get("/api/orders/:phone", (req, res) => {
  const db = loadDB();
  const orders = db.orders
    .filter(o => o.phone === req.params.phone)
    .map(o => ({
      id: o.id,
      total: o.total,
      status: o.status,
      cart: o.cart,
      date: o.date,
      city: o.city,
      state: o.state
    }));

  res.json(orders);
});

app.get("/api/customer/orders", requireUser, (req, res) => {
  const db = loadDB();

  const orders = db.orders
    .filter(o => o.userId === req.session.userId)
    .map(o => ({
      id: o.id,
      total: o.total,
      status: o.status,
      cart: o.cart,
      date: o.date
    }));

  res.json(orders);
});

/* Reviews */

app.post("/api/review", (req, res) => {
  const db = loadDB();
  const product = db.products.find(p => p.id === Number(req.body.productId));

  if (!product) return res.status(404).json({ error: "Product not found" });

  product.reviews.push({
    name: req.body.name || "Customer",
    rating: Number(req.body.rating || 5),
    text: req.body.text || "",
    date: new Date().toLocaleString()
  });

  saveDB(db);
  res.json({ ok: true });
});

/* Chatbot */

app.post("/api/chat", async (req, res) => {
  const message = String(req.body.message || "");

  if (!message) return res.status(400).json({ error: "Message required" });

  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.includes("your_")) {
    return res.json({
      ok: true,
      answer: "I can help with custom prints, orders, sales, PayPal checkout, STL uploads, and product recommendations."
    });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: "You are Apex 3D Creations customer support. Help customers pick 3D printed products, understand checkout, order tracking, custom print notes, STL uploads, and sales. Be short and helpful."
        },
        {
          role: "user",
          content: message
        }
      ]
    });

    res.json({
      ok: true,
      answer: completion.choices[0].message.content
    });
  } catch (err) {
    res.json({
      ok: true,
      answer: "The AI helper is having trouble right now, but I can still help with products, orders, checkout, and custom prints."
    });
  }
});

/* Admin data */

app.get("/api/admin/analytics", requireAdmin, (req, res) => {
  const db = loadDB();

  const revenue = db.orders.reduce((sum, order) => {
    return sum + Number(order.total || 0);
  }, 0);

  res.json({
    visitors: db.visitors,
    cartsOpened: db.cartsOpened,
    totalOrders: db.orders.length,
    totalUsers: db.users.length,
    revenue,
    products: db.products.map(p => ({ ...p, finalPrice: finalPrice(p) })),
    orders: db.orders,
    users: db.users.map(u => ({
      id: u.id,
      username: u.username,
      email: u.email,
      phone: u.phone,
      verified: u.verified,
      createdAt: u.createdAt
    })),
    coupons: db.coupons,
    announcements: db.announcements
  });
});

app.post("/api/admin/order-status", requireAdmin, (req, res) => {
  const db = loadDB();
  const order = db.orders.find(o => o.id === req.body.id);

  if (!order) return res.status(404).json({ error: "Order not found" });

  order.status = req.body.status;
  saveDB(db);

  res.json({ ok: true });
});

/* PayPal API placeholder */

app.post("/api/paypal/create-order", async (req, res) => {
  return res.json({
    ok: false,
    message: "PayPal API checkout is prepared, but you still need real PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET. Current checkout uses your PayPal.me link."
  });
});

/* Shipping label placeholder */

app.post("/api/admin/shipping-label", requireAdmin, (req, res) => {
  res.json({
    ok: false,
    message: "Shipping labels need a carrier API like Shippo, EasyPost, USPS, UPS, or FedEx."
  });
});

app.listen(PORT, () => {
  console.log("Apex 3D Creations running on port " + PORT);
});