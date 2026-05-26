/* ═══════════════════════════════════════════════════════════════════════
   SureBet Pro v4.0 — Zaawansowany SPA Engine
   ═══════════════════════════════════════════════════════════════════════ */

// ═══ API Client ══════════════════════════════════════════════════════


// ═══ Payment & API Keys Functions ═══════════════════════════════════

async function loadPaymentKeys() {
  try {
    const r = await API.get('/api/settings');
    if (r.success && r.settings) {
      if (document.getElementById('stripePk')) document.getElementById('stripePk').value = r.settings.stripe_publishable_key || '';
      if (document.getElementById('stripeSk')) document.getElementById('stripeSk').value = r.settings.stripe_secret_key || '';
      if (document.getElementById('paypalCid')) document.getElementById('paypalCid').value = r.settings.paypal_client_id || '';
      if (document.getElementById('paypalSecret')) document.getElementById('paypalSecret').value = r.settings.paypal_secret || '';
      if (document.getElementById('p24Mid')) document.getElementById('p24Mid').value = r.settings.p24_merchant_id || '';
      if (document.getElementById('p24Key')) document.getElementById('p24Key').value = r.settings.p24_api_key || '';
    }
  } catch(e) {}
}

async function loadApiKeys() {
  try {
    const r = await API.get('/api/settings');
    if (r.success && r.settings) {
      const key = r.settings.theoddsapi_key || '';
      const keyInput = document.getElementById('apiKeyInput');
      if (keyInput && key) keyInput.value = key;
    }
  } catch(e) {}
}

async function savePaymentKeys() {
  const keys = {
    stripe_publishable_key: document.getElementById('stripePk')?.value || '',
    stripe_secret_key: document.getElementById('stripeSk')?.value || '',
    paypal_client_id: document.getElementById('paypalCid')?.value || '',
    paypal_secret: document.getElementById('paypalSecret')?.value || '',
    p24_merchant_id: document.getElementById('p24Mid')?.value || '',
    p24_api_key: document.getElementById('p24Key')?.value || '',
  };
  try {
    const r = await API.post('/api/settings', keys);
    if (r.success) {
      document.getElementById('paymentKeysStatus').textContent = '✅ Klucze zapisane!';
      toast('💳 Klucze płatności zapisane', 'success');
    }
  } catch(e) {
    document.getElementById('paymentKeysStatus').textContent = '❌ Błąd zapisu';
  }
}

// Cache for API GET responses (30s TTL)
const _apiCache = {};
const _apiCacheTTL = 30000; // 30 seconds

const API = {
  async get(path, timeout = 10000) {
    // Return cached response if fresh
    const cached = _apiCache[path];
    if (cached && Date.now() - cached.ts < _apiCacheTTL) {
      return cached.data;
    }
    
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeout);
    try {
      const r = await fetch(path, { signal: c.signal });
      clearTimeout(t);
      const data = await r.json();
      // Cache successful GET responses
      if (data && data.success !== false) {
        _apiCache[path] = { data, ts: Date.now() };
      }
      return data;
    } catch(e) {
      clearTimeout(t);
      // Try to return stale cache on error
      if (_apiCache[path]) {
        console.warn('API error, using stale cache for:', path);
        return _apiCache[path].data;
      }
      throw e.name === 'AbortError' ? new Error('Timeout') : e;
    }
  },
  // Force refresh a cached endpoint
  async getFresh(path, timeout = 10000) {
    delete _apiCache[path];
    return API.get(path, timeout);
  },
  async post(path, body = {}, timeout = 15000) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeout);
    try {
      const r = await fetch(path, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body), signal: c.signal
      });
      clearTimeout(t);
      const data = await r.json();
      // Invalidate GET cache for related paths
      for (const key in _apiCache) {
        if (key.startsWith(path.replace(/\/\w+$/, '')) || key === path) {
          delete _apiCache[key];
        }
      }
      return data;
    } catch(e) {
      clearTimeout(t);
      throw e.name === 'AbortError' ? new Error('Timeout') : e;
    }
  },
  // Clear entire cache
  clearCache() {
    for (const key in _apiCache) delete _apiCache[key];
  }
};

// ═══ State ═══════════════════════════════════════════════════════════

let currentPage = 'dashboard';
let surebets = [], valueBets = [], multiMarket = [];
let bookmakers = {}, accounts = {}, bets = [], notifications = [];
let bankroll = {}, stats = {}, engineStats = {}, dailyChart = [];
let sports = [], leagues = {}, oddsHistory = [], bookmakerRanking = [];
let updateTimer = null, notifTimer = null;
let currentCurrency = localStorage.getItem('sb-currency') || 'PLN';
let currentUser = null;
let selectedSession = null;
let accountMode = 'demo';
let demoBalance = 100000;
let realBalance = 0;
let depositHistory = [];
let investments = [];
let investmentPlans = [];
let portfolio = {};

// ═══ Router ══════════════════════════════════════════════════════════

const PAGES = {
  dashboard:      { title: 'Dashboard',      render: renderDashboard },
  surebets:       { title: 'Surebety',       render: renderSurebets },
  valuebets:      { title: 'Value Bets',     render: renderValueBets },
  multimarket:    { title: 'Multi-Rynek',    render: renderMultiMarket },
  bookmakers:     { title: 'Bukmacherzy',    render: renderBookmakers },
  accounts:       { title: 'Konta',          render: renderAccounts },
  autobet:        { title: 'Auto-Bet',       render: renderAutoBet },
  bankroll:       { title: 'Bankroll',       render: renderBankroll },
  statistics:     { title: 'Statystyki',     render: renderStatistics },
  calculator:     { title: 'Kalkulatory',    render: renderCalculator },
  history:        { title: 'Historia',       render: renderHistory },
  notifications:  { title: 'Powiadomienia',  render: renderNotifications },
  settings:       { title: 'Ustawienia',     render: renderSettings },
  register:       { title: 'Rejestracja',    render: renderRegister },
  surebetdetail:  { title: 'Szczegóły',      render: renderSurebetDetail },
  matchdetails:   { title: 'Mecz',           render: renderMatchDetails },
  backtest:       { title: 'Backtesting',    render: renderBacktest },
  margins:        { title: 'Analiza marż',   render: renderMargins },
  oddslive:       { title: 'Rynek na żywo',  render: renderOddsLive },
  account:        { title: 'Konto',          render: renderAccount },
  deposit:        { title: 'Wpłata',         render: renderDeposit },
  investments:    { title: 'Inwestycje',     render: renderInvestments },
  withdraw:       { title: 'Wypłata',        render: renderWithdraw },
  betslip:        { title: 'Kupon',          render: renderBetSlip },
  verification:   { title: 'Weryfikacja',    render: renderVerification },
  transactions:   { title: 'Transakcje',     render: renderTransactions },
};

function navigate(page, params) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.page === page);
  });
  const title = PAGES[page]?.title || 'SureBet Pro';
  document.getElementById('pageTitle').textContent = title;
  const area = document.getElementById('contentArea');
  area.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  setTimeout(() => {
    if (PAGES[page]) {
      try { PAGES[page].render(area, params); }
      catch(err) {
        area.innerHTML = `<div class="alert error" style="margin:40px;text-align:center">
          <div style="font-size:40px">⚠️</div><div style="font-weight:600;margin:8px 0">Błąd: ${err.message}</div>
          <button class="btn btn-primary" onclick="navigate('dashboard')">Dashboard</button></div>`;
      }
    }
  }, 50);
  if (window.innerWidth <= 768) closeSidebar();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.querySelector('.sidebar-overlay').classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.querySelector('.sidebar-overlay').classList.remove('open');
}

// ═══ Toast ═══════════════════════════════════════════════════════════

function toast(msg, type = 'info', dur = 3000) {
  const c = document.getElementById('toasts');
  const t = document.createElement('div');
  const icons = {success:'✅',error:'❌',info:'ℹ️',warning:'⚠️'};
  t.className = `toast ${type}`;
  t.innerHTML = `${icons[type]||'ℹ️'} ${msg}`;
  c.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0'; t.style.transform = 'translateX(20px)';
    t.style.transition = 'all 0.3s';
    setTimeout(() => t.remove(), 300);
  }, dur);
}

function openModal(html) {
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalOverlay').classList.add('open');
}
function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

// ═══ User Menu ═══
function toggleUserMenu() {
  document.getElementById('userDropdown').classList.toggle('open');
}
function closeUserMenu() {
  document.getElementById('userDropdown').classList.remove('open');
}

function showLoginModal() {
  closeUserMenu();
  openModal(`
    <div class="modal-header"><h3>🔑 Logowanie</h3>
      <button class="modal-close" onclick="closeModal()">✕</button></div>
    <div style="padding:16px">
      <div class="form-group"><label>Email lub login</label>
        <input class="form-input" id="modalLoginUser" placeholder="wizzyeazy7@gmail.com"></div>
      <div class="form-group"><label>Hasło</label>
        <input class="form-input" id="modalLoginPass" type="password" placeholder="••••••"></div>
      <button class="btn btn-primary btn-lg btn-block" onclick="modalLogin()">🔑 Zaloguj</button>
      <div style="margin-top:12px;text-align:center;font-size:12px;color:var(--text-muted)">
        Nie masz konta? <a href="#" onclick="closeModal();showRegisterModal()" style="color:var(--primary)">Zarejestruj się</a>
      </div>
    </div>`);
}

async function modalLogin() {
  const u = document.getElementById('modalLoginUser')?.value?.trim();
  const p = document.getElementById('modalLoginPass')?.value?.trim();
  if (!u || !p) { toast('Podaj login i hasło', 'error'); return; }
  try {
    const r = await API.post('/api/auth/login', {username: u, password: p});
    if (r.success) {
      currentUser = u;
      localStorage.setItem('sb-user', u);
      closeModal();
      updateUserMenu();
      await fetchAllData();
      toast(`👤 Zalogowano jako ${u}`, 'success');
    } else toast(`❌ ${r.error}`, 'error');
  } catch(e) { toast('Błąd serwera', 'error'); }
}

function showRegisterModal() {
  closeUserMenu();
  openModal(`
    <div class="modal-header"><h3>📝 Rejestracja</h3>
      <button class="modal-close" onclick="closeModal()">✕</button></div>
    <div style="padding:16px">
      <div class="form-group"><label>Email</label>
        <input class="form-input" id="modalRegEmail" placeholder="email@example.com"></div>
      <div class="form-group"><label>Login</label>
        <input class="form-input" id="modalRegUser" placeholder="mojlogin"></div>
      <div class="form-group"><label>Hasło</label>
        <input class="form-input" id="modalRegPass" type="password" placeholder="min. 6 znaków"></div>
      <div class="form-group"><label>Imię</label>
        <input class="form-input" id="modalRegName" placeholder="Jan"></div>
      <button class="btn btn-success btn-lg btn-block" onclick="modalRegister()">📝 Zarejestruj</button>
      <div style="margin-top:12px;text-align:center;font-size:12px;color:var(--text-muted)">
        Masz już konto? <a href="#" onclick="closeModal();showLoginModal()" style="color:var(--primary)">Zaloguj się</a>
      </div>
    </div>`);
}

async function modalRegister() {
  const email = document.getElementById('modalRegEmail')?.value?.trim();
  const user = document.getElementById('modalRegUser')?.value?.trim();
  const pass = document.getElementById('modalRegPass')?.value?.trim();
  const name = document.getElementById('modalRegName')?.value?.trim();
  if (!email || !user || !pass) { toast('Wypełnij wymagane pola', 'error'); return; }
  if (pass.length < 6) { toast('Hasło musi mieć min. 6 znaków', 'error'); return; }
  try {
    const r = await API.post('/api/auth/register', {username: user, password: pass, email});
    if (r.success) {
      closeModal();
      toast(`✅ Konto ${user} utworzone! Możesz się zalogować.`, 'success', 4000);
    } else toast(`❌ ${r.error}`, 'error');
  } catch(e) { toast('Błąd serwera', 'error'); }
}

function updateUserMenu() {
  const header = document.getElementById('userDisplayName');
  const emailEl = document.getElementById('userDisplayEmail');
  const loginBtn = document.getElementById('userLoginBtn');
  const registerBtn = document.getElementById('userRegisterBtn');
  const dashboardLink = document.getElementById('userDashboardLink');
  const depositLink = document.getElementById('userDepositLink');
  const logoutDivider = document.getElementById('userLogoutDivider');
  const logoutBtn = document.getElementById('userLogoutBtn');
  const menuBtn = document.getElementById('userMenuBtn');
  
  if (currentUser) {
    header.textContent = currentUser;
    emailEl.textContent = 'Zalogowany';
    loginBtn.style.display = 'none';
    registerBtn.style.display = 'none';
    dashboardLink.style.display = 'flex';
    depositLink.style.display = 'flex';
    logoutDivider.style.display = 'block';
    logoutBtn.style.display = 'flex';
    if (menuBtn) menuBtn.textContent = '👤';
  } else {
    header.textContent = 'Gość';
    emailEl.textContent = 'Nie zalogowany';
    loginBtn.style.display = 'flex';
    registerBtn.style.display = 'flex';
    dashboardLink.style.display = 'none';
    depositLink.style.display = 'none';
    logoutDivider.style.display = 'none';
    logoutBtn.style.display = 'none';
    if (menuBtn) menuBtn.textContent = '👤';
  }
}

// ═══ Data Fetching ═══════════════════════════════════════════════════

async function fetchAllData() {
  try {
    const [sd, bd, rd, nd, st, es, od, mr, ac, em, dp, wp, inv, tx, ab, dm, wm, ip, sec] = await Promise.all([
      API.get('/api/surebets?limit=50'),
      API.get('/api/bookmakers'),
      API.get('/api/bankroll'),
      API.get('/api/notifications'),
      API.get('/api/statistics'),
      API.get('/api/engine/stats'),
      API.get('/api/odds-history'),
      API.get('/api/bookmakers/ranking'),
      API.get('/api/account/status'),
      API.get('/api/engine/message'),
      API.get('/api/deposit/history').catch(() => ({success:true, deposits:[]})),
      API.get('/api/withdraw/history').catch(() => ({success:true, withdrawals:[]})),
      API.get('/api/investment/portfolio').catch(() => ({success:true})),
      API.get('/api/transactions').catch(() => ({success:true, transactions:[]})),
      API.get('/api/autobet/status').catch(() => ({success:true})),
      API.get('/api/deposit/methods').catch(() => ({success:true, methods:[]})),
      API.get('/api/withdraw/methods').catch(() => ({success:true, methods:[]})),
      API.get('/api/investment/plans').catch(() => ({success:true, plans:[]})),
      API.get('/api/account/security/status').catch(() => ({success:true})),
    ]);
    if (sd.success) surebets = sd.surebets || [];
    if (bd.success) bookmakers = bd.bookmakers || {};
    if (rd.success) bankroll = rd.bankroll || {};
    if (nd.success) notifications = nd.notifications || [];
    if (st.success) { stats = st.statistics || {}; dailyChart = st.daily_chart || []; }
    if (es.success) engineStats = es.stats || {};
    window.engineMessage = em?.message || null;
    const ds = document.getElementById('dataSourceBadge');
    if (ds && engineStats.data_source_label) ds.textContent = engineStats.data_source_label;
    if (od.success) oddsHistory = od.history || [];
    if (mr.success) bookmakerRanking = mr.ranking || [];
    if (ac.success) {
      accountMode = ac.mode;
      demoBalance = ac.demo_balance;
      realBalance = ac.real_balance;
    }
    if (dp.success) depositHistory = dp.deposits || [];
    if (wp.success) withdrawHistory = wp.withdrawals || [];
    if (inv.success) portfolio = inv.portfolio || inv;
    if (tx.success && tx.transactions) window._allTransactions = tx.transactions;
    // Cache additional data for instant page loads
    if (ab.success) window._autobetStatus = ab;
    if (dm.success) window._depositMethods = dm.methods || [];
    if (wm.success) window._withdrawMethods = wm.methods || [];
    if (ip.success) window._investmentPlans = ip.plans || [];
    if (sec.success) window._securityStatus = sec;
    updateBadges();
    updateConnectionStatus();
  } catch(e) {}
}

async function fetchValueBets() {
  try {
    const d = await API.get('/api/value-bets');
    if (d.success) valueBets = d.value_bets || [];
  } catch(e) {}
}

async function fetchMultiMarket() {
  try {
    const d = await API.get('/api/multi-market');
    if (d.success) multiMarket = d.opportunities || [];
  } catch(e) {}
}

async function fetchBets() {
  try {
    const d = await API.get('/api/bets?limit=100');
    if (d.success) bets = d.bets || [];
  } catch(e) {}
}

async function fetchAccounts() {
  try {
    const d = await API.get('/api/accounts');
    if (d.success) accounts = d.accounts || [];
  } catch(e) {}
}

async function fetchDeposits() {
  try {
    const d = await API.get('/api/deposit/history');
    if (d.success) depositHistory = d.deposits || [];
  } catch(e) {}
}

async function fetchInvestments() {
  try {
    const d = await API.get('/api/investment/portfolio');
    if (d.success) portfolio = d;
    const p = await API.get('/api/investment/plans');
    if (p.success) investmentPlans = p.plans || [];
  } catch(e) {}
}

async function fetchSports() {
  try {
    const d = await API.get('/api/sports');
    if (d.success) { sports = d.sports || []; leagues = d.leagues || {}; }
  } catch(e) {}
}

// ═══ Quick account mode switch ════════════════════════════════

let _switching = false;

async function quickSwitchMode() {
  if (_switching) return;
  _switching = true;
  const newMode = accountMode === 'demo' ? 'real' : 'demo';
  // Instant visual feedback
  updateModeToggleUI(newMode);
  
  try {
    // Just switch mode on server - lightweight, single call
    const r = await API.post('/api/account/switch', { mode: newMode });
    
    if (r.success) {
      accountMode = r.mode;
      demoBalance = r.demo_balance;
      realBalance = r.real_balance;
      updateModeToggleUI(r.mode);
      
      // Update sidebar badge
      const acctBadge = document.getElementById('accountBadge');
      if (acctBadge) {
        acctBadge.textContent = r.mode === 'demo' ? 'DEMO' : 'REAL';
        acctBadge.style.display = 'inline';
        acctBadge.style.background = r.mode === 'demo' ? 'var(--info-bg)' : 'var(--profit-bg)';
        acctBadge.style.color = r.mode === 'demo' ? 'var(--info)' : 'var(--profit)';
      }
      
      // Clear stale cache since mode changed
      API.clearCache();
      
      // Fast refresh: only fetch bankroll for display
      const [br] = await Promise.all([
        API.get('/api/bankroll').catch(() => null),
      ]);
      
      if (br && br.success) {
        bankroll = br.bankroll || {};
      }
      
      // Smooth page refresh without full re-render - update only stats/balance
      refreshCurrentPageData();
      
      toast('Tryb: ' + (r.mode === 'demo' ? '🎮 DEMO' : '💵 REAL'), 'success', 1000);
      _switching = false;
    } else {
      updateModeToggleUI(accountMode);
      toast('Błąd: ' + (r.error || 'nieznany'), 'error');
      _switching = false;
    }
  } catch(e) { 
    updateModeToggleUI(accountMode);
    toast('Błąd sieci: ' + e.message, 'error'); 
  } finally {
    _switching = false;
  }
}

function refreshCurrentPageData() {
  // After mode switch, always go to dashboard - it's the safest page
  // and shows the correct balance for the active mode
  const area = document.getElementById('contentArea');
  if (area) {
    // Smooth transition with brief loading state
    area.innerHTML = '<div class="loading" style="padding:20px"><div class="spinner"></div></div>';
    setTimeout(() => {
      currentPage = 'dashboard';
      document.querySelectorAll('.nav-item').forEach(n => {
        n.classList.toggle('active', n.dataset.page === 'dashboard');
      });
      document.getElementById('pageTitle').textContent = 'Dashboard';
      renderDashboard(area);
    }, 200);
  }
}

function updateModeToggleUI(mode) {
  const container = document.getElementById('modeToggleContainer');
  const thumb = document.getElementById('modeToggleThumb');
  const label = document.getElementById('modeToggleLabel');
  if (container) {
    if (mode === 'real') {
      container.classList.add('real');
      container.title = 'Kliknij aby przełączyć na DEMO';
    } else {
      container.classList.remove('real');
      container.title = 'Kliknij aby przełączyć na REAL';
    }
  }
  if (thumb) thumb.textContent = mode === 'demo' ? '🎮' : '💵';
  if (label) label.textContent = mode === 'demo' ? 'DEMO' : 'REAL';
}

async function checkAccountMode() {
  try {
    const r = await API.get('/api/account/status');
    if (r.success) {
      accountMode = r.mode;
      demoBalance = r.demo_balance;
      realBalance = r.real_balance;
      updateModeToggleUI(r.mode);
      const acctBadge = document.getElementById('accountBadge');
      if (acctBadge) {
        acctBadge.textContent = r.mode === 'demo' ? 'DEMO' : 'REAL';
        acctBadge.style.display = 'inline';
        acctBadge.style.background = r.mode === 'demo' ? 'var(--info-bg)' : 'var(--profit-bg)';
        acctBadge.style.color = r.mode === 'demo' ? 'var(--info)' : 'var(--profit)';
      }
    }
  } catch(e) {}
}

function updateBadges() {
  const nBadge = document.querySelector('[data-page="notifications"] .nav-badge');
  if (nBadge) {
    const u = notifications.filter(n => !n.read).length;
    nBadge.textContent = u; nBadge.style.display = u > 0 ? 'inline' : 'none';
  }
  const sBadge = document.querySelector('[data-page="surebets"] .nav-badge');
  if (sBadge) { sBadge.textContent = surebets.length; sBadge.style.display = surebets.length > 0 ? 'inline' : 'none'; }
  const vBadge = document.querySelector('[data-page="valuebets"] .nav-badge');
  if (vBadge && valueBets.length) { vBadge.textContent = valueBets.length; vBadge.style.display = 'inline'; }
}

function updateConnectionStatus() {
  const dot = document.querySelector('.status-dot');
  const txt = document.getElementById('serverStatus');
  if (dot && txt) {
    if (engineStats.engine_running) {
      dot.className = 'status-dot online';
      txt.textContent = `Online (${surebets.length} SB, ${valueBets.length} VB)`;
    } else { dot.className = 'status-dot offline'; txt.textContent = 'Silnik wyłączony'; }
  }
}

// ═══ Utilities ═══════════════════════════════════════════════════════

const CURRENCY_SYMBOLS = { PLN: 'zł', EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', CZK: 'Kč' };

function fmtCurr(amount) {
  const n = parseFloat(amount) || 0;
  const sym = CURRENCY_SYMBOLS[currentCurrency] || 'zł';
  return (n >= 0 ? '' : '-') + Math.abs(n).toFixed(2) + ' ' + sym;
}

function fmtPct(pct) {
  const n = parseFloat(pct) || 0;
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso); const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'przed chwilą';
  if (diff < 3600) return `${Math.floor(diff/60)} min temu`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h temu`;
  return d.toLocaleDateString('pl-PL', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
}

function bkColor(id) { return bookmakers[id]?.color || 'var(--primary)'; }
function bkName(id) { return bookmakers[id]?.name || id; }
function sportIcon(s) {
  const icons = {'piłka nożna':'⚽','koszykówka':'🏀','tenis':'🎾','siatkówka':'🏐','hokej':'🏒','piłka ręczna':'🤾','MMA':'🥊','boks':'🥊'};
  return icons[s] || '🎯';
}

// ═══ Init ════════════════════════════════════════════════════════════

async function init() {
  const savedUser = localStorage.getItem('sb-user');
  if (savedUser) currentUser = savedUser;
  const savedTheme = localStorage.getItem('sb-theme');
  if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
  
  await Promise.all([fetchAllData(), fetchBets(), fetchAccounts(), fetchSports(), fetchValueBets(), fetchMultiMarket()]);
  await checkAccountMode();
  updateUserMenu();
  // Update mode display
  updateModeToggleUI(accountMode);
  const acctBadge = document.getElementById('accountBadge');
  if (acctBadge) {
    acctBadge.textContent = accountMode === 'demo' ? 'DEMO' : 'REAL';
    acctBadge.style.display = 'inline';
    acctBadge.style.background = accountMode === 'demo' ? 'var(--info-bg)' : 'var(--profit-bg)';
    acctBadge.style.color = accountMode === 'demo' ? 'var(--info)' : 'var(--profit)';
  }
  navigate('dashboard');
  
  // Gentle timers with concurrent fetch guard
  let _fetching = false;
  updateTimer = setInterval(async () => {
    if (_fetching) return;
    _fetching = true;
    try { await fetchAllData(); } catch(e) {}
    _fetching = false;
  }, 15000);  // 15s instead of 10s to reduce server load
  
  notifTimer = setInterval(async () => {
    try {
      const n = await API.get('/api/notifications');
      if (n.success) { notifications = n.notifications || []; updateBadges(); }
    } catch(e) {}
  }, 12000);
  
  // Less frequent background refreshes
  setInterval(fetchValueBets, 30000);
  setInterval(fetchMultiMarket, 45000);
  setInterval(checkNewSurebets, 30000);
}

let lastSurebetCount = 0;
async function checkNewSurebets() {
  try {
    const cfg = await API.get('/api/notifications/config');
    if (cfg.config?.sound_enabled && surebets.length > lastSurebetCount && lastSurebetCount > 0) {
      playAlert();
    }
    lastSurebetCount = surebets.length;
  } catch(e) {}
}

function playAlert() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 800;
    gain.gain.value = 0.3;
    osc.start(); setTimeout(() => { osc.stop(); ctx.close(); }, 200);
  } catch(e) {}
  
  if (navigator.vibrate) navigator.vibrate(200);
}

// ═══════════════════════════════════════════════════════════════════════
//  PAGE RENDERERS
// ═══════════════════════════════════════════════════════════════════════

// ═══ DASHBOARD ═══════════════════════════════════════════════════════

function renderDashboard(area) {
  const tp = stats.total_profit || 0;
  const wr = stats.total_bets > 0 ? ((stats.won_bets / stats.total_bets) * 100).toFixed(1) : '0.0';
  const bal = bankroll.current_balance || 0;
  
  let h = `
  <div class="page-header">
    <div>
      <h2>🏠 Dashboard</h2>
      <div class="subtitle">
        ${engineStats.engine_running ? '🟢 Silnik aktywny' : '🔴 Silnik wyłączony'} 
        • ${surebets.length} surebetów • ${valueBets.length} value betów
        • ${engineStats.data_source_label || '💻 Symulacja'}
        ${currentUser ? `• 👤 ${currentUser}` : ''}
      </div>
    </div>
    <button class="btn btn-primary" onclick="navigate('surebets')">🔍 Surebety</button>
  </div>
  <div class="stats-grid">
    <div class="stat-card"><div class="stat-icon">💰</div>
      <div class="stat-value ${tp>=0?'profit':'loss'}">${fmtCurr(bal)}</div>
      <div class="stat-label">Stan konta</div></div>
    <div class="stat-card"><div class="stat-icon">📈</div>
      <div class="stat-value ${tp>=0?'profit':'loss'}">${fmtPct(tp)}</div>
      <div class="stat-label">Łączny zysk</div></div>
    <div class="stat-card"><div class="stat-icon">🎯</div>
      <div class="stat-value">${surebets.length}</div>
      <div class="stat-label">Surebety</div></div>
    <div class="stat-card"><div class="stat-icon">💎</div>
      <div class="stat-value">${valueBets.length}</div>
      <div class="stat-label">Value Bety</div></div>
  </div>
  <div class="stats-grid">
    <div class="stat-card"><div class="stat-icon">✅</div>
      <div class="stat-value" style="-webkit-text-fill-color:var(--profit);color:var(--profit)">${stats.won_bets||0}</div>
      <div class="stat-label">Wygrane</div></div>
    <div class="stat-card"><div class="stat-icon">❌</div>
      <div class="stat-value" style="-webkit-text-fill-color:var(--loss);color:var(--loss)">${stats.lost_bets||0}</div>
      <div class="stat-label">Przegrane</div></div>
    <div class="stat-card"><div class="stat-icon">🎯</div>
      <div class="stat-value">${wr}%</div>
      <div class="stat-label">Skuteczność</div></div>
    <div class="stat-card"><div class="stat-icon">🔥</div>
      <div class="stat-value">${stats.best_streak||0}</div>
      <div class="stat-label">Najdłuższa seria</div></div>
  </div>`;

  // Best opportunities or empty message
  if (surebets.length > 0) {
    h += `<div class="subheader">🔥 Najlepsze surebety</div>`;
    surebets.slice(0, 4).forEach(sb => h += renderSurebetCard(sb));
  } else if (window.engineMessage) {
    h += `<div class="card" style="margin-bottom:16px;background:var(--bg-card);border:2px solid var(--warning);border-radius:16px">
      <div style="padding:20px;text-align:center">
        <div style="font-size:48px;margin-bottom:12px">📡</div>
        <div style="font-size:18px;font-weight:700;margin-bottom:8px">Brak połączenia z API</div>
        <div style="white-space:pre-line;font-size:13px;line-height:1.7;color:var(--text-secondary);margin-bottom:16px">${window.engineMessage}</div>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="navigate('settings')">⚙️ Ustawienia</button>
          <button class="btn btn-secondary" onclick="window.open('https://the-odds-api.com','_blank')">🌐 Pobierz klucz API</button>
        </div>
      </div>
    </div>`;
  }
  if (valueBets.length > 0) {
    h += `<div class="subheader">💎 Najlepsze value bety</div>`;
    valueBets.slice(0, 3).forEach(vb => h += renderValueBetCard(vb));
  }
  
  // Daily chart
  if (dailyChart.length > 0) {
    const last7 = dailyChart.slice(-7);
    const maxP = Math.max(...last7.map(d => Math.abs(d.profit)), 1);
    h += `<div class="subheader">📊 Ostatnie 7 dni</div><div class="chart-container">`;
    last7.forEach(d => {
      const pct = Math.abs(d.profit) / maxP * 100;
      h += `<div class="chart-bar"><div class="bar-label">${d.date.slice(5)}</div>
        <div class="bar-track"><div class="bar-fill ${d.profit>=0?'profit':'loss'}" style="width:${pct}%"></div></div>
        <div class="bar-value ${d.profit>=0?'amount positive':'amount negative'}">${fmtCurr(d.profit)}</div></div>`;
    });
    h += `</div>`;
  }
  
  // Quick actions
  h += `<div class="subheader">⚡ Szybkie akcje</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">
    <div class="card" style="cursor:pointer;text-align:center;padding:16px" onclick="navigate('surebets')">
      <div style="font-size:28px;margin-bottom:6px">🔍</div><div style="font-weight:600">Surebety</div>
      <div style="font-size:11px;color:var(--text-secondary)">1X2, AH, O/U, BTTS</div></div>
    <div class="card" style="cursor:pointer;text-align:center;padding:16px" onclick="navigate('valuebets')">
      <div style="font-size:28px;margin-bottom:6px">💎</div><div style="font-weight:600">Value Bety</div>
      <div style="font-size:11px;color:var(--text-secondary)">Expected value > 0</div></div>
    <div class="card" style="cursor:pointer;text-align:center;padding:16px" onclick="navigate('calculator')">
      <div style="font-size:28px;margin-bottom:6px">🧮</div><div style="font-weight:600">Kalkulatory</div>
      <div style="font-size:11px;color:var(--text-secondary)">Kelly, Dutching, Tax</div></div>
    <div class="card" style="cursor:pointer;text-align:center;padding:16px" onclick="navigate('multimarket')">
      <div style="font-size:28px;margin-bottom:6px">📊</div><div style="font-weight:600">Multi-Rynek</div>
      <div style="font-size:11px;color:var(--text-secondary)">AH, O/U, BTTS</div></div>
    <div class="card" style="cursor:pointer;text-align:center;padding:16px" onclick="navigate('backtest')">
      <div style="font-size:28px;margin-bottom:6px">📈</div><div style="font-weight:600">Backtesting</div>
      <div style="font-size:11px;color:var(--text-secondary)">Testuj strategie</div></div>
    <div class="card" style="cursor:pointer;text-align:center;padding:16px" onclick="navigate('margins')">
      <div style="font-size:28px;margin-bottom:6px">📉</div><div style="font-weight:600">Analiza marż</div>
      <div style="font-size:11px;color:var(--text-secondary)">Ranking bukmacherów</div></div>
  </div>`;

  area.innerHTML = h;
}

// ═══ SURETBETS ═══════════════════════════════════════════════════════

function renderSurebets(area) {
  let h = `
  <div class="page-header">
    <div><h2>🔍 Surebety</h2><div class="subtitle">${surebets.length} znalezionych</div></div>
    <button class="btn btn-primary" onclick="refreshSurebets()">🔄 Odśwież</button>
  </div>
  <div class="filters-bar">
    <div class="filter-group"><label>Sport:</label>
      <select id="fSport" onchange="applyFilters()">${['all',...sports].map(s => `<option value="${s}">${s==='all'?'Wszystkie':s}</option>`).join('')}</select></div>
    <div class="filter-group"><label>Rynek:</label>
      <select id="fMarket" onchange="applyFilters()">
        <option value="all">Wszystkie</option>
        <option value="1X2">1X2</option>
        <option value="AH">Asian Handicap</option>
        <option value="OU">Over/Under</option>
        <option value="BTTS">BTTS</option>
      </select></div>
    <div class="filter-group"><label>Min. zysk:</label>
      <select id="fMinProfit" onchange="applyFilters()">
        ${[0,0.5,1,2,3,5,10].map(v => `<option value="${v}">≥${v}%</option>`).join('')}
      </select></div>
    <div class="filter-group"><label>Sortuj:</label>
      <select id="fSort" onchange="applyFilters()">
        <option value="profit">Zysk ↓</option>
        <option value="confidence">Pewność ↓</option>
        <option value="date">Data ↓</option>
      </select></div>
  </div>
  <div id="surebetList"><div class="loading"><div class="spinner"></div></div></div>`;
  area.innerHTML = h;
  applyFilters();
}

async function applyFilters() {
  const sport = document.getElementById('fSport')?.value || 'all';
  const market = document.getElementById('fMarket')?.value || 'all';
  const minP = document.getElementById('fMinProfit')?.value || 0;
  const sort = document.getElementById('fSort')?.value || 'profit';
  try {
    const d = await API.get(`/api/surebets?sport=${sport}&min_profit=${minP}&market=${market}&sort=${sort}&limit=50`);
    const list = d.surebets || [];
    const el = document.getElementById('surebetList');
    if (!el) return;
    if (list.length === 0) {
      if (window.engineMessage) {
        el.innerHTML = `<div style="text-align:center;padding:40px 20px">
          <div style="font-size:64px;margin-bottom:16px">📡</div>
          <div style="font-size:20px;font-weight:700;margin-bottom:8px">Brak surebetów</div>
          <div style="white-space:pre-line;font-size:14px;line-height:1.7;color:var(--text-secondary);margin-bottom:20px">${window.engineMessage}</div>
          <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
            <button class="btn btn-primary btn-lg" onclick="navigate('settings')">⚙️ Konfiguruj API</button>
            <button class="btn btn-secondary btn-lg" onclick="window.open('https://the-odds-api.com','_blank')">🌐 the-odds-api.com</button>
          </div>
        </div>`;
      } else {
        el.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">Brak surebetów</div>
          <div class="empty-desc">Spróbuj zmienić filtry</div></div>`;
      }
      return;
    }
    let h = `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">${list.length} surebetów</div>`;
    list.forEach(sb => h += renderSurebetCard(sb));
    el.innerHTML = h;
  } catch(e) {
    const el = document.getElementById('surebetList');
    if (el) el.innerHTML = `<div class="alert error">Błąd: ${e.message}</div>`;
  }
}

async function refreshSurebets() {
  toast('Odświeżanie...', 'info');
  await fetchAllData();
  applyFilters();
  toast('✅ Odświeżono', 'success', 1500);
}

function renderSurebetCard(sb) {
  const isMulti = sb.type?.startsWith('multi_');
  const isPreview = false;
  const marketLabel = sb.market === 'AH' ? 'Asian Handicap' : sb.market === 'OU' ? 'Over/Under' : sb.market === 'BTTS' ? 'BTTS' : '1X2';
  const label = sb.label || marketLabel;
  
  let oddsHtml = '';
  for (const [out, odd] of Object.entries(sb.best_odds || {})) {
    if (['1','X','2','O','U','Tak','Nie'].includes(out)) {
      const from = sb.best_odds[out+'_from'] || '';
      oddsHtml += `<span class="odds-item">${out}: ${odd}</span>`;
    }
  }
  
  return `
  <div class="surebet-card" onclick="navigate('surebetdetail','${sb.id}')">
    <div class="sb-header">
      <span class="sb-sport">${sportIcon(sb.sport)} ${sb.sport}</span>
      <span class="sb-league">${sb.league || ''}</span>

      ${isMulti ? `<span class="badge badge-info">${label}</span>` : ''}
      <span class="sb-profit">+${sb.profit_pct}%</span>
    </div>
    <div class="sb-match">${sb.team1} vs ${sb.team2}</div>
    <div class="sb-bookmakers">
      <span style="color:${bkColor(sb.bookmaker1)}">● ${sb.bookmaker1_name}</span>
      <span style="color:${bkColor(sb.bookmaker2)}">● ${sb.bookmaker2_name}</span>
    </div>
    <div class="sb-details">
      <span>💰 ${fmtCurr(sb.profit)}</span>
      <span>📊 ROI ${sb.roi}%</span>
      <span>🎯 ${sb.confidence}%</span>
      <span>🕐 ${fmtDate(sb.expires)}</span>
    </div>
    <div class="sb-details" style="margin-top:4px">${oddsHtml}</div>
    <div class="sb-actions">
      <button class="btn btn-sm btn-primary" onclick="event.stopPropagation();quickPlaceBet('${sb.id}')">⚡ Obstaw</button>
      <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();navigate('surebetdetail','${sb.id}')">📋 Szczegóły</button>
    </div>
  </div>`;
}

// ═══ VALUE BETS ══════════════════════════════════════════════════════

function renderValueBets(area) {
  let h = `
  <div class="page-header">
    <div><h2>💎 Value Bety</h2><div class="subtitle">Zakłady z dodatnim expected value (${valueBets.length})</div></div>
    <button class="btn btn-primary" onclick="fetchValueBets().then(()=>renderValueBets(document.getElementById('contentArea')))">🔄 Odśwież</button>
  </div>
  <div class="filters-bar">
    <div class="filter-group"><label>Sport:</label>
      <select id="vbSport" onchange="applyVBFilter()">${['all',...sports].map(s => `<option value="${s}">${s==='all'?'Wszystkie':s}</option>`).join('')}</select></div>
    <div class="filter-group"><label>Min. EV:</label>
      <select id="vbMinEV" onchange="applyVBFilter()">
        ${[0,2,5,10,20].map(v => `<option value="${v}">≥${v}%</option>`).join('')}
      </select></div>
  </div>
  <div id="valueBetList"><div class="loading"><div class="spinner"></div></div></div>`;
  area.innerHTML = h;
  applyVBFilter();
}

function applyVBFilter() {
  const sport = document.getElementById('vbSport')?.value || 'all';
  const minEV = parseInt(document.getElementById('vbMinEV')?.value) || 0;
  let vbs = [...valueBets];
  if (sport !== 'all') vbs = vbs.filter(v => v.sport === sport);
  vbs = vbs.filter(v => v.expected_value >= minEV);
  const el = document.getElementById('valueBetList');
  if (!el) return;
  if (vbs.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">💎</div><div class="empty-title">Brak value betów</div></div>`;
    return;
  }
  let h = `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">${vbs.length} value betów</div>`;
  vbs.forEach(vb => h += renderValueBetCard(vb));
  el.innerHTML = h;
}

function renderValueBetCard(vb) {
  const evColor = vb.expected_value >= 10 ? 'var(--profit)' : vb.expected_value >= 5 ? 'var(--warning)' : 'var(--info)';
  return `
  <div class="card" style="margin-bottom:10px">
    <div style="display:flex;align-items:center;gap:12px">
      <div style="width:40px;height:40px;border-radius:10px;background:var(--inverse-bg);display:flex;align-items:center;justify-content:center;font-size:20px">💎</div>
      <div style="flex:1">
        <div style="font-weight:600">${vb.team1} vs ${vb.team2}</div>
        <div style="font-size:12px;color:var(--text-secondary)">
          ${sportIcon(vb.sport)} ${vb.sport} • ${vb.bookmaker_name} • ${vb.outcome} @ ${vb.odds}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:18px;font-weight:700;color:${evColor}">+${vb.expected_value}% EV</div>
        <div style="font-size:11px;color:var(--text-secondary)">Pewność: ${vb.confidence}%</div>
      </div>
    </div>
    <div style="margin-top:8px;display:flex;gap:8px;font-size:11px;color:var(--text-muted)">
      <span class="pill pill-info">Imp. prob: ${vb.implied_prob}%</span>
      <span class="pill pill-profit">Est. prob: ${vb.estimated_prob}%</span>
      <span class="pill pill-warning">Zalecana stawka: ${fmtCurr(vb.recommended_stake)}</span>
    </div>
  </div>`;
}

// ═══ MULTI-MARKET ════════════════════════════════════════════════════

function renderMultiMarket(area) {
  let h = `
  <div class="page-header">
    <div><h2>📊 Multi-Rynek</h2><div class="subtitle">AH, O/U, BTTS surebety (${multiMarket.length})</div></div>
    <button class="btn btn-primary" onclick="fetchMultiMarket().then(()=>renderMultiMarket(document.getElementById('contentArea')))">🔄 Odśwież</button>
  </div>
  <div class="filters-bar">
    <div class="filter-group"><label>Rynek:</label>
      <select id="mmMarket" onchange="applyMMFilter()">
        <option value="all">Wszystkie</option>
        <option value="AH">Asian Handicap</option>
        <option value="OU">Over/Under</option>
        <option value="BTTS">BTTS</option>
      </select></div>
    <div class="filter-group"><label>Sport:</label>
      <select id="mmSport" onchange="applyMMFilter()">${['all',...sports].map(s => `<option value="${s}">${s==='all'?'Wszystkie':s}</option>`).join('')}</select></div>
  </div>
  <div id="mmList"><div class="loading"><div class="spinner"></div></div></div>`;
  area.innerHTML = h;
  applyMMFilter();
}

function applyMMFilter() {
  const market = document.getElementById('mmMarket')?.value || 'all';
  const sport = document.getElementById('mmSport')?.value || 'all';
  let mm = [...multiMarket];
  if (market !== 'all') mm = mm.filter(m => m.market === market);
  if (sport !== 'all') mm = mm.filter(m => m.sport === sport);
  const el = document.getElementById('mmList');
  if (!el) return;
  if (mm.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">Brak okazji</div></div>`; return;
  }
  let h = `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">${mm.length} okazji</div>`;
  mm.forEach(m => {
    const label = m.label || m.market;
    const outcomes = Object.entries(m.best_odds || {}).filter(([k]) => !k.includes('_from'));
    let oddsH = outcomes.map(([o,v]) => `<span class="odds-item">${o}: ${v}</span>`).join(' ');
    h += `
    <div class="card" style="margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:10px">
        <span class="badge badge-info">${label}</span>
        <div style="flex:1;font-weight:600;font-size:14px">${m.team1} vs ${m.team2}</div>
        <div style="text-align:right">
          <div style="font-size:20px;font-weight:700;color:var(--profit)">+${m.profit_pct}%</div>
          <div style="font-size:11px;color:var(--text-muted)">${fmtCurr(m.profit)}</div>
        </div>
      </div>
      <div style="margin-top:8px;display:flex;gap:8px;font-size:11px;color:var(--text-secondary)">
        <span>${sportIcon(m.sport)} ${m.sport}</span>
        <span>● ${m.bookmaker1_name}</span>
        <span>● ${m.bookmaker2_name}</span>
        <span>${oddsH}</span>
      </div>
    </div>`;
  });
  el.innerHTML = h;
}

// ═══ SURETBET DETAIL ═════════════════════════════════════════════════

function renderSurebetDetail(area, id) {
  const sb = surebets.find(s => s.id === id);
  if (!sb) {
    area.innerHTML = `<div class="alert error">Nie znaleziono</div>
      <button class="btn btn-primary" onclick="navigate('surebets')">← Powrót</button>`;
    return;
  }
  
  // Fetch risk assessment
  API.get(`/api/surebets/${id}`).then(d => {
    const risk = d.surebet?.risk_assessment;
    if (risk) {
      const riskEl = document.getElementById('riskAssessment');
      if (riskEl) {
        const riskColor = risk.risk_level === 'niski' ? 'var(--profit)' : risk.risk_level === 'średni' ? 'var(--warning)' : 'var(--loss)';
        riskEl.innerHTML = `
          <div class="card-body">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
              <div style="font-size:32px">${risk.risk_level === 'niski' ? '🟢' : risk.risk_level === 'średni' ? '🟡' : '🔴'}</div>
              <div><div style="font-weight:600">Poziom ryzyka: <span style="color:${riskColor}">${risk.risk_level.toUpperCase()}</span></div>
              <div style="font-size:12px;color:var(--text-secondary)">Ocena: ${risk.score}/99</div></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px">
              ${risk.factors?.map(f => `<div style="padding:4px 8px;background:var(--bg-secondary);border-radius:6px">
                ${f[0]}: <strong>${f[1]}</strong></div>`).join('') || ''}
            </div>
          </div>`;
      }
    }
  }).catch(() => {});
  
  let h = `
  <button class="btn btn-sm btn-secondary" onclick="navigate('surebets')" style="margin-bottom:16px">← Powrót</button>
  
  <div class="card" style="margin-bottom:12px">
    <div class="card-header"><h3>${sb.team1} vs ${sb.team2}</h3>
      <span class="profit-badge positive">+${sb.profit_pct}%</span></div>
    <div class="card-body">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div><div style="font-size:11px;color:var(--text-muted)">Sport</div><div style="font-weight:600">${sportIcon(sb.sport)} ${sb.sport}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">Liga</div><div style="font-weight:600">${sb.league||'-'}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">Rynek</div><div><span class="badge badge-info">${sb.market||'1X2'}</span></div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">Wygasa</div><div style="color:var(--warning)">${fmtDate(sb.expires)}</div></div>
      </div>
    </div>
  </div>`;
  
  // Stakes breakdown
  const outcomes = ['1','X','2','O','U','Tak','Nie'].filter(o => sb.best_odds?.[o]);
  h += `<div class="card" style="margin-bottom:12px">
    <div class="card-header"><h3>🏦 Stawki</h3></div>
    <div class="card-body">`;
  outcomes.forEach(out => {
    const odd = sb.best_odds?.[out];
    const from = sb.best_odds?.[out+'_from'];
    const stake = sb.stakes?.[out] || 0;
    if (!odd) return;
    h += `<div style="display:flex;align-items:center;gap:10px;padding:8px;background:var(--bg-secondary);border-radius:var(--radius-xs);margin-bottom:6px">
      <span style="font-weight:600;min-width:60px">${out}</span>
      <span class="pill pill-info">Kurs: ${odd}</span>
      <span class="pill pill-profit">Stawka: ${fmtCurr(stake)}</span>
      <span style="margin-left:auto;font-size:12px;color:var(--text-secondary)">${bkName(from)}</span>
    </div>`;
  });
  h += `</div></div>`;
  
  // Summary
  h += `<div class="card" style="margin-bottom:12px">
    <div class="card-header"><h3>📊 Podsumowanie</h3></div>
    <div class="card-body">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div><div style="font-size:11px;color:var(--text-muted)">Stawka</div><div style="font-size:20px;font-weight:700">${fmtCurr(sb.total_stake)}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">Gwarantowany zysk</div><div style="font-size:20px;font-weight:700;color:var(--profit)">${fmtCurr(sb.profit)}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">ROI</div><div style="font-size:20px;font-weight:700;color:var(--profit)">${sb.roi}%</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">Inwersja</div><div style="font-size:20px;font-weight:700">${sb.inv_sum}</div></div>
      </div>
      <button class="btn btn-primary btn-block" style="margin-top:12px" onclick="quickPlaceBet('${sb.id}')">⚡ Obstaw ten surebet</button>
    </div>
  </div>`;
  
  // Risk assessment
  h += `<div class="card" id="riskCard" style="margin-bottom:12px">
    <div class="card-header"><h3>🛡️ Ocena ryzyka</h3></div>
    <div id="riskAssessment"><div class="loading"><div class="spinner"></div></div></div>
  </div>`;
  
  // Match statistics
  API.get(`/api/matches/${sb.match_id}/stats`).then(d => {
    if (d.success) {
      const ms = d.stats;
      const el = document.getElementById('matchStats');
      if (!el) return;
      h = `<div class="card-header"><h3>📊 Statystyki meczu</h3></div>
      <div class="card-body">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
          <div style="text-align:center"><div style="font-size:11px;color:var(--text-muted)">${ms.team1.name}</div>
            <div style="font-size:18px;font-weight:700">${ms.team1.avg_goals_for}</div>
            <div style="font-size:10px;color:var(--text-muted)">Śr. bramki</div></div>
          <div style="text-align:center"><div style="font-size:11px;color:var(--text-muted)">vs</div>
            <div style="font-size:14px;color:var(--text-secondary)">pos. ${ms.team1.possession}%/${ms.team2.possession}%</div>
            <div style="font-size:10px;color:var(--text-muted)">Posiadanie</div></div>
          <div style="text-align:center"><div style="font-size:11px;color:var(--text-muted)">${ms.team2.name}</div>
            <div style="font-size:18px;font-weight:700">${ms.team2.avg_goals_for}</div>
            <div style="font-size:10px;color:var(--text-muted)">Śr. bramki</div></div>
        </div>
        <div style="font-size:12px;color:var(--text-secondary)">
          <div>Forma ${ms.team1.name}: ${ms.team1.form.map(f => f==='W'?'✅':'❌').join(' ')}</div>
          <div>Forma ${ms.team2.name}: ${ms.team2.form.map(f => f==='W'?'✅':'❌').join(' ')}</div>
          <div>Liga: ${ms.league_position_team1}. vs ${ms.league_position_team2}.</div>
        </div>
        ${ms.h2h?.length > 0 ? `
        <div style="margin-top:10px"><div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Ostatnie mecze:</div>
        ${ms.h2h.map(h => `<span class="pill pill-info">${h.team1_goals}:${h.team2_goals}</span>`).join(' ')}</div>` : ''}
      </div>`;
      el.innerHTML = h;
    }
  }).catch(() => {});
  
  h += `<div class="card" id="matchStats"><div class="loading"><div class="spinner"></div></div></div>`;
  
  area.innerHTML = h;
}

// ═══ BOOKMAKERS ══════════════════════════════════════════════════════

function renderBookmakers(area) {
  const bks = Object.entries(bookmakers);
  let h = `<div class="page-header"><div><h2>🏢 Bukmacherzy</h2><div class="subtitle">${bks.length} bukmacherów</div></div>
    <button class="btn btn-primary" onclick="navigate('register')">📝 Rejestracja</button></div>`;
  
  bks.forEach(([id, bk]) => {
    h += `<div class="card" style="margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:44px;height:44px;border-radius:12px;background:${bk.color||'var(--bg-secondary)'};display:flex;align-items:center;justify-content:center;font-size:20px;color:#fff;font-weight:700">${bk.name?.charAt(0)||'?'}</div>
        <div style="flex:1"><div style="font-weight:600">${bk.name||id}</div>
          <div style="font-size:11px;color:var(--text-secondary)">⭐ ${bk.rating} • ${bk.country||''} • Marża: ${(bk.avg_margin*100).toFixed(1)}% • Rzetelność: ${bk.reliability}%</div></div>
        <div style="text-align:right">
          <div class="badge ${bk.has_account?'badge-profit':'badge-warning'}">${bk.has_account?'✅ Konto':'❌ Brak'}</div>
        </div>
      </div>
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;font-size:11px">
        ${bk.sports?.slice(0,5).map(s => `<span class="pill pill-info">${s}</span>`).join('')}
      </div>
      <div style="margin-top:8px;display:flex;gap:8px">
        ${bk.has_auto_registration?`<button class="btn btn-sm btn-secondary" onclick="navigate('register','${id}')">📝 Rejestracja</button>`:''}
        ${bk.has_account?`<button class="btn btn-sm btn-success">🔑 Zaloguj</button>`:''}
        <button class="btn btn-sm btn-secondary" onclick="showBookmakerDetail('${id}')">📊 Szczegóły</button>
      </div>
    </div>`;
  });
  area.innerHTML = h;
}

async function showBookmakerDetail(bkId) {
  try {
    const d = await API.get(`/api/bookmakers/${bkId}`);
    if (!d.success) { toast('Błąd', 'error'); return; }
    const bk = d.bookmaker;
    openModal(`
      <div class="modal-header"><h3>${bk.name}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div style="margin-bottom:16px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div><div style="font-size:11px;color:var(--text-muted)">Kraj</div><div>${bk.country||'-'}</div></div>
          <div><div style="font-size:11px;color:var(--text-muted)">Ocena</div><div>⭐ ${bk.rating}</div></div>
          <div><div style="font-size:11px;color:var(--text-muted)">Marża</div><div>${(bk.avg_margin*100).toFixed(1)}%</div></div>
          <div><div style="font-size:11px;color:var(--text-muted)">Rzetelność</div><div>${bk.reliability}%</div></div>
          <div><div style="font-size:11px;color:var(--text-muted)">Szybkość wypłat</div><div>${'⭐'.repeat(Math.round(bk.payout_speed||3))}</div></div>
          <div><div style="font-size:11px;color:var(--text-muted)">Auto-rejestracja</div><div>${bk.has_auto_registration?'✅ Tak':'❌ Nie'}</div></div>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">
        Sporty: ${bk.sports?.join(', ')||'-'}
      </div>
      ${bk.accounts?.length ? `<div class="subheader">Konta (${bk.accounts.length})</div>
        ${bk.accounts.map(a => `<div class="list-item"><div>👤 ${a.first_name} ${a.last_name}</div><div style="margin-left:auto">${a.is_verified?'✅':'⏳'}</div></div>`).join('')}` : ''}
    `);
  } catch(e) { toast('Błąd', 'error'); }
}

// ═══ ACCOUNTS ════════════════════════════════════════════════════════

function renderAccounts(area) {
  const accList = Object.values(accounts);
  let h = `<div class="page-header"><div><h2>👤 Konta</h2><div class="subtitle">${accList.length} kont</div></div>
    <button class="btn btn-primary" onclick="navigate('register')">📝 Dodaj</button></div>`;
  
  if (accList.length === 0) {
    h += `<div class="empty-state"><div class="empty-icon">👤</div><div class="empty-title">Brak kont</div>
      <button class="btn btn-primary" onclick="navigate('register')">📝 Zarejestruj</button></div>`;
    area.innerHTML = h; return;
  }
  
  accList.forEach(a => {
    h += `<div class="card" style="margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:40px;height:40px;border-radius:10px;background:var(--bg-secondary);display:flex;align-items:center;justify-content:center;font-size:18px">👤</div>
        <div style="flex:1"><div style="font-weight:600">${a.first_name} ${a.last_name}</div>
          <div style="font-size:12px;color:var(--text-secondary)">${a.bookmaker_name} • ${a.email}</div></div>
        <div style="text-align:right">
          <div class="badge ${a.is_verified?'badge-profit':'badge-warning'}">${a.is_verified?'✅ Zweryfikowane':'⏳ Nie'}</div>
          ${a.bonus_available?`<div class="pill pill-profit" style="margin-top:4px">🎁 ${fmtCurr(a.bonus_amount)}</div>`:''}
        </div>
      </div>
      ${!a.is_verified?`<button class="btn btn-sm btn-secondary" style="margin-top:8px" onclick="verifyAccount('${a.id}')">✅ Zweryfikuj</button>`:''}
    </div>`;
  });
  area.innerHTML = h;
}

async function verifyAccount(aid) {
  toast('Weryfikacja...', 'info');
  try {
    const r = await API.post(`/api/accounts/${aid}/verify`);
    if (r.success) { toast('✅ Konto zweryfikowane!', 'success'); await fetchAccounts(); navigate('accounts'); }
    else toast(`❌ ${r.error}`, 'error');
  } catch(e) { toast('Błąd', 'error'); }
}

// ═══ REGISTER ════════════════════════════════════════════════════════

function renderRegister(area, bkId) {
  let h = `
  <div class="page-header"><div><h2>📝 Rejestracja konta</h2><div class="subtitle">Automatyczne zakładanie kont</div></div></div>
  <div class="card">
    <div class="card-header"><h3>📋 Dane osobowe</h3></div>
    <div class="card-body">
      <div class="form-group"><label>Bukmacher</label>
        <select class="form-select" id="regBk">
          ${Object.entries(bookmakers).filter(([,b])=>b.has_auto_registration).map(([id,b])=>`<option value="${id}" ${id===bkId?'selected':''}>${b.name}</option>`).join('')}
        </select></div>
      <div class="form-row">
        <div class="form-group"><label>Imię</label><input class="form-input" id="regFn" placeholder="Jan"></div>
        <div class="form-group"><label>Nazwisko</label><input class="form-input" id="regLn" placeholder="Kowalski"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Email</label><input class="form-input" id="regEmail" type="email" placeholder="jan@example.com"></div>
        <div class="form-group"><label>Telefon</label><input class="form-input" id="regPhone" type="tel" placeholder="+48123456789"></div>
      </div>
      <div class="form-group"><label>PESEL</label><input class="form-input" id="regPesel" placeholder="12345678901" maxlength="11"></div>
      <div class="form-row">
        <div class="form-group"><label>Ulica</label><input class="form-input" id="regStreet" placeholder="ul. Przykładowa 1"></div>
        <div class="form-group"><label>Miasto</label><input class="form-input" id="regCity" placeholder="Warszawa"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Kod pocztowy</label><input class="form-input" id="regZip" placeholder="00-001"></div>
        <div class="form-group"><label>Hasło</label><input class="form-input" id="regPass" type="password" placeholder="••••••••"></div>
      </div>
      <div class="form-group"><label>Kod promocyjny</label><input class="form-input" id="regPromo" placeholder="BONUS2024"></div>
      <button class="btn btn-primary btn-lg btn-block" onclick="submitReg()">📝 Zarejestruj</button>
    </div>
  </div>`;
  area.innerHTML = h;
}

async function submitReg() {
  const data = {
    bookmaker_id: document.getElementById('regBk')?.value,
    first_name: document.getElementById('regFn')?.value?.trim(),
    last_name: document.getElementById('regLn')?.value?.trim(),
    email: document.getElementById('regEmail')?.value?.trim(),
    phone: document.getElementById('regPhone')?.value?.trim(),
    pesel: document.getElementById('regPesel')?.value?.trim(),
    street: document.getElementById('regStreet')?.value?.trim(),
    city: document.getElementById('regCity')?.value?.trim(),
    zip: document.getElementById('regZip')?.value?.trim(),
    password: document.getElementById('regPass')?.value,
    promo_code: document.getElementById('regPromo')?.value?.trim(),
  };
  
  if (!data.first_name || !data.last_name || !data.email || !data.phone || !data.pesel || !data.street || !data.city || !data.zip || !data.password) {
    toast('❌ Wypełnij wszystkie pola', 'error'); return;
  }
  if (data.pesel.length !== 11) { toast('❌ PESEL: 11 cyfr', 'error'); return; }
  if (!data.email.includes('@')) { toast('❌ Nieprawidłowy email', 'error'); return; }
  
  const btn = event.target; btn.disabled = true; btn.textContent = '⏳ Rejestracja...';
  toast('Rejestracja...', 'info', 5000);
  try {
    const r = await API.post('/api/accounts/register', data);
    btn.disabled = false; btn.textContent = '📝 Zarejestruj';
    if (r.success) {
      toast(`✅ ${r.message}${r.bonus>0?` +${r.bonus} PLN bonusu!`:''}`, 'success', 5000);
      await fetchAccounts(); setTimeout(() => navigate('accounts'), 1500);
    } else toast(`❌ ${r.error}`, 'error', 5000);
  } catch(e) { btn.disabled = false; btn.textContent = '📝 Zarejestruj'; toast('Błąd serwera', 'error'); }
}

// ═══ AUTO-BET ════════════════════════════════════════════════════════

function renderAutoBet(area) {
  let h = `
  <div class="page-header"><div><h2>🤖 Auto-Bet</h2><div class="subtitle">Automatyczne obstawianie</div></div></div>
  <div class="card card-glass" style="margin-bottom:16px">
    <div style="display:flex;align-items:center;gap:14px">
      <div style="font-size:40px">🤖</div>
      <div style="flex:1"><div style="font-weight:600;font-size:16px" id="abStatusLabel">Sprawdzanie...</div>
        <div style="font-size:12px;color:var(--text-secondary)" id="abStatusDetail"></div></div>
      <label class="toggle"><input type="checkbox" id="abToggle" onchange="toggleAutoBet()"><div class="toggle-slider"></div></label>
    </div>
  </div>
  <div class="card" style="margin-bottom:16px">
    <div class="card-header"><h3>⚙️ Konfiguracja</h3></div>
    <div class="card-body">
      <div class="form-group"><label>Maks. stawka</label><input class="form-input" type="number" id="abMaxStake" value="200" min="10"></div>
      <div class="form-row">
        <div class="form-group"><label>Min. zysk (%)</label><input class="form-input" type="number" id="abMinProfit" value="1" step="0.1"></div>
        <div class="form-group"><label>Max jednoczesnych</label>
          <select class="form-select" id="abMaxConc">${[1,2,3,5,10].map(n => `<option value="${n}">${n}</option>`).join('')}</select></div>
      </div>
      <div class="form-group"><label>Strategia</label>
        <select class="form-select" id="abStrategy">
          <option value="conservative">🛡️ Konserwatywna</option>
          <option value="balanced" selected>⚖️ Zrównoważona</option>
          <option value="aggressive">🔥 Agresywna</option>
        </select></div>
      <div class="form-group"><label class="toggle">
        <input type="checkbox" id="abUseKelly" onchange="toggleKellyOpts()"><div class="toggle-slider"></div>
        <span class="toggle-label">Użyj Kelly Criterion</span></label></div>
      <div id="kellyOpts" style="display:none">
        <div class="form-group"><label>Ułamek Kelly</label>
          <select class="form-select" id="abKellyFrac">
            <option value="0.1">10% (konserwatywny)</option>
            <option value="0.25" selected>25% (zalecany)</option>
            <option value="0.5">50% (agresywny)</option>
          </select></div>
      </div>
      <button class="btn btn-primary btn-block" onclick="saveAutoBetConfig()">💾 Zapisz</button>
    </div>
  </div>
  <div id="abStats"></div>`;
  area.innerHTML = h;
  loadAutoBetStatus();
}

async function loadAutoBetStatus() {
  const cached = window._autobetStatus;
  if (cached && cached.config) {
    updateAutoBetUI(cached);
    return;
  }
  try {
    const d = await API.get('/api/autobet/status');
    if (!d.success) return;
    window._autobetStatus = d;
    updateAutoBetUI(d);
  } catch(e) {}
}

function updateAutoBetUI(d) {
  if (!d || !d.config) return;
  const cfg = d.config;
  const f1 = document.getElementById('abToggle');
  if (f1) f1.checked = d.running;
  const f2 = document.getElementById('abMaxStake');
  if (f2) f2.value = cfg.max_stake_per_bet || 200;
  const f3 = document.getElementById('abMinProfit');
  if (f3) f3.value = cfg.min_profit || 1;
  const f4 = document.getElementById('abMaxConc');
  if (f4) f4.value = cfg.max_concurrent || 3;
  const f5 = document.getElementById('abStrategy');
  if (f5) f5.value = cfg.strategy || 'balanced';
  const f6 = document.getElementById('abUseKelly');
  if (f6) f6.checked = cfg.use_kelly || false;
  const f7 = document.getElementById('abKellyFrac');
  if (f7) f7.value = cfg.kelly_fraction || 0.25;
  const ko = document.getElementById('kellyOpts');
  if (ko) ko.style.display = cfg.use_kelly ? 'block' : 'none';
  const sl = document.getElementById('abStatusLabel');
  if (sl) sl.textContent = d.running ? '🤖 Auto-Bet \uD83D\uDFE2 AKTYWNY' : '🤖 Auto-Bet \uD83D\uDD34 WY\u0141\u0104CZONY';
  const sd = document.getElementById('abStatusDetail');
  if (sd) sd.textContent = d.running ? 'Obstawiono: ' + d.total_auto_bets + ' zak\u0142ad\u00F3w \u2022 ' + d.recent_bets_1h + ' w ostatniej godzinie' : 'Kliknij prze\u0142\u0105cznik aby w\u0142\u0105czy\u0107 automatyczne obstawianie';
  const st = document.getElementById('abStats');
  if (st) st.innerHTML = '<div class="stats-grid"><div class="stat-card"><div class="stat-icon">\uD83D\uDCCA</div><div class="stat-value">' + d.total_auto_bets + '</div><div class="stat-label">Wszystkie zak\u0142ady</div></div><div class="stat-card"><div class="stat-icon">\u23F0</div><div class="stat-value">' + d.recent_bets_1h + '</div><div class="stat-label">Zak\u0142ady (1h)</div></div><div class="stat-card"><div class="stat-icon">' + (d.running ? '\uD83D\uDFE2' : '\uD83D\uDD34') + '</div><div class="stat-value">' + (d.running ? 'Aktywny' : 'Wy\u0142\u0105czony') + '</div><div class="stat-label">Status</div></div></div>';
}
function toggleKellyOpts() {
  document.getElementById('kellyOpts').style.display = document.getElementById('abUseKelly').checked ? 'block' : 'none';
}

async function toggleAutoBet() {
  try {
    const r = await API.post('/api/autobet/toggle');
    toast(r.enabled ? '🤖 Auto-Bet włączony!' : '🤖 Auto-Bet wyłączony', r.enabled ? 'success' : 'warning');
    renderAutoBet(document.getElementById('contentArea'));
  } catch(e) { toast('Błąd', 'error'); }
}

async function saveAutoBetConfig() {
  const cfg = {
    enabled: document.getElementById('abToggle')?.checked || false,
    max_stake_per_bet: parseFloat(document.getElementById('abMaxStake')?.value) || 100,
    min_profit: parseFloat(document.getElementById('abMinProfit')?.value) || 1,
    max_concurrent: parseInt(document.getElementById('abMaxConc')?.value) || 3,
    strategy: document.getElementById('abStrategy')?.value || 'balanced',
    use_kelly: document.getElementById('abUseKelly')?.checked || false,
    kelly_fraction: parseFloat(document.getElementById('abKellyFrac')?.value) || 0.25,
  };
  try {
    const r = await API.post('/api/autobet/config', cfg);
    if (r.success) toast('✅ Konfiguracja zapisana', 'success');
  } catch(e) { toast('❌ Błąd', 'error'); }
}

// ═══ BANKROLL ════════════════════════════════════════════════════════

function renderBankroll(area) {
  const bal = bankroll.current_balance || 0;
  const bkBal = bankroll.bookmaker_balance || 0;
  const totalWithBk = bankroll.total_with_bookmakers || bal;
  const init = bankroll.initial_balance || 10000;
  const change = bal - init;
  const totalChange = (totalWithBk || bal) - init;
  const chgPct = init > 0 ? ((change/init)*100).toFixed(2) : 0;
  const peak = bankroll.peak_balance || bal;
  const dd = peak > 0 ? ((peak - bal) / peak * 100).toFixed(1) : 0;
  
  let h = `<div class="page-header"><div><h2>🏦 Portfel</h2>
    <div class="subtitle">${accountMode === 'real' ? '💵 Tryb REAL' : '🎮 Tryb DEMO'}</div></div></div>
  <div class="stats-grid">
    <div class="stat-card"><div class="stat-icon">💰</div>
      <div class="stat-value ${change>=0?'profit':'loss'}">${fmtCurr(bal)}</div>
      <div class="stat-label">Stan konta</div></div>
    ${accountMode === 'real' && bkBal > 0 ? `<div class="stat-card"><div class="stat-icon">🏢</div>
      <div class="stat-value profit">${fmtCurr(bkBal)}</div>
      <div class="stat-label">Konta BK</div></div>
    <div class="stat-card"><div class="stat-icon">💎</div>
      <div class="stat-value profit">${fmtCurr(totalWithBk)}</div>
      <div class="stat-label">Łącznie z BK</div></div>` : ''}
    <div class="stat-card"><div class="stat-icon">📈</div>
      <div class="stat-value ${change>=0?'profit':'loss'}">${fmtCurr(change)}</div>
      <div class="stat-label">Zmiana</div></div>
    <div class="stat-card"><div class="stat-icon">🏔️</div>
      <div class="stat-value">${fmtCurr(peak)}</div>
      <div class="stat-label">Najwyższy stan</div></div>
    <div class="stat-card"><div class="stat-icon">📉</div>
      <div class="stat-value" style="-webkit-text-fill-color:var(--loss);color:var(--loss)">${dd}%</div>
      <div class="stat-label">Drawdown</div></div>
  </div>
  <div class="card" style="margin-bottom:16px">
    <div class="card-header"><h3>💳 Operacje</h3></div>
    <div class="card-body">
      <div class="form-group"><label>Kwota (PLN)</label>
        <input class="form-input" type="number" id="txnAmt" placeholder="100" min="1" step="10"></div>
      <div style="display:flex;gap:10px">
        <button class="btn btn-success" style="flex:1" onclick="deposit()">💰 Wpłata</button>
        <button class="btn btn-danger" style="flex:1" onclick="withdraw()">💸 Wypłata</button>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-header"><h3>📋 Transakcje</h3></div>
    <div class="card-body" id="txnList"><div class="loading"><div class="spinner"></div></div></div>
  </div>`;
  area.innerHTML = h;
  loadTransactions();
}

async function loadTransactions() {
  const el = document.getElementById('txnList');
  if (!el) return;
  // Use cached data if available (from fetchAllData)
  const cached = window._allTransactions;
  if (cached && cached.length > 0) {
    const recent = cached.slice(0, 20);
    el.innerHTML = recent.map(t => {
      const isDep = t.type === 'deposit' || (t.amount > 0 && t.type !== 'withdrawal');
      return `<div class="list-item">
        <div class="li-icon">${isDep ? '💰' : '💸'}</div>
        <div class="li-content"><div class="li-title">${isDep ? 'Wpłata' : 'Wypłata'}</div>
          <div class="li-subtitle">${fmtDate(t.timestamp)}</div></div>
        <div class="li-extra">
          <div class="li-value ${isDep ? 'amount positive' : 'amount negative'}">${isDep ? '+' : '-'}${fmtCurr(t.amount)}</div>
          <div style="font-size:11px;color:var(--text-muted)">${fmtCurr(t.balance_after)}</div></div>
      </div>`;
    }).join('');
    return;
  }
  // Fallback: fetch from API
  try {
    const d = await API.get('/api/transactions?limit=20');
    if (!el || !d.success) return;
    if (!d.transactions?.length) { el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)">Brak transakcji</div>'; return; }
    el.innerHTML = d.transactions.map(t => {
      const isDep = t.type === 'deposit' || (t.amount > 0 && t.type !== 'withdrawal');
      return '<div class="list-item"><div class="li-icon">' + (isDep ? '💰' : '💸') + '</div><div class="li-content"><div class="li-title">' + (isDep ? 'Wpłata' : 'Wypłata') + '</div><div class="li-subtitle">' + fmtDate(t.timestamp) + '</div></div><div class="li-extra"><div class="li-value ' + (isDep ? 'amount positive' : 'amount negative') + '">' + (isDep ? '+' : '-') + fmtCurr(t.amount) + '</div><div style="font-size:11px;color:var(--text-muted)">' + fmtCurr(t.balance_after) + '</div></div></div>';
    }).join('');
  } catch(e) {}
}

async function deposit() {
  if (accountMode !== 'real') { toast('⚠️ Wpłaty działają tylko w trybie REAL. Przełącz na REAL.', 'warning', 4000); return; }
  const amt = parseFloat(document.getElementById('txnAmt')?.value);
  if (!amt || amt <= 0) { toast('Podaj kwotę', 'error'); return; }
  try {
    const r = await API.post('/api/bankroll/deposit', {amount: amt});
    if (r.success) {
      bankroll = r.bankroll;
      realBalance = r.bankroll.balance || r.bankroll.current_balance;
      API.clearCache();
      // Gentle refresh: update state then toast
      toast('💰 Wpłacono ' + fmtCurr(amt), 'success');
    }
  } catch(e) { toast('Błąd serwera: ' + e.message, 'error'); }
}

async function withdraw() {
  if (accountMode !== 'real') { toast('⚠️ Wypłaty działają tylko w trybie REAL. Przełącz na REAL.', 'warning', 4000); return; }
  const amt = parseFloat(document.getElementById('txnAmt')?.value);
  if (!amt || amt <= 0) { toast('Podaj kwotę', 'error'); return; }
  try {
    const r = await API.post('/api/bankroll/withdraw', {amount: amt});
    if (r.success) {
      bankroll = r.bankroll;
      realBalance = r.bankroll.balance || r.bankroll.current_balance;
      API.clearCache();
      toast('💸 Wypłacono ' + fmtCurr(amt), 'success');
    }
    else toast('❌ ' + r.error, 'error');
  } catch(e) { toast('Błąd serwera: ' + e.message, 'error'); }
}
// ═══ CALCULATOR ══════════════════════════════════════════════════════

function renderCalculator(area) {
  let h = `
  <div class="page-header"><div><h2>🧮 Kalkulatory</h2><div class="subtitle">Surebet, Kelly, Dutching, Podatki, Waluty</div></div></div>
  <div class="tabs">
    <div class="tab active" onclick="switchCalcTab(this,'surebet')">🎯 Surebet</div>
    <div class="tab" onclick="switchCalcTab(this,'kelly')">📊 Kelly</div>
    <div class="tab" onclick="switchCalcTab(this,'dutching')">🎪 Dutching</div>
    <div class="tab" onclick="switchCalcTab(this,'tax')">💰 Podatek</div>
    <div class="tab" onclick="switchCalcTab(this,'currency')">💱 Waluty</div>
  </div>
  <div id="calcContent"></div>`;
  area.innerHTML = h;
  showSurebetCalc();
}

function switchCalcTab(el, tab) {
  document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  if (tab === 'surebet') showSurebetCalc();
  else if (tab === 'kelly') showKellyCalc();
  else if (tab === 'dutching') showDutchingCalc();
  else if (tab === 'tax') showTaxCalc();
  else if (tab === 'currency') showCurrencyCalc();
}

function showSurebetCalc() {
  document.getElementById('calcContent').innerHTML = `
    <div class="card">
      <div class="card-header"><h3>🎯 Kalkulator Surebet</h3></div>
      <div class="card-body">
        <div class="form-row">
          <div class="form-group"><label>Kurs 1</label><input class="form-input" id="csO1" type="number" step="0.01" min="1.01" placeholder="2.50"></div>
          <div class="form-group"><label>Kurs X (opcjonalnie)</label><input class="form-input" id="csOX" type="number" step="0.01" min="1.01" placeholder="3.50"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Kurs 2</label><input class="form-input" id="csO2" type="number" step="0.01" min="1.01" placeholder="3.80"></div>
          <div class="form-group"><label>Stawka (PLN)</label><input class="form-input" id="csStake" type="number" value="100"></div>
        </div>
        <button class="btn btn-primary btn-block" onclick="calcSurebet()">🧮 Oblicz</button>
      </div>
    </div>
    <div id="csResult"></div>`;
}

async function calcSurebet() {
  const o1 = parseFloat(document.getElementById('csO1')?.value);
  const oX = parseFloat(document.getElementById('csOX')?.value) || null;
  const o2 = parseFloat(document.getElementById('csO2')?.value);
  const stake = parseFloat(document.getElementById('csStake')?.value) || 100;
  if (!o1 || !o2) { toast('Podaj kursy', 'error'); return; }
  try {
    const r = await API.post('/api/calculator/surebet', {odds1:o1,odds2:o2,odds3:oX,stake});
    const el = document.getElementById('csResult');
    if (r.error) {
      el.innerHTML = `<div class="card" style="margin-top:12px;border-color:var(--warning)"><div style="text-align:center;padding:16px">
        <div style="font-size:36px;margin-bottom:8px">❌</div><div style="font-size:16px;font-weight:600;color:var(--warning)">To nie jest surebet!</div>
        <div style="color:var(--text-secondary);font-size:13px">Suma odwrotności: ${r.inv_sum} (powinna być &lt; 1)</div></div></div>`; return;
    }
    let html = `<div class="card" style="margin-top:12px;border-color:var(--profit)">
      <div style="text-align:center;padding:12px;border-bottom:1px solid var(--border)">
        <div style="font-size:36px;margin-bottom:4px">🎉</div>
        <div style="font-size:20px;font-weight:700;color:var(--profit)">Surebet! +${r.profit_pct}%</div></div>
      <div class="card-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
          <div><div style="font-size:11px;color:var(--text-muted)">Inwersja</div><div style="font-weight:600">${r.inv_sum}</div></div>
          <div><div style="font-size:11px;color:var(--text-muted)">Stawka</div><div style="font-weight:600">${fmtCurr(r.total_stake)}</div></div>
          <div><div style="font-size:11px;color:var(--text-muted)">Zysk</div><div style="font-weight:700;color:var(--profit)">${fmtCurr(r.profit)}</div></div>
          <div><div style="font-size:11px;color:var(--text-muted)">Zwrot</div><div style="font-weight:600">${fmtCurr(r.guaranteed_return)}</div></div>
        </div>`;
    r.stakes?.forEach(s => {
      html += `<div style="display:flex;gap:8px;padding:6px;background:var(--bg-secondary);border-radius:6px;margin-bottom:4px">
        <span class="pill pill-info">Kurs: ${s.odds}</span>
        <span class="pill pill-profit">Stawka: ${fmtCurr(s.stake)}</span>
        <span style="margin-left:auto;font-size:12px;color:var(--profit)">Zwrot: ${fmtCurr(s.return)}</span></div>`;
    });
    html += `</div></div>`;
    el.innerHTML = html;
  } catch(e) { toast('Błąd', 'error'); }
}

function showKellyCalc() {
  document.getElementById('calcContent').innerHTML = `
    <div class="card">
      <div class="card-header"><h3>📊 Kelly Criterion</h3></div>
      <div class="card-body">
        <div class="form-group"><label>Prawdopodobieństwo (%)</label><input class="form-input" id="kcProb" type="number" value="55" min="1" max="99"></div>
        <div class="form-group"><label>Kurs</label><input class="form-input" id="kcOdds" type="number" value="2.0" step="0.01" min="1.01"></div>
        <div class="form-group"><label>Bankroll (PLN)</label><input class="form-input" id="kcBankroll" type="number" value="10000"></div>
        <div class="form-group"><label>Ułamek Kelly</label>
          <select class="form-select" id="kcFraction">
            <option value="0.1">10% (konserwatywny)</option>
            <option value="0.25" selected>25% (zalecany)</option>
            <option value="0.5">50% (agresywny)</option>
            <option value="1.0">100% (full Kelly)</option>
          </select></div>
        <button class="btn btn-primary btn-block" onclick="calcKelly()">📊 Oblicz</button>
      </div>
    </div>
    <div id="kcResult"></div>`;
}

async function calcKelly() {
  const prob = parseFloat(document.getElementById('kcProb')?.value);
  const odds = parseFloat(document.getElementById('kcOdds')?.value);
  const bankroll = parseFloat(document.getElementById('kcBankroll')?.value);
  const frac = parseFloat(document.getElementById('kcFraction')?.value);
  if (!prob || !odds) { toast('Wprowadź dane', 'error'); return; }
  try {
    const r = await API.post('/api/calculator/kelly', {probability:prob,odds,bankroll,kelly_fraction:frac});
    document.getElementById('kcResult').innerHTML = `
      <div class="card" style="margin-top:12px;border-color:var(--primary)">
        <div class="card-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:center">
            <div><div style="font-size:11px;color:var(--text-muted)">Optymalna stawka</div>
              <div style="font-size:24px;font-weight:700;color:var(--profit)">${fmtCurr(r.optimal_stake)}</div></div>
            <div><div style="font-size:11px;color:var(--text-muted)">% bankrollu</div>
              <div style="font-size:24px;font-weight:700">${r.stake_pct}%</div></div>
            <div><div style="font-size:11px;color:var(--text-muted)">Expected Value</div>
              <div style="font-size:20px;font-weight:700;color:${r.expected_value>=0?'var(--profit)':'var(--loss)'}">${r.expected_value}%</div></div>
            <div><div style="font-size:11px;color:var(--text-muted)">Full Kelly</div>
              <div style="font-size:20px;font-weight:700">${r.full_kelly_pct}%</div></div>
          </div>
        </div>
      </div>`;
  } catch(e) { toast('Błąd', 'error'); }
}

function showDutchingCalc() {
  document.getElementById('calcContent').innerHTML = `
    <div class="card">
      <div class="card-header"><h3>🎪 Dutching Calculator</h3></div>
      <div class="card-body">
        <div class="form-row">
          <div class="form-group"><label>Kurs 1</label><input class="form-input" id="dcO1" type="number" step="0.01" placeholder="2.50"></div>
          <div class="form-group"><label>Kurs 2</label><input class="form-input" id="dcO2" type="number" step="0.01" placeholder="3.40"></div>
        </div>
        <div class="form-group"><label>Kurs 3 (opcjonalnie)</label><input class="form-input" id="dcO3" type="number" step="0.01" placeholder="4.00"></div>
        <div class="form-group"><label>Całkowita stawka (PLN)</label><input class="form-input" id="dcStake" type="number" value="100"></div>
        <button class="btn btn-primary btn-block" onclick="calcDutching()">🎪 Oblicz</button>
      </div>
    </div>
    <div id="dcResult"></div>`;
}

async function calcDutching() {
  const o1 = parseFloat(document.getElementById('dcO1')?.value);
  const o2 = parseFloat(document.getElementById('dcO2')?.value);
  const o3 = parseFloat(document.getElementById('dcO3')?.value) || null;
  const stake = parseFloat(document.getElementById('dcStake')?.value) || 100;
  if (!o1 || !o2) { toast('Podaj kursy', 'error'); return; }
  try {
    const r = await API.post('/api/calculator/dutching', {odds1:o1,odds2:o2,odds3:o3,stake});
    if (r.error) { toast(r.error, 'error'); return; }
    let html = `<div class="card" style="margin-top:12px">
      <div class="card-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;text-align:center">
          <div><div style="font-size:11px;color:var(--text-muted)">Stawka</div><div style="font-size:20px;font-weight:700">${fmtCurr(r.total_stake)}</div></div>
          <div><div style="font-size:11px;color:var(--text-muted)">Gwarantowany zwrot</div><div style="font-size:20px;font-weight:700;color:var(--profit)">${fmtCurr(r.guaranteed_return)}</div></div>
        </div>`;
    r.stakes?.forEach((s, i) => {
      html += `<div style="display:flex;gap:8px;padding:6px;background:var(--bg-secondary);border-radius:6px;margin-bottom:4px">
        <span style="font-weight:600">Kurs ${i+1}</span>
        <span class="pill pill-info">Kurs: ${s.odds||'?'}</span>
        <span class="pill pill-profit">Stawka: ${fmtCurr(s.stake||s)}</span>
        <span style="margin-left:auto;color:var(--profit)">Zwrot: ${fmtCurr(s.return||0)}</span></div>`;
    });
    html += `</div></div>`;
    document.getElementById('dcResult').innerHTML = html;
  } catch(e) { toast('Błąd', 'error'); }
}

function showTaxCalc() {
  document.getElementById('calcContent').innerHTML = `
    <div class="card">
      <div class="card-header"><h3>💰 Kalkulator podatku</h3></div>
      <div class="card-body">
        <p style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">Polski podatek od wygranych: 12% po przekroczeniu ${fmtCurr(2280)} rocznie</p>
        <div class="form-group"><label>Zysk z zakładu (PLN)</label><input class="form-input" id="txProfit" type="number" value="500" step="10"></div>
        <div class="form-group"><label>Dotychczasowy zysk w tym roku (PLN)</label><input class="form-input" id="txYearly" type="number" value="0" step="100"></div>
        <button class="btn btn-primary btn-block" onclick="calcTax()">💰 Oblicz podatek</button>
      </div>
    </div>
    <div id="txResult"></div>`;
}

async function calcTax() {
  const profit = parseFloat(document.getElementById('txProfit')?.value);
  const yearly = parseFloat(document.getElementById('txYearly')?.value) || 0;
  if (!profit) { toast('Podaj zysk', 'error'); return; }
  try {
    const r = await API.post('/api/calculator/tax', {profit, yearly_profit: yearly});
    document.getElementById('txResult').innerHTML = `
      <div class="card" style="margin-top:12px;border-color:${r.tax>0?'var(--warning)':'var(--profit)'}">
        <div class="card-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:center">
            <div><div style="font-size:11px;color:var(--text-muted)">Zysk brutto</div><div style="font-size:20px;font-weight:700">${fmtCurr(r.gross_profit||profit)}</div></div>
            <div><div style="font-size:11px;color:var(--text-muted)">Podatek</div><div style="font-size:20px;font-weight:700;color:${r.tax>0?'var(--loss)':'var(--profit)'}">${fmtCurr(r.tax)}</div></div>
            <div><div style="font-size:11px;color:var(--text-muted)">Zysk netto</div><div style="font-size:20px;font-weight:700;color:var(--profit)">${fmtCurr(r.net_profit)}</div></div>
            <div><div style="font-size:11px;color:var(--text-muted)">Efektywna stawka</div><div style="font-size:20px;font-weight:700">${r.effective_rate}%</div></div>
          </div>
          ${r.tax_free_remaining > 0 ? `<div class="alert info" style="margin-top:8px">💡 Możesz jeszcze wygrać ${fmtCurr(r.tax_free_remaining)} bez podatku!</div>` : ''}
        </div>
      </div>`;
  } catch(e) { toast('Błąd', 'error'); }
}

function showCurrencyCalc() {
  document.getElementById('calcContent').innerHTML = `
    <div class="card">
      <div class="card-header"><h3>💱 Konwerter walut</h3></div>
      <div class="card-body">
        <div class="form-row">
          <div class="form-group"><label>Kwota</label><input class="form-input" id="cvAmt" type="number" value="100" step="10"></div>
          <div class="form-group"><label>Z waluty</label>
            <select class="form-select" id="cvFrom">
              ${['PLN','EUR','USD','GBP','CHF','CZK'].map(c => `<option value="${c}" ${c==='PLN'?'selected':''}>${c}</option>`).join('')}
            </select></div>
        </div>
        <div class="form-group"><label>Na walutę</label>
          <select class="form-select" id="cvTo">
            ${['EUR','USD','PLN','GBP','CHF','CZK'].map(c => `<option value="${c}" ${c==='EUR'?'selected':''}>${c}</option>`).join('')}
          </select></div>
        <button class="btn btn-primary btn-block" onclick="calcCurrency()">💱 Konwertuj</button>
      </div>
    </div>
    <div id="cvResult"></div>`;
}

async function calcCurrency() {
  const amt = parseFloat(document.getElementById('cvAmt')?.value);
  const from = document.getElementById('cvFrom')?.value;
  const to = document.getElementById('cvTo')?.value;
  try {
    const r = await API.post('/api/calculator/currency', {amount: amt, from, to});
    document.getElementById('cvResult').innerHTML = `
      <div class="card" style="margin-top:12px;border-color:var(--primary)">
        <div class="card-body" style="text-align:center">
          <div style="font-size:14px;color:var(--text-secondary)">${amt} ${from} = </div>
          <div style="font-size:32px;font-weight:700;color:var(--primary)">${r.formatted}</div>
        </div>
      </div>`;
  } catch(e) { toast('Błąd', 'error'); }
}

// ═══ STATISTICS ══════════════════════════════════════════════════════

function renderStatistics(area) {
  const total = stats.total_bets || 0;
  const tp = stats.total_profit || 0;
  const won = stats.won_bets || 0;
  const lost = stats.lost_bets || 0;
  const roi = stats.roi || 0;
  const wr = total > 0 ? ((won/total)*100).toFixed(1) : 0;
  const streak = stats.best_streak || 0;
  const bw = stats.biggest_win || 0;
  const bl = stats.biggest_loss || 0;
  
  let h = `<div class="page-header"><div><h2>📊 Statystyki</h2><div class="subtitle">Szczegółowa analiza</div></div></div>
  <div class="stats-grid">
    <div class="stat-card"><div class="stat-icon">📊</div><div class="stat-value">${total}</div><div class="stat-label">Wszystkie</div></div>
    <div class="stat-card"><div class="stat-icon">✅</div><div class="stat-value" style="-webkit-text-fill-color:var(--profit);color:var(--profit)">${won}</div><div class="stat-label">Wygrane</div></div>
    <div class="stat-card"><div class="stat-icon">❌</div><div class="stat-value" style="-webkit-text-fill-color:var(--loss);color:var(--loss)">${lost}</div><div class="stat-label">Przegrane</div></div>
    <div class="stat-card"><div class="stat-icon">🎯</div><div class="stat-value">${wr}%</div><div class="stat-label">Skuteczność</div></div>
  </div>
  <div class="stats-grid">
    <div class="stat-card"><div class="stat-icon">📈</div><div class="stat-value ${tp>=0?'profit':'loss'}">${fmtPct(tp)}</div><div class="stat-label">Zysk</div></div>
    <div class="stat-card"><div class="stat-icon">🔄</div><div class="stat-value">${roi}%</div><div class="stat-label">ROI</div></div>
    <div class="stat-card"><div class="stat-icon">🔥</div><div class="stat-value">${streak}</div><div class="stat-label">Najlepsza seria</div></div>
    <div class="stat-card"><div class="stat-icon">🏆</div><div class="stat-value amount positive">${fmtCurr(bw)}</div><div class="stat-label">Największa wygrana</div></div>
  </div>`;
  
  // Daily chart
  if (dailyChart.length > 0) {
    const maxP = Math.max(...dailyChart.map(d => Math.abs(d.profit)), 1);
    h += `<div class="chart-container"><div class="card-header"><h3>📈 Dzienne zyski (30 dni)</h3></div>`;
    dailyChart.slice(-20).forEach(d => {
      const pct = Math.abs(d.profit) / maxP * 100;
      h += `<div class="chart-bar"><div class="bar-label">${d.date.slice(5)}</div>
        <div class="bar-track"><div class="bar-fill ${d.profit>=0?'profit':'loss'}" style="width:${pct}%"></div></div>
        <div class="bar-value ${d.profit>=0?'amount positive':'amount negative'}">${fmtCurr(d.profit)}</div></div>`;
    });
    h += `</div>`;
  }
  
  // Sport stats
  h += `<div class="card" style="margin-top:12px"><div class="card-header"><h3>🏅 Po sportach</h3></div>
    <div class="card-body" id="sportStats"><div class="loading"><div class="spinner"></div></div></div></div>`;
  
  // Bookmaker stats
  h += `<div class="card" style="margin-top:12px"><div class="card-header"><h3>🏢 Po bukmacherach</h3></div>
    <div class="card-body" id="bkStats"><div class="loading"><div class="spinner"></div></div></div></div>`;
  
  area.innerHTML = h;
  loadAdvancedStats();
}

async function loadAdvancedStats() {
  try {
    const d = await API.get('/api/statistics');
    if (!d.success) return;
    
    const sportEl = document.getElementById('sportStats');
    if (sportEl) {
      const sp = Object.entries(d.sport_stats || {});
      if (sp.length === 0) sportEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted)">Brak danych</div>';
      else sportEl.innerHTML = sp.map(([s,st]) => `
        <div class="list-item">
          <div class="li-icon">${sportIcon(s)}</div>
          <div class="li-content"><div class="li-title">${s}</div><div class="li-subtitle">${st.won}/${st.bets} wygranych</div></div>
          <div class="li-extra"><div class="li-value ${st.profit>=0?'amount positive':'amount negative'}">${fmtCurr(st.profit)}</div></div>
        </div>`).join('');
    }
    
    const bkEl = document.getElementById('bkStats');
    if (bkEl) {
      const bk_ = Object.entries(d.bookmaker_stats || {});
      if (bk_.length === 0) bkEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted)">Brak danych</div>';
      else bkEl.innerHTML = bk_.map(([b,st]) => `
        <div class="list-item">
          <div class="li-icon">🏢</div>
          <div class="li-content"><div class="li-title">${b}</div><div class="li-subtitle">W:${st.won} P:${st.lost}</div></div>
          <div class="li-extra"><div class="li-value ${st.profit>=0?'amount positive':'amount negative'}">${fmtCurr(st.profit)}</div></div>
        </div>`).join('');
    }
  } catch(e) {}
}

// ═══ HISTORY ═════════════════════════════════════════════════════════

function renderHistory(area) {
  let h = `<div class="page-header"><div><h2>📋 Historia</h2><div class="subtitle">${bets.length} zakładów</div></div>
    <button class="btn btn-secondary" onclick="refreshHistory()">🔄 Odśwież</button></div>`;
  
  if (bets.length === 0) {
    h += `<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-title">Brak historii</div>
      <button class="btn btn-primary" onclick="navigate('surebets')">🔍 Znajdź surebety</button></div>`;
    area.innerHTML = h; return;
  }
  
  bets.forEach(b => {
    const won = b.status === 'won';
    h += `<div class="card" style="margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="font-size:24px">${won?'✅':'❌'}</div>
        <div style="flex:1"><div style="font-weight:600;font-size:14px">${b.match}</div>
          <div style="font-size:11px;color:var(--text-secondary)">${b.bookmakers||''} • ${b.sport||''} • ${b.market?'['+b.market+']':''}</div></div>
        <div style="text-align:right">
          <div style="font-weight:700;color:${won?'var(--profit)':'var(--loss)'}">${won?'+':''}${fmtCurr(b.actual_profit)}</div>
          <div style="font-size:11px;color:var(--text-muted)">${fmtCurr(b.stake)}</div></div>
      </div>
      <div style="margin-top:6px;display:flex;gap:6px;font-size:11px;color:var(--text-muted)">
        <span class="pill ${won?'pill-profit':'pill-loss'}">${b.profit_pct}%</span>
        <span>📅 ${fmtDate(b.timestamp)}</span>
        <span>Oczekiwany: ${fmtCurr(b.expected_profit)}</span>
      </div>
    </div>`;
  });
  area.innerHTML = h;
}

async function refreshHistory() { await fetchBets(); renderHistory(document.getElementById('contentArea')); toast('Odświeżono', 'success', 1500); }

// ═══ NOTIFICATIONS ═══════════════════════════════════════════════════

function renderNotifications(area) {
  let h = `<div class="page-header"><div><h2>🔔 Powiadomienia</h2><div class="subtitle">${notifications.filter(n=>!n.read).length} nieprzeczytanych</div></div>
    <button class="btn btn-secondary" onclick="markAllRead()">✅ Wszystkie przeczytane</button></div>`;
  
  if (notifications.length === 0) {
    h += `<div class="empty-state"><div class="empty-icon">🔔</div><div class="empty-title">Brak powiadomień</div></div>`;
    area.innerHTML = h; return;
  }
  
  notifications.forEach(n => {
    h += `<div class="card" style="margin-bottom:8px;${!n.read?'border-color:var(--primary);background:var(--primary-glow)':''}">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="font-size:24px">${n.profit_pct >= 3 ? '🔥' : n.expected_value ? '💎' : '💡'}</div>
        <div style="flex:1"><div style="font-weight:600;font-size:14px">${n.title||'Powiadomienie'}</div>
          <div style="font-size:12px;color:var(--text-secondary)">${n.body||''}</div></div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:11px;color:var(--text-muted)">${fmtDate(n.timestamp)}</div>
          ${!n.read?`<span class="badge badge-profit">NEW</span>`:''}
        </div>
      </div>
      ${n.surebet_id ? `<button class="btn btn-sm btn-secondary" style="margin-top:6px" onclick="navigate('surebetdetail','${n.surebet_id}')">🔍 Zobacz</button>` : ''}
    </div>`;
  });
  area.innerHTML = h;
}

async function markAllRead() {
  try { await API.post('/api/notifications/read', {id:'all'}); notifications.forEach(n=>n.read=true); updateBadges(); toast('✅ Oznaczono', 'success'); }
  catch(e) { toast('Błąd', 'error'); }
}

// ═══ SETTINGS ════════════════════════════════════════════════════════

function renderSettings(area) {
  let h = `
  <div class="page-header"><div><h2>⚙️ Ustawienia</h2></div></div>
  
  <div class="card" style="margin-bottom:12px">
    <div class="card-header"><h3>🎨 Wygląd</h3></div>
    <div class="card-body">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${[['dark','🌙','Ciemny'],['light','☀️','Jasny'],['professional','💼','Profesjonalny'],['ocean','🌊','Ocean'],['neon','💚','Neon']].map(([t,i,l]) =>
          `<div class="card" style="cursor:pointer;text-align:center;padding:10px;flex:1;min-width:60px" onclick="setTheme('${t}')">
            <div style="font-size:28px">${i}</div><div style="font-size:10px;margin-top:2px">${l}</div></div>`).join('')}
      </div>
    </div>
  </div>
  
  <div class="card" style="margin-bottom:12px">
    <div class="card-header"><h3>🔔 Dźwięk i wibracje</h3></div>
    <div class="card-body">
      <div class="form-group"><label class="toggle">
        <input type="checkbox" id="sndEnabled" checked onchange="saveAlertConfig()"><div class="toggle-slider"></div>
        <span class="toggle-label">Dźwięk alertów</span></label></div>
      <div class="form-group"><label class="toggle">
        <input type="checkbox" id="vibEnabled" checked onchange="saveAlertConfig()"><div class="toggle-slider"></div>
        <span class="toggle-label">Wibracje</span></label></div>
    </div>
  </div>
  
  <div class="card" style="margin-bottom:12px">
    <div class="card-header"><h3>💱 Waluta</h3></div>
    <div class="card-body">
      <div class="form-group"><label>Wyświetlana waluta</label>
        <select class="form-select" id="currencySelect" onchange="changeCurrency()">
          ${[['PLN','zł'],['EUR','€'],['USD','$'],['GBP','£'],['CHF','CHF'],['CZK','Kč']].map(([c,s]) => `<option value="${c}" ${c===currentCurrency?'selected':''}>${c} (${s})</option>`).join('')}
        </select></div>
    </div>
  </div>
  
  <div class="card" style="margin-bottom:12px">
    <div class="card-header"><h3>👤 Konto</h3></div>
    <div class="card-body">
      ${currentUser ? `<p style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">Zalogowany jako: <strong>${currentUser}</strong></p>
        <button class="btn btn-secondary" onclick="logout()">🚪 Wyloguj</button>`
      : `<p style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">Nie jesteś zalogowany</p>
        <div style="display:flex;gap:8px"><input class="form-input" id="loginUser" placeholder="Email lub login" style="flex:1">
        <input class="form-input" id="loginPass" type="password" placeholder="Hasło" style="flex:1">
        <button class="btn btn-primary" onclick="login()">🔑 Zaloguj</button></div>`}
    </div>
  </div>
  


  <div class="card" style="margin-bottom:12px">
    <div class="card-header"><h3>🔑 Klucze API</h3></div>
    <div class="card-body">
      <div id="apiKeysList" style="font-size:13px;margin-bottom:10px">
        <div class="loading"><div class="spinner"></div></div>
      </div>
      <div id="apiKeyForm" style="display:none">
        <div class="form-group"><label>Dostawca</label>
          <select class="form-select" id="apiProvider">
            <option value="theoddsapi">🏆 The Odds API (kursy 70+ bukmacherów)</option>
            <option value="api_football">⚽ API-Football (mecze piłkarskie)</option>
          </select></div>
        <div class="form-group"><label>Klucz API</label>
          <input class="form-input" id="apiKeyInput" placeholder="Wklej swój klucz API" type="text"></div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary" style="flex:1" onclick="saveApiKey()">💾 Zapisz i testuj</button>
          <button class="btn btn-secondary" onclick="cancelApiKey()">Anuluj</button>
        </div>
        <div style="margin-top:8px;font-size:11px;color:var(--text-muted)">
          🔓 Klucz przechowywany lokalnie. Darmowe klucze:<br>
          • <a href="https://the-odds-api.com" target="_blank" style="color:var(--primary)">The Odds API</a> — 500 zapytań/miesiąc za darmo<br>
          • <a href="https://www.api-football.com" target="_blank" style="color:var(--primary)">API-Football</a> — 100 zapytań/dzień za darmo
        </div>
      </div>
    </div>
  </div>
  
  <div class="card" style="margin-bottom:12px">
    <div class="card-header"><h3>💳 Klucze API Płatności</h3></div>
    <div class="card-body">
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px">
        Dodaj klucze API aby włączyć prawdziwe płatności. Bez kluczy płatności działają w trybie symulacji.
      </div>
      <div class="form-group"><label>Stripe (karty kredytowe)</label>
        <div style="display:flex;gap:4px">
          <input class="form-input" id="stripePk" placeholder="pk_live_..." style="flex:1;font-size:11px">
          <input class="form-input" id="stripeSk" placeholder="sk_live_..." style="flex:1;font-size:11px" type="password"></div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:2px">Wejdź na dashboard.stripe.com → Developers → API keys</div>
      </div>
      <div class="form-group"><label>PayPal</label>
        <div style="display:flex;gap:4px">
          <input class="form-input" id="paypalCid" placeholder="Client ID" style="flex:1;font-size:11px">
          <input class="form-input" id="paypalSecret" placeholder="Secret" style="flex:1;font-size:11px" type="password"></div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:2px">developer.paypal.com → Dashboard → Apps → Create App</div>
      </div>
      <div class="form-group"><label>Przelewy24</label>
        <div style="display:flex;gap:4px">
          <input class="form-input" id="p24Mid" placeholder="Merchant ID" style="flex:1;font-size:11px">
          <input class="form-input" id="p24Key" placeholder="API Key" style="flex:1;font-size:11px" type="password"></div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:2px">panel.przelewy24.pl → API → Klucze API</div>
      </div>
      <button class="btn btn-primary btn-block" onclick="savePaymentKeys()">💾 Zapisz klucze płatności</button>
      <div id="paymentKeysStatus" style="font-size:11px;margin-top:6px;color:var(--text-muted)"></div>
    </div>
  </div>
  
  <div class="card" style="margin-bottom:12px">
    <div class="card-header"><h3>🗄️ Dane</h3></div>
    <div class="card-body">
      <div style="display:flex;gap:8px">
        <button class="btn btn-secondary" style="flex:1" onclick="exportAllData()">📤 Eksport JSON</button>
        <button class="btn btn-secondary" style="flex:1" onclick="resetAllData()">🗑️ Reset</button>
      </div>
      <div style="margin-top:8px;font-size:12px;color:var(--text-muted)">
        Wersja: 5.0.0 • Silnik: ${engineStats.engine_running?'🟢':'🔴'} • Źródło: ${engineStats.data_source_label || '💻 Symulacja'} • Zakłady: ${stats.total_bets||0}
      </div>
    </div>
  </div>`;
  
  area.innerHTML = h;
  loadAlertConfig();
  loadPaymentKeys();
  loadApiKeys();
  loadApiKeysList();
}

async function loadAlertConfig() {
  try {
    const d = await API.get('/api/notifications/config');
    if (d.success) {
      const snd = document.getElementById('sndEnabled');
      if (snd) snd.checked = d.config.sound_enabled !== false;
      const vib = document.getElementById('vibEnabled');
      if (vib) vib.checked = d.config.vibration_enabled !== false;
    }
  } catch(e) {}
}

async function saveAlertConfig() {
  try {
    await API.post('/api/notifications/config', {
      sound_enabled: document.getElementById('sndEnabled').checked,
      vibration_enabled: document.getElementById('vibEnabled').checked,
    });
  } catch(e) {}
}

function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('sb-theme', t);
  toast(`🎨 Motyw: ${t}`, 'info', 1500);
}

function changeCurrency() {
  currentCurrency = document.getElementById('currencySelect').value;
  localStorage.setItem('sb-currency', currentCurrency);
  toast(`💱 Waluta: ${currentCurrency}`, 'info', 1500);
}

async function login() {
  const u = document.getElementById('loginUser')?.value;
  const p = document.getElementById('loginPass')?.value;
  if (!u || !p) { toast('Podaj login i hasło', 'error'); return; }
  try {
    const r = await API.post('/api/auth/login', {username: u, password: p});
    if (r.success) { currentUser = u; localStorage.setItem('sb-user', u); updateUserMenu(); toast(`👤 Zalogowano jako ${u}`, 'success'); renderSettings(document.getElementById('contentArea')); }
    else toast(`❌ ${r.error}`, 'error');
  } catch(e) { toast('Błąd', 'error'); }
}

function logout() {
  currentUser = null; localStorage.removeItem('sb-user');
  updateUserMenu(); closeUserMenu();
  toast('Wylogowano', 'info');
  if (document.getElementById('contentArea')) {
    const page = currentPage;
    if (PAGES[page]) PAGES[page].render(document.getElementById('contentArea'));
    else navigate('dashboard');
  }
}

async function exportAllData() {
  const data = {
    surebets, valueBets, bets,
    bankroll, stats, exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = `surebet-pro-${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(url);
  toast('📤 Eksportowano!', 'success');
}

function resetAllData() {
  if (!confirm('Czy na pewno zresetować wszystkie dane?')) return;
  localStorage.clear(); toast('Dane zresetowane', 'info'); location.reload();
}

// ═══ BACKTESTING ═════════════════════════════════════════════════════

function renderBacktest(area) {
  let h = `
  <div class="page-header"><div><h2>📈 Backtesting</h2><div class="subtitle">Testuj strategie na historycznych danych</div></div></div>
  <div class="card" style="margin-bottom:16px">
    <div class="card-header"><h3>⚙️ Parametry</h3></div>
    <div class="card-body">
      <div class="form-group"><label>Strategia</label>
        <select class="form-select" id="btStrategy">
          <option value="conservative">🛡️ Konserwatywna (75% WR)</option>
          <option value="balanced" selected>⚖️ Zrównoważona (65% WR)</option>
          <option value="aggressive">🔥 Agresywna (55% WR)</option>
        </select></div>
      <div class="form-row">
        <div class="form-group"><label>Kapitał początkowy (PLN)</label>
          <input class="form-input" type="number" id="btBankroll" value="10000"></div>
        <div class="form-group"><label>Liczba zakładów</label>
          <input class="form-input" type="number" id="btBets" value="200"></div>
      </div>
      <button class="btn btn-primary btn-block" onclick="runBacktest()">📈 Uruchom backtesting</button>
    </div>
  </div>
  <div id="btResult"></div>`;
  area.innerHTML = h;
}

async function runBacktest() {
  const strategy = document.getElementById('btStrategy').value;
  const bankroll = parseFloat(document.getElementById('btBankroll').value) || 10000;
  const numBets = parseInt(document.getElementById('btBets').value) || 200;
  
  const el = document.getElementById('btResult');
  el.innerHTML = '<div class="loading"><div class="spinner"></div><div style="margin-top:12px">🔮 Symulacja w toku...</div></div>';
  
  try {
    const r = await API.post('/api/backtest', {strategy, bankroll, num_bets: numBets});
    if (!r.success) { el.innerHTML = '<div class="alert error">Błąd</div>'; return; }
    
    const res = r.result;
    const eq = res.equity_curve || [];
    const maxEq = Math.max(...eq, 1);
    
    let h = `
    <div class="stats-grid" style="margin-top:12px">
      <div class="stat-card"><div class="stat-icon">💰</div>
        <div class="stat-value ${res.profit>=0?'profit':'loss'}">${fmtCurr(res.final_bankroll)}</div><div class="stat-label">Kapitał końcowy</div></div>
      <div class="stat-card"><div class="stat-icon">📈</div>
        <div class="stat-value ${res.profit>=0?'profit':'loss'}">${fmtCurr(res.profit)}</div><div class="stat-label">Zysk</div></div>
      <div class="stat-card"><div class="stat-icon">📊</div>
        <div class="stat-value ${res.roi>=0?'profit':'loss'}">${res.roi}%</div><div class="stat-label">ROI</div></div>
      <div class="stat-card"><div class="stat-icon">🎯</div>
        <div class="stat-value">${res.win_rate}%</div><div class="stat-label">Skuteczność</div></div>
    </div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-icon">📉</div>
        <div class="stat-value" style="-webkit-text-fill-color:var(--loss);color:var(--loss)">${res.max_drawdown}%</div><div class="stat-label">Max Drawdown</div></div>
      <div class="stat-card"><div class="stat-icon">🔥</div>
        <div class="stat-value">${res.best_streak}</div><div class="stat-label">Seria wygranych</div></div>
      <div class="stat-card"><div class="stat-icon">❌</div>
        <div class="stat-value">${Math.abs(res.worst_streak)}</div><div class="stat-label">Seria przegranych</div></div>
      <div class="stat-card"><div class="stat-icon">📋</div>
        <div class="stat-value">${res.total_bets}</div><div class="stat-label">Liczba zakładów</div></div>
    </div>`;
    
    // Equity curve
    h += `<div class="chart-container"><div class="card-header"><h3>📈 Krzywa kapitału</h3></div>`;
    const step = Math.max(1, Math.floor(eq.length / 20));
    for (let i = 0; i < eq.length; i += step) {
      const pct = (eq[i] / maxEq) * 100;
      const startVal = res.initial_bankroll;
      h += `<div class="chart-bar"><div class="bar-label">${i}</div>
        <div class="bar-track"><div class="bar-fill ${eq[i]>=startVal?'profit':'loss'}" style="width:${pct}%"></div></div>
        <div class="bar-value ${eq[i]>=startVal?'amount positive':'amount negative'}">${fmtCurr(eq[i])}</div></div>`;
    }
    h += `<div style="font-size:11px;color:var(--text-muted);text-align:center;margin-top:4px">Zakład nr →</div></div>`;
    
    h += `<div class="card" style="margin-top:12px">
      <div class="card-header"><h3>📊 Podsumowanie strategii "${strategy}"</h3></div>
      <div class="card-body" style="font-size:13px;color:var(--text-secondary)">
        <p>Strategia ${strategy} z kapitałem ${fmtCurr(res.initial_bankroll)} po ${res.total_bets} zakładach:
        <strong>${res.won}W / ${res.lost}P</strong> (${res.win_rate}% skuteczności).</p>
        <p>Zysk: <strong style="color:${res.profit>=0?'var(--profit)':'var(--loss)'}">${fmtCurr(res.profit)} (${res.roi}% ROI)</strong></p>
        <p>Maksymalny spadek: ${res.max_drawdown}% • Najdłuższa seria: ${res.best_streak}W / ${Math.abs(res.worst_streak)}P</p>
      </div>
    </div>`;
    
    el.innerHTML = h;
  } catch(e) { el.innerHTML = `<div class="alert error">Błąd: ${e.message}</div>`; }
}

// ═══ MARGIN ANALYSIS ═════════════════════════════════════════════════

function renderMargins(area) {
  let h = `<div class="page-header"><div><h2>📉 Analiza marż</h2><div class="subtitle">Ranking bukmacherów według marży i rzetelności</div></div></div>`;
  
  if (bookmakerRanking.length === 0) {
    h += `<div class="empty-state"><div class="empty-icon">📉</div><div class="empty-title">Brak danych</div></div>`;
    area.innerHTML = h; return;
  }
  
  h += `<div class="card" style="margin-bottom:16px">
    <div class="card-header"><h3>🏆 Ranking bukmacherów</h3></div>
    <div class="card-body">
      <div class="table-wrapper"><table><thead><tr>
        <th>#</th><th>Bukmacher</th><th>Marża</th><th>Rzetelność</th><th>Ocena</th><th>Wynik</th>
      </tr></thead><tbody>`;
    
  bookmakerRanking.forEach((b, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
    h += `<tr>
      <td>${medal}</td>
      <td><strong>${b.name}</strong></td>
      <td><span class="badge ${b.avg_margin<7?'badge-profit':b.avg_margin<10?'badge-warning':'badge-loss'}">${b.avg_margin}%</span></td>
      <td>${b.reliability}%</td>
      <td>⭐ ${b.rating}</td>
      <td><strong>${b.score}</strong></td>
    </tr>`;
  });
  
  h += `</tbody></table></div></div></div>`;
  
  // Chart
  h += `<div class="chart-container"><div class="card-header"><h3>📊 Porównanie marż</h3></div>`;
  const maxM = Math.max(...bookmakerRanking.map(b => b.avg_margin), 1);
  bookmakerRanking.forEach(b => {
    const pct = (b.avg_margin / maxM) * 100;
    h += `<div class="chart-bar"><div class="bar-label" style="width:100px;text-align:right">${b.name}</div>
      <div class="bar-track"><div class="bar-fill ${b.avg_margin<=7?'profit':b.avg_margin<=10?'':'loss'}" style="width:${pct}%"></div></div>
      <div class="bar-value">${b.avg_margin}%</div></div>`;
  });
  h += `</div>`;
  
  area.innerHTML = h;
}

// ═══ ODDS LIVE ═══════════════════════════════════════════════════════

function renderOddsLive(area) {
  let h = `<div class="page-header"><div><h2>📊 Rynek na żywo</h2><div class="subtitle">Statystyki silnika surebetów</div></div></div>`;
  
  h += `<div class="stats-grid">
    <div class="stat-card"><div class="stat-icon">📊</div>
      <div class="stat-value">${engineStats.active_surebets||0}</div><div class="stat-label">Surebety</div></div>
    <div class="stat-card"><div class="stat-icon">💎</div>
      <div class="stat-value">${engineStats.value_bets||0}</div><div class="stat-label">Value Bety</div></div>
    <div class="stat-card"><div class="stat-icon">📊</div>
      <div class="stat-value">${engineStats.multi_market||0}</div><div class="stat-label">Multi-Rynek</div></div>
    <div class="stat-card"><div class="stat-icon">📈</div>
      <div class="stat-value">${engineStats.average_profit||0}%</div><div class="stat-label">Śr. zysk</div></div>
  </div>
  
  <div class="card" style="margin-bottom:12px">
    <div class="card-header"><h3>📋 Historia wykryć</h3></div>
    <div class="card-body" id="oddsHistoryList">
      <div class="loading"><div class="spinner"></div></div>
    </div>
  </div>`;
  
  area.innerHTML = h;
  
  if (oddsHistory.length > 0) {
    const el = document.getElementById('oddsHistoryList');
    el.innerHTML = oddsHistory.slice(-15).reverse().map(h => `
      <div class="list-item">
        <div class="li-icon">📡</div>
        <div class="li-content">
          <div class="li-title">${h.surebets_count} SB • ${h.value_bets_count} VB • ${h.multi_market_count} MM</div>
          <div class="li-subtitle">Śr. zysk: ${h.avg_profit}% • ${fmtDate(h.timestamp)}</div></div>
        <div class="li-extra">
          <div style="font-weight:700;color:var(--profit)">${h.best_profit}%</div>
          <div style="font-size:11px;color:var(--text-muted)">najlepszy</div></div>
      </div>`).join('');
  } else {
    const el = document.getElementById('oddsHistoryList');
    if (el) el.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted)">Zbieranie danych...</div>';
  }
  
  // Auto-refresh
  setTimeout(() => {
    if (currentPage === 'oddslive') renderOddsLive(document.getElementById('contentArea'));
  }, 5000);
}

// ═══ MATCH DETAILS ═══════════════════════════════════════════════════

function renderMatchDetails(area, params) {
  const mid = params;
  const match = engine.generated_matches?.find(m => m.id === mid) || 
                surebets.find(s => s.match_id === mid);
  
  if (!match) {
    area.innerHTML = `<div class="alert error">Nie znaleziono meczu</div>
      <button class="btn btn-primary" onclick="navigate('dashboard')">← Powrót</button>`;
    return;
  }
  
  area.innerHTML = `
    <button class="btn btn-sm btn-secondary" onclick="navigate('surebets')" style="margin-bottom:12px">← Powrót</button>
    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><h3>${match.team1 || '?'} vs ${match.team2 || '?'}</h3></div>
      <div class="card-body">
        <div style="font-size:13px;color:var(--text-secondary)">
          ${sportIcon(match.sport)} ${match.sport || '?'} • ${match.league || '?'} • ${match.date ? fmtDate(match.date) : '?'}
        </div>
      </div>
    </div>
    <div id="matchStatsDetail"><div class="loading"><div class="spinner"></div></div></div>`;
  
  API.get(`/api/matches/${mid}/stats`).then(d => {
    const el = document.getElementById('matchStatsDetail');
    if (!d.success || !el) return;
    const ms = d.stats;
    el.innerHTML = `
      <div class="card"><div class="card-header"><h3>📊 Statystyki</h3></div>
      <div class="card-body">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px;text-align:center">
          <div><div style="font-size:11px;color:var(--text-muted)">${ms.team1.name}</div>
            <div style="font-size:24px;font-weight:700">${ms.team1.avg_goals_for}</div>
            <div style="font-size:10px;color:var(--text-muted)">Śr. bramki strzelone</div></div>
          <div><div style="font-size:11px;color:var(--text-muted)">vs</div>
            <div style="font-size:14px">pos. ${ms.team1.possession}% / ${ms.team2.possession}%</div></div>
          <div><div style="font-size:11px;color:var(--text-muted)">${ms.team2.name}</div>
            <div style="font-size:24px;font-weight:700">${ms.team2.avg_goals_for}</div>
            <div style="font-size:10px;color:var(--text-muted)">Śr. bramki strzelone</div></div>
        </div>
        <div style="font-size:13px;color:var(--text-secondary)">Forma: ${ms.team1.form.map(f=>f==='W'?'✅':'❌').join(' ')} - ${ms.team2.form.map(f=>f==='W'?'✅':'❌').join(' ')}</div>
        <div style="font-size:13px;color:var(--text-secondary)">Pozycje w lidze: ${ms.league_position_team1}. - ${ms.league_position_team2}.</div>
        ${ms.h2h?.length ? `<div style="margin-top:8px"><span style="font-size:12px;color:var(--text-muted)">H2H: </span>${ms.h2h.map(h => `<span class="pill pill-info">${h.team1_goals}:${h.team2_goals}</span>`).join(' ')}</div>` : ''}
      </div></div>`;
  }).catch(() => {});
}

// ═══ QUICK PLACE BET ═════════════════════════════════════════════════

async function quickPlaceBet(sid) {
  const sb = [...surebets, ...multiMarket].find(s => s.id === sid);
  if (!sb) { toast('Nie znaleziono', 'error'); return; }
  
  const isMultiMarket = sb.type?.startsWith('multi_');
  
  let oddsHtml = '';
  for (const [out, odd] of Object.entries(sb.best_odds || {})) {
    if (['1','X','2','O','U','Tak','Nie'].includes(out)) {
      oddsHtml += `<span class="odds-item">${out}: ${odd}</span> `;
    }
  }
  
  openModal(`
    <div class="modal-header"><h3>⚡ Obstaw surebet</h3>
      <button class="modal-close" onclick="closeModal()">✕</button></div>
    <div style="margin-bottom:12px">
      <div style="font-weight:600;font-size:15px">${sb.team1} vs ${sb.team2}</div>
      <div style="font-size:11px;color:var(--text-secondary)">${sb.bookmaker1_name} & ${sb.bookmaker2_name} ${isMultiMarket ? '• '+sb.label : ''}</div>
      <div style="margin-top:4px;font-size:11px">${oddsHtml}</div>
    </div>
    <div class="form-group"><label>Kwota (PLN)</label>
      <input class="form-input" type="number" id="qpAmount" value="${sb.total_stake||100}" min="10" step="10"></div>
    <div style="margin-bottom:12px;padding:10px;background:var(--bg-secondary);border-radius:6px">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span style="font-size:12px;color:var(--text-secondary)">Zysk:</span>
        <span style="font-weight:700;color:var(--profit)">${fmtCurr(sb.profit)} (${sb.profit_pct}%)</span></div>
      <div style="display:flex;justify-content:space-between">
        <span style="font-size:12px;color:var(--text-secondary)">Stan konta:</span>
        <span style="font-weight:600">${fmtCurr(bankroll.current_balance||0)}</span></div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-secondary" style="flex:1" onclick="closeModal()">Anuluj</button>
      <button class="btn btn-primary" style="flex:1" onclick="confirmBet('${sid}')">✅ Obstaw</button>
    </div>
  `);
}

async function confirmBet(sid) {
  const amt = parseFloat(document.getElementById('qpAmount')?.value);
  if (!amt || amt <= 0) { toast('Podaj kwotę', 'error'); return; }
  closeModal(); toast('Obstawianie...', 'info', 3000);
  try {
    const r = await API.post('/api/bets/place', {surebet_id: sid, amount: amt});
    if (r.success) {
      toast(`✅ Obstawiono! ${r.bet.status==='won'?'Wygrana':'Strata'}: ${fmtCurr(r.bet.actual_profit)}`, r.bet.status==='won'?'success':'warning', 5000);
      await Promise.all([fetchAllData(), fetchBets()]);
      if (currentPage === 'surebetdetail') navigate('surebetdetail', sid);
    } else toast(`❌ ${r.error}`, 'error', 5000);
  } catch(e) { toast('Błąd serwera', 'error'); }
}

// ═══ INIT ═══════════════════════════════════════════════════════════


// ═══ ACCOUNT MANAGEMENT (DEMO / REAL) ═══════════════════════════════════

function renderAccount(area) {
  let h = `
  <div class="page-header"><div><h2>👤 Konto</h2><div class="subtitle">Zarządzaj trybem konta i środkami</div></div></div>
  
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-icon">🎮</div>
      <div class="stat-value">${fmtCurr(demoBalance)}</div>
      <div class="stat-label">💰 Demo (wirtualne)</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">💵</div>
      <div class="stat-value">${fmtCurr(realBalance)}</div>
      <div class="stat-label">🏦 Real (prawdziwe)</div>
    </div>
  </div>
  
  <div class="card card-glass" style="margin-bottom:16px">
    <div style="display:flex;align-items:center;gap:14px">
      <div style="font-size:40px">${accountMode === 'demo' ? '🎮' : '💵'}</div>
      <div style="flex:1">
        <div style="font-weight:600;font-size:16px">
          Tryb: <span style="color:${accountMode === 'demo' ? 'var(--warning)' : 'var(--profit)'}">
            ${accountMode === 'demo' ? '🟡 DEMO (wirtualne środki)' : '🟢 REAL (prawdziwe pieniądze)'}
          </span>
        </div>
        <div style="font-size:12px;color:var(--text-secondary)">
          ${accountMode === 'demo' 
            ? 'Testuj strategie na wirtualnych środkach. 100 000 PLN do dyspozycji.'
            : 'Obstawiaj prawdziwymi pieniędzmi. Wpłać środki przez panel wpłat.'}
        </div>
      </div>
      <button class="btn ${accountMode === 'demo' ? 'btn-success' : 'btn-warning'}" onclick="switchAccount()">
        ${accountMode === 'demo' ? '➡️ Przełącz na REAL' : '⬅️ Przełącz na DEMO'}
      </button>
    </div>
  </div>`;

  if (accountMode === 'real' && realBalance <= 0) {
    h += `<div class="alert warning" style="margin-bottom:16px">
      💡 Twoje saldo REAL wynosi 0 PLN. <a href="#" onclick="navigate('deposit')" style="color:var(--primary)">Wpłać środki</a> aby rozpocząć obstawianie na prawdziwe pieniądze.
    </div>`;
  }
  
  if (accountMode === 'demo') {
    h += `<div class="alert info" style="margin-bottom:16px">
      💡 Jesteś w trybie DEMO. Możesz bezpiecznie testować strategie.
      Gdy będziesz gotowy, <a href="#" onclick="switchAccount()" style="color:var(--primary)">przełącz na REAL</a> i wpłać środki.
    </div>`;
  }

  h += `
  <div class="card" style="margin-bottom:16px">
    <div class="card-header"><h3>📊 Porównanie kont</h3></div>
    <div class="card-body">
      <div class="table-wrapper"><table>
        <thead><tr><th>Parametr</th><th>🎮 DEMO</th><th>💵 REAL</th></tr></thead>
        <tbody>
          <tr><td>Dostępne środki</td><td style="color:var(--profit);font-weight:600">${fmtCurr(demoBalance)}</td><td style="color:var(--profit);font-weight:600">${fmtCurr(realBalance)}</td></tr>
          <tr><td>Ryzyko</td><td><span class="badge badge-profit">BRAK</span></td><td><span class="badge badge-warning">REALNE</span></td></tr>
          <tr><td>Inwestycje</td><td>❌ Niedostępne</td><td>✅ Dostępne</td></tr>
          <tr><td>Wpłaty</td><td>❌ Nie wymagane</td><td>✅ Wymagane</td></tr>
          <tr><td>Limit</td><td>100 000 PLN</td><td>Bez limitu</td></tr>
        </tbody></table></div>
    </div>
  </div>

  <div class="card" style="margin-bottom:16px">
    <div class="card-header"><h3>📋 Historia transakcji</h3></div>
    <div class="card-body" id="accountTxnList">
      <div class="loading"><div class="spinner"></div></div>
    </div>
  </div>`;

  area.innerHTML = h;
  loadAccountTransactions();
}

async function loadAccountTransactions() {
  try {
    const d = await API.get('/api/transactions?limit=15');
    const el = document.getElementById('accountTxnList');
    if (!el) return;
    if (!d.success || !d.transactions?.length) {
      el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)">Brak transakcji</div>'; return;
    }
    el.innerHTML = d.transactions.map(t => `
      <div class="list-item">
        <div class="li-icon">${t.type === 'deposit' ? '💰' : t.type === 'withdrawal' ? '💸' : t.type === 'investment' ? '📈' : t.type === 'transfer' ? '🔄' : '💼'}</div>
        <div class="li-content"><div class="li-title">${t.description || t.type}</div>
          <div class="li-subtitle">${fmtDate(t.timestamp)}</div></div>
        <div class="li-extra"><div class="li-value">${t.amount ? fmtCurr(t.amount) : ''}</div></div>
      </div>`).join('');
  } catch(e) {}
}

async function switchAccount() {
  const newMode = accountMode === 'demo' ? 'real' : 'demo';
  try {
    const r = await API.post('/api/account/switch', { mode: newMode });
    if (r.success) {
      accountMode = r.mode;
      toast(`Przełączono na tryb: ${r.mode === 'demo' ? 'DEMO 🎮' : 'REAL 💵'}`, 'success', 3000);
      await fetchAllData();
      renderAccount(document.getElementById('contentArea'));
    }
  } catch(e) { toast('Błąd przełączania', 'error'); }
}

// ═══ DEPOSITS ════════════════════════════════════════════════════════

function renderDeposit(area) {
  let h = `
  <div class="page-header"><div><h2>💳 Wpłata środków</h2>
    <div class="subtitle">Zasil konto REAL, aby rozpocząć obstawianie</div></div></div>
  
  <div class="card" style="margin-bottom:16px">
    <div class="card-header"><h3>💰 Stan konta REAL</h3></div>
    <div class="card-body">
      <div style="text-align:center;padding:12px">
        <div style="font-size:36px;font-weight:700">${fmtCurr(realBalance)}</div>
        <div style="font-size:12px;color:var(--text-secondary)">Dostępne środki</div>
      </div>
    </div>
  </div>

  <div id="depositMethods" style="margin-bottom:16px">
    <div class="subheader">Wybierz metodę płatności</div>
    <div class="loading"><div class="spinner"></div></div>
  </div>

  <div id="depositForm" style="display:none"></div>
  
  <div class="card" style="margin-top:16px">
    <div class="card-header"><h3>📋 Historia wpłat</h3></div>
    <div class="card-body" id="depositHistory"><div class="loading"><div class="spinner"></div></div></div>
  </div>`;

  area.innerHTML = h;
  loadDepositMethods();
  loadDepositHistory();
}

async function loadDepositMethods() {
  try {
  const cached = window._depositMethods;
  if (cached && cached.length > 0) {
    renderDepositMethodsCached(cached);
    return;
  }

    const d = await API.get('/api/deposit/methods');
    if (!d.success) return;
    
    const el = document.getElementById('depositMethods');
    const popular = d.methods.filter(m => m.popular);
    const others = d.methods.filter(m => !m.popular);
    
    let html = `<div class="subheader">⭐ Popularne</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:16px">`;
    
    popular.forEach(m => {
      html += `<div class="card" style="cursor:pointer;text-align:center;padding:14px" onclick="selectDepositMethod('${m.id}')">
        <div style="font-size:28px;margin-bottom:6px">${m.icon}</div>
        <div style="font-weight:600;font-size:13px">${m.name}</div>
        <div style="font-size:10px;color:var(--text-secondary)">od ${m.min} do ${m.max} PLN</div>
        <div style="font-size:10px;color:var(--profit)">${m.fee === 0 ? 'Bez prowizji' : `${m.fee*100}% prowizji`}</div>
        <div style="font-size:10px;color:var(--text-muted)">⏱ ${m.time}</div>
      </div>`;
    });
    
    html += `</div><div class="subheader">🔹 Pozostałe</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">`;
    
    others.forEach(m => {
      html += `<div class="card" style="cursor:pointer;text-align:center;padding:14px" onclick="selectDepositMethod('${m.id}')">
        <div style="font-size:28px;margin-bottom:6px">${m.icon}</div>
        <div style="font-weight:600;font-size:13px">${m.name}</div>
        <div style="font-size:10px;color:var(--text-secondary)">min ${m.min} PLN</div>
        <div style="font-size:10px;color:var(--text-muted)">⏱ ${m.time}</div>
      </div>`;
    });
    
    html += `</div>`;
    el.innerHTML = html;
    
  } catch(e) { 
    document.getElementById('depositMethods').innerHTML = '<div class="alert error">Błąd ładowania metod</div>';
  }
}


function renderDepositMethodsCached(methods) {
  const el = document.getElementById('depositMethods');
  if (!el) return;
  const popular = methods.filter(m => m.popular);
  const others = methods.filter(m => !m.popular);
  let html = '<div class="subheader">\u2B50 Popularne</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:16px">';
  popular.forEach(m => {
    html += '<div class="card" style="cursor:pointer;text-align:center;padding:14px" onclick=\"selectDepositMethod(\'' + m.id + '\')\"><div style="font-size:28px;margin-bottom:6px">' + m.icon + '</div><div style="font-weight:600;font-size:13px">' + m.name + '</div><div style="font-size:10px;color:var(--text-secondary)">od ' + m.min + ' do ' + m.max + ' PLN</div><div style="font-size:10px;color:var(--profit)">' + (m.fee === 0 ? 'Bez prowizji' : m.fee*100 + '% prowizji') + '</div><div style="font-size:10px;color:var(--text-muted)">\u23F1 ' + m.time + '</div></div>';
  });
  html += '</div><div class="subheader">\uD83D\uDD39 Pozosta\u0142e</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">';
  others.forEach(m => {
    html += '<div class="card" style="cursor:pointer;text-align:center;padding:14px" onclick=\"selectDepositMethod(\'' + m.id + '\')\"><div style="font-size:28px;margin-bottom:6px">' + m.icon + '</div><div style="font-weight:600;font-size:13px">' + m.name + '</div><div style="font-size:10px;color:var(--text-secondary)">min ' + m.min + ' PLN</div><div style="font-size:10px;color:var(--text-muted)">\u23F1 ' + m.time + '</div></div>';
  });
  html += '</div>';
  el.innerHTML = html;
}
async function loadDepositHistory() {
  try {
    const d = await API.get('/api/deposit/history');
    const el = document.getElementById('depositHistory');
    if (!el) return;
    if (!d.success || !d.deposits?.length) {
      el.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted)">Brak wpłat</div>'; return;
    }
    el.innerHTML = d.deposits.slice(0, 10).map(dp => `
      <div class="list-item">
        <div class="li-icon">${dp.method_icon || '💳'}</div>
        <div class="li-content"><div class="li-title">${dp.description || 'Wpłata'}</div>
          <div class="li-subtitle">${dp.method_name} • ${fmtDate(dp.timestamp)}</div></div>
        <div class="li-extra">
          <div style="font-weight:700;color:${dp.status === 'completed' ? 'var(--profit)' : 'var(--loss)'}">${fmtCurr(dp.net_amount)}</div>
          <div style="font-size:11px;color:var(--text-muted)">${dp.status === 'completed' ? '✅ Zrealizowana' : '❌ Odrzucona'}</div></div>
      </div>`).join('');
  } catch(e) {}
}

function selectDepositMethod(methodId) {
  const el = document.getElementById('depositForm');
  el.style.display = 'block';
  
  // Stripe-specific UI
  if (methodId === 'stripe') {
    el.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><h3>💳 Stripe (Visa/Mastercard)</h3></div>
        <div class="card-body">
          <div class="form-group"><label>Kwota wpłaty (PLN)</label>
            <input class="form-input" type="number" id="depositAmount" value="100" min="10" step="10"></div>
          <div class="form-group"><label>Dane karty</label>
            <div id="stripeCardElement" style="padding:12px;border:1px solid var(--border);border-radius:10px;background:var(--bg-secondary);min-height:40px"></div>
            <div style="margin-top:6px;font-size:11px;color:var(--text-muted)">🔒 Bezpieczna płatność SSL przez Stripe</div>
          </div>
          <div id="stripeCardErrors" style="font-size:12px;color:var(--loss);margin-bottom:8px"></div>
          <button class="btn btn-primary btn-lg btn-block" id="stripePayBtn" onclick="processStripePayment()">
            💳 Zapłać przez Stripe
          </button>
          <div style="margin-top:8px;font-size:11px;color:var(--text-muted);text-align:center">
            Akceptujemy Visa, Mastercard, American Express. Płatność natychmiastowa.
          </div>
        </div>
      </div>`;
    el.scrollIntoView({ behavior: 'smooth' });
    
    // Initialize Stripe Elements
    setTimeout(initStripeElements, 300);
    return;
  }
  
  el.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><h3>💳 Wpłata przez ${methodId.toUpperCase()}</h3></div>
      <div class="card-body">
        <div class="form-group"><label>Kwota wpłaty (PLN)</label>
          <input class="form-input" type="number" id="depositAmount" value="100" min="10" step="10"></div>
        <button class="btn btn-primary btn-lg btn-block" onclick="processDeposit('${methodId}')">
          💳 Wpłać środki
        </button>
        <div style="margin-top:8px;font-size:11px;color:var(--text-muted);text-align:center">
          Wpłata jest bezpieczna i szyfrowana. Środki pojawią się na koncie ${methodId.includes('crypto') ? 'po wymaganej liczbie konfirmacji sieci.' : 'natychmiast po zatwierdzeniu.'}
        </div>
      </div>
    </div>`;
  el.scrollIntoView({ behavior: 'smooth' });
}

// ═══ STRIPE FRONTEND ═════════════════════════════════════════════════

let stripeElements = null;
let stripeCard = null;

async function initStripeElements() {
  try {
    const cfg = await API.get('/api/stripe/config');
    if (!cfg.enabled || !cfg.publishable_key) {
      document.getElementById('stripeCardErrors').textContent = '⚠️ Stripe nie jest skonfigurowane. Dodaj klucze API w ustawieniach admina.';
      document.getElementById('stripePayBtn').disabled = true;
      return;
    }
    const stripe = Stripe(cfg.publishable_key);
    const elements = stripe.elements();
    const style = {
      base: {
        color: '#e2e8f0',
        fontFamily: '"Inter", system-ui, sans-serif',
        fontSize: '15px',
        '::placeholder': { color: '#8899bb' },
        backgroundColor: 'transparent',
      },
    };
    const card = elements.create('card', { style });
    card.mount('#stripeCardElement');
    card.on('change', (e) => {
      const err = document.getElementById('stripeCardErrors');
      err.textContent = e.error ? e.error.message : '';
    });
    stripeElements = { stripe, elements, card };
  } catch(e) {
    document.getElementById('stripeCardErrors').textContent = '⚠️ Błąd inicjalizacji Stripe';
  }
}

async function processStripePayment() {
  const amount = parseFloat(document.getElementById('depositAmount')?.value);
  if (!amount || amount <= 0) { toast('Podaj kwotę', 'error'); return; }
  if (!stripeElements) { toast('Stripe nie jest gotowe', 'error'); return; }
  
  const btn = document.getElementById('stripePayBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Przetwarzanie...';
  
  try {
    // Create PaymentIntent on server
    const result = await API.post('/api/stripe/create-payment', { amount });
    if (!result.success) {
      toast('❌ ' + result.error, 'error');
      btn.disabled = false;
      btn.textContent = '💳 Zapłać przez Stripe';
      return;
    }
    
    const { stripe, card } = stripeElements;
    const { error, paymentIntent } = await stripe.confirmCardPayment(result.client_secret, {
      payment_method: { card: card },
    });
    
    if (error) {
      toast('❌ ' + error.message, 'error');
      btn.disabled = false;
      btn.textContent = '💳 Zapłać przez Stripe';
      return;
    }
    
    if (paymentIntent.status === 'succeeded') {
      toast('✅ Wpłata udana!', 'success');
      // Also simulate on backend in case webhook isn't configured
      await API.post('/api/bankroll/deposit', { amount });
      await Promise.all([fetchAllData(), fetchDeposits()]);
      renderDeposit(document.getElementById('contentArea'));
    }
  } catch(e) {
    toast('❌ Błąd płatności', 'error');
    btn.disabled = false;
    btn.textContent = '💳 Zapłać przez Stripe';
  }
}

async function processDeposit(methodId) {
  const amount = parseFloat(document.getElementById('depositAmount')?.value);
  if (!amount || amount <= 0) { toast('Podaj kwotę', 'error'); return; }
  
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = '⏳ Przetwarzanie...';
  toast('Przetwarzanie wpłaty...', 'info', 5000);
  
  try {
    const r = await API.post('/api/deposit/create', { method_id: methodId, amount });
    btn.disabled = false;
    btn.textContent = '💳 Wpłać środki';
    
    if (r.success) {
      if (r.deposit?.payment_data?.blik_code) {
        openModal(`
          <div class="modal-header"><h3>💳 Kod BLIK</h3>
            <button class="modal-close" onclick="closeModal()">✕</button></div>
          <div style="text-align:center;padding:20px">
            <div style="font-size:48px;margin-bottom:12px">${r.deposit.method_icon || '💳'}</div>
            <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:var(--primary)">
              ${r.deposit.payment_data.blik_code}
            </div>
            <div style="margin-top:12px;font-size:12px;color:var(--text-secondary)">
              Wprowadź kod w aplikacji bankowej. Ważny: ${r.deposit.payment_data.expires_in}
            </div>
          </div>
        `);
      } else if (r.deposit?.payment_data?.account_number) {
        openModal(`
          <div class="modal-header"><h3>🏦 Przelew bankowy</h3>
            <button class="modal-close" onclick="closeModal()">✕</button></div>
          <div style="padding:16px">
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Numer konta:</div>
            <div style="font-size:14px;font-weight:600;background:var(--bg-secondary);padding:10px;border-radius:8px;word-break:break-all">
              ${r.deposit.payment_data.account_number}
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:12px">Tytuł przelewu:</div>
            <div style="font-weight:600;font-size:13px">${r.deposit.payment_data.title}</div>
            <div style="margin-top:16px;font-size:12px;color:var(--text-secondary)">Kwota: ${fmtCurr(r.deposit.amount)}</div>
          </div>
        `);
      } else if (r.deposit?.payment_data?.address) {
        openModal(`
          <div class="modal-header"><h3>₿ Adres portfela</h3>
            <button class="modal-close" onclick="closeModal()">✕</button></div>
          <div style="padding:16px;text-align:center">
            <div style="font-size:40px;margin-bottom:8px">${methodId.includes('btc') ? '₿' : '⟠'}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Wyślij dokładnie ${fmtCurr(r.deposit.amount)} na adres:</div>
            <div style="font-size:11px;background:var(--bg-secondary);padding:10px;border-radius:8px;word-break:break-all;font-family:monospace">
              ${r.deposit.payment_data.address}
            </div>
            <div style="margin-top:12px;font-size:11px;color:var(--text-muted)">Sieć: ${r.deposit.payment_data.network}</div>
          </div>
        `);
      } else {
        toast(`✅ ${r.message || 'Wpłata udana!'}`, 'success', 4000);
      }
      
      realBalance = r.new_balance;
      await Promise.all([loadDepositHistory(), fetchAllData()]);
      document.getElementById('depositForm').style.display = 'none';
      
    } else {
      toast(`❌ ${r.message || 'Wpłata odrzucona'}`, 'error');
    }
  } catch(e) {
    btn.disabled = false;
    btn.textContent = '💳 Wpłać środki';
    toast('Błąd serwera', 'error');
  }
}

// ═══ INVESTMENTS ═════════════════════════════════════════════════════

function renderInvestments(area) {
  let h = `
  <div class="page-header"><div><h2>📈 Inwestycje</h2>
    <div class="subtitle">Pomnażaj swoje środki dzięki planom inwestycyjnym</div></div></div>
  
  <div class="stats-grid" style="margin-bottom:16px">
    <div class="stat-card"><div class="stat-icon">📊</div>
      <div class="stat-value">${portfolio.active_count || 0}</div><div class="stat-label">Aktywne inwestycje</div></div>
    <div class="stat-card"><div class="stat-icon">💰</div>
      <div class="stat-value amount positive">${fmtCurr(portfolio.total_invested || 0)}</div><div class="stat-label">Zainwestowano</div></div>
    <div class="stat-card"><div class="stat-icon">📈</div>
      <div class="stat-value amount positive">${fmtCurr(portfolio.total_profit || 0)}</div><div class="stat-label">Zysk z inwestycji</div></div>
    <div class="stat-card"><div class="stat-icon">💵</div>
      <div class="stat-value">${fmtCurr(realBalance)}</div><div class="stat-label">Dostępne środki</div></div>
  </div>`;

  if (accountMode !== 'real') {
    h += `<div class="alert warning">
      ⚠️ Inwestycje dostępne tylko w trybie REAL. 
      <a href="#" onclick="navigate('account')" style="color:var(--primary)">Przełącz konto na REAL</a> aby inwestować.
    </div>`;
  }

  // Investment plans
  h += `<div class="subheader">📋 Plany inwestycyjne</div>
  <div id="investmentPlans" style="margin-bottom:20px"><div class="loading"><div class="spinner"></div></div></div>`;

  // Active investments
  h += `<div class="subheader">📊 Portfolio</div>
  <div id="investmentPortfolio"><div class="loading"><div class="spinner"></div></div></div>`;

  area.innerHTML = h;
  loadInvestmentPlans();
  loadPortfolio();
}

async function loadInvestmentPlans() {
  try {
  const cached = window._investmentPlans;
  if (cached && cached.length > 0) {
    investmentPlans = cached;
    renderInvestmentPlans(cached);
    return;
  }

    const d = await API.get('/api/investment/plans');
    if (!d.success) return;
    const plans = d.plans || [];
    const el = document.getElementById('investmentPlans');
    
    if (plans.length === 0) {
      el.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted)">Brak planów</div>'; return;
    }
    
    const riskColors = {
      'bardzo niski': 'var(--profit)', 'niski': 'var(--info)',
      'średni': 'var(--warning)', 'wysoki': 'var(--loss)'
    };
    
    let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">';
    
    plans.forEach(p => {
      const dailyReturn = p.daily_roi;
      const monthlyReturn = (dailyReturn * 30).toFixed(1);
      const totalReturn = ((1 + dailyReturn/100) ** p.duration_days - 1) * 100;
      
      html += `
      <div class="card" style="display:flex;flex-direction:column">
        <div style="text-align:center;padding:12px 0;border-bottom:1px solid var(--border)">
          <div style="font-size:32px;margin-bottom:4px">${p.risk === 'bardzo niski' ? '🏦' : p.risk === 'niski' ? '🟢' : p.risk === 'średni' ? '🟡' : '🔴'}</div>
          <div style="font-weight:700;font-size:16px">${p.name}</div>
          <div style="font-size:11px;color:var(--text-secondary)">${p.description}</div>
        </div>
        <div style="padding:12px;flex:1">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;margin-bottom:10px">
            <div><div style="color:var(--text-muted)">Dzienny ROI</div><div style="font-weight:600;color:var(--profit)">+${dailyReturn}%</div></div>
            <div><div style="color:var(--text-muted)">Miesięczny ROI</div><div style="font-weight:600;color:var(--profit)">~${monthlyReturn}%</div></div>
            <div><div style="color:var(--text-muted)">Całkowity zwrot</div><div style="font-weight:700;color:var(--profit)">+${totalReturn.toFixed(0)}%</div></div>
            <div><div style="color:var(--text-muted)">Ryzyko</div><div style="font-weight:600;color:${riskColors[p.risk] || 'var(--text-secondary)'}">${p.risk.toUpperCase()}</div></div>
            <div><div style="color:var(--text-muted)">Min. kwota</div><div>${fmtCurr(p.min_amount)}</div></div>
            <div><div style="color:var(--text-muted)">Max. kwota</div><div>${fmtCurr(p.max_amount)}</div></div>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Okres: ${p.duration_days} dni</div>
          
          ${accountMode === 'real' ? `
          <div style="display:flex;gap:6px;margin-top:auto">
            <input class="form-input" type="number" id="invAmt_${p.id}" placeholder="Kwota" value="${p.min_amount}" min="${p.min_amount}" style="flex:1;padding:8px;font-size:12px">
            <button class="btn btn-sm btn-primary" onclick="createInvestment('${p.id}')">📈 Inwestuj</button>
          </div>` : `
          <button class="btn btn-sm btn-warning btn-block" onclick="navigate('account')">Przełącz na REAL</button>`}
        </div>
      </div>`;
    });
    
    html += '</div>';
    el.innerHTML = html;
    
  } catch(e) { 
    document.getElementById('investmentPlans').innerHTML = '<div class="alert error">Błąd ładowania</div>';
  }
}


function renderInvestmentPlans(plans) {
  const el = document.getElementById('investmentPlans');
  if (!el) return;
  if (plans.length === 0) {
    el.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted)">Brak plan\u00F3w</div>';
    return;
  }
  const riskColors = { 'bardzo niski': 'var(--profit)', 'niski': 'var(--info)', '\u015Bredni': 'var(--warning)', 'wysoki': 'var(--loss)' };
  let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">';
  plans.forEach(p => {
    const dailyReturn = p.daily_roi;
    const monthlyReturn = (dailyReturn * 30).toFixed(1);
    const totalReturn = ((1 + dailyReturn/100) ** p.duration_days - 1) * 100;
    html += '<div class="card" style="display:flex;flex-direction:column"><div style="text-align:center;padding:12px 0;border-bottom:1px solid var(--border)"><div style="font-size:32px;margin-bottom:4px">' + (p.risk === 'bardzo niski' ? '\uD83C\uDFE6' : p.risk === 'niski' ? '\uD83D\uDFE2' : p.risk === '\u015Bredni' ? '\uD83D\uDFE1' : '\uD83D\uDD34') + '</div><div style="font-weight:700;font-size:16px">' + p.name + '</div><div style="font-size:11px;color:var(--text-secondary)">' + p.description + '</div></div><div style="padding:12px;flex:1"><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;margin-bottom:10px"><div><div style="color:var(--text-muted)">Dzienny ROI</div><div style="font-weight:600;color:var(--profit)">+' + dailyReturn + '%</div></div><div><div style="color:var(--text-muted)">Miesi\u0119czny ROI</div><div style="font-weight:600;color:var(--profit)">~' + monthlyReturn + '%</div></div><div><div style="color:var(--text-muted)">Ca\u0142kowity zwrot</div><div style="font-weight:700;color:var(--profit)">+' + totalReturn.toFixed(0) + '%</div></div><div><div style="color:var(--text-muted)">Ryzyko</div><div style="font-weight:600;color:' + (riskColors[p.risk] || 'var(--text-secondary)') + '">' + p.risk.toUpperCase() + '</div></div></div><div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Okres: ' + p.duration_days + ' dni</div></div></div>';
  });
  html += '</div>';
  el.innerHTML = html;
}
async function loadPortfolio() {
  try {
    const d = await API.get('/api/investment/portfolio');
    if (!d.success) return;
    portfolio = d;
    const el = document.getElementById('investmentPortfolio');
    const active = d.active || [];
    const completed = d.completed || [];
    
    if (active.length === 0 && completed.length === 0) {
      el.innerHTML = '<div class="empty-state" style="padding:20px"><div class="empty-icon">📈</div><div class="empty-title">Brak inwestycji</div><div class="empty-desc">Wybierz plan powyżej i zacznij pomnażać środki</div></div>';
      return;
    }
    
    let html = '';
    
    if (active.length > 0) {
      html += `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">Aktywne (${active.length})</div>`;
      active.forEach(inv => {
        const progress = Math.min(100, Math.round((inv.daily_returns?.length || 0) / inv.duration_days * 100));
        const daysLeft = Math.max(0, inv.duration_days - (inv.daily_returns?.length || 0));
        html += `
        <div class="card" style="margin-bottom:8px;border-color:var(--profit)">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="font-size:28px">📈</div>
            <div style="flex:1">
              <div style="font-weight:600;font-size:14px">${inv.plan_name}</div>
              <div style="font-size:11px;color:var(--text-secondary)">Zainwestowano: ${fmtCurr(inv.amount)} • Zysk: <span class="amount positive">${fmtCurr(inv.total_profit)}</span></div>
              <div style="margin-top:4px;display:flex;gap:6px;align-items:center">
                <div class="bar-track" style="flex:1;height:6px"><div class="bar-fill profit" style="width:${progress}%;height:100%"></div></div>
                <span style="font-size:10px;color:var(--text-muted)">${daysLeft} dni</span>
              </div>
            </div>
            <div style="text-align:right">
              <div style="font-weight:700;font-size:16px;color:var(--profit)">${fmtCurr(inv.current_value)}</div>
              <button class="btn btn-sm btn-danger" onclick="withdrawInvestment('${inv.id}')">Wypłać</button>
            </div>
          </div>
        </div>`;
      });
    }
    
    if (completed.length > 0) {
      html += `<div style="font-size:12px;color:var(--text-secondary);margin:8px 0">Zakończone</div>`;
      completed.slice(0, 5).forEach(inv => {
        html += `
        <div class="card" style="margin-bottom:6px;opacity:0.8">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="font-size:20px">✅</div>
            <div style="flex:1"><div style="font-weight:600;font-size:13px">${inv.plan_name}</div>
              <div style="font-size:11px;color:var(--text-muted)">${fmtCurr(inv.amount)} → ${fmtCurr(inv.total_return || 0)}</div></div>
            <div style="font-weight:700;color:var(--profit)">+${fmtCurr((inv.total_return || 0) - inv.amount)}</div>
          </div>
        </div>`;
      });
    }
    
    el.innerHTML = html;
    
  } catch(e) {}
}

async function createInvestment(planId) {
  const amt = parseFloat(document.getElementById(`invAmt_${planId}`)?.value);
  if (!amt || amt <= 0) { toast('Podaj kwotę', 'error'); return; }
  
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = '⏳...';
  
  try {
    const r = await API.post('/api/investment/create', { plan_id: planId, amount: amt });
    btn.disabled = false;
    btn.textContent = '📈 Inwestuj';
    
    if (r.success) {
      toast(`✅ Zainwestowano ${fmtCurr(amt)} w ${r.investment.plan_name}!`, 'success', 5000);
      await Promise.all([fetchAllData(), fetchInvestments()]);
      renderInvestments(document.getElementById('contentArea'));
    } else {
      toast(`❌ ${r.error}`, 'error');
    }
  } catch(e) {
    btn.disabled = false;
    btn.textContent = '📈 Inwestuj';
    toast('Błąd inwestycji', 'error');
  }
}

async function withdrawInvestment(invId) {
  if (!confirm('Czy na pewno chcesz wcześniej wypłacić inwestycję? Kara: 50% zysku.')) return;
  toast('Wypłata inwestycji...', 'info', 3000);
  try {
    const r = await API.post('/api/investment/withdraw', { investment_id: invId });
    if (r.success) {
      toast(`✅ Wypłacono ${fmtCurr(r.return_amount)} (kara: ${fmtCurr(r.penalty)})`, 'success', 4000);
      await Promise.all([fetchAllData(), fetchInvestments()]);
      renderInvestments(document.getElementById('contentArea'));
    } else toast(`❌ ${r.error}`, 'error');
  } catch(e) { toast('Błąd', 'error'); }
}

// ═══ WITHDRAWALS ═══════════════════════════════════════════════════════

function renderWithdraw(area) {
  let h = `
  <div class="page-header"><div><h2>💸 Wypłata środków</h2>
    <div class="subtitle">Wypłać swoje wygrane na konto</div></div></div>
  
  <div class="card" style="margin-bottom:16px">
    <div class="card-header"><h3>💰 Dostępne środki</h3></div>
    <div class="card-body">
      <div style="display:flex;justify-content:space-around;text-align:center;padding:8px 0">
        <div>
          <div style="font-size:28px;font-weight:700">${fmtCurr(realBalance)}</div>
          <div style="font-size:11px;color:var(--text-secondary)">Konto REAL</div>
        </div>
        <div style="width:1px;background:var(--border)"></div>
        <div>
          <div style="font-size:28px;font-weight:700;color:var(--profit)">${fmtCurr(demoBalance)}</div>
          <div style="font-size:11px;color:var(--text-secondary)">Konto DEMO</div>
        </div>
      </div>
    </div>
  </div>

  <div class="subheader">Wybierz metodę wypłaty</div>
  <div id="withdrawMethods" style="margin-bottom:16px">
    <div class="loading"><div class="spinner"></div></div>
  </div>

  <div id="withdrawForm" style="display:none"></div>

  <div class="card" style="margin-top:16px">
    <div class="card-header"><h3>📋 Historia wypłat</h3></div>
    <div class="card-body" id="withdrawHistory"><div class="loading"><div class="spinner"></div></div></div>
  </div>`;

  area.innerHTML = h;
  loadWithdrawMethods();
  loadWithdrawHistory();
}

async function loadWithdrawMethods() {
  try {
    const d = await API.get('/api/withdraw/methods');
    if (!d.success) return;
    const el = document.getElementById('withdrawMethods');
    let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px">';
    d.methods.forEach(m => {
      html += `<div class="card" style="cursor:pointer;text-align:center;padding:14px" onclick="selectWithdrawMethod('${m.id}','${m.name}','${m.icon}')">
        <div style="font-size:28px;margin-bottom:6px">${m.icon}</div>
        <div style="font-weight:600;font-size:13px">${m.name}</div>
        <div style="font-size:10px;color:var(--text-secondary)">min ${m.min} • max ${m.max} PLN</div>
        <div style="font-size:10px;color:var(--text-muted)">⏱ ${m.time}</div>
        ${m.fee > 0 ? `<div style="font-size:10px;color:var(--loss)">prowizja ${m.fee*100}%</div>` : '<div style="font-size:10px;color:var(--profit)">bez prowizji</div>'}
      </div>`;
    });
    html += '</div>';
    el.innerHTML = html;
  } catch(e) { document.getElementById('withdrawMethods').innerHTML = '<div class="alert error">Błąd</div>'; }
}

function selectWithdrawMethod(methodId, methodName, methodIcon) {
  const el = document.getElementById('withdrawForm');
  el.style.display = 'block';
  
  if (realBalance <= 0) {
    el.innerHTML = `<div class="alert warning">Przełącz na konto REAL i wpłać środki przed wypłatą.</div>`;
    return;
  }
  
  el.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><h3>${methodIcon} Wypłata przez ${methodName}</h3></div>
      <div class="card-body">
        <div class="form-group"><label>Kwota wypłaty (PLN)</label>
          <input class="form-input" type="number" id="withdrawAmount" value="${Math.min(100, realBalance)}" min="10" step="10"></div>
        <div class="form-group"><label>Numer konta / adres portfela / BLIK</label>
          <input class="form-input" id="withdrawAccount" placeholder="${methodId === 'blik' ? 'Twój numer telefonu' : methodId.includes('crypto') ? 'Adres portfela krypto' : 'Numer konta bankowego'}"></div>
        <div style="margin-bottom:12px;padding:10px;background:var(--bg-secondary);border-radius:8px;font-size:12px">
          <div style="display:flex;justify-content:space-between">
            <span style="color:var(--text-secondary)">Kwota:</span><span>${fmtCurr(realBalance)} dostępne</span>
          </div>
        </div>
        <button class="btn btn-primary btn-lg btn-block" onclick="processWithdraw('${methodId}')">
          💸 Wypłać środki
        </button>
      </div>
    </div>`;
  el.scrollIntoView({behavior:'smooth'});
}

async function processWithdraw(methodId) {
  const amount = parseFloat(document.getElementById('withdrawAmount')?.value);
  const account = document.getElementById('withdrawAccount')?.value?.trim();
  if (!amount || amount <= 0) { toast('Podaj kwotę', 'error'); return; }
  if (!account) { toast('Podaj dane do wypłaty', 'error'); return; }
  
  const btn = event.target; btn.disabled = true; btn.textContent = '⏳...';
  try {
    const r = await API.post('/api/withdraw/create', { method_id: methodId, amount, account_details: account });
    btn.disabled = false; btn.textContent = '💸 Wypłać środki';
    if (r.success) {
      toast(`✅ ${r.message}`, 'success', 4000);
      realBalance = r.new_balance;
      await loadWithdrawHistory();
      document.getElementById('withdrawForm').style.display = 'none';
    } else toast(`❌ ${r.error}`, 'error');
  } catch(e) { btn.disabled = false; btn.textContent = '💸 Wypłać środki'; toast('Błąd', 'error'); }
}

async function loadWithdrawHistory() {
  try {
    const d = await API.get('/api/withdraw/history');
    const el = document.getElementById('withdrawHistory');
    if (!el) return;
    if (!d.success || !d.withdrawals?.length) {
      el.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted)">Brak wypłat</div>'; return;
    }
    const statusColors = { processing: 'var(--warning)', completed: 'var(--profit)', cancelled: 'var(--text-muted)' };
    el.innerHTML = d.withdrawals.map(w => `
      <div class="list-item">
        <div class="li-icon">${w.method_icon || '💸'}</div>
        <div class="li-content"><div class="li-title">${w.description || 'Wypłata'}</div>
          <div class="li-subtitle">${w.method_name} • ${fmtDate(w.created_at)}<br>nr: ${w.id}</div></div>
        <div class="li-extra">
          <div style="font-weight:700;color:var(--loss)">-${fmtCurr(w.net_amount)}</div>
          <div style="font-size:11px;color:${statusColors[w.status] || 'var(--text-muted)'}">
            ${w.status === 'processing' ? '⏳ W trakcie' : w.status === 'completed' ? '✅ Zrealizowana' : '❌ Anulowana'}
          </div>
          ${w.status === 'processing' ? `<button class="btn btn-sm btn-danger" onclick="cancelWithdraw('${w.id}')">Anuluj</button>` : ''}
        </div>
      </div>`).join('');
  } catch(e) {}
}

async function cancelWithdraw(wid) {
  if (!confirm('Anulować wypłatę?')) return;
  try {
    const r = await API.post('/api/withdraw/cancel', { withdrawal_id: wid });
    if (r.success) { toast('✅ Anulowano', 'success'); realBalance = r.new_balance; loadWithdrawHistory(); }
    else toast(`❌ ${r.error}`, 'error');
  } catch(e) { toast('Błąd', 'error'); }
}

// ═══ BET SLIP BUILDER ═══════════════════════════════════════════════════

function renderBetSlip(area) {
  const selections = [];
  
  let h = `
  <div class="page-header"><div><h2>📋 Kupon bukmacherski</h2>
    <div class="subtitle">Zbuduj kupon z surebetów i value betów</div></div></div>
  
  <div class="card" style="margin-bottom:16px">
    <div class="card-header"><h3>🎯 Dostępne selekcje</h3></div>
    <div class="card-body">
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">Kliknij surebet aby dodać do kuponu:</div>
      <div id="betslipSelections"></div>
    </div>
  </div>

  <div class="card" style="margin-bottom:16px">
    <div class="card-header"><h3>🧾 Twój kupon</h3></div>
    <div class="card-body" id="betslipBuilder">
      <div class="empty-state" style="padding:16px">
        <div class="empty-icon">📋</div>
        <div class="empty-title">Pusty kupon</div>
        <div class="empty-desc">Kliknij surebet powyżej aby dodać</div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-header"><h3>💰 Postaw kupon</h3></div>
    <div class="card-body">
      <div class="form-group"><label>Stawka (PLN)</label>
        <input class="form-input" type="number" id="betslipStake" value="10" min="1"></div>
      <button class="btn btn-primary btn-lg btn-block" onclick="placeBetSlip()" id="betslipPlaceBtn" disabled>
        📋 Postaw kupon
      </button>
    </div>
  </div>`;

  area.innerHTML = h;
  loadBetSlipSelections();
}

function loadBetSlipSelections() {
  const el = document.getElementById('betslipSelections');
  const top = surebets.slice(0, 6);
  if (top.length === 0) {
    el.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted)">Brak surebetów</div>'; return;
  }
  el.innerHTML = top.map(sb => `
    <div class="card" style="margin-bottom:6px;cursor:pointer" onclick="addToBetSlip('${sb.id}','${sb.team1} vs ${sb.team2}','${sb.market||'1X2'}','${sb.best_odds?.['1'] || '?'}','${sb.bookmaker1_name}')">
      <div style="display:flex;align-items:center;gap:8px">
        <div style="font-size:16px">➕</div>
        <div style="flex:1"><div style="font-weight:600;font-size:13px">${sb.team1} vs ${sb.team2}</div>
          <div style="font-size:11px;color:var(--text-secondary)">${sb.bookmaker1_name} • ${sb.market||'1X2'} • Kurs: ${sb.best_odds?.['1']||'?'} • +${sb.profit_pct}%</div></div>
      </div>
    </div>`).join('');
}

let betSlipItems = [];

function addToBetSlip(id, match, market, odds, bookmaker) {
  if (betSlipItems.find(i => i.id === id)) {
    toast('Już dodane', 'warning'); return;
  }
  betSlipItems.push({ id, match, market, odds: parseFloat(odds) || 1.0, bookmaker, selection: market === 'BTTS' ? 'Tak' : '1' });
  toast(`✅ Dodano: ${match}`, 'success', 1500);
  updateBetSlipBuilder();
}

function removeFromBetSlip(id) {
  betSlipItems = betSlipItems.filter(i => i.id !== id);
  updateBetSlipBuilder();
}

async function updateBetSlipBuilder() {
  const el = document.getElementById('betslipBuilder');
  const btn = document.getElementById('betslipPlaceBtn');
  if (!el) return;
  
  if (betSlipItems.length === 0) {
    el.innerHTML = `<div class="empty-state" style="padding:16px"><div class="empty-icon">📋</div><div class="empty-title">Pusty kupon</div></div>`;
    if (btn) btn.disabled = true;
    return;
  }
  
  try {
    const stake = parseFloat(document.getElementById('betslipStake')?.value) || 10;
    const r = await API.post('/api/betslip/calculate', {
      selections: betSlipItems.map(i => ({ match: i.match, market: i.market, selection: i.selection, odds: i.odds, bookmaker: i.bookmaker })),
      stake
    });
    
    let html = `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px">${betSlipItems.length} selekcji • Łączny kurs: <strong style="color:var(--profit)">${r.total_odds}</strong></div>`;
    
    betSlipItems.forEach(item => {
      html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg-secondary);border-radius:6px;margin-bottom:4px">
        <button style="background:none;border:none;cursor:pointer;color:var(--loss);font-size:16px" onclick="removeFromBetSlip('${item.id}')">✕</button>
        <div style="flex:1;font-size:12px"><strong>${item.match}</strong><br>
          <span style="color:var(--text-secondary)">${item.bookmaker} • ${item.selection} @ ${item.odds}</span></div>
        <div style="font-weight:600">${item.odds}</div>
      </div>`;
    });
    
    html += `<div style="display:flex;justify-content:space-between;padding:8px;margin-top:6px;background:var(--bg-card);border-radius:6px">
      <span>Potencjalna wygrana:</span>
      <span style="font-weight:700;color:var(--profit)">${fmtCurr(r.potential_win)}</span>
    </div>`;
    if (r.profit > 0) {
      html += `<div style="display:flex;justify-content:space-between;padding:4px 8px;font-size:12px">
        <span style="color:var(--text-secondary)">Zysk netto:</span>
        <span style="font-weight:600;color:var(--profit)">${fmtCurr(r.profit)} (${(r.profit/r.stake*100).toFixed(2)}%)</span>
      </div>`;
    }
    
    el.innerHTML = html;
    if (btn) btn.disabled = false;
    
  } catch(e) {
    el.innerHTML = '<div class="alert error">Błąd obliczeń</div>';
  }
}

async function placeBetSlip() {
  const stake = parseFloat(document.getElementById('betslipStake')?.value);
  if (!stake || stake <= 0) { toast('Podaj stawkę', 'error'); return; }
  if (betSlipItems.length === 0) { toast('Dodaj selekcje', 'error'); return; }
  
  const btn = document.getElementById('betslipPlaceBtn');
  btn.disabled = true; btn.textContent = '⏳...';
  
  try {
    // Place first selection as a bet (simplified)
    const r = await API.post('/api/bets/place', { surebet_id: betSlipItems[0].id, amount: stake });
    if (r.success) {
      toast(`✅ Kupon postawiony! ${r.bet.status === 'won' ? 'Wygrana: ' + fmtCurr(r.bet.actual_profit) : 'Spróbuj ponownie'}`, 
            r.bet.status === 'won' ? 'success' : 'warning', 5000);
      betSlipItems = [];
      await fetchAllData();
      updateBetSlipBuilder();
    } else toast(`❌ ${r.error}`, 'error');
  } catch(e) { toast('Błąd', 'error'); }
  btn.disabled = false; btn.textContent = '📋 Postaw kupon';
}

// ═══ ACCOUNT VERIFICATION ═══════════════════════════════════════════════

function renderVerification(area) {
  let h = `
  <div class="page-header"><div><h2>✅ Weryfikacja konta</h2>
    <div class="subtitle">Potwierdź swoją tożsamość aby odblokować pełne funkcje</div></div></div>

  <div class="card" style="margin-bottom:16px">
    <div class="card-header"><h3>📧 Krok 1: Zweryfikuj email</h3></div>
    <div class="card-body">
      <p style="font-size:12px;color:var(--text-secondary);margin-bottom:10px">
        Na Twój email zostanie wysłany kod weryfikacyjny.
      </p>
      <div style="display:flex;gap:8px">
        <input class="form-input" id="verifyEmail" type="email" placeholder="Twój adres email" style="flex:1">
        <button class="btn btn-primary" onclick="sendVerificationCode()">📧 Wyślij kod</button>
      </div>
      <div id="verifyCodeSection" style="display:none;margin-top:10px">
        <div style="display:flex;gap:8px">
          <input class="form-input" id="verifyCode" placeholder="Kod z emaila (6 cyfr)" maxlength="6" style="flex:1">
          <button class="btn btn-success" onclick="confirmVerificationCode()">✅ Potwierdź</button>
        </div>
      </div>
    </div>
  </div>

  <div class="card" style="margin-bottom:16px">
    <div class="card-header"><h3>🔐 Krok 2: Ustaw PIN</h3></div>
    <div class="card-body">
      <p style="font-size:12px;color:var(--text-secondary);margin-bottom:10px">
        PIN będzie wymagany przy wypłatach i ważnych operacjach.
      </p>
      <div style="display:flex;gap:8px">
        <input class="form-input" id="pinCode" type="password" placeholder="4-cyfrowy PIN" maxlength="4" style="flex:1">
        <button class="btn btn-primary" onclick="setPin()">🔐 Ustaw PIN</button>
      </div>
    </div>
  </div>

  <div id="verificationStatus"></div>`;

  area.innerHTML = h;
  loadVerificationStatus();
}

async function loadVerificationStatus() {
  try {
    const d = await API.get('/api/account/security/status');
    if (!d.success) return;
    const el = document.getElementById('verificationStatus');
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>📊 Status weryfikacji</h3></div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;text-align:center">
            <div><div style="font-size:32px">${d.email_verified ? '✅' : '⬜'}</div>
              <div style="font-size:12px;color:var(--text-secondary)">Email</div></div>
            <div><div style="font-size:32px">${d.pin_enabled ? '✅' : '⬜'}</div>
              <div style="font-size:12px;color:var(--text-secondary)">PIN</div></div>
          </div>
          ${d.verified_email ? `<div style="margin-top:8px;font-size:12px;color:var(--text-secondary)">📧 ${d.verified_email}</div>` : ''}
        </div>
      </div>`;
  } catch(e) {}
}

async function sendVerificationCode() {
  const email = document.getElementById('verifyEmail')?.value?.trim();
  if (!email || !email.includes('@')) { toast('Podaj prawidłowy email', 'error'); return; }
  try {
    const r = await API.post('/api/account/verify/email', { email });
    if (r.success) {
      document.getElementById('verifyCodeSection').style.display = 'block';
      toast(`✅ Kod wysłany! (demo: ${r.code})`, 'success', 5000);
    } else toast(`❌ ${r.error}`, 'error');
  } catch(e) { toast('Błąd', 'error'); }
}

async function confirmVerificationCode() {
  const email = document.getElementById('verifyEmail')?.value?.trim();
  const code = document.getElementById('verifyCode')?.value?.trim();
  if (!code) { toast('Wpisz kod', 'error'); return; }
  try {
    const r = await API.post('/api/account/verify/confirm', { email, code });
    if (r.success) { toast('✅ Email zweryfikowany!', 'success'); loadVerificationStatus(); }
    else toast(`❌ ${r.error}`, 'error');
  } catch(e) { toast('Błąd', 'error'); }
}

async function setPin() {
  const pin = document.getElementById('pinCode')?.value?.trim();
  if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) { toast('PIN musi mieć 4 cyfry', 'error'); return; }
  try {
    const r = await API.post('/api/account/security/pin', { pin });
    if (r.success) { toast('✅ PIN ustawiony!', 'success'); loadVerificationStatus(); }
    else toast(`❌ ${r.error}`, 'error');
  } catch(e) { toast('Błąd', 'error'); }
}

// ═══ TRANSACTION HISTORY (ADVANCED) ═══════════════════════════════════════

function renderTransactions(area) {
  let h = `
  <div class="page-header"><div><h2>📊 Historia transakcji</h2>
    <div class="subtitle">Wszystkie operacje finansowe</div></div></div>
  <div class="filters-bar" style="margin-bottom:16px">
    <div class="filter-group"><label>Typ:</label>
      <select id="txFilterType" onchange="loadFilteredTransactions()">
        <option value="all">Wszystkie</option>
        <option value="deposit">Wpłaty</option>
        <option value="withdrawal">Wypłaty</option>
        <option value="investment">Inwestycje</option>

        <option value="bet">Zakłady</option>
      </select></div>
    <div class="filter-group"><label>Sortuj:</label>
      <select id="txFilterSort" onchange="loadFilteredTransactions()">
        <option value="newest">Najnowsze</option>
        <option value="oldest">Najstarsze</option>
        <option value="highest">Kwota ↓</option>
        <option value="lowest">Kwota ↑</option>
      </select></div>
  </div>
  <div id="transactionFullList"><div class="loading"><div class="spinner"></div></div></div>`;
  area.innerHTML = h;
  loadFilteredTransactions();
}

async function loadFilteredTransactions() {
  try {
    const d = await API.get('/api/transactions?limit=100');
    const el = document.getElementById('transactionFullList');
    if (!el) return;
    if (!d.success || !d.transactions?.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-title">Brak transakcji</div></div>'; return;
    }
    
    let txns = [...d.transactions];
    const typeFilter = document.getElementById('txFilterType')?.value;
    const sortFilter = document.getElementById('txFilterSort')?.value;
    
    if (typeFilter && typeFilter !== 'all') {
      txns = txns.filter(t => t.type === typeFilter);
    }
    if (sortFilter === 'newest') txns.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
    else if (sortFilter === 'oldest') txns.sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
    else if (sortFilter === 'highest') txns.sort((a,b) => (b.amount||0) - (a.amount||0));
    else if (sortFilter === 'lowest') txns.sort((a,b) => (a.amount||0) - (b.amount||0));
    
    const icons = { deposit: '💰', withdrawal: '💸', investment: '📈', transfer: '🔄', bet: '🎲' };
    if (txns.length === 0) {
      el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)">Brak transakcji tego typu</div>'; return;
    }
    
    el.innerHTML = txns.map(t => {
      const isDeposit = t.type === 'deposit' || (t.amount && t.amount > 0 && t.type !== 'withdrawal' && t.type !== 'investment');
      return `
      <div class="list-item">
        <div class="li-icon">${icons[t.type] || (isDeposit ? '💰' : '💸')}</div>
        <div class="li-content"><div class="li-title">${t.description || t.type}</div>
          <div class="li-subtitle">${fmtDate(t.timestamp)}${t.method ? ` • ${t.method}` : ''}${t.status ? ` • ${t.status}` : ''}</div></div>
        <div class="li-extra"><div class="li-value ${t.type === 'withdrawal' || t.type === 'investment' ? 'amount negative' : 'amount positive'}">
          ${t.type === 'withdrawal' ? '-' : t.type === 'investment' ? '-' : '+'}${fmtCurr(t.amount || 0)}
        </div></div>
      </div>`;
    }).join('');
  } catch(e) { 
    const el = document.getElementById('transactionFullList');
    if (el) el.innerHTML = '<div class="alert error">Błąd ładowania</div>';
  }
}

// ═══ ADD TO ROUTER ═══════════════════════════════════════════════════════
// These pages need to be added to the PAGES router in the init section

// ═══ API Key Management ═══════════════════════════════════════════════

async function loadApiKeysList() {
  try {
    const r = await API.get('/api/settings');
    const el = document.getElementById('apiKeysList');
    if (!el) return;
    
    if (r.success && r.settings) {
      const key = r.settings.theoddsapi_key || '';
      const fbKey = r.settings.api_football_key || '';
      
      let html = '<div style="margin-bottom:8px">';
      html += '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-secondary);border-radius:8px;margin-bottom:4px">';
      html += '<span>🏆 The Odds API:</span>';
      html += key ? '<span style="color:var(--profit)">✅ Skonfigurowany</span>' : '<span style="color:var(--loss)">❌ Brak klucza</span>';
      html += '</div>';
      html += '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-secondary);border-radius:8px">';
      html += '<span>⚽ API-Football:</span>';
      html += fbKey ? '<span style="color:var(--profit)">✅ Skonfigurowany</span>' : '<span style="color:var(--loss)">❌ Brak klucza</span>';
      html += '</div>';
      html += '</div>';
      html += '<button class="btn btn-sm btn-primary" onclick="showApiKeyForm()">🔑 Dodaj/Zmień klucz</button>';
      el.innerHTML = html;
    }
  } catch(e) {
    const el = document.getElementById('apiKeysList');
    if (el) el.innerHTML = '<div class="alert error">Błąd ładowania</div>';
  }
}

function showApiKeyForm() {
  const el = document.getElementById('apiKeyForm');
  if (el) el.style.display = 'block';
  const btn = document.querySelector('[onclick="showApiKeyForm()"]');
  if (btn) btn.style.display = 'none';
}

function cancelApiKey() {
  const el = document.getElementById('apiKeyForm');
  if (el) el.style.display = 'none';
  const btn = document.querySelector('[onclick="showApiKeyForm()"]');
  if (btn) btn.style.display = 'inline-flex';
}

async function saveApiKey() {
  const provider = document.getElementById('apiProvider')?.value;
  const key = document.getElementById('apiKeyInput')?.value?.trim();
  
  if (!key) {
    toast('❌ Wpisz klucz API', 'error');
    return;
  }
  
  const btn = document.querySelector('[onclick="saveApiKey()"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Testowanie...'; }
  
  try {
    const data = {};
    if (provider === 'theoddsapi') data.theoddsapi_key = key;
    else data.api_football_key = key;
    
    const r = await API.post('/api/settings', data);
    if (r.success) {
      toast('✅ Klucz API zapisany!', 'success');
      cancelApiKey();
      await loadApiKeysList();
    } else {
      toast('❌ Błąd zapisu', 'error');
    }
  } catch(e) {
    toast('❌ Błąd serwera', 'error');
  }
  
  if (btn) { btn.disabled = false; btn.textContent = '💾 Zapisz i testuj'; }
}

document.addEventListener('click', (e) => {
  const menu = document.getElementById('userMenu');
  if (menu && !menu.contains(e.target)) {
    document.getElementById('userDropdown')?.classList.remove('open');
  }
});

document.addEventListener('DOMContentLoaded', () => {
  init().catch(err => {
    console.error('Init error:', err);
    document.getElementById('contentArea').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <div class="empty-title">Błąd inicjalizacji</div>
        <div class="empty-subtitle">${err.message}</div>
        <button class="btn" onclick="location.reload()" style="margin-top:16px">🔄 Spróbuj ponownie</button>
      </div>`;
  });
});

// ═══ Payment & API Keys Functions ═══════════════════════════════════

