/* =========================================================================
   Aditya Fertilizers — Pro Ledger (Client-only, localStorage persistence)
   - No external deps required; works instantly.
   - You can swap Storage with Firebase later by replacing the Storage object.
   ========================================================================= */

/* --------------------------- Utilities & Globals ------------------------ */
const $ = (q, el=document) => el.querySelector(q);
const $$ = (q, el=document) => Array.from(el.querySelectorAll(q));
const byId = id => document.getElementById(id);
const nowIso = () => new Date().toISOString();
const toLocalDate = d => (d ? new Date(d).toISOString().slice(0,10) : new Date().toISOString().slice(0,10));
const fmt = (n, d=2) => (n===null || n===undefined || isNaN(n)) ? '—' : Number(n).toFixed(d);
const parseNum = v => (v===null || v===undefined || v==='' ? null : Number(v));
const uid = () => Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4);
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
const sum = arr => arr.reduce((a,b)=>a+b,0);
const copy = x => JSON.parse(JSON.stringify(x));

/* Status / Loader */
const statusLabel = byId('statusLabel');
const loader = byId('globalLoader');
const loaderTitle = byId('loaderTitle');
const loaderText  = byId('loaderText');
function showLoader(title='Working…', text='Please wait'){
  loaderTitle.textContent = title;
  loaderText.textContent = text;
  loader.classList.add('active');
}
function hideLoader(){ loader.classList.remove('active'); }

/* Drawer */
const drawer = byId('drawer');
byId('hamb').addEventListener('click', ()=>{
  const expanded = drawer.classList.toggle('open');
  byId('hamb').setAttribute('aria-expanded', expanded ? 'true' : 'false');
});

/* --------------------------- Storage Layer ------------------------------ */
/* Schema:
   - companies: [{id,name,gstin,address,phone,fyStart,fyEnd}]
   - materials: { [companyId]: [{id,name,unit,kgPerBag,pricePerBag,lowStockBags}] }
   - parties:   { [companyId]: [{id,name,type,phone,gst,addr,openingBalance,openingType}] }
   - entries:   { [companyId]: [
       { id, date, createdAt, type, voucherNo, partyId, partyName, materialId, materialName,
         bags, unit, kgPerBag, pricePerBag, amount, note }
     ] }
*/
const LS_KEY = 'afs_pro_ledger_v1';

const Storage = {
  _load(){
    try {
      const raw = localStorage.getItem(LS_KEY);
      if(!raw) return { companies: [], materials:{}, parties:{}, entries:{} };
      return JSON.parse(raw);
    } catch(e){
      console.error('Load failed', e);
      return { companies: [], materials:{}, parties:{}, entries:{} };
    }
  },
  _save(state){ localStorage.setItem(LS_KEY, JSON.stringify(state)); },
  getState(){ return this._load(); },
  setState(next){ this._save(next); },

  listCompanies(){ return this._load().companies; },
  upsertCompany(c){
    const s = this._load();
    const i = s.companies.findIndex(x=>x.id===c.id);
    if(i>=0) s.companies[i]=c; else s.companies.push(c);
    s.materials[c.id] ||= [];
    s.parties[c.id]   ||= [];
    s.entries[c.id]   ||= [];
    this._save(s);
  },
  deleteCompany(id){
    const s = this._load();
    s.companies = s.companies.filter(c=>c.id!==id);
    delete s.materials[id]; delete s.parties[id]; delete s.entries[id];
    this._save(s);
  },

  listMaterials(cid){ return this._load().materials[cid] || []; },
  upsertMaterial(cid, m){
    const s = this._load(); s.materials[cid] ||= [];
    const i = s.materials[cid].findIndex(x=>x.id===m.id);
    if(i>=0) s.materials[cid][i]=m; else s.materials[cid].push(m);
    this._save(s);
  },
  deleteMaterial(cid, id){
    const s = this._load(); s.materials[cid] = (s.materials[cid]||[]).filter(m=>m.id!==id);
    this._save(s);
  },

  listParties(cid){ return this._load().parties[cid] || []; },
  upsertParty(cid, p){
    const s = this._load(); s.parties[cid] ||= [];
    const i = s.parties[cid].findIndex(x=>x.id===p.id);
    if(i>=0) s.parties[cid][i]=p; else s.parties[cid].push(p);
    this._save(s);
  },
  deleteParty(cid, id){
    const s = this._load(); s.parties[cid] = (s.parties[cid]||[]).filter(p=>p.id!==id);
    this._save(s);
  },

  listEntries(cid){ return (this._load().entries[cid] || []).sort((a,b)=> (a.date||'').localeCompare(b.date) || (a.createdAt||'').localeCompare(b.createdAt)); },
  upsertEntry(cid, e){
    const s = this._load(); s.entries[cid] ||= [];
    const i = s.entries[cid].findIndex(x=>x.id===e.id);
    if(i>=0) s.entries[cid][i]=e; else s.entries[cid].push(e);
    this._save(s);
  },
  deleteEntry(cid, id){
    const s = this._load(); s.entries[cid] = (s.entries[cid]||[]).filter(e=>e.id!==id);
    this._save(s);
  }
};

/* --------------------------- App State ---------------------------------- */
const state = {
  companyId: null,
  route: 'dashboard',   // dashboard | daybook | sales | purchases | ledger | parties | vouchers | manage | reports
  filter: { q:'', from:'', to:'', type:'' },
  lastUpdated: '—',
};

const companySelect = byId('companySelect');
const mainCompanyName = byId('mainCompanyName');
const lastUpdatedEl = byId('lastUpdated');
const modalRoot = byId('modalRoot');

/* --------------------------- Initial Seed (optional) -------------------- */
(function ensureSeed(){
  const s = Storage.getState();
  if(s.companies.length) return;
  const cid = uid();
  Storage.upsertCompany({
    id: cid, name: 'Aditya Fertilizers Suppliers', gstin:'', address:'', phone:'', fyStart: toLocalDate(), fyEnd: ''
  });
  Storage.upsertMaterial(cid, { id: uid(), name:'DAP', unit:'bags', kgPerBag:50, pricePerBag:1400, lowStockBags:20 });
  Storage.upsertMaterial(cid, { id: uid(), name:'Urea', unit:'bags', kgPerBag:45, pricePerBag:350, lowStockBags:40 });
  Storage.upsertParty(cid, { id: uid(), name:'Sharma Traders', type:'customer', phone:'', gst:'', addr:'', openingBalance:0, openingType:'debit' });
  Storage.upsertParty(cid, { id: uid(), name:'Green Agro Suppliers', type:'supplier', phone:'', gst:'', addr:'', openingBalance:0, openingType:'credit' });
})();

/* --------------------------- Router & Rendering ------------------------- */
const routes = {
  dashboard: renderDashboard,
  daybook:   renderDayBook,
  sales:     renderSalesRegister,
  purchases: renderPurchaseRegister,
  ledger:    renderLedgerHome,
  parties:   renderParties,
  vouchers:  renderVouchers,
  manage:    renderManage,
  reports:   renderReports
};
function setRoute(name){
  state.route = name;
  $$('.route').forEach(n=> n.hidden = n.dataset.route!==name);
  routes[name] && routes[name]();
}

/* Drawer menu wiring */
byId('menuDashboard').onclick = ()=> setRoute('dashboard');
byId('menuDaybook').onclick   = ()=> setRoute('daybook');
byId('menuSales').onclick     = ()=> setRoute('sales');
byId('menuPurchases').onclick = ()=> setRoute('purchases');
byId('menuLedger').onclick    = ()=> setRoute('ledger');
byId('menuParties').onclick   = ()=> setRoute('parties');
byId('menuVouchers').onclick  = ()=> setRoute('vouchers');
byId('menuManage').onclick    = ()=> setRoute('manage');
byId('menuExport').onclick    = exportAllCSV;
byId('menuExportLedger').onclick = exportLedgerCSV;

/* Quick actions */
byId('btnPurchase').onclick = ()=> {
  const mats = Storage.listMaterials(state.companyId);
  if(!state.companyId || mats.length===0) return alert('Select a company and add materials first.');
  openEntryDialog('purchase', { materialId: mats[0].id });
};
byId('btnSale').onclick = ()=> {
  const mats = Storage.listMaterials(state.companyId);
  if(!state.companyId || mats.length===0) return alert('Select a company and add materials first.');
  openEntryDialog('sale', { materialId: mats[0].id });
};
byId('btnVoucher').onclick = ()=> openVoucherDialog();
byId('btnHistory').onclick = ()=> setRoute('daybook');
byId('btnManage').onclick  = ()=> setRoute('manage');
byId('btnToday').onclick   = ()=> openTodayDialog();

/* Search bar wiring */
const searchBar = byId('searchBar');
const searchForm = byId('searchForm');
if(searchForm){
  searchForm.addEventListener('submit', e=>{
    e.preventDefault();
    state.filter.q = byId('searchText').value.trim();
    state.filter.from = byId('searchFrom').value;
    state.filter.to   = byId('searchTo').value;
    state.filter.type = byId('searchType').value;
    refreshCurrent();
  });
  byId('btnSearchReset').onclick = ()=>{
    searchForm.reset();
    state.filter = { q:'', from:'', to:'', type:'' };
    refreshCurrent();
  };
}

/* --------------------------- Company Selector --------------------------- */
function reloadCompanies(){
  const comps = Storage.listCompanies();
  companySelect.innerHTML = '';
  comps.forEach(c=>{
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.name;
    companySelect.appendChild(opt);
  });
  if(!state.companyId && comps[0]) state.companyId = comps[0].id;
  if(state.companyId) companySelect.value = state.companyId;
  onCompanyChanged();
}
companySelect.addEventListener('change', ()=>{
  state.companyId = companySelect.value || null;
  onCompanyChanged();
});
function onCompanyChanged(){
  const comp = Storage.listCompanies().find(c=>c.id===state.companyId);
  mainCompanyName.textContent = comp ? comp.name : 'Select a company';
  lastUpdatedEl.textContent = state.lastUpdated;
  statusLabel.textContent = 'Ready';
  setRoute(state.route); // rerender current route
  searchBar.hidden = !state.companyId;
  drawer.classList.remove('open');
}

/* --------------------------- Domain Logic -------------------------------- */
/* Derived stock & party balances are computed on the fly from entries + opening */
function computeDerived(){
  const cid = state.companyId; if(!cid) return { stock:{}, partyBal:{} };
  const entries = Storage.listEntries(cid);
  const materials = Storage.listMaterials(cid);
  const parties = Storage.listParties(cid);

  const stock = {}; // materialId -> { bagsIn, bagsOut, closingBags, avgCost }
  const totalCost = {}; // materialId -> total purchase amount (for avg)
  const totalBagsIn = {}; // materialId -> total purchase bags

  materials.forEach(m=>{
    stock[m.id] = { name:m.name, unit:m.unit||'bags', bagsIn:0, bagsOut:0, closingBags:0, avgCost:m.pricePerBag||0 };
    totalCost[m.id]=0; totalBagsIn[m.id]=0;
  });

  entries.forEach(e=>{
    const mid = e.materialId;
    const bags = Number(e.bags||0);
    const amt = Number(e.amount || (e.pricePerBag && bags ? e.pricePerBag*bags : 0));
    if(e.type==='purchase' && mid){
      stock[mid].bagsIn += bags;
      totalCost[mid]+= (e.pricePerBag? e.pricePerBag*bags : amt);
      totalBagsIn[mid]+= bags;
    } else if(e.type==='sale' && mid){
      stock[mid].bagsOut += bags;
    }
  });
  Object.keys(stock).forEach(mid=>{
    const S = stock[mid];
    S.closingBags = S.bagsIn - S.bagsOut;
    const tb = totalBagsIn[mid];
    S.avgCost = tb>0 ? (totalCost[mid]/tb) : (S.avgCost||0);
  });

  // Party balances
  // Convention: Debit = positive (customer owes us), Credit = negative (we owe)
  const partyBal = {}; // partyId -> running balance
  parties.forEach(p=>{
    const op = Number(p.openingBalance||0) * (p.openingType==='debit' ? 1 : -1);
    partyBal[p.id] = op;
  });
  entries.forEach(e=>{
    const pid = e.partyId;
    if(!pid) return;
    const amt = Number(e.amount || (e.pricePerBag && e.bags ? e.pricePerBag*e.bags : 0));
    switch(e.type){
      case 'sale':     partyBal[pid] = (partyBal[pid]||0) + amt; break; // debit
      case 'purchase': partyBal[pid] = (partyBal[pid]||0) - amt; break; // credit
      case 'receipt':  partyBal[pid] = (partyBal[pid]||0) - amt; break; // credit
      case 'payment':  partyBal[pid] = (partyBal[pid]||0) + amt; break; // debit
      case 'journal':  partyBal[pid] = (partyBal[pid]||0) + (Number(e.debit||0) - Number(e.credit||0)); break;
    }
  });

  return { stock, partyBal };
}

/* Helpers */
function filteredEntries(){
  const cid = state.companyId; if(!cid) return [];
  const { q, from, to, type } = state.filter;
  const ql = (q||'').toLowerCase();
  const ents = Storage.listEntries(cid);
  return ents.filter(e=>{
    if(type && e.type!==type) return false;
    if(from && (e.date||'') < from) return false;
    if(to   && (e.date||'') > to) return false;
    if(q){
      const hay = [
        e.partyName||'', e.materialName||'', e.note||'', e.voucherNo||'', e.type||'', e.unit||'',
        (e.amount!=null? String(e.amount):''), (e.pricePerBag!=null? String(e.pricePerBag):'')
      ].join(' ').toLowerCase();
      if(!hay.includes(ql)) return false;
    }
    return true;
  });
}

/* Voucher numbering (simple incremental per type) */
function nextVoucherNo(type){
  const cid = state.companyId; if(!cid) return '';
  const ents = Storage.listEntries(cid).filter(e=>e.type===type && e.voucherNo);
  const last = ents
    .map(e=>({n: Number(String(e.voucherNo).replace(/\D/g,'')) || 0, raw:e.voucherNo}))
    .sort((a,b)=> b.n - a.n)[0];
  const n = (last?.n || 0) + 1;
  const prefix = { sale:'S', purchase:'P', receipt:'R', payment:'PM', journal:'J' }[type] || 'V';
  return `${prefix}${String(n).padStart(4,'0')}`;
}

/* --------------------------- Renderers ---------------------------------- */
function refreshCurrent(){ routes[state.route] && routes[state.route](); }

/* Dashboard */
function renderDashboard(){
  const root = byId('dashboardArea'); root.innerHTML = '';
  if(!state.companyId){ root.appendChild($('#tpl-empty').content.cloneNode(true)); return; }

  const { stock } = computeDerived();
  const mats = Storage.listMaterials(state.companyId);
  if(!mats.length){ root.appendChild(cardInfo('No materials. Use Master Data to add materials.')); return; }

  const grid = document.createElement('div');
  grid.style.display='grid'; grid.style.gridTemplateColumns='repeat(auto-fill,minmax(260px,1fr))'; grid.style.gap='8px';

  mats.forEach(m=>{
    const card = $('#tpl-material-card').content.cloneNode(true);
    card.querySelector('.mat-name').textContent = m.name;
    const S = stock[m.id] || { closingBags:0, avgCost:m.pricePerBag||0 };
    card.querySelector('.mat-qty').textContent = `${fmt(S.closingBags,2)} ${m.unit||'bags'}`;
    card.querySelector('.mat-meta').textContent = `${m.kgPerBag||0} kg/bag • Low: ${m.lowStockBags||0} ${m.unit||'bags'}`;
    card.querySelector('.mat-price').textContent = `Avg cost: ₹${fmt(S.avgCost)}/bag`;
    card.querySelector('.mat-stockval').textContent = `Stock value: ₹${fmt(S.avgCost * (S.closingBags||0))}`;
    card.querySelector('.mat-sales').textContent = `Rate (last set): ₹${fmt(m.pricePerBag||0)}/bag`;

    card.querySelector('.mat-buy').onclick = ()=> openEntryDialog('purchase', { materialId: m.id });
    card.querySelector('.mat-sell').onclick = ()=> openEntryDialog('sale', { materialId: m.id });
    card.querySelector('.mat-edit').onclick = ()=> openMaterialDialog(m);

    grid.appendChild(card);
  });
  root.appendChild(grid);
}

/* Day Book */
function renderDayBook(){
  const root = byId('daybookArea'); root.innerHTML = '';
  if(!state.companyId){ root.appendChild($('#tpl-empty').content.cloneNode(true)); return; }

  const list = filteredEntries();
  if(!list.length){ root.appendChild(cardInfo('No entries for selected filters.')); return; }

  list.forEach(e=>{
    const card = $('#tpl-daybook-card').content.cloneNode(true);
    const badge = card.querySelector('.badge');
    badge.textContent = e.type.toUpperCase();
    badge.style.padding='2px 6px'; badge.style.borderRadius='3px'; badge.style.border='1px solid #e5e7eb'; badge.style.background='#fff';

    card.querySelector('.entry-title').textContent =
      (e.type==='sale'||e.type==='purchase')
        ? `${e.materialName || '—'} • ${e.bags||0} ${e.unit||'bags'} @ ₹${fmt(e.pricePerBag||0)}`
        : `${e.partyName || '—'} • ₹${fmt(e.amount||0)} (${e.type})`;

    card.querySelector('.entry-meta').textContent =
      `${e.date || toLocalDate()} • ${e.partyName || e.materialName || '—'} • Vch: ${e.voucherNo||'—'}`;

    card.querySelector('.entry-note').textContent = e.note || '';

    card.querySelector('.entry-time').textContent = new Date(e.createdAt||e.date).toLocaleString();

    card.querySelector('.entry-edit').onclick   = ()=> editEntry(e);
    card.querySelector('.entry-delete').onclick = ()=> deleteEntryConfirm(e);

    root.appendChild(card);
  });
}

/* Sales Register */
function renderSalesRegister(){
  const root = byId('salesArea'); root.innerHTML='';
  if(!state.companyId){ root.appendChild($('#tpl-empty').content.cloneNode(true)); return; }

  const list = filteredEntries().filter(e=>e.type==='sale');
  if(!list.length){ root.appendChild(cardInfo('No sales in selected filters.')); return; }

  const tbl = table([
    'Date','Voucher','Party','Material','Bags','Rate/Bag','Amount','Note','Actions'
  ]);
  list.forEach(e=>{
    const tr = document.createElement('tr');
    addTds(tr, [
      e.date, e.voucherNo||'—', e.partyName||'—', e.materialName||'—',
      fmt(e.bags,2), `₹${fmt(e.pricePerBag)}`, `₹${fmt(e.amount || (e.pricePerBag*e.bags))}`, e.note||'—'
    ]);
    const tdAct = document.createElement('td');
    const ed = btn('Edit','ghost', ()=>editEntry(e));
    const del = btn('Delete','danger', ()=>deleteEntryConfirm(e));
    tdAct.append(ed,' ',del); tr.appendChild(tdAct);
    tbl.tbody.appendChild(tr);
  });
  root.appendChild(tbl.wrap);
}

/* Purchase Register */
function renderPurchaseRegister(){
  const root = byId('purchasesArea'); root.innerHTML='';
  if(!state.companyId){ root.appendChild($('#tpl-empty').content.cloneNode(true)); return; }

  const list = filteredEntries().filter(e=>e.type==='purchase');
  if(!list.length){ root.appendChild(cardInfo('No purchases in selected filters.')); return; }

  const tbl = table([
    'Date','Voucher','Supplier','Material','Bags','Rate/Bag','Amount','Note','Actions'
  ]);
  list.forEach(e=>{
    const tr = document.createElement('tr');
    addTds(tr, [
      e.date, e.voucherNo||'—', e.partyName||'—', e.materialName||'—',
      fmt(e.bags,2), `₹${fmt(e.pricePerBag)}`, `₹${fmt(e.amount || (e.pricePerBag*e.bags))}`, e.note||'—'
    ]);
    const tdAct = document.createElement('td');
    const ed = btn('Edit','ghost', ()=>editEntry(e));
    const del = btn('Delete','danger', ()=>deleteEntryConfirm(e));
    tdAct.append(ed,' ',del); tr.appendChild(tdAct);
    tbl.tbody.appendChild(tr);
  });
  root.appendChild(tbl.wrap);
}

/* Ledger Home (party list + open ledger) */
function renderLedgerHome(){
  const root = byId('ledgerArea'); root.innerHTML='';
  if(!state.companyId){ root.appendChild($('#tpl-empty').content.cloneNode(true)); return; }

  const parties = Storage.listParties(state.companyId);
  const { partyBal } = computeDerived();
  if(!parties.length){ root.appendChild(cardInfo('No parties found. Add customers/suppliers in Parties.')); return; }

  const tbl = table(['Party','Type','Phone','GSTIN','Balance','Actions']);
  parties.forEach(p=>{
    const tr = document.createElement('tr');
    addTds(tr, [ p.name, p.type||'—', p.phone||'—', p.gst||'—', `₹${fmt(partyBal[p.id]||0)}` ]);
    const tdAct = document.createElement('td');
    tdAct.append(
      btn('Open Ledger','ghost', ()=> openPartyLedger(p)),
      ' ',
      btn('Edit','ghost', ()=> openPartyDialog(p)),
      ' ',
      btn('Delete','danger', ()=> deletePartyConfirm(p))
    );
    tr.appendChild(tdAct); tbl.tbody.appendChild(tr);
  });
  root.appendChild(tbl.wrap);
}

/* Parties master */
function renderParties(){
  const root = byId('partiesArea'); root.innerHTML='';
  if(!state.companyId){ root.appendChild($('#tpl-empty').content.cloneNode(true)); return; }

  root.appendChild(primaryBar([
    btn('Add Party','', ()=> openPartyDialog())
  ]));

  const parties = Storage.listParties(state.companyId);
  const { partyBal } = computeDerived();
  const tbl = table(['Party','Type','Phone','GSTIN','Opening','Balance','Actions']);
  parties.forEach(p=>{
    const tr = document.createElement('tr');
    addTds(tr, [
      p.name, p.type||'—', p.phone||'—', p.gst||'—',
      `${p.openingType==='debit'?'Dr':'Cr'} ₹${fmt(p.openingBalance||0)}`,
      `₹${fmt(partyBal[p.id]||0)}`
    ]);
    const tdAct = document.createElement('td');
    tdAct.append(
      btn('Ledger','ghost', ()=> openPartyLedger(p)),
      ' ',
      btn('Edit','ghost', ()=> openPartyDialog(p)),
      ' ',
      btn('Delete','danger', ()=> deletePartyConfirm(p))
    );
    tr.appendChild(tdAct); tbl.tbody.appendChild(tr);
  });
  root.appendChild(tbl.wrap);
}

/* Vouchers (non-stock) */
function renderVouchers(){
  const root = byId('vouchersArea'); root.innerHTML='';
  if(!state.companyId){ root.appendChild($('#tpl-empty').content.cloneNode(true)); return; }

  root.appendChild(primaryBar([
    btn('New Receipt','', ()=> openVoucherDialog('receipt')),
    btn('New Payment','', ()=> openVoucherDialog('payment')),
    btn('New Journal','ghost', ()=> openVoucherDialog('journal'))
  ]));

  const list = filteredEntries().filter(e=> e.type==='receipt' || e.type==='payment' || e.type==='journal');
  if(!list.length){ root.appendChild(cardInfo('No vouchers in selected filters.')); return; }

  const tbl = table(['Date','Voucher','Type','Party','Amount','Note','Actions']);
  list.forEach(e=>{
    const tr = document.createElement('tr');
    addTds(tr, [
      e.date, e.voucherNo||'—', e.type, e.partyName||'—', `₹${fmt(e.amount||0)}`, e.note||'—'
    ]);
    const tdAct = document.createElement('td');
    tdAct.append(btn('Edit','ghost', ()=> editEntry(e)),' ', btn('Delete','danger', ()=> deleteEntryConfirm(e)));
    tr.appendChild(tdAct); tbl.tbody.appendChild(tr);
  });
  root.appendChild(tbl.wrap);
}

/* Manage: Companies, Materials */
function renderManage(){
  const root = byId('manageArea'); root.innerHTML='';
  const compBar = primaryBar([
    btn('Add Company','', ()=> openCompanyDialog()),
    btn('Edit Company','ghost', ()=> {
      const c = Storage.listCompanies().find(x=>x.id===state.companyId);
      if(!c) return alert('Select a company first.');
      openCompanyDialog(c);
    }),
    btn('Delete Company','danger', ()=> {
      const c = Storage.listCompanies().find(x=>x.id===state.companyId);
      if(!c) return alert('Select a company first.');
      if(confirm(`Delete company "${c.name}" and ALL data?`)){
        Storage.deleteCompany(c.id); state.companyId=null; reloadCompanies();
      }
    })
  ]);
  root.appendChild(compBar);

  // Materials
  root.appendChild(sectionTitle('Materials'));
  root.appendChild(primaryBar([ btn('Add Material','', ()=> openMaterialDialog()) ]));

  const mats = Storage.listMaterials(state.companyId);
  if(!mats.length){ root.appendChild(cardInfo('No materials. Add one.')); }
  else {
    const tbl = table(['Material','Unit','Kg/Bag','Rate/Bag','Low stock','Actions']);
    mats.forEach(m=>{
      const tr = document.createElement('tr');
      addTds(tr, [m.name, m.unit||'bags', fmt(m.kgPerBag,2), `₹${fmt(m.pricePerBag)}`, fmt(m.lowStockBags,2)]);
      const tdAct = document.createElement('td');
      tdAct.append(btn('Edit','ghost', ()=> openMaterialDialog(m)),' ', btn('Delete','danger', ()=> deleteMaterialConfirm(m)));
      tr.appendChild(tdAct); tbl.tbody.appendChild(tr);
    });
    root.appendChild(tbl.wrap);
  }
}

/* Reports (basic placeholders you can extend) */
function renderReports(){
  const root = byId('reportsArea'); root.innerHTML='';
  root.appendChild(cardInfo('Reports coming soon: P&L, Stock valuation, GST outward/inward. Current app already supports CSV exports. Use Excel to generate statements meanwhile.'));
}

/* --------------------------- Ledger Drilldown --------------------------- */
function openPartyLedger(party){
  const cid = state.companyId; if(!cid) return;
  const parties = Storage.listParties(cid);
  const p = party || parties[0]; if(!p) return;

  const entries = Storage.listEntries(cid)
    .filter(e=> e.partyId===p.id || (e.partyName && e.partyName===p.name))
    .sort((a,b)=> (a.date||'').localeCompare(b.date) || (a.createdAt||'').localeCompare(b.createdAt));

  const wrap = document.createElement('div');
  wrap.className='card';

  const h = document.createElement('div');
  h.style.display='flex'; h.style.justifyContent='space-between'; h.style.alignItems='center'; h.style.marginBottom='8px';
  h.innerHTML = `<div><b>Ledger — ${p.name}</b><div class="tiny muted">${p.type || ''}</div></div>
                 <div>
                   <button class="btn ghost" id="ledExport">Export CSV</button>
                   <button class="btn" id="ledAddVch">New Voucher</button>
                 </div>`;
  wrap.appendChild(h);

  // Table
  const tbl = table(['Date','V.No','Description','Debit','Credit','Balance','Actions']);
  let bal = (p.openingType==='debit' ? 1 : -1) * Number(p.openingBalance||0);
  // Opening row
  {
    const tr = document.createElement('tr');
    addTds(tr, [p.openingDate||'—', '—', 'Opening Balance', bal>0? `₹${fmt(bal)}` : '—', bal<0? `₹${fmt(-bal)}` : '—', `₹${fmt(bal)}` ]);
    tbl.tbody.appendChild(tr);
  }

  entries.forEach(e=>{
    const tr = $('#tpl-ledger-row').content.cloneNode(true);
    tr.querySelector('.led-date').textContent = e.date || toLocalDate();
    tr.querySelector('.led-vno').textContent = e.voucherNo || '—';

    let debit=0, credit=0, desc='';
    if(e.type==='sale'){
      debit = Number(e.amount || (e.pricePerBag*e.bags));
      desc = `Sale • ${e.materialName||''} • ${fmt(e.bags,2)} ${e.unit||'bags'} @ ₹${fmt(e.pricePerBag)}`;
    } else if(e.type==='purchase'){
      credit = Number(e.amount || (e.pricePerBag*e.bags));
      desc = `Purchase • ${e.materialName||''} • ${fmt(e.bags,2)} ${e.unit||'bags'} @ ₹${fmt(e.pricePerBag)}`;
    } else if(e.type==='receipt'){
      credit = Number(e.amount||0); desc = 'Receipt';
    } else if(e.type==='payment'){
      debit = Number(e.amount||0); desc = 'Payment';
    } else if(e.type==='journal'){
      debit = Number(e.debit||0); credit = Number(e.credit||0); desc = 'Journal';
    }
    if(e.note) desc += ` • ${e.note}`;

    bal += (debit - credit);

    tr.querySelector('.led-desc').textContent = desc;
    tr.querySelector('.led-debit').textContent = debit? `₹${fmt(debit)}` : '—';
    tr.querySelector('.led-credit').textContent = credit? `₹${fmt(credit)}` : '—';
    tr.querySelector('.led-balance').textContent = `₹${fmt(bal)}`;

    tr.querySelector('.led-edit').onclick = ()=> editEntry(e);
    tr.querySelector('.led-delete').onclick = ()=> deleteEntryConfirm(e);
    tbl.tbody.appendChild(tr);
  });

  wrap.appendChild(tbl.wrap);

  showModal(wrap);

  byId('ledExport').onclick = ()=> exportSingleLedgerCSV(p.id, p.name);
  byId('ledAddVch').onclick = ()=> { closeModal(); openVoucherDialog('receipt', { partyId:p.id }); };
}

/* --------------------------- CRUD Dialogs ------------------------------- */
function openCompanyDialog(company){
  const isEdit = !!company;
  const d = dialog('Company', [
    input('Name','name', company?.name||''),
    input('GSTIN','gstin', company?.gstin||''),
    input('Address','address', company?.address||''),
    input('Phone','phone', company?.phone||''),
    input('FY Start','fyStart', company?.fyStart||toLocalDate(), 'date'),
    input('FY End','fyEnd', company?.fyEnd||'', 'date')
  ], [
    btn('Cancel','ghost', closeModal),
    btn(isEdit?'Update':'Create','', ()=>{
      const body = getFormValues(d.form);
      if(!body.name.trim()) return alert('Name required');
      const c = { id: company?.id || uid(), ...body };
      Storage.upsertCompany(c);
      state.companyId = c.id;
      reloadCompanies();
      closeModal();
    })
  ]);
  showModal(d.wrap);
}

function openMaterialDialog(material){
  if(!state.companyId) return alert('Select a company first.');
  const isEdit = !!material;
  const d = dialog('Material', [
    input('Name','name', material?.name||''),
    input('Unit','unit', material?.unit||'bags'),
    input('Kg per bag','kgPerBag', material?.kgPerBag||50, 'number', {step:'0.01',min:'0'}),
    input('Default rate / bag','pricePerBag', material?.pricePerBag||0, 'number', {step:'0.01',min:'0'}),
    input('Low stock (bags)','lowStockBags', material?.lowStockBags||0, 'number', {step:'0.01',min:'0'})
  ], [
    btn('Cancel','ghost', closeModal),
    btn(isEdit?'Update':'Create','', ()=>{
      const v = getFormValues(d.form);
      if(!v.name.trim()) return alert('Name required');
      const m = { id: material?.id || uid(), name:v.name, unit:v.unit||'bags', kgPerBag: parseNum(v.kgPerBag)||0,
                  pricePerBag: parseNum(v.pricePerBag)||0, lowStockBags: parseNum(v.lowStockBags)||0 };
      Storage.upsertMaterial(state.companyId, m);
      refreshCurrent();
      closeModal();
    })
  ]);
  showModal(d.wrap);
}

function deleteMaterialConfirm(m){
  if(confirm(`Delete material "${m.name}"?`)){
    Storage.deleteMaterial(state.companyId, m.id);
    refreshCurrent();
  }
}

function openPartyDialog(party){
  if(!state.companyId) return alert('Select a company first.');
  const isEdit = !!party;
  const d = dialog('Party', [
    input('Name','name', party?.name||''),
    select('Type','type', party?.type||'customer', [
      ['customer','Customer'], ['supplier','Supplier']
    ]),
    input('Phone','phone', party?.phone||''),
    input('GSTIN','gst', party?.gst||''),
    textarea('Address','addr', party?.addr||''),
    select('Opening Type','openingType', party?.openingType||'debit', [
      ['debit','Debit (Dr)'], ['credit','Credit (Cr)']
    ]),
    input('Opening Balance','openingBalance', party?.openingBalance||0, 'number', {step:'0.01',min:'0'})
  ], [
    btn('Cancel','ghost', closeModal),
    btn(isEdit?'Update':'Create','', ()=>{
      const v = getFormValues(d.form);
      if(!v.name.trim()) return alert('Name required');
      const p = {
        id: party?.id || uid(),
        name:v.name, type:v.type, phone:v.phone, gst:v.gst, addr:v.addr,
        openingType:v.openingType, openingBalance: parseNum(v.openingBalance)||0
      };
      Storage.upsertParty(state.companyId, p);
      refreshCurrent();
      closeModal();
    })
  ]);
  showModal(d.wrap);
}

function deletePartyConfirm(p){
  if(confirm(`Delete party "${p.name}"?`)){
    Storage.deleteParty(state.companyId, p.id);
    refreshCurrent();
  }
}

function openEntryDialog(type, preset={}){
  if(!state.companyId) return alert('Select a company first.');
  const mats = Storage.listMaterials(state.companyId);
  const parties = Storage.listParties(state.companyId);
  const isSale = type==='sale';
  const isPurchase = type==='purchase';
  const title = isSale? 'Add Sale' : 'Add Purchase';

  const d = dialog(title, [
    input('Date','date', toLocalDate(), 'date'),
    select('Material','materialId', preset.materialId || (mats[0]?.id||''), mats.map(m=>[m.id,m.name])),
    input('Bags','bags', 1, 'number', {step:'0.01',min:'0'}),
    input('Rate / bag','pricePerBag', mats.find(m=>m.id===preset.materialId)?.pricePerBag||0, 'number', {step:'0.01',min:'0'}),
    select(isSale?'Customer':'Supplier','partyId', preset.partyId || (parties[0]?.id||''), parties.map(p=>[p.id,p.name])),
    input('Voucher No.','voucherNo', nextVoucherNo(type)),
    input('Note','note','')
  ], [
    btn('Cancel','ghost', closeModal),
    btn('Save','', ()=>{
      const v = getFormValues(d.form);
      if(!v.materialId) return alert('Material required');
      const mat = Storage.listMaterials(state.companyId).find(x=>x.id===v.materialId);
      const party = Storage.listParties(state.companyId).find(x=>x.id===v.partyId);
      const bags = parseNum(v.bags)||0; const rate = parseNum(v.pricePerBag)||0;
      const e = {
        id: uid(), type, date: v.date||toLocalDate(), createdAt: nowIso(),
        voucherNo: v.voucherNo||nextVoucherNo(type),
        materialId: mat?.id, materialName: mat?.name, unit: mat?.unit||'bags', kgPerBag: mat?.kgPerBag||0,
        bags, pricePerBag: rate, amount: +(bags*rate).toFixed(2),
        partyId: party?.id, partyName: party?.name,
        note: v.note||''
      };
      Storage.upsertEntry(state.companyId, e);
      state.lastUpdated = new Date().toLocaleString();
      lastUpdatedEl.textContent = state.lastUpdated;
      refreshCurrent();
      closeModal();
    })
  ]);
  showModal(d.wrap);
}

function editEntry(e){
  if(e.type==='sale' || e.type==='purchase'){
    const mats = Storage.listMaterials(state.companyId);
    const parties = Storage.listParties(state.companyId);
    const d = dialog(`Edit ${e.type==='sale'?'Sale':'Purchase'}`, [
      input('Date','date', e.date, 'date'),
      select('Material','materialId', e.materialId, mats.map(m=>[m.id,m.name])),
      input('Bags','bags', e.bags, 'number', {step:'0.01',min:'0'}),
      input('Rate / bag','pricePerBag', e.pricePerBag, 'number', {step:'0.01',min:'0'}),
      select(e.type==='sale'?'Customer':'Supplier','partyId', e.partyId, parties.map(p=>[p.id,p.name])),
      input('Voucher No.','voucherNo', e.voucherNo||''),
      input('Note','note', e.note||'')
    ], [
      btn('Cancel','ghost', closeModal),
      btn('Update','', ()=>{
        const v = getFormValues(d.form);
        const mat = Storage.listMaterials(state.companyId).find(x=>x.id===v.materialId);
        const party = Storage.listParties(state.companyId).find(x=>x.id===v.partyId);
        const bags = parseNum(v.bags)||0; const rate = parseNum(v.pricePerBag)||0;
        const updated = { ...e,
          date:v.date, voucherNo:v.voucherNo, materialId:mat?.id, materialName:mat?.name,
          bags, pricePerBag:rate, amount:+(bags*rate).toFixed(2), partyId:party?.id, partyName:party?.name, note:v.note||''
        };
        Storage.upsertEntry(state.companyId, updated);
        state.lastUpdated = new Date().toLocaleString();
        lastUpdatedEl.textContent = state.lastUpdated;
        refreshCurrent();
        closeModal();
      })
    ]);
    showModal(d.wrap);
  } else {
    // receipt/payment/journal
    openVoucherDialog(e.type, e);
  }
}

function deleteEntryConfirm(e){
  if(confirm('Delete this entry?')){
    Storage.deleteEntry(state.companyId, e.id);
    refreshCurrent();
  }
}

function openVoucherDialog(type='receipt', existing){
  if(!state.companyId) return alert('Select a company first.');
  const parties = Storage.listParties(state.companyId);
  const isEdit = !!existing;

  const fields = [
    input('Date','date', existing?.date||toLocalDate(), 'date'),
    select('Party','partyId', existing?.partyId || (parties[0]?.id||''), parties.map(p=>[p.id,p.name])),
    input('Voucher No.','voucherNo', existing?.voucherNo || nextVoucherNo(type)),
    input('Amount (₹)','amount', existing?.amount||0, 'number', {step:'0.01',min:'0'}),
    input('Note','note', existing?.note||'')
  ];
  if(type==='journal'){
    fields.splice(3,1,
      input('Debit (₹)','debit', existing?.debit||0, 'number', {step:'0.01',min:'0'}),
      input('Credit (₹)','credit', existing?.credit||0, 'number', {step:'0.01',min:'0'})
    );
  }

  const d = dialog(isEdit? `Edit ${type}` : `New ${type}`, fields, [
    btn('Cancel','ghost', closeModal),
    btn(isEdit?'Update':'Save','', ()=>{
      const v = getFormValues(d.form);
      const party = Storage.listParties(state.companyId).find(x=>x.id===v.partyId);
      const base = {
        id: existing?.id || uid(), type, date: v.date||toLocalDate(), createdAt: existing?.createdAt || nowIso(),
        voucherNo: v.voucherNo || nextVoucherNo(type),
        partyId: party?.id || null, partyName: party?.name || null,
        note: v.note||''
      };
      if(type==='journal'){
        base.debit = parseNum(v.debit)||0;
        base.credit = parseNum(v.credit)||0;
        base.amount = null;
      } else {
        base.amount = parseNum(v.amount)||0;
      }
      Storage.upsertEntry(state.companyId, base);
      state.lastUpdated = new Date().toLocaleString();
      lastUpdatedEl.textContent = state.lastUpdated;
      refreshCurrent();
      closeModal();
    })
  ]);
  showModal(d.wrap);
}

/* Today dialog: quick add sales/purchases for a date */
function openTodayDialog(){
  const d = dialog('Add Today\'s Entries', [
    input('Date','date', toLocalDate(), 'date'),
  ], [
    btn('Close','ghost', closeModal),
    btn('Add Sale','', ()=>{
      const v = getFormValues(d.form);
      closeModal(); openEntryDialog('sale', { date:v.date });
    }),
    btn('Add Purchase','ghost', ()=>{
      const v = getFormValues(d.form);
      closeModal(); openEntryDialog('purchase', { date:v.date });
    })
  ]);
  showModal(d.wrap);
}

/* --------------------------- Exports ------------------------------------ */
function exportAllCSV(){
  if(!state.companyId) return alert('Select a company');
  const comps = Storage.listCompanies();
  const comp = comps.find(c=>c.id===state.companyId);
  const mats = Storage.listMaterials(state.companyId);
  const parties = Storage.listParties(state.companyId);
  const entries = Storage.listEntries(state.companyId);

  const rows = [];
  rows.push(['Company', comp?.name || '']);
  rows.push([]);
  rows.push(['Materials']);
  rows.push(['id','name','unit','kgPerBag','pricePerBag','lowStockBags']);
  mats.forEach(m=> rows.push([m.id,m.name,m.unit,m.kgPerBag,m.pricePerBag,m.lowStockBags]));
  rows.push([]);
  rows.push(['Parties']);
  rows.push(['id','name','type','phone','gst','addr','openingType','openingBalance']);
  parties.forEach(p=> rows.push([p.id,p.name,p.type,p.phone,p.gst,p.addr,p.openingType,p.openingBalance]));
  rows.push([]);
  rows.push(['Entries']);
  rows.push(['id','date','type','voucherNo','partyId','partyName','materialId','materialName','bags','unit','kgPerBag','pricePerBag','amount','note','createdAt']);
  entries.forEach(e=> rows.push([e.id,e.date,e.type,e.voucherNo,e.partyId||'',e.partyName||'',e.materialId||'',e.materialName||'',e.bags||'',e.unit||'',e.kgPerBag||'',e.pricePerBag||'',e.amount||'',e.note||'',e.createdAt||'']));

  downloadCSV('export_all.csv', rows);
}

function exportLedgerCSV(){
  if(!state.companyId) return alert('Select a company');
  const parties = Storage.listParties(state.companyId);
  const rows = [['party','date','voucherNo','type','desc','debit','credit','balance']];
  parties.forEach(p=>{
    const ledger = buildPartyLedger(p);
    ledger.lines.forEach(line=>{
      rows.push([p.name, line.date, line.vno, line.type, line.desc, line.debit, line.credit, line.balance]);
    });
  });
  downloadCSV('ledger_all_parties.csv', rows);
}

function exportSingleLedgerCSV(partyId, partyName='party'){
  const p = Storage.listParties(state.companyId).find(x=>x.id===partyId);
  if(!p) return;
  const ledger = buildPartyLedger(p);
  const rows = [['date','voucherNo','type','desc','debit','credit','balance']];
  ledger.lines.forEach(l=> rows.push([l.date,l.vno,l.type,l.desc,l.debit,l.credit,l.balance]));
  downloadCSV(`ledger_${partyName.replace(/\s+/g,'_')}.csv`, rows);
}

function buildPartyLedger(p){
  const entries = Storage.listEntries(state.companyId)
    .filter(e=> e.partyId===p.id || (e.partyName && e.partyName===p.name))
    .sort((a,b)=> (a.date||'').localeCompare(b.date) || (a.createdAt||'').localeCompare(b.createdAt));

  let bal = (p.openingType==='debit' ? 1 : -1) * Number(p.openingBalance||0);
  const lines = [{
    date: p.openingDate || '',
    vno: '', type:'opening', desc:'Opening Balance',
    debit: bal>0? bal : '', credit: bal<0? -bal : '', balance: bal
  }];

  entries.forEach(e=>{
    let debit=0, credit=0, desc='';
    if(e.type==='sale'){ debit = Number(e.amount || (e.pricePerBag*e.bags)); desc = `Sale — ${e.materialName||''}`; }
    else if(e.type==='purchase'){ credit = Number(e.amount || (e.pricePerBag*e.bags)); desc = `Purchase — ${e.materialName||''}`; }
    else if(e.type==='receipt'){ credit = Number(e.amount||0); desc='Receipt'; }
    else if(e.type==='payment'){ debit = Number(e.amount||0); desc='Payment'; }
    else if(e.type==='journal'){ debit = Number(e.debit||0); credit = Number(e.credit||0); desc='Journal'; }
    if(e.note) desc += ` • ${e.note}`;
    bal += (debit - credit);
    lines.push({ date:e.date, vno:e.voucherNo||'', type:e.type, desc, debit:debit||'', credit:credit||'', balance: bal });
  });

  return { opening: bal, lines };
}

/* --------------------------- Widgets / UI helpers ----------------------- */
function btn(text, cls='', onClick){
  const b = document.createElement('button'); b.className = 'btn ' + (cls||''); b.type='button'; b.textContent=text; if(onClick) b.onclick=onClick; return b;
}
function cardInfo(text){
  const d = document.createElement('div'); d.className='card'; d.textContent = text; return d;
}
function sectionTitle(text){
  const h = document.createElement('div'); h.style.fontWeight='700'; h.style.margin='8px 0'; h.textContent=text; return h;
}
function table(headers){
  const wrap = document.createElement('div'); wrap.className='card';
  const tbl = document.createElement('table');
  const thead = document.createElement('thead'); const tr = document.createElement('tr');
  headers.forEach(h=> { const th=document.createElement('th'); th.textContent=h; tr.appendChild(th); });
  thead.appendChild(tr); const tbody = document.createElement('tbody');
  tbl.append(thead, tbody); wrap.appendChild(tbl);
  return { wrap, tbody };
}
function addTds(tr, arr){
  arr.forEach(v=> { const td=document.createElement('td'); td.textContent = v; tr.appendChild(td); });
}

function primaryBar(items){
  const bar = document.createElement('div'); bar.className='card'; bar.style.display='flex'; bar.style.gap='8px'; bar.style.flexWrap='wrap';
  items.forEach(i=> bar.appendChild(i));
  return bar;
}

/* --------------------------- Modal -------------------------------------- */
function showModal(content){
  modalRoot.innerHTML='';
  const overlay = document.createElement('div');
  overlay.style.position='fixed'; overlay.style.inset='0'; overlay.style.background='rgba(0,0,0,.2)';
  overlay.style.display='flex'; overlay.style.alignItems='center'; overlay.style.justifyContent='center';
  overlay.style.zIndex='3000';
  const box = document.createElement('div'); box.className='card'; box.style.minWidth='300px'; box.style.maxWidth='95vw';
  if(content instanceof HTMLElement) box.appendChild(content); else box.innerHTML = content;
  overlay.appendChild(box);
  overlay.addEventListener('click', e=> { if(e.target===overlay) closeModal(); });
  modalRoot.appendChild(overlay);
}
function closeModal(){ modalRoot.innerHTML=''; }

/* Quick form builders */
function dialog(title, fields, actions){
  const wrap = document.createElement('div');
  const head = document.createElement('div'); head.style.display='flex'; head.style.justifyContent='space-between'; head.style.alignItems='center';
  const htxt = document.createElement('div'); htxt.style.fontWeight='700'; htxt.textContent = title;
  const x = btn('×','ghost', closeModal); x.style.fontWeight='700'; x.style.padding='2px 8px';
  head.append(htxt, x);

  const form = document.createElement('form'); form.onsubmit = e=> e.preventDefault();
  fields.forEach(f=> form.appendChild(f));

  const bar = document.createElement('div'); bar.style.display='flex'; bar.style.gap='8px'; bar.style.justifyContent='flex-end'; bar.style.marginTop='12px';
  actions.forEach(a=> bar.appendChild(a));

  wrap.append(head, document.createElement('hr'), form, bar);
  return { wrap, form };
}

function input(label, name, value='', type='text', attrs={}){
  const w = document.createElement('div'); w.className='search-field'; // reuse style
  const l = document.createElement('label'); l.textContent=label; l.htmlFor=name;
  const i = document.createElement('input'); i.id=name; i.name=name; i.type=type; i.value = value ?? '';
  Object.entries(attrs||{}).forEach(([k,v])=> i.setAttribute(k,v));
  w.append(l,i); return w;
}
function textarea(label, name, value=''){
  const w = document.createElement('div'); w.className='search-field';
  const l = document.createElement('label'); l.textContent=label; l.htmlFor=name;
  const ta = document.createElement('textarea'); ta.id=name; ta.name=name; ta.value=value||''; ta.rows=3; ta.style.resize='vertical';
  w.append(l,ta); return w;
}
function select(label, name, value, options){
  const w = document.createElement('div'); w.className='search-field';
  const l = document.createElement('label'); l.textContent=label; l.htmlFor=name;
  const s = document.createElement('select'); s.id=name; s.name=name;
  options.forEach(([val, txt])=> {
    const o = document.createElement('option'); o.value=val; o.textContent=txt;
    if(String(val)===String(value)) o.selected=true;
    s.appendChild(o);
  });
  w.append(l,s); return w;
}
function getFormValues(form){
  const fd = new FormData(form); const obj={};
  for(const [k,v] of fd.entries()){ obj[k]=v; }
  return obj;
}

/* CSV helper */
function downloadCSV(filename, rows){
  const csv = rows.map(r=> r.map(cell=>{
    const s = (cell===undefined || cell===null) ? '' : String(cell);
    if(s.includes('"')) return `"${s.replace(/"/g,'""')}"`;
    if(s.includes(',') || s.includes('\n')) return `"${s}"`;
    return s;
  }).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}

/* --------------------------- Boot --------------------------------------- */
function boot(){
  try{
    statusLabel.textContent = 'Initializing…';
    reloadCompanies();
    statusLabel.textContent = 'Ready';
  }catch(e){
    console.error(e);
    statusLabel.textContent = 'Init failed';
  }
}
boot();
