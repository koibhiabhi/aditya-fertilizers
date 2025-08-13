/* ============================
   1. FIREBASE INIT & GLOBALS
   ============================ */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBEybu3XKeK3QOeRIMs-fK2dDwHtpCTqgQ",
  authDomain: "aditya-supply-chain-b5f61.firebaseapp.com",
  projectId: "aditya-supply-chain-b5f61",
  storageBucket: "aditya-supply-chain-b5f61.firebasestorage.app",
  messagingSenderId: "662836162599",
  appId: "1:662836162599:web:2b49bde530e4b87924de02",
  measurementId: "G-DQH00BNH1L"
};
const AUTO_SIGNIN = true;
const ADMIN_EMAIL = 'adityajainaas@gmail.com';
const ADMIN_PWD = 'Aditya@1609';

// Init Firebase (compat mode)
firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.firestore();
const auth = firebase.auth();

let currentCompanyId = null;
let currentCompanyName = null;

/* ============================
   2. HELPER FUNCTIONS
   ============================ */
function showLoader(title = 'Working…', text = 'Please wait') {
  document.getElementById('loaderTitle').textContent = title;
  document.getElementById('loaderText').textContent = text;
  document.getElementById('globalLoader').classList.add('active');
}
function hideLoader() {
  document.getElementById('globalLoader').classList.remove('active');
}

function localDateString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
function formatCurrency(num) {
  return Number(num || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
}
function formatDateTime(ts) {
  if (!ts) return '';
  let d = ts instanceof Date ? ts : ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-IN') + ' ' + d.toLocaleTimeString('en-IN');
}

/* ============================
   3. AUTH HANDLING
   ============================ */
auth.onAuthStateChanged(user => {
  if (user) {
    document.getElementById('adminEmail').textContent = user.email || user.uid;
    document.getElementById('statusLabel').textContent = 'Signed in';
    loadCompaniesToMenu();
  } else {
    document.getElementById('adminEmail').textContent = 'Not signed';
    document.getElementById('statusLabel').textContent = 'Signed out';
    if (!AUTO_SIGNIN) loadCompaniesToMenu();
  }
});

// Auto sign-in logic
(async function autoSignIn() {
  if (!AUTO_SIGNIN) return;
  try {
    showLoader('Signing in…', 'Signing in admin account');
    await auth.signInWithEmailAndPassword(ADMIN_EMAIL, ADMIN_PWD);
  } catch (e) {
    alert('Auto sign-in failed: ' + e.message);
  } finally {
    hideLoader();
  }
})();

/* ============================
   4. COMPANY & MASTER DATA MGMT
   ============================ */

// Load companies into the sidebar menu
async function loadCompaniesToMenu() {
  try {
    showLoader('Loading companies…', 'Fetching list from database');
    const snap = await db.collection('companies').orderBy('name').get();
    const sel = document.getElementById('companySelect');
    sel.innerHTML = '';

    if (snap.empty) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No companies';
      sel.appendChild(opt);
      return;
    }

    snap.forEach(doc => {
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.textContent = doc.data().name;
      sel.appendChild(opt);
    });

    // Auto-select first company if not set
    if (!currentCompanyId && sel.options.length > 0) {
      currentCompanyId = sel.options[0].value;
      currentCompanyName = sel.options[0].textContent;
      document.getElementById('mainCompanyName').textContent = currentCompanyName;
    }
  } catch (err) {
    console.error('Error loading companies:', err);
    alert('Error loading companies: ' + err.message);
  } finally {
    hideLoader();
  }
}

// Handle company selection change
document.getElementById('companySelect').addEventListener('change', e => {
  currentCompanyId = e.target.value;
  currentCompanyName = e.target.options[e.target.selectedIndex].textContent;
  document.getElementById('mainCompanyName').textContent = currentCompanyName;
  // Reload dashboard/ledger/etc when company changes
  renderDashboard();
});

// ===== MASTER DATA =====

// Load materials
async function loadMaterials() {
  if (!currentCompanyId) return [];
  const snap = await db.collection('companies').doc(currentCompanyId)
    .collection('materials').orderBy('name').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Load parties (customers/suppliers)
async function loadParties() {
  if (!currentCompanyId) return [];
  const snap = await db.collection('companies').doc(currentCompanyId)
    .collection('parties').orderBy('name').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Save or update material
async function saveMaterial(data, id = null) {
  if (!currentCompanyId) return;
  const col = db.collection('companies').doc(currentCompanyId).collection('materials');
  if (id) {
    await col.doc(id).set(data, { merge: true });
  } else {
    await col.add(data);
  }
}

// Save or update party
async function saveParty(data, id = null) {
  if (!currentCompanyId) return;
  const col = db.collection('companies').doc(currentCompanyId).collection('parties');
  if (id) {
    await col.doc(id).set(data, { merge: true });
  } else {
    await col.add(data);
  }
}

// Delete material
async function deleteMaterial(id) {
  if (!currentCompanyId || !id) return;
  await db.collection('companies').doc(currentCompanyId)
    .collection('materials').doc(id).delete();
}

// Delete party
async function deleteParty(id) {
  if (!currentCompanyId || !id) return;
  await db.collection('companies').doc(currentCompanyId)
    .collection('parties').doc(id).delete();
}

/* ============================
   5. TRANSACTIONS
   ============================ */

// ---- Add Purchase ----
async function addPurchase({ date, partyId, materialId, qty, rate, note }) {
  if (!currentCompanyId) throw new Error('No company selected');
  const total = qty * rate;
  const doc = {
    date: date || localDateString(),
    partyId,
    materialId,
    qty,
    rate,
    total,
    note: note || '',
    type: 'purchase',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  await db.collection('companies').doc(currentCompanyId)
    .collection('transactions').add(doc);
}

// ---- Add Sale ----
async function addSale({ date, partyId, materialId, qty, rate, note }) {
  if (!currentCompanyId) throw new Error('No company selected');
  const total = qty * rate;
  const doc = {
    date: date || localDateString(),
    partyId,
    materialId,
    qty,
    rate,
    total,
    note: note || '',
    type: 'sale',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  await db.collection('companies').doc(currentCompanyId)
    .collection('transactions').add(doc);
}

// ---- Add Voucher (Receipt, Payment, Journal) ----
async function addVoucher({ date, partyId, amount, vType, note }) {
  if (!currentCompanyId) throw new Error('No company selected');
  const doc = {
    date: date || localDateString(),
    partyId,
    amount,
    type: vType, // 'receipt', 'payment', 'journal'
    note: note || '',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  await db.collection('companies').doc(currentCompanyId)
    .collection('transactions').add(doc);
}

// ---- Load Transactions (filtered) ----
async function loadTransactions({ from, to, type }) {
  if (!currentCompanyId) return [];
  let q = db.collection('companies').doc(currentCompanyId)
    .collection('transactions').orderBy('date', 'desc');

  if (from) q = q.where('date', '>=', from);
  if (to) q = q.where('date', '<=', to);
  if (type) q = q.where('type', '==', type);

  const snap = await q.get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ---- Delete Transaction ----
async function deleteTransaction(id) {
  if (!currentCompanyId || !id) return;
  await db.collection('companies').doc(currentCompanyId)
    .collection('transactions').doc(id).delete();
}

// ---- Update Transaction ----
async function updateTransaction(id, data) {
  if (!currentCompanyId || !id) return;
  await db.collection('companies').doc(currentCompanyId)
    .collection('transactions').doc(id).set(data, { merge: true });
}

/* ============================
   6. LEDGER, DAYBOOK, REPORTS
   ============================ */

// ---- Ledger: Party-wise ----
async function loadLedger(partyId) {
  if (!currentCompanyId || !partyId) return [];
  const snap = await db.collection('companies').doc(currentCompanyId)
    .collection('transactions')
    .where('partyId', '==', partyId)
    .orderBy('date')
    .orderBy('createdAt')
    .get();

  let balance = 0;
  const ledgerRows = [];

  snap.forEach(doc => {
    const t = doc.data();
    let debit = 0, credit = 0;
    if (t.type === 'purchase' || t.type === 'payment') {
      debit = t.total || t.amount || 0;
      balance += debit;
    } else if (t.type === 'sale' || t.type === 'receipt') {
      credit = t.total || t.amount || 0;
      balance -= credit;
    } else if (t.type === 'journal') {
      // Could be either depending on sign
      if ((t.amount || 0) >= 0) {
        debit = t.amount;
        balance += debit;
      } else {
        credit = Math.abs(t.amount);
        balance -= credit;
      }
    }
    ledgerRows.push({
      id: doc.id,
      date: t.date,
      vno: t.voucherNo || '',
      desc: t.note || '',
      debit,
      credit,
      balance
    });
  });

  return ledgerRows;
}

// ---- Daybook: Chronological transactions ----
async function loadDaybook(date) {
  if (!currentCompanyId) return [];
  let q = db.collection('companies').doc(currentCompanyId)
    .collection('transactions')
    .orderBy('date', 'desc')
    .orderBy('createdAt', 'desc');
  if (date) q = q.where('date', '==', date);

  const snap = await q.get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ---- Search transactions ----
async function searchTransactions({ text, from, to, type }) {
  let data = await loadTransactions({ from, to, type });

  if (text) {
    const lower = text.toLowerCase();
    data = data.filter(t =>
      (t.note || '').toLowerCase().includes(lower) ||
      (t.voucherNo || '').toLowerCase().includes(lower)
    );
  }
  return data;
}

// ---- Stock Summary ----
async function getStockSummary() {
  const mats = await loadMaterials();
  const trans = await loadTransactions({});
  const stock = {};

  mats.forEach(m => {
    stock[m.id] = { name: m.name, qty: 0, value: 0 };
  });

  trans.forEach(t => {
    if (!t.materialId) return;
    if (t.type === 'purchase') {
      stock[t.materialId].qty += t.qty;
      stock[t.materialId].value += t.total;
    } else if (t.type === 'sale') {
      stock[t.materialId].qty -= t.qty;
      stock[t.materialId].value -= t.total;
    }
  });

  return Object.values(stock);
}

// ---- Party Balances ----
async function getPartyBalances() {
  const parties = await loadParties();
  const trans = await loadTransactions({});
  const balances = {};

  parties.forEach(p => {
    balances[p.id] = { name: p.name, balance: 0 };
  });

  trans.forEach(t => {
    if (!t.partyId) return;
    if (t.type === 'purchase' || t.type === 'payment') {
      balances[t.partyId].balance += t.total || t.amount || 0;
    } else if (t.type === 'sale' || t.type === 'receipt') {
      balances[t.partyId].balance -= t.total || t.amount || 0;
    } else if (t.type === 'journal') {
      balances[t.partyId].balance += t.amount || 0;
    }
  });

  return Object.values(balances);
}
/* ============================
   7. UI WIRING & BOOTSTRAP
   ============================ */

// ---- Sidebar toggle ----
const drawer = document.getElementById('drawer');
document.getElementById('hamb').addEventListener('click', () => {
  drawer.classList.toggle('open');
});

// ---- Menu buttons ----
document.getElementById('menuDashboard').addEventListener('click', () => {
  renderDashboard();
  showRoute('dashboardArea');
});
document.getElementById('menuDaybook').addEventListener('click', () => {
  renderDaybook(localDateString());
  showRoute('daybookArea');
});
document.getElementById('menuSales').addEventListener('click', () => {
  renderSalesRegister();
  showRoute('salesArea');
});
document.getElementById('menuPurchases').addEventListener('click', () => {
  renderPurchaseRegister();
  showRoute('purchasesArea');
});
document.getElementById('menuLedger').addEventListener('click', async () => {
  const parties = await loadParties();
  if (parties.length) {
    renderLedger(parties[0].id);
  }
  showRoute('ledgerArea');
});
document.getElementById('menuParties').addEventListener('click', async () => {
  renderParties();
  showRoute('partiesArea');
});
document.getElementById('menuVouchers').addEventListener('click', () => {
  renderVouchers();
  showRoute('vouchersArea');
});
document.getElementById('menuReports').addEventListener('click', async () => {
  renderReports();
  showRoute('reportsArea');
});

// ---- Quick actions ----
document.getElementById('btnPurchase').addEventListener('click', () => {
  openPurchaseForm();
});
document.getElementById('btnSale').addEventListener('click', () => {
  openSaleForm();
});
document.getElementById('btnVoucher').addEventListener('click', () => {
  openVoucherForm();
});
document.getElementById('btnHistory').addEventListener('click', () => {
  renderDaybook();
  showRoute('daybookArea');
});
document.getElementById('btnManage').addEventListener('click', () => {
  renderMasterData();
  showRoute('manageArea');
});

// ---- Search bar ----
document.getElementById('btnSearch').addEventListener('click', async (e) => {
  e.preventDefault();
  const text = document.getElementById('searchText').value;
  const from = document.getElementById('searchFrom').value;
  const to = document.getElementById('searchTo').value;
  const type = document.getElementById('searchType').value;
  const results = await searchTransactions({ text, from, to, type });
  renderSearchResults(results);
});
document.getElementById('btnSearchReset').addEventListener('click', () => {
  document.getElementById('searchForm').reset();
});

// ---- Route switching helper ----
function showRoute(id) {
  document.querySelectorAll('.route').forEach(r => r.hidden = true);
  document.getElementById(id).hidden = false;
}

// ---- Rendering functions ----
async function renderDashboard() {
  const mats = await loadMaterials();
  const container = document.getElementById('dashboardArea');
  container.innerHTML = '';
  if (!mats.length) {
    container.appendChild(document.getElementById('tpl-empty').content.cloneNode(true));
    return;
  }
  mats.forEach(m => {
    const card = document.getElementById('tpl-material-card').content.cloneNode(true);
    card.querySelector('.mat-name').textContent = m.name;
    card.querySelector('.mat-qty').textContent = m.qty || 0;
    card.querySelector('.mat-meta').textContent = m.unit || '';
    container.appendChild(card);
  });
}

async function renderDaybook(date) {
  const entries = await loadDaybook(date);
  const container = document.getElementById('daybookArea');
  container.innerHTML = '';
  if (!entries.length) {
    container.appendChild(document.getElementById('tpl-empty').content.cloneNode(true));
    return;
  }
  entries.forEach(t => {
    const card = document.getElementById('tpl-daybook-card').content.cloneNode(true);
    card.querySelector('.entry-title').textContent = `${t.type.toUpperCase()} - ${t.total || t.amount}`;
    card.querySelector('.entry-meta').textContent = formatDateTime(t.createdAt);
    card.querySelector('.entry-note').textContent = t.note || '';
    container.appendChild(card);
  });
}

async function renderLedger(partyId) {
  const rows = await loadLedger(partyId);
  const container = document.getElementById('ledgerArea');
  container.innerHTML = '<table><thead><tr><th>Date</th><th>V.No</th><th>Description</th><th>Debit</th><th>Credit</th><th>Balance</th><th></th></tr></thead><tbody></tbody></table>';
  const tbody = container.querySelector('tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="tiny muted">No entries</td></tr>';
    return;
  }
  rows.forEach(r => {
    const row = document.getElementById('tpl-ledger-row').content.cloneNode(true);
    row.querySelector('.led-date').textContent = r.date;
    row.querySelector('.led-vno').textContent = r.vno;
    row.querySelector('.led-desc').textContent = r.desc;
    row.querySelector('.led-debit').textContent = r.debit ? formatCurrency(r.debit) : '';
    row.querySelector('.led-credit').textContent = r.credit ? formatCurrency(r.credit) : '';
    row.querySelector('.led-balance').textContent = formatCurrency(r.balance);
    tbody.appendChild(row);
  });
}

async function renderParties() {
  const parties = await loadParties();
  const container = document.getElementById('partiesArea');
  container.innerHTML = '<table><thead><tr><th>Name</th><th>Type</th><th>Phone</th><th>GST</th><th>Balance</th><th></th></tr></thead><tbody></tbody></table>';
  const tbody = container.querySelector('tbody');
  if (!parties.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="tiny muted">No parties</td></tr>';
    return;
  }
  parties.forEach(p => {
    const row = document.getElementById('tpl-party-row').content.cloneNode(true);
    row.querySelector('.pty-name').textContent = p.name;
    row.querySelector('.pty-type').textContent = p.type || '';
    row.querySelector('.pty-phone').textContent = p.phone || '';
    row.querySelector('.pty-gst').textContent = p.gst || '';
    tbody.appendChild(row);
  });
}

async function renderVouchers() {
  const entries = await loadTransactions({ type: 'receipt' }); // Example: show receipts first
  const container = document.getElementById('vouchersArea');
  container.innerHTML = '<table><thead><tr><th>Date</th><th>No</th><th>Type</th><th>Party</th><th>Amount</th><th></th></tr></thead><tbody></tbody></table>';
  const tbody = container.querySelector('tbody');
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="tiny muted">No vouchers</td></tr>';
    return;
  }
  entries.forEach(v => {
    const row = document.getElementById('tpl-voucher-row').content.cloneNode(true);
    row.querySelector('.vch-date').textContent = v.date;
    row.querySelector('.vch-no').textContent = v.voucherNo || '';
    row.querySelector('.vch-type').textContent = v.type;
    row.querySelector('.vch-party').textContent = v.partyId || '';
    row.querySelector('.vch-amount').textContent = formatCurrency(v.amount);
    tbody.appendChild(row);
  });
}

async function renderReports() {
  const stock = await getStockSummary();
  const parties = await getPartyBalances();
  const container = document.getElementById('reportsArea');
  container.innerHTML = '';

  const stockBlock = document.getElementById('tpl-report-block').content.cloneNode(true);
  stockBlock.querySelector('.report-title').textContent = 'Stock Summary';
  stockBlock.querySelector('.report-body').innerHTML = '<pre>' + JSON.stringify(stock, null, 2) + '</pre>';
  container.appendChild(stockBlock);

  const partyBlock = document.getElementById('tpl-report-block').content.cloneNode(true);
  partyBlock.querySelector('.report-title').textContent = 'Party Balances';
  partyBlock.querySelector('.report-body').innerHTML = '<pre>' + JSON.stringify(parties, null, 2) + '</pre>';
  container.appendChild(partyBlock);
}

// ---- Bootstrapping ----
document.addEventListener('DOMContentLoaded', () => {
  if (!AUTO_SIGNIN) {
    loadCompaniesToMenu();
  }
  renderDashboard();
});


