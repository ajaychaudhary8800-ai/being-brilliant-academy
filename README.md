# Being Brilliant Academy

Production-oriented EdTech monorepo for online learning and offline coaching operations. It contains a Next.js student-facing experience and an Express/Prisma API with role-aware portals for Super Admin, Branch Admin, Teacher, Student and Parent.

## Included foundations

- JWT access/refresh sessions, password hashing, refresh-token rotation, RBAC, validation, rate limiting and security headers.
- Course/LMS data model, enrolments, progress, CBT exams, assignments, offline branches/batches, attendance, invoices, coupons, support tickets, notifications and audit logs.
- Responsive premium marketing site, dark mode, course discovery, learner dashboard, teacher and administrator screens.
- Razorpay order creation and verified webhook endpoint; Stripe is intentionally configured through environment variables for a provider adapter extension.
- SEO metadata, sitemap, robots, JSON-LD, PWA manifest and a Docker local stack.

## Quick start

1. Copy `.env.example` to `.env` and replace development secrets.
2. Run `docker compose up -d postgres` (or point `DATABASE_URL` to an available PostgreSQL database).
3. Run `pnpm install`.
4. Run `pnpm --filter @bba/api prisma:generate`.
5. Run `pnpm --filter @bba/api prisma:migrate -- --name init` for a new database, then `pnpm db:seed`.
6. Run `pnpm dev`, then open `http://localhost:3000/login`.

Demo credentials: `admin@beingbrilliant.in` / `ChangeMe123!` and `student@beingbrilliant.in` / `ChangeMe123!`.

## Authentication

The web client connects to `NEXT_PUBLIC_API_URL` (default: `http://localhost:4000/api/v1`). Sign in and registration issue a 15-minute JWT access token plus a rotating refresh token. Choosing **Remember me** stores the session for 30 days; otherwise it lasts 7 days in the browser session. `/dashboard` requires an authenticated user and `/admin` additionally requires `SUPER_ADMIN` or `BRANCH_ADMIN`. The API always enforces the matching JWT/RBAC checks independently of the UI.

## Architecture

`apps/web` is a Next.js App Router web/PWA frontend. `apps/api` is an Express REST service structured by domain modules. PostgreSQL is the source of truth through Prisma. All mutable APIs require an access token and authorize roles at the route boundary. Put Cloudinary/S3 access behind the media service; do not expose provider secrets to the web client.

See [API.md](API.md) and [DEPLOYMENT.md](DEPLOYMENT.md) for the route contract and deployment checklist.
