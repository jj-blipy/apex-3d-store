require("dotenv").config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const sqlite3 = require("sqlite3").verbose();
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const multer = require("multer");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "10mb" }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 700 }));

app.use(session({
  secret: process.env.SESSION_SECRET || "CHANGE_THIS_SECRET",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: false, sameSite: "lax", maxAge: 86400000 }
}));

app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.static(path.join(__dirname, "public")));

const db = new sqlite3.Database("apex_store.db");

// PUT YOUR REAL ADMIN HASH HERE
const HASHED_ADMIN_PASSWORD = "$2b$10$ElpZ7x8BjRSPVY8FZ5fEkutTijSgRJgJKP3bSp4XE746gJnxMhiK6";

function requireAdmin(req, res, next) {
  if (!req.session.admin) return res.status(403).json({ message: "Admin only" });
  next();
}

function requireCustomer(req, res, next) {
  if (!req.session.userId) return res.status(403).json({ message: "Customer login required" });
  next();
}

function addColumn(table, column, type) {
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`, () => {});
}

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    contact TEXT UNIQUE NOT NULL,
    phone TEXT,
    password TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    description TEXT,
    category TEXT,
    stock INTEGER DEFAULT 999,
    image_url TEXT,
    colors TEXT,
    materials TEXT,
    badge TEXT,
    featured INTEGER DEFAULT 0,
    best_seller INTEGER DEFAULT 0,
    trending INTEGER DEFAULT 0,
    limited INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    phone TEXT,
    items TEXT NOT NULL,
    total REAL NOT NULL,
    status TEXT DEFAULT 'Pending',
    payment_status TEXT DEFAULT 'Awaiting PayPal Payment',
    tracking_number TEXT,
    carrier TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  addColumn("users", "phone", "TEXT");
  addColumn("orders", "phone", "TEXT");
});

app.post("/admin-login", async (req, res) => {
  const match = await bcrypt.compare(req.body.password || "", HASHED_ADMIN_PASSWORD);
  if (!match) return res.status(401).json({ message: "Wrong password" });

  req.session.admin = true;
  res.json({ success: true });
});

app.post("/signup", async (req, res) => {
  const { username, contact, phone, password } = req.body;

  if (!username || !contact || !phone || !password) {
    return res.status(400).json({ message: "Username, email/phone, phone number, and password required" });
  }

  const hashed = await bcrypt.hash(password, 10);

  db.run(
    "INSERT INTO users (username, contact, phone, password) VALUES (?, ?, ?, ?)",
    [username.trim(), contact.trim().toLowerCase(), phone.trim(), hashed],
    function(err) {
      if (err) return res.status(400).json({ message: "Account already exists" });

      req.session.userId = this.lastID;
      res.json({ success: true });
    }
  );
});

app.post("/login", (req, res) => {
  const { contact, password } = req.body;

  db.get("SELECT * FROM users WHERE contact = ?", [contact.trim().toLowerCase()], async (err, user) => {
    if (err || !user) return res.status(401).json({ message: "Account not found" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: "Wrong password" });

    req.session.userId = user.id;
    res.json({ success: true });
  });
});

app.get("/me", (req, res) => {
  if (!req.session.userId) {
    return res.json({ admin: !!req.session.admin, customer: false, user: null });
  }

  db.get(
    "SELECT id, username, contact, phone FROM users WHERE id = ?",
    [req.session.userId],
    (err, user) => {
      res.json({ admin: !!req.session.admin, customer: !!user, user });
    }
  );
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get("/products", (req, res) => {
  db.all(
    "SELECT * FROM products WHERE active IS NULL OR active = 1 ORDER BY id DESC",
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ message: err.message });
      res.json(rows);
    }
  );
});

app.post("/admin/products", requireAdmin, upload.single("image"), (req, res) => {
  const imageUrl = req.file ? "/uploads/" + req.file.filename : "";

  db.run(
    `INSERT INTO products 
    (name, price, description, category, stock, image_url, colors, materials, badge, featured, best_seller, trending, limited, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      req.body.name,
      Number(req.body.price),
      req.body.description || "",
      req.body.category || "Other",
      Number(req.body.stock || 0),
      imageUrl,
      req.body.colors || "",
      req.body.materials || "",
      req.body.badge || "",
      req.body.featured ? 1 : 0,
      req.body.best_seller ? 1 : 0,
      req.body.trending ? 1 : 0,
      req.body.limited ? 1 : 0
    ],
    function(err) {
      if (err) return res.status(500).json({ message: err.message });

      res.json({ success: true, id: this.lastID });
    }
  );
});

app.delete("/admin/products/:id", requireAdmin, (req, res) => {
  db.run(
    "UPDATE products SET active = 0 WHERE id = ?",
    [req.params.id],
    err => {
      if (err) return res.status(500).json({ message: "Could not remove product" });
      res.json({ success: true });
    }
  );
});

app.post("/create-checkout", (req, res) => {
  const { cart, name, address, phone } = req.body;

  if (!cart || cart.length === 0) return res.status(400).json({ message: "Cart empty" });
  if (!name || !address || !phone) return res.status(400).json({ message: "Name, address, and phone required" });

  let total = 0;
  cart.forEach(item => total += Number(item.price));

  const userId = req.session.userId || null;

  db.get("SELECT username FROM users WHERE id = ?", [userId], (err, user) => {
    db.run(
      `INSERT INTO orders 
      (user_id, username, name, address, phone, items, total, payment_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        user?.username || name,
        name,
        address,
        phone,
        JSON.stringify(cart),
        total.toFixed(2),
        "Awaiting PayPal Payment"
      ],
      function(err) {
        if (err) return res.status(500).json({ message: "Could not save order" });

        res.json({
          success: true,
          orderId: this.lastID,
          total: total.toFixed(2),
          paypalUrl: process.env.PAYPAL_LINK
        });
      }
    );
  });
});

app.get("/my-orders", requireCustomer, (req, res) => {
  db.all("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC", [req.session.userId], (err, rows) => {
    res.json((rows || []).map(o => ({ ...o, items: JSON.parse(o.items || "[]") })));
  });
});

app.get("/orders", requireAdmin, (req, res) => {
  db.all("SELECT * FROM orders ORDER BY created_at DESC", [], (err, rows) => {
    res.json((rows || []).map(o => ({ ...o, items: JSON.parse(o.items || "[]") })));
  });
});

app.get("/admin/stats", requireAdmin, (req, res) => {
  db.get("SELECT COUNT(*) AS orders, SUM(total) AS revenue FROM orders", (err, stats) => {
    db.get("SELECT COUNT(*) AS customers FROM users", (err2, customers) => {
      db.get("SELECT COUNT(*) AS products FROM products WHERE active = 1", (err3, products) => {
        res.json({
          orders: stats?.orders || 0,
          revenue: Number(stats?.revenue || 0).toFixed(2),
          customers: customers?.customers || 0,
          products: products?.products || 0
        });
      });
    });
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "online", business: "Apex 3D Creations" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Apex 3D Creations running on port ${PORT}`);
});