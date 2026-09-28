// Bindawasub Admin — overview

async function loadOverview(){try{const d=await admin({action:"dashboard_summary"});const s=d.summary;$("mCustomers").textContent=s.customers;$("mProducts").textContent=s.products;$("mProviders").textContent=s.providers;$("mWallet").textContent=money(s.wallet_liability);$("mSales").textContent=money(s.sales);$("mProfit").textContent=money(s.profit);$("mSuccess").textContent=s.successful_transactions;$("mPending").textContent=s.pending_transactions;msg($("overviewMsg"),"Dashboard refreshed.","success")}catch(e){msg($("overviewMsg"),e.message,"error")}}
