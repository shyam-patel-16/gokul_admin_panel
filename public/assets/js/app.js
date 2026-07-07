
        // Database state setup
        let db = { orders: [], payments: [] };
        let activeBusiness = null;
        let companiesList = JSON.parse(localStorage.getItem('biz_companies_list')) || ['ABS', 'PP'];
        let activeParty = "";
        let firestoreDb = null;
        let unsubOrders = null;
        let unsubPayments = null;
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

        // Save data local storage and trigger UI updates
        function saveData() {
            if (activeBusiness) {
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

            const selectedRange = getSelectedLedgerDateRange();
            const startDate = selectedRange.startDate;
            const endDate = selectedRange.endDate;
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
                    <p class="text-[10px] text-slate-500 font-medium mt-1">To view data for ${company}</p>
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
                            title="Delete">
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
            let newCompany = prompt("Enter new company name:\n(e.g., PVC, LDPE, HDPE, LLDPE)");
            if (!newCompany || newCompany.trim() === "") return;
            // Keep alphanumeric + spaces, trim and uppercase
            newCompany = newCompany.trim().replace(/\s+/g, ' ');
            if (newCompany.length < 2) return alert("Name must be at least 2 characters long.");

            // Check duplicate (case-insensitive)
            if (companiesList.some(c => c.toLowerCase() === newCompany.toLowerCase())) {
                return alert(`Company "${newCompany}" already exists!`);
            }

            companiesList.push(newCompany);
            saveCompaniesList();
            alert(`✅ Company "${newCompany}" successfully added!\n\nNow click on the Business Selection Screen.`);
        }


        async function deleteCompany(companyName) {
            if (companiesList.length <= 1) return alert("You cannot delete all companies. At least 1 company is required.");
            
            let pass = prompt(`Warning! Do you really want to delete ${companyName}?\nAll orders and payments for this company will be permanently deleted!\n\nIf yes, enter your login password:`);
            if (!pass) return;

            if (isFirebaseConnected && auth && auth.currentUser) {
                try {
                    // Re-authenticate user
                    let cred = firebase.auth.EmailAuthProvider.credential(auth.currentUser.email, pass);
                    await auth.currentUser.reauthenticateWithCredential(cred);
                    
                    // Password correct, proceed to delete
                    companiesList = companiesList.filter(c => c !== companyName);
                    saveCompaniesList();
                    
                    alert(`Company ${companyName} has been deleted!`);
                    
                    if (activeBusiness === companyName) {
                        activeBusiness = null;
                        showBusinessSelection();
                    }
                } catch (error) {
                    alert("Incorrect password! Company could not be deleted.");
                }
            } else {
                alert("No internet/Firebase connection. Online mode is required to delete a company.");
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
            if (!db.orders) db.orders = [];
            if (!db.payments) db.payments = [];
            
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
                // - Tab open = Logged in (refresh okay)
                // - Tab/Browser closed = Logout (fresh login)
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
                throw new Error("Invalid Configuration JSON or object format.");
            }
        }

        // Disconnect firebase settings (Disabled for online-only)
        function disconnectFirebase() {
            alert("App is in online-only mode. Cannot disconnect.");
        }

        // Migrate local storage records to Firebase Firestore cloud database
        async function migrateLocalDataToFirebase() {
            if (!isFirebaseConnected || !firestoreDb) return alert("Please link Firebase from settings first!");
            let localDb = JSON.parse(localStorage.getItem(`biz_db_${activeBusiness}`)) || { orders: [], payments: [] };
            if (confirm(`Are you sure you want to upload all local storage data to the online Firebase server?`)) {
                try {
                    let batch = firestoreDb.batch();
                    let ordersCol = activeBusiness === 'ABS' ? 'orders' : activeBusiness + '_orders';
                    let paymentsCol = activeBusiness === 'ABS' ? 'payments' : activeBusiness + '_payments';
                    localDb.orders.forEach(order => batch.set(firestoreDb.collection(ordersCol).doc(order.id.toString()), order));
                    localDb.payments.forEach(pay => batch.set(firestoreDb.collection(paymentsCol).doc(pay.id.toString()), pay));
                    await batch.commit();
                    alert("All data uploaded to Firebase successfully!");
                    initFirebase();
                } catch (err) { alert("Error: " + err.message); }
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
                        if (confirm("Are you sure you want to load this backup file? Existing data in your browser will be overwritten.")) {
                            db = importedDb;
                            saveData();
                            alert("Data imported successfully!");
                        }
                    } else {
                        alert("Invalid backup file format! It must contain order and payment data.");
                    }
                } catch (err) {
                    alert("Error reading file: " + err.message);
                }
            };
            reader.readAsText(file);
        }

        // Dynamic order items builder state and helper functions
        let currentOrderItems = [];

        function renderOrderItemsList() {
            const tbody = document.getElementById('order-items-table-body');
            const totalQtyEl = document.getElementById('order-items-total-qty');
            const totalAmountEl = document.getElementById('order-items-total-amount');

            if (!tbody) return;

            tbody.innerHTML = "";
            let totalQty = 0;
            let totalAmount = 0;

            if (currentOrderItems.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" class="p-6 text-center text-slate-400 font-semibold bg-white">
                            No items added yet
                        </td>
                    </tr>
                `;
            } else {
                currentOrderItems.forEach((item, index) => {
                    const rowAmount = item.qty * item.price;
                    totalQty += item.qty;
                    totalAmount += rowAmount;

                    tbody.innerHTML += `
                        <tr class="hover:bg-slate-50 border-b border-slate-100 transition">
                            <td class="p-2.5 text-center text-slate-400 font-bold">${index + 1}</td>
                            <td class="p-2.5 font-bold text-slate-850">${item.name}</td>
                            <td class="p-2.5 text-center font-bold text-slate-700">${item.qty}</td>
                            <td class="p-2.5 text-right font-semibold text-slate-600">₹${item.price.toLocaleString('en-IN')}</td>
                            <td class="p-2.5 text-right font-extrabold text-indigo-650">₹${rowAmount.toLocaleString('en-IN')}</td>
                            <td class="p-2.5 text-center">
                                <button type="button" onclick="removeOrderItemRow(${index})" class="text-red-500 hover:text-red-700 p-1 font-bold transition" title="Delete">
                                    <i class="fa-solid fa-trash-can text-xs"></i>
                                </button>
                            </td>
                        </tr>
                    `;
                });
            }

            if (totalQtyEl) totalQtyEl.innerText = totalQty;
            if (totalAmountEl) totalAmountEl.innerText = "₹" + totalAmount.toLocaleString('en-IN');

            // Update hidden inputs for original form fields compatibility
            const ordItemEl = document.getElementById('ord-item');
            const ordQtyEl = document.getElementById('ord-qty');
            const ordPriceEl = document.getElementById('ord-price');

            if (ordItemEl && ordQtyEl && ordPriceEl) {
                if (currentOrderItems.length === 0) {
                    ordItemEl.value = "";
                    ordQtyEl.value = "";
                    ordPriceEl.value = "";
                } else {
                    // Item description format: "Item1, Qty1, Price1\nItem2, Qty2, Price2"
                    ordItemEl.value = currentOrderItems.map(item => `${item.name}, ${item.qty}, ${item.price}`).join('\n');
                    ordQtyEl.value = totalQty;
                    // Average price = totalAmount / totalQty
                    ordPriceEl.value = totalQty > 0 ? Number((totalAmount / totalQty).toFixed(4)) : 0;
                }
            }
        }

        function addOrderItemRow() {
            const nameInput = document.getElementById('item-input-name');
            const qtyInput = document.getElementById('item-input-qty');
            const priceInput = document.getElementById('item-input-price');

            if (!nameInput || !qtyInput || !priceInput) return;

            const name = nameInput.value.trim();
            const qty = parseFloat(qtyInput.value);
            let price = parseFloat(priceInput.value);
            
            // Default to 0 price if left blank
            if (priceInput.value.trim() === "") {
                price = 0;
            }

            if (!name) {
                alert("Please enter Item Name");
                nameInput.focus();
                return;
            }
            if (isNaN(qty) || qty <= 0) {
                alert("Please enter valid Quantity");
                qtyInput.focus();
                return;
            }
            if (isNaN(price) || price < 0) {
                alert("Please enter valid Price");
                priceInput.focus();
                return;
            }

            currentOrderItems.push({ name, qty, price });
            
            // Clear inputs for next entry
            nameInput.value = "";
            qtyInput.value = "";
            priceInput.value = "";
            const totalInput = document.getElementById('item-input-total');
            if (totalInput) totalInput.value = "";

            renderOrderItemsList();
            nameInput.focus();
        }

        function removeOrderItemRow(index) {
            currentOrderItems.splice(index, 1);
            renderOrderItemsList();
        }

        function importFromText() {
            const importTextarea = document.getElementById('item-import-textarea');
            if (!importTextarea) return;

            const text = importTextarea.value.trim();
            if (!text) {
                alert("Please paste some items first");
                return;
            }

            let lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
            let importedCount = 0;

            for (let line of lines) {
                let parsed = parseSingleLine(line);
                if (parsed) {
                    currentOrderItems.push({
                        name: parsed.name || "Unnamed Item",
                        qty: parsed.qty || 0,
                        price: parsed.price || 0
                    });
                    importedCount++;
                } else {
                    currentOrderItems.push({
                        name: line,
                        qty: 0,
                        price: 0
                    });
                    importedCount++;
                }
            }

            if (importedCount > 0) {
                renderOrderItemsList();
                importTextarea.value = "";
                document.getElementById('import-container').classList.add('hidden');
                alert(`Successfully imported ${importedCount} items!`);
            } else {
                alert("No valid items found. Please check the format.");
            }
        }

        window.addOrderItemRow = addOrderItemRow;
        window.removeOrderItemRow = removeOrderItemRow;
        window.importFromText = importFromText;

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
            } else if (pageId === 'add-order') {
                const nameInput = document.getElementById('item-input-name');
                const qtyInput = document.getElementById('item-input-qty');
                const priceInput = document.getElementById('item-input-price');
                if (nameInput) nameInput.value = "";
                if (qtyInput) qtyInput.value = "";
                if (priceInput) priceInput.value = "";
                currentOrderItems = [];
                renderOrderItemsList();
                setTimeout(() => {
                    if (nameInput) nameInput.focus();
                }, 50);
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

        // Setup Event Handlers for Order Items Inputs (Enter Key navigation & Auto-calculation of Row Total)
        function setupItemInputHandlers() {
            const nameInput = document.getElementById('item-input-name');
            const qtyInput = document.getElementById('item-input-qty');
            const priceInput = document.getElementById('item-input-price');
            const totalInput = document.getElementById('item-input-total');

            // Keyboard navigation (Enter key shifts focus or submits)
            if (nameInput) {
                nameInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        if (qtyInput) qtyInput.focus();
                    }
                });
            }

            if (qtyInput) {
                qtyInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        if (priceInput) priceInput.focus();
                    }
                });
                
                qtyInput.addEventListener('input', updateItemInputTotal);
            }

            if (priceInput) {
                priceInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        addOrderItemRow();
                    }
                });
                
                priceInput.addEventListener('input', updateItemInputTotal);
            }

            function updateItemInputTotal() {
                if (qtyInput && priceInput && totalInput) {
                    const qty = parseFloat(qtyInput.value) || 0;
                    const price = parseFloat(priceInput.value) || 0;
                    totalInput.value = qty > 0 && price >= 0 ? (qty * price).toFixed(2) : "";
                }
            }
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setupItemInputHandlers);
        } else {
            setupItemInputHandlers();
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

            if (currentOrderItems.length === 0) {
                alert("Please add at least one item to the order items list");
                return;
            }

            renderOrderItemsList();

            let totalQty = currentOrderItems.reduce((sum, item) => sum + item.qty, 0);
            let totalAmount = currentOrderItems.reduce((sum, item) => sum + (item.qty * item.price), 0);
            let averagePrice = totalQty > 0 ? Number((totalAmount / totalQty).toFixed(4)) : 0;

            let newOrder = {
                id: Date.now(),
                type: document.getElementById('ord-type').value,
                date: document.getElementById('ord-date').value,
                timestamp: new Date(document.getElementById('ord-date').value).getTime() || Date.now(),
                party: partyName,
                phone: existingPhone,
                item: currentOrderItems.map(item => `${item.name}, ${item.qty}, ${item.price}`).join('\n'),
                qty: totalQty,
                price: averagePrice,
                amount: totalAmount,
                status: document.getElementById('ord-status').value
            };

            if (isFirebaseConnected && firestoreDb) {
                let ordersCol = activeBusiness === 'ABS' ? 'orders' : activeBusiness + '_orders';
                firestoreDb.collection(ordersCol).doc(newOrder.id.toString()).set(newOrder);
            } else {
                db.orders.push(newOrder);
                saveData();
            }

            currentOrderItems = [];
            renderOrderItemsList();

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
                document.getElementById('chart-subtitle').innerText = "Last 7 Days — Sales, Buying, Received, Paid";
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
                document.getElementById('chart-subtitle').innerText = "Last 4 Weeks — Sales, Buying, Received, Paid";
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
                document.getElementById('chart-subtitle').innerText = "Last 6 Months — Sales, Buying, Received, Paid";
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
                    let currentPhone = lastOrderWithPhone ? lastOrderWithPhone.phone : "None";

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
                box.innerHTML = `<p class="text-slate-400 text-center py-6 text-xs">No party found.</p>`;
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
            let currentPhone = lastOrderWithPhone ? lastOrderWithPhone.phone : "None";
            const phoneBadge = document.getElementById('selected-party-phone-badge');
            phoneBadge.classList.remove('hidden');
            document.getElementById('party-phone-span').innerHTML = `📞 ${currentPhone} <button onclick="editPartyPhone('${party}', '${currentPhone === 'None' ? '' : currentPhone}')" class="text-accent hover:text-accentHover ml-1.5 font-bold hover:underline">✏️ Edit</button>`;

            // Orders Table
            let orderTable = document.getElementById('party-orders-table');
            orderTable.innerHTML = partyOrders.length === 0 ? `<p class="text-slate-400 text-center py-6">No order entries.</p>` : "";

            partyOrders.forEach(o => {
                let badgeColor = o.type === 'Sales' ? 'bg-indigo-50 text-indigo-700 border-indigo-100' : 'bg-orange-50 text-orange-700 border-orange-100';
                let statusClass = o.status === 'Complete' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100';
                let actionStack = `
                    <div class="flex flex-col gap-1 items-end min-w-[70px] no-print">
                        <button onclick="toggleStatus(${o.id})" class="px-2 py-0.5 border rounded-lg text-[9px] font-bold ${statusClass} flex items-center justify-center gap-0.5 transition w-full" title="Change Status">${o.status} <i class="fa-solid fa-arrows-rotate text-[8px] ml-0.5"></i></button>
                        ${o.status === 'Complete' ? `
                            <button onclick="generateChallan(${o.id})" class="text-[10px] bg-white border border-accent text-accent px-2 py-0.5 rounded-lg hover:bg-indigo-50 flex items-center justify-center gap-0.5 transition w-full" title="Print Challan"><i class="fa-solid fa-print"></i>Challan</button>
                            <button id="share-order-btn-${o.id}" onclick="shareChallanDirectly(${o.id})" class="text-[10px] bg-white border border-emerald-600 text-emerald-600 px-2 py-0.5 rounded-lg hover:bg-emerald-50 flex items-center justify-center gap-0.5 transition w-full" title="Share Challan"><i class="fa-solid fa-share-nodes"></i>Share</button>
                        ` : ''}
                    </div>
                `;

                orderTable.innerHTML += `
                    <div class="bg-white p-3 rounded-xl border border-slate-100 shadow-2xs space-y-2 relative group">
                        <div class="absolute top-2 right-2 flex space-x-1.5 opacity-40 group-hover:opacity-100 transition no-print">
                            <button onclick="editOrder(${o.id})" class="text-slate-400 hover:text-accent" title="Edit Order"><i class="fa-solid fa-pen-to-square"></i></button>
                            <button onclick="deleteItem('orders', ${o.id})" class="text-slate-400 hover:text-red-500"><i class="fa-solid fa-trash-can"></i></button>
                        </div>
                        <div class="flex justify-between items-center text-[10px]">
                            <span class="px-2 py-0.5 border rounded-lg font-bold ${badgeColor}">${o.type}</span>
                            <span class="text-slate-400 font-medium pr-10">${formatShortBusinessDate(o.date)}</span>
                        </div>
                        <p class="font-bold text-slate-800 text-xs">${o.item} <span class="text-slate-400">(${o.qty} x ₹${o.price})</span></p>
                        <div class="flex justify-between items-center pt-2 border-t border-dashed border-slate-100">
                            <span class="font-extrabold text-slate-800">₹${o.amount.toLocaleString('en-IN')}</span>
                            ${actionStack}
                        </div>
                    </div>
                `;
            });

            // Payments Table
            let paymentTable = document.getElementById('party-payments-table');
            paymentTable.innerHTML = partyPayments.length === 0 ? `<p class="text-slate-400 text-center py-6">No payment records.</p>` : "";

            partyPayments.forEach(p => {
                let badgeColor = p.type === 'Received' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100';
                paymentTable.innerHTML += `
                    <div class="bg-white p-3 rounded-xl border border-slate-100 shadow-2xs flex justify-between items-center relative group">
                        <div class="space-y-1.5">
                            <div class="flex items-center space-x-2">
                                <span class="px-2 py-0.5 border rounded-lg text-[9px] font-bold ${badgeColor}">${p.type}</span>
                                <span class="text-slate-400 text-[10px] font-medium">${formatShortBusinessDate(p.date)}</span>
                            </div>
                            <p class="font-bold text-slate-800 text-xs">Amount: <span class="font-extrabold">₹${p.amount.toLocaleString('en-IN')}</span></p>
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
            let newPhone = prompt(`"${partyName}" for New WhatsApp Mobile Number write:`, existingPhone);
            if (newPhone === null) return;
            newPhone = newPhone.trim();

            if (newPhone && !/^\d{10}$/.test(newPhone)) {
                alert("Please enter a valid 10-digit mobile number.");
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
                    alert("Mobile number updated successfully on Firebase!");
                } catch (err) {
                    alert("Error: " + err.message);
                }
            } else {
                db.orders.forEach(o => {
                    if (o.party === partyName) {
                        o.phone = newPhone;
                    }
                });
                saveData();
                alert("Mobile number updated in local backup!");
            }
        }

        // Edit Order Details (Item, Qty, Price)
        function editOrder(orderId) {
            let order = db.orders.find(o => o.id === orderId);
            if (!order) return;

            let newItem = prompt("Edit item details:", order.item);
            if (newItem === null) return;

            let calculated = calculateTotalsFromDescription(newItem);
            let defaultQty = calculated ? calculated.qty : order.qty;
            let defaultPrice = calculated ? calculated.price : order.price;

            let newQtyStr = prompt("Edit Quantity (Qty):", defaultQty);
            if (newQtyStr === null) return;
            let newQty = parseFloat(newQtyStr);

            let newPriceStr = prompt("Edit Price:", defaultPrice);
            if (newPriceStr === null) return;
            let newPrice = parseFloat(newPriceStr);

            if (isNaN(newQty) || isNaN(newPrice)) {
                alert("Please enter valid numbers for Price and Quantity.");
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
                    .then(() => alert("Order details updated on Firebase!"))
                    .catch(err => alert("Error: " + err.message));
            } else {
                Object.assign(order, updatedData);
                saveData();
                alert("Order details have been saved locally!");
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
            recentOrdersBox.innerHTML = lastOrders.length === 0 ? `<p class="text-slate-400 text-center py-6 text-xs font-semibold">No orders.</p>` : "";
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
            recentPaymentsBox.innerHTML = lastPayments.length === 0 ? `<p class="text-slate-400 text-center py-6 text-xs font-semibold">No payments.</p>` : "";
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
                let actionStack = `
                    <div class="flex flex-col gap-1 items-center w-full min-w-[70px]">
                        <button onclick="toggleStatus(${o.id})" class="px-2 py-0.5 border rounded-lg text-[9px] font-bold ${statusBadge} inline-flex items-center justify-center gap-0.5 hover:shadow-xs transition w-full" title="Change Status">
                            ${o.status} <i class="fa-solid fa-arrows-rotate text-[8px]"></i>
                        </button>
                        ${o.status === 'Complete' ? `
                            <button onclick="generateChallan(${o.id})" class="bg-white border border-accent text-accent px-2 py-0.5 rounded-lg hover:bg-indigo-50 text-[10px] font-bold flex items-center justify-center gap-0.5 transition w-full" title="Print Challan"><i class="fa-solid fa-print"></i>Challan</button>
                            <button id="share-order-btn-${o.id}" onclick="shareChallanDirectly(${o.id})" class="bg-white border border-emerald-600 text-emerald-600 px-2 py-0.5 rounded-lg hover:bg-emerald-50 text-[10px] font-bold flex items-center justify-center gap-0.5 transition w-full" title="Share WhatsApp/PDF"><i class="fa-solid fa-share-nodes"></i>Share</button>
                        ` : ''}
                    </div>
                `;

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
                            <span class="px-2 py-0.5 border rounded-lg text-[9px] font-bold ${statusBadge}">
                                ${o.status}
                            </span>
                        </td>
                        <td class="p-4 text-center no-print flex justify-center items-center gap-3">
                            ${actionStack}
                            <div class="flex flex-col gap-1.5">
                                <button onclick="editOrder(${o.id})" class="text-slate-400 hover:text-accent p-1" title="Edit"><i class="fa-solid fa-pen-to-square text-xs"></i></button>
                                <button onclick="deleteItem('orders', ${o.id})" class="text-slate-400 hover:text-red-500 p-1" title="Delete"><i class="fa-solid fa-trash-can text-xs"></i></button>
                            </div>
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
                            <button onclick="deleteItem('payments', ${p.id})" class="text-slate-400 hover:text-red-500 p-1" title="Delete"><i class="fa-solid fa-trash-can text-xs"></i></button>
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
                statusEl.innerHTML = `<span class="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></span>Live Connected 🟢`;
                disconnectBtn.classList.remove('hidden');
                migrationBox.classList.remove('hidden');
            } else {
                statusEl.className = "font-black text-red-600 bg-red-50 px-2.5 py-0.5 rounded border border-red-100 flex items-center gap-1.5";
                statusEl.innerHTML = `<span class="w-1.5 h-1.5 bg-red-500 rounded-full"></span>Offline (Local Mode)`;
                disconnectBtn.classList.add('hidden');
                migrationBox.classList.add('hidden');
            }
        }

        // Generate print delivery challan
        // Generate Ledger Print Report
        function generateLedgerPrint(partyName) {
            if (!partyName) return alert("Please select a party first.");

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

                tbody.innerHTML += `
                    <tr class="border-b border-slate-800">
                        <td class="p-2 border-r border-slate-800">${t.displayDate}</td>
                        <td class="p-2 border-r border-slate-800">${t.particulars}</td>
                        <td class="p-2 border-r border-slate-800 text-center text-[10px]">${t.type}</td>
                        <td class="p-2 border-r border-slate-800 text-right">${t.debit > 0 ? '₹'+t.debit.toLocaleString('en-IN') : '-'}</td>
                        <td class="p-2 border-r border-slate-800 text-right">${t.credit > 0 ? '₹'+t.credit.toLocaleString('en-IN') : '-'}</td>
                        <td class="p-2 text-right bg-slate-50 ${balanceColor}">₹${Math.abs(runningBalance).toLocaleString('en-IN')}</td>
                    </tr>
                `;
            });

            // Summary row
            document.getElementById('lp-total-debit').innerText = "₹" + totalDebit.toLocaleString('en-IN');
            document.getElementById('lp-total-credit').innerText = "₹" + totalCredit.toLocaleString('en-IN');
            document.getElementById('lp-final-balance').innerText = "₹" + Math.abs(runningBalance).toLocaleString('en-IN');

            document.getElementById('lp-closing-balance').innerText = "₹" + Math.abs(runningBalance).toLocaleString('en-IN');
            document.getElementById('lp-closing-balance').className = runningBalance >= 0 ? "text-2xl font-black text-red-600" : "text-2xl font-black text-emerald-600";
            document.getElementById('lp-balance-type').innerText = runningBalance >= 0 ? "Total Pending Amount (Due)" : "Advance / Excess Amount";

            // Show Modal
            document.getElementById('ledger-print-modal').classList.remove('hidden');
        }

        function closeLedgerPrint() {
            document.getElementById('ledger-print-modal').classList.add('hidden');
        }

        function numberToWords(num) {
            num = Math.round(num);
            if (num === 0) return 'Zero Rupees Only';
            
            const single = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
            const double = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
            
            function convertLessThanOneThousand(n) {
                let temp = '';
                if (n >= 100) {
                    temp += single[Math.floor(n / 100)] + ' Hundred ';
                    n %= 100;
                }
                if (n >= 20) {
                    temp += double[Math.floor(n / 10)] + ' ';
                    n %= 10;
                }
                if (n > 0) {
                    temp += single[n] + ' ';
                }
                return temp;
            }
            
            let words = '';
            let integerPart = num;
            
            // Crore
            if (integerPart >= 10000000) {
                words += convertLessThanOneThousand(Math.floor(integerPart / 10000000)) + 'Crore ';
                integerPart %= 10000000;
            }
            // Lakh
            if (integerPart >= 100000) {
                words += convertLessThanOneThousand(Math.floor(integerPart / 100000)) + 'Lakh ';
                integerPart %= 100000;
            }
            // Thousand
            if (integerPart >= 1000) {
                words += convertLessThanOneThousand(Math.floor(integerPart / 1000)) + 'Thousand ';
                integerPart %= 1000;
            }
            // Remainder
            if (integerPart > 0) {
                words += convertLessThanOneThousand(integerPart);
            }
            
            return words.trim() + ' Rupees Only';
        }

        function updateChallanInputs() {
            const vehicleElInput = document.getElementById('challan-input-vehicle');
            const vehicle = vehicleElInput ? vehicleElInput.value.trim() || '-' : '-';
            
            const transportElInput = document.getElementById('challan-input-transport');
            const transport = transportElInput ? transportElInput.value.trim() || 'Self' : 'Self';
            
            const hsnElInput = document.getElementById('challan-input-hsn');
            const hsn = hsnElInput ? hsnElInput.value.trim() || '39269099' : '39269099';

            for (let i = 1; i <= 2; i++) {
                const vehicleEl = document.getElementById(`ch${i}-vehicle`);
                const transportEl = document.getElementById(`ch${i}-transport`);
                const hsnEl = document.getElementById(`ch${i}-hsn`);

                if (vehicleEl) vehicleEl.innerText = vehicle;
                if (transportEl) transportEl.innerText = transport;
                if (hsnEl) hsnEl.innerText = hsn;
            }
        }
        window.updateChallanInputs = updateChallanInputs;

        function parseSingleLine(line) {
            if (!line) return null;
            line = line.trim();
            if (line === '') return null;

            // Try comma split first: Item, Qty, Rate
            let parts = line.split(',');
            if (parts.length >= 3) {
                let qty = parseFloat(parts[parts.length - 2]);
                let price = parseFloat(parts[parts.length - 1]);
                if (!isNaN(qty) && !isNaN(price)) {
                    let name = parts.slice(0, parts.length - 2).join(',').trim();
                    return { name, qty, price, amount: qty * price };
                }
            }
            if (parts.length === 2) {
                let qty = parseFloat(parts[1]);
                if (!isNaN(qty)) {
                    return { name: parts[0].trim(), qty: qty, price: null, amount: null };
                }
            }

            // Try dash split: Item - Qty - Rate
            parts = line.split('-');
            if (parts.length >= 3) {
                let qty = parseFloat(parts[parts.length - 2]);
                let price = parseFloat(parts[parts.length - 1]);
                if (!isNaN(qty) && !isNaN(price)) {
                    let name = parts.slice(0, parts.length - 2).join('-').trim();
                    return { name, qty, price, amount: qty * price };
                }
            }
            if (parts.length === 2) {
                let qty = parseFloat(parts[1]);
                if (!isNaN(qty)) {
                    return { name: parts[0].trim(), qty: qty, price: null, amount: null };
                }
            }

            // Try space split at the end: Item Qty Rate
            let match = line.match(/^(.*?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/);
            if (match) {
                let qty = parseFloat(match[2]);
                let price = parseFloat(match[3]);
                return {
                    name: match[1].trim(),
                    qty: qty,
                    price: price,
                    amount: qty * price
                };
            }
            let matchQty = line.match(/^(.*?)\s+(\d+(?:\.\d+)?)$/);
            if (matchQty) {
                let qty = parseFloat(matchQty[2]);
                return {
                    name: matchQty[1].trim(),
                    qty: qty,
                    price: null,
                    amount: null
                };
            }

            return null;
        }

        function calculateTotalsFromDescription(text) {
            let lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
            if (lines.length === 0) return null;

            let totalQty = 0;
            let totalAmount = 0;
            let hasQty = false;
            let hasAmount = false;

            for (let line of lines) {
                let parsed = parseSingleLine(line);
                if (parsed) {
                    if (parsed.qty !== null) {
                        totalQty += parsed.qty;
                        hasQty = true;
                    }
                    if (parsed.amount !== null) {
                        totalAmount += parsed.amount;
                        hasAmount = true;
                    }
                }
            }

            if (hasQty && totalQty > 0) {
                return {
                    qty: totalQty,
                    price: hasAmount ? Number((totalAmount / totalQty).toFixed(4)) : 0,
                    totalAmount: totalAmount
                };
            }
            return null;
        }

        function generateChallan(orderId) {
            let order = db.orders.find(o => o.id === orderId);
            if (order) {
                let autoNo = getChallanSequenceNumber(order.id);
                
                // Parse items from order.item description
                let items = [];
                let lines = order.item.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
                
                if (lines.length <= 1) {
                    // Try to parse single line
                    let parsed = parseSingleLine(lines[0] || order.item);
                    if (parsed) {
                        items.push(parsed);
                    } else {
                        items.push({
                            name: order.item,
                            qty: order.qty,
                            price: order.price,
                            amount: order.amount
                        });
                    }
                } else {
                    for (let line of lines) {
                        let parsed = parseSingleLine(line);
                        if (parsed) {
                            items.push(parsed);
                        } else {
                            items.push({
                                name: line,
                                qty: null,
                                price: null,
                                amount: null
                            });
                        }
                    }
                }

                // Calculate totals of parsed items
                let totalQty = 0;
                let totalAmount = 0;
                let hasQty = false;
                let hasAmount = false;

                items.forEach(item => {
                    if (item.qty !== null) {
                        totalQty += item.qty;
                        hasQty = true;
                    }
                    if (item.amount !== null) {
                        totalAmount += item.amount;
                        hasAmount = true;
                    }
                });

                // Fallback to order total if no items had parsed amounts
                if (!hasAmount) {
                    totalAmount = order.amount;
                }
                if (!hasQty) {
                    totalQty = order.qty;
                }

                let formattedTotal = "₹" + totalAmount.toLocaleString('en-IN');
                let words = numberToWords(totalAmount);

                // Reset inputs safely
                const vehicleInput = document.getElementById('challan-input-vehicle');
                if (vehicleInput) vehicleInput.value = '';
                
                const transportInput = document.getElementById('challan-input-transport');
                if (transportInput) transportInput.value = 'Road';
                
                const hsnInput = document.getElementById('challan-input-hsn');
                if (hsnInput) hsnInput.value = '39269099';

                for (let i = 1; i <= 2; i++) {
                    const partyEl = document.getElementById(`ch${i}-party`);
                    if (partyEl) partyEl.innerText = order.party;

                    const phoneEl = document.getElementById(`ch${i}-phone`);
                    if (phoneEl) phoneEl.innerText = order.phone || '-';

                    const dateEl = document.getElementById(`ch${i}-date`);
                    if (dateEl) dateEl.innerText = formatBusinessDate(order.date);

                    const numEl = document.getElementById(`ch${i}-num`);
                    if (numEl) numEl.innerText = autoNo;

                    // Render table body
                    const tbody = document.getElementById(`ch${i}-table-body`);
                    if (tbody) {
                        const table = tbody.closest('table');
                        const hasSN = table && table.querySelectorAll('thead th').length === 5;
                        let html = "";
                        items.forEach((item, index) => {
                            let qtyText = item.qty !== null ? item.qty : "-";
                            let priceText = item.price !== null ? "₹" + item.price.toLocaleString('en-IN') : "-";
                            let amountText = item.amount !== null ? "₹" + item.amount.toLocaleString('en-IN') : "-";

                            if (hasSN) {
                                html += `
                                    <tr>
                                        <td class="p-2 border border-slate-800 text-center font-bold text-slate-700" style="width: 8%;">${index + 1}</td>
                                        <td class="p-2 border border-slate-800 font-bold text-xs whitespace-pre-wrap break-words min-h-[40px]" style="width: 60%;">${item.name}</td>
                                        <td class="p-2 border border-slate-800 text-center text-xs font-bold" style="width: 10%;">${qtyText}</td>
                                        <td class="p-2 border border-slate-800 text-right text-xs font-bold" style="width: 10%;">${priceText}</td>
                                        <td class="p-2 border border-slate-800 text-right font-black text-xs bg-slate-50" style="width: 12%;">${amountText}</td>
                                    </tr>
                                `;
                            } else {
                                html += `
                                    <tr>
                                        <td class="p-4 border border-slate-800 font-bold text-sm whitespace-pre-wrap break-words min-h-[60px]">${item.name}</td>
                                        <td class="p-4 text-center border border-slate-800 text-sm font-bold">${qtyText}</td>
                                        <td class="p-4 text-right border border-slate-800 text-sm font-bold">${priceText}</td>
                                        <td class="p-4 text-right font-black border border-slate-800 text-sm bg-slate-50">${amountText}</td>
                                    </tr>
                                `;
                            }
                        });

                        // Add spacer row to absorb remaining height and push total to bottom
                        if (hasSN) {
                            html += `
                                <tr class="spacer-row">
                                    <td class="p-2 border border-slate-800" style="width: 8%;">&nbsp;</td>
                                    <td class="p-2 border border-slate-800" style="width: 60%;">&nbsp;</td>
                                    <td class="p-2 border border-slate-800" style="width: 10%;">&nbsp;</td>
                                    <td class="p-2 border border-slate-800" style="width: 10%;">&nbsp;</td>
                                    <td class="p-2 border border-slate-800 bg-slate-50" style="width: 12%;">&nbsp;</td>
                                </tr>
                            `;
                        } else {
                            html += `
                                <tr class="spacer-row">
                                    <td class="p-4 border border-slate-800" style="width: 68%;">&nbsp;</td>
                                    <td class="p-4 border border-slate-800" style="width: 10%;">&nbsp;</td>
                                    <td class="p-4 border border-slate-800" style="width: 10%;">&nbsp;</td>
                                    <td class="p-4 border border-slate-800 bg-slate-50" style="width: 12%;">&nbsp;</td>
                                </tr>
                            `;
                        }

                        // Add Total row
                        let totalQtyText = "";
                        if (hasSN) {
                            html += `
                                <tr class="font-bold border-t border-slate-800 bg-slate-50">
                                    <td colspan="2" class="p-2 border border-slate-800 text-right font-bold uppercase" style="width: 68%;">Total:</td>
                                    <td class="p-2 border border-slate-800 text-center font-bold" style="width: 10%;">${totalQtyText}</td>
                                    <td class="p-2 border border-slate-800 text-right font-bold" style="width: 10%;"></td>
                                    <td class="p-2 border border-slate-800 text-right font-bold text-xs bg-slate-100" style="width: 12%;">${formattedTotal}</td>
                                </tr>
                            `;
                        } else {
                            html += `
                                <tr class="font-bold border-t border-slate-800 bg-slate-50">
                                    <td class="p-2 border border-slate-800 text-right font-bold uppercase" style="width: 68%;">Total:</td>
                                    <td class="p-2 border border-slate-800 text-center font-bold" style="width: 10%;">${totalQtyText}</td>
                                    <td class="p-2 border border-slate-800 text-right font-bold" style="width: 10%;"></td>
                                    <td class="p-2 border border-slate-800 text-right font-bold text-xs bg-slate-100" style="width: 12%;">${formattedTotal}</td>
                                </tr>
                            `;
                        }
                        tbody.innerHTML = html;
                    }

                    const wordsEl = document.getElementById(`ch${i}-words`);
                    if (wordsEl) wordsEl.innerText = words;
                }

                // Initial sync
                updateChallanInputs();

                document.getElementById('wp-share-btn').onclick = function () {
                    shareChallanPDF(order, autoNo);
                };

                document.getElementById('challan-modal').classList.remove('hidden');
            }
        }

        function shareChallanDirectly(orderId) {
            let order = db.orders.find(o => o.id === orderId);
            if (!order) return;
            let autoNo = getChallanSequenceNumber(order.id);
            
            // Parse items from order.item description
            let items = [];
            let lines = order.item.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
            
            if (lines.length <= 1) {
                let parsed = parseSingleLine(lines[0] || order.item);
                if (parsed) {
                    items.push(parsed);
                } else {
                    items.push({
                        name: order.item,
                        qty: order.qty,
                        price: order.price,
                        amount: order.amount
                    });
                }
            } else {
                for (let line of lines) {
                    let parsed = parseSingleLine(line);
                    if (parsed) {
                        items.push(parsed);
                    } else {
                        items.push({
                            name: line,
                            qty: null,
                            price: null,
                            amount: null
                        });
                    }
                }
            }

            let totalQty = 0;
            let totalAmount = 0;
            let hasQty = false;
            let hasAmount = false;

            items.forEach(item => {
                if (item.qty !== null) {
                    totalQty += item.qty;
                    hasQty = true;
                }
                if (item.amount !== null) {
                    totalAmount += item.amount;
                    hasAmount = true;
                }
            });

            if (!hasAmount) {
                totalAmount = order.amount;
            }
            if (!hasQty) {
                totalQty = order.qty;
            }

            let formattedTotal = "₹" + totalAmount.toLocaleString('en-IN');
            let words = numberToWords(totalAmount);

            for (let i = 1; i <= 2; i++) {
                const partyEl = document.getElementById(`ch${i}-party`);
                if (partyEl) partyEl.innerText = order.party;

                const phoneEl = document.getElementById(`ch${i}-phone`);
                if (phoneEl) phoneEl.innerText = order.phone || '-';

                const dateEl = document.getElementById(`ch${i}-date`);
                if (dateEl) dateEl.innerText = formatBusinessDate(order.date);

                const numEl = document.getElementById(`ch${i}-num`);
                if (numEl) numEl.innerText = autoNo;

                const tbody = document.getElementById(`ch${i}-table-body`);
                if (tbody) {
                    const table = tbody.closest('table');
                    const hasSN = table && table.querySelectorAll('thead th').length === 5;
                    let html = "";
                    items.forEach((item, index) => {
                        let qtyText = item.qty !== null ? item.qty : "-";
                        let priceText = item.price !== null ? "₹" + item.price.toLocaleString('en-IN') : "-";
                        let amountText = item.amount !== null ? "₹" + item.amount.toLocaleString('en-IN') : "-";

                        if (hasSN) {
                            html += `
                                <tr>
                                    <td class="p-2 border border-slate-800 text-center font-bold text-slate-700" style="width: 8%;">${index + 1}</td>
                                    <td class="p-2 border border-slate-800 font-bold text-xs whitespace-pre-wrap break-words min-h-[40px]" style="width: 60%;">${item.name}</td>
                                    <td class="p-2 border border-slate-800 text-center text-xs font-bold" style="width: 10%;">${qtyText}</td>
                                    <td class="p-2 border border-slate-800 text-right text-xs font-bold" style="width: 10%;">${priceText}</td>
                                    <td class="p-2 border border-slate-800 text-right font-black text-xs bg-slate-50" style="width: 12%;">${amountText}</td>
                                </tr>
                            `;
                        } else {
                            html += `
                                <tr>
                                    <td class="p-4 border border-slate-800 font-bold text-sm whitespace-pre-wrap break-words min-h-[60px]">${item.name}</td>
                                    <td class="p-4 text-center border border-slate-800 text-sm font-bold">${qtyText}</td>
                                    <td class="p-4 text-right border border-slate-800 text-sm font-bold">${priceText}</td>
                                    <td class="p-4 text-right font-black border border-slate-800 text-sm bg-slate-50">${amountText}</td>
                                </tr>
                            `;
                        }
                    });

                    if (hasSN) {
                        html += `
                            <tr class="spacer-row">
                                <td class="p-2 border border-slate-800" style="width: 8%;">&nbsp;</td>
                                <td class="p-2 border border-slate-800" style="width: 60%;">&nbsp;</td>
                                <td class="p-2 border border-slate-800" style="width: 10%;">&nbsp;</td>
                                <td class="p-2 border border-slate-800" style="width: 10%;">&nbsp;</td>
                                <td class="p-2 border border-slate-800 bg-slate-50" style="width: 12%;">&nbsp;</td>
                            </tr>
                        `;
                    } else {
                        html += `
                            <tr class="spacer-row">
                                <td class="p-4 border border-slate-800" style="width: 68%;">&nbsp;</td>
                                <td class="p-4 border border-slate-800" style="width: 10%;">&nbsp;</td>
                                <td class="p-4 border border-slate-800" style="width: 10%;">&nbsp;</td>
                                <td class="p-4 border border-slate-800 bg-slate-50" style="width: 12%;">&nbsp;</td>
                            </tr>
                        `;
                    }

                    let totalQtyText = "";
                    if (hasSN) {
                        html += `
                            <tr class="font-bold border-t border-slate-800 bg-slate-50">
                                <td colspan="2" class="p-2 border border-slate-800 text-right font-bold uppercase" style="width: 68%;">Total:</td>
                                <td class="p-2 border border-slate-800 text-center font-bold" style="width: 10%;">${totalQtyText}</td>
                                <td class="p-2 border border-slate-800 text-right font-bold" style="width: 10%;"></td>
                                <td class="p-2 border border-slate-800 text-right font-bold text-xs bg-slate-100" style="width: 12%;">${formattedTotal}</td>
                            </tr>
                        `;
                    } else {
                        html += `
                            <tr class="font-bold border-t border-slate-800 bg-slate-50">
                                <td class="p-2 border border-slate-800 text-right font-bold uppercase" style="width: 68%;">Total:</td>
                                <td class="p-2 border border-slate-800 text-center font-bold" style="width: 10%;">${totalQtyText}</td>
                                <td class="p-2 border border-slate-800 text-right font-bold" style="width: 10%;"></td>
                                <td class="p-2 border border-slate-800 text-right font-bold text-xs bg-slate-100" style="width: 12%;">${formattedTotal}</td>
                            </tr>
                        `;
                    }
                    tbody.innerHTML = html;
                }

                const wordsEl = document.getElementById(`ch${i}-words`);
                if (wordsEl) wordsEl.innerText = words;
            }

            const vehicleInput = document.getElementById('challan-input-vehicle');
            if (vehicleInput) vehicleInput.value = '';
            
            const transportInput = document.getElementById('challan-input-transport');
            if (transportInput) transportInput.value = 'Road';
            
            const hsnInput = document.getElementById('challan-input-hsn');
            if (hsnInput) hsnInput.value = '39269099';

            updateChallanInputs();

            document.getElementById('wp-share-btn').onclick = function () {
                shareChallanPDF(order, autoNo);
            };

            const targetBtn = document.getElementById(`share-order-btn-${orderId}`);
            shareChallanPDF(order, autoNo, targetBtn);
        }
        window.shareChallanDirectly = shareChallanDirectly;

        function shareChallanPDF(order, autoNo, customBtn = null) {
            const element = document.getElementById('challan-print-area');
            if (!element) return alert("Error: Print area element not found!");

            const shareBtn = customBtn || document.getElementById('wp-share-btn');
            const originalText = shareBtn ? shareBtn.innerHTML : '';
            
            if (shareBtn) {
                shareBtn.disabled = true;
                if (customBtn) {
                    shareBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-xs"></i>`;
                } else {
                    shareBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-lg"></i> Loading PDF...`;
                }
            }

            // Create temporary container for mobile compatibility
            const container = document.createElement('div');
            container.style.position = 'fixed';
            container.style.left = '0';
            container.style.top = '0';
            container.style.width = '148mm';
            container.style.height = '210mm';
            container.style.zIndex = '-9999';
            container.style.overflow = 'hidden';
            container.style.background = '#ffffff';
            document.body.appendChild(container);

            // Clone the original element
            const clone = element.cloneNode(true);
            clone.id = 'challan-print-area-clone';

            // Set fixed dimensions for the clone
            clone.style.display = 'block';
            clone.style.width = '148mm';
            clone.style.height = '210mm';
            clone.style.minHeight = '210mm';
            clone.style.maxHeight = '210mm';
            clone.style.padding = '0';
            clone.style.margin = '0';
            clone.style.boxSizing = 'border-box';
            clone.style.background = '#ffffff';

            const originalCopy = clone.querySelector('#challan-original-copy');
            if (originalCopy) {
                originalCopy.style.display = 'flex';
                originalCopy.style.flexDirection = 'column';
                originalCopy.style.justifyContent = 'space-between';
                originalCopy.style.width = '148mm';
                originalCopy.style.height = '210mm';
                originalCopy.style.minHeight = '210mm';
                originalCopy.style.maxHeight = '210mm';
                originalCopy.style.padding = '8mm 8mm 6mm 8mm';
                originalCopy.style.border = 'none';
                originalCopy.style.borderRadius = '0';
                originalCopy.style.boxSizing = 'border-box';
                originalCopy.style.gap = '3mm';
                originalCopy.style.margin = '0';
                originalCopy.style.background = '#ffffff';

                // Premium layout details
                const copyLabel = originalCopy.querySelector('.absolute');
                if (copyLabel) {
                    copyLabel.style.top = '6mm';
                    copyLabel.style.right = '8mm';
                    copyLabel.style.border = '1px solid #cbd5e1';
                    copyLabel.style.color = '#475569';
                    copyLabel.style.backgroundColor = '#f8fafc';
                    copyLabel.style.fontSize = '8px';
                    copyLabel.style.fontWeight = '700';
                    copyLabel.style.padding = '2px 6px';
                    copyLabel.style.borderRadius = '3px';
                }

                const header = originalCopy.querySelector('.flex.justify-between.items-start');
                if (header) {
                    header.style.borderBottom = '1.5px solid #0f172a';
                    header.style.paddingBottom = '3mm';
                }

                const logoContainer = originalCopy.querySelector('.w-12.h-12');
                if (logoContainer) {
                    logoContainer.style.width = '12mm';
                    logoContainer.style.height = '12mm';
                    logoContainer.style.borderRadius = '6px';
                    logoContainer.style.border = '1px solid #cbd5e1';
                    logoContainer.style.padding = '1px';
                }

                const companyTitle = originalCopy.querySelector('h2');
                if (companyTitle) {
                    companyTitle.style.fontSize = '18px';
                    companyTitle.style.fontWeight = '900';
                    companyTitle.style.color = '#0f172a';
                    companyTitle.style.letterSpacing = '0.5px';
                }

                const tagline = originalCopy.querySelector('p.text-\\[9px\\]');
                if (tagline) {
                    tagline.style.fontSize = '9px';
                    tagline.style.color = '#64748b';
                    tagline.style.fontWeight = '600';
                    tagline.style.marginTop = '2px';
                }

                const gstPhone = originalCopy.querySelector('p.text-slate-600') || originalCopy.querySelector('p.font-bold.text-slate-600');
                if (gstPhone) {
                    gstPhone.style.fontSize = '9px';
                    gstPhone.style.color = '#334155';
                    gstPhone.style.fontWeight = '700';
                    gstPhone.style.marginTop = '2px';
                }

                const address = originalCopy.querySelector('p.text-slate-500.max-w-xl');
                if (address) {
                    address.style.fontSize = '8px';
                    address.style.color = '#64748b';
                    address.style.fontWeight = '500';
                    address.style.marginTop = '1px';
                    address.style.lineHeight = '1.3';
                }

                const titleBadge = originalCopy.querySelector('.text-right span') || originalCopy.querySelector('.text-right.pt-2 span') || originalCopy.querySelector('.text-right span.text-xs');
                if (titleBadge) {
                    titleBadge.style.fontSize = '10px';
                    titleBadge.style.fontWeight = '900';
                    titleBadge.style.color = '#ffffff';
                    titleBadge.style.backgroundColor = '#0f172a';
                    titleBadge.style.padding = '4px 10px';
                    titleBadge.style.border = 'none';
                    titleBadge.style.borderRadius = '4px';
                    titleBadge.style.letterSpacing = '1px';
                    titleBadge.style.display = 'inline-block';
                }

                const gridSection = originalCopy.querySelector('.grid.grid-cols-2');
                if (gridSection) {
                    gridSection.style.borderBottom = '1px solid #e2e8f0';
                    gridSection.style.paddingTop = '3mm';
                    gridSection.style.paddingBottom = '3mm';
                    gridSection.style.gap = '4mm';
                }

                const consigneeTitle = originalCopy.querySelector('.grid.grid-cols-2 p.text-\\[9px\\]');
                if (consigneeTitle) {
                    consigneeTitle.style.fontSize = '8px';
                    consigneeTitle.style.color = '#64748b';
                    consigneeTitle.style.textTransform = 'uppercase';
                    consigneeTitle.style.fontWeight = 'bold';
                    consigneeTitle.style.letterSpacing = '0.5px';
                }

                const consigneeName = originalCopy.querySelector('#ch1-party');
                if (consigneeName) {
                    consigneeName.style.fontSize = '12px';
                    consigneeName.style.fontWeight = '800';
                    consigneeName.style.color = '#0f172a';
                    consigneeName.style.marginTop = '3px';
                }

                const infoLabels = originalCopy.querySelectorAll('.grid.grid-cols-2 span.text-\\[9px\\]');
                infoLabels.forEach(label => {
                    label.style.fontSize = '8px';
                    label.style.color = '#64748b';
                    label.style.fontWeight = '600';
                });

                const infoValues = originalCopy.querySelectorAll('.grid.grid-cols-2 span.text-xs');
                infoValues.forEach(val => {
                    val.style.fontSize = '10px';
                    val.style.fontWeight = '700';
                    val.style.color = '#0f172a';
                });

                const challanNumVal = originalCopy.querySelector('#ch1-num');
                if (challanNumVal) {
                    challanNumVal.style.color = '#dc2626';
                    challanNumVal.style.fontWeight = '900';
                }

                const table = originalCopy.querySelector('table');
                if (table) {
                    table.style.border = '1px solid #cbd5e1';
                    table.style.borderCollapse = 'collapse';
                    table.style.marginTop = '3mm';
                    table.style.width = '100%';
                    table.style.height = '100%';
                    table.style.flexGrow = '1';
                }

                const ths = originalCopy.querySelectorAll('table th');
                ths.forEach(th => {
                    th.style.backgroundColor = '#f8fafc';
                    th.style.color = '#1e293b';
                    th.style.fontWeight = '800';
                    th.style.fontSize = '9px';
                    th.style.padding = '6px 8px';
                    th.style.border = '1px solid #cbd5e1';
                });

                const tds = originalCopy.querySelectorAll('table td');
                tds.forEach(td => {
                    td.style.border = '1px solid #cbd5e1';
                    td.style.padding = '6px 8px';
                    td.style.fontSize = '9px';
                    td.style.color = '#334155';
                    td.style.lineHeight = '1.3';
                    td.style.verticalAlign = 'bottom';
                });

                const qtyCell = originalCopy.querySelector('#ch1-qty');
                if (qtyCell) {
                    qtyCell.style.fontWeight = '700';
                    qtyCell.style.textAlign = 'center';
                }

                const priceCell = originalCopy.querySelector('#ch1-price');
                if (priceCell) {
                    priceCell.style.fontWeight = '700';
                    priceCell.style.textAlign = 'right';
                }

                const totalCell = originalCopy.querySelector('#ch1-total');
                if (totalCell) {
                    totalCell.style.fontWeight = '700';
                    totalCell.style.color = '#0f172a';
                    totalCell.style.backgroundColor = '#f8fafc';
                    totalCell.style.textAlign = 'right';
                }

                const tableRows = originalCopy.querySelectorAll('table tr');
                tableRows.forEach(row => {
                    if (!row.classList.contains('spacer-row') && row.parentNode.tagName.toLowerCase() !== 'thead') {
                        row.style.height = '1px';
                    }
                    if (row.classList.contains('font-black') || row.style.fontWeight === '900' || row.classList.contains('font-bold') || row.style.fontWeight === '700') {
                        const rowCells = row.querySelectorAll('td');
                        rowCells.forEach(cell => {
                            cell.style.border = '1px solid #cbd5e1';
                            cell.style.backgroundColor = '#f8fafc';
                            cell.style.fontWeight = '700';
                            cell.style.color = '#0f172a';
                            cell.style.fontSize = '9px';
                            cell.style.padding = '6px 8px';
                        });
                    }
                });

                const spacerRows = originalCopy.querySelectorAll('.spacer-row');
                spacerRows.forEach(row => {
                    const cells = row.querySelectorAll('td');
                    cells.forEach(cell => {
                        cell.style.border = '1px solid #cbd5e1';
                        cell.style.padding = '4px 8px';
                    });
                });

                const wordsBlock = originalCopy.querySelector('.text-\\[9px\\].border-b.border-slate-200') || (originalCopy.querySelector('#ch1-words') ? originalCopy.querySelector('#ch1-words').parentNode.parentNode : null);
                if (wordsBlock) {
                    wordsBlock.style.borderBottom = '1px solid #cbd5e1';
                    wordsBlock.style.paddingBottom = '3px';
                    wordsBlock.style.fontSize = '8px';
                    wordsBlock.style.color = '#64748b';
                }

                const wordsStrong = originalCopy.querySelector('#ch1-words');
                if (wordsStrong) {
                    wordsStrong.style.color = '#1e293b';
                    wordsStrong.style.fontWeight = '700';
                }

                const footerBlock = originalCopy.querySelector('.flex.justify-between.items-end') || originalCopy.querySelector('.flex.justify-between.items-end.text-\\[9px\\]');
                if (footerBlock) {
                    footerBlock.style.paddingTop = '3mm';
                    footerBlock.style.marginTop = 'auto';
                }

                const termsTitle = originalCopy.querySelector('span.text-\\[8px\\]');
                if (termsTitle) {
                    termsTitle.style.fontSize = '7.5px';
                    termsTitle.style.color = '#64748b';
                    termsTitle.style.fontWeight = 'bold';
                    termsTitle.style.textTransform = 'uppercase';
                }

                const termsParagraphs = originalCopy.querySelectorAll('p.text-\\[8px\\]');
                termsParagraphs.forEach(p => {
                    p.style.fontSize = '7px';
                    p.style.color = '#94a3b8';
                    p.style.lineHeight = '1.3';
                });

                const sigContainers = originalCopy.querySelectorAll('.text-center');
                sigContainers.forEach(container => {
                    container.style.fontSize = '8px';
                    container.style.color = '#475569';
                    container.style.fontWeight = '700';
                });

                const receiverSig = originalCopy.querySelector('.w-24.border-t');
                if (receiverSig) {
                    receiverSig.style.width = '24mm';
                    receiverSig.style.borderTop = '1px solid #cbd5e1';
                    receiverSig.style.paddingTop = '1mm';
                }

                const companySig = originalCopy.querySelector('.w-32.border-t');
                if (companySig) {
                    companySig.style.width = '32mm';
                    companySig.style.borderTop = '1px solid #cbd5e1';
                    companySig.style.paddingTop = '1mm';
                }
            }

            const officeCopy = clone.querySelector('#challan-office-copy');
            if (officeCopy) {
                officeCopy.style.display = 'none';
            }

            // Hide the cut-line in the PDF
            const cutLine = clone.querySelector('.cut-line');
            if (cutLine) {
                cutLine.style.display = 'none';
            }

            // Hide no-print elements inside the clone
            const noPrintElements = clone.querySelectorAll('.no-print');
            noPrintElements.forEach(el => {
                el.style.display = 'none';
            });

            // Append clone to temporary container
            container.appendChild(clone);

            const opt = {
                margin:       [0, 0, 0, 0],
                filename:     `Challan-${autoNo}.pdf`,
                image:        { type: 'jpeg', quality: 0.98 },
                html2canvas:  { scale: 3.5, useCORS: true, logging: false },
                jsPDF:        { unit: 'mm', format: 'a5', orientation: 'portrait' }
            };

            html2pdf().set(opt).from(clone).outputPdf('blob').then(function (pdfBlob) {
                // Remove temporary container
                if (container.parentNode) {
                    container.parentNode.removeChild(container);
                }

                const pdfFile = new File([pdfBlob], `Challan-${autoNo}.pdf`, { type: 'application/pdf' });

                if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
                    navigator.share({
                        files: [pdfFile],
                        title: `Challan - ${autoNo}`,
                        text: `Gokul Plastic - Challan for ${order.party}`
                    })
                    .then(() => {
                        if (shareBtn) {
                            shareBtn.disabled = false;
                            shareBtn.innerHTML = originalText;
                        }
                    })
                    .catch((err) => {
                        console.error("Share failed:", err);
                        if (shareBtn) {
                            shareBtn.disabled = false;
                            shareBtn.innerHTML = originalText;
                        }
                    });
                } else {
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(pdfBlob);
                    link.download = `Challan-${autoNo}.pdf`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);

                    let items = [];
                    let lines = order.item.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
                    if (lines.length <= 1) {
                        let parsed = parseSingleLine(lines[0] || order.item);
                        if (parsed) items.push(parsed);
                        else items.push({ name: order.item, qty: order.qty, price: order.price, amount: order.amount });
                    } else {
                        lines.forEach(line => {
                            let parsed = parseSingleLine(line);
                            if (parsed) items.push(parsed);
                            else items.push({ name: line, qty: null, price: null, amount: null });
                        });
                    }
                    let totalQty = 0;
                    let totalAmount = 0;
                    let hasQty = false;
                    let hasAmount = false;
                    items.forEach(item => {
                        if (item.qty !== null) { totalQty += item.qty; hasQty = true; }
                        if (item.amount !== null) { totalAmount += item.amount; hasAmount = true; }
                    });
                    if (!hasAmount) totalAmount = order.amount;
                    if (!hasQty) totalQty = order.qty;

                    let formattedTotal = "₹" + totalAmount.toLocaleString('en-IN');
                    const transportInput = document.getElementById('challan-input-transport');
                    const transportMode = transportInput ? transportInput.value.trim() || 'Road' : 'Road';
                    
                    sendChallanToWhatsApp(order.phone, order.party, autoNo, order.item, totalQty, formattedTotal, transportMode);

                    alert("PDF has been downloaded and WhatsApp Web is opening. You can send the file manually on WhatsApp.");

                    if (shareBtn) {
                        shareBtn.disabled = false;
                        shareBtn.innerHTML = originalText;
                    }
                }
            }).catch(function (error) {
                // Remove temporary container in case of error
                if (container.parentNode) {
                    container.parentNode.removeChild(container);
                }

                console.error("PDF generation failed:", error);
                alert("Something went wrong while generating the PDF!");
                if (shareBtn) {
                    shareBtn.disabled = false;
                    shareBtn.innerHTML = originalText;
                }
            });
        }



        // Share to WhatsApp API
        function sendChallanToWhatsApp(phone, party, challanNum, item, qty, total, transport = 'Self') {
            if (!phone || phone === "") return alert("Mobile number is not added! Go to ledger, click 'Edit' and add the mobile number first.");
            let message = `*Hello ${party},*\n\n` +
                `*GOKUL PLASTIC* - Your goods have been dispatched:\n\n` +
                `🔹 *Challan Number:* ${challanNum}
` +
                `🔹 *Item:* ${item}
` +
                `🔹 *Quantity:* ${qty}
` +
                `🔹 *Total Amount:* ${total}
` +
                `🔹 *Transport:* ${transport}

` +
                `🙏 *Gokul Plastic (Ahmedabad)*`;
            window.open(`https://api.whatsapp.com/send?phone=91${phone}&text=${encodeURIComponent(message)}`, '_blank');
        }

        function closeChallan() {
            document.getElementById('challan-modal').classList.add('hidden');
        }

        // Delete order/payment records
        function deleteItem(target, id) {
            if (confirm("Are you sure you want to delete this entry permanently?")) {
                if (isFirebaseConnected && firestoreDb) {
                    let targetCol = activeBusiness === 'ABS' ? target : activeBusiness + '_' + target;
                    firestoreDb.collection(targetCol).doc(id.toString()).delete()
                        .then(() => alert("Entry has been deleted from Firebase!"))
                        .catch(err => alert("Error deleting: " + err.message));
                } else {
                    db[target] = db[target].filter(item => item.id !== id);
                    saveData();
                    alert("Entry has been deleted from the browser!");
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

        // Show login screen every time page loads
        // (SESSION persistence: logout on browser/tab close)
        function setupAuthPersistence() {
            if (!auth) return;
            auth.setPersistence(firebase.auth.Auth.Persistence.SESSION)
                .then(() => {
                    // Persistence set - now onAuthStateChanged will handle
                })
                .catch(() => { });
        }

        // Make sure to show login screen on page load
        // (Do not allow firebase auto-login)
        function showLoginScreen() {
            document.getElementById('login-screen').style.display = 'flex';
            document.getElementById('login-loading-container').style.display = 'none';
            document.getElementById('login-form-container').classList.remove('hidden');
        }

        function hideLoginScreen() {
            document.getElementById('login-screen').style.display = 'none';
        }

        // Page load: Firebase will handle onAuthStateChanged
        // With SESSION persistence:
        // - Same tab refresh: stays logged in
        // - Tab/Browser close: logout
        // showLoginScreen() not needed - Firebase auto-handle

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
                errorEl.textContent = 'Please fill in Email and Password.';
                errorEl.classList.remove('hidden');
                return;
            }

            if (!auth) {
                errorEl.textContent = 'Firebase is not connected. Check Settings.';
                errorEl.classList.remove('hidden');
                return;
            }

            errorEl.classList.add('hidden');
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Login...</span>';

            // SESSION persistence: tab/window close = logout, refresh = stay logged in
            auth.setPersistence(firebase.auth.Auth.Persistence.SESSION)
                .then(() => {
                    return auth.signInWithEmailAndPassword(email, password);
                })
                .then(() => {
                    hideLoginScreen();
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i><span>Login</span>';
                })
                .catch(error => {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i><span>Login</span>';
                    let msg = 'Login Error: ' + error.message;
                    if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
                        msg = '❌ Incorrect password! Please check again.';
                    } else if (error.code === 'auth/user-not-found') {
                        msg = '❌ Email ID not found.';
                    } else if (error.code === 'auth/network-request-failed') {
                        msg = '❌ Check your internet connection.';
                    }
                    errorEl.textContent = msg;
                    errorEl.classList.remove('hidden');
                });
        }

        // Download Party-wise Ledger as PDF (restored jsPDF-based implementation)
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

    // ── PDF INIT ─────────────────────────────────────────────────────
    let doc;
    try { doc = new jspdf.jsPDF({orientation:'portrait',unit:'mm',format:'a4'}); }
    catch(e) { doc = new window.jspdf.jsPDF('portrait','mm','a4'); }

    const PW = doc.internal.pageSize.getWidth();   
    const PH = doc.internal.pageSize.getHeight();  

    const BO  = 12;                     
    const BW  = PW - BO*2;             
    const BH  = PH - BO*2;             
    const PAD = 5;
    const ML  = BO + PAD;              
    const MT  = BO + PAD;              
    const CW  = BW - PAD*2;            
    const FOOTER_H = 10;
    const BOTTOM   = PH - BO - PAD - FOOTER_H;   

    // Clean structural column layouts
    const COL = {
        date:        {x: 0,   w: 24},
        particulars: {x: 24,  w: 62},
        type:        {x: 86,  w: 18},
        debit:       {x: 104, w: 24},
        credit:      {x: 128, w: 24},
        balance:     {x: 152, w: 24},
    };

    const ROW_PAD = 2.0;  
    let y = MT;

    const cx = key => ML + COL[key].x;           
    const cxR= key => ML + COL[key].x + COL[key].w;  

    function border() {
        doc.setDrawColor(40,40,40); doc.setLineWidth(0.5);
        doc.rect(BO, BO, BW, BH);
    }

    function hline(lx, rx, yy, lw, r, g, b) {
        doc.setDrawColor(r||0,g||0,b||0); doc.setLineWidth(lw||0.2);
        doc.line(lx, yy, rx, yy);
    }

    function txt(text, x, yy, opts) {
        doc.text(String(text), x, yy, opts||{});
    }

    function drawFullHeader() {
        let logoImg = document.querySelector('img[src*="logo"]') || 
                      document.querySelector('img[src*="345"]') || 
                      document.querySelector('img[alt*="logo"]') || 
                      document.querySelector('img[alt*="Logo"]') ||
                      document.querySelector('img');
                      
        let logoLoaded = false;
        if (logoImg && logoImg.complete && logoImg.naturalWidth !== 0) {
            logoLoaded = true;
        }

        if (logoLoaded) {
            try {
                doc.addImage(logoImg, 'PNG', ML, y, 14, 14);
                
                doc.setFont('helvetica','bold'); doc.setFontSize(18); doc.setTextColor(20,20,20);
                txt('GOKUL PLASTIC', ML + 18, y+4);

                doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(80,80,80);
                txt('A-16, Maruti Ind. Estate, SP Ring Rd, Odhav, Ahmedabad - 382415', ML + 18, y+9);
                txt('Phone: 9428344742', ML + 18, y+13);
            } catch (err) {
                logoLoaded = false;
            }
        }
        
        if (!logoLoaded) {
            doc.setFont('helvetica','bold'); doc.setFontSize(18); doc.setTextColor(20,20,20);
            txt('GOKUL PLASTIC', ML, y+4);

            doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(80,80,80);
            txt('A-16, Maruti Ind. Estate, SP Ring Rd, Odhav, Ahmedabad - 382415', ML, y+9);
            txt('Phone: 9428344742', ML, y+13);
        }

        const bW=45, bH=8, bX=ML+CW-bW;
        doc.setFillColor(33,37,41); doc.rect(bX, y, bW, bH, 'F');
        doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(255,255,255);
        txt('PARTY LEDGER', bX+bW/2, y+5.2, {align:'center'});

        doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(110,110,110);
        txt('Generated: '+generatedDate, bX+bW, y+12.5, {align:'right'});

        y += 16;
        hline(ML, ML+CW, y, 0.4, 60, 60, 60);
        y += 4;

        const barH = 14;
        doc.setFillColor(248,249,250); doc.setDrawColor(218,224,233); doc.setLineWidth(0.25);
        doc.rect(ML, y, CW, barH, 'FD');

        const half = ML + CW*0.55;
        doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(120,120,120);
        txt('PARTY NAME',   ML+3,   y+4.5);
        txt('REPORT PERIOD', half,  y+4.5);

        doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(0,0,0);
        txt(activeParty,     ML+3,  y+10.5);

        doc.setFontSize(9.5); doc.setTextColor(40,40,40);
        txt(dateRangeText,   half,  y+10.5);
        y += barH + 4;

        const gap=3, cardH=13;
        const cardW = (CW - gap*3) / 4;
        const cards = [
            {label:'TOTAL SALES',     val:'Rs. '+totalSales.toLocaleString('en-IN'),    col:[33,37,41]},
            {label:'TOTAL RECEIVED',  val:'Rs. '+totalReceived.toLocaleString('en-IN'), col:[25,135,84]},
            {label:'NET DUE',         val:'Rs. '+Math.abs(netDue).toLocaleString('en-IN'), col: netDue>=0?[220,53,69]:[25,135,84]},
            {label:'ENTRY COUNT',     val:String(entryCount), col:[33,37,41]},
        ];
        cards.forEach((c,i) => {
            const cx2 = ML + i*(cardW+gap);
            doc.setFillColor(255,255,255); doc.setDrawColor(222,226,230); doc.setLineWidth(0.25);
            doc.rect(cx2, y, cardW, cardH, 'FD');

            doc.setFont('helvetica','bold'); doc.setFontSize(6.5); doc.setTextColor(120,120,120);
            txt(c.label, cx2+3, y+4.2);

            let fs=9;
            doc.setFontSize(fs); doc.setTextColor(c.col[0],c.col[1],c.col[2]);
            while(doc.getTextWidth(c.val) > cardW-6 && fs>6.5){ fs-=0.4; doc.setFontSize(fs); }
            txt(c.val, cx2+3, y+10.2);
        });
        y += cardH + 6;
    }

    function drawContinuedHeader() {
        let logoImg = document.querySelector('img[src*="logo"]') || 
                      document.querySelector('img[src*="345"]') || 
                      document.querySelector('img[alt*="logo"]') || 
                      document.querySelector('img[alt*="Logo"]') ||
                      document.querySelector('img');
                      
        let logoLoaded = false;
        if (logoImg && logoImg.complete && logoImg.naturalWidth !== 0) {
            logoLoaded = true;
        }

        if (logoLoaded) {
            try {
                doc.addImage(logoImg, 'PNG', ML, y, 9, 9);
                doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(33,37,41);
                txt('GOKUL PLASTIC', ML + 11, y+3);
                doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(100,100,100);
                txt(activeParty+' — Party Ledger (Continued)', ML + 11, y+7.5);
            } catch (err) {
                logoLoaded = false;
            }
        }
        
        if (!logoLoaded) {
            doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(33,37,41);
            txt('GOKUL PLASTIC', ML, y+4);
            doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(100,100,100);
            txt(activeParty+' — Party Ledger (Continued)', ML, y+8.5);
        }
        doc.setFontSize(7);
        txt('Generated: '+generatedDate, ML+CW, y+4, {align:'right'});
        y += 12;
        hline(ML, ML+CW, y, 0.4, 60, 60, 60);
        y += 4;
    }

    function drawTableHeader() {
        doc.setFillColor(33,37,41);
        doc.rect(ML, y, CW, 7.5, 'F');
        doc.setTextColor(255,255,255);
        doc.setFont('helvetica','bold'); doc.setFontSize(7.5);

        txt('DATE',          cx('date')+2,        y+5);
        txt('PARTICULARS',   cx('particulars')+2, y+5);
        txt('TYPE',          cx('type')+COL.type.w/2, y+5, {align:'center'});
        txt('DEBIT (Rs.)',   cxR('debit')-2,      y+5, {align:'right'});
        txt('CREDIT (Rs.)',  cxR('credit')-2,     y+5, {align:'right'});
        txt('BALANCE',       cxR('balance')-2,    y+5, {align:'right'});
        y += 7.5;
    }

    function drawAllFooters() {
        const total = doc.internal.getNumberOfPages();
        for(let i=1;i<=total;i++) {
            doc.setPage(i);
            const fy = PH - BO - 4;
            hline(ML, ML+CW, fy-3, 0.2, 220, 220, 220);
            doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(140,140,140);
            txt('Gokul Plastic — Private & Confidential',  ML,    fy);
            txt('Page '+i+' of '+total,           ML+CW, fy, {align:'right'});
        }
    }

    function newPage(full) {
        doc.addPage();
        y = MT;
        border();
        if(full) drawFullHeader(); else drawContinuedHeader();
        drawTableHeader();
    }

    // ── START INITIAL PAGE ───────────────────────────────────────────
    border();
    drawFullHeader();

    doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(33,37,41);
    txt('TRANSACTION HISTORY', ML, y);
    y += 4.5;
    drawTableHeader();

    if(ledgerRows.length === 0) {
        doc.setFont('helvetica','italic'); doc.setFontSize(8.5); doc.setTextColor(150,150,150);
        txt('No transactions recorded within this timeframe.', ML+CW/2, y+10, {align:'center'});
        y += 18;
    }

    ledgerRows.forEach((r, idx) => {
        let particular = r.item
            ? r.item + ' (' + r.qty + ' x Rs. ' + Number(r.price||0).toLocaleString('en-IN') + ')'
            : 'Payment' + (r.mode ? ' via ' + r.mode : '');

        doc.setFont('helvetica','normal'); doc.setFontSize(7.5);
        const wrapW = COL.particulars.w - 4;
        let lines   = doc.splitTextToSize(particular, wrapW);
        
        // Dynamic exact row height computation
        const textHeight = lines.length * 4.2;
        const rowH = textHeight + (ROW_PAD * 2);

        if(y + rowH > BOTTOM) {
            newPage(false);
        }

        // Alternating clear zebra row stripes
        if(idx % 2 === 1) {
            doc.setFillColor(248,249,250);
            doc.rect(ML, y, CW, rowH, 'F');
        }

        hline(ML, ML+CW, y+rowH, 0.15, 230, 230, 230);

        // Center baseline alignment for varying multiline outputs
        const ty = y + ROW_PAD + 3.2; 

        // 1. Date Output
        doc.setFont('helvetica','normal'); doc.setTextColor(40,40,40);
        txt(formatShortBusinessDate(r.date), cx('date')+2, ty);

        // 2. Wrap Particulars
        doc.setTextColor(33,37,41);
        lines.forEach((ln, li) => txt(ln, cx('particulars')+2, ty + (li * 4.2)));

        // 3. Type Box Badge Style colors
        doc.setFont('helvetica','bold'); doc.setFontSize(7);
        const isDebitType = (r.type==='Sales' || r.type==='Paid');
        doc.setTextColor(isDebitType ? 220:25, isDebitType ? 53:135, isDebitType ? 69:84);
        txt(r.type.toUpperCase(), cx('type')+COL.type.w/2, ty, {align:'center'});

        // 4. Debit Values
        doc.setFont('helvetica','normal'); doc.setFontSize(7.5);
        if(r.debit > 0) {
            doc.setTextColor(33,37,41);
            txt(r.debit.toLocaleString('en-IN'), cxR('debit')-2, ty, {align:'right'});
        } else {
            doc.setTextColor(200,200,200); txt('-', cxR('debit')-2, ty, {align:'right'});
        }

        // 5. Credit Values
        if(r.credit > 0) {
            doc.setTextColor(33,37,41);
            txt(r.credit.toLocaleString('en-IN'), cxR('credit')-2, ty, {align:'right'});
        } else {
            doc.setTextColor(200,200,200); txt('-', cxR('credit')-2, ty, {align:'right'});
        }

        // 6. Balanced Cumulative Running Metrics
        doc.setFont('helvetica','bold'); doc.setFontSize(7.5);
        const bAbs  = Math.abs(r.balance);
        doc.setTextColor(r.balance>=0 ? 220:25, r.balance>=0 ? 53:135, r.balance>=0 ? 69:84);
        txt(bAbs.toLocaleString('en-IN'), cxR('balance')-2, ty, {align:'right'});

        y += rowH;
    });

    // ── SECURE LEDGER END SUMMARY BLOCK ──────────────────────────────
    const SUMMARY_H = 40; 
    if(y + SUMMARY_H > BOTTOM) { 
        newPage(false); 
        y += 4; 
    } else { 
        y += 6; 
    }

    const sRight   = ML + CW - 2;
    const sLabelX  = ML + CW - 66;

    doc.setDrawColor(0,0,0);
    hline(sLabelX - 2, sRight, y, 0.9, 0, 0, 0);
    y += 5;

    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(75,75,75);
    txt('Total Debit :', sLabelX,  y, {align:'right'});
    doc.setFont('helvetica','bold'); doc.setTextColor(0,0,0);
    txt('Rs. '+pdfTotalDebit.toLocaleString('en-IN'), sRight, y, {align:'right'});
    y += 6;

    doc.setFont('helvetica','normal'); doc.setTextColor(75,75,75);
    txt('Total Credit :', sLabelX, y, {align:'right'});
    doc.setFont('helvetica','bold'); doc.setTextColor(0,0,0);
    txt('Rs. '+pdfTotalCredit.toLocaleString('en-IN'), sRight, y, {align:'right'});
    y += 9;

    const boxW = 86;
    const boxH = 18;
    const boxX = ML + CW - boxW;

    doc.setDrawColor(0,0,0);
    doc.setLineWidth(0.3);
    doc.rect(boxX, y, boxW, boxH, 'S');
    doc.setFillColor(pdfClosing>=0 ? 255:244, pdfClosing>=0 ? 243:245, pdfClosing>=0 ? 243:244);
    doc.rect(boxX, y, boxW, boxH, 'F');

    doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(100,100,100);
    txt('CLOSING BALANCE', boxX+4, y+5);

    doc.setFontSize(11);
    doc.setTextColor(pdfClosing>=0 ? 220:25, pdfClosing>=0 ? 53:135, pdfClosing>=0 ? 69:84);
    txt('Rs. '+pdfClosingAbs.toLocaleString('en-IN'), boxX+4, y+12.5);

    // ── RENDER FOOTERS ACROSS ALL DISCOVERED PAGES ───────────────────
    drawAllFooters();

    doc.save(activeParty+'_Ledger_'+new Date().toISOString().split('T')[0]+'.pdf');
}

        let currentShareUrl = "";
        let currentShareParty = "";

        function generateSignature(biz, party) {
            const salt = "GokulPlasticLedgerSecureSalt2026!";
            const raw = biz + ":" + party + ":" + salt;
            let hash = 0;
            for (let i = 0; i < raw.length; i++) {
                const char = raw.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32bit integer
            }
            return Math.abs(hash).toString(36);
        }

        function sharePartyLedgerLink() {
            if (!activeParty) {
                alert("Please select a party first.");
                return;
            }
            if (!activeBusiness) {
                alert("Please select a business first.");
                return;
            }

            // Generate secure signature
            const sig = generateSignature(activeBusiness, activeParty);

            // Construct URL
            let baseHref = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
            const partyParam = encodeURIComponent(activeParty).replace(/%20/g, '+');
            let shareUrl = `${baseHref}share.html?biz=${encodeURIComponent(activeBusiness)}&party=${partyParam}&sig=${sig}`;

            // Save for modal actions
            currentShareUrl = shareUrl;
            currentShareParty = activeParty;

            // Set modal text
            document.getElementById('share-modal-party-name').innerText = activeParty;
            document.getElementById('share-modal-url-preview').innerText = shareUrl;

            // Check if native share is supported
            const nativeBtn = document.getElementById('share-native-btn');
            if (navigator.share) {
                nativeBtn.classList.remove('hidden');
            } else {
                nativeBtn.classList.add('hidden');
            }

            // Show share modal
            document.getElementById('share-ledger-modal').classList.remove('hidden');
        }

        // Robust Clipboard Copying Function
        function copyToClipboard(text) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                return navigator.clipboard.writeText(text);
            }
            
            // Fallback for file:// or HTTP non-secure contexts
            return new Promise((resolve, reject) => {
                try {
                    const textArea = document.createElement("textarea");
                    textArea.value = text;
                    textArea.style.position = "fixed";
                    textArea.style.top = "0";
                    textArea.style.left = "0";
                    textArea.style.opacity = "0";
                    document.body.appendChild(textArea);
                    textArea.focus();
                    textArea.select();
                    const successful = document.execCommand('copy');
                    document.body.removeChild(textArea);
                    if (successful) {
                        resolve();
                    } else {
                        reject(new Error("Fallback copy failed"));
                    }
                } catch (err) {
                    reject(err);
                }
            });
        }

        function shareViaWhatsApp() {
            const lastOrderWithPhone = db.orders.find(o => o.party === currentShareParty && o.phone);
            const phone = lastOrderWithPhone ? lastOrderWithPhone.phone : "";
            const message = `Hello, please find your ledger statement here:\n${currentShareUrl}`;
            
            let waUrl = "";
            if (phone && /^\d{10}$/.test(phone)) {
                waUrl = `https://api.whatsapp.com/send?phone=91${phone}&text=${encodeURIComponent(message)}`;
            } else {
                waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
            }
            window.open(waUrl, '_blank');
            closeShareLedgerModal();
        }

        function shareViaEmail() {
            const subject = `Ledger Statement - ${currentShareParty}`;
            const body = `Hello,\n\nPlease find your ledger statement at the following link:\n\n${currentShareUrl}\n\nThank you,\nGokul Plastic`;
            const mailtoUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            window.open(mailtoUrl, '_blank');
            closeShareLedgerModal();
        }

        function shareViaCopyLink() {
            copyToClipboard(currentShareUrl)
                .then(() => {
                    showShareSuccessToast(currentShareUrl);
                })
                .catch(err => {
                    console.error("Clipboard copy failed: ", err);
                    promptCopyFallback(currentShareUrl);
                });
            closeShareLedgerModal();
        }

        function shareViaNative() {
            if (navigator.share) {
                navigator.share({
                    title: `Ledger Statement - ${currentShareParty}`,
                    text: `Please check the ledger statement for ${currentShareParty}`,
                    url: currentShareUrl
                }).catch(err => console.log('Error sharing:', err));
            }
            closeShareLedgerModal();
        }

        function closeShareLedgerModal() {
            document.getElementById('share-ledger-modal').classList.add('hidden');
        }

        window.shareViaWhatsApp = shareViaWhatsApp;
        window.shareViaEmail = shareViaEmail;
        window.shareViaCopyLink = shareViaCopyLink;
        window.shareViaNative = shareViaNative;
        window.closeShareLedgerModal = closeShareLedgerModal;


        function showShareSuccessToast(url) {
            const toast = document.createElement('div');
            toast.className = "fixed bottom-5 right-5 z-[99999] bg-emerald-600 text-white px-6 py-4 rounded-2xl shadow-2xl flex flex-col gap-1 border border-emerald-500 max-w-sm";
            toast.innerHTML = `
                <div class="flex items-center gap-2 font-black text-sm">
                    <i class="fa-solid fa-circle-check text-lg"></i>
                    <span>Link Copied Successfully!</span>
                </div>
                <p class="text-[10px] text-emerald-100 font-medium break-all mt-1">${url}</p>
                <p class="text-[9px] text-emerald-200 mt-0.5">Share this link with the customer to view their ledger.</p>
            `;
            document.body.appendChild(toast);
            
            // Add entry animation classes via js
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            toast.style.transition = 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
            
            // Trigger animation
            setTimeout(() => {
                toast.style.opacity = '1';
                toast.style.transform = 'translateY(0)';
            }, 50);

            // Auto remove
            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateY(20px)';
                setTimeout(() => toast.remove(), 300);
            }, 4000);
        }

        function promptCopyFallback(url) {
            prompt("Copy this URL to share the ledger:", url);
        }

        window.sharePartyLedgerLink = sharePartyLedgerLink;


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
    
