/* =========================================================
   Fixed app: accurate weighted-average price, local dates,
   correct profit calculation, and immediate updates.
   UI unchanged from your previous version.
   ========================================================= */

/* FIREBASE CONFIG (your config) */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBEybu3XKeK3QOeRIMs-fK2dDwHtpCTqgQ",
  authDomain: "aditya-supply-chain-b5f61.firebaseapp.com",
  projectId: "aditya-supply-chain-b5f61",
  storageBucket: "aditya-supply-chain-b5f61.firebasestorage.app",
  messagingSenderId: "662836162599",
  appId: "1:662836162599:web:2b49bde530e4b87924de02",
  measurementId: "G-DQH00BNH1L"
};

/* HARDCODED ADMIN CREDENTIALS (insecure if public) */
const AUTO_SIGNIN = true;
const ADMIN_EMAIL = 'adityajainaas@gmail.com';
const ADMIN_PWD = 'Aditya@1609';

/* Initialize Firebase */
firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.firestore();
const auth = firebase.auth();

/* App state */
let currentCompanyId = null;
let materialsUnsub = null;
let entriesUnsub = null;
let lastMaterials = []; // materials for current company
let lastEntries = [];   // entries for current company (recent)
let cachedTotalInventoryValue = 0;

/* Loader */
const loader = document.getElementById('globalLoader');
const loaderTitle = document.getElementById('loaderTitle');
const loaderText = document.getElementById('loaderText');
function showLoader(title='Working…', text='Please wait'){ loaderTitle.textContent = title; loaderText.textContent = text; loader.style.display = 'flex'; loader.setAttribute('aria-hidden','false'); }
function hideLoader(){ loader.style.display = 'none'; loader.setAttribute('aria-hidden','true'); }

/* Utils */
function fmtDate(ts){ if(!ts) return '-'; if(ts.toDate) return ts.toDate().toLocaleString('en-IN'); if(ts.seconds) return new Date(ts.seconds*1000).toLocaleString('en-IN'); return new Date(ts).toLocaleString('en-IN'); }
function toINR(x){ if(x===undefined||x===null||x==='') return '-'; return '₹' + Number(x).toLocaleString('en-IN',{maximumFractionDigits:2}); }
function normalizeName(n){ return (n || '').trim().toLowerCase(); }
function dateOnly(d){ const t = new Date(d); t.setHours(0,0,0,0); return t; }
function sameDay(a,b){ return dateOnly(a).getTime() === dateOnly(b).getTime(); }
function localDateString(date = new Date()){
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,'0');
  const d = String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}

/* Modal helpers */
function showModal(html){
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-backdrop" id="modalBackdrop"><div class="modal">${html}</div></div>`;
  document.getElementById('modalBackdrop').addEventListener('click',(e)=>{ if(e.target.id==='modalBackdrop') closeModal(); });
}
function closeModal(){ document.getElementById('modalRoot').innerHTML = ''; }

/* ---------- Auth ---------- */
auth.onAuthStateChanged(user=>{
  if(user){ document.getElementById('adminEmail').textContent = user.email || user.uid; document.getElementById('statusLabel').textContent = 'Signed in'; }
  else { document.getElementById('adminEmail').textContent = 'Not signed'; document.getElementById('statusLabel').textContent = 'Signed out'; }
});
async function autoSignIn(){ if(!AUTO_SIGNIN) return; try{ showLoader('Signing in…','Signing in admin account'); await auth.signInWithEmailAndPassword(ADMIN_EMAIL, ADMIN_PWD); }catch(err){ alert('Auto sign-in failed: ' + err.message);} finally{ hideLoader(); } }

/* ---------- Read helpers (legacy kg tolerated) ---------- */
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
  // fallback from lastEntries if any
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

/* ---------- Rebuild function ----------
   When editing or deleting entries we rebuild a material's stock & avg by replaying entries
-----------------------------------------------------------------------*/
async function rebuildMaterialFromEntries(materialId){
  if(!currentCompanyId || !materialId) return;
  const companyRef = db.collection('companies').doc(currentCompanyId);
  const matsRef = companyRef.collection('materials').doc(materialId);
  const entriesRef = companyRef.collection('entries');
  showLoader('Rebuilding material…','Reconciling stock & avg price');
  try{
    const snap = await entriesRef.where('materialId','==',materialId).orderBy('createdAt','asc').get();
    let stock = 0;
    let avg = null;
    const batch = db.batch();
    // iterate in chronological order
    for(const doc of snap.docs){
      const e = doc.data();
      const id = doc.id;
      const bags = Number(e.bags || 0);
      const price = (e.pricePerBag !== undefined && e.pricePerBag !== null) ? Number(e.pricePerBag) : null;
      if(e.type === 'purchase'){
        if(stock <= 0 || avg === null){
          // If no prior stock, adopt price if provided
          if(price !== null) avg = price;
        } else {
          if(price !== null){
            const numerator = (stock * avg) + (bags * price);
            const denominator = (stock + bags);
            avg = denominator > 0 ? (numerator / denominator) : avg;
          }
        }
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
    // update material document with final values
    const matPatch = { stockBags: Math.round(stock * 100) / 100, pricePerBag: (avg !== null ? Math.round(avg * 100) / 100 : null), updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    await matsRef.update(matPatch);
  }catch(err){
    console.error('rebuildMaterialFromEntries failed', err);
  } finally {
    hideLoader();
  }
}

/* ---------- Dedupe helpers (kept) ---------- */
async function dedupeCompanies(){
  try{
    const snap = await db.collection('companies').get();
    const groups = {};
    snap.forEach(doc => {
      const d = doc.data();
      const key = normalizeName(d.name || '');
      if(!groups[key]) groups[key] = [];
      groups[key].push({ id: doc.id, data: d });
    });
    const toDelete = [];
    for(const key in groups){
      const arr = groups[key];
      if(arr.length > 1){
        arr.sort((a,b)=>{
          const aTs = a.data.createdAt && a.data.createdAt.toMillis ? a.data.createdAt.toMillis() : 0;
          const bTs = b.data.createdAt && b.data.createdAt.toMillis ? b.data.createdAt.toMillis() : 0;
          return (aTs || 0) - (bTs || 0);
        });
        for(let i=1;i<arr.length;i++) toDelete.push(arr[i].id);
      }
    }
    if(toDelete.length === 0) return;
    showLoader('Cleaning duplicates…','Removing duplicate companies');
    for(const cid of toDelete){
      const compRef = db.collection('companies').doc(cid);
      const matsSnap = await compRef.collection('materials').get();
      const entriesSnap = await compRef.collection('entries').get();
      const batch = db.batch();
      matsSnap.forEach(m => batch.delete(m.ref));
      entriesSnap.forEach(e => batch.delete(e.ref));
      batch.delete(compRef);
      await batch.commit();
    }
    alert(`Removed ${toDelete.length} duplicate company documents (kept earliest).`);
  }catch(err){ console.error('dedupeCompanies failed', err); } finally { hideLoader(); }
}
async function dedupeMaterialsForCompany(companyId){
  if(!companyId) return;
  try{
    const matsSnap = await db.collection('companies').doc(companyId).collection('materials').get();
    const groups = {};
    matsSnap.forEach(doc => {
      const d = doc.data();
      const key = normalizeName(d.name || '');
      if(!groups[key]) groups[key] = [];
      groups[key].push({ id: doc.id, data: d });
    });
    const toDelete = [];
    for(const key in groups){
      const arr = groups[key];
      if(arr.length > 1){
        arr.sort((a,b)=>{
          const aTs = a.data.createdAt && a.data.createdAt.toMillis ? a.data.createdAt.toMillis() : 0;
          const bTs = b.data.createdAt && b.data.createdAt.toMillis ? b.data.createdAt.toMillis() : 0;
          return (aTs || 0) - (bTs || 0);
        });
        for(let i=1;i<arr.length;i++) toDelete.push(arr[i].id);
      }
    }
    if(toDelete.length === 0) return;
    showLoader('Cleaning duplicates…','Removing duplicate materials for selected company');
    for(const mid of toDelete){
      const entriesRef = db.collection('companies').doc(companyId).collection('entries');
      const entSnap = await entriesRef.where('materialId','==',mid).get();
      const batch = db.batch();
      entSnap.forEach(e => batch.delete(e.ref));
      batch.delete(db.collection('companies').doc(companyId).collection('materials').doc(mid));
      await batch.commit();
    }
    alert(`Removed ${toDelete.length} duplicate material(s) for the selected company (kept earliest).`);
  }catch(err){ console.error('dedupeMaterialsForCompany failed', err); } finally { hideLoader(); }
}

/* ---------- Companies menu ---------- */
async function loadCompaniesToMenu(){
  const sel = document.getElementById('companySelect');
  sel.innerHTML = '';
  try{
    await dedupeCompanies();
    const snap = await db.collection('companies').orderBy('name').get();
    snap.forEach(doc=>{
      const o = document.createElement('option');
      o.value = doc.id;
      o.textContent = doc.data().name;
      sel.appendChild(o);
    });
    if(sel.options.length === 0){
      currentCompanyId = null;
      document.getElementById('mainCompanyName').textContent = 'No company';
      renderEmptyDashboard();
      return;
    }
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

/* ---------- Listeners ---------- */
function clearListeners(){
  try{ if(typeof materialsUnsub === 'function') materialsUnsub(); }catch(e){console.warn(e);}
  try{ if(typeof entriesUnsub === 'function') entriesUnsub(); }catch(e){console.warn(e);}
  materialsUnsub = null; entriesUnsub = null; lastMaterials = []; lastEntries = [];
}
function startCompanyListeners(companyId){
  if(!companyId) return;
  clearListeners();
  dedupeMaterialsForCompany(companyId).catch(e=>console.warn(e));
  const matsRef = db.collection('companies').doc(companyId).collection('materials').orderBy('name');
  materialsUnsub = matsRef.onSnapshot(snapshot=>{
    lastMaterials = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMaterials(lastMaterials);
  }, err => { console.error('materials onSnapshot', err); alert('Listener error (materials): ' + err.message); });

  const entsRef = db.collection('companies').doc(companyId).collection('entries').orderBy('createdAt','desc').limit(2000);
  entriesUnsub = entsRef.onSnapshot(snapshot=>{
    lastEntries = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    const modalRoot = document.getElementById('modalRoot');
    if(modalRoot.innerHTML && modalRoot.innerHTML.includes('History —')) renderHistory();
    renderMaterials(lastMaterials);
  }, err => { console.error('entries onSnapshot', err); alert('Listener error (entries): ' + err.message); });

  db.collection('companies').doc(companyId).onSnapshot(doc => {
    const dd = doc.data();
    document.getElementById('lastUpdated').textContent = dd && dd.updatedAt ? fmtDate(dd.updatedAt) : '-';
  });
}

/* ---------- Dashboard rendering ---------- */
function renderEmptyDashboard(){ document.getElementById('dashboardArea').innerHTML = '<div class="card tiny muted">No company selected / no data.</div>'; }

function computeMaterialDerived(mat){
  const bags = readMaterialStockBags(mat);
  const pricePerBag = getMaterialPricePerBag(mat) || null;
  const stockValue = (pricePerBag ? (bags * Number(pricePerBag)) : 0);
  const sales = lastEntries.filter(e => e.materialId === mat.id && e.type === 'sale').reduce((acc, e) => acc + (Number(e.totalValue || 0)), 0);
  return { bags, pricePerBag, stockValue, sales };
}

function renderMaterials(materials){
  const area = document.getElementById('dashboardArea'); area.innerHTML = '';

  const header = document.createElement('div'); header.className = 'card';
  header.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div><div style="font-weight:700">${document.getElementById('mainCompanyName').textContent}</div><div class="tiny muted">Stock overview (bags)</div></div>
      <div class="tiny muted">Materials: ${materials.length}</div>
    </div>`;
  area.appendChild(header);

  const gridWrap = document.createElement('div'); gridWrap.className='card';
  const grid = document.createElement('div'); grid.className='materials';
  for(const m of materials){
    const d = computeMaterialDerived(m);
    const bags = d.bags;
    const price = d.pricePerBag;
    const stockValue = d.stockValue;
    const sales = d.sales;
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

  // Chart + Reports
  const splitCard = document.createElement('div'); splitCard.className = 'card';
  splitCard.innerHTML = `
    <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:1;min-width:320px;">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-weight:700">Stock value</div>
          <div class="tiny muted">₹ per material (current)</div>
        </div>
        <div class="chart-wrap" style="margin-top:10px"><canvas id="stockCanvas"></canvas></div>
        <div style="margin-top:12px;font-weight:700">Total inventory value: <span id="totalInventoryValue">—</span></div>
      </div>

      <div style="width:340px;min-width:260px;">
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
  area.appendChild(splitCard);

  // chart data
  const labels = materials.map(m => m.name);
  const data = materials.map(m => {
    const d = computeMaterialDerived(m);
    return d.stockValue ? Math.round(d.stockValue * 100) / 100 : 0;
  });

  setTimeout(()=>{
    const ctx = document.getElementById('stockCanvas').getContext('2d');
    if(window._stockChart) window._stockChart.destroy();
    window._stockChart = new Chart(ctx, {
      type:'bar',
      data:{ labels, datasets:[{ label:'₹', data }] },
      options:{ responsive:true, plugins:{legend:{display:false}}, scales:{ y:{ beginAtZero:true } } }
    });
  }, 20);

  const total = data.reduce((a,b)=>a+Number(b||0),0);
  cachedTotalInventoryValue = Math.round(total*100)/100;
  document.getElementById('totalInventoryValue').textContent = toINR(cachedTotalInventoryValue);

  // set default date pickers to local today
  const todayStr = localDateString();
  document.getElementById('reportFrom').value = todayStr;
  document.getElementById('reportTo').value = todayStr;

  // wire report buttons
  document.getElementById('btnReportToday').onclick = ()=>{ const td = localDateString(); document.getElementById('reportFrom').value = td; document.getElementById('reportTo').value = td; renderReports(); };
  document.getElementById('btnReportWeek').onclick = ()=>{
    const to = new Date(); const from = new Date(); from.setDate(from.getDate()-6);
    document.getElementById('reportFrom').value = localDateString(from); document.getElementById('reportTo').value = localDateString(to); renderReports();
  };
  document.getElementById('btnReportMonth').onclick = ()=>{
    const to = new Date(); const from = new Date(); from.setDate(from.getDate()-29);
    document.getElementById('reportFrom').value = localDateString(from); document.getElementById('reportTo').value = localDateString(to); renderReports();
  };
  document.getElementById('btnReportApply').onclick = renderReports;

  // initial report render
  renderReports();
}

/* ---------- Reports & profit calculations ---------- */
function parseDateInput(val){
  if(!val) return null;
  const parts = val.split('-').map(x=>Number(x));
  if(parts.length !== 3) return null;
  const [y,m,d] = parts;
  const t = new Date(y, m-1, d);
  t.setHours(0,0,0,0);
  return t;
}
function entriesBetween(fromDate, toDate){
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
    <div class="mini" style="margin-top:8px">Total inventory value (now): ${toINR(totalInv)}</div>
  `;
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
  const stocks = lastMaterials.map(m=>{
    const d = computeMaterialDerived(m);
    return { name: m.name, bags: d.bags, stockValue: d.stockValue };
  });
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
    <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn ghost" id="today_close">Close</button></div>
  `);
  document.getElementById('today_close').onclick = closeModal;
}

/* ---------- Add Entry (purchase/sale) using transaction ----------
   - For purchases: compute weighted avg using current stock & avg from material doc
   - For sales: read current avg price (cost basis) then record costPerBag & costTotal in the entry
   This avoids race conditions and ensures immediate consistent updates.
------------------------------------------------------------------------*/
async function addEntryBags(materialId, type, bagsCount, pricePerBag, party, note){
  if(!currentCompanyId) return alert('Select a company first');
  if(!materialId || bagsCount <= 0) return alert('Invalid input');
  const companyRef = db.collection('companies').doc(currentCompanyId);
  const matRef = companyRef.collection('materials').doc(materialId);
  const entriesRef = companyRef.collection('entries');
  showLoader(type==='purchase' ? 'Saving purchase…' : 'Saving sale…', 'Saving to remote database');
  try{
    await db.runTransaction(async tx=>{
      const matSnap = await tx.get(matRef);
      if(!matSnap.exists) throw new Error('Material not found');
      const mat = matSnap.data();
      const currentStock = (mat.stockBags !== undefined && mat.stockBags !== null) ? Number(mat.stockBags || 0) : (mat.stockKg && mat.kgPerBag ? (Number(mat.stockKg) / Number(mat.kgPerBag || 1)) : 0);
      const currentAvg = (mat.pricePerBag !== undefined && mat.pricePerBag !== null) ? Number(mat.pricePerBag) : null;

      const entryRef = entriesRef.doc();
      const entryId = entryRef.id;
      const totalValue = Number(bagsCount) * (pricePerBag ? Number(pricePerBag) : 0);

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
          type, materialId, bags: bagsCount, unit: 'bags', pricePerBag: pricePerBag || null,
          totalValue: totalValue || 0, party: party || '', note: note || '',
          createdAt: firebase.firestore.FieldValue.serverTimestamp(), createdBy: (auth.currentUser && auth.currentUser.uid) || null
        });
        tx.update(matRef, { stockBags: Math.round(newStock*100)/100, pricePerBag: (newAvg !== null ? Math.round(newAvg*100)/100 : null), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      } else if(type === 'sale'){
        const costPerBag = (currentAvg !== null) ? currentAvg : 0;
        const costTotal = bagsCount * costPerBag;
        const newStock = currentStock - bagsCount;
        if(newStock < -0.0001) throw new Error('Not enough stock for this sale');
        tx.set(entryRef, {
          type, materialId, bags: bagsCount, unit: 'bags', pricePerBag: pricePerBag || null,
          totalValue: totalValue || 0, party: party || '', note: note || '',
          costPerBag: Math.round(costPerBag*100)/100, costTotal: Math.round(costTotal*100)/100,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(), createdBy: (auth.currentUser && auth.currentUser.uid) || null
        });
        tx.update(matRef, { stockBags: Math.round(newStock*100)/100, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      } else {
        throw new Error('Unknown entry type');
      }
      // update company updatedAt
      tx.update(companyRef, { updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    });
    // successful transaction will trigger onSnapshot listeners which update UI
  }catch(err){ alert('Save failed: ' + err.message); console.error(err); } finally { hideLoader(); }
  return entryId;
}

/* Quick Purchase / Sale modals */
function openQuickPurchase(materialId, materialName){
  showModal(`
    <div style="font-weight:700">Add Purchase — ${escapeHtml(materialName)}</div><hr>
    <label>Number of bags</label><input id="pq_bags" type="number" min="0.01" step="0.01" placeholder="e.g. 6" />
    <label>Price per bag</label><input id="pq_price" type="number" step="0.01" placeholder="e.g. 1380" />
    <label>Bought from</label><input id="pq_party" placeholder="Supplier name / place" />
    <label>Note</label><input id="pq_note" />
    <div class="form-section"><div class="form-section-title">Payment</div>
      <div class="form-row">
        <div class="form-col"><label>Status</label>
          <select id="pq_pay_status"><option value="unpaid">Unpaid</option><option value="paid">Paid now</option><option value="partial">Partial</option></select>
        </div>
        <div class="form-col half"><label>Amount paid (₹)</label><input id="pq_pay_amount" type="number"/></div>
        <div class="form-col half"><label>Method</label><input id="pq_pay_method" placeholder="Cash/UPI/Bank"/></div>
      </div>
    </div>
    <div class="form-section"><div class="form-section-title">Payment</div>
      <div class="form-row">
        <div class="form-col"><label>Status</label>
          <select id="pq_pay_status"><option value="unpaid">Unpaid</option><option value="paid">Paid now</option><option value="partial">Partial</option></select>
        </div>
        <div class="form-col half"><label>Amount paid (₹)</label><input id="pq_pay_amount" type="number"/></div>
        <div class="form-col half"><label>Method</label><input id="pq_pay_method" placeholder="cash/UPI/bank"/></div>
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
      <button class="btn ghost" id="pq_cancel">Cancel</button>
      <button class="btn" id="pq_save">Confirm & Save</button>
    </div>
  `);
  document.getElementById('pq_cancel').onclick = closeModal;
  document.getElementById('pq_save').onclick = async ()=>{
    const bags = Number(document.getElementById('pq_bags').value);
    const price = document.getElementById('pq_price').value ? Number(document.getElementById('pq_price').value) : null;
    const party = document.getElementById('pq_party').value || '';
    const note = document.getElementById('pq_note').value || '';
    await addEntryBags(materialId,'purchase',bags,price,party,note);
    closeModal();
  };
}
function openQuickSale(materialId, materialName){
  showModal(`
    <div style="font-weight:700">Add Sale — ${escapeHtml(materialName)}</div><hr>
    <label>Number of bags</label><input id="ps_bags" type="number" min="0.01" step="0.01" placeholder="e.g. 2" />
    <label>Price per bag</label><input id="ps_price" type="number" step="0.01" placeholder="e.g. 1500" />
    <label>Sold to</label><input id="ps_party" placeholder="Customer name / place" />
    <label>Note</label><input id="ps_note" />
    <div class="form-section"><div class="form-section-title">Payment</div>
      <div class="form-row">
        <div class="form-col"><label>Status</label>
          <select id="ps_pay_status"><option value="unpaid">Unpaid</option><option value="paid">Paid now</option><option value="partial">Partial</option></select>
        </div>
        <div class="form-col half"><label>Amount received (₹)</label><input id="ps_pay_amount" type="number"/></div>
        <div class="form-col half"><label>Method</label><input id="ps_pay_method" placeholder="Cash/UPI/Bank"/></div>
      </div>
    </div>
    <div class="form-section"><div class="form-section-title">Payment</div>
      <div class="form-row">
        <div class="form-col"><label>Status</label>
          <select id="ps_pay_status"><option value="unpaid">Unpaid</option><option value="paid">Paid now</option><option value="partial">Partial</option></select>
        </div>
        <div class="form-col half"><label>Amount received (₹)</label><input id="ps_pay_amount" type="number"/></div>
        <div class="form-col half"><label>Method</label><input id="ps_pay_method" placeholder="cash/UPI/bank"/></div>
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
      <button class="btn ghost" id="ps_cancel">Cancel</button>
      <button class="btn warn" id="ps_save">Confirm & Save</button>
    </div>
  `);
  document.getElementById('ps_cancel').onclick = closeModal;
  document.getElementById('ps_save').onclick = async ()=>{
    const bags = Number(document.getElementById('ps_bags').value);
    const price = document.getElementById('ps_price').value ? Number(document.getElementById('ps_price').value) : null;
    const party = document.getElementById('ps_party').value || '';
    const note = document.getElementById('ps_note').value || '';
    await addEntryBags(materialId,'sale',bags,price,party,note);
    closeModal();
  };
}

/* ---------- Manage companies & materials (Select button) ---------- */
function openManageModal(){
  showModal(`
    <div style="font-weight:700">Manage Companies & Materials</div><hr>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:260px">
        <label>Companies</label><div id="mg_companies"></div>
        <div style="display:flex;gap:8px;margin-top:8px"><input id="mg_newCompany" placeholder="New company name" /><button class="btn" id="mg_addCompany">Add</button></div>
      </div>
      <div style="flex:1;min-width:260px">
        <label>Selected company materials</label><div id="mg_materials"></div>
        <div style="display:flex;gap:8px;margin-top:8px"><input id="mg_newMaterial" placeholder="Material name (e.g., Urea)" /><button class="btn" id="mg_addMaterial">Add</button></div>
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn ghost" id="mg_close">Close</button></div>
  `);
  document.getElementById('mg_close').onclick = closeModal;
  document.getElementById('mg_addCompany').onclick = addCompanyFromModal;
  document.getElementById('mg_addMaterial').onclick = addMaterialFromModal;
  renderManageCompanies();
  renderManageMaterials();
}

async function renderManageCompanies(){
  const el = document.getElementById('mg_companies'); el.innerHTML = '';
  try{
    const snap = await db.collection('companies').orderBy('name').get();
    snap.forEach(doc=>{
      const d = doc.data();
      const wrap = document.createElement('div'); wrap.style.display='flex'; wrap.style.justifyContent='space-between'; wrap.style.padding='8px'; wrap.style.border='1px solid #f1f5f7'; wrap.style.marginBottom='6px'; wrap.style.borderRadius='8px';
      wrap.innerHTML = `<div><strong>${d.name}</strong><div class="tiny muted">${d.createdAt ? fmtDate(d.createdAt) : ''}</div></div>`;
      const r = document.createElement('div');
      const selectBtn = document.createElement('button'); selectBtn.className='btn ghost'; selectBtn.textContent='Select';
      selectBtn.onclick = async ()=>{
        currentCompanyId = doc.id;
        const sel = document.getElementById('companySelect');
        if(!Array.from(sel.options).some(o=>o.value===currentCompanyId)) { await loadCompaniesToMenu(); } else {
          sel.value = currentCompanyId; document.getElementById('mainCompanyName').textContent = sel.options[sel.selectedIndex].textContent;
        }
        await renderManageMaterials();
      };
      const del = document.createElement('button'); del.className='btn danger'; del.style.marginLeft='6px'; del.textContent='Delete';
      del.onclick = async ()=>{
        if(!confirm('Delete company and all its materials & entries? This is irreversible.')) return;
        showLoader('Deleting company…','Deleting all documents for the company');
        try{
          const matSnap = await db.collection('companies').doc(doc.id).collection('materials').get();
          const entSnap = await db.collection('companies').doc(doc.id).collection('entries').get();
          const batch = db.batch();
          matSnap.forEach(m => batch.delete(m.ref));
          entSnap.forEach(e => batch.delete(e.ref));
          batch.delete(db.collection('companies').doc(doc.id));
          await batch.commit();
          await loadCompaniesToMenu(); renderManageCompanies(); renderManageMaterials();
        }catch(err){ alert('Delete failed: ' + err.message); } finally { hideLoader(); }
      };
      r.appendChild(selectBtn); r.appendChild(del); wrap.appendChild(r); el.appendChild(wrap);
    });
  }catch(err){ el.innerHTML = `<div class="tiny muted">Failed to load companies: ${err.message}</div>`; }
}

async function addCompanyFromModal(){
  const name = document.getElementById('mg_newCompany').value.trim(); if(!name) return alert('Enter name');
  const nameNorm = normalizeName(name);
  showLoader('Checking…','Verifying duplicates');
  try{
    const existing = await db.collection('companies').where('name_lower','==',nameNorm).get();
    if(!existing.empty){ hideLoader(); return alert('A company with the same name already exists.'); }
    showLoader('Creating company…','Writing to remote DB');
    const docRef = db.collection('companies').doc();
    await docRef.set({ name, name_lower: nameNorm, stockCurrency: 'INR', createdAt: firebase.firestore.FieldValue.serverTimestamp(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    document.getElementById('mg_newCompany').value = '';
    await loadCompaniesToMenu(); await renderManageCompanies();
  }catch(err){ alert('Create failed: ' + err.message); console.error(err); } finally { hideLoader(); }
}

async function renderManageMaterials(){
  const el = document.getElementById('mg_materials'); el.innerHTML = '';
  if(!currentCompanyId){ el.innerHTML = '<div class="tiny muted">Select a company first (menu)</div>'; return; }
  try{
    await dedupeMaterialsForCompany(currentCompanyId);
    const matSnap = await db.collection('companies').doc(currentCompanyId).collection('materials').orderBy('name').get();
    matSnap.forEach(doc=>{
      const d = doc.data();
      const wrap = document.createElement('div'); wrap.style.padding='8px'; wrap.style.border='1px solid #f1f5f7'; wrap.style.marginBottom='6px'; wrap.style.borderRadius='8px';
      wrap.innerHTML =
        `<div style="display:flex;justify-content:space-between;align-items:center">
           <div><strong>${d.name}</strong><div class="tiny muted">Stock: ${readMaterialStockBags(d)} bags • Low: ${d.lowStockBags||0} bags</div></div>
           <div style="display:flex;gap:6px"><button class="btn ghost" onclick='openMaterialEditorDialog("${doc.id}")'>Edit</button><button class="btn danger" onclick='deleteMaterial("${doc.id}")'>Delete</button></div>
         </div>`;
      el.appendChild(wrap);
    });
  }catch(err){ el.innerHTML = `<div class="tiny muted">Failed to load materials: ${err.message}</div>`; }
}

async function addMaterialFromModal(){
  if(!currentCompanyId) return alert('Select company first');
  const name = document.getElementById('mg_newMaterial').value.trim(); if(!name) return alert('Enter material name');
  const nameNorm = normalizeName(name);
  showLoader('Checking…','Verifying duplicates');
  try{
    const matsRef = db.collection('companies').doc(currentCompanyId).collection('materials');
    const existing = await matsRef.where('name_lower','==',nameNorm).get();
    if(!existing.empty){ hideLoader(); return alert('A material with the same name already exists for this company.'); }
    showLoader('Creating material…','Writing to remote DB');
    const matRef = matsRef.doc();
    await matRef.set({
      name, name_lower: nameNorm, stockBags: 0, lowStockBags: 1, kgPerBag: 50, pricePerBag: null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(), updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('mg_newMaterial').value = '';
    await renderManageMaterials(); await loadCompaniesToMenu();
  }catch(err){ alert('Create material failed: ' + err.message); console.error(err); } finally { hideLoader(); }
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

/* ---------- Material editor ---------- */
async function openMaterialEditorDialog(materialId){
  try{
    const matDoc = await db.collection('companies').doc(currentCompanyId).collection('materials').doc(materialId).get();
    if(!matDoc.exists) return alert('Material not found');
    const m = matDoc.data();
    showModal(`
      <div style="font-weight:700">Edit material — ${escapeHtml(m.name)}</div><hr>
      <label>Name</label><input id="me_name" value="${escapeHtml(m.name)}" />
      <label>Low stock threshold (bags)</label><input id="me_low" type="number" value="${m.lowStockBags||0}" />
      <label>Kg per bag (reference)</label><input id="me_kgperbag" type="number" value="${m.kgPerBag||50}" />
      <label>Default price per bag (optional)</label><input id="me_price" type="number" step="0.01" value="${m.pricePerBag||''}" />
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn ghost" id="me_cancel">Cancel</button><button class="btn" id="me_save">Save</button></div>
    `);
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
        await matsRef.doc(materialId).update({
          name: newName, name_lower: nameNorm, lowStockBags: low, kgPerBag: kgPerBag, pricePerBag: price || null, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        // rebuild to ensure entries' cost basis reflect this change if needed
        await rebuildMaterialFromEntries(materialId);
        closeModal(); await renderManageMaterials(); await loadCompaniesToMenu();
      }catch(err){ alert('Save failed: ' + err.message); console.error(err); } finally { hideLoader(); }
    };
  }catch(err){ alert('Open edit failed: ' + err.message); console.error(err); }
}

/* ---------- History ledger ---------- */
function openHistoryModal(){
  if(!currentCompanyId) return alert('Select a company first in the admin menu');
  showModal(`
    <div style="font-weight:700">History — ${document.getElementById('mainCompanyName').textContent}</div>
    <hr>
    <div id="historyContainer" style="max-height:70vh;overflow:auto"></div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn ghost" id="h_close">Close</button></div>
  `);
  document.getElementById('h_close').onclick = closeModal;
  renderHistory();
}

function renderHistory(){
  const container = document.getElementById('historyContainer');
  if(!container) return;
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
                <div class="mini">${isPurchase ? 'Bought from: ' : 'Sold to: '} ${e.party ? escapeHtml(e.party) : '—'}</div>
                ${!isPurchase ? `<div class="mini">Cost basis: ${toINR(e.costPerBag||0) + ' /bag (' + toINR(e.costTotal||0) + ')'}</div>` : ''}
                <div class="mini">${e.note ? escapeHtml(e.note) : ''}</div>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
              <div class="mini">${fmtDate(e.createdAt)}</div>
              <div style="display:flex;gap:6px">
                <button class="btn ghost" onclick="openEditEntryDialog('${e.id}')">Edit</button>
                <button class="btn danger" onclick="deleteEntry('${e.id}')">Delete</button>
              </div>
            </div>
          </div>
        `;
      });
      html += `</div>`;
    }
  }
  container.innerHTML = html;
}

/* ---------- Edit entry ---------- */
async function openEditEntryDialog(entryId){
  const entryRef = db.collection('companies').doc(currentCompanyId).collection('entries').doc(entryId);
  const eDoc = await entryRef.get();
  if(!eDoc.exists) return alert('Entry not found');
  const e = eDoc.data();
  const matOptions = lastMaterials.map(m => `<option value="${m.id}" ${m.id === e.materialId ? 'selected' : ''}>${m.name}</option>`).join('');
  showModal(`
    <div style="font-weight:700">Edit entry</div><hr>
    <label>Type</label><select id="ee_type"><option value="purchase">Purchase</option><option value="sale">Sale</option></select>
    <label>Material</label><select id="ee_mat">${matOptions}</select>
    <label>Number of bags</label><input id="ee_bags" type="number" value="${e.bags || 0}" />
    <label>Price per bag</label><input id="ee_price" type="number" step="0.01" value="${e.pricePerBag||''}" />
    <label>Party (Bought from / Sold to)</label><input id="ee_party" value="${escapeHtml(e.party||'')}" />
    <label>Note</label><input id="ee_note" value="${escapeHtml(e.note||'')}" />
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn ghost" id="ee_cancel">Cancel</button><button class="btn" id="ee_save">Save</button></div>
  `);
  document.getElementById('ee_type').value = e.type;
  document.getElementById('ee_cancel').onclick = closeModal;
  document.getElementById('ee_save').onclick = async ()=>{
    const newType = document.getElementById('ee_type').value;
    const newMatId = document.getElementById('ee_mat').value;
    const newBags = Number(document.getElementById('ee_bags').value);
    const newPrice = document.getElementById('ee_price').value ? Number(document.getElementById('ee_price').value) : null;
    const newParty = document.getElementById('ee_party').value || '';
    const newNote = document.getElementById('ee_note').value || '';
    if(newBags <= 0) return alert('Invalid number of bags');
    showLoader('Updating entry…','Applying changes to remote DB');
    try{
      const oldMatId = e.materialId;
      await entryRef.update({
        type: newType, materialId: newMatId, bags: newBags, pricePerBag: newPrice || null,
        party: newParty || '', note: newNote || '', updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      // rebuild affected materials
      await rebuildMaterialFromEntries(newMatId);
      if(newMatId !== oldMatId) await rebuildMaterialFromEntries(oldMatId);
      alert('Entry updated');
      closeModal();
    }catch(err){ alert('Update failed: ' + err.message); console.error(err); } finally { hideLoader(); }
  };
}

/* Delete entry */
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

/* ---------- Export CSV ---------- */
document.getElementById('menuExport').addEventListener('click', async ()=>{
  showLoader('Exporting data…','Preparing CSV for download');
  try{
    const rows = [];
    rows.push(['companyId','companyName','materialId','materialName','materialStockBags','materialLowBags','materialKgPerBag','materialPricePerBag','entryId','entryType','entryBags','entryUnit','pricePerBag','totalValue','costPerBag','costTotal','party','note','entryCreatedAt']);
    const companiesSnap = await db.collection('companies').orderBy('name').get();
    for(const cdoc of companiesSnap.docs){
      const cid = cdoc.id; const cname = cdoc.data().name;
      const matsSnap = await cdoc.ref.collection('materials').get();
      const matMap = {};
      matsSnap.forEach(m => matMap[m.id] = m.data());
      const entSnap = await cdoc.ref.collection('entries').orderBy('createdAt','desc').get();
      if(entSnap.empty){
        matsSnap.forEach(m => {
          rows.push([cid, cname, m.id, m.data().name, (m.data().stockBags||''), (m.data().lowStockBags||''), (m.data().kgPerBag||''), (m.data().pricePerBag||''), '', '', '', '', '', '', '', '', '', '']);
        });
      } else {
        entSnap.forEach(e => {
          const ed = e.data();
          const mat = matMap[ed.materialId] || {};
          rows.push([
            cid, cname, ed.materialId || '', mat.name || '', mat.stockBags || '', mat.lowStockBags || '', mat.kgPerBag || '', mat.pricePerBag || '',
            e.id, ed.type || '', ed.bags || '', ed.unit || '', ed.pricePerBag || '', ed.totalValue || '', ed.costPerBag || '', ed.costTotal || '', ed.party || '', ed.note ? ed.note.replace(/\r?\n|\r/g,' ') : '', ed.createdAt ? (ed.createdAt.toDate ? ed.createdAt.toDate().toLocaleString('en-IN') : ed.createdAt) : ''
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
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'supply_export_bags_with_costs.csv'; document.body.appendChild(a); a.click(); a.remove();
    alert('Export ready — file downloaded (CSV). You can open it in Excel.');
  }catch(err){ alert('Export failed: ' + err.message); console.error(err); }
  finally{ hideLoader(); }
});

/* ---------- Helpers & wiring ---------- */
function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

const drawer = document.getElementById('drawer');
document.getElementById('hamb').addEventListener('click', ()=> {
  if(window.innerWidth <= 900){ drawer.classList.toggle('open'); } else { drawer.classList.toggle('hide'); }
});
document.getElementById('menuDashboard').addEventListener('click', ()=> { closeDrawer(); });
document.getElementById('menuHistory').addEventListener('click', ()=> { closeDrawer(); openHistoryModal(); });
document.getElementById('menuManage').addEventListener('click', ()=> { closeDrawer(); openManageModal(); });
function closeDrawer(){ if(window.innerWidth <= 900) drawer.classList.remove('open'); else drawer.classList.add('hide'); }

document.getElementById('btnHistory').addEventListener('click', ()=> openHistoryModal());
document.getElementById('btnManage').addEventListener('click', ()=> openManageModal());
document.getElementById('btnToday').addEventListener('click', ()=> openTodayModal());

document.getElementById('btnPurchase').addEventListener('click', ()=> {
  if(!currentCompanyId) return alert('Select a company in the admin menu');
  const opts = lastMaterials.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
  showModal(`
    <div style="font-weight:700">Add Purchase</div><hr>
    <label>Find material</label><input id="g_filter" placeholder="Type to filter materials" />
    <label>Find material</label><input id="g_filter" placeholder="Type to filter materials" />
    <label>Material</label><select id="g_mat">${opts}</select>
    <label>Number of bags</label><input id="g_bags" type="number" />
    <label>Price per bag</label><input id="g_price" type="number" step="0.01" />
    <label>Bought from</label><input id="g_party" />
    <label>Note</label><input id="g_note" />
    <div class="form-section"><div class="form-section-title">Payment</div>
      <div class="form-row">
        <div class="form-col"><label>Status</label>
          <select id="g_pay_status"><option value="unpaid">Unpaid</option><option value="paid">Paid now</option><option value="partial">Partial</option></select>
        </div>
        <div class="form-col half"><label>Amount (₹)</label><input id="g_pay_amount" type="number"/></div>
        <div class="form-col half"><label>Method</label><input id="g_pay_method" placeholder="Cash/UPI/Bank"/></div>
      </div>
      <label>Due date (optional)</label><input id="g_pay_due" type="date"/>
    </div>
    <div class="form-section"><div class="form-section-title">Payment</div>
      <div class="form-row">
        <div class="form-col"><label>Status</label>
          <select id="g_pay_status"><option value="unpaid">Unpaid</option><option value="paid">Paid now</option><option value="partial">Partial</option></select>
        </div>
        <div class="form-col half"><label>Amount paid (₹)</label><input id="g_pay_amount" type="number"/></div>
        <div class="form-col half"><label>Method</label><input id="g_pay_method" placeholder="cash/UPI/bank"/></div>
      </div>
      <label>Due date (optional)</label><input id="g_pay_due" type="date"/>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn ghost" id="g_cancel">Cancel</button><button class="btn" id="g_save">Confirm & Save</button></div>
  `);
  document.getElementById('g_cancel').onclick = closeModal;
  (function(){ const f=document.getElementById('g_filter'); const sel=document.getElementById('g_mat'); if(f&&sel){ f.oninput=()=>{ const q=f.value.trim().toLowerCase(); sel.innerHTML=(window.lastMaterials||[]).filter(m=>!q||(m.name||'').toLowerCase().includes(q)).map(m=>`<option value='${m.id}'>${(m.name||'')}</option>`).join(''); }; } })();
  (function(){
    const f=document.getElementById('g_filter'); const sel=document.getElementById('g_mat');
    if(f){ f.oninput=()=>{ const q=f.value.trim().toLowerCase(); sel.innerHTML = (window.lastMaterials||[]).filter(m=>!q || (m.name||'').toLowerCase().includes(q)).map(m=>`<option value="${m.id}">${(m.name||'')}</option>`).join(''); }; }
  })();
  document.getElementById('g_save').onclick = async ()=>{
    const mid = document.getElementById('g_mat').value;
    const bags = Number(document.getElementById('g_bags').value);
    const price = document.getElementById('g_price').value ? Number(document.getElementById('g_price').value) : null;
    const party = document.getElementById('g_party').value || '';
    const note = document.getElementById('g_note').value || '';
    const entryId = await addEntryBags(mid,'purchase',bags,price,party,note);
    // payment section
    const ps = (document.getElementById('g_pay_status')||{}).value || 'unpaid';
    const paid = Number((document.getElementById('g_pay_amount')||{}).value||0);
    const pmethod = (document.getElementById('g_pay_method')||{}).value || '';
    if(ps!=='unpaid' && paid>0){ await saveLinkedPayment('out', party, paid, entryId, pmethod, `Payment for entry ${entryId}`); }
    closeModal();
  };
});

document.getElementById('btnSale').addEventListener('click', ()=> {
  if(!currentCompanyId) return alert('Select a company in the admin menu');
  const opts = lastMaterials.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
  showModal(`
    <div style="font-weight:700">Add Sale</div><hr>
    <label>Find material</label><input id="g_filter" placeholder="Type to filter materials" />
    <label>Find material</label><input id="g_filter" placeholder="Type to filter materials" />
    <label>Material</label><select id="g_mat">${opts}</select>
    <label>Number of bags</label><input id="g_bags" type="number" />
    <label>Price per bag</label><input id="g_price" type="number" step="0.01" />
    <label>Sold to</label><input id="g_party" />
    <label>Note</label><input id="g_note" />
    <div class="form-section"><div class="form-section-title">Payment</div>
      <div class="form-row">
        <div class="form-col"><label>Status</label>
          <select id="g_pay_status"><option value="unpaid">Unpaid</option><option value="paid">Paid now</option><option value="partial">Partial</option></select>
        </div>
        <div class="form-col half"><label>Amount (₹)</label><input id="g_pay_amount" type="number"/></div>
        <div class="form-col half"><label>Method</label><input id="g_pay_method" placeholder="Cash/UPI/Bank"/></div>
      </div>
      <label>Due date (optional)</label><input id="g_pay_due" type="date"/>
    </div>
    <div class="form-section"><div class="form-section-title">Payment</div>
      <div class="form-row">
        <div class="form-col"><label>Status</label>
          <select id="g_pay_status"><option value="unpaid">Unpaid</option><option value="paid">Paid now</option><option value="partial">Partial</option></select>
        </div>
        <div class="form-col half"><label>Amount received (₹)</label><input id="g_pay_amount" type="number"/></div>
        <div class="form-col half"><label>Method</label><input id="g_pay_method" placeholder="cash/UPI/bank"/></div>
      </div>
      <label>Due date (optional)</label><input id="g_pay_due" type="date"/>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn ghost" id="g_cancel">Cancel</button><button class="btn warn" id="g_save">Confirm & Save</button></div>
  `);
  document.getElementById('g_cancel').onclick = closeModal;
  (function(){ const f=document.getElementById('g_filter'); const sel=document.getElementById('g_mat'); if(f&&sel){ f.oninput=()=>{ const q=f.value.trim().toLowerCase(); sel.innerHTML=(window.lastMaterials||[]).filter(m=>!q||(m.name||'').toLowerCase().includes(q)).map(m=>`<option value='${m.id}'>${(m.name||'')}</option>`).join(''); }; } })();
  (function(){
    const f=document.getElementById('g_filter'); const sel=document.getElementById('g_mat');
    if(f){ f.oninput=()=>{ const q=f.value.trim().toLowerCase(); sel.innerHTML = (window.lastMaterials||[]).filter(m=>!q || (m.name||'').toLowerCase().includes(q)).map(m=>`<option value="${m.id}">${(m.name||'')}</option>`).join(''); }; }
  })();
  document.getElementById('g_save').onclick = async ()=>{
    const mid = document.getElementById('g_mat').value;
    const bags = Number(document.getElementById('g_bags').value);
    const price = document.getElementById('g_price').value ? Number(document.getElementById('g_price').value) : null;
    const party = document.getElementById('g_party').value || '';
    const note = document.getElementById('g_note').value || '';
    const entryId = await addEntryBags(mid,'sale',bags,price,party,note);
    // payment section
    const ps = (document.getElementById('g_pay_status')||{}).value || 'unpaid';
    const paid = Number((document.getElementById('g_pay_amount')||{}).value||0);
    const pmethod = (document.getElementById('g_pay_method')||{}).value || '';
    if(ps!=='unpaid' && paid>0){ await saveLinkedPayment('in', party, paid, entryId, pmethod, `Payment for entry ${entryId}`); }
    closeModal();
  };
});

/* Expose for inline handlers */
window.openQuickPurchase = openQuickPurchase;
window.openQuickSale = openQuickSale;
window.openMaterialEditorDialog = openMaterialEditorDialog;
window.openHistoryModal = openHistoryModal;
window.openManageModal = openManageModal;
window.deleteEntry = deleteEntry;
window.openEditEntryDialog = openEditEntryDialog;
window.deleteMaterial = deleteMaterial;

/* ---------- Init ---------- */
(async function init(){
  showLoader('Initializing…','Connecting to Firebase');
  try{
    await autoSignIn();
    await loadCompaniesToMenu();
    document.getElementById('statusLabel').textContent = 'Ready';
  }catch(err){ console.error('init error', err); document.getElementById('statusLabel').textContent = 'Error'; }
  finally{ hideLoader(); }
})();

/* ==================== ACCOUNTING EXTENSIONS ====================
   Ledger, Parties, Payments, Advanced Calculator, Search, Reports
   ===============================================================*/

// ------- Utility -------
function formatINR(num){
  return new Intl.NumberFormat("en-IN", {style:"currency", currency:"INR"}).format(num||0);
}
function safe(n){ return Number(n)||0; }
function esc(t){ return t ? t.replace(/[&<>]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])) : ""; }

// ------- Flexible entry calculation -------
function deriveEntry(bags, rate, total){
  bags = safe(bags); rate = safe(rate); total = safe(total);
  if(bags && rate && !total) total = bags*rate;
  if(bags && total && !rate) rate = total/bags;
  if(rate && total && !bags) bags = total/rate;
  return {bags, rate, total};
}

// ------- Payment handling -------
async function savePayment(type, party, amount, note){
  if(!currentCompanyId) return alert("Select company first");
  if(!party || !amount) return alert("Party and amount are required");
  showLoader("Saving Payment…","Please wait");
  try{
    const payRef = db.collection("companies").doc(currentCompanyId).collection("payments").doc();
    await payRef.set({
      type, party, amount: safe(amount), note: note||"",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection("companies").doc(currentCompanyId).update({updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
  }catch(err){ alert("Error saving payment: "+err.message); }
  hideLoader();
}
function openPaymentForm(type, defaults={}){
  showModal(`
    <div class="form-section">
      <div class="form-section-title">${type==="in"?"Payment In (Receipt)":"Payment Out (Paid)"}</div>
      <label>Party</label><input id="p_party"/>
      <input id="p_linked" type="hidden"/>
      <label>Amount (₹)</label><input id="p_amt" type="number"/>
      <label>Note</label><input id="p_note"/>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
        <button class="btn ghost" id="p_cancel">Cancel</button>
        <button class="btn ${type==="in"?"success":"danger"}" id="p_save">Save</button>
      </div>
    </div>`);
  document.getElementById("p_cancel").onclick=closeModal;
  document.getElementById("p_party").value = (defaults.party||"");
  document.getElementById("p_amt").value = defaults.amount!=null?defaults.amount:"";
  document.getElementById("p_linked").value = defaults.linkedEntryId||"";
  document.getElementById("p_save").onclick=async()=>{
    await savePayment(type, document.getElementById("p_party").value.trim(), document.getElementById("p_amt").value, document.getElementById("p_note").value);
    closeModal();
  };
}
document.getElementById("btnPaymentIn").onclick=()=>openPaymentForm("in");
document.getElementById("btnPaymentOut").onclick=()=>openPaymentForm("out");


// ------- Payments helper -------
async function saveLinkedPayment(type, party, amount, linkedEntryId, method, note){
  if(!currentCompanyId) throw new Error('Select company first');
  const ref = db.collection("companies").doc(currentCompanyId);
  const payRef = ref.collection("payments").doc();
  await payRef.set({
    type, party, amount: Number(amount)||0, method: method||"", note: note||"",
    linkedEntryId: linkedEntryId || null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await ref.update({updatedAt: firebase.firestore.FieldValue.serverTimestamp()});
}
// ------- Parties view -------
async function openParties(){
  if(!currentCompanyId) return alert("Select company first");
  showLoader("Loading parties…");
  const ents=await db.collection("companies").doc(currentCompanyId).collection("entries").get();
  const pays=await db.collection("companies").doc(currentCompanyId).collection("payments").get();
  hideLoader();
  const parties={};
  
const payByEntry = {};
pays.forEach(d=>{ const p=d.data(); const lid=p.linkedEntryId; if(lid){ payByEntry[lid]=(payByEntry[lid]||0)+Number(p.amount||0); } });

ents.forEach(d=>{
  const e=d.data(); const id=d.id;
  const total=Number(e.totalValue||0);
  const paid = Number(payByEntry[id]||0);
  const outstanding = Math.max(0, total - paid);
  let status='unpaid'; if(paid>=total && total>0) status='paid'; else if(paid>0) status='partial';
  const badge = `<span class="badge ${status}">${status}</span>`;
  const entryTitle = `${(e.type||'').toUpperCase()} • ${(e.materialName||'') || (e.materialId||'')}`;
  const actionPayType = (e.type==='sale'?'in':'out');
  html += `<div class="ledger-entry ${e.type==='purchase'?'debit':'credit'}">
    <div>${entryTitle}</div>
    <div>${esc(e.party||"")}</div>
    <div>${formatINR(total)}</div>
    <div>${badge}</div>
    <div class="row-actions">
      <button class="btn info mini" onclick="openPaymentForm('${actionPayType}', {party:'${''}'.concat(esc(e.party||'')).replace(/"/g,'&quot;')}', amount:${outstanding}, linkedEntryId:'${id}'})">Add Payment</button>
      <button class="btn ghost mini" onclick="openEditEntryDialog('${id}')">Edit</button>
      <button class="btn danger mini" onclick="confirmDeleteEntry('${id}','${e.materialId||''}')">Delete</button>
    </div>
  </div>`;
});

pays.forEach(d=>{
  const p=d.data(); const title = (p.type==='in'?'Payment In':'Payment Out');
  html+=`<div class="ledger-entry ${p.type==='out'?'debit':'credit'}">
    <div>${title}</div><div>${esc(p.party||"")}</div><div>${formatINR(p.amount)}</div><div></div>
    <div class="row-actions"><button class="btn danger mini" onclick="deletePayment('${d.id}')">Delete</button></div>
  </div>`;
});
        

  let html=`<div style="font-weight:700;margin-bottom:8px">Parties</div>`;
  Object.keys(parties).sort().forEach(n=>{
    const bal=parties[n].credit-parties[n].debit;
    html+=`<div class="party-card">
      <div class="party-name">${esc(n)}</div>
      <div class="party-balance ${bal>=0?"receivable":"payable"}">${formatINR(bal)}</div>
    </div>`;
  });
  showModal(`<div style="max-height:80vh;overflow:auto">${html||"<div class='tiny muted'>No parties yet</div>"}</div>
    <div style="margin-top:12px;text-align:right"><button class="btn ghost" onclick="closeModal()">Close</button></div>`);
}
document.getElementById("menuParties").onclick=()=>{closeDrawer();openParties();};
document.getElementById("btnOpenParties").onclick=openParties;

// ------- Ledger view -------
async function openLedger(){
  if(!currentCompanyId) return alert("Select company first");
  showLoader("Loading ledger…");
  const ents=await db.collection("companies").doc(currentCompanyId).collection("entries").orderBy("createdAt","desc").get();
  const pays=await db.collection("companies").doc(currentCompanyId).collection("payments").orderBy("createdAt","desc").get();
  hideLoader();
  let html=`<div class="ledger-header"><div>Entry</div><div>Party</div><div>Amount</div><div>Status</div><div>Actions</div></div>`;
  
const payByEntry = {};
pays.forEach(d=>{ const p=d.data(); const lid=p.linkedEntryId; if(lid){ payByEntry[lid]=(payByEntry[lid]||0)+Number(p.amount||0); } });

ents.forEach(d=>{
  const e=d.data(); const id=d.id;
  const total=Number(e.totalValue||0);
  const paid = Number(payByEntry[id]||0);
  const outstanding = Math.max(0, total - paid);
  let status='unpaid'; if(paid>=total && total>0) status='paid'; else if(paid>0) status='partial';
  const badge = `<span class="badge ${status}">${status}</span>`;
  const entryTitle = `${(e.type||'').toUpperCase()} • ${(e.materialName||'') || (e.materialId||'')}`;
  const actionPayType = (e.type==='sale'?'in':'out');
  html += `<div class="ledger-entry ${e.type==='purchase'?'debit':'credit'}">
    <div>${entryTitle}</div>
    <div>${esc(e.party||"")}</div>
    <div>${formatINR(total)}</div>
    <div>${badge}</div>
    <div class="row-actions">
      <button class="btn info mini" onclick="openPaymentForm('${actionPayType}', {party:'${''}'.concat(esc(e.party||'')).replace(/"/g,'&quot;')}', amount:${outstanding}, linkedEntryId:'${id}'})">Add Payment</button>
      <button class="btn ghost mini" onclick="openEditEntryDialog('${id}')">Edit</button>
      <button class="btn danger mini" onclick="confirmDeleteEntry('${id}','${e.materialId||''}')">Delete</button>
    </div>
  </div>`;
});

pays.forEach(d=>{
  const p=d.data(); const title = (p.type==='in'?'Payment In':'Payment Out');
  html+=`<div class="ledger-entry ${p.type==='out'?'debit':'credit'}">
    <div>${title}</div><div>${esc(p.party||"")}</div><div>${formatINR(p.amount)}</div><div></div>
    <div class="row-actions"><button class="btn danger mini" onclick="deletePayment('${d.id}')">Delete</button></div>
  </div>`;
});
        
  showModal(`<div style="max-height:80vh;overflow:auto">${html}</div>
    <div style="margin-top:12px;text-align:right"><button class="btn ghost" onclick="closeModal()">Close</button></div>`);
}
document.getElementById("menuLedger").onclick=()=>{closeDrawer();openLedger();};
document.getElementById("btnOpenLedger").onclick=openLedger;

// ------- Advanced Calculator for purchase/sale -------
function openCalcForm(type){
  if(!currentCompanyId) return alert("Select company first");
  showModal(`
    <div class="form-section">
      <div class="form-section-title">${type==="purchase"?"Add Purchase":"Add Sale"}</div>
      <div class="form-row">
        <div class="form-col"><label>Party</label><input id="c_party"/></div>
        <div class="form-col half"><label>Bags</label><input id="c_bags" type="number"/></div>
        <div class="form-col half"><label>Rate (₹/bag)</label><input id="c_rate" type="number"/></div>
      </div>
      <div class="form-row"><div class="form-col"><label>Total (₹)</label><input id="c_total" type="number"/></div></div>
      <div class="calc-result" id="calc_result">Enter any two values (bags, rate, total)…</div>
      <div style="text-align:right;margin-top:12px">
        <button class="btn ghost" onclick="closeModal()">Cancel</button>
        <button class="btn ${type==="purchase"?"":"warn"}" id="c_save">Save</button>
      </div>
    </div>`);
  ["c_bags","c_rate","c_total"].forEach(id=>{
    document.getElementById(id).oninput=()=>{
      const res=deriveEntry(
        document.getElementById("c_bags").value,
        document.getElementById("c_rate").value,
        document.getElementById("c_total").value
      );
      document.getElementById("calc_result").innerText=`${res.bags} bags × ₹${res.rate.toFixed(2)} = ${formatINR(res.total)}`;
    };
  });
  document.getElementById("c_save").onclick=async()=>{
    const party=document.getElementById("c_party").value.trim();
    const res=deriveEntry(
      document.getElementById("c_bags").value,
      document.getElementById("c_rate").value,
      document.getElementById("c_total").value
    );
    if(!party || !res.total) return alert("Party and values required");
    showLoader("Saving entry…");
    try{
      const ref=db.collection("companies").doc(currentCompanyId).collection("entries").doc();
      await ref.set({
        type, party, bags:res.bags, rate:res.rate, totalValue:res.total,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await db.collection("companies").doc(currentCompanyId).update({updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
    }catch(err){ alert("Error: "+err.message); }
    hideLoader(); closeModal();
  };
}
// patched: removed old btnPurchase calculator override
// patched: removed old btnSale calculator override
// ------- Global Search -------
document.getElementById("btnGlobalSearch").onclick=async()=>{
  if(!currentCompanyId) return alert("Select company first");
  const q=document.getElementById("globalSearch").value.trim().toLowerCase();
  if(!q) return;
  showLoader("Searching…");
  const ents=await db.collection("companies").doc(currentCompanyId).collection("entries").get();
  const pays=await db.collection("companies").doc(currentCompanyId).collection("payments").get();
  hideLoader();
  let html="";
  
const payByEntry = {};
pays.forEach(d=>{ const p=d.data(); const lid=p.linkedEntryId; if(lid){ payByEntry[lid]=(payByEntry[lid]||0)+Number(p.amount||0); } });

ents.forEach(d=>{
  const e=d.data(); const id=d.id;
  const total=Number(e.totalValue||0);
  const paid = Number(payByEntry[id]||0);
  const outstanding = Math.max(0, total - paid);
  let status='unpaid'; if(paid>=total && total>0) status='paid'; else if(paid>0) status='partial';
  const badge = `<span class="badge ${status}">${status}</span>`;
  const entryTitle = `${(e.type||'').toUpperCase()} • ${(e.materialName||'') || (e.materialId||'')}`;
  const actionPayType = (e.type==='sale'?'in':'out');
  html += `<div class="ledger-entry ${e.type==='purchase'?'debit':'credit'}">
    <div>${entryTitle}</div>
    <div>${esc(e.party||"")}</div>
    <div>${formatINR(total)}</div>
    <div>${badge}</div>
    <div class="row-actions">
      <button class="btn info mini" onclick="openPaymentForm('${actionPayType}', {party:'${''}'.concat(esc(e.party||'')).replace(/"/g,'&quot;')}', amount:${outstanding}, linkedEntryId:'${id}'})">Add Payment</button>
      <button class="btn ghost mini" onclick="openEditEntryDialog('${id}')">Edit</button>
      <button class="btn danger mini" onclick="confirmDeleteEntry('${id}','${e.materialId||''}')">Delete</button>
    </div>
  </div>`;
});

pays.forEach(d=>{
  const p=d.data(); const title = (p.type==='in'?'Payment In':'Payment Out');
  html+=`<div class="ledger-entry ${p.type==='out'?'debit':'credit'}">
    <div>${title}</div><div>${esc(p.party||"")}</div><div>${formatINR(p.amount)}</div><div></div>
    <div class="row-actions"><button class="btn danger mini" onclick="deletePayment('${d.id}')">Delete</button></div>
  </div>`;
});
        
  showModal(`<div><div style="font-weight:700;margin-bottom:8px">Search Results</div>${html||"<div class='tiny muted'>No match</div>"}</div>
    <div style="margin-top:12px;text-align:right"><button class="btn ghost" onclick="closeModal()">Close</button></div>`);
};

// ------- Ledger actions -------
async function deletePayment(id){
  if(!confirm('Delete this payment?')) return;
  const ref = db.collection('companies').doc(currentCompanyId).collection('payments').doc(id);
  await ref.delete();
  openLedger();
}

window.confirmDeleteEntry = async function(entryId, materialId){
  if(!confirm('Delete this entry? This will update stock & averages for the material.')) return;
  const ref = db.collection('companies').doc(currentCompanyId).collection('entries').doc(entryId);
  const snap = await ref.get(); const data = snap.exists ? snap.data() : null;
  await ref.delete();
  if((data && data.materialId) || materialId){ try{ await recalcMaterialFromEntries(data?data.materialId:materialId); }catch(e){ console.warn(e); } }
  openLedger();
}

window.openEditEntryDialog = async function(entryId){
  const ref = db.collection('companies').doc(currentCompanyId).collection('entries').doc(entryId);
  const snap = await ref.get(); if(!snap.exists){ alert('Entry not found'); return; }
  const e=snap.data();
  showModal(\`
    <div class="form-section">
      <div class="form-section-title">Edit Entry</div>
      <label>Party</label><input id="ee_party" value="\${esc(e.party||'')}" />
      <div class="form-row">
        <div class="form-col half"><label>Bags</label><input id="ee_bags" type="number" value="\${e.bags||0}"/></div>
        <div class="form-col half"><label>Rate (₹/bag)</label><input id="ee_rate" type="number" value="\${e.pricePerBag||''}"/></div>
      </div>
      <label>Note</label><input id="ee_note" value="\${esc(e.note||'')}"/>
      <div style="text-align:right;margin-top:12px">
        <button class="btn ghost" onclick="closeModal()">Cancel</button>
        <button class="btn" id="ee_save">Save</button>
      </div>
    </div>\`);
  document.getElementById('ee_save').onclick = async ()=>{
    const party=document.getElementById('ee_party').value; const bags=Number(document.getElementById('ee_bags').value); const rate = document.getElementById('ee_rate').value?Number(document.getElementById('ee_rate').value):null; const note=document.getElementById('ee_note').value;
    await ref.set({ party, bags, pricePerBag: rate, note, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, {merge:true});
    if(e.materialId){ try{ await recalcMaterialFromEntries(e.materialId); }catch(err){ console.warn(err); } }
    closeModal(); openLedger();
  };
}

// Recalculate material stock & average price from all entries
async function recalcMaterialFromEntries(materialId){
  const companyRef = db.collection('companies').doc(currentCompanyId);
  const matRef = companyRef.collection('materials').doc(materialId);
  const entriesSnap = await companyRef.collection('entries').where('materialId','==',materialId).orderBy('createdAt','asc').get();
  let stock = 0; let avg = null;
  const batch = db.batch();
  entriesSnap.forEach(doc=>{
    const e = doc.data();
    if(e.type==='purchase'){
      const rate = (e.pricePerBag!=null)?Number(e.pricePerBag):(avg!=null?avg:0);
      const totalBefore = (avg!=null?avg:0) * stock;
      stock += Number(e.bags||0);
      const totalAfter = totalBefore + rate * Number(e.bags||0);
      avg = stock>0 ? totalAfter/stock : null;
      batch.update(doc.ref, { costPerBag: avg!=null?Math.round(avg*100)/100:null, costTotal: null });
    }else if(e.type==='sale'){
      const costPerBag = avg!=null?avg:0;
      const costTotal = costPerBag * Number(e.bags||0);
      stock -= Number(e.bags||0);
      batch.update(doc.ref, { costPerBag: Math.round(costPerBag*100)/100, costTotal: Math.round(costTotal*100)/100 });
    }
  });
  batch.update(matRef, { stockBags: Math.round(stock*100)/100, pricePerBag: avg!=null?Math.round(avg*100)/100:null, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
  await batch.commit();
}


// patched: neutralize any lingering onclick handlers that hijack Quick buttons
(function(){
  try{
    var b1=document.getElementById('btnPurchase'); if(b1) b1.onclick=null;
    var b2=document.getElementById('btnSale'); if(b2) b2.onclick=null;
  }catch(e){}
})();
