import "dotenv/config";

import cors from "cors";
import express from "express";

import {
  bookings,
  connectDb,
  findUserById,
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
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

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

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

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

  const doc = {
    serviceId: String(service._id),
    serviceTitle: service.title,
    serviceImage: service.image,
    category: service.category,
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
    createdAt: new Date(),
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

  const updated = await bookings().findOneAndUpdate(
    { _id, customerEmail: req.user.email, status: "requested" },
    { $set: { status: "cancelled" } },
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

  const updated = await bookings().findOneAndUpdate(
    { _id, technicianEmail: req.user.email, status: booking.status },
    { $set: update },
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
      console.log(`FixMate API running on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error(`MongoDB connection failed: ${error.message}`);
    process.exit(1);
  });
