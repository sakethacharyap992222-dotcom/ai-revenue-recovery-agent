const getStoredToken = () => localStorage.getItem('token') || sessionStorage.getItem('token');

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('recoverai-theme', theme);
  const button = document.getElementById('themeToggle');
  if (button) {
    const isNight = theme === 'night';
    button.textContent = isNight ? '☀' : '◐';
    button.setAttribute('aria-label', isNight ? 'Use light theme' : 'Use night theme');
    button.title = isNight ? 'Use light theme' : 'Use night theme';
  }
}

const api = async (url, options = {}) => {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('token');
      sessionStorage.removeItem('token');
      localStorage.removeItem('user');
      sessionStorage.removeItem('user');

      if (!document.getElementById('app')?.classList.contains('hidden')) {
        showLogin();
        toast('Your session expired. Please sign in again.');
      }
    }
    throw new Error(data.error || 'Request failed');
  }

  return data;
};

const valueOrDash = (value) => value === null || value === undefined || value === '' ? '—' : value;
const money = (value) => value === null || value === undefined || value === ''
  ? '—'
  : `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');
const customerName = (entry) => entry.customer_name || entry.customer?.name || entry.name || 'Customer';

let activePage = 'dashboard';
let refreshInProgress = false;

async function loadLandingStats() {
  try {
    const [dashboardData, health] = await Promise.all([api('/api/dashboard'), api('/api/health')]);
    const priorityCase = dashboardData.priorityCase;
    const serviceStatus = document.getElementById('serviceStatus');
    if (serviceStatus && health.ok) {
      serviceStatus.className = 'service-status online';
      serviceStatus.innerHTML = '<span class="status-dot"></span>Systems operational';
    }
    document.querySelectorAll('[data-dashboard-stat="risk"]').forEach((element) => {
      element.textContent = money(dashboardData.risk);
    });
    document.querySelectorAll('[data-dashboard-stat="recoveryRate"]').forEach((element) => {
      element.textContent = dashboardData.recoveryRate === null || dashboardData.recoveryRate === undefined
        ? '—'
        : `${Number(dashboardData.recoveryRate).toFixed(1)}%`;
    });
    document.querySelectorAll('[data-dashboard-stat="openCases"]').forEach((element) => {
      element.textContent = valueOrDash(dashboardData.open_cases);
    });
    document.querySelectorAll('[data-dashboard-stat="customers"]').forEach((element) => {
      element.textContent = valueOrDash(dashboardData.customers);
    });
    document.querySelectorAll('[data-priority-case="name"]').forEach((element) => {
      element.textContent = priorityCase ? customerName(priorityCase) : 'No active cases';
    });
    document.querySelectorAll('[data-priority-case="priority"]').forEach((element) => {
      element.textContent = priorityCase ? valueOrDash(priorityCase.priority) : 'None';
      element.className = `tag ${priorityCase ? tagClass(priorityCase.priority) : 'tag-medium'}`;
    });
    document.querySelectorAll('[data-priority-case="action"]').forEach((element) => {
      element.textContent = priorityCase ? valueOrDash(priorityCase.next_action || priorityCase.recommendation) : 'Awaiting recommendation';
    });
    document.querySelectorAll('[data-priority-case="status"]').forEach((element) => {
      element.classList.toggle('status-dot-success', Boolean(priorityCase));
      element.setAttribute('aria-label', priorityCase ? `Recovery case status: ${priorityCase.status || 'open'}` : 'No active recovery case');
    });
  } catch (error) {
    // The landing page remains usable if the stats endpoint is unavailable.
    const serviceStatus = document.getElementById('serviceStatus');
    if (serviceStatus) {
      serviceStatus.className = 'service-status offline';
      serviceStatus.innerHTML = '<span class="status-dot"></span>Demo mode available';
    }
  }
}

async function refreshVisibleData() {
  if (document.hidden || refreshInProgress) return;

  refreshInProgress = true;
  try {
    const landing = !document.getElementById('landing').classList.contains('hidden');
    if (landing) {
      await loadLandingStats();
    } else if (getStoredToken()) {
      await render(activePage);
    }
  } finally {
    refreshInProgress = false;
  }
}

const toast = (message) => {
  const toastEl = document.getElementById('toast');
  if (!toastEl) return;

  toastEl.textContent = message;
  toastEl.style.display = 'block';
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => {
    toastEl.style.display = 'none';
  }, 2200);
};

function showLanding() {
  document.getElementById('landing').classList.remove('hidden');
  document.getElementById('login').classList.add('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showLogin() {
  document.getElementById('landing').classList.add('hidden');
  document.getElementById('login').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showDashboard() {
  document.getElementById('landing').classList.add('hidden');
  document.getElementById('login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  render('dashboard');
}

function setActiveNav(page) {
  document.querySelectorAll('.nav-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.p === page);
  });
}

function tagClass(value) {
  const priority = String(value || '').toLowerCase();
  if (priority === 'critical') return 'tag-critical';
  if (priority === 'high') return 'tag-high';
  if (priority === 'medium') return 'tag-medium';
  if (priority === 'success' || priority === 'paid') return 'tag-success';
  return 'tag-medium';
}

function metricCard(label, value, meta) {
  return `
    <div class="card metric-card">
      <div class="metric-label">${label}</div>
      <div class="metric-value">${valueOrDash(value)}</div>
      <div class="metric-meta">${valueOrDash(meta)}</div>
    </div>
  `;
}

function rowItem(entry) {
  return `
    <div class="list-item">
      <div>
        <div class="name">${escapeHtml(customerName(entry))}</div>
        <div class="muted-text">${entry.next_action || 'Awaiting action'}</div>
      </div>
      <div class="amount">${money(entry.amount_at_risk)}</div>
      <span class="tag ${tagClass(entry.priority)}">${valueOrDash(entry.priority)}</span>
      <span class="muted-text">${valueOrDash(entry.status)}</span>
      <button class="action-btn" type="button" onclick="simulate(${entry.id})">Simulate</button>
    </div>
  `;
}

async function render(page) {
  activePage = page;
  const titles = {
    dashboard: 'Recovery Command Center',
    customers: 'Customer Intelligence',
    payments: 'Payment Monitor',
    recovery: 'Recovery Queue',
    ai: 'AI Recommendations',
    actions: 'Recovery Actions',
    analytics: 'Analytics'
  };

  const title = document.getElementById('title');
  if (title) {
    title.textContent = titles[page] || 'Recovery Command Center';
  }

  setActiveNav(page);

  try {
    if (page === 'dashboard') return await dash();
    if (page === 'customers') return await customers();
    if (page === 'payments') return await payments();
    if (page === 'recovery') return await recovery();
    if (page === 'ai') return await ai();
    if (page === 'actions') return await actions();
    if (page === 'analytics') return await analytics();
    return await dash();
  } catch (error) {
    const content = document.getElementById('content');
    if (content) {
      content.innerHTML = `<div class="card empty-state">${error.message}</div>`;
    }
  }
}

async function dash() {
  const [dashboardData, recoveryCases] = await Promise.all([
    api('/api/dashboard'),
    api('/api/recovery-cases')
  ]);

  const content = document.getElementById('content');
  const riskCoverage = dashboardData.risk
    ? Math.min(100, Math.round(((dashboardData.recovered || 0) / dashboardData.risk) * 100))
    : 0;
  content.innerHTML = `
    <div class="command-strip">
      <div><span class="live-kicker"><span class="pulse-dot"></span>LIVE MONITORING</span><strong>Recovery operations are under control</strong></div>
      <span class="command-detail">${valueOrDash(dashboardData.failed)} failed signals · ${valueOrDash(dashboardData.open_cases)} active cases</span>
    </div>
    <div class="metrics-grid">
      ${metricCard('Revenue at risk', money(dashboardData.risk), `${valueOrDash(dashboardData.failed)} failed payments`)}
      ${metricCard('Revenue recovered', money(dashboardData.recovered), dashboardData.recoveryRate === null || dashboardData.recoveryRate === undefined ? 'Recovery rate unavailable' : `${Number(dashboardData.recoveryRate).toFixed(1)}% recovery rate`)}
      ${metricCard('Open cases', dashboardData.open_cases, 'AI prioritized')}
      ${metricCard('Customers', dashboardData.customers, 'Monitored')}
    </div>

    <div class="intelligence-grid">
      <section class="card performance-card">
        <div class="card-header">
          <div><span class="section-kicker">RECOVERY MOMENTUM</span><h3>Revenue protection health</h3></div>
          <span class="badge up">Live model</span>
        </div>
        <div class="health-layout">
          <div class="health-ring" style="--progress: ${riskCoverage}%">
            <div><strong>${riskCoverage}%</strong><span>covered</span></div>
          </div>
          <div class="health-copy">
            <strong>${valueOrDash(dashboardData.open_cases)} opportunities need attention</strong>
            <p>Prioritize the highest-value failed payments first to protect this week's revenue.</p>
            <button class="inline-action" type="button" onclick="render('recovery')">Review recovery queue <span>→</span></button>
          </div>
        </div>
      </section>
      <section class="card signals-card">
        <div class="card-header"><div><span class="section-kicker">SIGNAL FEED</span><h3>What changed</h3></div><span class="live-label"><i></i> Monitoring</span></div>
        <div class="signal-list">
          <div class="signal-item"><span class="signal-icon danger">!</span><div><strong>${valueOrDash(dashboardData.failed)} failed payments detected</strong><p>AI has ranked each one by recovery potential.</p></div></div>
          <div class="signal-item"><span class="signal-icon success">✓</span><div><strong>${money(dashboardData.recovered)} successfully recovered</strong><p>Recovered payment volume across active accounts.</p></div></div>
          <div class="signal-item"><span class="signal-icon primary">✦</span><div><strong>Recommendations are ready</strong><p>Review the next best action for every open case.</p></div></div>
        </div>
      </section>
    </div>

    <div class="data-grid">
      <div class="card">
        <div class="card-header">
          <h3>Priority Recovery Queue</h3>
        </div>
        <div class="list">
          ${(recoveryCases || []).slice(0, 6).map(rowItem).join('') || '<div class="empty-state">No cases yet. Analyze a failed payment.</div>'}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>AI Decision Engine</h3>
        </div>
        <p class="muted">Bounded, reviewable actions with clear customer risk context.</p>
        <div class="steps">
          ${['Detect failed payments', 'Score recovery risk', 'Recommend next action', 'Simulate approved action', 'Track outcome']
            .map((step, index) => `
              <div class="step">
                <span class="step-badge">${index + 1}</span>
                <span>${step}</span>
              </div>
            `)
            .join('')}
        </div>
      </div>
    </div>
  `;
}

async function customers() {
  const customersData = await api('/api/customers');
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <h3>Customers</h3>
          <p class="muted">Lifetime value and risk profile.</p>
        </div>
        <label class="search-field">
          <span>Search customers</span>
          <input id="customerSearch" type="search" placeholder="Search by name, email, or company" autocomplete="off" />
        </label>
      </div>
      <div id="customerList" class="list"></div>
    </div>
  `;

  const searchInput = document.getElementById('customerSearch');
  const customerList = document.getElementById('customerList');

  const renderCustomerList = () => {
    const query = (searchInput.value || '').trim().toLowerCase();
    const filtered = (customersData || []).filter((customer) =>
      [customer.name, customer.email, customer.company].some((value) =>
        String(value || '').toLowerCase().includes(query)
      )
    );

    customerList.innerHTML = filtered.length
      ? filtered
          .map(
            (customer) => `
              <div class="list-item" style="grid-template-columns: 1.4fr 1.2fr 1fr auto;">
                <div>
                  <div class="name">${customer.name}</div>
                  <div class="muted-text">${customer.email}</div>
                </div>
                <div class="muted-text">${customer.company || '—'}</div>
                <div class="muted-text">${money(customer.lifetime_value || 0)}</div>
                <span class="tag ${tagClass(customer.risk_score >= 90 ? 'critical' : customer.risk_score >= 70 ? 'high' : 'medium')}">Risk ${customer.risk_score}</span>
              </div>
            `
          )
          .join('')
      : '<div class="empty-state">No customers match your search.</div>';
  };

  searchInput.addEventListener('input', renderCustomerList);
  renderCustomerList();
}

async function payments() {
  const paymentsData = await api('/api/payments');
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <h3>Payments</h3>
          <p class="muted">Payment status and recovery opportunities.</p>
        </div>
      </div>
      <div class="list payment-list">
        <div class="payment-list-heading" aria-hidden="true">
          <span>Customer</span>
          <span>Amount</span>
          <span>Status</span>
          <span>Date</span>
        </div>
        ${(paymentsData || [])
          .map(
            (payment) => `
              <div class="list-item payment-list-item">
                <div>
                  <div class="name">${escapeHtml(customerName(payment))}</div>
                  <div class="muted-text">${escapeHtml(payment.failure_reason || 'Successful payment')}</div>
                </div>
                <div class="amount">${money(payment.amount || 0)}</div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span class="tag ${payment.status === 'failed' ? 'tag-critical' : 'tag-success'}">${escapeHtml(payment.status || 'unknown')}</span>
                  ${payment.status === 'failed' ? `<button class="action-btn" type="button" onclick="analyze(${payment.id})">AI Analyze</button>` : ''}
                </div>
                <span class="muted-text">${new Date(payment.created_at).toLocaleString()}</span>
              </div>
            `
          )
          .join('') || '<div class="empty-state">No payment data available.</div>'}
      </div>
    </div>
  `;
}

async function recovery() {
  const recoveryCases = await api('/api/recovery-cases');
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3>Recovery Queue</h3>
      </div>
      <div class="list">
        ${(recoveryCases || []).map(rowItem).join('') || '<div class="empty-state">No cases available.</div>'}
      </div>
    </div>
  `;
}

async function ai() {
  const recoveryCases = await api('/api/recovery-cases');
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3>AI Recovery Recommendations</h3>
      </div>
      <p class="muted">The rule engine considers payment amount, failure reason, and customer risk profile before recommending the next step.</p>
      <div class="list" style="margin-top: 14px;">
        ${(recoveryCases || [])
          .map(
            (entry) => `
              <div class="list-item" style="grid-template-columns: minmax(0, 1.5fr) auto;">
                <div>
                  <div class="name">${escapeHtml(customerName(entry))}</div>
                  <div class="muted-text">${entry.recommendation || 'No recommendation available.'}</div>
                </div>
                <span class="tag ${tagClass(entry.priority)}">${entry.priority || 'medium'}</span>
              </div>
            `
          )
          .join('') || '<div class="empty-state">No recommendations yet.</div>'}
      </div>
    </div>
  `;
}

async function actions() {
  const actionsData = await api('/api/recovery-actions');
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3>Recovery Actions</h3>
      </div>
      <div class="list">
        ${(actionsData || []).length
          ? actionsData
              .map(
                (action) => `
                  <div class="list-item" style="grid-template-columns: minmax(0, 1.3fr) auto auto;">
                    <div>
                      <div class="name">${action.action_type || 'Action'}</div>
                      <div class="muted-text">${action.message || 'No message'}</div>
                    </div>
                    <span class="tag ${tagClass(action.status === 'simulated' ? 'success' : action.status)}">${action.status || 'simulated'}</span>
                    <span class="muted-text">${action.channel || 'email'}</span>
                  </div>
                `
              )
              .join('')
          : '<div class="empty-state">No actions available.</div>'}
      </div>
    </div>
  `;
}

async function analytics() {
  const [dashboardData, analyticsData] = await Promise.all([api('/api/dashboard'), api('/api/analytics')]);
  const reasons = analyticsData.failureReasons || [];
  const maxAmount = Math.max(...reasons.map((item) => Number(item.amount) || 0), 1);
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="metrics-grid">
      ${metricCard('Processed', money(dashboardData.total), 'All payment volume')}
      ${metricCard('At risk', money(dashboardData.risk), 'Failed value')}
      ${metricCard('Recovered', money(dashboardData.recovered), 'Paid value')}
      ${metricCard('Recovery rate', `${Number(dashboardData.recoveryRate || 0).toFixed(1)}%`, 'Paid / processed volume')}
    </div>

    <div class="card">
      <div class="card-header">
        <div><h3>Failure intelligence</h3><p class="muted">Where revenue risk is coming from right now.</p></div>
        <span class="tag tag-medium">${analyticsData.actionCount || 0} actions</span>
      </div>
      <div class="reason-chart">
        ${reasons.length ? reasons.map((item) => `
          <div class="reason-row">
            <div class="reason-label"><span>${escapeHtml(item.reason)}</span><strong>${money(item.amount)}</strong></div>
            <div class="reason-track"><span style="width: ${(Number(item.amount) / maxAmount) * 100}%"></span></div>
          </div>
        `).join('') : '<div class="empty-state">No failed payment signals yet.</div>'}
      </div>
    </div>
  `;
}

document.getElementById('refreshBtn').addEventListener('click', () => {
  const button = document.getElementById('refreshBtn');
  button.disabled = true;
  render(activePage).finally(() => {
    button.disabled = false;
  });
});

document.getElementById('themeToggle').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'night' ? 'light' : 'night');
});

async function analyze(id) {
  try {
    const result = await api(`/api/recovery/analyze/${id}`, { method: 'POST' });
    toast(`AI case created: ${result.priority || 'normal'}`);
    render('recovery');
  } catch (error) {
    toast(error.message);
  }
}

async function simulate(id) {
  try {
    await api(`/api/recovery/${id}/simulate`, {
      method: 'POST',
      body: JSON.stringify({ channel: 'email' })
    });
    toast('Recovery action simulated');
    render('actions');
  } catch (error) {
    toast(error.message);
  }
}

document.getElementById('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const rememberMe = document.getElementById('rememberMe').checked;

  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    if (rememberMe) {
      localStorage.setItem('user', JSON.stringify(result.user));
      localStorage.setItem('token', result.token);
      sessionStorage.removeItem('user');
      sessionStorage.removeItem('token');
    } else {
      sessionStorage.setItem('user', JSON.stringify(result.user));
      sessionStorage.setItem('token', result.token);
      localStorage.removeItem('user');
      localStorage.removeItem('token');
    }
    showDashboard();
  } catch (error) {
    toast(error.message);
  }
});

document.getElementById('logout').addEventListener('click', async () => {
  try {
    if (getStoredToken()) await api('/api/auth/logout', { method: 'POST' });
  } catch (error) {
    // Local cleanup still lets the user leave when the backend is unavailable.
  }
  localStorage.removeItem('user');
  sessionStorage.removeItem('user');
  localStorage.removeItem('token');
  sessionStorage.removeItem('token');
  showLanding();
});

document.getElementById('proceedBtn').addEventListener('click', showLogin);
document.getElementById('launchDemoBtn').addEventListener('click', showLogin);
document.getElementById('backToLanding').addEventListener('click', showLanding);

const forgotPanel = document.getElementById('forgotPanel');
const resetEmail = document.getElementById('resetEmail');

function closeForgotPanel() {
  forgotPanel.classList.add('hidden');
}

document.getElementById('forgotPassword').addEventListener('click', () => {
  resetEmail.value = document.getElementById('email').value.trim();
  forgotPanel.classList.remove('hidden');
  resetEmail.focus();
});

document.getElementById('closeForgot').addEventListener('click', closeForgotPanel);
document.getElementById('cancelForgot').addEventListener('click', closeForgotPanel);

document.getElementById('forgotForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const result = await api('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: resetEmail.value.trim() })
    });
    toast(result.message);
    closeForgotPanel();
  } catch (error) {
    toast(error.message);
  }
});

document.getElementById('demoFlowBtn').addEventListener('click', () => {
  document.getElementById('workflow')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.getElementById('nav').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-p]');
  if (!button) return;
  render(button.dataset.p);
});

async function restoreSession() {
  const token = getStoredToken();
  const storedUser = localStorage.getItem('user') || sessionStorage.getItem('user');

  if (!token || !storedUser) {
    showLanding();
    return;
  }

  try {
    const result = await api('/api/auth/session');
    const storage = localStorage.getItem('token') === token ? localStorage : sessionStorage;
    storage.setItem('user', JSON.stringify(result.user));
    showDashboard();
  } catch (error) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
    showLanding();
  }
}

showLanding();
applyTheme(localStorage.getItem('recoverai-theme') || 'light');
restoreSession();
loadLandingStats();
setInterval(refreshVisibleData, 15000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshVisibleData();
});

window.analyze = analyze;
window.simulate = simulate;
window.render = render;
window.showLanding = showLanding;
window.showLogin = showLogin;
window.showDashboard = showDashboard;
