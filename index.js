import "dotenv/config";

import cors from "cors";
import express from "express";
import Stripe from "stripe";

import {
  bookings,
  connectDb,
  findUserById,
  getDb,
  payments,
  publicUser,
  services,
  toId,
  users,
} from "./db.js";
import {
  verifyAdmin,
  verifyCustomer,
  verifyTechnician,
  verifyToken,
} from "./middleware/auth.js";

const CATEGORIES = [
  "Smartphone",
  "Laptop & PC",
  "AC",
  "Refrigerator",
  "TV",
  "Washing Machine",
  "Electrical",
];
const MODES = ["Home Visit", "Shop Drop-off"];
const ROLES = ["customer", "technician", "admin"];
const BOOKING_STATUSES = [
  "requested",
  "accepted",
  "rejected",
  "in-progress",
  "completed",
  "cancelled",
];
const ACTIVE_STATUSES = ["requested", "accepted", "in-progress"];
const NEXT_STATUS = {
  requested: ["accepted", "rejected"],
  accepted: ["in-progress"],
  "in-progress": ["completed"],
};

const str = (value) => (typeof value === "string" ? value.trim() : "");
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hostedImage = (value) => /^(https?:\/\/|\/)/i.test(value);
const digits = (value) => str(value).replace(/\D/g, "");

const pageParams = (query, defaultLimit = 12) => {
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || defaultLimit, 1), 50);
  return { page, limit, skip: (page - 1) * limit };
};

const parsePreferredDate = (value) => {
  const input = str(value);
  if (!input) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input)
    ? new Date(`${input}T00:00:00`)
    : new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today ? null : date;
};

const clientUrl = (process.env.CLIENT_URL ?? "http://localhost:3000").replace(/\/+$/, "");
let stripeClient;

const getStripe = () => {
  const key = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (!key || !key.startsWith("sk_test_")) return null;
  stripeClient ??= new Stripe(key, { timeout: 10000, maxNetworkRetries: 1 });
  return stripeClient;
};

/**
 * The one idempotent payment writer used by both the success page and webhook.
 * Unique bookingId / stripeSessionId indexes back up the pre-insert check.
 */
async function savePayment(session) {
  if (session.payment_status !== "paid") {
    throw Object.assign(new Error("Payment has not been completed"), { status: 400 });
  }

  const bookingId = toId(session.metadata?.bookingId);
  if (!bookingId) throw Object.assign(new Error("Session has no valid bookingId"), { status: 400 });

  const booking = await bookings().findOne({ _id: bookingId });
  if (!booking) throw Object.assign(new Error("Booking not found"), { status: 404 });
  if (booking.status !== "completed") {
    throw Object.assign(new Error("Booking is not completed"), { status: 400 });
  }
  if (
    session.metadata?.customerEmail &&
    session.metadata.customerEmail !== booking.customerEmail
  ) {
    throw Object.assign(new Error("Session customer does not match the booking"), { status: 400 });
  }

  const expectedCents = Math.round(Number(booking.finalAmount) * 100);
  if (session.amount_total != null && session.amount_total !== expectedCents) {
    throw Object.assign(new Error("Checkout amount does not match the booking"), { status: 400 });
  }

  const existing = await payments().findOne({
    $or: [{ stripeSessionId: session.id }, { bookingId: String(booking._id) }],
  });
  if (existing) {
    await bookings().updateOne(
      { _id: booking._id, paymentStatus: "unpaid" },
      {
        $set: { paymentStatus: "paid" },
        $push: { statusHistory: { status: "paid", at: new Date() } },
      }
    );
    return existing;
  }

  const payment = {
    bookingId: String(booking._id),
    serviceTitle: booking.serviceTitle,
    customerName: booking.customerName,
    customerEmail: booking.customerEmail,
    technicianName: booking.technicianName,
    technicianEmail: booking.technicianEmail,
    amount: (session.amount_total ?? expectedCents) / 100,
    currency: (session.currency ?? "usd").toLowerCase(),
    transactionId:
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? session.id,
    stripeSessionId: session.id,
    paymentStatus: "paid",
    paidAt: new Date(),
  };

  let saved = payment;
  try {
    const result = await payments().insertOne(payment);
    saved = { ...payment, _id: result.insertedId };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    saved = await payments().findOne({
      $or: [{ stripeSessionId: payment.stripeSessionId }, { bookingId: payment.bookingId }],
    });
    if (!saved) throw error;
  }

  await bookings().updateOne(
    { _id: booking._id, paymentStatus: "unpaid" },
    {
      $set: { paymentStatus: "paid" },
      $push: { statusHistory: { status: "paid", at: new Date() } },
    }
  );

  return saved;
}

async function stripeWebhook(req, res) {
  const stripe = getStripe();
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (!stripe || !webhookSecret) {
    return res.status(400).json({ success: false, message: "Stripe webhook is not configured" });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      webhookSecret
    );
  } catch {
    return res.status(400).json({ success: false, message: "Invalid webhook signature" });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.payment_status === "paid") await savePayment(session);
    }
    res.json({ received: true });
  } catch (error) {
    console.error("Webhook processing failed:", error);
    const status = error.status && error.status < 500 ? 400 : 500;
    res.status(status).json({ success: false, message: "Webhook processing failed" });
  }
}

function parseService(body = {}) {
  const data = {
    title: str(body.title),
    category: str(body.category),
    description: str(body.description),
    image: str(body.image),
    basePrice: Number(body.basePrice),
    estimatedDuration: str(body.estimatedDuration),
    serviceMode: str(body.serviceMode),
    serviceArea: str(body.serviceArea),
  };

  if (data.title.length < 3 || data.title.length > 120) {
    return { error: "Title must be between 3 and 120 characters" };
  }
  if (!CATEGORIES.includes(data.category)) return { error: "Invalid category" };
  if (data.description.length < 20 || data.description.length > 3000) {
    return { error: "Description must be between 20 and 3000 characters" };
  }
  if (!data.image || !hostedImage(data.image)) return { error: "A hosted image URL is required" };
  if (!Number.isFinite(data.basePrice) || data.basePrice <= 0) {
    return { error: "Base price must be a positive number" };
  }
  if (!data.estimatedDuration || data.estimatedDuration.length > 60) {
    return { error: "Estimated duration is required" };
  }
  if (!MODES.includes(data.serviceMode)) return { error: "Invalid service mode" };
  if (!data.serviceArea || data.serviceArea.length > 120) {
    return { error: "Service area is required" };
  }

  return { data };
}

const app = express();
app.disable("x-powered-by");

const allowedOrigins = [
  process.env.CLIENT_URL ?? "http://localhost:3000",
  ...(process.env.CORS_ORIGINS ?? "").split(","),
]
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "stripe-signature"],
  })
);

// Stripe signs the raw body, so this route is mounted before express.json().
app.post("/api/payments/webhook", express.raw({ type: "application/json" }), stripeWebhook);

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const isImageBuffer = (buffer) => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const webp =
    buffer.subarray(0, 4).toString() === "RIFF" &&
    buffer.subarray(8, 12).toString() === "WEBP";
  return buffer.subarray(0, 8).equals(png) || jpeg || webp;
};

// Uploads carry base64 images, so they get a larger body limit before global JSON parsing.
app.post("/api/uploads", express.json({ limit: "8mb" }), verifyToken, async (req, res) => {
  const key = (process.env.IMGBB_API_KEY ?? "").trim();
  if (!key) {
    return res.status(503).json({ success: false, message: "Image uploads are not configured" });
  }

  const input = str(req.body?.image);
  if (!input) return res.status(400).json({ success: false, message: "Image is required" });

  const base64 = input.replace(/^data:image\/(?:png|jpe?g|webp);base64,/i, "");
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length || !isImageBuffer(buffer)) {
    return res
      .status(400)
      .json({ success: false, message: "Only PNG, JPEG, or WebP images are allowed" });
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return res.status(413).json({ success: false, message: "Image must be smaller than 5 MB" });
  }

  try {
    const response = await fetch("https://api.imgbb.com/1/upload", {
      method: "POST",
      body: new URLSearchParams({ key, image: base64 }),
    });
    const payload = await response.json();
    if (!response.ok || !payload?.data?.url) {
      return res.status(502).json({ success: false, message: "Image upload failed" });
    }
    res.status(201).json({ success: true, url: payload.data.url });
  } catch {
    res.status(502).json({ success: false, message: "Image upload failed" });
  }
});

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", async (_req, res) => {
  try {
    await getDb().command({ ping: 1 }, { maxTimeMS: 2000 });
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ success: false, message: "Database unavailable" });
  }
});

app.post(
  "/api/payments/create-checkout-session",
  verifyToken,
  verifyCustomer,
  async (req, res) => {
    const stripe = getStripe();
    if (!stripe) {
      return res
        .status(503)
        .json({ success: false, message: "Stripe test mode is not configured" });
    }

    const _id = toId(str(req.body?.bookingId));
    if (!_id) return res.status(404).json({ success: false, message: "Booking not found" });

    const booking = await bookings().findOne({ _id });
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
    if (booking.customerEmail !== req.user.email) {
      return res.status(403).json({ success: false, message: "Forbidden: this is not your booking" });
    }
    if (booking.status !== "completed") {
      return res
        .status(400)
        .json({ success: false, message: "You can only pay for a completed job" });
    }
    if (booking.paymentStatus !== "unpaid") {
      return res.status(400).json({ success: false, message: "This booking is already paid" });
    }

    const amount = Number(booking.finalAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "The booking has no payable amount" });
    }

    let session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: booking.customerEmail,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: Math.round(amount * 100),
              product_data: {
                name: booking.serviceTitle,
                description: `Repair job by ${booking.technicianName}`,
              },
            },
          },
        ],
        metadata: {
          bookingId: String(booking._id),
          customerEmail: booking.customerEmail,
        },
        success_url: `${clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${clientUrl}/payment/cancel`,
      });
    } catch (error) {
      console.error("Stripe checkout creation failed:", error);
      return res
        .status(502)
        .json({ success: false, message: "Stripe checkout could not be created" });
    }

    if (!session.url) {
      return res
        .status(502)
        .json({ success: false, message: "Stripe did not return a checkout URL" });
    }

    res.json({ url: session.url, sessionId: session.id });
  }
);

app.get("/api/payments/my", verifyToken, verifyCustomer, async (req, res) => {
  const items = await payments()
    .find({ customerEmail: req.user.email })
    .sort({ paidAt: -1 })
    .toArray();
  res.json({ items });
});

app.get("/api/payments/verify", verifyToken, verifyCustomer, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) {
    return res
      .status(503)
      .json({ success: false, message: "Stripe test mode is not configured" });
  }

  const sessionId = str(req.query.session_id);
  if (!sessionId) {
    return res.status(400).json({ success: false, message: "session_id is required" });
  }

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (error) {
    if (error?.statusCode === 404 || error?.code === "resource_missing") {
      return res.status(404).json({ success: false, message: "Checkout session not found" });
    }
    return res
      .status(502)
      .json({ success: false, message: "Stripe could not verify this checkout session" });
  }

  if (session.metadata?.customerEmail !== req.user.email) {
    return res.status(403).json({ success: false, message: "Forbidden: this payment is not yours" });
  }
  if (session.payment_status !== "paid") {
    return res.status(400).json({ success: false, message: "Payment has not been completed" });
  }

  const bookingId = toId(session.metadata?.bookingId);
  if (!bookingId) {
    return res.status(400).json({ success: false, message: "Checkout session has no booking" });
  }

  const booking = await bookings().findOne({ _id: bookingId });
  if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
  if (booking.customerEmail !== req.user.email) {
    return res.status(403).json({ success: false, message: "Forbidden: this payment is not yours" });
  }
  if (booking.status !== "completed") {
    return res.status(400).json({ success: false, message: "Booking is not completed" });
  }

  const payment = await savePayment(session);
  res.json({
    status: "paid",
    bookingId: payment.bookingId,
    serviceTitle: payment.serviceTitle,
    amount: payment.amount,
    currency: payment.currency,
    transactionId: payment.transactionId,
    paidAt: payment.paidAt,
    payment,
  });
});

// Public services
app.get("/api/services", async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const filter = { approvalStatus: "approved", isAvailable: true };

  const search = str(req.query.search).slice(0, 60);
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ title: rx }, { category: rx }];
  }

  const category = str(req.query.category);
  if (category) {
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: "Invalid category" });
    }
    filter.category = category;
  }

  const mode = str(req.query.mode) || str(req.query.serviceMode);
  if (mode) {
    if (!MODES.includes(mode)) {
      return res.status(400).json({ success: false, message: "Invalid service mode" });
    }
    filter.serviceMode = mode;
  }

  const sort = str(req.query.sort).replace(/_/g, "-");
  const sortMap = {
    "price-asc": { basePrice: 1, _id: -1 },
    "price-desc": { basePrice: -1, _id: -1 },
    newest: { createdAt: -1, _id: -1 },
  };

  const [items, total] = await Promise.all([
    services()
      .find(filter)
      .sort(sortMap[sort] ?? sortMap.newest)
      .skip(skip)
      .limit(limit)
      .toArray(),
    services().countDocuments(filter),
  ]);

  res.json({
    items,
    pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
  });
});

app.get("/api/services/mine", verifyToken, verifyTechnician, async (req, res) => {
  const items = await services()
    .find({ technicianEmail: req.user.email })
    .sort({ createdAt: -1 })
    .toArray();
  res.json({ items });
});

app.get("/api/services/:id", async (req, res) => {
  const _id = toId(req.params.id);
  if (!_id) return res.status(404).json({ success: false, message: "Service not found" });

  const service = await services().findOne({
    _id,
    approvalStatus: "approved",
    isAvailable: true,
  });
  if (!service) return res.status(404).json({ success: false, message: "Service not found" });

  const technician = await users().findOne({ email: service.technicianEmail });
  res.json({
    ...service,
    technician: {
      name: technician?.name ?? service.technicianName,
      image: technician?.image ?? "",
      area: technician?.area ?? service.serviceArea,
      bio: technician?.bio ?? "",
    },
  });
});

// Technician services
app.post("/api/services", verifyToken, verifyTechnician, async (req, res) => {
  const { data, error } = parseService(req.body);
  if (error) return res.status(400).json({ success: false, message: error });

  const doc = {
    ...data,
    technicianName: req.user.name,
    technicianEmail: req.user.email,
    approvalStatus: "pending",
    isAvailable: true,
    createdAt: new Date(),
  };
  const result = await services().insertOne(doc);
  res.status(201).json({ ...doc, _id: result.insertedId });
});

app.patch("/api/services/:id", verifyToken, verifyTechnician, async (req, res) => {
  const _id = toId(req.params.id);
  if (!_id) return res.status(404).json({ success: false, message: "Service not found" });

  const service = await services().findOne({ _id });
  if (!service) return res.status(404).json({ success: false, message: "Service not found" });
  if (service.technicianEmail !== req.user.email) {
    return res.status(403).json({ success: false, message: "Forbidden: this is not your service" });
  }

  const { data, error } = parseService(req.body);
  if (error) return res.status(400).json({ success: false, message: error });

  const updated = await services().findOneAndUpdate(
    { _id, technicianEmail: req.user.email },
    { $set: { ...data, approvalStatus: "pending" } },
    { returnDocument: "after" }
  );
  if (!updated) return res.status(404).json({ success: false, message: "Service not found" });
  res.json(updated);
});

app.patch("/api/services/:id/availability", verifyToken, verifyTechnician, async (req, res) => {
  const _id = toId(req.params.id);
  if (!_id) return res.status(404).json({ success: false, message: "Service not found" });
  if (typeof req.body?.isAvailable !== "boolean") {
    return res.status(400).json({ success: false, message: "isAvailable must be true or false" });
  }

  const updated = await services().findOneAndUpdate(
    { _id, technicianEmail: req.user.email },
    { $set: { isAvailable: req.body.isAvailable } },
    { returnDocument: "after" }
  );
  if (!updated) {
    const exists = await services().findOne({ _id });
    if (!exists) return res.status(404).json({ success: false, message: "Service not found" });
    return res.status(403).json({ success: false, message: "Forbidden: this is not your service" });
  }
  res.json(updated);
});

app.delete("/api/services/:id", verifyToken, verifyTechnician, async (req, res) => {
  const _id = toId(req.params.id);
  if (!_id) return res.status(404).json({ success: false, message: "Service not found" });

  const service = await services().findOne({ _id });
  if (!service) return res.status(404).json({ success: false, message: "Service not found" });
  if (service.technicianEmail !== req.user.email) {
    return res.status(403).json({ success: false, message: "Forbidden: this is not your service" });
  }

  await services().deleteOne({ _id });
  res.json({ success: true });
});

// Customer bookings
app.post("/api/bookings", verifyToken, verifyCustomer, async (req, res) => {
  const serviceIdInput = str(req.body?.serviceId);
  const serviceId = toId(serviceIdInput);
  if (!serviceId) return res.status(404).json({ success: false, message: "Service not found" });

  const customerPhone = str(req.body?.customerPhone);
  const address = str(req.body?.address);
  const problemDescription = str(req.body?.problemDescription);
  const preferredDate = parsePreferredDate(req.body?.preferredDate);

  if (digits(customerPhone).length < 10 || digits(customerPhone).length > 15) {
    return res.status(400).json({ success: false, message: "A valid phone number is required" });
  }
  if (address.length < 10 || address.length > 500) {
    return res
      .status(400)
      .json({ success: false, message: "Address must be between 10 and 500 characters" });
  }
  if (problemDescription.length < 20 || problemDescription.length > 3000) {
    return res
      .status(400)
      .json({ success: false, message: "Problem description must be between 20 and 3000 characters" });
  }
  if (!preferredDate) {
    return res
      .status(400)
      .json({ success: false, message: "Preferred date must be today or later" });
  }

  const service = await services().findOne({
    _id: serviceId,
    approvalStatus: "approved",
    isAvailable: true,
  });
  if (!service) {
    return res.status(404).json({ success: false, message: "Service not found or unavailable" });
  }
  if (service.technicianEmail === req.user.email) {
    return res.status(403).json({ success: false, message: "You cannot request your own service" });
  }

  const active = await bookings().findOne({
    serviceId: String(service._id),
    customerEmail: req.user.email,
    status: { $in: ACTIVE_STATUSES },
  });
  if (active) {
    return res
      .status(409)
      .json({ success: false, message: "You already have an active request for this service" });
  }

  const now = new Date();
  const doc = {
    serviceId: String(service._id),
    serviceTitle: service.title,
    serviceImage: service.image,
    category: service.category,
    serviceMode: service.serviceMode,
    serviceArea: service.serviceArea,
    basePrice: service.basePrice,
    technicianName: service.technicianName,
    technicianEmail: service.technicianEmail,
    customerName: req.user.name,
    customerEmail: req.user.email,
    customerPhone,
    address,
    preferredDate,
    problemDescription,
    status: "requested",
    finalAmount: service.basePrice,
    paymentStatus: "unpaid",
    statusHistory: [{ status: "requested", at: now }],
    createdAt: now,
  };

  try {
    const result = await bookings().insertOne(doc);
    res.status(201).json({ ...doc, _id: result.insertedId });
  } catch (error) {
    if (error?.code === 11000) {
      return res
        .status(409)
        .json({ success: false, message: "You already have an active request for this service" });
    }
    throw error;
  }
});

app.get("/api/bookings/my", verifyToken, verifyCustomer, async (req, res) => {
  const items = await bookings()
    .find({ customerEmail: req.user.email })
    .sort({ createdAt: -1 })
    .toArray();
  res.json({ items });
});

app.patch("/api/bookings/:id/cancel", verifyToken, verifyCustomer, async (req, res) => {
  const _id = toId(req.params.id);
  if (!_id) return res.status(404).json({ success: false, message: "Booking not found" });

  const booking = await bookings().findOne({ _id });
  if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
  if (booking.customerEmail !== req.user.email) {
    return res.status(403).json({ success: false, message: "Forbidden: this is not your booking" });
  }
  if (booking.status !== "requested") {
    return res
      .status(400)
      .json({ success: false, message: "Only a requested booking can be cancelled" });
  }

  const now = new Date();
  const updated = await bookings().findOneAndUpdate(
    { _id, customerEmail: req.user.email, status: "requested" },
    {
      $set: { status: "cancelled" },
      $push: { statusHistory: { status: "cancelled", at: now } },
    },
    { returnDocument: "after" }
  );
  if (!updated) {
    return res
      .status(409)
      .json({ success: false, message: "This booking was just updated. Please refresh." });
  }
  res.json(updated);
});

// Technician bookings
app.get("/api/bookings/technician", verifyToken, verifyTechnician, async (req, res) => {
  const filter = { technicianEmail: req.user.email };
  const status = str(req.query.status);
  if (BOOKING_STATUSES.includes(status)) filter.status = status;

  const items = await bookings().find(filter).sort({ createdAt: -1 }).toArray();
  res.json({ items });
});

app.get("/api/bookings/:id", verifyToken, async (req, res) => {
  const _id = toId(req.params.id);
  if (!_id) return res.status(404).json({ success: false, message: "Booking not found" });

  const booking = await bookings().findOne({ _id });
  if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

  const allowed =
    req.user.role === "admin" ||
    booking.customerEmail === req.user.email ||
    booking.technicianEmail === req.user.email;
  if (!allowed) return res.status(403).json({ success: false, message: "Forbidden" });

  res.json(booking);
});

app.patch("/api/bookings/:id/status", verifyToken, verifyTechnician, async (req, res) => {
  const _id = toId(req.params.id);
  if (!_id) return res.status(404).json({ success: false, message: "Booking not found" });

  const status = str(req.body?.status);
  const booking = await bookings().findOne({ _id });
  if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
  if (booking.technicianEmail !== req.user.email) {
    return res
      .status(403)
      .json({ success: false, message: "Forbidden: this booking belongs to another technician" });
  }
  if (!NEXT_STATUS[booking.status]?.includes(status)) {
    return res.status(400).json({
      success: false,
      message: `Invalid status change: ${booking.status} -> ${status || "?"}`,
    });
  }

  const update = { status };
  if (status === "completed") {
    const amount = Number(req.body?.finalAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "finalAmount must be a number greater than 0" });
    }
    update.finalAmount = Math.round(amount * 100) / 100;
  }

  const now = new Date();
  const updated = await bookings().findOneAndUpdate(
    { _id, technicianEmail: req.user.email, status: booking.status },
    {
      $set: update,
      $push: { statusHistory: { status, at: now } },
    },
    { returnDocument: "after" }
  );
  if (!updated) {
    return res
      .status(409)
      .json({ success: false, message: "This booking was just updated. Please refresh." });
  }
  res.json(updated);
});

// Admin
app.get("/api/admin/users", verifyToken, verifyAdmin, async (_req, res) => {
  const items = await users().find({}).sort({ createdAt: -1 }).toArray();
  res.json({ items: items.map(publicUser) });
});

app.patch("/api/admin/users/:id/role", verifyToken, verifyAdmin, async (req, res) => {
  const role = str(req.body?.role);
  if (!ROLES.includes(role)) {
    return res.status(400).json({ success: false, message: "Invalid role" });
  }

  const target = await findUserById(req.params.id);
  if (!target) return res.status(404).json({ success: false, message: "User not found" });
  if (target.email === req.user.email || String(target._id) === req.user.id) {
    return res
      .status(403)
      .json({ success: false, message: "You cannot change your own role" });
  }

  await users().updateOne({ _id: target._id }, { $set: { role, updatedAt: new Date() } });
  res.json({ success: true, user: publicUser({ ...target, role }) });
});

app.get("/api/admin/services", verifyToken, verifyAdmin, async (req, res) => {
  const approvalStatus = str(req.query.approvalStatus) || str(req.query.status);
  const filter = ["pending", "approved", "rejected"].includes(approvalStatus)
    ? { approvalStatus }
    : {};
  const items = await services().find(filter).sort({ createdAt: -1 }).toArray();
  const rank = { pending: 0, approved: 1, rejected: 2 };
  items.sort((a, b) => (rank[a.approvalStatus] ?? 9) - (rank[b.approvalStatus] ?? 9));
  res.json({ items });
});

app.patch("/api/admin/services/:id/approval", verifyToken, verifyAdmin, async (req, res) => {
  const _id = toId(req.params.id);
  if (!_id) return res.status(404).json({ success: false, message: "Service not found" });

  const approvalStatus = str(req.body?.approvalStatus);
  if (!["approved", "rejected"].includes(approvalStatus)) {
    return res
      .status(400)
      .json({ success: false, message: "approvalStatus must be approved or rejected" });
  }

  const updated = await services().findOneAndUpdate(
    { _id },
    { $set: { approvalStatus } },
    { returnDocument: "after" }
  );
  if (!updated) return res.status(404).json({ success: false, message: "Service not found" });
  res.json(updated);
});

app.get("/api/admin/bookings", verifyToken, verifyAdmin, async (_req, res) => {
  const items = await bookings().find({}).sort({ createdAt: -1 }).toArray();
  res.json({ items });
});

app.get("/api/admin/payments", verifyToken, verifyAdmin, async (_req, res) => {
  const [items, totals] = await Promise.all([
    payments().find({}).sort({ paidAt: -1 }).toArray(),
    payments().aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }]).toArray(),
  ]);
  res.json({ items, totalRevenue: totals[0]?.total ?? 0 });
});

// Profile
app.patch("/api/users/profile", verifyToken, async (req, res) => {
  if (
    Object.prototype.hasOwnProperty.call(req.body ?? {}, "email") ||
    Object.prototype.hasOwnProperty.call(req.body ?? {}, "role")
  ) {
    return res
      .status(400)
      .json({ success: false, message: "Email and role cannot be changed here" });
  }

  const name = str(req.body?.name);
  const phone = str(req.body?.phone);
  const area = str(req.body?.area);
  const bio = str(req.body?.bio);

  if (name.length < 2 || name.length > 80) {
    return res
      .status(400)
      .json({ success: false, message: "Name must be between 2 and 80 characters" });
  }
  if (phone && (digits(phone).length < 7 || digits(phone).length > 15)) {
    return res.status(400).json({ success: false, message: "Enter a valid phone number" });
  }
  if (phone.length > 25 || area.length > 80 || bio.length > 300) {
    return res.status(400).json({ success: false, message: "Profile fields are too long" });
  }

  const update = { name, phone, area, bio, updatedAt: new Date() };
  if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "image")) {
    const image = str(req.body.image);
    if (image && !hostedImage(image)) {
      return res.status(400).json({ success: false, message: "Image must be a hosted URL" });
    }
    update.image = image;
  }

  const updated = await users().findOneAndUpdate(
    { email: req.user.email },
    { $set: update },
    { returnDocument: "after" }
  );
  if (!updated) return res.status(404).json({ success: false, message: "User not found" });
  res.json(publicUser(updated));
});

app.use((_req, res) => res.status(404).json({ success: false, message: "Route not found" }));

// eslint-disable-next-line no-unused-vars
app.use((error, _req, res, _next) => {
  console.error(error);
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ success: false, message: "Invalid JSON body" });
  }
  if (error.type === "entity.too.large") {
    return res.status(413).json({ success: false, message: "Request body too large" });
  }
  if (error.code === 11000) {
    return res.status(409).json({ success: false, message: "Duplicate record" });
  }
  if (
    [
      "MongoServerSelectionError",
      "MongoNetworkError",
      "MongoTopologyClosedError",
      "MongoNotConnectedError",
    ].includes(error.name)
  ) {
    return res.status(503).json({ success: false, message: "Database unavailable" });
  }
  const status = error.status && error.status < 600 ? error.status : 500;
  res.status(status).json({
    success: false,
    message: status === 500 ? "Internal server error" : error.message,
  });
});

const port = Number(process.env.PORT) || 5000;

connectDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`ThikHobe API running on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error(`MongoDB connection failed: ${error.message}`);
    process.exit(1);
  });
