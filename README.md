# ThikHobe — Backend

REST API for **ThikHobe**, a smart device and home appliance repair platform. Customers request repairs, technicians manage services and jobs, admins moderate the marketplace, and customers pay through Stripe only after a job is completed.

## Technology stack

- Node.js and Express 5
- MongoDB Node.js driver (no ODM)
- Better Auth for authentication in the Next.js app
- JWT verification through Better Auth's JWKS endpoint using `jose`
- Stripe Checkout, payment verification, and signed webhooks (test mode)
- ImgBB for server-side image uploads

## Project structure

```text
server/
├── index.js              Express app, routes, Stripe, and error handling
├── db.js                 Single MongoDB connection, collections, and indexes
├── middleware/
│   └── auth.js           verifyToken, verifyCustomer, verifyTechnician, verifyAdmin
├── seed.js               Idempotent demo users, services, and bookings
├── .env.example
└── package.json
```

## Installation

```bash
cd server
npm install
```

Copy the environment template and fill in the values:

```bash
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env`.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | No | API port. Defaults to `5000`. |
| `CLIENT_URL` | Yes | Frontend origin used for CORS and Stripe success/cancel redirects. |
| `CORS_ORIGINS` | No | Comma-separated extra frontend origins. No wildcard is used with credentials. |
| `MONGODB_URI` | Yes | MongoDB connection string shared with the Next.js app. |
| `DB_NAME` | Yes | Database name shared with the Next.js app. |
| `BETTER_AUTH_URL` | Yes | Public origin of the Next.js Better Auth app. |
| `BETTER_AUTH_JWKS_URL` | No | Optional JWKS override. Defaults to `<BETTER_AUTH_URL>/api/auth/jwks`. |
| `JWT_ISSUER` | Yes | Must match the Next.js Better Auth JWT plugin issuer. |
| `JWT_AUDIENCE` | Yes | Must match the Next.js Better Auth JWT plugin audience. |
| `STRIPE_SECRET_KEY` | For payments | Stripe **test** secret key (`sk_test_...`). The API rejects non-test keys. |
| `STRIPE_WEBHOOK_SECRET` | For webhooks | Signing secret (`whsec_...`) for `POST /api/payments/webhook`. |
| `IMGBB_API_KEY` | For uploads | Server-only ImgBB key. Uploads return 503 when absent. |
| `SEED_PASSWORD` | No | Password for demo accounts created by `npm run seed`. Defaults to `Demo1234`. |

`BETTER_AUTH_SECRET` belongs in the Next.js `.env`, not this server. Express never receives it; it verifies tokens using the public JWKS.

Never commit a real `.env` file or any secret.

## Commands

```bash
npm run dev     # development with Node watch mode
npm start       # production start
npm run seed    # create demo users, services, and bookings
```

The server does not listen until the MongoDB connection and indexes are ready.

Seed once while the Next.js app is running, because Better Auth creates the accounts:

```bash
npm run seed
```

The seed is safe to rerun: existing users are reused, services are upserted, and bookings are not duplicated. The script creates an admin, two technicians, and a customer, and prints their emails. The password is `SEED_PASSWORD`.

## API overview

All error responses use:

```json
{ "success": false, "message": "Readable message" }
```

### Public

| Method | Endpoint | Notes |
| --- | --- | --- |
| GET | `/api/health` | Returns 200 when MongoDB responds, otherwise 503. |
| GET | `/api/services` | Approved and available services only. Supports `search`, `category`, `mode`, `sort`, `page`, `limit`. |
| GET | `/api/services/:id` | Approved and available service with technician summary. |

`sort` accepts `newest`, `price-asc`, and `price-desc` (`price_asc` / `price_desc` also work).

### Authenticated user

| Method | Endpoint | Notes |
| --- | --- | --- |
| PATCH | `/api/users/profile` | Updates `name`, `phone`, `area`, `bio`, `image`. Email and role are read-only. |
| POST | `/api/uploads` | Accepts a base64 PNG/JPEG/WebP image and returns an ImgBB URL. |

### Customer

| Method | Endpoint | Notes |
| --- | --- | --- |
| POST | `/api/bookings` | Creates a repair request. Duplicate active requests return 409. |
| GET | `/api/bookings/my` | Only the authenticated customer's bookings. |
| GET | `/api/bookings/:id` | Booking detail for its customer, technician, or an admin. |
| PATCH | `/api/bookings/:id/cancel` | Only while the booking is `requested`. |
| POST | `/api/payments/create-checkout-session` | Creates a Stripe Checkout Session for the customer's completed, unpaid booking. |
| GET | `/api/payments/verify?session_id=...` | Verifies Stripe payment and records it idempotently. |
| GET | `/api/payments/my` | Only the authenticated customer's payments. |

### Technician

| Method | Endpoint | Notes |
| --- | --- | --- |
| POST | `/api/services` | Creates a service with `approvalStatus: "pending"`. |
| GET | `/api/services/mine` | Every service owned by the authenticated technician. |
| PATCH | `/api/services/:id` | Owner only. Editing resets approval to `pending`. |
| PATCH | `/api/services/:id/availability` | Owner only. Toggles `isAvailable` without resetting approval. |
| DELETE | `/api/services/:id` | Owner only. |
| GET | `/api/bookings/technician` | Only bookings assigned to the authenticated technician. Optional `status` filter. |
| PATCH | `/api/bookings/:id/status` | Owner only. Enforces the status pipeline and completion amount. |

### Admin

| Method | Endpoint | Notes |
| --- | --- | --- |
| GET | `/api/admin/users` | Safe user list. |
| PATCH | `/api/admin/users/:id/role` | Roles: `customer`, `technician`, `admin`. Admins cannot change their own role. |
| GET | `/api/admin/services` | All services, pending first. Optional `approvalStatus` filter. |
| PATCH | `/api/admin/services/:id/approval` | `approved` or `rejected`. |
| GET | `/api/admin/bookings` | All bookings. |
| GET | `/api/admin/payments` | All payments and total revenue. |

### Stripe webhook

| Method | Endpoint | Notes |
| --- | --- | --- |
| POST | `/api/payments/webhook` | Raw-body Stripe webhook. Signature required. Handles `checkout.session.completed`. |

## Authentication

1. Better Auth runs in the Next.js application at `/api/auth/*`.
2. The client obtains a JWT from `GET /api/auth/token`.
3. The client sends `Authorization: Bearer <token>` to this API.
4. `verifyToken` verifies the JWT signature against Better Auth's JWKS and checks the configured issuer and audience.
5. The user is loaded from the `users` collection, and the role always comes from MongoDB — never from the token alone or from request bodies/URLs.

Middleware:

- `verifyToken` — missing, malformed, invalid, expired, or deleted-user tokens return 401.
- `verifyCustomer` — non-customers receive 403.
- `verifyTechnician` — non-technicians receive 403.
- `verifyAdmin` — non-admins receive 403.

## Database

The application uses exactly four collections:

| Collection | Purpose |
| --- | --- |
| `users` | Better Auth users plus `role`, `phone`, `area`, and `bio`. |
| `services` | Technician listings with approval and availability state. |
| `bookings` | Customer requests with copied service/technician snapshots. |
| `payments` | One paid Stripe transaction per booking. |

Better Auth separately manages `session`, `account`, `verification`, and `jwks`. These are not application collections.

Relationships:

- `users.email` → `services.technicianEmail`
- `services._id` → `bookings.serviceId`
- `users.email` → `bookings.customerEmail` / `bookings.technicianEmail`
- `bookings._id` → `payments.bookingId`

Booking statuses:

```text
requested → accepted → in-progress → completed
requested → rejected
requested → cancelled
```

Terminal: `completed`, `rejected`, `cancelled`.

Payment statuses: `unpaid`, `paid`.

Useful indexes:

- Unique partial index on `serviceId + customerEmail` for active bookings
- Unique `payments.bookingId`
- Unique `payments.stripeSessionId`
- Ownership, status, approval, category, mode, and price indexes

## Stripe test mode

Only Stripe test mode is accepted.

```text
Test card: 4242 4242 4242 4242
Expiry: any future date
CVC: any value
```

Webhook endpoint:

```text
POST <your-api-domain>/api/payments/webhook
```

Event: `checkout.session.completed`.

Local forwarding:

```bash
stripe listen --forward-to localhost:5000/api/payments/webhook
```

Copy the printed `whsec_...` into `STRIPE_WEBHOOK_SECRET`.

Payment rules:

- Checkout is created only for the authenticated customer's own booking.
- The booking must be `completed` and `unpaid`.
- The amount is read from `booking.finalAmount`; client amounts are ignored.
- Stripe receives `unit_amount = finalAmount * 100` in `usd`.
- Success and cancel redirects use `CLIENT_URL`.
- Cancelling checkout does not change MongoDB.
- Verification and webhook share one idempotent payment writer.
- Unique `bookingId` and `stripeSessionId` indexes prevent duplicate payments.

## ImgBB

`POST /api/uploads` is authenticated and accepts a base64 image in `{ "image": "..." }`. The server validates PNG, JPEG, or WebP signatures and a 5 MB limit, uploads to ImgBB, and returns only the hosted URL. The ImgBB key is never returned to the client.

## Error handling

- 400 — invalid data, invalid status transition, unpaid session
- 401 — missing or invalid JWT
- 403 — wrong role or ownership
- 404 — missing record or checkout session
- 409 — duplicate record or active booking
- 413 — request body too large
- 502 — Stripe or ImgBB upstream failure
- 503 — Stripe/ImgBB not configured, or database unavailable
- 500 — unexpected server error, with a generic response and no stack trace

## npm packages

Runtime: `express`, `cors`, `dotenv`, `mongodb`, `jose`, `stripe`.

No Mongoose, payment service layer, or background queue is used.

## Deployment checklist

- Set production `CLIENT_URL` and `CORS_ORIGINS`; no wildcard origin is used.
- Point `BETTER_AUTH_URL` and the JWKS URL at the deployed Next.js app.
- Register the deployed `POST /api/payments/webhook` endpoint in Stripe test mode and set its signing secret.
- Set `MONGODB_URI`, `DB_NAME`, `STRIPE_SECRET_KEY`, and `IMGBB_API_KEY` in the production environment.
