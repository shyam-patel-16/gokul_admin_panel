
        // Database state setup
        let db = { orders: [], payments: [], parties: [] };
        let activeBusiness = null;
        let companiesList = JSON.parse(localStorage.getItem('biz_companies_list')) || ['ABS', 'PP'];
        let activeParty = "";
        let firestoreDb = null;
        let unsubOrders = null;
        let unsubPayments = null;
        let unsubParties = null;
        let isFirebaseConnected = false;
        let currentTab = "dashboard";
        let currentSubTab = "orders";
        let auth = null;
        let businessChartInstance = null;
        let currentChartPeriod = 'weekly';

        function formatBusinessDate(dateValue) {
            if (!dateValue) return '';
            const parts = String(dateValue).split('-');
            if (parts.length !== 3) return dateValue;

            const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
            if (Number.isNaN(date.getTime())) return dateValue;

            return date.toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'long',
                year: 'numeric'
            });
        }

        function formatShortBusinessDate(dateValue) {
            if (!dateValue) return '';
            const parts = String(dateValue).split('-');
            if (parts.length !== 3) return dateValue;

            const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
            if (Number.isNaN(date.getTime())) return dateValue;

            return date.toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric'
            });
        }

        function getDateSortValue(dateValue) {
            const parts = String(dateValue || '').split('-');
            if (parts.length !== 3) return 0;

            const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
            return Number.isNaN(date.getTime()) ? 0 : date.getTime();
        }

        function compareLedgerRecords(a, b) {
            const dateDiff = getDateSortValue(a.date) - getDateSortValue(b.date);
            if (dateDiff !== 0) return dateDiff;
            return (a.timestamp || a.id || 0) - (b.timestamp || b.id || 0);
        }

        function normalizePartyName(partyName) {
            return String(partyName || '').trim().replace(/\s+/g, ' ');
        }

        function getPartyMetaByName(partyName) {
            const normalized = normalizePartyName(partyName).toLowerCase();
            return (db.parties || []).find(p => normalizePartyName(p.name).toLowerCase() === normalized) || null;
        }

        function getPartyMetaById(partyId) {
            return (db.parties || []).find(p => p.partyId === partyId) || null;
        }

        function getNextPartyId() {
            const maxId = (db.parties || []).reduce((max, party) => {
                const match = String(party.partyId || '').match(/^PARTY_(\d+)$/);
                return match ? Math.max(max, Number(match[1])) : max;
            }, 1000);

            return `PARTY_${maxId + 1}`;
        }

        function getPartyQrPayload(partyId) {
            return JSON.stringify({ partyId });
        }

        function getPartyQrScanUrl(partyId) {
            const baseUrl = `${window.location.origin}${window.location.pathname}`;
            return `${baseUrl}?partyId=${encodeURIComponent(partyId)}`;
        }

        function ensureDbShape() {
            if (!db.orders) db.orders = [];
            if (!db.payments) db.payments = [];
            if (!db.parties) db.parties = [];

            const names = new Set();
            db.orders.forEach(o => { if (o.party) names.add(normalizePartyName(o.party)); });
            db.payments.forEach(p => { if (p.party) names.add(normalizePartyName(p.party)); });
            names.forEach(name => ensurePartyMeta(name, { persist: false }));
        }

        function savePartyMetaToFirebase(partyMeta) {
            if (!isFirebaseConnected || !firestoreDb || !activeBusiness || !partyMeta) return;

            const partiesCol = activeBusiness === 'ABS' ? 'parties' : activeBusiness + '_parties';
            firestoreDb.collection(partiesCol).doc(partyMeta.partyId).set(partyMeta, { merge: true })
                .catch(err => console.error('Party QR save error:', err));
        }

        function ensurePartyMeta(partyName, options = {}) {
            const persist = options.persist !== false;
            const normalizedName = normalizePartyName(partyName);
            if (!normalizedName) return null;

            if (!db.parties) db.parties = [];
            let partyMeta = getPartyMetaByName(normalizedName);
            if (partyMeta) return partyMeta;

            const partyId = getNextPartyId();
            const qrPayload = getPartyQrPayload(partyId);
            partyMeta = {
                partyId,
                name: normalizedName,
                qrPayload,
                qrScanUrl: getPartyQrScanUrl(partyId),
                createdAt: Date.now()
            };

            db.parties.push(partyMeta);

            if (persist) {
                localStorage.setItem(`biz_db_${activeBusiness}`, JSON.stringify(db));
                savePartyMetaToFirebase(partyMeta);
            }

            return partyMeta;
        }

        // Save data local storage and trigger UI updates
        function saveData() {
            if (activeBusiness) {
                ensureDbShape();
                // Ensure data is ALWAYS saved in date-wise (chronological) order
                db.orders.sort((a, b) => (a.timestamp || a.id) - (b.timestamp || b.id));
                db.payments.sort((a, b) => (a.timestamp || a.id) - (b.timestamp || b.id));

                localStorage.setItem(`biz_db_${activeBusiness}`, JSON.stringify(db));
            }
            calculateDashboard();
            renderDashboardRecent();
            renderParties();
            if (activeParty) showPartyDetails(activeParty);
            renderAllOrders();
            renderAllPayments();
        }

        // Helper to get filtered and sorted records for a party (DRY principle)
        function getFilteredPartyRecords(party) {
            let partyOrders = db.orders.filter(o => o.party === party);
            let partyPayments = db.payments.filter(p => p.party === party);

            const startInput = document.getElementById('pdf-start-date');
            const endInput = document.getElementById('pdf-end-date');
            const startDate = startInput ? startInput.value : '';
            const endDate = endInput ? endInput.value : '';
            const filterType = document.getElementById('ledger-filter-type')?.value || 'All';
            const filterStatus = document.getElementById('ledger-filter-status')?.value || 'All';

            // Strict Date Filtering
            if (startDate) {
                partyOrders = partyOrders.filter(o => o.date >= startDate);
                partyPayments = partyPayments.filter(p => p.date >= startDate);
            }
            if (endDate) {
                partyOrders = partyOrders.filter(o => o.date <= endDate);
                partyPayments = partyPayments.filter(p => p.date <= endDate);
            }

            // Type Filtering
            if (filterType !== 'All') {
                partyOrders = partyOrders.filter(o => o.type === filterType);
                partyPayments = partyPayments.filter(p => p.type === filterType);
            }

            // Status Filtering (Only applies to orders)
            if (filterStatus !== 'All') {
                partyOrders = partyOrders.filter(o => o.status === filterStatus);
                // If filtering by order status, usually payments are irrelevant to that specific status
                if (filterStatus !== 'All' && filterType === 'All') {
                   // Keep payments only if user hasn't explicitly filtered by "Sales" or "Buying"
                   // but most users expect payments to disappear if they filter by order status
                   partyPayments = [];
                }
            }

            // Sorting: Chronological (Oldest to Newest) for ledger logic,
            // but we'll reverse for "newest first" UI if needed.
            const sortFn = (a, b) => (a.timestamp || a.id) - (b.timestamp || b.id);
            partyOrders.sort(sortFn);
            partyPayments.sort(sortFn);

            return { partyOrders, partyPayments, startDate, endDate, filterType, filterStatus };
        }

        // Render Companies UI across the app
        function renderCompaniesUI() {
            let sidebarSelect = document.getElementById('sidebar-business-select');
            let mobileSelect  = document.getElementById('mobile-business-select');
            let grid          = document.getElementById('business-selection-grid');
            let table         = document.getElementById('companies-table-body');

            let selectOptions = '';
            let gridHTML      = '';
            let tableHTML     = '';

            // Color palette — cycles for unlimited companies (using inline styles to avoid Tailwind purge)
            let colorData = [
                { border: '#c7d2fe', hoverBorder: '#6366f1', iconBg: '#e0e7ff', iconColor: '#4338ca' },
                { border: '#a7f3d0', hoverBorder: '#10b981', iconBg: '#d1fae5', iconColor: '#047857' },
                { border: '#fde68a', hoverBorder: '#f59e0b', iconBg: '#fef3c7', iconColor: '#b45309' },
                { border: '#fecaca', hoverBorder: '#ef4444', iconBg: '#fee2e2', iconColor: '#b91c1c' },
                { border: '#a5f3fc', hoverBorder: '#06b6d4', iconBg: '#cffafe', iconColor: '#0e7490' },
                { border: '#ddd6fe', hoverBorder: '#8b5cf6', iconBg: '#ede9fe', iconColor: '#6d28d9' },
                { border: '#fbcfe8', hoverBorder: '#ec4899', iconBg: '#fce7f3', iconColor: '#be185d' },
                { border: '#fed7aa', hoverBorder: '#f97316', iconBg: '#ffedd5', iconColor: '#c2410c' },
            ];

            // Icon pool — cycles for unlimited companies
            let icons = ['fa-boxes-packing', 'fa-cubes', 'fa-cube', 'fa-layer-group', 'fa-industry', 'fa-warehouse', 'fa-truck', 'fa-box'];

            companiesList.forEach((company, index) => {
                let cd   = colorData[index % colorData.length];
                let icon = icons[index % icons.length];

                // Dropdown options
                selectOptions += `<option value="${company}">${company}</option>`;

                // Business Selection Grid cards — inline styles for color
                gridHTML += `
                <button onclick="selectBusiness('${company}')"
                    style="border-color: ${cd.border};"
                    onmouseover="this.style.borderColor='${cd.hoverBorder}'; this.style.boxShadow='0 10px 25px -5px ${cd.hoverBorder}33';"
                    onmouseout="this.style.borderColor='${cd.border}'; this.style.boxShadow='none';"
                    class="flex flex-col items-center justify-center p-6 bg-slate-50 border-2 rounded-2xl transition-all duration-200 group">
                    <div style="background:${cd.iconBg}; color:${cd.iconColor};"
                        class="w-16 h-16 rounded-full flex items-center justify-center text-3xl mb-4 group-hover:scale-110 transition-transform">
                        <i class="fa-solid ${icon}"></i>
                    </div>
                    <h3 class="font-black text-slate-800 text-lg">${company}</h3>
                    <p class="text-[10px] text-slate-500 font-medium mt-1">${company} નો ડેટા જોવા માટે</p>
                </button>`;

                // Settings Table rows
                let collectionLabel = company === 'ABS' ? 'orders / payments' : `${company}_orders / ${company}_payments`;
                tableHTML += `
                <tr>
                    <td class="p-3">
                        <div class="flex items-center gap-2">
                            <div style="background:${cd.iconBg}; color:${cd.iconColor};" class="w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0">
                                <i class="fa-solid ${icon} text-[11px]"></i>
                            </div>
                            <div>
                                <div class="font-bold text-slate-800 text-xs">${company}</div>
                                <div class="text-[9px] text-slate-400 font-medium">Firebase: ${collectionLabel}</div>
                            </div>
                        </div>
                    </td>
                    <td class="p-3 text-center">
                        <button onclick="deleteCompany('${company}')"
                            class="bg-red-50 hover:bg-red-100 text-red-500 p-1.5 rounded-lg transition"
                            title="ડિલીટ કરો">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </td>
                </tr>`;
            });

            if (sidebarSelect) {
                sidebarSelect.innerHTML = selectOptions;
                if (activeBusiness) sidebarSelect.value = activeBusiness;
            }
            if (mobileSelect) {
                mobileSelect.innerHTML = selectOptions;
                if (activeBusiness) mobileSelect.value = activeBusiness;
            }
            if (grid)  grid.innerHTML  = gridHTML;
            if (table) table.innerHTML = tableHTML;
        }

        function saveCompaniesList() {
            localStorage.setItem('biz_companies_list', JSON.stringify(companiesList));
            if (isFirebaseConnected && firestoreDb) {
                firestoreDb.collection('system').doc('settings').set({ companies: companiesList }, { merge: true })
                    .catch(err => console.error("Error saving companies to cloud:", err));
            }
            renderCompaniesUI();
        }

        function addNewCompany() {
            let newCompany = prompt("નવી કંપનીનું નામ લખો:\n(ઉદા. PVC, LDPE, HDPE, LLDPE)");
            if (!newCompany || newCompany.trim() === "") return;
            // Keep alphanumeric + spaces, trim and uppercase
            newCompany = newCompany.trim().replace(/\s+/g, ' ');
            if (newCompany.length < 2) return alert("નામ ઓછામાં ઓછા 2 અક્ષરનું હોવું જોઈએ.");

            // Check duplicate (case-insensitive)
            if (companiesList.some(c => c.toLowerCase() === newCompany.toLowerCase())) {
                return alert(`"${newCompany}" નામની કંપની પહેલેથી જ છે!`);
            }

            companiesList.push(newCompany);
            saveCompaniesList();
            alert(`✅ "${newCompany}" કંપની સફળતાપૂર્વક ઉમેરવામાં આવી!\n\nહવે Business Selection Screen પર ક્લિક કરો.`);
        }


        async function deleteCompany(companyName) {
            if (companiesList.length <= 1) return alert("તમે બધી કંપની ડીલીટ ન કરી શકો. ઓછામાં ઓછી 1 કંપની હોવી જરૂરી છે.");
            
            let pass = prompt(`ચેતવણી! શું તમે ખરેખર ${companyName} ડીલીટ કરવા માંગો છો?\nઆ કંપનીના બધા ઓર્ડર અને પેમેન્ટ કાયમ માટે ઉડી જશે!\n\nજો હા, તો તમારો લોગીન પાસવર્ડ દાખલ કરો:`);
            if (!pass) return;

            if (isFirebaseConnected && auth && auth.currentUser) {
                try {
                    // Re-authenticate user
                    let cred = firebase.auth.EmailAuthProvider.credential(auth.currentUser.email, pass);
                    await auth.currentUser.reauthenticateWithCredential(cred);
                    
                    // Password correct, proceed to delete
                    companiesList = companiesList.filter(c => c !== companyName);
                    saveCompaniesList();
                    
                    alert(`${companyName} કંપની ડીલીટ થઈ ગઈ છે!`);
                    
                    if (activeBusiness === companyName) {
                        activeBusiness = null;
                        showBusinessSelection();
                    }
                } catch (error) {
                    alert("પાસવર્ડ ખોટો છે! કંપની ડીલીટ ન થઈ શકી.");
                }
            } else {
                alert("ઇન્ટરનેટ/ફાયરબેઝ કનેક્શન નથી. કંપની ડીલીટ કરવા ઓનલાઇન થવું જરૂરી છે.");
            }
        }

        // Business Selection Flow
        function showBusinessSelection() {
            renderCompaniesUI();
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('business-selection-screen').classList.remove('hidden');
            document.getElementById('business-selection-screen').classList.add('flex');
            
            // Hide main app
            document.getElementById('sidebar').classList.remove('md:flex');
            document.getElementById('sidebar').classList.add('hidden');
            document.getElementById('main-content').classList.add('hidden');
            document.querySelector('header').classList.add('hidden');
            document.querySelector('nav').classList.add('hidden');
        }

        function selectBusiness(business) {
            activeBusiness = business;
            db = JSON.parse(localStorage.getItem(`biz_db_${activeBusiness}`)) || { orders: [], payments: [] };
            ensureDbShape();
            localStorage.setItem(`biz_db_${activeBusiness}`, JSON.stringify(db));
            
            document.getElementById('business-selection-screen').classList.add('hidden');
            document.getElementById('business-selection-screen').classList.remove('flex');

            // Show main app
            document.getElementById('sidebar').classList.remove('hidden');
            document.getElementById('sidebar').classList.add('md:flex');
            document.getElementById('main-content').classList.remove('hidden');
            document.querySelector('header').classList.remove('hidden');
            document.querySelector('nav').classList.remove('hidden');
            
            // Update UI Selectors and re-render company dropdowns (keeps active selection in sync)
            renderCompaniesUI();
            

            // Re-listen data for selected business
            if (unsubOrders) { unsubOrders(); unsubOrders = null; }
            if (unsubPayments) { unsubPayments(); unsubPayments = null; }
            if (isFirebaseConnected) {
                listenFirebaseData();
            } else {
                saveData(); // Refresh UI with local storage if offline
            }
        }

        // ══════════════════════════════════════════════════════════════
        // FIREBASE CONFIGURATION (Like .env variables)
        // ══════════════════════════════════════════════════════════════
        // Variables are now loaded from assets/js/env.js
        // const ENV_FIREBASE_CONFIG = ...

        // Initialize Firebase logic
        function initFirebase() {
            const statusBadge = document.getElementById('firebase-status-badge');
            const mobileDot = document.getElementById('mobile-firebase-status-dot');

            if (unsubOrders) { unsubOrders(); unsubOrders = null; }
            if (unsubPayments) { unsubPayments(); unsubPayments = null; }

            if (typeof firebase === 'undefined') {
                isFirebaseConnected = false;
                firestoreDb = null;
                if (statusBadge) {
                    statusBadge.className = "w-full text-center text-[11px] bg-red-950/40 border border-red-900 text-red-400 py-2 px-3 rounded-xl flex items-center justify-center gap-2 font-medium";
                    statusBadge.innerHTML = `<span class="w-2 h-2 bg-red-500 rounded-full"></span><span>Firebase SDK Load Error</span>`;
                }
                calculateDashboard();
                renderDashboardRecent();
                renderParties();
                if (currentTab === 'settings') renderSettingsConfig();

                // Show login screen if Firebase fails to load so UI is not stuck
                if(typeof showLoginScreen === 'function') showLoginScreen();

                return;
            }

            if (statusBadge) {
                statusBadge.className = "w-full text-center text-[11px] bg-yellow-950/40 border border-yellow-900 text-yellow-400 py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 font-medium";
                statusBadge.innerHTML = `<span class="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></span><span>Connecting...</span>`;
            }
            if (mobileDot) {
                mobileDot.className = "w-2.5 h-2.5 bg-yellow-500 rounded-full animate-pulse";
            }

            try {
                // ALWAYS use the config from env.js directly for online-only mode
                let config = ENV_FIREBASE_CONFIG;

                // Initialize Firebase App properly
                let app;
                if (!firebase.apps.length) {
                    app = firebase.initializeApp(config);
                } else {
                    app = firebase.app();
                }

                firestoreDb = app.firestore();
                isFirebaseConnected = true;
                auth = firebase.auth();

                // SESSION persistence:
                // - Tab ખુલ્લો = Logged in (refresh ઠીક)
                // - Tab/Browser બંધ = Logout (fresh login)
                auth.setPersistence(firebase.auth.Auth.Persistence.SESSION)
                    .then(() => {
                        // onAuthStateChanged: login state track
                        auth.onAuthStateChanged(user => {
                            if (user) {
                                // Logged in: fetch companies then show selection
                                firestoreDb.collection('system').doc('settings').get().then(doc => {
                                    if(doc.exists && doc.data().companies) {
                                        companiesList = doc.data().companies;
                                        localStorage.setItem('biz_companies_list', JSON.stringify(companiesList));
                                    }
                                    showBusinessSelection();
                                }).catch(err => {
                                    console.error("Error fetching companies:", err);
                                    showBusinessSelection();
                                });
                            } else {
                                // Not logged in: login form show
                                if(typeof showLoginScreen === 'function') showLoginScreen();
                            }
                        }, (authError) => {
                            console.error("Auth State Error:", authError);
                            if(typeof showLoginScreen === 'function') showLoginScreen();
                        });
                    })
                    .catch((err) => {
                        console.error("Persistence Error:", err);
                        // Fallback
                        if(typeof showLoginScreen === 'function') showLoginScreen();
                    });

                if (statusBadge) {
                    statusBadge.className = "w-full text-center text-[11px] bg-emerald-950/40 border border-emerald-900 text-emerald-400 py-2 px-3 rounded-xl flex items-center justify-center gap-2 font-medium";
                    statusBadge.innerHTML = `<span class="w-2 h-2 bg-emerald-500 rounded-full animate-ping"></span><span>Firebase Live 🟢</span>`;
                }
                if (mobileDot) {
                    mobileDot.className = "w-2.5 h-2.5 bg-emerald-500 rounded-full animate-ping";
                }

                listenFirebaseData();
            } catch (err) {
                console.error("Firebase Connection Error:", err);
                isFirebaseConnected = false;
                if (statusBadge) {
                    statusBadge.className = "w-full text-center text-[11px] bg-red-950/40 border border-red-900 text-red-400 py-2 px-3 rounded-xl flex items-center justify-center gap-2 font-medium";
                    statusBadge.innerHTML = `<span class="w-2 h-2 bg-red-550 rounded-full"></span><span>Error ❌</span>`;
                }
                if (mobileDot) {
                    mobileDot.className = "w-2.5 h-2.5 bg-red-500 rounded-full";
                }
                // Show login screen if Firebase fails to load so UI is not stuck
                if(typeof showLoginScreen === 'function') showLoginScreen();
            }
            if (currentTab === 'settings') renderSettingsConfig();
        }

        // Live listening Firebase
        function listenFirebaseData() {
            if (!firestoreDb || !activeBusiness) return;

            let ordersCol = activeBusiness === 'ABS' ? 'orders' : activeBusiness + '_orders';
            let paymentsCol = activeBusiness === 'ABS' ? 'payments' : activeBusiness + '_payments';

            unsubOrders = firestoreDb.collection(ordersCol).onSnapshot(snapshot => {
                let orders = [];
                snapshot.forEach(doc => orders.push(doc.data()));
                db.orders = orders.sort((a, b) => a.id - b.id);
                localStorage.setItem(`biz_db_${activeBusiness}`, JSON.stringify(db));
                calculateDashboard();
                renderDashboardRecent();
                renderParties();
                if (activeParty) showPartyDetails(activeParty);
                renderAllOrders();
            }, err => console.error(err));

            unsubPayments = firestoreDb.collection(paymentsCol).onSnapshot(snapshot => {
                let payments = [];
                snapshot.forEach(doc => payments.push(doc.data()));
                db.payments = payments.sort((a, b) => a.id - b.id);
                localStorage.setItem(`biz_db_${activeBusiness}`, JSON.stringify(db));
                calculateDashboard();
                renderDashboardRecent();
                renderParties();
                if (activeParty) showPartyDetails(activeParty);
                renderAllPayments();
            }, err => console.error(err));
        }

        // Parser raw firebase config input
        function parseFirebaseConfig(input) {
            try {
                return JSON.parse(input);
            } catch (e) {
                let config = {};
                const keys = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
                keys.forEach(key => {
                    const regex = new RegExp(`['"]?${key}['"]?\\s*:\\s*['"]([^'"]+)['"]`);
                    const match = input.match(regex);
                    if (match && match[1]) config[key] = match[1];
                });
                if (config.apiKey && config.projectId && config.appId) return config;
                throw new Error("કોન્ફિગરેશન JSON અથવા ઑબ્જેક્ટનું ફોર્મેટ અયોગ્ય છે.");
            }
        }

        // Disconnect firebase settings (Disabled for online-only)
        function disconnectFirebase() {
            alert("App is in online-only mode. Cannot disconnect.");
        }

        // Migrate local storage records to Firebase Firestore cloud database
        async function migrateLocalDataToFirebase() {
            if (!isFirebaseConnected || !firestoreDb) return alert("કૃપા કરીને પહેલા સેટિંગ્સમાંથી ફાયરબેઝ લિંક કરો!");
            let localDb = JSON.parse(localStorage.getItem(`biz_db_${activeBusiness}`)) || { orders: [], payments: [] };
            if (confirm(`શું તમે બધો જ લોકલ સ્ટોરેજનો ડેટા ઓનલાઇન ફાયરબેઝ સર્વર પર અપલોડ કરવા માંગો છો?`)) {
                try {
                    let batch = firestoreDb.batch();
                    let ordersCol = activeBusiness === 'ABS' ? 'orders' : activeBusiness + '_orders';
                    let paymentsCol = activeBusiness === 'ABS' ? 'payments' : activeBusiness + '_payments';
                    localDb.orders.forEach(order => batch.set(firestoreDb.collection(ordersCol).doc(order.id.toString()), order));
                    localDb.payments.forEach(pay => batch.set(firestoreDb.collection(paymentsCol).doc(pay.id.toString()), pay));
                    await batch.commit();
                    alert("તમામ ડેટા ફાયરબેઝ પર સફળતાપૂર્વક અપલોડ થઈ ગયો છે!");
                    initFirebase();
                } catch (err) { alert("ભૂલ: " + err.message); }
            }
        }

        // Export Database download offline
        function exportDatabase() {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(db, null, 2));
            const downloadAnchor = document.createElement('a');
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", `Gokul_Plastic_Backup_${new Date().toISOString().split('T')[0]}.json`);
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
        }

        // Import Database
        function importDatabase(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    const importedDb = JSON.parse(e.target.result);
                    if (importedDb.orders && importedDb.payments) {
                        if (confirm("શું તમે ખરેખર આ બેકઅપ ફાઈલ લોડ કરવા માંગો છો? તમારા બ્રાઉઝરમાં સાચવેલો જૂનો ડેટા રદ થઈ જશે.")) {
                            db = importedDb;
                            saveData();
                            alert("ડેટા સફળતાપૂર્વક ઈમ્પોર્ટ થઈ ગયો છે!");
                        }
                    } else {
                        alert("અમાન્ય બેકઅપ ફાઈલ ફોર્મેટ! આમાં ઓર્ડર અને પેમેન્ટની માહિતી હોવી જરૂરી છે.");
                    }
                } catch (err) {
                    alert("ફાઈલ વાંચવામાં કંઈક ભૂલ થઈ: " + err.message);
                }
            };
            reader.readAsText(file);
        }

        // Navigation Page Swapping Switcher
        function switchPage(pageId) {
            currentTab = pageId;

            // Hide all pages
            document.querySelectorAll('.page-view').forEach(view => {
                view.classList.add('hidden');
            });

            // Show active page view
            document.getElementById(`page-${pageId}`).classList.remove('hidden');

            // Update desktop link classes
            document.querySelectorAll('.nav-link').forEach(link => {
                link.className = "nav-link w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 text-slate-300 hover:bg-slate-850 hover:text-white";
            });
            const activeLink = document.getElementById(`nav-${pageId}`);
            if (activeLink) {
                activeLink.className = "nav-link w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 bg-accent text-white shadow-md shadow-accent/20";
            }

            // Update mobile link classes
            document.querySelectorAll('.mobile-nav-link').forEach(link => {
                link.className = "mobile-nav-link flex flex-col items-center gap-1 flex-1 text-slate-500";
            });
            const activeMobileLink = document.getElementById(`mobile-nav-${pageId}`);
            if (activeMobileLink) {
                activeMobileLink.className = "mobile-nav-link flex flex-col items-center gap-1 flex-1 text-accent";
            }

            // Load triggers based on page
            if (pageId === 'dashboard') {
                renderDashboardRecent();
                renderChart();
            } else if (pageId === 'parties') {
                renderParties();
                // Desktop detail ledger auto show/hide logic
                if (activeParty) {
                    showPartyDetails(activeParty);
                } else {
                    document.getElementById('ledger-content-area').classList.add('hidden');
                    document.getElementById('ledger-empty-state').classList.remove('hidden');
                }
            } else if (pageId === 'order-history') {
                renderAllOrders();
            } else if (pageId === 'payment-history') {
                renderAllPayments();
            } else if (pageId === 'settings') {
                renderSettingsConfig();
            }
        }

        // Subtab Toggle
        function switchSubTab(subTabId) {
            currentSubTab = subTabId;
            if (subTabId === 'orders') {
                document.getElementById('subtab-view-orders').classList.remove('hidden');
                document.getElementById('subtab-view-payments').classList.add('hidden');

                document.getElementById('btn-subtab-orders').className = "px-4 py-2 rounded-lg font-bold text-xs transition duration-150 bg-white text-slate-800 shadow-2xs";
                document.getElementById('btn-subtab-payments').className = "px-4 py-2 rounded-lg font-bold text-xs transition duration-150 text-slate-500 hover:text-slate-800";
            } else {
                document.getElementById('subtab-view-orders').classList.add('hidden');
                document.getElementById('subtab-view-payments').classList.remove('hidden');

                document.getElementById('btn-subtab-orders').className = "px-4 py-2 rounded-lg font-bold text-xs transition duration-150 text-slate-500 hover:text-slate-800";
                document.getElementById('btn-subtab-payments').className = "px-4 py-2 rounded-lg font-bold text-xs transition duration-150 bg-white text-slate-800 shadow-2xs";
            }
        }

        // Submit Order Form
        document.getElementById('order-form').addEventListener('submit', function (e) {
            e.preventDefault();

            let partyName = document.getElementById('ord-party').value.trim();
            let existingPhone = document.getElementById('ord-phone').value.trim();

            // Find existing phone number if empty
            if (!existingPhone) {
                let foundOrder = db.orders.find(o => o.party === partyName && o.phone);
                if (foundOrder) existingPhone = foundOrder.phone;
            }

            let newOrder = {
                id: Date.now(),
                type: document.getElementById('ord-type').value,
                date: document.getElementById('ord-date').value,
                timestamp: new Date(document.getElementById('ord-date').value).getTime() || Date.now(),
                party: partyName,
                phone: existingPhone,
                item: document.getElementById('ord-item').value,
                qty: parseFloat(document.getElementById('ord-qty').value),
                price: parseFloat(document.getElementById('ord-price').value),
                status: document.getElementById('ord-status').value
            };
            newOrder.amount = newOrder.qty * newOrder.price;

            if (isFirebaseConnected && firestoreDb) {
                let ordersCol = activeBusiness === 'ABS' ? 'orders' : activeBusiness + '_orders';
                firestoreDb.collection(ordersCol).doc(newOrder.id.toString()).set(newOrder);
            } else {
                db.orders.push(newOrder);
                saveData();
            }

            activeParty = newOrder.party;
            this.reset();
            setDefaultDates();

            // Redirect user to the party's ledger automatically
            switchPage('parties');
            showPartyDetails(activeParty);
        });

        // Submit Payment Form
        document.getElementById('payment-form').addEventListener('submit', function (e) {
            e.preventDefault();

            let partyName = document.getElementById('pay-party').value.trim();
            let selectedMode = document.querySelector('input[name="pay-mode"]:checked');
            let payMode = selectedMode ? selectedMode.value : 'Cash';
            let chequeNo = payMode === 'Cheque' ? (document.getElementById('pay-cheque-no').value.trim() || '') : '';

            let newPayment = {
                id: Date.now(),
                type: document.getElementById('pay-type').value,
                date: document.getElementById('pay-date').value,
                timestamp: new Date(document.getElementById('pay-date').value).getTime() || Date.now(),
                party: partyName,
                amount: parseFloat(document.getElementById('pay-amount').value),
                mode: payMode,
                chequeNo: chequeNo
            };

            if (isFirebaseConnected && firestoreDb) {
                let paymentsCol = activeBusiness === 'ABS' ? 'payments' : activeBusiness + '_payments';
                firestoreDb.collection(paymentsCol).doc(newPayment.id.toString()).set(newPayment);
            } else {
                db.payments.push(newPayment);
                saveData();
            }

            activeParty = newPayment.party;
            this.reset();
            // Reset radio to Cash and hide cheque field
            document.getElementById('pay-mode-cash').checked = true;
            document.getElementById('cheque-number-row').classList.add('hidden');
            setDefaultDates();

            // Redirect user to the party's ledger automatically
            switchPage('parties');
            showPartyDetails(activeParty);
        });

        // Show/hide cheque number field based on payment mode selection
        document.querySelectorAll('input[name="pay-mode"]').forEach(function (radio) {
            radio.addEventListener('change', function () {
                const chequeRow = document.getElementById('cheque-number-row');
                if (this.value === 'Cheque') {
                    chequeRow.classList.remove('hidden');
                    document.getElementById('pay-cheque-no').focus();
                } else {
                    chequeRow.classList.add('hidden');
                    document.getElementById('pay-cheque-no').value = '';
                }
            });
        });

        // Toggle sidebar collapse/expand
        function toggleSidebar() {
            const sidebar = document.getElementById('sidebar');
            const mainContent = document.getElementById('main-content');
            const icon = document.getElementById('sidebar-toggle-icon');
            sidebar.classList.toggle('collapsed');
            mainContent.classList.toggle('sidebar-collapsed');
            if (sidebar.classList.contains('collapsed')) {
                icon.classList.remove('fa-chevron-left');
                icon.classList.add('fa-chevron-right');
            } else {
                icon.classList.remove('fa-chevron-right');
                icon.classList.add('fa-chevron-left');
            }
        }

        // Set default dates to today
        function setDefaultDates() {
            let today = new Date().toISOString().split('T')[0];
            document.getElementById('ord-date').value = today;
            document.getElementById('pay-date').value = today;
            document.getElementById('current-date-badge').innerText = new Date().toLocaleDateString('gu-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        }

        // Calculate and load dashboard metrics
        function calculateDashboard() {
            let totalSales = db.orders.filter(o => o.type === 'Sales').reduce((sum, o) => sum + o.amount, 0);
            let totalBuying = db.orders.filter(o => o.type === 'Buying').reduce((sum, o) => sum + o.amount, 0);
            let totalReceived = db.payments.filter(p => p.type === 'Received').reduce((sum, p) => sum + p.amount, 0);
            let totalPaid = db.payments.filter(p => p.type === 'Paid').reduce((sum, p) => sum + p.amount, 0);
            let netDue = (totalSales - totalReceived) - (totalBuying - totalPaid);

            document.getElementById('dash-sales').innerText = "₹" + totalSales.toLocaleString('en-IN');
            document.getElementById('dash-buying').innerText = "₹" + totalBuying.toLocaleString('en-IN');
            document.getElementById('dash-received').innerText = "₹" + totalReceived.toLocaleString('en-IN');
            document.getElementById('dash-due').innerText = "₹" + netDue.toLocaleString('en-IN');
            
            if (currentTab === 'dashboard') {
                renderChart();
            }
        }

        // Toggle Chart View Period
        function switchChartPeriod(period) {
            currentChartPeriod = period;
            ['weekly', 'monthly', 'yearly'].forEach(p => {
                let btn = document.getElementById('chart-btn-' + p);
                if (btn) {
                    if (p === period) {
                        btn.className = "px-3 py-1.5 rounded-lg font-bold text-xs transition duration-150 bg-white text-slate-800 shadow-sm";
                    } else {
                        btn.className = "px-3 py-1.5 rounded-lg font-bold text-xs transition duration-150 text-slate-500 hover:text-slate-800";
                    }
                }
            });
            renderChart(period);
        }

        // Render Business Analytics Chart
        function renderChart(period = currentChartPeriod) {
            const canvas = document.getElementById('business-chart');
            if (!canvas) return;
            
            if (businessChartInstance) {
                businessChartInstance.destroy();
            }

            let labels = [];
            let salesData = [];
            let buyingData = [];
            let receivedData = [];
            let paidData = [];

            let now = new Date();
            const formatDate = (date) => date.toISOString().split('T')[0];
            
            if (period === 'weekly') {
                document.getElementById('chart-subtitle').innerText = "છેલ્લા 7 દિવસ — Sales, Buying, Received, Paid";
                for (let i = 6; i >= 0; i--) {
                    let d = new Date();
                    d.setDate(now.getDate() - i);
                    let dateStr = formatDate(d);
                    labels.push(d.toLocaleDateString('gu-IN', { weekday: 'short' }));
                    
                    salesData.push(db.orders.filter(o => o.type === 'Sales' && o.date === dateStr).reduce((sum, o) => sum + o.amount, 0));
                    buyingData.push(db.orders.filter(o => o.type === 'Buying' && o.date === dateStr).reduce((sum, o) => sum + o.amount, 0));
                    receivedData.push(db.payments.filter(p => p.type === 'Received' && p.date === dateStr).reduce((sum, p) => sum + p.amount, 0));
                    paidData.push(db.payments.filter(p => p.type === 'Paid' && p.date === dateStr).reduce((sum, p) => sum + p.amount, 0));
                }
            } else if (period === 'monthly') {
                document.getElementById('chart-subtitle').innerText = "છેલ્લા 4 અઠવાડિયા — Sales, Buying, Received, Paid";
                for (let i = 3; i >= 0; i--) {
                    labels.push(`Week ${4-i}`);
                    let startD = new Date();
                    startD.setDate(now.getDate() - (i*7 + 7));
                    let endD = new Date();
                    endD.setDate(now.getDate() - (i*7));
                    
                    let s = 0, b = 0, r = 0, p = 0;
                    db.orders.forEach(o => {
                        let od = new Date(o.date);
                        if (od > startD && od <= endD) {
                            if (o.type === 'Sales') s += o.amount;
                            if (o.type === 'Buying') b += o.amount;
                        }
                    });
                    db.payments.forEach(pay => {
                        let pd = new Date(pay.date);
                        if (pd > startD && pd <= endD) {
                            if (pay.type === 'Received') r += pay.amount;
                            if (pay.type === 'Paid') p += pay.amount;
                        }
                    });
                    salesData.push(s); buyingData.push(b); receivedData.push(r); paidData.push(p);
                }
            } else if (period === 'yearly') {
                document.getElementById('chart-subtitle').innerText = "છેલ્લા 6 મહિના — Sales, Buying, Received, Paid";
                for (let i = 5; i >= 0; i--) {
                    let d = new Date();
                    d.setMonth(now.getMonth() - i);
                    labels.push(d.toLocaleDateString('gu-IN', { month: 'short' }));
                    let monthStr = d.toISOString().slice(0, 7);
                    
                    salesData.push(db.orders.filter(o => o.type === 'Sales' && o.date.startsWith(monthStr)).reduce((sum, o) => sum + o.amount, 0));
                    buyingData.push(db.orders.filter(o => o.type === 'Buying' && o.date.startsWith(monthStr)).reduce((sum, o) => sum + o.amount, 0));
                    receivedData.push(db.payments.filter(p => p.type === 'Received' && p.date.startsWith(monthStr)).reduce((sum, p) => sum + p.amount, 0));
                    paidData.push(db.payments.filter(p => p.type === 'Paid' && p.date.startsWith(monthStr)).reduce((sum, p) => sum + p.amount, 0));
                }
            }

            businessChartInstance = new Chart(canvas, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        { label: 'Sales', data: salesData, backgroundColor: '#818cf8', borderRadius: 4 },
                        { label: 'Buying', data: buyingData, backgroundColor: '#94a3b8', borderRadius: 4 },
                        { label: 'Received', data: receivedData, backgroundColor: '#34d399', borderRadius: 4 },
                        { label: 'Paid', data: paidData, backgroundColor: '#f87171', borderRadius: 4 }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
                    scales: {
                        y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { font: { size: 10 } } },
                        x: { grid: { display: false }, ticks: { font: { size: 10 } } }
                    }
                }
            });
        }

        // Extract list of all unique parties
        function getUniqueParties() {
            let parties = new Set();
            db.orders.forEach(o => parties.add(o.party));
            db.payments.forEach(p => parties.add(p.party));
            return Array.from(parties).sort();
        }

        // Render Parties List in column
        function renderParties() {
            let parties = getUniqueParties();
            let search = document.getElementById('party-search').value.toLowerCase();
            let box = document.getElementById('party-list-box');
            box.innerHTML = "";

            let count = 0;
            parties.forEach(party => {
                if (party.toLowerCase().includes(search)) {
                    count++;
                    let pSales = db.orders.filter(o => o.party === party && o.type === 'Sales').reduce((sum, o) => sum + o.amount, 0);
                    let pBuying = db.orders.filter(o => o.party === party && o.type === 'Buying').reduce((sum, o) => sum + o.amount, 0);
                    let pRec = db.payments.filter(p => p.party === party && p.type === 'Received').reduce((sum, p) => sum + p.amount, 0);
                    let pPaid = db.payments.filter(p => p.party === party && p.type === 'Paid').reduce((sum, p) => sum + p.amount, 0);

                    let pDue = (pSales - pRec) - (pBuying - pPaid);
                    let dueColor = pDue >= 0 ? 'text-red-650 bg-red-50/50 border-red-100' : 'text-emerald-650 bg-emerald-50/50 border-emerald-100';
                    let activeClass = (party === activeParty) ? 'bg-indigo-50 border-accent shadow-2xs font-semibold' : 'bg-slate-50 border-transparent hover:bg-slate-100/50';

                    let lastOrderWithPhone = db.orders.find(o => o.party === party && o.phone);
                    let currentPhone = lastOrderWithPhone ? lastOrderWithPhone.phone : "નથી";

                    box.innerHTML += `
                        <div onclick="showPartyDetails('${party}')" class="p-3 border rounded-xl cursor-pointer transition flex justify-between items-center ${activeClass}">
                            <div class="space-y-1 truncate pr-2">
                                <p class="font-bold text-slate-800 text-xs truncate">${party}</p>
                                <p class="text-[9px] text-slate-400 font-medium flex items-center gap-1">
                                    <i class="fa-solid fa-phone text-accent"></i> ${currentPhone}
                                </p>
                            </div>
                            <div class="text-right flex-shrink-0">
                                <p class="text-[9px] px-2 py-0.5 border rounded-lg font-bold ${dueColor}">₹${pDue.toLocaleString('en-IN')}</p>
                            </div>
                        </div>
                    `;
                }
            });

            if (count === 0) {
                box.innerHTML = `<p class="text-slate-400 text-center py-6 text-xs">કોઈ પાર્ટી મળી નથી.</p>`;
            }
        }

        function getSelectedLedgerDateRange() {
            const startInput = document.getElementById('pdf-start-date');
            const endInput = document.getElementById('pdf-end-date');
            const startDate = startInput?.value || '';
            const endDate = endInput?.value || '';

            if (!startDate && !endDate) return { startDate: '', endDate: '' };
            if (startDate && endDate) {
                if (startDate <= endDate) return { startDate, endDate };

                if (startInput && endInput) {
                    startInput.value = endDate;
                    endInput.value = startDate;
                }

                return { startDate: endDate, endDate: startDate };
            }

            const selectedDate = startDate || endDate;
            if (startInput && endInput) {
                startInput.value = selectedDate;
                endInput.value = selectedDate;
            }
            return { startDate: selectedDate, endDate: selectedDate };
        }

        function getSelectedLedgerPeriodText() {
            const range = getSelectedLedgerDateRange();
            if (!range.startDate && !range.endDate) return "All Data";
            if (range.startDate === range.endDate) return formatBusinessDate(range.startDate);
            return `${formatBusinessDate(range.startDate)} to ${formatBusinessDate(range.endDate)}`;
        }

        // Show Party Details and active Ledger records
        function showPartyDetails(party) {
            activeParty = party;

            document.getElementById('ledger-content-area').classList.remove('hidden');
            document.getElementById('ledger-empty-state').classList.add('hidden');

            // For Mobile View toggle
            if (window.innerWidth < 1024) {
                document.getElementById('party-list-container').classList.add('hidden');
                document.getElementById('party-ledger-container').classList.remove('hidden');
            }

            document.getElementById('selected-party-title').innerHTML = `<i class="fa-solid fa-user-tie text-accent"></i> ${party}`;

            let partyOrders = db.orders.filter(o => o.party === party);
            let partyPayments = db.payments.filter(p => p.party === party);

            // Apply Date Filters for Live View
            const selectedRange = getSelectedLedgerDateRange();
            let startDate = selectedRange.startDate;
            let endDate = selectedRange.endDate;
            let filterType = document.getElementById('ledger-filter-type').value;
            let filterStatus = document.getElementById('ledger-filter-status').value;

            if (startDate) {
                partyOrders = partyOrders.filter(o => o.date >= startDate);
                partyPayments = partyPayments.filter(p => p.date >= startDate);
            }
            if (endDate) {
                partyOrders = partyOrders.filter(o => o.date <= endDate);
                partyPayments = partyPayments.filter(p => p.date <= endDate);
            }
            if (filterType !== 'All') {
                partyOrders = partyOrders.filter(o => o.type === filterType);
                partyPayments = partyPayments.filter(p => p.type === filterType);
            }
            if (filterStatus !== 'All') {
                partyOrders = partyOrders.filter(o => o.status === filterStatus);
                // Payments don't have status, but if we filter by status, we usually want to see orders.
                // However, for balance calculation, if we only see Complete orders, should we see payments?
                // Usually, status filter applies to Orders. We'll leave payments as is or hide them if filtering by status.
                if (filterStatus !== 'All') partyPayments = [];
            }

            // Always sort by date (newest first for UI, oldest first for balance calculation usually, but here it's listed newest first)
            partyOrders.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0) || b.id - a.id);
            partyPayments.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0) || b.id - a.id);

            let pSales = partyOrders.filter(o => o.type === 'Sales').reduce((sum, o) => sum + o.amount, 0);
            let pBuying = partyOrders.filter(o => o.type === 'Buying').reduce((sum, o) => sum + o.amount, 0);
            let pRec = partyPayments.filter(p => p.type === 'Received').reduce((sum, p) => sum + p.amount, 0);
            let pPaid = partyPayments.filter(p => p.type === 'Paid').reduce((sum, p) => sum + p.amount, 0);
            let netPartyDue = (pSales - pRec) - (pBuying - pPaid);

            let dueText = document.getElementById('selected-party-due');
            dueText.innerText = "₹" + netPartyDue.toLocaleString('en-IN');
            dueText.className = netPartyDue >= 0 ? "font-black text-xl text-red-600 block mt-0.5" : "font-black text-xl text-emerald-600 block mt-0.5";

            let lastOrderWithPhone = db.orders.find(o => o.party === party && o.phone);
            let currentPhone = lastOrderWithPhone ? lastOrderWithPhone.phone : "નથી";
            const phoneBadge = document.getElementById('selected-party-phone-badge');
            phoneBadge.classList.remove('hidden');
            document.getElementById('party-phone-span').innerHTML = `📞 ${currentPhone} <button onclick="editPartyPhone('${party}', '${currentPhone === 'નથી' ? '' : currentPhone}')" class="text-accent hover:text-accentHover ml-1.5 font-bold hover:underline">✏️ સુધારો</button>`;

            // Orders Table
            let orderTable = document.getElementById('party-orders-table');
            orderTable.innerHTML = partyOrders.length === 0 ? `<p class="text-slate-400 text-center py-6">કોઈ ઓર્ડર એન્ટ્રી નથી.</p>` : "";

            partyOrders.forEach(o => {
                let badgeColor = o.type === 'Sales' ? 'bg-indigo-50 text-indigo-700 border-indigo-100' : 'bg-orange-50 text-orange-700 border-orange-100';
                let statusClass = o.status === 'Complete' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100';
                let challanBtn = o.status === 'Complete' ? `<button onclick="generateChallan(${o.id})" class="text-[10px] bg-white border border-accent text-accent px-2 py-0.5 rounded-lg hover:bg-indigo-50 flex items-center gap-0.5 transition"><i class="fa-solid fa-print"></i>Challan</button>` : '';

                orderTable.innerHTML += `
                    <div class="bg-white p-3 rounded-xl border border-slate-100 shadow-2xs space-y-2 relative group">
                        <div class="absolute top-2 right-2 flex space-x-1.5 opacity-40 group-hover:opacity-100 transition no-print">
                            <button onclick="editOrder(${o.id})" class="text-slate-400 hover:text-accent" title="ઓર્ડર સુધારો"><i class="fa-solid fa-pen-to-square"></i></button>
                            <button onclick="deleteItem('orders', ${o.id})" class="text-slate-400 hover:text-red-500"><i class="fa-solid fa-trash-can"></i></button>
                        </div>
                        <div class="flex justify-between items-center text-[10px]">
                            <span class="px-2 py-0.5 border rounded-lg font-bold ${badgeColor}">${o.type}</span>
                            <span class="text-slate-400 font-medium pr-10">${formatShortBusinessDate(o.date)}</span>
                        </div>
                        <p class="font-bold text-slate-800 text-xs">${o.item} <span class="text-slate-400">(${o.qty} x ₹${o.price})</span></p>
                        <div class="flex justify-between items-center pt-2 border-t border-dashed border-slate-100">
                            <span class="font-extrabold text-slate-800">₹${o.amount.toLocaleString('en-IN')}</span>
                            <div class="flex space-x-1.5 items-center">
                                ${challanBtn}
                                <button onclick="toggleStatus(${o.id})" class="px-2 py-0.5 border rounded-lg text-[9px] font-bold ${statusClass}">${o.status} <i class="fa-solid fa-arrows-rotate text-[8px] ml-0.5"></i></button>
                            </div>
                        </div>
                    </div>
                `;
            });

            // Payments Table
            let paymentTable = document.getElementById('party-payments-table');
            paymentTable.innerHTML = partyPayments.length === 0 ? `<p class="text-slate-400 text-center py-6">કોઈ ચૂકવણી રેકોર્ડ નથી.</p>` : "";

            partyPayments.forEach(p => {
                let badgeColor = p.type === 'Received' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100';
                paymentTable.innerHTML += `
                    <div class="bg-white p-3 rounded-xl border border-slate-100 shadow-2xs flex justify-between items-center relative group">
                        <div class="space-y-1.5">
                            <div class="flex items-center space-x-2">
                                <span class="px-2 py-0.5 border rounded-lg text-[9px] font-bold ${badgeColor}">${p.type}</span>
                                <span class="text-slate-400 text-[10px] font-medium">${formatShortBusinessDate(p.date)}</span>
                            </div>
                            <p class="font-bold text-slate-800 text-xs">રકમ: <span class="font-extrabold">₹${p.amount.toLocaleString('en-IN')}</span></p>
                        </div>
                        <button onclick="deleteItem('payments', ${p.id})" class="text-slate-400 hover:text-red-500 opacity-40 group-hover:opacity-100 transition no-print p-1"><i class="fa-solid fa-trash-can text-sm"></i></button>
                    </div>
                `;
            });
        }

        // Back to party list toggle on mobile
        function backToPartyList() {
            document.getElementById('party-list-container').classList.remove('hidden');
            document.getElementById('party-ledger-container').classList.add('hidden');
        }

        // Edit Party Phone across all orders
        async function editPartyPhone(partyName, existingPhone) {
            let newPhone = prompt(`"${partyName}" માટે નવો WhatsApp મોબાઈલ નંબર લખો:`, existingPhone);
            if (newPhone === null) return;
            newPhone = newPhone.trim();

            if (newPhone && !/^\d{10}$/.test(newPhone)) {
                alert("મહેરબાની કરીને સાચો ૧૦ આંકડાનો મોબાઈલ નંબર લખો.");
                return;
            }

            if (isFirebaseConnected && firestoreDb) {
                try {
                    let batch = firestoreDb.batch();
                    let ordersCol = activeBusiness === 'ABS' ? 'orders' : activeBusiness + '_orders';
                    let snapshot = await firestoreDb.collection(ordersCol).where('party', '==', partyName).get();
                    snapshot.forEach(doc => {
                        batch.update(doc.ref, { phone: newPhone });
                    });
                    await batch.commit();
                    alert("મોબાઈલ નંબર ઓનલાઇન ફાયરબેઝ પર સફળતાપૂર્વક અપડેટ થઈ ગયો છે!");
                } catch (err) {
                    alert("ભૂલ: " + err.message);
                }
            } else {
                db.orders.forEach(o => {
                    if (o.party === partyName) {
                        o.phone = newPhone;
                    }
                });
                saveData();
                alert("મોબાઈલ નંબર સ્થાનિક બેકઅપમાં અપડેટ થઈ ગયો છે!");
            }
        }

        // Edit Order Details (Item, Qty, Price)
        function editOrder(orderId) {
            let order = db.orders.find(o => o.id === orderId);
            if (!order) return;

            let newItem = prompt("આઇટમ વિગત સુધારો:", order.item);
            if (newItem === null) return;

            let newQtyStr = prompt("ક્વોન્ટિટી (Qty) સુધારો:", order.qty);
            if (newQtyStr === null) return;
            let newQty = parseFloat(newQtyStr);

            let newPriceStr = prompt("ભાવ (Price) સુધારો:", order.price);
            if (newPriceStr === null) return;
            let newPrice = parseFloat(newPriceStr);

            if (isNaN(newQty) || isNaN(newPrice)) {
                alert("કૃપા કરીને સાચી કિંમત અને ક્વોન્ટિટી જ આંકડામાં લખો.");
                return;
            }

            let updatedData = {
                item: newItem.trim(),
                qty: newQty,
                price: newPrice,
                amount: newQty * newPrice
            };

            if (isFirebaseConnected && firestoreDb) {
                let ordersCol = activeBusiness === 'ABS' ? 'orders' : activeBusiness + '_orders';
                firestoreDb.collection(ordersCol).doc(orderId.toString()).update(updatedData)
                    .then(() => alert("ઓર્ડર વિગત ફાયરબેઝ પર અપડેટ થઈ ગઈ છે!"))
                    .catch(err => alert("ભૂલ: " + err.message));
            } else {
                Object.assign(order, updatedData);
                saveData();
                alert("ઓર્ડર વિગત સ્થાનિકમાં સેવ થઈ ગઈ છે!");
            }
        }

        // Toggle pending status
        function toggleStatus(orderId) {
            let order = db.orders.find(o => o.id === orderId);
            if (order) {
                let newStatus = order.status === 'Pending' ? 'Complete' : 'Pending';
                if (isFirebaseConnected && firestoreDb) {
                    let ordersCol = activeBusiness === 'ABS' ? 'orders' : activeBusiness + '_orders';
                    firestoreDb.collection(ordersCol).doc(orderId.toString()).update({ status: newStatus });
                } else {
                    order.status = newStatus;
                    saveData();
                }
            }
        }

        // Get delivery challan index
        function getChallanSequenceNumber(orderId) {
            let salesOrders = db.orders.filter(o => o.type === 'Sales').sort((a, b) => a.id - b.id);
            let index = salesOrders.findIndex(o => o.id === orderId);
            return index !== -1 ? (index + 1) : 1;
        }

        // Render Recent Activity lists on Dashboard
        function renderDashboardRecent() {
            const recentOrdersBox = document.getElementById('dash-recent-orders');
            const recentPaymentsBox = document.getElementById('dash-recent-payments');

            // All orders sorted by newest
            const lastOrders = [...db.orders].sort((a, b) => b.id - a.id);
            recentOrdersBox.innerHTML = lastOrders.length === 0 ? `<p class="text-slate-400 text-center py-6 text-xs font-semibold">કોઈ ઓર્ડર નથી.</p>` : "";
            lastOrders.forEach(o => {
                let badgeColor = o.type === 'Sales' ? 'bg-indigo-50 text-indigo-700 border-indigo-100' : 'bg-orange-50 text-orange-700 border-orange-100';
                let statusClass = o.status === 'Complete' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700';

                recentOrdersBox.innerHTML += `
                    <div class="flex items-center justify-between p-3 border border-slate-100 rounded-xl hover:bg-slate-50 transition duration-150">
                        <div class="space-y-1 min-w-0 pr-2">
                            <p class="font-bold text-slate-800 text-xs truncate">${o.party}</p>
                            <p class="text-[9px] text-slate-400 font-semibold truncate">${o.item} (${o.qty} x ₹${o.price})</p>
                        </div>
                        <div class="text-right space-y-1 flex-shrink-0">
                            <p class="font-extrabold text-slate-800 text-xs">₹${o.amount.toLocaleString('en-IN')}</p>
                            <div class="flex gap-1 justify-end">
                                <span class="text-[8px] px-1 py-0.2 rounded border ${badgeColor} font-bold">${o.type}</span>
                                <span class="text-[8px] px-1 py-0.2 rounded ${statusClass} font-bold">${o.status}</span>
                            </div>
                        </div>
                    </div>
                `;
            });

            // All payments sorted by newest
            const lastPayments = [...db.payments].sort((a, b) => b.id - a.id);
            recentPaymentsBox.innerHTML = lastPayments.length === 0 ? `<p class="text-slate-400 text-center py-6 text-xs font-semibold">કોઈ પેમેન્ટ નથી.</p>` : "";
            lastPayments.forEach(p => {
                let badgeColor = p.type === 'Received' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100';
                let modeIcon = p.mode === 'Cheque' ? 'fa-file-invoice' : (p.mode === 'Online' ? 'fa-mobile-screen-button' : 'fa-money-bill');
                let modeLabel = p.mode || 'Cash';

                recentPaymentsBox.innerHTML += `
                    <div class="flex items-center justify-between p-3 border border-slate-100 rounded-xl hover:bg-slate-50 transition duration-150">
                        <div class="space-y-1 min-w-0 pr-2">
                            <p class="font-bold text-slate-800 text-xs truncate">${p.party}</p>
                            <p class="text-[9px] text-slate-400 font-semibold">${formatShortBusinessDate(p.date)} &bull; <i class="fa-solid ${modeIcon}"></i> ${modeLabel}</p>
                        </div>
                        <div class="text-right space-y-1 flex-shrink-0">
                            <p class="font-extrabold text-slate-800 text-xs">₹${p.amount.toLocaleString('en-IN')}</p>
                            <span class="text-[8px] px-1.5 py-0.2 border rounded-lg ${badgeColor} font-bold inline-block">${p.type}</span>
                        </div>
                    </div>
                `;
            });
        }

        // Render Reports: All Orders
        function renderAllOrders() {
            const searchVal = document.getElementById('report-order-search').value.toLowerCase();
            const filterType = document.getElementById('report-order-filter-type').value;
            const filterStatus = document.getElementById('report-order-filter-status').value;
            const tbody = document.getElementById('all-orders-table-body');
            const emptyMsg = document.getElementById('orders-report-empty');

            tbody.innerHTML = "";

            let filteredOrders = [...db.orders].sort((a, b) => b.id - a.id);

            if (searchVal) {
                filteredOrders = filteredOrders.filter(o => o.party.toLowerCase().includes(searchVal) || o.item.toLowerCase().includes(searchVal));
            }
            if (filterType !== 'All') {
                filteredOrders = filteredOrders.filter(o => o.type === filterType);
            }
            if (filterStatus !== 'All') {
                filteredOrders = filteredOrders.filter(o => o.status === filterStatus);
            }

            if (filteredOrders.length === 0) {
                emptyMsg.classList.remove('hidden');
            } else {
                emptyMsg.classList.add('hidden');
            }

            filteredOrders.forEach(o => {
                let typeBadge = o.type === 'Sales' ? 'bg-indigo-50 text-indigo-700 border-indigo-100' : 'bg-orange-50 text-orange-700 border-orange-100';
                let statusBadge = o.status === 'Complete' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100';
                let challanBtn = o.status === 'Complete' ? `<button onclick="generateChallan(${o.id})" class="bg-white border border-accent text-accent px-2 py-0.5 rounded-lg hover:bg-indigo-50 text-[10px] font-bold flex items-center gap-0.5 transition"><i class="fa-solid fa-print"></i>ચલાન</button>` : '';

                tbody.innerHTML += `
                    <tr class="hover:bg-slate-50 transition border-b border-slate-100">
                        <td class="p-4 font-semibold text-slate-500 whitespace-nowrap">${formatShortBusinessDate(o.date)}</td>
                        <td class="p-4 font-bold text-slate-800 cursor-pointer hover:text-accent" onclick="switchPage('parties'); showPartyDetails('${o.party}')">${o.party}</td>
                        <td class="p-4"><span class="px-2 py-0.5 border rounded-lg text-[9px] font-bold ${typeBadge}">${o.type}</span></td>
                        <td class="p-4 font-semibold text-slate-600 max-w-[150px] truncate" title="${o.item}">${o.item}</td>
                        <td class="p-4 text-center font-bold text-slate-800">${o.qty}</td>
                        <td class="p-4 text-right font-semibold text-slate-600">₹${o.price.toLocaleString('en-IN')}</td>
                        <td class="p-4 text-right font-extrabold text-slate-800">₹${o.amount.toLocaleString('en-IN')}</td>
                        <td class="p-4 text-center">
                            <button onclick="toggleStatus(${o.id})" class="px-2 py-0.5 border rounded-lg text-[9px] font-bold ${statusBadge} inline-flex items-center gap-0.5 hover:shadow-xs transition">
                                ${o.status} <i class="fa-solid fa-arrows-rotate text-[8px]"></i>
                            </button>
                        </td>
                        <td class="p-4 text-center no-print flex justify-center items-center gap-2 mt-1">
                            ${challanBtn}
                            <button onclick="editOrder(${o.id})" class="text-slate-400 hover:text-accent p-1" title="સુધારો"><i class="fa-solid fa-pen-to-square text-xs"></i></button>
                            <button onclick="deleteItem('orders', ${o.id})" class="text-slate-400 hover:text-red-500 p-1" title="ડીલીટ"><i class="fa-solid fa-trash-can text-xs"></i></button>
                        </td>
                    </tr>
                `;
            });
        }

        // Render Reports: All Payments
        function renderAllPayments() {
            const searchVal = document.getElementById('report-payment-search').value.toLowerCase();
            const filterType = document.getElementById('report-payment-filter-type').value;
            const tbody = document.getElementById('all-payments-table-body');
            const emptyMsg = document.getElementById('payments-report-empty');

            tbody.innerHTML = "";

            let filteredPayments = [...db.payments].sort((a, b) => b.id - a.id);

            if (searchVal) {
                filteredPayments = filteredPayments.filter(p => p.party.toLowerCase().includes(searchVal));
            }
            if (filterType !== 'All') {
                filteredPayments = filteredPayments.filter(p => p.type === filterType);
            }

            if (filteredPayments.length === 0) {
                emptyMsg.classList.remove('hidden');
            } else {
                emptyMsg.classList.add('hidden');
            }

            filteredPayments.forEach(p => {
                let typeBadge = p.type === 'Received' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100';

                tbody.innerHTML += `
                    <tr class="hover:bg-slate-50 transition border-b border-slate-100">
                        <td class="p-4 font-semibold text-slate-500 whitespace-nowrap">${formatShortBusinessDate(p.date)}</td>
                        <td class="p-4 font-bold text-slate-800 cursor-pointer hover:text-accent" onclick="switchPage('parties'); showPartyDetails('${p.party}')">${p.party}</td>
                        <td class="p-4"><span class="px-2 py-0.5 border rounded-lg text-[9px] font-bold ${typeBadge}">${p.type}</span></td>
                        <td class="p-4 text-right font-extrabold text-slate-900">₹${p.amount.toLocaleString('en-IN')}</td>
                        <td class="p-4 text-center no-print">
                            <button onclick="deleteItem('payments', ${p.id})" class="text-slate-400 hover:text-red-500 p-1" title="ડીલીટ"><i class="fa-solid fa-trash-can text-xs"></i></button>
                        </td>
                    </tr>
                `;
            });
        }

        // Render Configuration Fields in settings
        function renderSettingsConfig() {
            const savedConfig = localStorage.getItem('firebase_config');
            document.getElementById('settings-fb-config-json').value = savedConfig ? JSON.stringify(JSON.parse(savedConfig), null, 2) : "";

            const statusEl = document.getElementById('settings-firebase-status');
            const disconnectBtn = document.getElementById('settings-fb-disconnect-btn');
            const migrationBox = document.getElementById('settings-migration-box');

            if (isFirebaseConnected) {
                statusEl.className = "font-black text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-100 flex items-center gap-1.5";
                statusEl.innerHTML = `<span class="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></span>લાઈવ કનેક્ટેડ 🟢`;
                disconnectBtn.classList.remove('hidden');
                migrationBox.classList.remove('hidden');
            } else {
                statusEl.className = "font-black text-red-600 bg-red-50 px-2.5 py-0.5 rounded border border-red-100 flex items-center gap-1.5";
                statusEl.innerHTML = `<span class="w-1.5 h-1.5 bg-red-500 rounded-full"></span>ઑફલાઇન (Local Mode)`;
                disconnectBtn.classList.add('hidden');
                migrationBox.classList.add('hidden');
            }
        }

        // Generate print delivery challan
        // Generate Ledger Print Report
        function generateLedgerPrint(partyName) {
            if (!partyName) return alert("કૃપા કરીને પહેલા પાર્ટી પસંદ કરો.");

            const partyOrders = db.orders.filter(o => o.party === partyName);
            const partyPayments = db.payments.filter(p => p.party === partyName);

            // Combine all transactions into one array for chronological sorting
            let transactions = [];

            partyOrders.forEach(o => {
                transactions.push({
                    date: o.date,
                    displayDate: formatShortBusinessDate(o.date),
                    timestamp: o.timestamp || o.id,
                    particulars: o.item + (o.qty ? ` (${o.qty} x ${o.price})` : ""),
                    type: o.type, // 'Sales' or 'Buying'
                    debit: o.type === 'Sales' ? o.amount : 0,
                    credit: o.type === 'Buying' ? o.amount : 0
                });
            });

            partyPayments.forEach(p => {
                transactions.push({
                    date: p.date,
                    displayDate: formatShortBusinessDate(p.date),
                    timestamp: p.timestamp || p.id,
                    particulars: `Payment - ${p.mode}${p.chequeNo ? ' (No. '+p.chequeNo+')' : ''}`,
                    type: p.type, // 'Received' or 'Paid'
                    debit: p.type === 'Paid' ? p.amount : 0,
                    credit: p.type === 'Received' ? p.amount : 0
                });
            });

            // Sort by Date then by ID (timestamp)
            transactions.sort(compareLedgerRecords);

            // Populate Modal
            document.getElementById('lp-party-name').innerText = partyName;
            let lastOrderWithPhone = db.orders.find(o => o.party === partyName && o.phone);
            document.getElementById('lp-party-phone').innerText = lastOrderWithPhone ? `Phone: ${lastOrderWithPhone.phone}` : "";
            document.getElementById('lp-report-date').innerText = new Date().toLocaleDateString('gu-IN');


            const tbody = document.getElementById('lp-table-body');
            tbody.innerHTML = "";

            let runningBalance = 0;
            let totalDebit = 0;
            let totalCredit = 0;

            transactions.forEach(t => {
                runningBalance += (t.debit - t.credit);
                totalDebit += t.debit;
                totalCredit += t.credit;

                const balanceColor = runningBalance >= 0 ? 'text-slate-800' : 'text-emerald-700';
                const balType = runningBalance >= 0 ? "Dr" : "Cr";

                tbody.innerHTML += `
                    <tr class="border-b border-slate-800">
                        <td class="p-2 border-r border-slate-800 text-[10.5px]">${t.displayDate}</td>
                        <td class="p-2 border-r border-slate-800 text-[10.5px]">${t.particulars}</td>
                        <td class="p-2 border-r border-slate-800 text-center text-[9.5px] uppercase">${t.type}</td>
                        <td class="p-2 border-r border-slate-800 text-right text-[10.5px]">${t.debit > 0 ? '₹' + t.debit.toLocaleString('en-IN') : '-'}</td>
                        <td class="p-2 border-r border-slate-800 text-right text-[10.5px]">${t.credit > 0 ? '₹' + t.credit.toLocaleString('en-IN') : '-'}</td>
                        <td class="p-2 text-right bg-slate-50 text-[10.5px] ${balanceColor}">₹${Math.abs(runningBalance).toLocaleString('en-IN')} ${balType}</td>
                    </tr>
                `;
            });

            // Summary row
            document.getElementById('lp-total-debit').innerText = "₹" + totalDebit.toLocaleString('en-IN');
            document.getElementById('lp-total-credit').innerText = "₹" + totalCredit.toLocaleString('en-IN');
            const finalBalType = runningBalance >= 0 ? "Dr" : "Cr";
            document.getElementById('lp-final-balance').innerText = "₹" + Math.abs(runningBalance).toLocaleString('en-IN') + " " + finalBalType;

            document.getElementById('lp-closing-balance').innerText = "₹" + Math.abs(runningBalance).toLocaleString('en-IN');
            document.getElementById('lp-closing-balance').className = runningBalance >= 0 ? "text-2xl font-black text-red-600" : "text-2xl font-black text-emerald-600";
            document.getElementById('lp-balance-type').innerText = runningBalance >= 0 ? "Total Pending Amount (બાકી લેણાં)" : "Advance / Excess Amount (વધારે જમા)";

            // Show Modal
            document.getElementById('ledger-print-modal').classList.remove('hidden');
        }

        function closeLedgerPrint() {
            document.getElementById('ledger-print-modal').classList.add('hidden');
        }

        function generateChallan(orderId) {
            let order = db.orders.find(o => o.id === orderId);
            if (order) {
                let autoNo = getChallanSequenceNumber(order.id);
                let formattedTotal = "₹" + order.amount.toLocaleString('en-IN');

                for (let i = 1; i <= 2; i++) {
                    document.getElementById(`ch${i}-party`).innerText = order.party;
                    document.getElementById(`ch${i}-date`).innerText = formatBusinessDate(order.date);
                    document.getElementById(`ch${i}-num`).innerText = autoNo;
                    document.getElementById(`ch${i}-item`).innerText = order.item;
                    document.getElementById(`ch${i}-qty`).innerText = order.qty;
                    document.getElementById(`ch${i}-price`).innerText = "₹" + order.price.toLocaleString('en-IN');
                    document.getElementById(`ch${i}-total`).innerText = formattedTotal;
                }

                document.getElementById('wp-share-btn').onclick = function () {
                    sendChallanToWhatsApp(order.phone, order.party, autoNo, order.item, order.qty, formattedTotal);
                };

                document.getElementById('challan-modal').classList.remove('hidden');
            }
        }

        // Share to WhatsApp API
        function sendChallanToWhatsApp(phone, party, challanNum, item, qty, total) {
            if (!phone || phone === "") return alert("મોબાઈલ નંબર ઉમેરેલો નથી! ખાતાવહીમાં જઈને સુધારો પર ક્લિક કરી પહેલા મોબાઈલ નંબર લખો.");
            let message = `*નમસ્તે ${party},*\n\n` +
                `*GOKUL PLASTIC* તરફથી તમારો માલ રવાના થયો છે:\n\n` +
                `🔹 *ચલાન નંબર:* ${challanNum}\n` +
                `🔹 *વસ્તુ:* ${item}\n` +
                `🔹 *જથ્થો:* ${qty}\n` +
                `🔹 *ટોટલ અમાઉન્ટ:* ${total}\n\n` +
                `🙏 *Gokul Plastic (Ahmedabad)*`;
            window.open(`https://api.whatsapp.com/send?phone=91${phone}&text=${encodeURIComponent(message)}`, '_blank');
        }

        function closeChallan() {
            document.getElementById('challan-modal').classList.add('hidden');
        }

        // Delete order/payment records
        function deleteItem(target, id) {
            if (confirm("શું તમે આ એન્ટ્રી કાયમ માટે ડીલીટ કરવા માંગો છો?")) {
                if (isFirebaseConnected && firestoreDb) {
                    let targetCol = activeBusiness === 'ABS' ? target : activeBusiness + '_' + target;
                    firestoreDb.collection(targetCol).doc(id.toString()).delete()
                        .then(() => alert("એન્ટ્રી ફાયરબેઝ માંથી ડીલીટ કરવામાં આવી છે!"))
                        .catch(err => alert("ડીલીટ કરવામાં ભૂલ આવી: " + err.message));
                } else {
                    db[target] = db[target].filter(item => item.id !== id);
                    saveData();
                    alert("એન્ટ્રી બ્રાઉઝર માંથી ડીલીટ થઈ ગઈ છે!");
                }
            }
        }

        // Connect Firebase configuration form submission (Disabled since we use fixed config)
        document.getElementById('settings-firebase-config-form').addEventListener('submit', function (e) {
            e.preventDefault();
            alert("App is running in online-only mode. Configuration is loaded from env.js and cannot be changed here.");
        });

        // Initialize script logic
        setDefaultDates();
        initFirebase();
        switchPage('dashboard');

        // ─── LOGIN / LOGOUT  ───────────────────────────────────────────────

        // દર વખત page load થાય ત્યારે login screen show કરો
        // (SESSION persistence: browser/tab બંધ થતાં logout)
        function setupAuthPersistence() {
            if (!auth) return;
            auth.setPersistence(firebase.auth.Auth.Persistence.SESSION)
                .then(() => {
                    // persistence set થઈ ગઈ - હવે onAuthStateChanged handle કરશે
                })
                .catch(() => { });
        }

        // Page load પર login screen ચોક્કસ show કરો
        // (firebase auto-login ને allow ન કરો)
        function showLoginScreen() {
            document.getElementById('login-screen').style.display = 'flex';
            document.getElementById('login-loading-container').style.display = 'none';
            document.getElementById('login-form-container').classList.remove('hidden');
        }

        function hideLoginScreen() {
            document.getElementById('login-screen').style.display = 'none';
        }

        // Page load: onAuthStateChanged Firebase handle કરશે
        // SESSION persistence હોવાથી:
        // - Same tab refresh: logged in રહે
        // - Tab/Browser close: logout
        // showLoginScreen() ની જરૂર નથી - Firebase auto-handle

        // Enter key: email → password focus, password → login
        document.getElementById('login-password').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') loginUser();
        });
        document.getElementById('login-email').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') document.getElementById('login-password').focus();
        });

        function loginUser() {
            const email = document.getElementById('login-email').value.trim();
            const password = document.getElementById('login-password').value;

            const errorEl = document.getElementById('login-error-msg');
            const btn = document.getElementById('login-btn');

            if (!email || !password) {
                errorEl.textContent = 'કૃપા કરી Email અને Password ભરો.';
                errorEl.classList.remove('hidden');
                return;
            }

            if (!auth) {
                errorEl.textContent = 'Firebase connect નથી. Settings ચકાસો.';
                errorEl.classList.remove('hidden');
                return;
            }

            errorEl.classList.add('hidden');
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Login...</span>';

            // SESSION persistence: tab/window બંધ = logout, refresh = stay logged in
            auth.setPersistence(firebase.auth.Auth.Persistence.SESSION)
                .then(() => {
                    return auth.signInWithEmailAndPassword(email, password);
                })
                .then(() => {
                    hideLoginScreen();
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i><span>Login કરો</span>';
                })
                .catch(error => {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i><span>Login કરો</span>';
                    let msg = 'Login ભૂલ: ' + error.message;
                    if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
                        msg = '❌ Password ખોટો છે! ફરી ચકાસો.';
                    } else if (error.code === 'auth/user-not-found') {
                        msg = '❌ Email ID મળ્યો નથી.';
                    } else if (error.code === 'auth/network-request-failed') {
                        msg = '❌ Internet connection ચકાસો.';
                    }
                    errorEl.textContent = msg;
                    errorEl.classList.remove('hidden');
                });
        }

        // Download Party-wise Ledger as PDF
       function downloadPartyLedgerPDF() {
    if (!activeParty) { alert('Please select a party first.'); return; }

    const selectedRange = getSelectedLedgerDateRange();
    let startDate = selectedRange.startDate;
    let endDate   = selectedRange.endDate;
    let filterType   = document.getElementById('ledger-filter-type').value;
    let filterStatus = document.getElementById('ledger-filter-status').value;

    let partyOrders   = db.orders.filter(o => o.party === activeParty);
    let partyPayments = db.payments.filter(p => p.party === activeParty);

    if (startDate) { partyOrders = partyOrders.filter(o => o.date >= startDate); partyPayments = partyPayments.filter(p => p.date >= startDate); }
    if (endDate)   { partyOrders = partyOrders.filter(o => o.date <= endDate);   partyPayments = partyPayments.filter(p => p.date <= endDate); }
    if (filterType !== 'All') { partyOrders = partyOrders.filter(o => o.type === filterType); partyPayments = partyPayments.filter(p => p.type === filterType); }
    if (filterStatus !== 'All') { partyOrders = partyOrders.filter(o => o.status === filterStatus); partyPayments = []; }

    partyOrders.sort((a,b)   => (a.timestamp||a.id)-(b.timestamp||b.id));
    partyPayments.sort((a,b) => (a.timestamp||a.id)-(b.timestamp||b.id));

    const dateRangeText  = getSelectedLedgerPeriodText();
    const generatedDate  = formatBusinessDate(new Date().toISOString().split('T')[0]);
    const totalSales     = partyOrders.filter(o=>o.type==='Sales').reduce((s,o)=>s+o.amount,0);
    const totalBuying    = partyOrders.filter(o=>o.type==='Buying').reduce((s,o)=>s+o.amount,0);
    const totalReceived  = partyPayments.filter(p=>p.type==='Received').reduce((s,p)=>s+p.amount,0);
    const totalPaid      = partyPayments.filter(p=>p.type==='Paid').reduce((s,p)=>s+p.amount,0);
    const netDue         = (totalSales - totalReceived) - (totalBuying - totalPaid);
    const entryCount     = partyOrders.length + partyPayments.length;

    // Build sorted ledger rows with running balance
    let rows = [];
    partyOrders.forEach(o   => rows.push({...o,  timestamp: o.timestamp||o.id}));
    partyPayments.forEach(p => rows.push({...p,  timestamp: p.timestamp||p.id}));
    rows.sort(compareLedgerRecords);

    let runBal = 0;
    const ledgerRows = rows.map(r => {
        const debit  = (r.type==='Sales'  || r.type==='Paid')     ? r.amount : 0;
        const credit = (r.type==='Buying' || r.type==='Received') ? r.amount : 0;
        runBal += (debit - credit);
        return {...r, debit, credit, balance: runBal};
    });

    const pdfTotalDebit  = ledgerRows.reduce((s,r)=>s+r.debit,  0);
    const pdfTotalCredit = ledgerRows.reduce((s,r)=>s+r.credit, 0);
    const pdfClosing     = pdfTotalDebit - pdfTotalCredit;
    const pdfClosingAbs  = Math.abs(pdfClosing);
    const pdfClosingType = pdfClosing >= 0 ? 'Dr' : 'Cr';

    // ── PDF INIT ─────────────────────────────────────────────────────
    let doc;
    try { doc = new jspdf.jsPDF({orientation:'portrait',unit:'mm',format:'a4'}); }
    catch(e) { doc = new window.jspdf.jsPDF('portrait','mm','a4'); }

    const PW = doc.internal.pageSize.getWidth();   // 210
    const PH = doc.internal.pageSize.getHeight();  // 297

    // Layout constants
    const BO  = 10;                     // border offset from page edge
    const BW  = PW - BO*2;             // border width  = 190
    const BH  = PH - BO*2;             // border height = 277
    const PAD = 5;
    const ML  = BO + PAD;              // marginLeft = 15
    const MT  = BO + PAD;              // marginTop  = 15
    const CW  = BW - PAD*2;            // contentWidth = 180
    const FOOTER_H = 8;
    const BOTTOM   = PH - BO - PAD - FOOTER_H;   // lowest y allowed for content

    // Column definitions (all in mm, sum = 180 = CW)
    // date(22) + particulars(62) + type(20) + debit(28) + credit(28) + balance(20)
    const COL = {
        date:        {x:  0, w: 22},
        particulars: {x: 22, w: 62},
        type:        {x: 84, w: 20},
        debit:       {x:104, w: 28},
        credit:      {x:132, w: 28},
        balance:     {x:160, w: 20},
    };

    const ROW_H   = 5.2;   // base row height
    const ROW_PAD = 1.4;   // vertical padding inside row

    let y = MT;

    // ── HELPERS ──────────────────────────────────────────────────────
    const cx = key => ML + COL[key].x;           // left edge of column
    const cxR= key => ML + COL[key].x + COL[key].w;  // right edge of column

    function border() {
        doc.setDrawColor(20,20,20); doc.setLineWidth(0.7);
        doc.rect(BO, BO, BW, BH);
    }

    function hline(lx, rx, yy, lw, r, g, b) {
        doc.setDrawColor(r||0,g||0,b||0); doc.setLineWidth(lw||0.25);
        doc.line(lx, yy, rx, yy);
    }

    function txt(text, x, yy, opts) {
        doc.text(String(text), x, yy, opts||{});
    }

    // Full header (page 1 only)
    function drawFullHeader() {
        // Company name
        doc.setFont('helvetica','bold'); doc.setFontSize(18); doc.setTextColor(0,0,0);
        txt('GOKUL PLASTIC', ML, y+5);

        doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(70,70,70);
        txt('A-16, Maruti Ind. Estate, SP Ring Rd, Odhav, Ahmedabad - 382415', ML, y+9.5);
        txt('Phone: 9428344742  |  GST: 24AYVPB8220E1ZK', ML, y+13.2);

        // Badge
        const bW=48, bH=8, bX=ML+CW-bW;
        doc.setFillColor(28,28,28); doc.setDrawColor(0,0,0); doc.setLineWidth(0.4);
        doc.rect(bX, y, bW, bH, 'FD');
        doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(255,255,255);
        txt('PARTY LEDGER', bX+bW/2, y+5.2, {align:'center'});

        doc.setFont('helvetica','normal'); doc.setFontSize(6.3); doc.setTextColor(110,110,110);
        txt('Generated: '+generatedDate, bX+bW, y+11.8, {align:'right'});

        y += 16;
        hline(ML, ML+CW, y, 0.45);
        y += 4.5;

        // Party bar
        const barH = 13;
        doc.setFillColor(246,246,246); doc.setDrawColor(180,180,180); doc.setLineWidth(0.3);
        doc.rect(ML, y, CW, barH, 'FD');

        const half = ML + CW*0.54;
        doc.setFont('helvetica','bold'); doc.setFontSize(6.5); doc.setTextColor(110,110,110);
        txt('PARTY NAME',   ML+3,   y+4.2);
        txt('REPORT PERIOD', half,  y+4.2);

        doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(0,0,0);
        txt(activeParty,     ML+3,  y+10.3);

        doc.setFontSize(9); doc.setTextColor(30,30,30);
        txt(dateRangeText,   half,  y+10.3);
        y += barH + 4.5;

        // Summary cards
        const gap=3, cardH=13;
        const cardW = (CW - gap*3) / 4;
        const cards = [
            {label:'TOTAL SALES',     val:'Rs. '+totalSales.toLocaleString('en-IN'),   col:[0,0,0]},
            {label:'TOTAL RECEIVED',  val:'Rs. '+totalReceived.toLocaleString('en-IN'), col:[0,100,0]},
            {label:'NET DUE',         val:'Rs. '+Math.abs(netDue).toLocaleString('en-IN')+' '+(netDue>=0?'Dr':'Cr'), col: netDue>=0?[175,0,0]:[0,100,0]},
            {label:'ENTRIES',         val:String(entryCount), col:[0,0,0]},
        ];
        cards.forEach((c,i) => {
            const cx2 = ML + i*(cardW+gap);
            doc.setFillColor(255,255,255); doc.setDrawColor(200,200,200); doc.setLineWidth(0.3);
            doc.rect(cx2, y, cardW, cardH, 'FD');

            doc.setFont('helvetica','bold'); doc.setFontSize(6.2); doc.setTextColor(110,110,110);
            txt(c.label, cx2+2.5, y+4.2);

            doc.setFontSize(8.5); doc.setTextColor(c.col[0],c.col[1],c.col[2]);
            // Auto-shrink if too wide
            let fs=8.5;
            doc.setFontSize(fs);
            while(doc.getTextWidth(c.val) > cardW-4 && fs>6){ fs-=0.4; doc.setFontSize(fs); }
            txt(c.val, cx2+2.5, y+10.2);
        });
        y += cardH + 5;
    }

    // Compact continuation header
    function drawContinuedHeader() {
        doc.setFont('helvetica','bold'); doc.setFontSize(10.5); doc.setTextColor(0,0,0);
        txt('GOKUL PLASTIC', ML, y+4);
        doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(100,100,100);
        txt(activeParty+' — Party Ledger (continued)', ML, y+8.5);
        doc.setFontSize(6.3);
        txt('Generated: '+generatedDate, ML+CW, y+4, {align:'right'});
        y += 12;
        hline(ML, ML+CW, y, 0.4);
        y += 4.5;
    }

    // Table header row
    function drawTableHeader() {
        doc.setFillColor(28,28,28);
        doc.rect(ML, y, CW, 7, 'F');
        doc.setTextColor(255,255,255);
        doc.setFont('helvetica','bold'); doc.setFontSize(6.8);

        txt('DATE',          cx('date')+2,       y+4.7);
        txt('PARTICULARS',   cx('particulars')+2, y+4.7);
        txt('TYPE',          cx('type')+COL.type.w/2, y+4.7, {align:'center'});
        txt('DEBIT (Rs.)',   cxR('debit')-2,      y+4.7, {align:'right'});
        txt('CREDIT (Rs.)',  cxR('credit')-2,     y+4.7, {align:'right'});
        txt('BALANCE',       cxR('balance')-2,    y+4.7, {align:'right'});
        y += 7;
    }

    // Footer on every page (called once at the end after all pages exist)
    function drawAllFooters() {
        const total = doc.internal.getNumberOfPages();
        for(let i=1;i<=total;i++) {
            doc.setPage(i);
            const fy = PH - BO - 3;
            hline(ML, ML+CW, fy-3.5, 0.22, 200, 200, 200);
            doc.setFont('helvetica','normal'); doc.setFontSize(6.3); doc.setTextColor(140,140,140);
            txt('Gokul Plastic — Party Ledger',   ML,    fy);
            txt('Page '+i+' of '+total,           ML+CW, fy, {align:'right'});
        }
    }

    function newPage(full) {
        doc.addPage();
        y = MT;
        border();
        if(full) drawFullHeader();
        else     drawContinuedHeader();
        drawTableHeader();
    }

    // ── PAGE 1 ───────────────────────────────────────────────────────
    border();
    drawFullHeader();

    doc.setFont('helvetica','bold'); doc.setFontSize(7.8); doc.setTextColor(0,0,0);
    txt('TRANSACTION HISTORY', ML, y);
    y += 4;
    drawTableHeader();

    // ── TABLE ROWS ───────────────────────────────────────────────────
    if(ledgerRows.length === 0) {
        doc.setFont('helvetica','italic'); doc.setFontSize(8); doc.setTextColor(150,150,150);
        txt('No transactions found.', ML+CW/2, y+8, {align:'center'});
        y += 14;
    }

    ledgerRows.forEach((r, idx) => {
        // Build particulars text
        let particular = r.item
            ? r.item + ' (' + r.qty + ' x Rs. ' + Number(r.price||0).toLocaleString('en-IN') + ')'
            : 'Payment' + (r.mode ? ' via ' + r.mode : '');

        doc.setFont('helvetica','normal'); doc.setFontSize(6.8);
        const wrapW = COL.particulars.w - 4;
        let lines   = doc.splitTextToSize(particular, wrapW);
        if(lines.length > 2) lines = [lines[0], lines[1].substring(0, lines[1].length-3)+'...'];

        const rowH = ROW_H * lines.length + ROW_PAD;

        // Page break?
        if(y + rowH > BOTTOM) newPage(false);

        // Zebra stripe
        if(idx % 2 === 1) {
            doc.setFillColor(247,247,247);
            doc.rect(ML, y, CW, rowH, 'F');
        }

        // Bottom border of row
        hline(ML, ML+CW, y+rowH, 0.15, 215, 215, 215);

        const ty = y + ROW_H - 0.6;   // baseline for text

        // Date
        doc.setFont('helvetica','normal'); doc.setFontSize(6.8); doc.setTextColor(0,0,0);
        txt(formatShortBusinessDate(r.date), cx('date')+2, ty);

        // Particulars (multi-line)
        doc.setTextColor(20,20,20);
        lines.forEach((ln,li) => txt(ln, cx('particulars')+2, ty + li*ROW_H));

        // Type (centered, coloured)
        doc.setFont('helvetica','bold'); doc.setFontSize(6.5);
        const isDebitType = (r.type==='Sales' || r.type==='Paid');
        doc.setTextColor(isDebitType ? 175:0, isDebitType ? 0:100, 0);
        txt(r.type, cx('type')+COL.type.w/2, ty, {align:'center'});

        // Debit (right-aligned)
        doc.setFont('helvetica','normal'); doc.setFontSize(6.8);
        if(r.debit > 0) {
            doc.setTextColor(175,0,0);
            txt('Rs. '+r.debit.toLocaleString('en-IN'), cxR('debit')-2, ty, {align:'right'});
        } else {
            doc.setTextColor(190,190,190);
            txt('-', cxR('debit')-2, ty, {align:'right'});
        }

        // Credit (right-aligned)
        if(r.credit > 0) {
            doc.setTextColor(0,110,0);
            txt('Rs. '+r.credit.toLocaleString('en-IN'), cxR('credit')-2, ty, {align:'right'});
        } else {
            doc.setTextColor(190,190,190);
            txt('-', cxR('credit')-2, ty, {align:'right'});
        }

        // Running Balance (right-aligned)
        doc.setFont('helvetica','bold'); doc.setFontSize(6.5);
        const bAbs  = Math.abs(r.balance);
        const bType = r.balance >= 0 ? 'Dr' : 'Cr';
        doc.setTextColor(r.balance>=0 ? 175:0, r.balance>=0 ? 0:100, 0);
        txt(bAbs.toLocaleString('en-IN')+' '+bType, cxR('balance')-2, ty, {align:'right'});

        y += rowH;
    });

    // ── SUMMARY BLOCK ────────────────────────────────────────────────
    const SUMMARY_H = 50;
    if(y + SUMMARY_H > BOTTOM) { newPage(false); y += 2; } else { y += 4; }

    const sRight  = ML + CW - 4;
    const sLabelX = ML + CW - 82;

    hline(sLabelX, ML+CW, y, 0.45);
    y += 5.5;

    doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(0,0,0);
    txt('Total Debit  :', sLabelX,  y);
    txt('Rs. '+pdfTotalDebit.toLocaleString('en-IN'), sRight, y, {align:'right'});
    y += 5.5;

    txt('Total Credit :', sLabelX, y);
    txt('Rs. '+pdfTotalCredit.toLocaleString('en-IN'), sRight, y, {align:'right'});
    y += 5.5;

    hline(sLabelX, ML+CW, y, 0.3, 190, 190, 190);
    y += 8;

    // Closing Balance Box
    const boxW=82, boxH=16, boxX=ML+CW-boxW;
    doc.setFillColor(pdfClosing>=0 ? 255:242, pdfClosing>=0 ? 242:252, pdfClosing>=0 ? 242:242);
    doc.setDrawColor(pdfClosing>=0 ? 200:150, pdfClosing>=0 ? 150:200, 150);
    doc.setLineWidth(0.45);
    doc.rect(boxX, y, boxW, boxH, 'FD');

    doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(70,70,70);
    txt('CLOSING BALANCE', boxX+boxW/2, y+5.5, {align:'center'});

    doc.setFontSize(12.5);
    doc.setTextColor(pdfClosing>=0 ? 175:0, pdfClosing>=0 ? 0:120, 0);
    txt('Rs. '+pdfClosingAbs.toLocaleString('en-IN')+' '+pdfClosingType, boxX+boxW/2, y+13, {align:'center'});

    // ── FOOTERS ──────────────────────────────────────────────────────
    drawAllFooters();

    doc.save(activeParty+'_Ledger_'+new Date().toISOString().split('T')[0]+'.pdf');
}

        // ═══════════════════════════════════════════
        // PARTY NAME AUTOCOMPLETE
        // ═══════════════════════════════════════════
        function initPartyAutocomplete(inputId) {
            const input = document.getElementById(inputId);
            if (!input) return;

            let dropdown = document.createElement('div');
            dropdown.className = 'party-autocomplete-dropdown';
            dropdown.style.cssText = 'display:none;position:absolute;top:100%;left:0;right:0;z-index:100;background:white;border:1px solid #e2e8f0;border-radius:12px;margin-top:4px;max-height:200px;overflow-y:auto;box-shadow:0 10px 25px rgba(0,0,0,0.1);';
            input.parentNode.style.position = 'relative';
            input.parentNode.appendChild(dropdown);

            function showSuggestions() {
                let query = input.value.trim().toLowerCase();
                let parties = getUniqueParties();
                let matches = parties.filter(p => p.toLowerCase().includes(query));

                if (matches.length === 0 || query === '') {
                    dropdown.style.display = 'none';
                    return;
                }

                dropdown.innerHTML = '';
                matches.forEach(party => {
                    let item = document.createElement('div');
                    item.textContent = party;
                    item.style.cssText = 'padding:10px 14px;cursor:pointer;font-size:13px;font-weight:600;color:#334155;border-bottom:1px solid #f1f5f9;transition:background 0.15s;';
                    item.onmouseenter = function () { this.style.background = '#f1f5f9'; };
                    item.onmouseleave = function () { this.style.background = 'white'; };
                    item.onmousedown = function (e) {
                        e.preventDefault();
                        input.value = party;
                        dropdown.style.display = 'none';
                        // Auto-fill phone number
                        let foundOrder = db.orders.find(o => o.party === party && o.phone);
                        if (inputId === 'ord-party' && foundOrder) {
                            let phoneInput = document.getElementById('ord-phone');
                            if (phoneInput) phoneInput.value = foundOrder.phone;
                        }
                    };
                    dropdown.appendChild(item);
                });
                dropdown.style.display = 'block';
            }

            input.addEventListener('input', showSuggestions);
            input.addEventListener('blur', function () {
                setTimeout(() => { dropdown.style.display = 'none'; }, 200);
            });
            input.addEventListener('focus', showSuggestions);
        }

        initPartyAutocomplete('ord-party');
        initPartyAutocomplete('pay-party');

        function logoutUser() {
            if (auth) {
                auth.signOut().then(() => {
                    showLoginScreen();
                });
            } else {
                showLoginScreen();
            }
        }
    
