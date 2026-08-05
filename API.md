# REST API

Base URL: `/api/v1`. Responses use `{ data }` on success and `{ error: { code, message } }` on failure. Use `Authorization: Bearer <accessToken>`.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` |
| Public courses | `GET /courses`, `GET /courses/:slug` |
| Learning | `GET /learning/me`, `PATCH /learning/lessons/:lessonId/progress` |
| Exams | `GET /exams/:id`, `POST /exams/:id/attempts`, `POST /exams/attempts/:id/submit` |
| Operations | `POST /attendance`, `GET /attendance?batchId=...` |
| Payments | `POST /payments/razorpay/order`, `POST /payments/razorpay/webhook` |
| Administration | `GET /admin/overview`, `GET /admin/users`, `PATCH /admin/users/:id/role` |

Every write is validated with Zod. Payment webhooks must use raw request bodies and provider signature verification before marking an invoice paid. Add idempotency keys for all payment and external-provider writes in the production gateway adapter.
