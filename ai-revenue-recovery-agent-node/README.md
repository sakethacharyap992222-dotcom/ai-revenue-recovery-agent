# AI Revenue Recovery Agent
# RecoverAI

RecoverAI is a revenue recovery dashboard that turns failed payments into prioritized, reviewable recovery actions.

## What is included

HTML + CSS + JavaScript -> Node.js + Express -> PostgreSQL -> Razorpay order API -> transparent AI rule engine.

The AI decision engine is intentionally rule-based and explainable for this demo. It considers payment amount, failure reason, and customer risk score.

## Run without Docker
1. Install Node.js and PostgreSQL directly on Windows.
2. Create PostgreSQL database `revenue_recovery`.
3. Copy `.env.example` to `.env` and set your local PostgreSQL password.
4. In a terminal, run `npm install` and then `npm run dev`.
5. Open `http://localhost:3000`.

Demo login: admin@example.com / admin123

The app falls back to seeded demo data when PostgreSQL is unavailable. Razorpay order creation is test-ready through the backend; add TEST credentials to `.env` before creating orders.

Set `SESSION_SECRET` to a long random value in Vercel and local `.env` files. It keeps login tokens valid across serverless requests and deployments.

## Deploy with Vercel + PostgreSQL

Vercel's original Postgres product is no longer available for new databases. Create a Postgres database through a Marketplace storage integration such as Neon, then connect it to this Vercel project. The integration injects its credentials as environment variables.

1. In the Vercel dashboard, open this project's **Storage** tab, create a Postgres integration (Neon is a good default), and connect it to both **Preview** and **Production**.
2. In **Project Settings → Environment Variables**, set `DATABASE_URL` for Preview and Production to the database connection string supplied by the integration. If the integration only provides `POSTGRES_URL`, the app accepts that too.
3. Add a long, unique `SESSION_SECRET` in those same environments. Add the Razorpay variables only if payment-order creation is required.
4. Redeploy. On the first request the app creates its tables and seed data automatically. The database account must have permission to create tables.
5. Visit `/api/health`; it should return `"mode": "database"` and `"database": "connected"`.

To provision through the Vercel CLI instead, link the project and run `vercel integration add neon`, selecting Preview and Production when prompted. Then map the injected connection string to `DATABASE_URL` if the provider did not use that name. Pull development credentials with `vercel env pull` rather than copying production secrets into source control.

## Demo flow

1. Sign in with the demo credentials.
2. Open **Payments** and choose **AI Analyze** on a failed payment.
3. Review the priority and recommendation in **Recovery Queue**.
4. Select **Simulate** to record a bounded recovery action.

Do not commit `.env` or real payment credentials.
