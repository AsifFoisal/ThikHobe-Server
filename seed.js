import "dotenv/config";

import { closeDb, connectDb } from "./db.js";

const authUrl = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const password = process.env.SEED_PASSWORD ?? "Demo1234";

const demoUsers = [
  {
    name: "FixMate Admin",
    email: "admin@fixmate.test",
    role: "admin",
    phone: "+880 1911 444 555",
    area: "Gulshan, Dhaka",
    bio: "Platform operations lead.",
  },
  {
    name: "Rafiul Islam",
    email: "rafi@fixmate.test",
    role: "technician",
    phone: "+880 1811 222 333",
    area: "Dhanmondi, Dhaka",
    bio: "Board-level phone and laptop specialist with eight years of bench experience.",
  },
  {
    name: "Nusrat Jahan",
    email: "nusrat@fixmate.test",
    role: "technician",
    phone: "+880 1811 222 334",
    area: "Mirpur, Dhaka",
    bio: "Certified laptop and appliance technician focused on same-day diagnostics.",
  },
  {
    name: "Tanvir Ahmed",
    email: "tanvir@fixmate.test",
    role: "customer",
    phone: "+880 1711 000 000",
    area: "Dhanmondi, Dhaka",
    bio: "Keeps the appliances at home running without the guesswork.",
  },
];

const serviceRows = [
  ["iPhone Screen & Battery Replacement", "Smartphone", "Original-quality screen and battery replacement with a post-repair bench test.", "/images/service-phone.jpg", 120, "1-2 hours", "Home Visit", "Dhanmondi", "rafi@fixmate.test"],
  ["Samsung Charging Port Repair", "Smartphone", "Charging port replacement and board inspection for Samsung phones.", "/images/service-smartphone.jpg", 45, "45 minutes", "Shop Drop-off", "Mirpur", "rafi@fixmate.test"],
  ["Smartphone Water Damage Treatment", "Smartphone", "Ultrasonic cleaning and corrosion treatment after liquid damage.", "/images/service-phone-alt.jpg", 55, "2 hours", "Shop Drop-off", "Mirpur", "nusrat@fixmate.test"],
  ["MacBook Logic Board Diagnosis", "Laptop & PC", "Board-level diagnosis and a written repair estimate before any work begins.", "/images/service-laptop.jpg", 90, "1 day", "Shop Drop-off", "Dhanmondi", "nusrat@fixmate.test"],
  ["Laptop Keyboard & Hinge Repair", "Laptop & PC", "Keyboard replacement, hinge tightening, and display alignment.", "/images/service-laptop-alt.jpg", 60, "2-3 hours", "Home Visit", "Mirpur", "nusrat@fixmate.test"],
  ["Split AC Service & Gas Refill", "AC", "Deep coil cleaning, filter service, and refrigerant top-up for split units.", "/images/service-ac.jpg", 85, "2-3 hours", "Home Visit", "Uttara", "rafi@fixmate.test"],
  ["Window AC Installation", "AC", "Bracket fitting, drainage, and a full cooling test for window units.", "/images/service-ac-alt.jpg", 110, "3 hours", "Home Visit", "Uttara", "rafi@fixmate.test"],
  ["Refrigerator Cooling Diagnosis", "Refrigerator", "Compressor, thermostat, and gas pressure diagnosis with a repair plan.", "/images/service-refrigerator.jpg", 70, "2 hours", "Home Visit", "Mohammadpur", "nusrat@fixmate.test"],
  ["Refrigerator Door Seal Replacement", "Refrigerator", "Door gasket replacement and leak test to restore cooling efficiency.", "/images/service-fridge-alt.jpg", 45, "1 hour", "Home Visit", "Mirpur", "rafi@fixmate.test"],
  ["Washing Machine Drum Repair", "Washing Machine", "Drum, bearing, and suspension inspection with replacement as needed.", "/images/service-washer.jpg", 95, "3 hours", "Home Visit", "Mohammadpur", "nusrat@fixmate.test"],
  ["Washing Machine Drain Pump Repair", "Washing Machine", "Drain pump replacement and a full cycle leak test.", "/images/service-washer-alt.jpg", 60, "2 hours", "Shop Drop-off", "Mirpur", "nusrat@fixmate.test"],
  ["LED TV Panel Diagnosis", "TV", "Panel, backlight, and main-board diagnosis for LED televisions.", "/images/service-tv.jpg", 65, "1-2 hours", "Shop Drop-off", "Banani", "rafi@fixmate.test"],
  ["TV Wall Mount & Setup", "TV", "Secure wall mounting, cable routing, and input setup.", "/images/service-tv.jpg", 40, "1 hour", "Home Visit", "Banani", "nusrat@fixmate.test"],
  ["Home Electrical Safety Inspection", "Electrical", "Breaker, wiring, and earthing inspection with a safety report.", "/images/service-electric.jpg", 50, "1-2 hours", "Home Visit", "Gulshan", "rafi@fixmate.test"],
  ["Ceiling Fan & Light Installation", "Electrical", "Fan and light fixture installation with balance and wiring checks.", "/images/service-electric-alt.jpg", 35, "1 hour", "Home Visit", "Gulshan", "nusrat@fixmate.test"],
];

const signUp = async (user) => {
  const response = await fetch(`${authUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: authUrl },
    body: JSON.stringify({
      name: user.name,
      email: user.email,
      password,
      // Admin is never a public registration role; it is set in the database below.
      role: user.role === "technician" ? "technician" : "customer",
    }),
  });

  if (response.status === 200 || response.status === 422) return;
  throw new Error(
    `Sign-up failed for ${user.email}: ${response.status} ${await response.text()}`
  );
};

try {
  const db = await connectDb();

  for (const user of demoUsers) {
    await signUp(user);
    await db.collection("users").updateOne(
      { email: user.email },
      {
        $set: {
          name: user.name,
          role: user.role,
          phone: user.phone,
          area: user.area,
          bio: user.bio,
          updatedAt: new Date(),
        },
      }
    );
  }

  const nameByEmail = Object.fromEntries(demoUsers.map((user) => [user.email, user.name]));
  const services = db.collection("services");
  const now = Date.now();

  for (const [index, row] of serviceRows.entries()) {
    const [title, category, description, image, basePrice, estimatedDuration, serviceMode, serviceArea, technicianEmail] = row;
    await services.updateOne(
      { title, technicianEmail },
      {
        $set: {
          title,
          category,
          description,
          image,
          basePrice,
          estimatedDuration,
          serviceMode,
          serviceArea,
          technicianName: nameByEmail[technicianEmail],
          technicianEmail,
          approvalStatus: "approved",
          isAvailable: true,
        },
        $setOnInsert: { createdAt: new Date(now - index * 86400000) },
      },
      { upsert: true }
    );
  }

  const customer = demoUsers.find((user) => user.role === "customer");
  const bookings = db.collection("bookings");
  const existingBookings = await bookings.countDocuments({ customerEmail: customer.email });

  if (!existingBookings) {
    const titles = [
      "Split AC Service & Gas Refill",
      "MacBook Logic Board Diagnosis",
      "Washing Machine Drum Repair",
      "iPhone Screen & Battery Replacement",
    ];
    const chosen = await services
      .find({ title: { $in: titles }, approvalStatus: "approved", isAvailable: true })
      .toArray();
    const byTitle = Object.fromEntries(chosen.map((service) => [service.title, service]));
    const statuses = ["requested", "accepted", "in-progress", "completed"];
    const dateOffsets = [2, 4, 6, -5];
    const createdOffsets = [-1, -3, -5, -8];
    const problems = [
      "The split unit runs but the room does not cool down and the outdoor fan sounds loud.",
      "The laptop does not power on after a power surge and the charging light stays off.",
      "The washing machine drum makes a grinding noise during the spin cycle.",
      "The screen cracked after a drop and the touch no longer works near the top edge.",
    ];

    const docs = titles.map((title, index) => {
      const service = byTitle[title];
      return {
        serviceId: String(service._id),
        serviceTitle: service.title,
        serviceImage: service.image,
        category: service.category,
        basePrice: service.basePrice,
        technicianName: service.technicianName,
        technicianEmail: service.technicianEmail,
        customerName: customer.name,
        customerEmail: customer.email,
        customerPhone: customer.phone,
        address: "Flat 4B, House 12, Road 7, Dhanmondi",
        preferredDate: new Date(now + dateOffsets[index] * 86400000),
        problemDescription: problems[index],
        status: statuses[index],
        finalAmount: service.basePrice,
        paymentStatus: "unpaid",
        createdAt: new Date(now + createdOffsets[index] * 86400000),
      };
    });

    await bookings.insertMany(docs);
  }

  console.log("Seed complete.");
  console.log(`Accounts (password: ${password}):`);
  for (const user of demoUsers) console.log(`- ${user.role}: ${user.email}`);
  console.log(`Services: ${await services.countDocuments({ approvalStatus: "approved" })} approved`);
  console.log(`Bookings: ${await bookings.countDocuments({ customerEmail: customer.email })}`);
} catch (error) {
  console.error("Seed failed:", error.message);
  console.error(`Start the Next.js app at ${authUrl} and check MONGODB_URI.`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
