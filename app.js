/* ====================== app.js ======================
   Fertilizers Supply Chain Management Admin JS
   Handles Firebase, weighted avg bag prices, ledger,
   history, today view, and all UI bindings.
   ===================================================== */

// ---------- Firebase Setup ----------
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
const ADMIN_EMAIL = "adityajainaas@gmail.com";
const ADMIN_PWD = "Aditya@1609";

firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.firestore();
const auth = firebase.auth();

// ---------- State ----------
let companies = [];
let materials = {};
let ledgerEntries = [];
let currentCompany = null;
let ledgerPage = 0;
const pageSize = 20;

// ---------- Utilities ----------
function formatDateLocal(ts) {
  const d = ts instanceof Date ? ts : ts.toDate();
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function formatCurrency(num) {
  return `₹${num.toFixed(2)}`;
}
function calcWeightedAvg(oldQty, oldPrice, newQty, newPrice) {
  const totalQty = oldQty + newQty;
  if (totalQty === 0) return 0;
  return ((oldQty * oldPrice) + (newQty * newPrice)) / totalQty;
}
function showLoader(title = "Working…", message = "Please wait") {
  document.getElementById("globalLoader").setAttribute("aria-hidden", "false");
  document.getElementById("loaderTitle").textContent = title;
  document.getElementById("loaderMessage").textContent = message;
}
function hideLoader() {
  document.getElementById("globalLoader").setAttribute("aria-hidden", "true");
}

// ---------- Init ----------
document.addEventListener("DOMContentLoaded", () => {
  if (AUTO_SIGNIN) {
    auth.signInWithEmailAndPassword(ADMIN_EMAIL, ADMIN_PWD)
      .then(() => {
        bindUI();
        loadCompanies();
      })
      .catch(err => alert("Auto login failed: " + err.message));
  } else {
    bindUI();
    loadCompanies();
  }
});

// ---------- UI Bindings ----------
function bindUI() {
  document.getElementById("companySelect").addEventListener("change", e => {
    currentCompany = e.target.value;
    if (currentCompany) loadMaterials(currentCompany);
  });
  document.getElementById("btnPurchase").addEventListener("click", () => openAddEntry("purchase"));
  document.getElementById("btnSale").addEventListener("click", () => openAddEntry("sale"));
  document.getElementById("btnHistory").addEventListener("click", openHistory);
  document.getElementById("btnLedger").addEventListener("click", openLedger);
  document.getElementById("btnToday").addEventListener("click", openToday);

  document.getElementById("ledgerPrevPage")?.addEventListener("click", () => changeLedgerPage(-1));
  document.getElementById("ledgerNextPage")?.addEventListener("click", () => changeLedgerPage(1));

  document.getElementById("ledgerSearchBtn")?.addEventListener("click", applyLedgerFilters);
  document.getElementById("ledgerClearSearch")?.addEventListener("click", () => {
    document.getElementById("ledgerSearchInput").value = "";
    applyLedgerFilters();
  });
  document.getElementById("ledgerExport")?.addEventListener("click", exportLedgerCSV);
}

// ---------- Data Loading ----------
async function loadCompanies() {
  showLoader("Loading companies");
  const snap = await db.collection("companies").orderBy("name").get();
  companies = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const sel = document.getElementById("companySelect");
  sel.innerHTML = `<option value="">Select company</option>`;
  companies.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    sel.appendChild(opt);
  });
  hideLoader();
}
async function loadMaterials(companyId) {
  showLoader("Loading materials");
  const snap = await db.collection("companies").doc(companyId).collection("materials").get();
  materials[companyId] = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  renderDashboard();
  hideLoader();
}
async function loadLedger() {
  showLoader("Loading ledger");
  const snap = await db.collection("ledger").orderBy("date", "desc").get();
  ledgerEntries = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  hideLoader();
}

// ---------- Dashboard ----------
function renderDashboard() {
  const area = document.getElementById("dashboardArea");
  area.innerHTML = "";
  if (!currentCompany || !materials[currentCompany]) return;
  const grid = document.createElement("div");
  grid.className = "materials";
  materials[currentCompany].forEach(m => {
    const card = document.getElementById("tplMaterialCard").content.cloneNode(true);
    card.querySelector("[data-field='name']").textContent = m.name;
    card.querySelector("[data-field='kgPerBag']").textContent = `${m.kgPerBag} kg/bag`;
    card.querySelector("[data-field='stockBags']").textContent = `${m.stockBags} bags`;
    card.querySelector("[data-field='pricePerBag']").textContent = formatCurrency(m.pricePerBag || 0);
    card.querySelector("[data-field='stockValue']").textContent = formatCurrency((m.stockBags || 0) * (m.pricePerBag || 0));
    card.querySelector("[data-action='purchase']").addEventListener("click", () => openAddEntry("purchase", m.id));
    card.querySelector("[data-action='sale']").addEventListener("click", () => openAddEntry("sale", m.id));
    grid.appendChild(card);
  });
  area.appendChild(grid);
}

// ---------- Add Entry ----------
function openAddEntry(type, materialId = null) {
  const modalTpl = document.getElementById("tplAddEntry").content.cloneNode(true);
  const form = modalTpl.querySelector("#addEntryForm");
  if (materialId) form.querySelector("#entryMaterial").value = materialId;
  form.querySelector("#entryType").value = type;
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const bags = parseFloat(data.bags);
    const pricePerBag = parseFloat(data.pricePerBag);
    if (isNaN(bags) || isNaN(pricePerBag)) return;
    await addEntry(data.materialId, data.type, bags, pricePerBag, data.party, data.note);
    closeModal();
  });
  openModal(modalTpl);
}
async function addEntry(materialId, type, bags, pricePerBag, party, note) {
  showLoader("Saving entry");
  const matRef = db.collection("companies").doc(currentCompany).collection("materials").doc(materialId);
  await db.runTransaction(async (tx) => {
    const matDoc = await tx.get(matRef);
    if (!matDoc.exists) throw new Error("Material not found");
    const m = matDoc.data();
    let newStock = m.stockBags || 0;
    let newPrice = m.pricePerBag || 0;
    if (type === "purchase") {
      newPrice = calcWeightedAvg(newStock, newPrice, bags, pricePerBag);
      newStock += bags;
    } else {
      newStock -= bags;
    }
    tx.update(matRef, { stockBags: newStock, pricePerBag: newPrice });
    const ledgerRef = db.collection("ledger").doc();
    tx.set(ledgerRef, {
      companyId: currentCompany,
      materialId,
      type,
      bags,
      pricePerBag,
      total: bags * pricePerBag,
      party,
      note,
      date: new Date()
    });
  });
  await loadMaterials(currentCompany);
  await loadLedger();
  hideLoader();
}

// ---------- History ----------
function openHistory() {
  const filtered = ledgerEntries.filter(e => e.companyId === currentCompany);
  renderLedgerTable(filtered, "History for " + companies.find(c => c.id === currentCompany)?.name);
}

// ---------- Ledger ----------
function openLedger() {
  loadLedger().then(() => renderLedgerTable(ledgerEntries, "Full Ledger"));
}
function renderLedgerTable(entries, title) {
  document.getElementById("ledgerTitle").textContent = title;
  const tbody = document.getElementById("ledgerTbody");
  tbody.innerHTML = "";
  entries.slice(ledgerPage * pageSize, ledgerPage * pageSize + pageSize).forEach(e => {
    const tr = document.createElement("tr");
    tr.className = e.type === "purchase" ? "ledger-row-purchase" : "ledger-row-sale";
    tr.innerHTML = `
      <td>${formatDateLocal(e.date)}</td>
      <td>${companies.find(c => c.id === e.companyId)?.name || ""}</td>
      <td>${materials[e.companyId]?.find(m => m.id === e.materialId)?.name || ""}</td>
      <td>${e.type}</td>
      <td>${e.bags}</td>
      <td>${formatCurrency(e.pricePerBag)}</td>
      <td>${formatCurrency(e.total)}</td>
      <td>${e.party || ""}</td>
      <td>${e.note || ""}</td>
      <td>
        <button class="table-action edit" onclick="editLedgerEntry('${e.id}')">✏️</button>
        <button class="table-action delete" onclick="deleteLedgerEntry('${e.id}')">🗑</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}
function changeLedgerPage(delta) {
  ledgerPage += delta;
  if (ledgerPage < 0) ledgerPage = 0;
  renderLedgerTable(ledgerEntries, "Full Ledger");
}
function applyLedgerFilters() {
  const term = document.getElementById("ledgerSearchInput").value.toLowerCase();
  const filtered = ledgerEntries.filter(e =>
    companies.find(c => c.id === e.companyId)?.name.toLowerCase().includes(term) ||
    materials[e.companyId]?.find(m => m.id === e.materialId)?.name.toLowerCase().includes(term) ||
    (e.party && e.party.toLowerCase().includes(term)) ||
    (e.note && e.note.toLowerCase().includes(term))
  );
  renderLedgerTable(filtered, "Filtered Ledger");
}
function exportLedgerCSV() {
  let csv = "Date,Company,Material,Type,Bags,Price Per Bag,Total,Party,Note\n";
  ledgerEntries.forEach(e => {
    csv += `${formatDateLocal(e.date)},${companies.find(c => c.id === e.companyId)?.name || ""},${materials[e.companyId]?.find(m => m.id === e.materialId)?.name || ""},${e.type},${e.bags},${e.pricePerBag},${e.total},${e.party || ""},${e.note || ""}\n`;
  });
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ledger.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- Edit/Delete ----------
async function editLedgerEntry(id) {
  const entry = ledgerEntries.find(e => e.id === id);
  if (!entry) return;
  const newBags = parseFloat(prompt("Enter new bags:", entry.bags));
  const newPrice = parseFloat(prompt("Enter new price per bag:", entry.pricePerBag));
  if (!isNaN(newBags) && !isNaN(newPrice)) {
    await db.collection("ledger").doc(id).update({ bags: newBags, pricePerBag: newPrice, total: newBags * newPrice });
    await loadLedger();
    renderLedgerTable(ledgerEntries, "Full Ledger");
  }
}
async function deleteLedgerEntry(id) {
  if (confirm("Delete this entry?")) {
    await db.collection("ledger").doc(id).delete();
    await loadLedger();
    renderLedgerTable(ledgerEntries, "Full Ledger");
  }
}

// ---------- Today ----------
function openToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todaysEntries = ledgerEntries.filter(e => {
    const d = e.date instanceof Date ? e.date : e.date.toDate();
    return d >= today;
  });
  const purchaseTotal = todaysEntries.filter(e => e.type === "purchase").reduce((sum, e) => sum + e.total, 0);
  const saleTotal = todaysEntries.filter(e => e.type === "sale").reduce((sum, e) => sum + e.total, 0);
  const profit = saleTotal - purchaseTotal;
  alert(`Today's Purchases: ${formatCurrency(purchaseTotal)}\nToday's Sales: ${formatCurrency(saleTotal)}\nProfit/Loss: ${formatCurrency(profit)}`);
}

// ---------- Modals ----------
function openModal(content) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.appendChild(content);
  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", e => {
    if (e.target === backdrop) closeModal();
  });
}
function closeModal() {
  document.querySelector(".modal-backdrop")?.remove();
}
