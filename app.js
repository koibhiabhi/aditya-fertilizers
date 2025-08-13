/* ================== FIREBASE INITIALIZATION ================== */
/* Keep your existing Firebase config here */
const firebaseConfig = {
    // your firebase config here
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

/* ================== LEDGER MODULE ================== */
const ledgerTableBody = document.getElementById("ledgerTableBody");
const ledgerSearch = document.getElementById("ledgerSearch");
const ledgerCompanyFilter = document.getElementById("ledgerCompanyFilter");
const ledgerMaterialFilter = document.getElementById("ledgerMaterialFilter");
const ledgerTypeFilter = document.getElementById("ledgerTypeFilter");
const ledgerFromDate = document.getElementById("ledgerFromDate");
const ledgerToDate = document.getElementById("ledgerToDate");
const ledgerApplyFilters = document.getElementById("ledgerApplyFilters");

let ledgerData = [];

/* Fetch Ledger from Firebase */
async function fetchLedger() {
    ledgerData = [];
    const snapshot = await db.collection("transactions").orderBy("date", "desc").get();
    snapshot.forEach(doc => {
        let data = doc.data();
        ledgerData.push({
            id: doc.id,
            ...data
        });
    });
    renderLedger(ledgerData);
}

/* Render Ledger Table */
function renderLedger(data) {
    ledgerTableBody.innerHTML = "";
    data.forEach(entry => {
        const tr = document.createElement("tr");
        tr.classList.add(entry.type === "Purchase" ? "ledger-purchase" : "ledger-sale");

        tr.innerHTML = `
            <td>${formatDate(entry.date)}</td>
            <td>${entry.company}</td>
            <td>${entry.material}</td>
            <td>${entry.type}</td>
            <td>${entry.bags}</td>
            <td>₹${entry.pricePerBag.toFixed(2)}</td>
            <td>₹${(entry.bags * entry.pricePerBag).toFixed(2)}</td>
            <td>${entry.type === "Purchase" ? entry.boughtFrom || "-" : entry.soldTo || "-"}</td>
            <td>
                <button class="ledger-action-btn ledger-edit" onclick="editTransaction('${entry.id}')">Edit</button>
                <button class="ledger-action-btn ledger-delete" onclick="deleteTransaction('${entry.id}')">Delete</button>
            </td>
        `;
        ledgerTableBody.appendChild(tr);
    });
}

/* Format Date */
function formatDate(ts) {
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleDateString("en-IN");
}

/* Apply Filters */
ledgerApplyFilters.addEventListener("click", () => {
    let filtered = ledgerData;

    const searchVal = ledgerSearch.value.toLowerCase();
    if (searchVal) {
        filtered = filtered.filter(e =>
            e.company.toLowerCase().includes(searchVal) ||
            e.material.toLowerCase().includes(searchVal) ||
            (e.boughtFrom && e.boughtFrom.toLowerCase().includes(searchVal)) ||
            (e.soldTo && e.soldTo.toLowerCase().includes(searchVal))
        );
    }

    if (ledgerCompanyFilter.value) {
        filtered = filtered.filter(e => e.company === ledgerCompanyFilter.value);
    }
    if (ledgerMaterialFilter.value) {
        filtered = filtered.filter(e => e.material === ledgerMaterialFilter.value);
    }
    if (ledgerTypeFilter.value) {
        filtered = filtered.filter(e => e.type === ledgerTypeFilter.value);
    }
    if (ledgerFromDate.value) {
        const from = new Date(ledgerFromDate.value);
        filtered = filtered.filter(e => new Date(e.date.toDate ? e.date.toDate() : e.date) >= from);
    }
    if (ledgerToDate.value) {
        const to = new Date(ledgerToDate.value);
        filtered = filtered.filter(e => new Date(e.date.toDate ? e.date.toDate() : e.date) <= to);
    }

    renderLedger(filtered);
});

/* Edit Transaction */
async function editTransaction(id) {
    const entry = ledgerData.find(e => e.id === id);
    if (!entry) return;

    const newBags = parseFloat(prompt("Enter new bag quantity:", entry.bags));
    const newPrice = parseFloat(prompt("Enter new price per bag:", entry.pricePerBag));

    if (!isNaN(newBags) && !isNaN(newPrice)) {
        await db.collection("transactions").doc(id).update({
            bags: newBags,
            pricePerBag: newPrice
        });
        fetchLedger();
    }
}

/* Delete Transaction */
async function deleteTransaction(id) {
    if (confirm("Are you sure you want to delete this transaction?")) {
        await db.collection("transactions").doc(id).delete();
        fetchLedger();
    }
}

/* Load on page start */
fetchLedger();
