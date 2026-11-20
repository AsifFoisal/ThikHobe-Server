import "dotenv/config"

import { closeDb, connectDb } from "./db.js"

const authUrl = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(
  /\/+$/,
  ""
)

const seedAccounts = [
  {
    name: "ThikHobe Admin",
    email: "admin@thikhobe.com",
    password: "admin123",
    tempPassword: "TempAdmin123",
    role: "admin",
    signupRole: "customer",
    phone: "+880 1911 444 555",
    area: "Gulshan, Dhaka",
    bio: "Platform operations lead.",
  },
  {
    name: "Rafiul Islam",
    email: "technician@thikhobe.com",
    password: "technician123",
    tempPassword: "TempTech123",
    role: "technician",
    signupRole: "technician",
    phone: "+880 1811 222 333",
    area: "Dhanmondi, Dhaka",
    bio: "Verified multi-category repair technician covering phones, laptops, and home appliances.",
  },
  {
    name: "Tanvir Ahmed",
    email: "customer@thikhobe.com",
    password: "customer123",
    tempPassword: "TempCust123",
    role: "customer",
    signupRole: "customer",
    phone: "+880 1711 000 000",
    area: "Dhanmondi, Dhaka",
    bio: "Keeps the appliances at home running without the guesswork.",
  },
]

const OLD_SEED_EMAILS = [
  "admin@thikhobe.test",
  "rafi@thikhobe.test",
  "nusrat@thikhobe.test",
  "tanvir@thikhobe.test",
]

const serviceRows = [
  {
    title: "iPhone Screen & Battery Replacement",
    category: "Smartphone",
    description:
      "Original-quality screen and battery replacement with a post-repair bench test.",
    image: "https://i.ibb.co/Pzcn39GM/62ca61656732.jpg",
    basePrice: 120,
    estimatedDuration: "1-2 hours",
    serviceMode: "Home Visit",
    serviceArea: "Dhanmondi",
    approvalStatus: "approved",
  },
  {
    title: "Samsung Charging Port Repair",
    category: "Smartphone",
    description:
      "Charging port replacement and board inspection for Samsung phones.",
    image: "https://i.ibb.co/LdjsQMCM/71920d00fc19.jpg",
    basePrice: 45,
    estimatedDuration: "45 minutes",
    serviceMode: "Shop Drop-off",
    serviceArea: "Mirpur",
    approvalStatus: "approved",
  },
  {
    title: "MacBook Logic Board Diagnosis",
    category: "Laptop & PC",
    description:
      "Board-level diagnosis and a written repair estimate before any work begins.",
    image: "https://i.ibb.co/SwLSgc3s/37259923e039.jpg",
    basePrice: 90,
    estimatedDuration: "1 day",
    serviceMode: "Shop Drop-off",
    serviceArea: "Dhanmondi",
    approvalStatus: "approved",
  },
  {
    title: "Laptop Keyboard & Hinge Repair",
    category: "Laptop & PC",
    description:
      "Keyboard replacement, hinge tightening, and display alignment.",
    image: "https://i.ibb.co/f3XW8Jq/43e3249f240c.jpg",
    basePrice: 60,
    estimatedDuration: "2-3 hours",
    serviceMode: "Home Visit",
    serviceArea: "Mirpur",
    approvalStatus: "approved",
  },
  {
    title: "Split AC Service & Gas Refill",
    category: "AC",
    description:
      "Deep coil cleaning, filter service, and refrigerant top-up for split units.",
    image: "https://i.ibb.co/v66CR9CF/bb2cc34204e9.jpg",
    basePrice: 85,
    estimatedDuration: "2-3 hours",
    serviceMode: "Home Visit",
    serviceArea: "Uttara",
    approvalStatus: "approved",
  },
  {
    title: "Refrigerator Cooling Diagnosis",
    category: "Refrigerator",
    description:
      "Compressor, thermostat, and gas pressure diagnosis with a repair plan.",
    image: "https://i.ibb.co/5X7xQx11/100f40d96407.jpg",
    basePrice: 70,
    estimatedDuration: "2 hours",
    serviceMode: "Home Visit",
    serviceArea: "Mohammadpur",
    approvalStatus: "approved",
  },
  {
    title: "Washing Machine Drum Repair",
    category: "Washing Machine",
    description:
      "Drum, bearing, and suspension inspection with replacement as needed.",
    image: "https://i.ibb.co/VWM1wmVN/61c8e9ee1870.jpg",
    basePrice: 95,
    estimatedDuration: "3 hours",
    serviceMode: "Home Visit",
    serviceArea: "Mohammadpur",
    approvalStatus: "approved",
  },
  {
    title: "LED TV Panel Diagnosis",
    category: "TV",
    description:
      "Panel, backlight, and main-board diagnosis for LED televisions.",
    image: "https://i.ibb.co/27XDhbWd/b3a45b7b8f7e.jpg",
    basePrice: 65,
    estimatedDuration: "1-2 hours",
    serviceMode: "Shop Drop-off",
    serviceArea: "Banani",
    approvalStatus: "approved",
  },
  {
    title: "Home Electrical Safety Inspection",
    category: "Electrical",
    description:
      "Breaker, wiring, and earthing inspection with a safety report.",
    image: "https://i.ibb.co/Z4yfft0/1f8b228796b0.jpg",
    basePrice: 50,
    estimatedDuration: "1-2 hours",
    serviceMode: "Home Visit",
    serviceArea: "Gulshan",
    approvalStatus: "approved",
  },
  {
    title: "Smartphone Water Damage Treatment",
    category: "Smartphone",
    description:
      "Ultrasonic cleaning and corrosion treatment after liquid damage.",
    image: "https://i.ibb.co/Pzcn39GM/62ca61656732.jpg",
    basePrice: 55,
    estimatedDuration: "2 hours",
    serviceMode: "Shop Drop-off",
    serviceArea: "Mirpur",
    approvalStatus: "pending",
  },
  {
    title: "Refrigerator Door Seal Replacement",
    category: "Refrigerator",
    description:
      "Door gasket replacement and leak test to restore cooling efficiency.",
    image: "https://i.ibb.co/FL53H59N/ce85f812606f.jpg",
    basePrice: 45,
    estimatedDuration: "1 hour",
    serviceMode: "Home Visit",
    serviceArea: "Mirpur",
    approvalStatus: "pending",
  },
  {
    title: "Washing Machine Drain Pump Repair",
    category: "Washing Machine",
    description:
      "Drain pump replacement and a full cycle leak test.",
    image: "https://i.ibb.co/Ng7jnp2t/64ebf69e5531.jpg",
    basePrice: 60,
    estimatedDuration: "2 hours",
    serviceMode: "Shop Drop-off",
    serviceArea: "Mirpur",
    approvalStatus: "pending",
  },
  {
    title: "Ceiling Fan & Light Installation",
    category: "Electrical",
    description:
      "Fan and light fixture installation with balance and wiring checks.",
    image: "https://i.ibb.co/DgDpW56x/ad17a1140439.jpg",
    basePrice: 35,
    estimatedDuration: "1 hour",
    serviceMode: "Home Visit",
    serviceArea: "Gulshan",
    approvalStatus: "pending",
  },
  {
    title: "Window AC Installation",
    category: "AC",
    description:
      "Bracket fitting, drainage, and a full cooling test for window units.",
    image: "https://i.ibb.co/TBdKkm0s/8483346c145f.jpg",
    basePrice: 110,
    estimatedDuration: "3 hours",
    serviceMode: "Home Visit",
    serviceArea: "Uttara",
    approvalStatus: "rejected",
  },
  {
    title: "TV Wall Mount & Setup",
    category: "TV",
    description:
      "Secure wall mounting, cable routing, and input setup.",
    image: "https://i.ibb.co/27XDhbWd/b3a45b7b8f7e.jpg",
    basePrice: 40,
    estimatedDuration: "1 hour",
    serviceMode: "Home Visit",
    serviceArea: "Banani",
    approvalStatus: "rejected",
  },
]

const bookingSeeds = [
  {
    title: "Split AC Service & Gas Refill",
    status: "completed",
    paymentStatus: "paid",
    createdAtDays: -24,
    preferredDateDays: -22,
    stageDays: [-24, -23, -22, -21, -20],
    problem:
      "The split unit runs but the room does not cool down and the outdoor fan sounds loud.",
  },
  {
    title: "iPhone Screen & Battery Replacement",
    status: "completed",
    paymentStatus: "paid",
    createdAtDays: -16,
    preferredDateDays: -14,
    stageDays: [-16, -15, -14, -13, -12],
    problem:
      "The screen cracked after a drop and the battery drains within a couple of hours.",
  },
  {
    title: "MacBook Logic Board Diagnosis",
    status: "in-progress",
    paymentStatus: "unpaid",
    createdAtDays: -5,
    preferredDateDays: 2,
    stageDays: [-5, -4, -3],
    problem:
      "The laptop does not power on after a power surge and the charging light stays off.",
  },
  {
    title: "Washing Machine Drum Repair",
    status: "in-progress",
    paymentStatus: "unpaid",
    createdAtDays: -3,
    preferredDateDays: 3,
    stageDays: [-3, -2, -1],
    problem:
      "The washing machine drum makes a grinding noise during the spin cycle.",
  },
  {
    title: "LED TV Panel Diagnosis",
    status: "accepted",
    paymentStatus: "unpaid",
    createdAtDays: -1,
    preferredDateDays: 5,
    stageDays: [-1, 0],
    problem:
      "The television turns on but the right side of the panel stays dark after a few minutes.",
  },
]

const sessionCookie = (response) => {
  const values =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean)

  return values.map((value) => value.split(";")[0]).join("; ")
}

async function requestJson(url, options, label) {
  const response = await fetch(url, options)
  const text = await response.text()
  let data

  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }

  if (!response.ok) {
    throw new Error(
      `${label} failed: ${response.status} ${
        typeof data === "string" ? data : JSON.stringify(data)
      }`
    )
  }

  return { response, data }
}

async function signIn(account) {
  const { response, data } = await requestJson(
    `${authUrl}/api/auth/sign-in/email`,
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: authUrl },
      body: JSON.stringify({
        email: account.email,
        password: account.password,
      }),
    },
    `sign-in ${account.email}`
  )

  return { cookie: sessionCookie(response), user: data?.user }
}

async function signUp(account) {
  const { response } = await requestJson(
    `${authUrl}/api/auth/sign-up/email`,
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: authUrl },
      body: JSON.stringify({
        name: account.name,
        email: account.email,
        password: account.tempPassword,
        role: account.signupRole,
        phone: account.phone,
        area: account.area,
        bio: account.bio,
      }),
    },
    `sign-up ${account.email}`
  )

  return sessionCookie(response)
}

async function changePassword(account, cookie) {
  await requestJson(
    `${authUrl}/api/auth/change-password`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: authUrl,
        cookie,
      },
      body: JSON.stringify({
        currentPassword: account.tempPassword,
        newPassword: account.password,
        revokeOtherSessions: true,
      }),
    },
    `change-password ${account.email}`
  )
}

async function signOut(cookie) {
  await fetch(`${authUrl}/api/auth/sign-out`, {
    method: "POST",
    headers: { origin: authUrl, cookie },
  }).catch(() => {})
}

async function ensureAccount(db, account) {
  let session

  try {
    session = await signIn(account)
    console.log(`Account exists: ${account.email}`)
  } catch {
    const signupCookie = await signUp(account)
    console.log(`Account created: ${account.email}`)
    await changePassword(account, signupCookie)
    await signOut(signupCookie)
    session = await signIn(account)
  }

  await db.collection("users").updateOne(
    { email: account.email },
    {
      $set: {
        name: account.name,
        role: account.role,
        phone: account.phone,
        area: account.area,
        bio: account.bio,
        updatedAt: new Date(),
      },
    }
  )

  // Refresh after the role update so the session carries the final role.
  await signOut(session.cookie)
  session = await signIn(account)

  if (session.user?.role !== account.role) {
    throw new Error(
      `${account.email} signed in with role ${session.user?.role ?? "unknown"}, expected ${account.role}`
    )
  }

  await signOut(session.cookie)
  console.log(`Verified account: ${account.email} (${account.role})`)
}

async function removeOldSeedUsers(db) {
  const oldUsers = await db
    .collection("users")
    .find({ email: { $in: OLD_SEED_EMAILS } })
    .toArray()

  for (const user of oldUsers) {
    const ids = [user.id, String(user._id)].filter(Boolean)
    await db.collection("account").deleteMany({ userId: { $in: ids } })
    await db.collection("session").deleteMany({ userId: { $in: ids } })
    await db.collection("users").deleteOne({ _id: user._id })
  }

  await db
    .collection("verification")
    .deleteMany({ identifier: { $in: OLD_SEED_EMAILS } })
    .catch(() => {})

  return oldUsers.length
}

const dateFromNow = (days) => new Date(Date.now() + days * 86400000)

const stagesFor = (status, paymentStatus) => {
  const stages =
    status === "completed"
      ? ["requested", "accepted", "in-progress", "completed"]
      : status === "in-progress"
        ? ["requested", "accepted", "in-progress"]
        : ["requested", "accepted"]

  return paymentStatus === "paid" ? [...stages, "paid"] : stages
}

try {
  const db = await connectDb()

  console.log("Ensuring seed accounts...")
  for (const account of seedAccounts) {
    await ensureAccount(db, account)
  }

  console.log("Clearing previous seed data...")
  await Promise.all([
    db.collection("bookings").deleteMany({}),
    db.collection("payments").deleteMany({}),
    db.collection("services").deleteMany({}),
  ])
  const removedUsers = await removeOldSeedUsers(db)
  console.log(
    `Cleared services, bookings, and payments; removed ${removedUsers} old demo accounts`
  )

  console.log("Creating services...")
  const now = Date.now()
  const serviceDocs = serviceRows.map((row, index) => ({
    ...row,
    technicianName: "Rafiul Islam",
    technicianEmail: "technician@thikhobe.com",
    isAvailable: true,
    createdAt: new Date(now - index * 86400000),
  }))

  const serviceResult = await db.collection("services").insertMany(serviceDocs)
  const servicesWithIds = serviceDocs.map((service, index) => ({
    ...service,
    _id: serviceResult.insertedIds[index],
  }))
  const serviceByTitle = Object.fromEntries(
    servicesWithIds.map((service) => [service.title, service])
  )

  console.log(`Created ${servicesWithIds.length} services`)

  console.log("Creating customer bookings...")
  const customer = seedAccounts.find((account) => account.role === "customer")

  if (!customer) {
    throw new Error("No seed customer account found")
  }

  const bookingDocs = bookingSeeds.map((seed) => {
    const service = serviceByTitle[seed.title]

    if (!service) {
      throw new Error(`Missing approved service for booking: ${seed.title}`)
    }

    const statusHistory = stagesFor(seed.status, seed.paymentStatus).map(
      (status, index) => ({
        status,
        at: dateFromNow(seed.stageDays[index]),
      })
    )

    return {
      serviceId: String(service._id),
      serviceTitle: service.title,
      serviceImage: service.image,
      category: service.category,
      serviceMode: service.serviceMode,
      serviceArea: service.serviceArea,
      basePrice: service.basePrice,
      technicianName: service.technicianName,
      technicianEmail: service.technicianEmail,
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone,
      address: "Flat 4B, House 12, Road 7, Dhanmondi",
      preferredDate: dateFromNow(seed.preferredDateDays),
      problemDescription: seed.problem,
      status: seed.status,
      finalAmount: service.basePrice,
      paymentStatus: seed.paymentStatus,
      statusHistory,
      createdAt: dateFromNow(seed.createdAtDays),
    }
  })

  const bookingResult = await db.collection("bookings").insertMany(bookingDocs)
  const bookingsWithIds = bookingDocs.map((booking, index) => ({
    ...booking,
    _id: bookingResult.insertedIds[index],
  }))

  const paymentDocs = bookingsWithIds
    .filter((booking) => booking.paymentStatus === "paid")
    .map((booking, index) => ({
      bookingId: String(booking._id),
      serviceTitle: booking.serviceTitle,
      customerName: booking.customerName,
      customerEmail: booking.customerEmail,
      technicianName: booking.technicianName,
      technicianEmail: booking.technicianEmail,
      amount: booking.finalAmount,
      currency: "usd",
      transactionId: `pi_seed_paid_${index + 1}`,
      stripeSessionId: `cs_seed_paid_${index + 1}`,
      paymentStatus: "paid",
      paidAt:
        booking.statusHistory.find((entry) => entry.status === "paid")?.at ??
        booking.createdAt,
    }))

  if (paymentDocs.length) {
    await db.collection("payments").insertMany(paymentDocs)
  }

  const statusCounts = servicesWithIds.reduce((counts, service) => {
    counts[service.approvalStatus] =
      (counts[service.approvalStatus] ?? 0) + 1
    return counts
  }, {})

  console.log("Seed complete.")
  console.log("Accounts:")
  for (const account of seedAccounts) {
    console.log(`- ${account.role}: ${account.email} / ${account.password}`)
  }
  console.log(
    `Services: ${servicesWithIds.length} total — ${statusCounts.approved ?? 0} approved, ${statusCounts.pending ?? 0} pending, ${statusCounts.rejected ?? 0} rejected`
  )
  console.log(
    `Customer bookings: ${bookingsWithIds.length} — 2 paid/completed, 2 in progress, 1 accepted`
  )
  console.log(`Payments: ${paymentDocs.length} paid`)
} catch (error) {
  console.error("Seed failed:", error.message)
  console.error(`Start the Next.js app at ${authUrl} and check MONGODB_URI.`)
  process.exitCode = 1
} finally {
  await closeDb()
}
