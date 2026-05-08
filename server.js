// ======================= package.json =======================
{
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "dotenv": "latest",
    "express": "latest",
    "nodemailer": "latest"
  }
}

// ======================= .env =======================
PORT=3000
ADMIN_PASSWORD=Colt45!!!
OWNER_EMAIL=hi0888990@gmail.com
EMAIL_USER=your_gmail_here@gmail.com
EMAIL_PASS=your_gmail_app_password_here
PAYPAL_LINK=https://paypal.me/jayden7493

// ======================= server.js =======================
require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const app = express();
const DB_FILE = "./db.json";

app.use(express.json());
app.use(express.static("public"));

function createDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({
      visitors: 0,
      products: [
        {
          id: 1,
          name: "Custom 3D Print Request",
          price: 24.99,
          stock: 10,
          sold: 0,
          image: "https://images.unsplash.com/photo-1631744591853-998c4308bbb0?auto=format&fit=crop&w=900&q=80",
          model: "https://modelviewer.dev/shared-assets/models/Astronaut.glb",
          description: "Send a custom idea and I will review it for printing.",
          reviews: []
        },
        {
          id: 2,
          name: "Dragon Figure",
          price: 14.99,
          stock: 6,
          sold: 0,
          image: "https://images.unsplash.com/photo-1614064641938-3bbee52942c7?auto=format&fit=crop&w=900&q=80",
          model: "https://modelviewer.dev/shared-assets/models/RobotExpressive.glb",
          description: "Detailed 3D printed figure with a clean display finish.",
          reviews: []
        }
      ],
      orders: []
    }, null, 2));
  }
}

function db() {
  createDB();
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function save(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function checkAdmin(req, res, next) {
  if (req.headers["x-admin-password"] !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/api/visit", (req, res) => {
  const data = db();
  data.visitors++;
  save(data);
  res.json({ ok: true });
});

app.get("/api/products", (req, res) => {
  res.json(db().products);
});

app.post("/api/order", async (req, res) => {
  const data = db();

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

  if (!name || !phone || !email || !streetAddress || !city || !state || !zip || !cart?.length) {
    return res.status(400).json({ error: "Missing checkout information" });
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
    notes,
    cart,
    total,
    status: "Processing",
    date: new Date().toLocaleString()
  };

  for (const item of cart) {
    const product = data.products.find(p => p.id === item.id);
    if (product) {
      product.stock = Math.max(0, product.stock - item.qty);
      product.sold += item.qty;
    }
  }

  data.orders.push(order);
  save(data);

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const message = `
New Apex 3D Creations Order

Order Number: ${order.id}
Name: ${name}
Phone: ${phone}
Email: ${email}

Shipping Address:
${streetAddress}
${city}, ${state} ${zip}

Notes:
${notes || "None"}

Total: $${total}

Items:
${cart.map(i => `${i.name} x ${i.qty} - $${i.price}`).join("\n")}
`;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.OWNER_EMAIL,
      subject: `New Order ${order.id}`,
      text: message
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: `Apex 3D Creations Order Confirmation ${order.id}`,
      text: `Thanks for your order!\n\nYour order number is ${order.id}.\nStatus: Processing\nTotal: $${total}\n\nPay here: ${process.env.PAYPAL_LINK}`
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
  const data = db();
  res.json(data.orders.filter(o => o.phone === req.params.phone));
});

app.post("/api/review", (req, res) => {
  const data = db();
  const product = data.products.find(p => p.id === Number(req.body.productId));

  if (!product) return res.status(404).json({ error: "Product not found" });

  product.reviews.push({
    name: req.body.name || "Customer",
    rating: Number(req.body.rating),
    text: req.body.text,
    date: new Date().toLocaleString()
  });

  save(data);
  res.json({ ok: true });
});

app.get("/api/admin/analytics", checkAdmin, (req, res) => {
  const data = db();
  const revenue = data.orders.reduce((sum, o) => sum + Number(o.total), 0);

  res.json({
    totalOrders: data.orders.length,
    revenue,
    visitors: data.visitors,
    products: data.products.sort((a, b) => b.sold - a.sold),
    orders: data.orders
  });
});

app.post("/api/admin/stock", checkAdmin, (req, res) => {
  const data = db();
  const product = data.products.find(p => p.id === Number(req.body.id));

  if (!product) return res.status(404).json({ error: "Product not found" });

  product.stock = Number(req.body.stock);
  save(data);
  res.json({ ok: true });
});

app.post("/api/admin/order-status", checkAdmin, (req, res) => {
  const data = db();
  const order = data.orders.find(o => o.id === req.body.id);

  if (!order) return res.status(404).json({ error: "Order not found" });

  order.status = req.body.status;
  save(data);
  res.json({ ok: true });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Apex 3D Creations server running");
});

// ======================= public/index.html =======================
<!DOCTYPE html>
<html>
<head>
  <title>Apex 3D Creations</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="manifest" href="/manifest.json">
  <script type="module" src="https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js"></script>

  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      background: #070b16;
      color: white;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 10;
      background: rgba(7, 11, 22, .9);
      backdrop-filter: blur(14px);
      padding: 18px 7%;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #1f2937;
    }
    .logo { font-weight: 900; font-size: 24px; }
    button {
      background: linear-gradient(135deg, #2563eb, #7c3aed);
      color: white;
      border: 0;
      padding: 12px 18px;
      border-radius: 12px;
      cursor: pointer;
      font-weight: bold;
      transition: .2s;
    }
    button:hover { transform: translateY(-2px); box-shadow: 0 10px 25px #000; }
    button:disabled { background: #374151; cursor: not-allowed; }
    .hero {
      padding: 90px 7%;
      background:
        radial-gradient(circle at top right, #2563eb55, transparent 35%),
        linear-gradient(135deg, #0f172a, #111827);
      text-align: center;
    }
    .hero h1 { font-size: 52px; margin: 0; }
    .hero p { color: #cbd5e1; font-size: 19px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
      gap: 24px;
      padding: 40px 7%;
    }
    .card {
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 22px;
      padding: 22px;
      box-shadow: 0 18px 40px #0008;
      animation: rise .5s ease;
    }
    .card img {
      width: 100%;
      height: 220px;
      object-fit: cover;
      border-radius: 18px;
    }
    model-viewer {
      width: 100%;
      height: 280px;
      border-radius: 18px;
      background: #020617;
      margin-top: 12px;
    }
    input, textarea, select {
      width: 100%;
      padding: 14px;
      margin: 8px 0;
      border-radius: 12px;
      border: 1px solid #334155;
      background: #020617;
      color: white;
    }
    .section { padding: 35px 7%; }
    .status-good { color: #22c55e; }
    .status-low { color: #f59e0b; }
    .status-out { color: #ef4444; }
    .checkout-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 12px;
    }
    #chat {
      position: fixed;
      right: 22px;
      bottom: 22px;
      width: 310px;
      background: #111827;
      border: 1px solid #334155;
      border-radius: 20px;
      padding: 16px;
      box-shadow: 0 15px 40px #000;
    }
    #chatMessages {
      height: 130px;
      overflow: auto;
      font-size: 14px;
      color: #cbd5e1;
    }
    footer {
      padding: 30px;
      text-align: center;
      color: #94a3b8;
      border-top: 1px solid #1f2937;
    }
    @keyframes rise {
      from { transform: translateY(25px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  </style>
</head>
<body>

<header>
  <div class="logo">Apex 3D Creations</div>
  <button onclick="showCart()">Cart (<span id="cartCount">0</span>)</button>
</header>

<section class="hero">
  <h1>Professional Custom 3D Prints</h1>
  <p>Custom models, figures, parts, decorations, and personalized 3D printed items.</p>
  <button onclick="document.getElementById('shop').scrollIntoView()">Shop Now</button>
</section>

<section id="shop" class="grid"></section>

<section class="section">
  <div class="card">
    <h2>Checkout</h2>
    <p>Enter your shipping details. After placing the order, you will be sent to PayPal.</p>

    <div class="checkout-grid">
      <input id="customerName" placeholder="Full name">
      <input id="customerPhone" placeholder="Phone number">
      <input id="customerEmail" placeholder="Email address">
      <input id="streetAddress" placeholder="Street address, house number, apartment">
      <input id="city" placeholder="City">
      <input id="state" placeholder="State">
      <input id="zip" placeholder="ZIP code">
    </div>

    <textarea id="orderNotes" placeholder="Order notes, custom print details, color, size, etc."></textarea>
    <button onclick="placeOrder()">Place Order & Pay With PayPal</button>
  </div>
</section>

<section class="section">
  <div class="card">
    <h2>Track Your Order</h2>
    <input id="trackPhone" placeholder="Enter your phone number">
    <button onclick="loadOrders()">Track Order</button>
    <div id="ordersBox"></div>
  </div>
</section>

<div id="chat">
  <b>AI Shop Assistant</b>
  <div id="chatMessages"></div>
  <input id="chatInput" placeholder="Ask about products or orders">
  <button onclick="askBot()">Send</button>
</div>

<footer>
  Apex 3D Creations © 2026
</footer>

<script>
let products = [];
let cart = JSON.parse(localStorage.getItem("cart")) || [];

fetch("/api/visit", { method: "POST" });

async function loadProducts() {
  products = await fetch("/api/products").then(r => r.json());
  const shop = document.getElementById("shop");
  shop.innerHTML = "";

  products.forEach(p => {
    const avg = p.reviews.length
      ? (p.reviews.reduce((s, r) => s + r.rating, 0) / p.reviews.length).toFixed(1)
      : "No reviews yet";

    let stock = `<b class="status-good">In stock: ${p.stock}</b>`;
    if (p.stock <= 3 && p.stock > 0) stock = `<b class="status-low">Low stock: ${p.stock}</b>`;
    if (p.stock <= 0) stock = `<b class="status-out">Sold out</b>`;

    shop.innerHTML += `
      <div class="card">
        <img src="${p.image}">
        <h2>${p.name}</h2>
        <p>${p.description}</p>
        <h3>$${p.price}</h3>
        <p>${stock}</p>
        <p>⭐ ${avg}</p>

        <model-viewer src="${p.model}" camera-controls auto-rotate></model-viewer>

        <button ${p.stock <= 0 ? "disabled" : ""} onclick="addToCart(${p.id})">Add to Cart</button>

        <h3>Leave a Review</h3>
        <input id="reviewName${p.id}" placeholder="Your name">
        <select id="reviewRating${p.id}">
          <option value="5">5 stars</option>
          <option value="4">4 stars</option>
          <option value="3">3 stars</option>
          <option value="2">2 stars</option>
          <option value="1">1 star</option>
        </select>
        <textarea id="reviewText${p.id}" placeholder="Write a review"></textarea>
        <button onclick="addReview(${p.id})">Post Review</button>

        ${p.reviews.map(r => `<p>⭐${r.rating} <b>${r.name}</b>: ${r.text}</p>`).join("")}
      </div>
    `;
  });

  updateCart();
}

function addToCart(id) {
  const product = products.find(p => p.id === id);
  const existing = cart.find(i => i.id === id);

  if (existing) existing.qty++;
  else cart.push({ id: product.id, name: product.name, price: product.price, qty: 1 });

  localStorage.setItem("cart", JSON.stringify(cart));
  updateCart();
}

function updateCart() {
  document.getElementById("cartCount").innerText = cart.reduce((s, i) => s + i.qty, 0);
}

function showCart() {
  if (!cart.length) return alert("Your cart is empty");

  const total = cart.reduce((s, i) => s + i.price * i.qty, 0).toFixed(2);
  alert(cart.map(i => `${i.name} x ${i.qty}`).join("\n") + "\n\nTotal: $" + total);
}

async function placeOrder() {
  const name = document.getElementById("customerName").value.trim();
  const phone = document.getElementById("customerPhone").value.trim();
  const email = document.getElementById("customerEmail").value.trim();
  const streetAddress = document.getElementById("streetAddress").value.trim();
  const city = document.getElementById("city").value.trim();
  const state = document.getElementById("state").value.trim();
  const zip = document.getElementById("zip").value.trim();
  const notes = document.getElementById("orderNotes").value.trim();

  if (!name || !phone || !email || !streetAddress || !city || !state || !zip) {
    alert("Please fill out name, phone, email, street address, city, state, and ZIP code.");
    return;
  }

  if (!cart.length) {
    alert("Your cart is empty.");
    return;
  }

  const total = cart.reduce((s, i) => s + i.price * i.qty, 0).toFixed(2);

  const res = await fetch("/api/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
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
    })
  });

  const data = await res.json();

  if (!data.ok) {
    alert("Checkout failed. Please try again.");
    return;
  }

  localStorage.removeItem("cart");
  cart = [];
  updateCart();

  alert("Order saved! Your order number is " + data.orderId + ". Now going to PayPal.");
  window.location.href = data.paypal;
}

async function loadOrders() {
  const phone = document.getElementById("trackPhone").value.trim();
  const orders = await fetch("/api/orders/" + phone).then(r => r.json());

  document.getElementById("ordersBox").innerHTML = orders.length
    ? orders.map(o => `
      <div class="card">
        <h3>${o.id}</h3>
        <p>Status: <b>${o.status}</b></p>
        <p>Total: $${o.total}</p>
        <p>${o.streetAddress}, ${o.city}, ${o.state} ${o.zip}</p>
      </div>
    `).join("")
    : "<p>No orders found.</p>";
}

async function addReview(productId) {
  const name = document.getElementById("reviewName" + productId).value;
  const rating = document.getElementById("reviewRating" + productId).value;
  const text = document.getElementById("reviewText" + productId).value;

  await fetch("/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId, name, rating, text })
  });

  alert("Review posted!");
  loadProducts();
}

function askBot() {
  const input = document.getElementById("chatInput").value.toLowerCase();
  const box = document.getElementById("chatMessages");

  let answer = "I can help with custom 3D prints, order tracking, prices, reviews, and checkout.";

  if (input.includes("order")) answer = "Use the order tracking box and enter the phone number used at checkout.";
  if (input.includes("custom")) answer = "Choose Custom 3D Print Request and describe what you want in the order notes.";
  if (input.includes("paypal")) answer = "After checkout, the site sends you to PayPal to finish payment.";
  if (input.includes("shipping")) answer = "Your order status will update as Processing, Printing, Shipped, or Delivered.";
  if (input.includes("3d")) answer = "The 3D viewer lets you rotate and zoom supported product models.";

  box.innerHTML += `<p><b>You:</b> ${input}</p><p><b>Bot:</b> ${answer}</p>`;
  document.getElementById("chatInput").value = "";
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js");
}

loadProducts();
</script>

</body>
</html>

// ======================= public/apex-owner-portal.html =======================
<!DOCTYPE html>
<html>
<head>
  <title>Apex Owner Portal</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <style>
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      background: #070b16;
      color: white;
      padding: 35px;
    }
    .card {
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 20px;
      padding: 22px;
      margin-bottom: 20px;
      box-shadow: 0 18px 40px #0008;
    }
    input, select {
      padding: 12px;
      border-radius: 10px;
      border: 1px solid #334155;
      background: #020617;
      color: white;
      margin: 6px;
    }
    button {
      background: linear-gradient(135deg, #2563eb, #7c3aed);
      color: white;
      border: 0;
      padding: 12px 16px;
      border-radius: 10px;
      cursor: pointer;
      font-weight: bold;
    }
  </style>
</head>
<body>

<h1>Apex Owner Portal</h1>

<div class="card" id="loginBox">
  <h2>Admin Login</h2>
  <input id="adminPass" type="password" placeholder="Admin password">
  <button onclick="login()">Login</button>
</div>

<div id="dashboard" style="display:none;">
  <div class="card">
    <h2>Analytics</h2>
    <div id="analytics"></div>
  </div>

  <div class="card">
    <h2>Inventory</h2>
    <div id="inventory"></div>
  </div>

  <div class="card">
    <h2>Orders</h2>
    <div id="orders"></div>
  </div>
</div>

<script>
let adminPassword = "";

function login() {
  adminPassword = document.getElementById("adminPass").value;
  document.getElementById("loginBox").style.display = "none";
  document.getElementById("dashboard").style.display = "block";
  loadAdmin();
}

async function adminFetch(url, options = {}) {
  options.headers = {
    ...(options.headers || {}),
    "Content-Type": "application/json",
    "x-admin-password": adminPassword
  };

  return fetch(url, options);
}

async function loadAdmin() {
  const res = await adminFetch("/api/admin/analytics");
  const data = await res.json();

  if (data.error) {
    alert("Wrong admin password");
    location.reload();
    return;
  }

  document.getElementById("analytics").innerHTML = `
    <h3>Total Orders: ${data.totalOrders}</h3>
    <h3>Revenue: $${data.revenue.toFixed(2)}</h3>
    <h3>Visitors: ${data.visitors}</h3>
  `;

  document.getElementById("inventory").innerHTML = data.products.map(p => `
    <p>
      <b>${p.name}</b>
      Stock: <input id="stock${p.id}" value="${p.stock}" style="width:70px;">
      Sold: ${p.sold}
      <button onclick="updateStock(${p.id})">Save</button>
    </p>
  `).join("");

  document.getElementById("orders").innerHTML = data.orders.map(o => `
    <div class="card">
      <h3>${o.id}</h3>
      <p><b>${o.name}</b> | ${o.phone} | ${o.email}</p>
      <p>${o.streetAddress}, ${o.city}, ${o.state} ${o.zip}</p>
      <p>Total: $${o.total}</p>
      <p>Items: ${o.cart.map(i => `${i.name} x ${i.qty}`).join(", ")}</p>

      <select id="status${o.id}">
        <option ${o.status === "Processing" ? "selected" : ""}>Processing</option>
        <option ${o.status === "Printing" ? "selected" : ""}>Printing</option>
        <option ${o.status === "Shipped" ? "selected" : ""}>Shipped</option>
        <option ${o.status === "Delivered" ? "selected" : ""}>Delivered</option>
      </select>

      <button onclick="updateStatus('${o.id}')">Update Status</button>
    </div>
  `).join("");
}

async function updateStock(id) {
  const stock = document.getElementById("stock" + id).value;

  await adminFetch("/api/admin/stock", {
    method: "POST",
    body: JSON.stringify({ id, stock })
  });

  alert("Stock updated");
  loadAdmin();
}

async function updateStatus(id) {
  const status = document.getElementById("status" + id).value;

  await adminFetch("/api/admin/order-status", {
    method: "POST",
    body: JSON.stringify({ id, status })
  });

  alert("Order status updated");
  loadAdmin();
}
</script>

</body>
</html>

// ======================= public/manifest.json =======================
{
  "name": "Apex 3D Creations",
  "short_name": "Apex3D",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#070b16",
  "theme_color": "#2563eb",
  "icons": [
    {
      "src": "https://via.placeholder.com/192",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "https://via.placeholder.com/512",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}

// ======================= public/service-worker.js =======================
const CACHE = "apex-3d-creations-v2";

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => {
      return cache.addAll([
        "/",
        "/index.html",
        "/manifest.json"
      ]);
    })
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});