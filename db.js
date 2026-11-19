import "dotenv/config";

import { MongoClient, ObjectId } from "mongodb";

const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME ?? "fixmate";

let client;
let database;

export const toId = (id) =>
  typeof id === "string" && ObjectId.isValid(id) && String(new ObjectId(id)) === id
    ? new ObjectId(id)
    : null;

export const getDb = () => {
  if (!database) throw new Error("Database is not connected");
  return database;
};

export const users = () => getDb().collection("users");
export const services = () => getDb().collection("services");
export const bookings = () => getDb().collection("bookings");
export const payments = () => getDb().collection("payments");

export const findUserById = async (id) => {
  const value = typeof id === "string" ? id : "";
  const objectId = toId(value);
  if (!objectId && !value) return null;

  return users().findOne({
    $or: [...(objectId ? [{ _id: objectId }] : []), { id: value }],
  });
};

export const findUserByEmail = (email) => users().findOne({ email });

export const publicUser = (user) => ({
  _id: String(user._id),
  id: String(user.id ?? user._id),
  name: user.name,
  email: user.email,
  image: user.image ?? "",
  role: user.role || "customer",
  phone: user.phone || "",
  area: user.area || "",
  bio: user.bio || "",
  createdAt: user.createdAt,
});

export async function connectDb() {
  if (database) return database;
  if (!mongoUri) throw new Error("MONGODB_URI is required");

  client = new MongoClient(mongoUri);
  try {
    await client.connect();
    database = client.db(dbName);
    await ensureIndexes(database);
    return database;
  } catch (error) {
    await client.close().catch(() => {});
    client = undefined;
    database = undefined;
    throw error;
  }
}

export async function closeDb() {
  await client?.close();
  client = undefined;
  database = undefined;
}

// Indexes are created once at startup before the HTTP listener starts.
async function ensureIndexes(db) {
  await Promise.all([
    db.collection("services").createIndex({
      approvalStatus: 1,
      isAvailable: 1,
      createdAt: -1,
    }),
    db.collection("services").createIndex({
      approvalStatus: 1,
      isAvailable: 1,
      basePrice: 1,
    }),
    db.collection("services").createIndex({ technicianEmail: 1 }),
    db.collection("services").createIndex({ category: 1 }),
    db.collection("services").createIndex({ serviceMode: 1 }),

    db.collection("bookings").createIndex({ customerEmail: 1, createdAt: -1 }),
    db.collection("bookings").createIndex({ technicianEmail: 1, createdAt: -1 }),
    db.collection("bookings").createIndex({ status: 1 }),
    db.collection("bookings").createIndex(
      { serviceId: 1, customerEmail: 1 },
      {
        name: "active_booking_unique",
        unique: true,
        partialFilterExpression: {
          status: { $in: ["requested", "accepted", "in-progress"] },
        },
      }
    ),

    db.collection("payments").createIndex({ bookingId: 1 }, { unique: true }),
    db.collection("payments").createIndex({ stripeSessionId: 1 }, { unique: true }),
    db.collection("payments").createIndex({ customerEmail: 1, paidAt: -1 }),
    db.collection("payments").createIndex({ technicianEmail: 1 }),
  ]);
}
