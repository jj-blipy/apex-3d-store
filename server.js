require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, "db.json");

app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 250
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

function createDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({
      visitors: 0,
      cartsOpened: 0,
      users: [],
      orders: [],
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
          description: "Send a custom 3D print idea and describe the size, color, and design you want.",
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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

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

/* CUSTOMER SIGNUP / LOGIN */

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

  const passwordHash = await bcrypt.hash(password, 12);

  const user = {
    id: Date.now(),
    username,
    email,
    phone,
    passwordHash,
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
  req.session.destroy(() => {
    res.json({ ok: true });
  });
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
      phone: user.phone
    }
  });
});

/* ADMIN LOGIN */

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body;

  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Wrong admin password" });
  }

  req.session.admin = true;
  res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  req.session.admin = false;
  res.json({ ok: true });
});

/* PRODUCTS */

app.get("/api/products", (req, res) => {
  const db = loadDB();

  const products = db.products.map(p => ({
    ...p,
    finalPrice: finalPrice(p)
  }));

  res.json(products);
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

  res.json(products.map(p => ({
    ...p,
    finalPrice: finalPrice(p)
  })));
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

/* ORDERS */

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
    cart
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
    cart: cleanCart,
    total: total.toFixed(2),
    status: "Processing",
    paidWith: "PayPal",
    date: new Date().toLocaleString()
  };

  db.orders.push(order);
  saveDB(db);

  const emailText = `
New Apex 3D Creations Order

Order Number: ${order.id}
Status: ${order.status}

Customer:
${name}
${phone}
${email}

Shipping:
${streetAddress}
${city}, ${state} ${zip}

Notes:
${notes || "None"}

Items:
${cleanCart.map(i => `${i.name} x ${i.qty} - $${i.price}`).join("\n")}

Total: $${order.total}
PayPal: ${process.env.PAYPAL_LINK}
`;

  try {
    await sendEmail({
      to: process.env.OWNER_EMAIL,
      subject: `New Apex Order ${order.id}`,
      text: emailText
    });

    await sendEmail({
      to: email,
      subject: `Apex 3D Creations Order Confirmation ${order.id}`,
      text: `
Thank you for your order!

Order Number: ${order.id}
Status: Processing
Total: $${order.total}

Finish payment here:
${process.env.PAYPAL_LINK}

You can track your order on the site using your phone number.
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
  const phone = req.params.phone;

  const orders = db.orders
    .filter(o => o.phone === phone)
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

/* REVIEWS */

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

/* ADMIN DATA */

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
    products: db.products.map(p => ({
      ...p,
      finalPrice: finalPrice(p)
    })),
    orders: db.orders,
    users: db.users.map(u => ({
      id: u.id,
      username: u.username,
      email: u.email,
      phone: u.phone,
      createdAt: u.createdAt
    }))
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

app.listen(PORT, () => {
  console.log("Apex 3D Creations running on port " + PORT);
});