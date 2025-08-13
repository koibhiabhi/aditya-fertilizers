/* =========================================================
   Pro Ledger upgrade on top of your working app.
   - Party master
   - Tally-like ledger (running balance)
   - Powerful search / filters
   - Voucher auto-numbering (per FY)
   - Edit/Delete everywhere (safe rebuild)
   - Exports (entries + ledger)
   Uses your existing Firebase structure and UI patterns.
========================================================= */

/* FIREBASE CONFIG (from your app) */
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

/* Init */
firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.firestore();
const auth = firebase.auth();

/* State */
let currentCompanyId = null;
let lastMaterials = [];
let lastEntries = [];
let lastParties = [];
let materialsUnsub = null;
let entriesUnsub = null;
let partiesUnsub = null;
let cachedTotalInventoryValue = 0;

/* Loader */
const loader = document.getElementById('globalLoader');
const loaderTitle = document.getElementById('loaderTitle');
const loaderText = document.getElementById('loaderText');
function showLoader(title='Working…', text='Please wait'){ loaderTitle.textContent = title; loaderText.textContent = text; loader.style.display = 'flex'; loader.setAttribute('aria-hidden','false'); }
function hideLoader(){ loader.style.display = 'none'; loader.setAttribute('aria-hidden','true'); }

/* Utils */
function toINR(x){ if(x===undefined||x===null||x==='') return '-'; return '₹' + Number(x).toLocaleString('en-IN',{maximumFractionDigits:2}); }
function fmtDate(ts){ if(!ts) return '-'; if(ts.toDate) return ts.toDate().toLocaleString('en-IN'); if(ts.seconds) return new Date(ts.seconds*1000).toLocaleString('en-IN'); return new Date(ts).toLocaleString('en-IN'); }
function localDateString(date = new Date()){
  const y = date.getFullYear(); const m = String(date.getMonth()+1).padStart(2,'0'); const d = String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
function dateOnly(d){ const t = new Date(d); t.setHours(0,0,0,0); return t; }
function normalizeName(n){ return (n || '').trim().toLowerCase(); }
function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fyForDate(d=new Date()){
  const dt = new Date(d); const y = dt.getFullYear(); const m = dt.getMonth()+1;
  // India FY: starts 1 April
  return (m>=4) ? `${y}-${String(y+1).slice(-2)}` : `${y-1}-${String(y).slice(-2)}`;
}

/* Auth */
auth.onAuthStateChanged(user=>{
  if(user){ document.getElementById('adminEmail').textContent = user.email || user.uid; document.getElementById('statusLabel').textContent = 'Signed in'; }
  else { document.getElementById('adminEmail').textContent = 'Not signed'; document.getElementById('statusLabel').textContent = 'Signed out'; }
});
(async function auto(){ if(!AUTO_SIGNIN) return; try{ showLoader('Signing in…','Signing in admin account'); await auth.signInWithEmailAndPassword(ADMIN_EMAIL, ADMIN_PWD);}catch(e){alert('Auto sign-in failed: '+e.message);} finally{ hideLoader(); loadCompaniesToMenu(); } })();

/* ---------- Derived helpers from your app ---------- */
function readMaterialStockBags(mat){
  if(mat.stockBags !== undefined && mat.stockBags !== null) return Number(mat.stockBags) || 0;
  if(mat.stockKg !== undefined && mat.kgPerBag) {
    const bags = Number(mat.stockKg) / Number(mat.kgPerBag || 1);
    return Math.round(bags * 100) / 100;
  }
  return 0;
}
function getMaterialPricePerBag(mat){
  if(mat.pricePerBag !== undefined && mat.pricePerBag !== null) return Number(mat.pricePerBag) || null;
  const hist = lastEntries
    .filter(e => e.materialId === mat.id && e.pricePerBag)
    .sort((a,b)=>{
      const aT = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : (new Date(a.createdAt)).getTime();
      const bT = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : (new Date(b.createdAt)).getTime();
      return bT - aT;
    });
  if(hist.length) return Number(hist[0].pricePerBag) || null;
  return null;
}
function computeMaterialDerived(m){
  const bags = readMaterialStockBags(m);
  const pricePerBag = getMaterialPricePerBag(m) || null;
  const stockValue = (pricePerBag ? (bags * Number(pricePerBag)) : 0);
  const sales = lastEntries.filter(e => e.materialId === m.id && e.type === 'sale').reduce((acc, e) => acc + (Number(e.totalValue || 0)), 0);
  return { bags, pricePerBag, stockValue, sales };
}

/* ---------- Menu / company ---------- */
async function loadCompaniesToMenu(){
  const sel = document.getElementById('companySelect');
  sel.innerHTML = '';
  try{
    const snap = await db.collection('companies').orderBy('name').get();
    snap.forEach(doc=>{
      const o = document.createElement('option'); o.value = doc.id; o.textContent = doc.data().name; sel.appendChild(o);
    });
    if(sel.options.length === 0){ currentCompanyId = null; document.getElementById('mainCompanyName').textContent = 'No company'; renderEmptyDashboard(); return; }
    if(!currentCompanyId || !Array.from(sel.options).some(o => o.value === currentCompanyId)) currentCompanyId = sel.options[0].value;
    sel.value = currentCompanyId;
    document.getElementById('mainCompanyName').textContent = sel.options[sel.selectedIndex].textContent;
    startCompanyListeners(currentCompanyId);
  }catch(err){ alert('Failed to load companies: ' + err.message); console.error(err); }
}
document.getElementById('companySelect').addEventListener('change', ()=>{
  const sel = document.getElementById('companySelect');
  if(sel.value === currentCompanyId) return;
  currentCompanyId = sel.value;
  document.getElementById('mainCompanyName').textContent = sel.options[sel.selectedIndex].textContent;
  startCompanyListeners(currentCompanyId);
});

function clearListeners(){
  try{ if(typeof materialsUnsub === 'function') materialsUnsub(); }catch{}
  try{ if(typeof entriesUnsub === 'function') entriesUnsub(); }catch{}
  try{ if(typeof partiesUnsub === 'function') partiesUnsub(); }catch{}
  lastMaterials = []; lastEntries = []; lastParties = [];
}
function startCompanyListeners(companyId){
  if(!companyId) return;
  clearListeners();
  const compRef = db.collection('companies').doc(companyId);
  materialsUnsub = compRef.collection('materials').orderBy('name').onSnapshot(snap=>{
    lastMaterials = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMaterials(lastMaterials);
  });
  entriesUnsub = compRef.collection('entries').orderBy('createdAt','desc').limit(5000).onSnapshot(snap=>{
    lastEntries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if(document.getElementById('modalRoot').innerHTML.includes('History —')) renderHistory();
    if(document.getElementById('modalRoot').innerHTML.includes('Ledger —')) renderLedgerUI();
    renderMaterials(lastMaterials);
  });
  partiesUnsub = compRef.collection('parties').orderBy('name').onSnapshot(snap=>{
    lastParties = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if(document.getElementById('modalRoot').innerHTML.includes('Manage')) renderManageModal(); // refresh list
  });
  compRef.onSnapshot(doc => {
    const dd = doc.data();
    document.getElementById('lastUpdated').textContent = dd && dd.updatedAt ? fmtDate(dd.updatedAt) : '-';
  });
}

/* ---------- Dashboard ---------- */
function renderEmptyDashboard(){ document.getElementById('dashboardArea').innerHTML = '<div class="card tiny muted">No company selected / no data.</div>'; }
function renderMaterials(materials){
  const area = document.getElementById('dashboardArea'); area.innerHTML = '';

  // header
  const header = document.createElement('div'); header.className = 'card';
  header.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div><div style="font-weight:700">${document.getElementById('mainCompanyName').textContent}</div><div class="tiny muted">Stock overview (bags)</div></div>
      <div class="tiny muted">Materials: ${materials.length}</div>
    </div>`;
  area.appendChild(header);

  // grid
  const gridWrap = document.createElement('div'); gridWrap.className='card';
  const grid = document.createElement('div'); grid.className='materials';
  for(const m of materials){
    const d = computeMaterialDerived(m);
    const bags = d.bags; const price = d.pricePerBag; const stockValue = d.stockValue; const sales = d.sales;
    const div = document.createElement('div'); div.className='mat-card';
    div.innerHTML = `
      <div class="mat-name">${escapeHtml(m.name)}</div>
      <div class="mat-qty ${bags <= (m.lowStockBags||0) ? 'low' : ''}">${bags} bags</div>
      <div class="tiny muted" style="margin-top:6px">Low threshold: ${(m.lowStockBags||0)} bags</div>
      <div style="margin-top:8px" class="tiny muted">Kg per bag: ${m.kgPerBag || '—'}</div>
      <div style="margin-top:10px;display:flex;gap:8px;flex-direction:column">
        <div style="display:flex;gap:8px">
          <button class="btn" onclick="openQuickPurchase('${m.id}','${escapeHtml(m.name)}')">Add Purchase</button>
          <button class="btn warn" onclick="openQuickSale('${m.id}','${escapeHtml(m.name)}')">Add Sale</button>
          <button class="btn ghost" onclick="openMaterialEditorDialog('${m.id}')">Edit</button>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
          <div class="tiny muted">Price/bag: ${price ? toINR(price) : '-'}</div>
          <div class="tiny muted">Stock value: ${stockValue ? toINR(stockValue) : '-'}</div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
          <div class="tiny muted">Total sales: ${toINR(sales)}</div>
        </div>
      </div>`;
    grid.appendChild(div);
  }
  gridWrap.appendChild(grid);
  area.appendChild(gridWrap);

  // low stock
  const lows = materials.filter(m => (computeMaterialDerived(m).bags || 0) <= (m.lowStockBags || 0));
  if(lows.length){
    const lowCard = document.createElement('div'); lowCard.className = 'card';
    lowCard.innerHTML = `<div style="font-weight:700;color:var(--danger)">Low stock alert</div>`;
    for(const m of lows){
      const s = computeMaterialDerived(m).bags;
      const row = document.createElement('div'); row.style.marginTop='8px';
      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><strong>${escapeHtml(m.name)}</strong><div class="tiny muted">${s} bags left (threshold ${m.lowStockBags||0} bags)</div></div>
          <div><button class="btn" onclick="openQuickPurchase('${m.id}','${escapeHtml(m.name)}')">Restock</button></div>
        </div>`;
      lowCard.appendChild(row);
    }
    area.appendChild(lowCard);
  }

  // chart + reports
  const split = document.createElement('div'); split.className='card';
  split.innerHTML = `
    <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:1;min-width:320px;">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-weight:700">Stock value</div>
          <div class="tiny muted">₹ per material (current)</div>
        </div>
        <div class="chart-wrap" style="margin-top:10px"><canvas id="stockCanvas"></canvas></div>
        <div style="margin-top:12px;font-weight:700">Total inventory value: <span id="totalInventoryValue">—</span></div>
        <div class="chart-note">Note: Value = current stock × latest price/bag.</div>
      </div>
      <div style="width:360px;min-width:260px;">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-weight:700">Reports</div>
          <div class="tiny muted">Choose range</div>
        </div>
        <div style="margin-top:10px">
          <div style="display:flex;gap:8px;align-items:center;">
            <div style="flex:1"><label>From</label><input id="reportFrom" type="date" /></div>
            <div style="flex:1"><label>To</label><input id="reportTo" type="date" /></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button id="btnReportToday" class="btn ghost">Today</button>
            <button id="btnReportWeek" class="btn ghost">7 days</button>
            <button id="btnReportMonth" class="btn ghost">30 days</button>
            <button id="btnReportApply" class="btn">Apply</button>
          </div>
          <div id="reportsResult" style="margin-top:12px"></div>
        </div>
      </div>
    </div>`;
  area.appendChild(split);

  const labels = materials.map(m => m.name);
  const data = materials.map(m => { const d = computeMaterialDerived(m); return d.stockValue ? Math.round(d.stockValue * 100) / 100 : 0; });
  setTimeout(()=>{
    const ctx = document.getElementById('stockCanvas').getContext('2d');
    if(window._stockChart) window._stockChart.destroy();
    window._stockChart = new Chart(ctx, { type:'bar', data:{ labels, datasets:[{ label:'₹', data }] }, options:{ responsive:true, plugins:{legend:{display:false}}, scales:{ y:{ beginAtZero:true } } } });
  }, 20);
  const total = data.reduce((a,b)=>a+Number(b||0),0);
  cachedTotalInventoryValue = Math.round(total*100)/100;
  document.getElementById('totalInventoryValue').textContent = toINR(cachedTotalInventoryValue);

  const todayStr = localDateString();
  document.getElementById('reportFrom').value = todayStr;
  document.getElementById('reportTo').value = todayStr;
  document.getElementById('btnReportToday').onclick = ()=>{ const td = localDateString(); document.getElementById('reportFrom').value = td; document.getElementById('reportTo').value = td; renderReports(); };
  document.getElementById('btnReportWeek').onclick = ()=>{ const to = new Date(); const from = new Date(); from.setDate(from.getDate()-6); document.getElementById('reportFrom').value = localDateString(from); document.getElementById('reportTo').value = localDateString(to); renderReports(); };
  document.getElementById('btnReportMonth').onclick = ()=>{ const to = new Date(); const from = new Date(); from.setDate(from.getDate()-29); document.getElementById('reportFrom').value = localDateString(from); document.getElementById('reportTo').value = localDateString(to); renderReports(); };
  document.getElementById('btnReportApply').onclick = renderReports;
  renderReports();
}
function parseDateInput(val){ if(!val) return null; const parts = val.split('-').map(Number); if(parts.length!==3) return null; const [y,m,d]=parts; const t=new Date(y,m-1,d); t.setHours(0,0,0,0); return t; }
function entriesBetween(fromDate,toDate){
  if(!fromDate || !toDate) return [];
  const start = new Date(fromDate); start.setHours(0,0,0,0);
  const end = new Date(toDate); end.setHours(24,0,0,0);
  return lastEntries.filter(e => {
    if(!e.createdAt) return false;
    const t = e.createdAt.toDate ? e.createdAt.toDate() : new Date(e.createdAt);
    return t >= start && t < end;
  });
}
function renderReports(){
  const fromVal = document.getElementById('reportFrom').value;
  const toVal = document.getElementById('reportTo').value;
  const from = parseDateInput(fromVal);
  const to = parseDateInput(toVal);
  const container = document.getElementById('reportsResult');
  if(!from || !to){ container.innerHTML = '<div class="tiny muted">Select valid From/To dates</div>'; return; }
  const slice = entriesBetween(from,to);
  const purchases = slice.filter(e => e.type === 'purchase');
  const sales = slice.filter(e => e.type === 'sale');
  const sumBagsPurchased = purchases.reduce((s,e)=>s + Number(e.bags||0), 0);
  const sumValuePurchased = purchases.reduce((s,e)=>s + Number(e.totalValue||0), 0);
  const sumBagsSold = sales.reduce((s,e)=>s + Number(e.bags||0), 0);
  const sumValueSold = sales.reduce((s,e)=>s + Number(e.totalValue||0), 0);
  const costBasisSold = sales.reduce((s,e)=>s + Number(e.costTotal||0), 0);
  const profit = sumValueSold - costBasisSold;
  const profitPct = (sumValueSold > 0) ? (profit / sumValueSold * 100) : 0;
  const netBagsChange = sumBagsPurchased - sumBagsSold;
  const totalInv = cachedTotalInventoryValue;
  container.innerHTML = `
    <div style="font-weight:700;margin-bottom:6px">Report (${from.toLocaleDateString('en-IN')} → ${to.toLocaleDateString('en-IN')})</div>
    <div class="mini">Purchases: ${sumBagsPurchased} bags • ${toINR(sumValuePurchased)}</div>
    <div class="mini">Sales: ${sumBagsSold} bags • ${toINR(sumValueSold)}</div>
    <div class="mini">Cost basis of sold items: ${toINR(costBasisSold)}</div>
    <div style="margin-top:6px;font-weight:700">Profit: ${toINR(profit)} ${profitPct ? '(' + profitPct.toFixed(2) + '%)' : ''}</div>
    <div class="mini" style="margin-top:8px">Net stock change: ${netBagsChange} bags</div>
    <div class="mini" style="margin-top:8px">Total inventory value (now): ${toINR(totalInv)}</div>`;
}

/* ---------- Modal helpers ---------- */
function showModal(html){
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-backdrop" id="modalBackdrop"><div class="modal">${html}</div></div>`;
  document.getElementById('modalBackdrop').addEventListener('click',(e)=>{ if(e.target.id==='modalBackdrop') closeModal(); });
}
function closeModal(){ document.getElementById('modalRoot').innerHTML = ''; }

/* ---------- Voucher sequence (per FY) ---------- */
async function nextVoucherNo(companyId){
  const fy = fyForDate(new Date());
  const seqRef = db.collection('companies').doc(companyId).collection('sequences').doc(`voucher_${fy}`);
  let nextNo = 1;
  await db.runTransaction(async tx=>{
    const snap = await tx.get(seqRef);
    if(!snap.exists) tx.set(seqRef, { seq: 2, fy });
    else { const val = Number(snap.data().seq || 1); nextNo = val; tx.update(seqRef, { seq: val+1 }); }
  });
  return `${fy}/${String(nextNo).padStart(5,'0')}`;
}

/* ---------- Add entries (purchase/sale) with cost basis ---------- */
async function addEntryBags(materialId, type, bagsCount, pricePerBag, partyIdOrName, note, customDate){
  if(!currentCompanyId) return alert('Select a company first');
  if(!materialId || bagsCount <= 0) return alert('Invalid input');
  const companyRef = db.collection('companies').doc(currentCompanyId);
  const matRef = companyRef.collection('materials').doc(materialId);
  const entriesRef = companyRef.collection('entries');
  const partiesRef = companyRef.collection('parties');

  showLoader(type==='purchase' ? 'Saving purchase…' : 'Saving sale…', 'Saving to remote database');
  try{
    // resolve/create party
    let partyId = '';
    let partyName = (partyIdOrName||'').trim();
    if(partyName){
      const norm = normalizeName(partyName);
      const q = await partiesRef.where('name_lower','==',norm).limit(1).get();
      if(q.empty){
        const nd = await partiesRef.add({ name: partyName, name_lower: norm, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        partyId = nd.id;
      } else {
        partyId = q.docs[0].id;
        partyName = q.docs[0].data().name;
      }
    }

    const voucherNo = await nextVoucherNo(currentCompanyId);
    await db.runTransaction(async tx=>{
      const matSnap = await tx.get(matRef);
      if(!matSnap.exists) throw new Error('Material not found');
      const mat = matSnap.data();
      const currentStock = (mat.stockBags !== undefined && mat.stockBags !== null) ? Number(mat.stockBags || 0) : (mat.stockKg && mat.kgPerBag ? (Number(mat.stockKg) / Number(mat.kgPerBag || 1)) : 0);
      const currentAvg = (mat.pricePerBag !== undefined && mat.pricePerBag !== null) ? Number(mat.pricePerBag) : null;

      const entryRef = entriesRef.doc();
      const totalValue = Number(bagsCount) * (pricePerBag ? Number(pricePerBag) : 0);
      const createdAt = customDate ? new Date(customDate) : firebase.firestore.FieldValue.serverTimestamp();

      if(type === 'purchase'){
        let newAvg = currentAvg;
        if(currentStock <= 0 || currentAvg === null){
          if(pricePerBag !== null) newAvg = pricePerBag;
        } else {
          if(pricePerBag !== null){
            const numerator = (currentStock * currentAvg) + (bagsCount * pricePerBag);
            const denominator = (currentStock + bagsCount);
            newAvg = denominator > 0 ? (numerator / denominator) : currentAvg;
          }
        }
        const newStock = currentStock + bagsCount;
        tx.set(entryRef, {
          voucherNo, type, materialId, bags: bagsCount, unit: 'bags', pricePerBag: pricePerBag || null,
          totalValue: totalValue || 0, partyId: partyId || '', partyName: partyName || '', note: note || '',
          createdAt, createdBy: (auth.currentUser && auth.currentUser.uid) || null
        });
        tx.update(matRef, { stockBags: Math.round(newStock*100)/100, pricePerBag: (newAvg !== null ? Math.round(newAvg*100)/100 : null), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      } else if(type === 'sale'){
        const costPerBag = (currentAvg !== null) ? currentAvg : 0;
        const costTotal = bagsCount * costPerBag;
        const newStock = currentStock - bagsCount;
        if(newStock < -0.0001) throw new Error('Not enough stock for this sale');
        tx.set(entryRef, {
          voucherNo, type, materialId, bags: bagsCount, unit: 'bags', pricePerBag: pricePerBag || null,
          totalValue: totalValue || 0, partyId: partyId || '', partyName: partyName || '', note: note || '',
          costPerBag: Math.round(costPerBag*100)/100, costTotal: Math.round(costTotal*100)/100,
          createdAt, createdBy: (auth.currentUser && auth.currentUser.uid) || null
        });
        tx.update(matRef, { stockBags: Math.round(newStock*100)/100, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      } else { throw new Error('Unknown entry type'); }
      tx.update(companyRef, { updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    });
  }catch(err){ alert('Save failed: ' + err.message); console.error(err); } finally { hideLoader(); }
}

/* ---------- Rebuild material from entries (safe after edit/delete) ---------- */
async function rebuildMaterialFromEntries(materialId){
  if(!currentCompanyId || !materialId) return;
  const companyRef = db.collection('companies').doc(currentCompanyId);
  const matsRef = companyRef.collection('materials').doc(materialId);
  const entriesRef = companyRef.collection('entries');
  showLoader('Rebuilding material…','Reconciling stock & avg price');
  try{
    const snap = await entriesRef.where('materialId','==',materialId).orderBy('createdAt','asc').get();
    let stock = 0; let avg = null;
    const batch = db.batch();
    for(const doc of snap.docs){
      const e = doc.data(); const id = doc.id;
      const bags = Number(e.bags || 0);
      const price = (e.pricePerBag !== undefined && e.pricePerBag !== null) ? Number(e.pricePerBag) : null;
      if(e.type === 'purchase'){
        if(stock <= 0 || avg === null){ if(price !== null) avg = price; }
        else { if(price !== null){ const numerator = (stock * avg) + (bags * price); const denominator = (stock + bags); avg = denominator > 0 ? (numerator / denominator) : avg; } }
        stock += bags;
        const totalValue = bags * (price || 0);
        batch.update(entriesRef.doc(id), { totalValue: totalValue || 0, pricePerBag: price || null });
      } else if(e.type === 'sale'){
        const costPerBag = (avg !== null) ? avg : 0;
        const costTotal = bags * costPerBag;
        batch.update(entriesRef.doc(id), { costPerBag: costPerBag || 0, costTotal: costTotal || 0, pricePerBag: e.pricePerBag || null, totalValue: (Number(e.totalValue) || (bags*(e.pricePerBag||0))) });
        stock -= bags;
      }
    }
    if(!snap.empty) await batch.commit();
    const matPatch = { stockBags: Math.round(stock * 100) / 100, pricePerBag: (avg !== null ? Math.round(avg * 100) / 100 : null), updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    await matsRef.update(matPatch);
  }catch(err){ console.error('rebuildMaterialFromEntries failed', err); } finally { hideLoader(); }
}

/* ---------- QUICK PURCHASE / SALE ---------- */
function openQuickPurchase(materialId, materialName){
  showModal(`
    <div style="font-weight:700">Add Purchase — ${escapeHtml(materialName)}</div><hr>
    <label>Number of bags</label><input id="pq_bags" type="number" min="0.01" step="0.01" placeholder="e.g. 6" />
    <label>Price per bag</label><input id="pq_price" type="number" step="0.01" placeholder="e.g. 1380" />
    <label>Bought from (Party)</label><input id="pq_party" placeholder="Supplier name / place" />
    <label>Date</label><input id="pq_date" type="date" value="${localDateString()}"/>
    <label>Note</label><input id="pq_note" />
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
      <button class="btn ghost" id="pq_cancel">Cancel</button>
      <button class="btn" id="pq_save">Confirm & Save</button>
    </div>`);
  document.getElementById('pq_cancel').onclick = closeModal;
  document.getElementById('pq_save').onclick = async ()=>{
    const bags = Number(document.getElementById('pq_bags').value);
    const price = document.getElementById('pq_price').value ? Number(document.getElementById('pq_price').value) : null;
    const party = document.getElementById('pq_party').value || '';
    const note = document.getElementById('pq_note').value || '';
    const date = document.getElementById('pq_date').value || null;
    await addEntryBags(materialId,'purchase',bags,price,party,note,date);
    closeModal();
  };
}
function openQuickSale(materialId, materialName){
  showModal(`
    <div style="font-weight:700">Add Sale — ${escapeHtml(materialName)}</div><hr>
    <label>Number of bags</label><input id="ps_bags" type="number" min="0.01" step="0.01" placeholder="e.g. 2" />
    <label>Price per bag</label><input id="ps_price" type="number" step="0.01" placeholder="e.g. 1500" />
    <label>Sold to (Party)</label><input id="ps_party" placeholder="Customer name / place" />
    <label>Date</label><input id="ps_date" type="date" value="${localDateString()}"/>
    <label>Note</label><input id="ps_note" />
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
      <button class="btn ghost" id="ps_cancel">Cancel</button>
      <button class="btn warn" id="ps_save">Confirm & Save</button>
    </div>`);
  document.getElementById('ps_cancel').onclick = closeModal;
  document.getElementById('ps_save').onclick = async ()=>{
    const bags = Number(document.getElementById('ps_bags').value);
    const price = document.getElementById('ps_price').value ? Number(document.getElementById('ps_price').value) : null;
    const party = document.getElementById('ps_party').value || '';
    const note = document.getElementById('ps_note').value || '';
    const date = document.getElementById('ps_date').value || null;
    await addEntryBags(materialId,'sale',bags,price,party,note,date);
    closeModal();
  };
}

/* ---------- Master data (companies/materials/parties) ---------- */
function openManageModal(){
  showModal(`
    <div style="font-weight:700">Manage (Companies / Materials / Parties)</div><hr>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:260px">
        <label>Companies</label><div id="mg_companies"></div>
        <div style="display:flex;gap:8px;margin-top:8px"><input id="mg_newCompany" placeholder="New company name" /><button class="btn" id="mg_addCompany">Add</button></div>
      </div>
      <div style="flex:1;min-width:260px">
        <label>Materials (selected company)</label><div id="mg_materials"></div>
        <div style="display:flex;gap:8px;margin-top:8px"><input id="mg_newMaterial" placeholder="Material name" /><button class="btn" id="mg_addMaterial">Add</button></div>
      </div>
      <div style="flex:1;min-width:260px">
        <label>Parties (selected company)</label><div id="mg_parties"></div>
        <div style="display:flex;gap:8px;margin-top:8px"><input id="mg_newParty" placeholder="Party name" /><button class="btn" id="mg_addParty">Add</button></div>
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn ghost" id="mg_close">Close</button></div>`);
  document.getElementById('mg_close').onclick = closeModal;
  document.getElementById('mg_addCompany').onclick = addCompanyFromModal;
  document.getElementById('mg_addMaterial').onclick = addMaterialFromModal;
  document.getElementById('mg_addParty').onclick = addPartyFromModal;
  renderManageCompanies(); renderManageMaterials(); renderManageParties();
}
async function renderManageCompanies(){
  const el = document.getElementById('mg_companies'); if(!el) return; el.innerHTML = '';
  try{
    const snap = await db.collection('companies').orderBy('name').get();
    snap.forEach(doc=>{
      const d = doc.data();
      const wrap = document.createElement('div'); wrap.style.display='flex'; wrap.style.justifyContent='space-between'; wrap.style.padding='8px'; wrap.style.border='1px solid #f1f5f7'; wrap.style.marginBottom='6px'; wrap.style.borderRadius='8px';
      wrap.innerHTML = `<div><strong>${escapeHtml(d.name)}</strong><div class="tiny muted">${d.createdAt ? fmtDate(d.createdAt) : ''}</div></div>`;
      const r = document.createElement('div');
      const selectBtn = document.createElement('button'); selectBtn.className='btn ghost'; selectBtn.textContent='Select';
      selectBtn.onclick = async ()=>{
        currentCompanyId = doc.id;
        const sel = document.getElementById('companySelect');
        await loadCompaniesToMenu();
        renderManageMaterials(); renderManageParties();
      };
      const del = document.createElement('button'); del.className='btn danger'; del.style.marginLeft='6px'; del.textContent='Delete';
      del.onclick = async ()=>{
        if(!confirm('Delete company and all its materials & entries? This is irreversible.')) return;
        showLoader('Deleting company…','Deleting all documents for the company');
        try{
          const matSnap = await db.collection('companies').doc(doc.id).collection('materials').get();
          const entSnap = await db.collection('companies').doc(doc.id).collection('entries').get();
          const parSnap = await db.collection('companies').doc(doc.id).collection('parties').get();
          const seqSnap = await db.collection('companies').doc(doc.id).collection('sequences').get();
          const batch = db.batch();
          matSnap.forEach(m => batch.delete(m.ref));
          entSnap.forEach(e => batch.delete(e.ref));
          parSnap.forEach(p => batch.delete(p.ref));
          seqSnap.forEach(s => batch.delete(s.ref));
          batch.delete(db.collection('companies').doc(doc.id));
          await batch.commit();
          await loadCompaniesToMenu(); renderManageCompanies(); renderManageMaterials(); renderManageParties();
        }catch(err){ alert('Delete failed: ' + err.message); } finally { hideLoader(); }
      };
      r.appendChild(selectBtn); r.appendChild(del); wrap.appendChild(r); el.appendChild(wrap);
    });
  }catch(err){ el.innerHTML = `<div class="tiny muted">Failed to load companies: ${err.message}</div>`; }
}
async function renderManageMaterials(){
  const el = document.getElementById('mg_materials'); if(!el) return; el.innerHTML = '';
  if(!currentCompanyId){ el.innerHTML = '<div class="tiny muted">Select a company first (menu)</div>'; return; }
  const matSnap = await db.collection('companies').doc(currentCompanyId).collection('materials').orderBy('name').get();
  matSnap.forEach(doc=>{
    const d = doc.data();
    const wrap = document.createElement('div'); wrap.style.padding='8px'; wrap.style.border='1px solid #f1f5f7'; wrap.style.marginBottom='6px'; wrap.style.borderRadius='8px';
    wrap.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center">
      <div><strong>${escapeHtml(d.name)}</strong><div class="tiny muted">Stock: ${readMaterialStockBags(d)} bags • Low: ${d.lowStockBags||0}</div></div>
      <div style="display:flex;gap:6px">
        <button class="btn ghost" onclick='openMaterialEditorDialog("${doc.id}")'>Edit</button>
        <button class="btn danger" onclick='deleteMaterial("${doc.id}")'>Delete</button></div></div>`;
    el.appendChild(wrap);
  });
}
async function addCompanyFromModal(){
  const name = document.getElementById('mg_newCompany').value.trim(); if(!name) return alert('Enter name');
  const nameNorm = normalizeName(name);
  showLoader('Creating company…','Writing to remote DB');
  try{
    const existing = await db.collection('companies').where('name_lower','==',nameNorm).get();
    if(!existing.empty){ hideLoader(); return alert('A company with the same name already exists.'); }
    const docRef = db.collection('companies').doc();
    await docRef.set({ name, name_lower: nameNorm, stockCurrency: 'INR', createdAt: firebase.firestore.FieldValue.serverTimestamp(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    document.getElementById('mg_newCompany').value = '';
    await loadCompaniesToMenu(); await renderManageCompanies();
  }catch(err){ alert('Create failed: ' + err.message); console.error(err); } finally { hideLoader(); }
}
async function addMaterialFromModal(){
  if(!currentCompanyId) return alert('Select company first');
  const name = document.getElementById('mg_newMaterial').value.trim(); if(!name) return alert('Enter material name');
  const nameNorm = normalizeName(name);
  showLoader('Creating material…','Writing to remote DB');
  try{
    const matsRef = db.collection('companies').doc(currentCompanyId).collection('materials');
    const existing = await matsRef.where('name_lower','==',nameNorm).get();
    if(!existing.empty){ hideLoader(); return alert('A material with the same name already exists for this company.'); }
    const matRef = matsRef.doc();
    await matRef.set({ name, name_lower: nameNorm, stockBags: 0, lowStockBags: 1, kgPerBag: 50, pricePerBag: null, createdAt: firebase.firestore.FieldValue.serverTimestamp(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    document.getElementById('mg_newMaterial').value = '';
    await renderManageMaterials(); await loadCompaniesToMenu();
  }catch(err){ alert('Create material failed: ' + err.message); console.error(err); } finally { hideLoader(); }
}
async function renderManageParties(){
  const el = document.getElementById('mg_parties'); if(!el) return; el.innerHTML = '';
  if(!currentCompanyId){ el.innerHTML = '<div class="tiny muted">Select a company first</div>'; return; }
  const snap = await db.collection('companies').doc(currentCompanyId).collection('parties').orderBy('name').get();
  snap.forEach(doc=>{
    const d = doc.data();
    const wrap = document.createElement('div'); wrap.style.padding='8px'; wrap.style.border='1px solid #f1f5f7'; wrap.style.marginBottom='6px'; wrap.style.borderRadius='8px';
    wrap.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center">
      <div><strong>${escapeHtml(d.name)}</strong><div class="tiny muted">${d.phone || ''} ${d.gst || ''}</div></div>
      <div style="display:flex;gap:6px">
        <button class="btn ghost" onclick='openPartyEditor("${doc.id}")'>Edit</button>
        <button class="btn danger" onclick='deleteParty("${doc.id}")'>Delete</button></div></div>`;
    el.appendChild(wrap);
  });
}
async function addPartyFromModal(){
  if(!currentCompanyId) return alert('Select company first');
  const name = document.getElementById('mg_newParty').value.trim(); if(!name) return alert('Enter party name');
  const nameNorm = normalizeName(name);
  showLoader('Creating party…','Writing to remote DB');
  try{
    const partiesRef = db.collection('companies').doc(currentCompanyId).collection('parties');
    const existing = await partiesRef.where('name_lower','==',nameNorm).get();
    if(!existing.empty){ hideLoader(); return alert('A party with the same name already exists.'); }
    await partiesRef.add({ name, name_lower: nameNorm, phone:'', gst:'', address:'', createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    (document.getElementById('mg_newParty').value = '');
    await renderManageParties();
  }catch(err){ alert('Create party failed: ' + err.message); console.error(err); } finally { hideLoader(); }
}
async function openPartyEditor(partyId){
  const ref = db.collection('companies').doc(currentCompanyId).collection('parties').doc(partyId);
  const snap = await ref.get(); if(!snap.exists) return alert('Party not found');
  const p = snap.data();
  showModal(`
    <div style="font-weight:700">Edit party — ${escapeHtml(p.name)}</div><hr>
    <label>Name</label><input id="pe_name" value="${escapeHtml(p.name)}"/>
    <label>Phone</label><input id="pe_phone" value="${escapeHtml(p.phone||'')}"/>
    <label>GSTIN</label><input id="pe_gst" value="${escapeHtml(p.gst||'')}"/>
    <label>Address</label><textarea id="pe_addr">${escapeHtml(p.address||'')}</textarea>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
      <button class="btn ghost" id="pe_cancel">Cancel</button>
      <button class="btn" id="pe_save">Save</button></div>`);
  document.getElementById('pe_cancel').onclick = closeModal;
  document.getElementById('pe_save').onclick = async ()=>{
    const name = document.getElementById('pe_name').value.trim();
    const phone = document.getElementById('pe_phone').value.trim();
    const gst = document.getElementById('pe_gst').value.trim();
    const address = document.getElementById('pe_addr').value.trim();
    if(!name) return alert('Name required');
    await ref.update({ name, name_lower: normalizeName(name), phone, gst, address, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    closeModal();
  };
}
async function deleteParty(partyId){
  if(!confirm('Delete this party? Entries will remain but party link will be blank.')) return;
  const ref = db.collection('companies').doc(currentCompanyId).collection('parties').doc(partyId);
  await ref.delete();
}

/* ---------- History (existing) with Edit/Delete ---------- */
function openHistoryModal(){
  if(!currentCompanyId) return alert('Select a company first in the admin menu');
  showModal(`
    <div style="font-weight:700">History — ${document.getElementById('mainCompanyName').textContent}</div>
    <hr>
    <div id="historyContainer" style="max-height:70vh;overflow:auto"></div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn ghost" id="h_close">Close</button></div>`);
  document.getElementById('h_close').onclick = closeModal;
  renderHistory();
}
function renderHistory(){
  const container = document.getElementById('historyContainer'); if(!container) return;
  const grouped = {};
  lastEntries.forEach(e=>{
    const d = e.createdAt ? (e.createdAt.toDate ? e.createdAt.toDate() : new Date(e.createdAt)) : new Date();
    const key = dateOnly(d).toISOString();
    if(!grouped[key]) grouped[key] = [];
    grouped[key].push(e);
  });
  const sortedDates = Object.keys(grouped).sort((a,b)=> new Date(b) - new Date(a));
  let html = '';
  if(sortedDates.length === 0) html = `<div class="tiny muted">No entries yet</div>`;
  else {
    for(const dateKey of sortedDates){
      const dayEntries = grouped[dateKey];
      const prettyDate = new Date(dateKey).toLocaleDateString('en-IN',{weekday:'short', day:'numeric', month:'short', year:'numeric'});
      html += `<div class="ledger-day"><div style="font-weight:700;margin-bottom:8px">${prettyDate}</div>`;
      dayEntries.forEach(e=>{
        const mat = lastMaterials.find(m => m.id === e.materialId);
        const matName = mat ? mat.name : e.materialId;
        const isPurchase = (e.type === 'purchase');
        html += `
          <div class="entry-card">
            <div class="entry-left">
              <div class="${isPurchase ? 'badge-purchase' : 'badge-sale'}">${isPurchase ? 'Purchase' : 'Sale'}</div>
              <div style="min-width:200px">
                <div style="font-weight:700">${escapeHtml(matName)}</div>
                <div class="mini">${Number(e.bags||0)} bags • ${e.pricePerBag ? toINR(e.pricePerBag) + ' /bag' : '—'} • ${toINR(e.totalValue||0)}</div>
                <div class="mini">${isPurchase ? 'Bought from: ' : 'Sold to: '} ${escapeHtml(e.partyName || e.party || '—')}</div>
                ${!isPurchase ? `<div class="mini">Cost basis: ${toINR(e.costPerBag||0) + ' /bag (' + toINR(e.costTotal||0) + ')'}</div>` : ''}
                <div class="mini">${escapeHtml(e.note||'')}</div>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
              <div class="mini">${fmtDate(e.createdAt)}</div>
              <div class="mini">Voucher: ${escapeHtml(e.voucherNo||'—')}</div>
              <div style="display:flex;gap:6px">
                <button class="btn ghost" onclick="openEditEntryDialog('${e.id}')">Edit</button>
                <button class="btn danger" onclick="deleteEntry('${e.id}')">Delete</button>
              </div>
            </div>
          </div>`;
      });
      html += `</div>`;
    }
  }
  container.innerHTML = html;
}
async function openEditEntryDialog(entryId){
  const entryRef = db.collection('companies').doc(currentCompanyId).collection('entries').doc(entryId);
  const eDoc = await entryRef.get();
  if(!eDoc.exists) return alert('Entry not found');
  const e = eDoc.data();
  const matOptions = lastMaterials.map(m => `<option value="${m.id}" ${m.id === e.materialId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('');
  const partyOptions = ['','__keep__', ...lastParties.map(p=>p.name)].map(name => {
    const sel = (name && name === e.partyName) ? 'selected' : '';
    const label = (name==='__keep__') ? '(keep same)' : escapeHtml(name);
    const val = (name==='__keep__') ? e.partyName : name;
    return `<option value="${escapeHtml(val||'')} ${sel}">${label}</option>`;
  }).join('');
  const createdDate = e.createdAt ? (e.createdAt.toDate ? localDateString(e.createdAt.toDate()) : localDateString(new Date(e.createdAt))) : localDateString();
  showModal(`
    <div style="font-weight:700">Edit entry</div><hr>
    <label>Type</label><select id="ee_type"><option value="purchase">Purchase</option><option value="sale">Sale</option></select>
    <label>Material</label><select id="ee_mat">${matOptions}</select>
    <label>Number of bags</label><input id="ee_bags" type="number" value="${e.bags || 0}" />
    <label>Price per bag</label><input id="ee_price" type="number" step="0.01" value="${e.pricePerBag||''}" />
    <label>Party</label><input id="ee_party" value="${escapeHtml(e.partyName||e.party||'')}"/>
    <label>Date</label><input id="ee_date" type="date" value="${createdDate}"/>
    <label>Note</label><input id="ee_note" value="${escapeHtml(e.note||'')}" />
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn ghost" id="ee_cancel">Cancel</button><button class="btn" id="ee_save">Save</button></div>`);
  document.getElementById('ee_type').value = e.type;
  document.getElementById('ee_cancel').onclick = closeModal;
  document.getElementById('ee_save').onclick = async ()=>{
    const newType = document.getElementById('ee_type').value;
    const newMatId = document.getElementById('ee_mat').value;
    const newBags = Number(document.getElementById('ee_bags').value);
    const newPrice = document.getElementById('ee_price').value ? Number(document.getElementById('ee_price').value) : null;
    const newParty = document.getElementById('ee_party').value || '';
    const newDate = document.getElementById('ee_date').value || null;
    const newNote = document.getElementById('ee_note').value || '';
    if(newBags <= 0) return alert('Invalid number of bags');
    showLoader('Updating entry…','Applying changes to remote DB');
    try{
      await entryRef.update({
        type: newType, materialId: newMatId, bags: newBags, pricePerBag: newPrice || null,
        partyName: newParty, note: newNote || '', createdAt: newDate ? new Date(newDate) : firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await rebuildMaterialFromEntries(newMatId);
      if(newMatId !== e.materialId) await rebuildMaterialFromEntries(e.materialId);
      alert('Entry updated'); closeModal();
    }catch(err){ alert('Update failed: ' + err.message); console.error(err); } finally { hideLoader(); }
  };
}
async function deleteEntry(entryId){
  if(!confirm('Delete this entry? This will adjust the material stock accordingly.')) return;
  showLoader('Deleting entry…','Adjusting stock and removing entry');
  try{
    const entryRef = db.collection('companies').doc(currentCompanyId).collection('entries').doc(entryId);
    const edoc = await entryRef.get();
    if(!edoc.exists) throw new Error('Entry not found');
    const e = edoc.data();
    await entryRef.delete();
    await rebuildMaterialFromEntries(e.materialId);
    alert('Deleted and stock adjusted');
  }catch(err){ alert('Delete failed: ' + err.message); console.error(err); } finally { hideLoader(); }
}

/* ---------- Ledger (Tally-style) ---------- */
function openLedgerModal(){
  if(!currentCompanyId) return alert('Select a company first');
  showModal(`
    <div style="font-weight:700">Ledger — ${document.getElementById('mainCompanyName').textContent}</div>
    <hr>
    <div id="ledgerFilters" class="search-grid">
      <div><label>From</label><input id="lg_from" type="date" value="${localDateString(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}"/></div>
      <div><label>To</label><input id="lg_to" type="date" value="${localDateString()}"/></div>
      <div><label>Type</label><select id="lg_type"><option value="">All</option><option value="purchase">Purchase</option><option value="sale">Sale</option></select></div>
      <div><label>Material</label><select id="lg_mat"><option value="">All</option>${lastMaterials.map(m=>`<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}</select></div>
      <div><label>Party</label><input id="lg_party" placeholder="Name contains"/></div>
      <div><label>Keyword</label><input id="lg_kw" placeholder="Note / voucher"/></div>
    </div>
    <div class="search-actions" style="margin-top:10px">
      <button class="btn ghost" id="lg_today">Today</button>
      <button class="btn ghost" id="lg_week">7 days</button>
      <button class="btn ghost" id="lg_month">30 days</button>
      <button class="btn" id="lg_apply">Apply</button>
      <button class="btn ghost" id="lg_print">Print</button>
      <button class="btn ghost" id="lg_export">Export CSV</button>
    </div>
    <div id="ledgerArea" style="margin-top:12px"></div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn ghost" id="lg_close">Close</button></div>`);
  document.getElementById('lg_close').onclick = closeModal;
  document.getElementById('lg_today').onclick = ()=>{ const td = localDateString(); document.getElementById('lg_from').value = td; document.getElementById('lg_to').value = td; renderLedgerUI(); };
  document.getElementById('lg_week').onclick = ()=>{ const to = new Date(); const from = new Date(); from.setDate(from.getDate()-6); document.getElementById('lg_from').value = localDateString(from); document.getElementById('lg_to').value = localDateString(to); renderLedgerUI(); };
  document.getElementById('lg_month').onclick = ()=>{ const to = new Date(); const from = new Date(); from.setDate(from.getDate()-29); document.getElementById('lg_from').value = localDateString(from); document.getElementById('lg_to').value = localDateString(to); renderLedgerUI(); };
  document.getElementById('lg_apply').onclick = renderLedgerUI;
  document.getElementById('lg_print').onclick = ()=>{ const w = window.open('', '_blank'); w.document.write(`<pre>${document.getElementById('ledgerArea').innerHTML}</pre>`); w.document.close(); w.focus(); w.print(); };
  document.getElementById('lg_export').onclick = exportLedgerCSV;
  renderLedgerUI();
}
function renderLedgerUI(){
  const area = document.getElementById('ledgerArea'); if(!area) return;
  const from = parseDateInput(document.getElementById('lg_from').value);
  const to = parseDateInput(document.getElementById('lg_to').value);
  const ty = document.getElementById('lg_type').value;
  const mat = document.getElementById('lg_mat').value;
  const partyQ = normalizeName(document.getElementById('lg_party').value);
  const kw = normalizeName(document.getElementById('lg_kw').value);

  const entries = lastEntries
    .filter(e=>{
      const t = e.createdAt ? (e.createdAt.toDate ? e.createdAt.toDate() : new Date(e.createdAt)) : new Date();
      if(from && t < dateOnly(from)) return false;
      if(to && t >= new Date(dateOnly(to).getTime()+24*3600*1000)) return false;
      if(ty && e.type !== ty) return false;
      if(mat && e.materialId !== mat) return false;
      if(partyQ && !normalizeName(e.partyName || e.party || '').includes(partyQ)) return false;
      if(kw){
        const blob = `${e.voucherNo||''} ${e.note||''}`.toLowerCase();
        if(!blob.includes(kw)) return false;
      }
      return true;
    })
    .sort((a,b)=>{
      const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : (new Date(a.createdAt)).getTime();
      const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : (new Date(b.createdAt)).getTime();
      return ta - tb;
    });

  // running balance per party (Sales => Debit from customer, Purchase => Credit to supplier) — simple convention
  const partyBal = {};
  function applyBalance(e){
    const name = e.partyName || e.party || '—';
    if(!partyBal[name]) partyBal[name] = 0;
    const amt = Number(e.totalValue || 0);
    if(e.type === 'sale') partyBal[name] += amt; // receivable
    if(e.type === 'purchase') partyBal[name] -= amt; // payable
    return partyBal[name];
  }

  let html = `<table class="ledger-table">
    <thead><tr>
      <th>Date</th><th>Voucher</th><th>Type</th><th>Party</th><th>Material</th>
      <th>Bags</th><th>Rate</th><th>Amount</th><th>Cost (sales)</th><th>Balance (party)</th><th>Actions</th>
    </tr></thead><tbody>`;
  let totalAmt = 0, totalCost=0;
  for(const e of entries){
    const mat = lastMaterials.find(m=>m.id===e.materialId);
    const bal = applyBalance(e);
    totalAmt += Number(e.totalValue||0);
    totalCost += Number(e.costTotal||0);
    html += `<tr>
      <td>${fmtDate(e.createdAt)}</td>
      <td>${escapeHtml(e.voucherNo||'')}</td>
      <td>${e.type}</td>
      <td>${escapeHtml(e.partyName || e.party || '—')}</td>
      <td>${escapeHtml(mat ? mat.name : e.materialId)}</td>
      <td>${Number(e.bags||0)}</td>
      <td>${e.pricePerBag?toINR(e.pricePerBag):'-'}</td>
      <td>${toINR(e.totalValue||0)}</td>
      <td>${e.type==='sale'?toINR(e.costTotal||0):'-'}</td>
      <td>${toINR(bal)}</td>
      <td>
        <button class="btn ghost" onclick="openEditEntryDialog('${e.id}')">Edit</button>
        <button class="btn danger" onclick="deleteEntry('${e.id}')">Delete</button>
      </td>
    </tr>`;
  }
  html += `</tbody>
    <tfoot><tr>
      <th colspan="7" style="text-align:right">Totals</th>
      <th>${toINR(totalAmt)}</th>
      <th>${toINR(totalCost)}</th>
      <th colspan="2"></th>
    </tr></tfoot></table>`;
  area.innerHTML = html;
}
async function exportLedgerCSV(){
  if(!currentCompanyId) return;
  const from = parseDateInput(document.getElementById('lg_from').value);
  const to = parseDateInput(document.getElementById('lg_to').value);
  const ty = document.getElementById('lg_type').value;
  const mat = document.getElementById('lg_mat').value;
  const partyQ = normalizeName(document.getElementById('lg_party').value);
  const kw = normalizeName(document.getElementById('lg_kw').value);
  const entries = lastEntries.filter(e=>{
    const t = e.createdAt ? (e.createdAt.toDate ? e.createdAt.toDate() : new Date(e.createdAt)) : new Date();
    if(from && t < dateOnly(from)) return false;
    if(to && t >= new Date(dateOnly(to).getTime()+24*3600*1000)) return false;
    if(ty && e.type !== ty) return false;
    if(mat && e.materialId !== mat) return false;
    if(partyQ && !normalizeName(e.partyName || e.party || '').includes(partyQ)) return false;
    if(kw){ const blob = `${e.voucherNo||''} ${e.note||''}`.toLowerCase(); if(!blob.includes(kw)) return false; }
    return true;
  }).sort((a,b)=> (a.createdAt?.toMillis?.()||0) - (b.createdAt?.toMillis?.()||0) );
  const rows = [['Date','Voucher','Type','Party','Material','Bags','Rate','Amount','CostTotal','Note']];
  for(const e of entries){
    const matDoc = lastMaterials.find(m=>m.id===e.materialId);
    rows.push([
      e.createdAt ? (e.createdAt.toDate ? e.createdAt.toDate().toLocaleString('en-IN') : e.createdAt) : '',
      e.voucherNo||'', e.type, e.partyName || e.party || '',
      matDoc ? matDoc.name : e.materialId, e.bags||'', e.pricePerBag||'', e.totalValue||'', e.costTotal||'', (e.note||'').replace(/\r?\n|\r/g,' ')
    ]);
  }
  const csv = rows.map(r => r.map(cell => {
    if(cell === null || cell === undefined) return '';
    const s = String(cell);
    if(s.includes('"')) return `"${s.replace(/"/g,'""')}"`;
    if(s.includes(',') || s.includes('\n')) return `"${s}"`;
    return s;
  }).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ledger_export.csv'; document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- Material editor ---------- */
async function openMaterialEditorDialog(materialId){
  const matDoc = await db.collection('companies').doc(currentCompanyId).collection('materials').doc(materialId).get();
  if(!matDoc.exists) return alert('Material not found');
  const m = matDoc.data();
  showModal(`
    <div style="font-weight:700">Edit material — ${escapeHtml(m.name)}</div><hr>
    <label>Name</label><input id="me_name" value="${escapeHtml(m.name)}" />
    <label>Low stock threshold (bags)</label><input id="me_low" type="number" value="${m.lowStockBags||0}" />
    <label>Kg per bag (reference)</label><input id="me_kgperbag" type="number" value="${m.kgPerBag||50}" />
    <label>Default price per bag (optional)</label><input id="me_price" type="number" step="0.01" value="${m.pricePerBag||''}" />
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn ghost" id="me_cancel">Cancel</button><button class="btn" id="me_save">Save</button></div>`);
  document.getElementById('me_cancel').onclick = closeModal;
  document.getElementById('me_save').onclick = async ()=>{
    const newName = document.getElementById('me_name').value.trim();
    const low = Number(document.getElementById('me_low').value) || 0;
    const kgPerBag = Number(document.getElementById('me_kgperbag').value) || 0;
    const price = document.getElementById('me_price').value ? Number(document.getElementById('me_price').value) : null;
    if(!newName) return alert('Name required');
    const nameNorm = normalizeName(newName);
    showLoader('Saving material…','Updating remote DB');
    try{
      const matsRef = db.collection('companies').doc(currentCompanyId).collection('materials');
      const dupSnap = await matsRef.where('name_lower','==',nameNorm).get();
      let conflict = false;
      dupSnap.forEach(d=>{ if(d.id !== materialId) conflict = true; });
      if(conflict){ hideLoader(); return alert('Another material with the same name exists.'); }
      await matsRef.doc(materialId).update({ name: newName, name_lower: nameNorm, lowStockBags: low, kgPerBag: kgPerBag, pricePerBag: price || null, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      await rebuildMaterialFromEntries(materialId);
      closeModal(); await renderManageMaterials(); await loadCompaniesToMenu();
    }catch(err){ alert('Save failed: ' + err.message); console.error(err); } finally { hideLoader(); }
  };
}
async function deleteMaterial(materialId){
  if(!confirm('Delete material and its entries?')) return;
  showLoader('Deleting material…','Removing material and related entries');
  try{
    const matRef = db.collection('companies').doc(currentCompanyId).collection('materials').doc(materialId);
    const entriesSnap = await db.collection('companies').doc(currentCompanyId).collection('entries').where('materialId','==',materialId).get();
    const batch = db.batch();
    entriesSnap.forEach(e => batch.delete(e.ref));
    batch.delete(matRef);
    await batch.commit();
    await renderManageMaterials(); await loadCompaniesToMenu();
  }catch(err){ alert('Delete failed: ' + err.message); console.error(err); } finally { hideLoader(); }
}

/* ---------- Today modal ---------- */
function openTodayModal(){
  if(!currentCompanyId) return alert('Select a company first');
  const today = new Date();
  const td = localDateString(today);
  const from = parseDateInput(td);
  const to = parseDateInput(td);
  const slice = entriesBetween(from,to);
  const purchases = slice.filter(e=>e.type==='purchase');
  const sales = slice.filter(e=>e.type==='sale');
  const sumPurch = purchases.reduce((s,e)=>s + Number(e.totalValue||0), 0);
  const sumSales = sales.reduce((s,e)=>s + Number(e.totalValue||0), 0);
  const costBasisSold = sales.reduce((s,e)=>s + Number(e.costTotal||0), 0);
  const profit = sumSales - costBasisSold;
  const profitPct = (sumSales > 0) ? (profit / sumSales * 100) : 0;
  const stocks = lastMaterials.map(m=>{ const d = computeMaterialDerived(m); return { name: m.name, bags: d.bags, stockValue: d.stockValue }; });
  const top = stocks.slice(0,8).map(s => `<div style="display:flex;justify-content:space-between"><div>${escapeHtml(s.name)} • ${s.bags} bags</div><div>${toINR(s.stockValue)}</div></div>`).join('');
  showModal(`
    <div style="font-weight:700">Today — ${document.getElementById('mainCompanyName').textContent}</div><hr>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:240px">
        <div style="font-weight:700">Today's summary</div>
        <div class="mini" style="margin-top:8px">Purchases: ${toINR(sumPurch)}</div>
        <div class="mini" style="margin-top:6px">Sales: ${toINR(sumSales)}</div>
        <div class="mini" style="margin-top:6px">Profit: ${toINR(profit)} ${profitPct ? '(' + profitPct.toFixed(2) + '%)' : ''}</div>
      </div>
      <div style="flex:1;min-width:240px">
        <div style="font-weight:700">Top stocks</div>
        <div class="mini" style="margin-top:8px">${top || '<div class="tiny muted">No stock</div>'}</div>
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn ghost" id="today_close">Close</button></div>`);
  document.getElementById('today_close').onclick = closeModal;
}

/* ---------- Export (entries CSV) ---------- */
document.getElementById('menuExport').addEventListener('click', async ()=>{
  showLoader('Exporting data…','Preparing CSV for download');
  try{
    const rows = [];
    rows.push(['companyId','companyName','materialId','materialName','materialStockBags','materialLowBags','materialKgPerBag','materialPricePerBag','entryId','entryType','entryBags','entryUnit','pricePerBag','totalValue','costPerBag','costTotal','partyName','note','voucherNo','entryCreatedAt']);
    const companiesSnap = await db.collection('companies').orderBy('name').get();
    for(const cdoc of companiesSnap.docs){
      const cid = cdoc.id; const cname = cdoc.data().name;
      const matsSnap = await cdoc.ref.collection('materials').get();
      const matMap = {}; matsSnap.forEach(m => matMap[m.id] = m.data());
      const entSnap = await cdoc.ref.collection('entries').orderBy('createdAt','desc').get();
      if(entSnap.empty){
        matsSnap.forEach(m => {
          rows.push([cid, cname, m.id, m.data().name, (m.data().stockBags||''), (m.data().lowStockBags||''), (m.data().kgPerBag||''), (m.data().pricePerBag||''), '', '', '', '', '', '', '', '', '', '', '', '']);
        });
      } else {
        entSnap.forEach(e => {
          const ed = e.data(); const mat = matMap[ed.materialId] || {};
          rows.push([
            cid, cname, ed.materialId || '', mat.name || '', mat.stockBags || '', mat.lowStockBags || '', mat.kgPerBag || '', mat.pricePerBag || '',
            e.id, ed.type || '', ed.bags || '', ed.unit || '', ed.pricePerBag || '', ed.totalValue || '', ed.costPerBag || '', ed.costTotal || '',
            ed.partyName || ed.party || '', ed.note ? String(ed.note).replace(/\r?\n|\r/g,' ') : '', ed.voucherNo || '',
            ed.createdAt ? (ed.createdAt.toDate ? ed.createdAt.toDate().toLocaleString('en-IN') : ed.createdAt) : ''
          ]);
        });
      }
    }
    const csv = rows.map(r => r.map(cell => {
      if(cell === null || cell === undefined) return '';
      const s = String(cell);
      if(s.includes('"')) return `"${s.replace(/"/g,'""')}"`;
      if(s.includes(',') || s.includes('\n')) return `"${s}"`;
      return s;
    }).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'supply_export_with_vouchers.csv'; document.body.appendChild(a); a.click(); a.remove();
    alert('Export ready — file downloaded (CSV). You can open it in Excel.');
  }catch(err){ alert('Export failed: ' + err.message); console.error(err); }
  finally{ hideLoader(); }
});

/* ---------- Global wiring ---------- */
const drawer = document.getElementById('drawer');
document.getElementById('hamb').addEventListener('click', ()=> { if(window.innerWidth <= 900){ drawer.classList.toggle('open'); } else { drawer.classList.toggle('hide'); } });
document.getElementById('menuDashboard').addEventListener('click', ()=> { closeDrawer(); });
document.getElementById('menuHistory').addEventListener('click', ()=> { closeDrawer(); openHistoryModal(); });
document.getElementById('menuLedger').addEventListener('click', ()=> { closeDrawer(); openLedgerModal(); });
document.getElementById('menuManage').addEventListener('click', ()=> { closeDrawer(); openManageModal(); });
function closeDrawer(){ if(window.innerWidth <= 900) drawer.classList.remove('open'); else drawer.classList.add('hide'); }

document.getElementById('btnHistory').addEventListener('click', ()=> openHistoryModal());
document.getElementById('btnManage').addEventListener('click', ()=> openManageModal());
document.getElementById('btnToday').addEventListener('click', ()=> openTodayModal());
document.getElementById('btnVoucher').addEventListener('click', ()=> openLedgerModal());

document.getElementById('btnPurchase').addEventListener('click', ()=> {
  if(!currentCompanyId) return alert('Select a company in the admin menu');
  const opts = lastMaterials.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
  showModal(`
    <div style="font-weight:700">Add Purchase</div><hr>
    <label>Material</label><select id="g_mat">${opts}</select>
    <label>Number of bags</label><input id="g_bags" type="number" />
    <label>Price per bag</label><input id="g_price" type="number" step="0.01" />
    <label>Bought from (Party)</label><input id="g_party" />
    <label>Date</label><input id="g_date" type="date" value="${localDateString()}"/>
    <label>Note</label><input id="g_note" />
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn ghost" id="g_cancel">Cancel</button><button class="btn" id="g_save">Confirm & Save</button></div>`);
  document.getElementById('g_cancel').onclick = closeModal;
  document.getElementById('g_save').onclick = async ()=>{
    const mid = document.getElementById('g_mat').value;
    const bags = Number(document.getElementById('g_bags').value);
    const price = document.getElementById('g_price').value ? Number(document.getElementById('g_price').value) : null;
    const party = document.getElementById('g_party').value || '';
    const date = document.getElementById('g_date').value || null;
    const note = document.getElementById('g_note').value || '';
    await addEntryBags(mid,'purchase',bags,price,party,note,date); closeModal();
  };
});

document.getElementById('btnSale').addEventListener('click', ()=> {
  if(!currentCompanyId) return alert('Select a company in the admin menu');
  const opts = lastMaterials.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
  showModal(`
    <div style="font-weight:700">Add Sale</div><hr>
    <label>Material</label><select id="s_mat">${opts}</select>
    <label>Number of bags</label><input id="s_bags" type="number" />
    <label>Price per bag</label><input id="s_price" type="number" step="0.01" />
    <label>Sold to (Party)</label><input id="s_party" />
    <label>Date</label><input id="s_date" type="date" value="${localDateString()}"/>
    <label>Note</label><input id="s_note" />
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn ghost" id="s_cancel">Cancel</button><button class="btn warn" id="s_save">Confirm & Save</button></div>`);
  document.getElementById('s_cancel').onclick = closeModal;
  document.getElementById('s_save').onclick = async ()=>{
    const mid = document.getElementById('s_mat').value;
    const bags = Number(document.getElementById('s_bags').value);
    const price = document.getElementById('s_price').value ? Number(document.getElementById('s_price').value) : null;
    const party = document.getElementById('s_party').value || '';
    const date = document.getElementById('s_date').value || null;
    const note = document.getElementById('s_note').value || '';
    await addEntryBags(mid,'sale',bags,price,party,note,date); closeModal();
  };
});

            mat.lowStockBags || '', mat.kgPerBag || '', mat.pricePerBag || '',
            e.id, ed.type || '', ed.bags || '', ed.unit || 'bags', ed.pricePerBag || '', ed.totalValue || '', ed.costPerBag || '', ed.costTotal || '',
            ed.partyName || ed.party || '', ed.note || '', ed.voucherNo || '', (ed.createdAt ? (ed.createdAt.toDate ? ed.createdAt.toDate().toISOString() : ed.createdAt) : '')
          ]);
        });
      }
    }
    const csv = rows.map(r => r.map(cell => {
      const s = (cell===undefined || cell===null) ? '' : String(cell);
      if(s.includes('"')) return `"${s.replace(/"/g,'""')}"`;
      if(s.includes(',') || s.includes('\n')) return `"${s}"`;
      return s;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'export_entries.csv'; document.body.appendChild(a); a.click(); a.remove();
  }catch(err){ alert('Export failed: '+err.message); console.error(err); } finally { hideLoader(); }
});

/* ---------- UI wiring ---------- */
document.getElementById('hamb').addEventListener('click', ()=>{
  const d = document.getElementById('drawer');
  d.classList.toggle('open');
});
document.getElementById('menuManage').addEventListener('click', openManageModal);
document.getElementById('menuHistory').addEventListener('click', openHistoryModal);
document.getElementById('menuLedger').addEventListener('click', openLedgerModal);
document.getElementById('btnHistory').addEventListener('click', openHistoryModal);
document.getElementById('btnPurchase').addEventListener('click', ()=>{
  if(!lastMaterials.length) return alert('No materials yet. Add in Manage.');
  const first = lastMaterials[0]; openQuickPurchase(first.id, first.name);
});
document.getElementById('btnSale').addEventListener('click', ()=>{
  if(!lastMaterials.length) return alert('No materials yet. Add in Manage.');
  const first = lastMaterials[0]; openQuickSale(first.id, first.name);
});
document.getElementById('btnManage').addEventListener('click', openManageModal);
document.getElementById('btnVoucher').addEventListener('click', ()=>{
  if(!lastMaterials.length) return alert('No materials yet. Add in Manage.');
  const first = lastMaterials[0];
  showModal(`
    <div style="font-weight:700">New voucher</div><hr>
    <label>Type</label><select id="nv_type"><option value="purchase">Purchase</option><option value="sale">Sale</option></select>
    <label>Material</label><select id="nv_mat">${lastMaterials.map(m=>`<option value="${m.id}">${m.name}</option>`).join('')}</select>
    <label>Number of bags</label><input id="nv_bags" type="number" min="0.01" step="0.01"/>
    <label>Price per bag</label><input id="nv_price" type="number" step="0.01"/>
    <label>Party</label><input id="nv_party" placeholder="Party name"/>
    <label>Date</label><input id="nv_date" type="date" value="${localDateString()}"/>
    <label>Note</label><input id="nv_note"/>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn ghost" id="nv_cancel">Cancel</button><button class="btn" id="nv_save">Save</button></div>`);
  document.getElementById('nv_cancel').onclick = closeModal;
  document.getElementById('nv_save').onclick = async ()=>{
    const t = document.getElementById('nv_type').value;
    const m = document.getElementById('nv_mat').value;
    const b = Number(document.getElementById('nv_bags').value);
    const r = document.getElementById('nv_price').value ? Number(document.getElementById('nv_price').value) : null;
    const p = document.getElementById('nv_party').value || '';
    const n = document.getElementById('nv_note').value || '';
    const d = document.getElementById('nv_date').value || null;
    await addEntryBags(m,t,b,r,p,n,d);
    closeModal();
  };
});
document.getElementById('btnToday').addEventListener('click', openTodayModal);

/* ---------- Drawer shortcuts ---------- */
document.getElementById('menuExportLedger').addEventListener('click', openLedgerModal);

/* Initial UI */
document.getElementById('statusLabel').textContent = 'Loading…';
loadCompaniesToMenu().then(()=>{ document.getElementById('statusLabel').textContent = 'Ready'; });
