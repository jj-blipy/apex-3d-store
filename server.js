require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, "db.json");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function createDB() {
  if (!fs.existsSync(DB_FILE)) {
    const starter = {
      visitors: 0,
      cartsOpened: 0,
      products: [
        {
          id: 1,
          name: "Custom 3D Print Request",
          price: 24.99,
          stock: 10,
          sold: 0,
          image: "https://images.unsplash.com/photo-1631744591853-998c4308bbb0?auto=format&fit=crop&w=1200&q=80",
          model: "https://modelviewer.dev/shared-assets/models/Astronaut.glb",
          description: "Send a custom 3D print idea and describe the size, color, and design you want.",
          reviews: []
        },
        {
          id: 2,
          name: "Dragon Figure",
          price: 14.99,
          stock: 8,
          sold: 0,
          image: "https://images.unsplash.com/photo-1614064641938-3bbee52942c7?auto=format&fit=crop&w=1200&q=80",
          model: "https://modelviewer.dev/shared-assets/models/RobotExpressive.glb",
          description: "A detailed decorative 3D printed figure for desks, shelves, and gifts.",
          reviews: []
        },
        {
          id: 3,
          name: "Desk Name Plate",
          price: 19.99,
          stock: 12,
          sold: 0,
          image: "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&w=1200&q=80",
          model: "https://modelviewer.dev/shared-assets/models/Astronaut.glb",
          description: "Personalized desk name plate. Add name, color, and style in the checkout notes.",
          reviews: []
        }
      ],
      orders: []
    };

    fs.writeFileSync(DB_FILE, JSON.stringify(starter, null, 2));
  }
}

function loadDB() {
  createDB();
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function requireAdmin(req, res, next) {
  const pass = req.headers["x-admin-password"];

  if (!pass || pass !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
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
  db.visitors += 1;
  saveDB(db);
  res.json({ ok: true });
});

app.post("/api/cart-opened", (req, res) => {
  const db = loadDB();
  db.cartsOpened += 1;
  saveDB(db);
  res.json({ ok: true });
});

app.get("/api/products", (req, res) => {
  const db = loadDB();
  res.json(db.products);
});

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
    total
  } = req.body;

  if (!name || !phone || !email || !streetAddress || !city || !state || !zip) {
    return res.status(400).json({ error: "Missing customer information" });
  }

  if (!cart || !Array.isArray(cart) || cart.length === 0) {
    return res.status(400).json({ error: "Cart is empty" });
  }

  const order = {
    id: "APEX-" + Date.now(),
    name,
    phone,
    email,
    streetAddress,
    city,
    state,
    zip,
    notes: notes || "",
    cart,
    total,
    status: "Processing",
    paidWith: "PayPal",
    date: new Date().toLocaleString()
  };

  for (const item of cart) {
    const product = db.products.find(p => p.id === Number(item.id));
    if (product) {
      product.stock = Math.max(0, product.stock - Number(item.qty));
      product.sold += Number(item.qty);
    }
  }

  db.orders.push(order);
  saveDB(db);

  const orderText = `
New Apex 3D Creations Order

Order Number: ${order.id}
Status: ${order.status}

Customer:
${order.name}
${order.phone}
${order.email}

Shipping:
${order.streetAddress}
${order.city}, ${order.state} ${order.zip}

Notes:
${order.notes || "None"}

Items:
${cart.map(i => `${i.name} x ${i.qty} - $${i.price}`).join("\n")}

Total: $${total}

PayPal:
${process.env.PAYPAL_LINK}
`;

  try {
    await sendEmail({
      to: process.env.OWNER_EMAIL,
      subject: `New Apex Order ${order.id}`,
      text: orderText
    });

    await sendEmail({
      to: email,
      subject: `Apex 3D Creations Order Confirmation ${order.id}`,
      text: `
Thank you for your order!

Order Number: ${order.id}
Status: Processing
Total: $${total}

Please finish payment here:
${process.env.PAYPAL_LINK}

You can track your order on the website using your phone number.
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
  const orders = db.orders.filter(o => o.phone === phone);
  res.json(orders);
});

app.post("/api/review", (req, res) => {
  const db = loadDB();
  const product = db.products.find(p => p.id === Number(req.body.productId));

  if (!product) {
    return res.status(404).json({ error: "Product not found" });
  }

  product.reviews.push({
    name: req.body.name || "Customer",
    rating: Number(req.body.rating || 5),
    text: req.body.text || "",
    date: new Date().toLocaleString()
  });

  saveDB(db);
  res.json({ ok: true });
});

app.get("/api/admin/analytics", requireAdmin, (req, res) => {
  const db = loadDB();

  const revenue = db.orders.reduce((sum, order) => {
    return sum + Number(order.total || 0);
  }, 0);

  res.json({
    visitors: db.visitors,
    cartsOpened: db.cartsOpened,
    totalOrders: db.orders.length,
    revenue,
    products: db.products.sort((a, b) => b.sold - a.sold),
    orders: db.orders
  });
});

app.post("/api/admin/stock", requireAdmin, (req, res) => {
  const db = loadDB();
  const product = db.products.find(p => p.id === Number(req.body.id));

  if (!product) {
    return res.status(404).json({ error: "Product not found" });
  }

  product.stock = Number(req.body.stock);
  saveDB(db);

  res.json({ ok: true });
});

app.post("/api/admin/order-status", requireAdmin, (req, res) => {
  const db = loadDB();
  const order = db.orders.find(o => o.id === req.body.id);

  if (!order) {
    return res.status(404).json({ error: "Order not found" });
  }

  order.status = req.body.status;
  saveDB(db);

  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log("Apex 3D Creations server running on port " + PORT);
});