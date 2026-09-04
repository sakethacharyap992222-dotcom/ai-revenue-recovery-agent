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

## Demo flow

1. Sign in with the demo credentials.
2. Open **Payments** and choose **AI Analyze** on a failed payment.
3. Review the priority and recommendation in **Recovery Queue**.
4. Select **Simulate** to record a bounded recovery action.

Do not commit `.env` or real payment credentials.
