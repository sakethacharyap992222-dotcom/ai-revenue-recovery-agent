const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const { Pool } = require('pg');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const app = express();
app.disable('x-powered-by');
const PORT = 3000;
const publicDir = path.join(__dirname, 'public');
// Marketplace Postgres integrations generally provide DATABASE_URL. POSTGRES_URL
// keeps the app compatible with projects created with the earlier Vercel Postgres
// integration.
const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const runningOnVercel = Boolean(process.env.VERCEL);
const pool = dbUrl ? new Pool({
  connectionString: dbUrl,
  // A serverless function can be replicated many times, so keep each instance's
  // pool deliberately small. Local development can use a larger pool.
  max: runningOnVercel ? 1 : 10,
  idleTimeoutMillis: runningOnVercel ? 10000 : 30000,
  connectionTimeoutMillis: 5000
}) : null;

let dbMode = 'demo';
const sessionSecret = process.env.SESSION_SECRET || 'recoverai-demo-session-secret-change-me';
const sessionDurationSeconds = 7 * 24 * 60 * 60;

const demoData = {
  customers: [
    { id: 1, name: 'Rahul Kumar', email: 'rahul@example.com', company: 'Acme Labs', lifetime_value: 45000, risk_score: 87, status: 'active', created_at: new Date().toISOString() },
    { id: 2, name: 'Priya Sharma', email: 'priya@example.com', company: 'Nova Retail', lifetime_value: 28000, risk_score: 64, status: 'active', created_at: new Date().toISOString() },
    { id: 3, name: 'Arjun Mehta', email: 'arjun@example.com', company: 'Orbit Systems', lifetime_value: 92000, risk_score: 93, status: 'active', created_at: new Date().toISOString() },
    { id: 4, name: 'Sneha Rao', email: 'sneha@example.com', company: 'Bright Foods', lifetime_value: 18000, risk_score: 42, status: 'active', created_at: new Date().toISOString() }
  ],
  payments: [
    { id: 1, customer_id: 1, amount: 8500, currency: 'INR', status: 'failed', razorpay_order_id: null, razorpay_payment_id: null, failure_reason: 'Card declined', created_at: new Date().toISOString() },
    { id: 2, customer_id: 2, amount: 4200, currency: 'INR', status: 'failed', razorpay_order_id: null, razorpay_payment_id: null, failure_reason: 'Insufficient funds', created_at: new Date().toISOString() },
    { id: 3, customer_id: 3, amount: 25000, currency: 'INR', status: 'failed', razorpay_order_id: null, razorpay_payment_id: null, failure_reason: 'Bank timeout', created_at: new Date().toISOString() },
    { id: 4, customer_id: 4, amount: 1900, currency: 'INR', status: 'failed', razorpay_order_id: null, razorpay_payment_id: null, failure_reason: 'Expired card', created_at: new Date().toISOString() },
    { id: 5, customer_id: 1, amount: 32000, currency: 'INR', status: 'paid', razorpay_order_id: null, razorpay_payment_id: null, failure_reason: null, created_at: new Date().toISOString() },
    { id: 6, customer_id: 2, amount: 14500, currency: 'INR', status: 'paid', razorpay_order_id: null, razorpay_payment_id: null, failure_reason: null, created_at: new Date().toISOString() }
  ],
  recoveryCases: [
    { id: 1, customer_id: 3, payment_id: 3, amount_at_risk: 25000, priority: 'critical', status: 'in_progress', recommendation: 'Escalate the account owner and send a secure retry link for the customer’s high-value payment.', next_action: 'Escalate + send retry link', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 2, customer_id: 4, payment_id: 4, amount_at_risk: 1900, priority: 'high', status: 'open', recommendation: 'Request the customer to update their card and retry using a secure checkout flow.', next_action: 'Request card update', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  ],
  recoveryActions: []
};

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeString(value, fallback = '') {
  return value == null ? fallback : String(value);
}

function buildDemoState() {
  demoData.recoveryActions = [];
  demoData.recoveryCases = [
    { id: 1, customer_id: 3, payment_id: 3, amount_at_risk: 25000, priority: 'critical', status: 'in_progress', recommendation: 'Escalate the account owner and send a secure retry link for the customer’s high-value payment.', next_action: 'Escalate + send retry link', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 2, customer_id: 4, payment_id: 4, amount_at_risk: 1900, priority: 'high', status: 'open', recommendation: 'Request the customer to update their card and retry using a secure checkout flow.', next_action: 'Request card update', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  ];
}

function aiRecommendation(payment, customer) {
  const amount = safeNumber(payment?.amount, 0);
  const riskScore = safeNumber(customer?.risk_score, 0);
  const failureReason = safeString(payment?.failure_reason, '').toLowerCase();

  if (amount >= 20000 || riskScore >= 90) {
    return {
      priority: 'critical',
      recommendation: 'Escalate to an account owner and send a secure payment retry link with a monitored follow-up sequence.',
      next_action: 'Escalate + send retry link'
    };
  }

  if (failureReason.includes('insufficient') || failureReason.includes('funds')) {
    return {
      priority: 'high',
      recommendation: 'Suggest an alternative payment method and trigger a short recovery reminder with a low-friction retry flow.',
      next_action: 'Send payment reminder'
    };
  }

  if (failureReason.includes('expired') || failureReason.includes('card')) {
    return {
      priority: 'high',
      recommendation: 'Ask the customer to update the card details and retry the checkout with automated validation.',
      next_action: 'Request card update'
    };
  }

  if (failureReason.includes('timeout') || failureReason.includes('bank')) {
    return {
      priority: 'medium',
      recommendation: 'Retry the payment through a resilient payment flow and confirm the customer’s banking details before reattempting.',
      next_action: 'Retry payment flow'
    };
  }

  return {
    priority: 'medium',
    recommendation: 'Send a trusted payment retry link and a concise reminder designed to reduce checkout friction.',
    next_action: 'Send retry link'
  };
}

async function initializeDatabase() {
  if (!pool) {
    buildDemoState();
    return { mode: 'demo' };
  }

  try {
    await pool.query('SELECT 1');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(160) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        company VARCHAR(160),
        lifetime_value NUMERIC(12,2) DEFAULT 0,
        risk_score INT DEFAULT 0,
        status VARCHAR(30) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        customer_id INT REFERENCES customers(id) ON DELETE CASCADE,
        amount NUMERIC(12,2) DEFAULT 0,
        currency VARCHAR(8) DEFAULT 'INR',
        status VARCHAR(20) DEFAULT 'pending',
        razorpay_order_id VARCHAR(120),
        razorpay_payment_id VARCHAR(120),
        failure_reason VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS recovery_cases (
        id SERIAL PRIMARY KEY,
        customer_id INT REFERENCES customers(id) ON DELETE CASCADE,
        payment_id INT REFERENCES payments(id) ON DELETE SET NULL,
        amount_at_risk NUMERIC(12,2) DEFAULT 0,
        priority VARCHAR(20) DEFAULT 'medium',
        status VARCHAR(30) DEFAULT 'open',
        recommendation TEXT,
        next_action VARCHAR(120),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS recovery_actions (
        id SERIAL PRIMARY KEY,
        case_id INT REFERENCES recovery_cases(id) ON DELETE CASCADE,
        action_type VARCHAR(80),
        channel VARCHAR(30),
        status VARCHAR(30) DEFAULT 'simulated',
        message TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    const customerCount = await pool.query('SELECT COUNT(*)::int AS count FROM customers');
    if (Number(customerCount.rows[0].count) === 0) {
      const seedCustomers = [
        ['Rahul Kumar', 'rahul@example.com', 'Acme Labs', 45000, 87],
        ['Priya Sharma', 'priya@example.com', 'Nova Retail', 28000, 64],
        ['Arjun Mehta', 'arjun@example.com', 'Orbit Systems', 92000, 93],
        ['Sneha Rao', 'sneha@example.com', 'Bright Foods', 18000, 42]
      ];

      const createdCustomerIds = [];
      for (const customer of seedCustomers) {
        const result = await pool.query(
          'INSERT INTO customers(name, email, company, lifetime_value, risk_score) VALUES($1, $2, $3, $4, $5) RETURNING id',
          customer
        );
        createdCustomerIds.push(result.rows[0].id);
      }

      await pool.query("INSERT INTO payments(customer_id, amount, status, failure_reason) VALUES($1, 8500, 'failed', 'Card declined')", [createdCustomerIds[0]]);
      await pool.query("INSERT INTO payments(customer_id, amount, status, failure_reason) VALUES($1, 4200, 'failed', 'Insufficient funds')", [createdCustomerIds[1]]);
      await pool.query("INSERT INTO payments(customer_id, amount, status, failure_reason) VALUES($1, 25000, 'failed', 'Bank timeout')", [createdCustomerIds[2]]);
      await pool.query("INSERT INTO payments(customer_id, amount, status, failure_reason) VALUES($1, 1900, 'failed', 'Expired card')", [createdCustomerIds[3]]);
      await pool.query("INSERT INTO payments(customer_id, amount, status) VALUES($1, 32000, 'paid')", [createdCustomerIds[0]]);
      await pool.query("INSERT INTO payments(customer_id, amount, status) VALUES($1, 14500, 'paid')", [createdCustomerIds[1]]);
    }

    return { mode: 'database' };
  } catch (error) {
    console.error('PostgreSQL connection failed:', error.message); 
    buildDemoState();
    return { mode: 'demo' };
  }
}

const databaseReady = initializeDatabase()
  .then((result) => {
    dbMode = result.mode;
    return result;
  })
  .catch((error) => {
    console.error('Database initialization failed:', error.message);
    buildDemoState();
    dbMode = 'demo';
    return { mode: 'demo' };
  });

async function getDashboardData() {
  if (dbMode === 'database') {
    const result = await pool.query(`
      SELECT
        COALESCE((SELECT SUM(amount) FROM payments), 0) AS total,
        COALESCE((SELECT SUM(amount) FROM payments WHERE status = 'failed'), 0) AS risk,
        COALESCE((SELECT SUM(amount) FROM payments WHERE status = 'paid'), 0) AS recovered,
        COALESCE((SELECT COUNT(*) FROM payments WHERE status = 'failed'), 0) AS failed,
        COALESCE((SELECT COUNT(*) FROM recovery_cases WHERE status IN ('open', 'in_progress')), 0) AS open_cases,
        COALESCE((SELECT COUNT(*) FROM customers), 0) AS customers
    `);

    const row = result.rows[0] || {};
    const total = safeNumber(row.total, 0);
    const risk = safeNumber(row.risk, 0);
    const recovered = safeNumber(row.recovered, 0);
    const processed = risk + recovered;
    const priorityCase = getPriorityCase(await getRecoveryCases());
    return {
      total,
      risk,
      recovered,
      failed: Number(row.failed || 0),
      open_cases: Number(row.open_cases || 0),
      customers: Number(row.customers || 0),
      recoveryRate: processed ? Number(((recovered / processed) * 100).toFixed(1)) : 0,
      priorityCase
    };
  }

  const payments = demoData.payments || [];
  const failedPayments = payments.filter((payment) => payment.status === 'failed');
  const paidPayments = payments.filter((payment) => payment.status === 'paid');
  const totalVolume = payments.reduce((sum, payment) => sum + safeNumber(payment.amount, 0), 0);
  const riskValue = failedPayments.reduce((sum, payment) => sum + safeNumber(payment.amount, 0), 0);
  const recoveredValue = paidPayments.reduce((sum, payment) => sum + safeNumber(payment.amount, 0), 0);
  const processedVolume = riskValue + recoveredValue;
  const priorityCase = getPriorityCase(await getRecoveryCases());

  return {
    total: totalVolume,
    risk: riskValue,
    recovered: recoveredValue,
    failed: failedPayments.length,
    open_cases: (demoData.recoveryCases || []).filter((item) => ['open', 'in_progress'].includes(item.status)).length,
    customers: (demoData.customers || []).length,
    recoveryRate: processedVolume ? Number(((recoveredValue / processedVolume) * 100).toFixed(1)) : 0,
    priorityCase
  };
}

async function getCustomers() {
  if (dbMode === 'database') {
    const result = await pool.query('SELECT * FROM customers ORDER BY created_at DESC');
    return result.rows;
  }

  return demoData.customers;
}

async function getPayments() {
  if (dbMode === 'database') {
    const result = await pool.query(`
      SELECT p.*, c.name AS customer_name, c.email
      FROM payments p
      JOIN customers c ON c.id = p.customer_id
      ORDER BY p.created_at DESC
    `);
    return result.rows;
  }

  return (demoData.payments || []).map((payment) => {
    const customer = (demoData.customers || []).find((item) => item.id === payment.customer_id);
    return {
      ...payment,
      customer_name: customer ? customer.name : 'Unknown Customer',
      email: customer ? customer.email : null
    };
  });
}

async function getRecoveryCases() {
  if (dbMode === 'database') {
    const result = await pool.query(`
      SELECT rc.*, c.name AS customer_name, c.email
      FROM recovery_cases rc
      JOIN customers c ON c.id = rc.customer_id
      ORDER BY rc.created_at DESC
    `);
    return result.rows;
  }

  return (demoData.recoveryCases || []).map((entry) => {
    const customer = (demoData.customers || []).find((item) => item.id === entry.customer_id);
    return {
      ...entry,
      customer_name: customer ? customer.name : 'Unknown Customer',
      email: customer ? customer.email : null
    };
  });
}

function getPriorityCase(cases) {
  const priorityOrder = { critical: 3, high: 2, medium: 1 };
  return [...(cases || [])]
    .sort((left, right) => {
      const priorityDifference = (priorityOrder[right.priority] || 0) - (priorityOrder[left.priority] || 0);
      if (priorityDifference) return priorityDifference;
      return new Date(right.created_at || 0) - new Date(left.created_at || 0);
    })[0] || null;
}

async function getRecoveryActions() {
  if (dbMode === 'database') {
    const result = await pool.query(`
      SELECT ra.*, rc.customer_id, c.name AS customer_name
      FROM recovery_actions ra
      JOIN recovery_cases rc ON rc.id = ra.case_id
      JOIN customers c ON c.id = rc.customer_id
      ORDER BY ra.created_at DESC
    `);
    return result.rows;
  }

  return demoData.recoveryActions || [];
}

async function getAnalytics() {
  const payments = await getPayments();
  const actions = await getRecoveryActions();
  const byReason = payments.filter((payment) => payment.status === 'failed').reduce((result, payment) => {
    const reason = payment.failure_reason || 'Unknown failure';
    result[reason] = (result[reason] || 0) + safeNumber(payment.amount);
    return result;
  }, {});

  return {
    failureReasons: Object.entries(byReason)
      .map(([reason, amount]) => ({ reason, amount }))
      .sort((left, right) => right.amount - left.amount),
    actionCount: actions.length,
    simulatedValue: actions.reduce((sum, action) => sum + safeNumber(action.amount_at_risk), 0),
    generatedAt: new Date().toISOString()
  };
}

function createSessionToken(user) {
  const payload = Buffer.from(JSON.stringify({
    user,
    expiresAt: Math.floor(Date.now() / 1000) + sessionDurationSeconds,
    nonce: crypto.randomBytes(12).toString('hex')
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readSessionToken(token) {
  const [payload, signature] = safeString(token).split('.');
  if (!payload || !signature) return null;

  const expectedSignature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  const received = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return session.expiresAt > Math.floor(Date.now() / 1000) ? session : null;
  } catch (error) {
    return null;
  }
}

function requireSession(req, res, next) {
  const token = safeString(req.headers.authorization, '').replace(/^Bearer\s+/i, '');
  const session = readSessionToken(token);
  if (!session) {
    return res.status(401).json({ error: 'Sign in required' });
  }
  req.user = session.user;
  return next();
}

app.use((req, res, next) => {
  res.setHeader('X-Request-ID', crypto.randomBytes(8).toString('hex'));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(async (req, res, next) => {
  await databaseReady;
  next();
});
app.use(express.static(publicDir));

app.get('/api/health', async (req, res) => {
  let database = dbMode === 'demo' ? 'demo' : 'connected';

  if (pool) {
    try {
      await pool.query('SELECT 1');
    } catch (error) {
      database = 'degraded';
    }
  }

  res.json({
    ok: true,
    mode: dbMode,
    database,
    databaseUrlPresent: Boolean(dbUrl),
    service: 'recoverai-api',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    message: 'Backend is ready'
  });
});
app.post('/api/auth/login', (req, res) => {
  const email = safeString(req.body?.email, '').trim().toLowerCase();
  const password = safeString(req.body?.password, '');

  if (email === 'admin@example.com' && password === 'admin123') {
    const user = { name: 'Admin User', email };
    const token = createSessionToken(user);
    return res.json({ ok: true, token, user });
  }

  return res.status(401).json({ error: 'Invalid demo credentials' });
});

app.get('/api/auth/session', requireSession, (req, res) => {
  res.json({ ok: true, user: req.user });
});

app.post('/api/auth/logout', requireSession, (req, res) => {
  res.json({ ok: true });
});

app.post('/api/auth/forgot-password', (req, res) => {
  const email = safeString(req.body?.email, '').trim().toLowerCase();

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }

  return res.json({ ok: true, message: 'If an account exists, reset instructions have been queued.' });
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const data = await getDashboardData();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Dashboard not available' });
  }
});

app.get('/api/customers', requireSession, async (req, res) => {
  try {
    res.json(await getCustomers());
  } catch (error) {
    res.status(500).json({ error: error.message || 'Customers unavailable' });
  }
});

app.get('/api/payments', requireSession, async (req, res) => {
  try {
    const status = safeString(req.query.status, '').trim().toLowerCase();
    const data = await getPayments();
    res.json(status ? data.filter((payment) => payment.status === status) : data);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Payments unavailable' });
  }
});

app.get('/api/recovery-cases', requireSession, async (req, res) => {
  try {
    res.json(await getRecoveryCases());
  } catch (error) {
    res.status(500).json({ error: error.message || 'Recovery cases unavailable' });
  }
});

app.get('/api/recovery-actions', requireSession, async (req, res) => {
  try {
    res.json(await getRecoveryActions());
  } catch (error) {
    res.status(500).json({ error: error.message || 'Recovery actions unavailable' });
  }
});

app.get('/api/analytics', requireSession, async (req, res) => {
  try {
    res.json(await getAnalytics());
  } catch (error) {
    res.status(500).json({ error: error.message || 'Analytics unavailable' });
  }
});

app.post('/api/recovery/analyze/:id', requireSession, async (req, res) => {
  try {
    const paymentId = Number(req.params.id);
    if (!Number.isInteger(paymentId)) {
      return res.status(400).json({ error: 'Invalid payment ID' });
    }

    if (dbMode === 'database') {
      const paymentResult = await pool.query(
        'SELECT p.*, c.name AS customer_name, c.risk_score FROM payments p JOIN customers c ON c.id = p.customer_id WHERE p.id = $1',
        [paymentId]
      );

      const payment = paymentResult.rows[0];
      if (!payment) {
        return res.status(404).json({ error: 'Payment not found' });
      }

      const customer = { risk_score: payment.risk_score };
      const decision = aiRecommendation(payment, customer);
      const existing = await pool.query(
        "SELECT id FROM recovery_cases WHERE payment_id = $1 AND status IN ('open', 'in_progress')",
        [payment.id]
      );

      if (existing.rows[0]) {
        return res.json({ ...existing.rows[0], ...decision, existing: true });
      }

      const inserted = await pool.query(
        'INSERT INTO recovery_cases(customer_id, payment_id, amount_at_risk, priority, recommendation, next_action) VALUES($1, $2, $3, $4, $5, $6) RETURNING *',
        [payment.customer_id, payment.id, payment.amount, decision.priority, decision.recommendation, decision.next_action]
      );

      return res.json({ ...inserted.rows[0], ...decision, existing: false });
    }

    const payment = (demoData.payments || []).find((item) => item.id === paymentId);
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const customer = (demoData.customers || []).find((item) => item.id === payment.customer_id);
    const decision = aiRecommendation(payment, customer);
    const existing = (demoData.recoveryCases || []).find(
      (item) => item.payment_id === payment.id && ['open', 'in_progress'].includes(item.status)
    );

    if (existing) {
      return res.json({ ...existing, ...decision, existing: true });
    }

    const nextCaseId = (demoData.recoveryCases || []).length
      ? Math.max(...(demoData.recoveryCases || []).map((item) => item.id)) + 1
      : 1;

    const newCase = {
      id: nextCaseId,
      customer_id: payment.customer_id,
      payment_id: payment.id,
      amount_at_risk: payment.amount,
      priority: decision.priority,
      recommendation: decision.recommendation,
      next_action: decision.next_action,
      status: 'open',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    demoData.recoveryCases.unshift(newCase);
    return res.json({ ...newCase, ...decision, existing: false });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to analyze payment' });
  }
});

app.post('/api/recovery/:id/simulate', requireSession, async (req, res) => {
  try {
    const caseId = Number(req.params.id);
    if (!Number.isInteger(caseId)) {
      return res.status(400).json({ error: 'Invalid case ID' });
    }

    if (dbMode === 'database') {
      const caseRow = await pool.query('SELECT * FROM recovery_cases WHERE id = $1', [caseId]);
      const record = caseRow.rows[0];
      if (!record) {
        return res.status(404).json({ error: 'Case not found' });
      }

      const action = await pool.query(
        "INSERT INTO recovery_actions(case_id, action_type, channel, status, message) VALUES($1, $2, $3, 'simulated', $4) RETURNING *",
        [record.id, record.next_action, safeString(req.body?.channel, 'email'), `Simulation executed: ${record.recommendation}`]
      );

      await pool.query("UPDATE recovery_cases SET status = 'in_progress', updated_at = NOW() WHERE id = $1", [record.id]);
      return res.json(action.rows[0]);
    }

    const record = (demoData.recoveryCases || []).find((item) => item.id === caseId);
    if (!record) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const nextActionId = (demoData.recoveryActions || []).length
      ? Math.max(...(demoData.recoveryActions || []).map((item) => item.id)) + 1
      : 1;

    const action = {
      id: nextActionId,
      case_id: record.id,
      action_type: record.next_action,
      channel: safeString(req.body?.channel, 'email'),
      status: 'simulated',
      message: `Simulation executed: ${record.recommendation}`,
      created_at: new Date().toISOString()
    };

    demoData.recoveryActions.push(action);
    record.status = 'in_progress';
    record.updated_at = new Date().toISOString();
    return res.json(action);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Simulation failed' });
  }
});

app.post('/api/recovery/:id/resolve', requireSession, async (req, res) => {
  try {
    const caseId = Number(req.params.id);
    if (!Number.isInteger(caseId)) return res.status(400).json({ error: 'Invalid case ID' });

    if (dbMode === 'database') {
      const result = await pool.query(
        "UPDATE recovery_cases SET status = 'resolved', updated_at = NOW() WHERE id = $1 RETURNING *",
        [caseId]
      );
      if (!result.rows[0]) return res.status(404).json({ error: 'Case not found' });
      return res.json(result.rows[0]);
    }

    const record = (demoData.recoveryCases || []).find((item) => item.id === caseId);
    if (!record) return res.status(404).json({ error: 'Case not found' });
    record.status = 'resolved';
    record.updated_at = new Date().toISOString();
    return res.json(record);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to resolve case' });
  }
});

app.post('/api/razorpay/order', async (req, res) => {
  try {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return res.status(400).json({ error: 'Add Razorpay test credentials to .env' });
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });

    const amount = Math.round(safeNumber(req.body?.amount, 100) * 100);
    const order = await razorpay.orders.create({
      amount,
      currency: 'INR',
      receipt: `rr_${Date.now()}`
    });

    return res.json({
      orderId: order.id,
      amount,
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to create Razorpay order' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`Server running on http://localhost:${port} (${dbMode} mode)`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Stop the other process and try again.`);
      process.exit(1);
      return;
    }

    console.error('Failed to start server:', error.message);
    process.exit(1);
  });
}

async function start() {
  await databaseReady;
  startServer(PORT);
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Failed to initialize server:', error.message);
    process.exit(1);
  });
}

module.exports = app;

