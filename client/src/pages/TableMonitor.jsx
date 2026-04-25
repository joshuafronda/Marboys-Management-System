import { useState, useEffect, useCallback, useRef } from 'react';
import Layout from '../components/Layout';
import TableCard from '../components/TableCard';
import Receipt from '../components/Receipt';
import { collection, doc, updateDoc, writeBatch, increment, onSnapshot, addDoc, getDocs, query, where, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { tableAction } from '../services/tableService';
import { useAuth } from '../context/AuthContext';

const FOOD_CATEGORIES = [
  'Appetizers',
  'Marboys Silogs',
  'Marboys Rice Bowl',
  'Marboys Sizzlers (Served w/rice)',
  'Pasta',
  'Soup',
  'Sandwiches',
  'From the Grill',
];

const DRINK_CATEGORIES = [
  'Beverages',
  'Coffee & Tea',
  'Beers',
  'Beer Buckets (6 Bottles + Pulutan)',
  'Liquors',
  'Wines & Spirits',
  'Marboys Batangas Cocktails',
];

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatStartTime(startTime) {
  if (!startTime) return '';
  const d = new Date(startTime);
  return d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
}

export default function TableMonitor() {
  const { user } = useAuth();
  const [tables, setTables] = useState([]);
  const tablesRef = useRef(tables);
  tablesRef.current = tables;
  const [loading, setLoading] = useState(true);
  const [foods, setFoods] = useState([]);
  const [selectedTable, setSelectedTable] = useState(null);
  const [startHours, setStartHours] = useState('');
  const [busy, setBusy] = useState(false);
  const [tableCarts, setTableCarts] = useState({}); // { tableId: [items] }
  const [received, setReceived] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [paying, setPaying] = useState(false);
  const [showFoodModal, setShowFoodModal] = useState(false);
  const [payModal, setPayModal] = useState(null); // stopData for checkout
  const [extendHours, setExtendHours] = useState('');
  const [exhibitionBet, setExhibitionBet] = useState('');
  const [exhibitionCustomFee, setExhibitionCustomFee] = useState('');
  const [useCustomFee, setUseCustomFee] = useState(false);
  const [editingRunningFee, setEditingRunningFee] = useState(false);
  const [runningCustomFee, setRunningCustomFee] = useState('');
  const [alarms, setAlarms] = useState([]); // { tableId, tableNumber, cost, start_time, end_time }
  const [now, setNow] = useState(Date.now());
  const [localElapsed, setLocalElapsed] = useState(0);
  const [flavorModal, setFlavorModal] = useState(null); // food object for flavor selector
  const [errorModal, setErrorModal] = useState(''); // error message for styled modal
  const [shortfallModal, setShortfallModal] = useState(null); // { total, received, shortfall }
  const [foodSearch, setFoodSearch] = useState(''); // search term for food menu
  const [foodCategoryFilter, setFoodCategoryFilter] = useState('All'); // category filter for food menu
  const [extensionHistory, setExtensionHistory] = useState([]); // extension history for selected table
  const [resetPasswordModal, setResetPasswordModal] = useState(null); // { tableId, tableNumber } for owner password
  const [frozenElapsed, setFrozenElapsed] = useState(null); // Frozen elapsed time when pay modal opens
  const [foodMenuAuthModal, setFoodMenuAuthModal] = useState(false); // Owner password for food menu
  const [voidItemModal, setVoidItemModal] = useState(null); // { foodId, flavorName, foodName, quantity } for void auth
  const [paymentMode, setPaymentMode] = useState('Cash'); // Cash | GCash | Maya | BDO | BPI | UnionBank | Bank Transfer
  const [cctvModal, setCctvModal] = useState(null); // table object for cctv testing
  const [toast, setToast] = useState(''); // success message toast

  // Save cart to server (debounced)
  const saveCartToServer = async (tableId, items) => {
    try {
      await updateDoc(doc(db, 'tables', tableId.toString()), { cart_items: items });
    } catch (err) {
      console.error('Failed to save cart:', err);
    }
  };

  const currentTableId = selectedTable?.id || payModal?.table_id;
  const cart = currentTableId ? (tableCarts[currentTableId] || []) : [];
  const setCart = (itemsOrFn) => {
    const currentTId = selectedTable?.id || payModal?.table_id;
    if (!currentTId) return;
    setTableCarts(prev => {
      const current = prev[currentTId] || [];
      const next = typeof itemsOrFn === 'function' ? itemsOrFn(current) : itemsOrFn;
      saveCartToServer(currentTId, next);
      return { ...prev, [currentTId]: next };
    });
  };

  // Seed tables if none exist
  const seedTables = async () => {
    const snap = await getDocs(collection(db, 'tables'));
    if (snap.empty) {
      const batch = writeBatch(db);
      for (let i = 1; i <= 16; i++) {
        const ref = doc(db, 'tables', i.toString());
        batch.set(ref, {
          table_number: i,
          status: 'available',
          start_time: null,
          pause_time: null,
          accumulated_seconds: 0,
          cart_items: [],
          set_hours: 0,
          cost: 0,
          hourly_rate: 200,
          cctv_ip: '',
          cctv_port: '554',
          cctv_rtsp: ''
        });
      }
      await batch.commit();
    }
  };

  useEffect(() => {
    seedTables().catch(console.error);

    const unsubTables = onSnapshot(collection(db, 'tables'), (snap) => {
      const tb = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const sorted = tb.sort((a, b) => a.table_number - b.table_number);
      setTables(prev => {
        // Don't downgrade a table that was optimistically started (running→available race)
        return sorted.map(newT => {
          const prevT = prev.find(p => p.id === newT.id);
          if (prevT && prevT.status === 'running' && newT.status === 'available' && prevT.start_time) {
            return prevT; // Keep optimistic running state until Firestore catches up
          }
          return newT;
        });
      });
      setTableCarts(prev => {
        const next = { ...prev };
        for (const t of sorted) {
          if (t.cart_items && t.cart_items.length > 0) {
            next[t.id] = t.cart_items;
          } else {
            delete next[t.id];
          }
        }
        return next;
      });
      setLoading(false);
    });

    const unsubFoods = onSnapshot(collection(db, 'foods'), (snap) => {
      const fd = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setFoods(fd.filter(f => f.status === 'available'));
    });

    const tickInterval = setInterval(() => setNow(Date.now()), 1000);
    return () => { unsubTables(); unsubFoods(); clearInterval(tickInterval); };
  }, []);

  // Local ticking timer for selected running table
  useEffect(() => {
    if (!selectedTable || selectedTable.status !== 'running' || !selectedTable.start_time) {
      setLocalElapsed(selectedTable?.elapsed_seconds || 0);
      return;
    }
    const base = selectedTable.accumulated_seconds || 0;
    const startMs = new Date(selectedTable.start_time).getTime();
    const maxSec = selectedTable.set_hours > 0 ? Math.round(selectedTable.set_hours * 3600) : Infinity;
    const tick = () => {
      const raw = base + Math.floor((Date.now() - startMs) / 1000);
      setLocalElapsed(Math.min(raw, maxSec));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [selectedTable?.id, selectedTable?.status, selectedTable?.start_time, selectedTable?.accumulated_seconds, selectedTable?.set_hours, now]);

  // Table actions
  const doAction = async (action, extraBody, tableId = null) => {
    const targetTableId = tableId || selectedTable?.id;
    const ttable = tables.find(t => t.id === targetTableId?.toString());
    if (!ttable) {
      setErrorModal('No table selected');
      return;
    }
    setBusy(true);
    try {
      const res = await tableAction(ttable, action, extraBody, user.name);
      if (action === 'stop') {
        const payMod = { ...ttable, ...res };
        setPayModal(prev => prev ? { ...prev, ...payMod } : payMod);
      } else {
        if (action === 'start') {
          // Don't overwrite optimistic selectedTable — handleStart already set it to running
          // Just update tables array with server response
          setTables(prev => prev.map(t => t.id === targetTableId?.toString() ? { ...t, ...res } : t));
        } else if (selectedTable && selectedTable.id === targetTableId) {
          setSelectedTable({ ...ttable, ...res });
        }
        if (action === 'extend') {
          const extQ = query(collection(db, 'extension_history'), where('table_id', '==', targetTableId.toString()));
          const extSnap = await getDocs(extQ);
          const exts = extSnap.docs.map(d => d.data()).sort((a, b) => a.extended_at.localeCompare(b.extended_at));
          setExtensionHistory(exts);
        }
      }
    } catch (err) {
      setErrorModal(err.message || `Failed to ${action}`);
    } finally {
      setBusy(false);
    }
  };

  const handleStart = () => {
    const hours = parseFloat(startHours) || 0;
    const targetId = selectedTable?.id;

    // Optimistically update the selectedTable so modal transitions to running view
    const now = new Date().toISOString();
    if (targetId) {
      const updatedTable = {
        ...selectedTable,
        status: 'running',
        set_hours: hours,
        start_time: now,
        accumulated_seconds: 0,
        elapsed_seconds: 0,
      };
      setSelectedTable(updatedTable);
      setTables(prev => prev.map(t =>
        t.id === targetId ? updatedTable : t
      ));
    }

    setStartHours('');
    setExtensionHistory([]);

    // Show toast
    setToast(`Table started · ${hours > 0 ? (hours < 1 ? `${Math.round(hours * 60)}min` : `${hours}h`) : 'Unlimited'}`);
    setTimeout(() => setToast(''), 1500);

    // Call API in background
    doAction('start', { hours }, targetId);
  };

  const handleExtend = () => {
    const hours = parseFloat(extendHours);
    if (!hours || hours <= 0) return;
    doAction('extend', { hours });
    setExtendHours('');
  };

  const handleExhibitionMatch = async () => {
    const betAmount = parseFloat(exhibitionBet);
    if (!betAmount || betAmount <= 0) {
      setErrorModal('Please enter a valid bet amount');
      return;
    }

    // Use custom fee if provided and enabled, otherwise use 10% of bet
    let tableFee;
    if (useCustomFee && exhibitionCustomFee && parseFloat(exhibitionCustomFee) > 0) {
      tableFee = parseFloat(exhibitionCustomFee);
    } else {
      tableFee = betAmount * 0.10;
    }
    setBusy(true);

    try {
      await updateDoc(doc(db, 'tables', selectedTable.id.toString()), {
        status: 'exhibition',
        exhibition_bet: betAmount,
        exhibition_custom_fee: (useCustomFee && exhibitionCustomFee && parseFloat(exhibitionCustomFee) > 0) ? parseFloat(exhibitionCustomFee) : null,
        start_time: null,
        accumulated_seconds: 0
      });

      setSelectedTable(prev => ({ ...prev, status: 'exhibition' }));

      // Set up payment modal for exhibition match
      setPayModal({
        table_id: selectedTable.id.toString(),
        table_number: selectedTable.table_number,
        elapsed_seconds: 0,
        cost: tableFee,
        start_time: null,
        end_time: new Date().toISOString(),
        isExhibition: true,
        betAmount: betAmount,
        isCustomFee: useCustomFee && exhibitionCustomFee && parseFloat(exhibitionCustomFee) > 0,
      });
    } catch (err) {
      console.error(err);
      setErrorModal('Failed to start exhibition match');
    } finally {
      setBusy(false);
    }
  };

  const handleExhibitionPayment = async () => {
    const receivedAmt = parseFloat(received) || 0;
    const totalAmt = parseFloat(payModal.cost) || 0;
    if (!received || receivedAmt < totalAmt) {
      const shortfall = totalAmt - receivedAmt;
      setShortfallModal({ total: totalAmt, received: receivedAmt, shortfall });
      return;
    }

    setPaying(true);
    const tableFee = payModal.cost;
    const betAmount = payModal.betAmount;

    try {
      const now = new Date().toISOString();
      const batch = writeBatch(db);

      const saleRef = doc(collection(db, 'sales'));
      const salePayload = {
        table_number: payModal.table_number,
        start_time: null,
        end_time: now,
        table_cost: tableFee,
        food_items: cart,
        total: grandTotal,
        set_hours: 0,
        category: 'exhibition',
        details: `Exhibition Match (₱${betAmount.toLocaleString('en-PH')})`,
        payment_mode: paymentMode,
        created_at: now
      };
      batch.set(saleRef, salePayload);

      // Deduct food
      for (const item of cart) {
        if (!item.food_id) continue;
        const foodDocRef = doc(db, 'foods', item.food_id.toString());
        const foodDoc = foods.find(f => f.id === item.food_id.toString());
        if (foodDoc) {
          if (item.flavor_name && foodDoc.flavors) {
            const newFlavors = [...foodDoc.flavors];
            const fIdx = newFlavors.findIndex(fl => fl.flavor_name === item.flavor_name);
            if (fIdx !== -1) {
              newFlavors[fIdx].stock = Math.max(0, (newFlavors[fIdx].stock || 0) - item.quantity);
              const sum = newFlavors.reduce((a, b) => a + (b.stock || 0), 0);
              batch.update(foodDocRef, { flavors: newFlavors, stock: sum });
            }
          } else {
            batch.update(foodDocRef, { stock: increment(-item.quantity) });
          }
        }
      }

      batch.update(doc(db, 'tables', payModal.table_id.toString()), {
        status: 'available',
        start_time: null,
        pause_time: null,
        accumulated_seconds: 0,
        cart_items: [],
        set_hours: 0,
        exhibition_bet: 0,
        exhibition_custom_fee: null
      });

      await batch.commit();

      const billingHistory = [{
        type: 'initial',
        hours: 0,
        cost: tableFee,
        label: 'Exhibition Match'
      }];

      setReceipt({
        id: saleRef.id,
        table_number: payModal.table_number,
        table_cost: tableFee,
        food_items: cart,
        food_total: foodTotal,
        total: grandTotal,
        received: parseFloat(received),
        change: parseFloat(received) - grandTotal,
        cashier: user.name,
        category: 'exhibition',
        details: `Exhibition Match (₱${betAmount.toLocaleString('en-PH')})`,
        billing_history: billingHistory,
        start_time: payModal.start_time,
        end_time: payModal.end_time,
        elapsed_seconds: 0,
        set_hours: 0,
        payment_mode: paymentMode,
        created_at: now
      });

      // Full state reset
      const tableIdToClear = payModal?.table_id;
      setSelectedTable(null);
      setPayModal(null);
      setFrozenElapsed(null);
      setExhibitionBet('');
      setExhibitionCustomFee('');
      setUseCustomFee(false);
      setExtensionHistory([]);
      setReceived('');
      setShowFoodModal(false);
      setFoodSearch('');
      setFoodCategoryFilter('All');
      setExtendHours('');
      setFlavorModal(null);
      setVoidItemModal(null);
      setPaymentMode('Cash');
      setTableCarts(prev => { const next = { ...prev }; if (tableIdToClear) delete next[tableIdToClear]; return next; });
    } catch (err) {
      console.error(err);
      setErrorModal('Payment failed: ' + err.message);
    } finally {
      setPaying(false);
    }
  };

  const handleCardClick = async (table) => {
    // Always get latest table data from ref to avoid stale references
    const latestTable = tablesRef.current.find(t => t.id === table.id) || table;
    setSelectedTable(latestTable);
    setReceived('');
    setPayModal(null);
    setFrozenElapsed(null); // Clear frozen time
    setEditingRunningFee(false);
    setRunningCustomFee('');

    // Fetch extension history natively
    try {
      const extQ = query(collection(db, 'extension_history'), where('table_id', '==', table.id.toString()));
      const extSnap = await getDocs(extQ);
      const exts = extSnap.docs.map(d => d.data()).sort((a, b) => a.extended_at.localeCompare(b.extended_at));
      setExtensionHistory(exts);
    } catch (err) {
      console.error('Failed to fetch extension history:', err);
      setExtensionHistory([]);
    }
  };

  // Compute available stock = db_stock - cart qty across ALL tables (excluding current) - current cart
  const getAvailableStock = (foodId, flavorName) => {
    const food = foods.find(f => f.id === foodId);
    if (!food) return 0;

    // If food has flavors and a specific flavor is requested, check per-flavor stock
    if (food.flavors && food.flavors.length > 0 && flavorName) {
      const flavor = food.flavors.find(f => f.flavor_name === flavorName);
      if (!flavor) return 0;
      const inOtherTableCarts = tables.reduce((sum, t) => {
        if (selectedTable && t.id === selectedTable.id) return sum; // Exclude current table
        const items = t.cart_items || [];
        const found = items.find(i => i.food_id === foodId && i.flavor_name === flavorName);
        return sum + (found ? found.quantity : 0);
      }, 0);
      const inCurrentCart = cart.find(i => i.food_id === foodId && i.flavor_name === flavorName)?.quantity || 0;
      return (flavor.available ?? flavor.stock) - inOtherTableCarts - inCurrentCart;
    }

    const inOtherTableCarts = tables.reduce((sum, t) => {
      if (selectedTable && t.id === selectedTable.id) return sum; // Exclude current table
      const items = t.cart_items || [];
      const found = items.find(i => i.food_id === foodId);
      return sum + (found ? found.quantity : 0);
    }, 0);
    const inCurrentCart = cart.find(i => i.food_id === foodId)?.quantity || 0;
    return food.stock - inOtherTableCarts - inCurrentCart;
  };

  // Cart logic
  const addToCart = (food, flavorName) => {
    setCart(prev => {
      const existing = prev.find(i =>
        flavorName ? (i.food_id === food.id && i.flavor_name === flavorName) : (i.food_id === food.id && !i.flavor_name)
      );
      const inCart = existing ? existing.quantity : 0;
      const avail = getAvailableStock(food.id, flavorName) - inCart;
      if (avail <= 0) {
        setErrorModal(`No more stock available.`);
        return prev;
      }
      if (existing) {
        return prev.map(i =>
          (flavorName ? (i.food_id === food.id && i.flavor_name === flavorName) : (i.food_id === food.id && !i.flavor_name))
            ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      const flavor = flavorName ? food.flavors?.find(f => f.flavor_name === flavorName) : null;
      const itemPrice = flavor ? flavor.price : food.price;
      return [...prev, {
        food_id: food.id,
        food_name: flavorName ? `${food.name} - ${flavorName}` : food.name,
        price: itemPrice,
        quantity: 1,
        flavor_name: flavorName || null,
      }];
    });
  };

  const removeFromCart = (foodId, flavorName, password = null) => {
    // If password provided, verify with Firestore first
    if (password) {
      // Verify owner password through Firestore
      getDocs(query(collection(db, 'users'), where('role', '==', 'owner')))
        .then(snap => {
          const ownerDoc = snap.docs.find(d => d.data().void_password === password);
          if (!ownerDoc) throw new Error('Invalid password');
          // Password verified, proceed with removal
          setCart(prev => prev.filter(i =>
            flavorName ? !(i.food_id === foodId && i.flavor_name === flavorName) : i.food_id !== foodId
          ));
          setVoidItemModal(null);
        })
        .catch((err) => {
          setVoidItemModal(null);
          setErrorModal(err.response?.data?.error || 'Incorrect owner password');
        });
    } else {
      // Direct removal for non-password cases (if needed)
      setCart(prev => prev.filter(i =>
        flavorName ? !(i.food_id === foodId && i.flavor_name === flavorName) : i.food_id !== foodId
      ));
    }
  };

  // Open void modal for cart item removal (owner password always required)
  const openVoidItemModal = (foodId, flavorName, foodName, quantity) => {
    setVoidItemModal({ foodId, flavorName, foodName, quantity });
  };

  // Verify owner password and open food menu
  const verifyFoodMenuAccess = async (password) => {
    try {
      const usersSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'owner')));
      const ownerDoc = usersSnap.docs.find(d => d.data().void_password === password);
      if (!ownerDoc) throw new Error('Invalid password');
      setFoodMenuAuthModal(false);
      setShowFoodModal(true);
    } catch (err) {
      setFoodMenuAuthModal(false);
      setErrorModal('Incorrect owner password');
    }
  };

  // Handle quantity decrease with owner auth for void (removing last item)
  // The modal shows for ALL roles — owner password is always required to remove
  const handleDecreaseQty = (foodId, flavorName) => {
    const currentTableId = selectedTable?.id || payModal?.table_id;
    const cart = currentTableId ? (tableCarts[currentTableId] || []) : [];
    const item = cart.find(i =>
      flavorName ? (i.food_id === foodId && i.flavor_name === flavorName) : i.food_id === foodId
    );

    if (!item) return;

    // If quantity will become 0, always require owner authorization (void modal)
    if (item.quantity === 1) {
      setVoidItemModal({
        foodId,
        flavorName,
        foodName: item.food_name,
        quantity: 1,
        onConfirm: (password) => confirmVoidAndRemove(foodId, flavorName, password)
      });
    } else {
      // Just decrease quantity normally
      adjustQty(foodId, -1, flavorName);
    }
  };

  // Confirm void and remove item after password verification
  const confirmVoidAndRemove = async (foodId, flavorName, password) => {
    try {
      const usersSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'owner')));
      const ownerDoc = usersSnap.docs.find(d => d.data().void_password === password);
      if (!ownerDoc) throw new Error('Invalid password');
      // Password verified, remove the item
      setCart(prev => prev.filter(i =>
        flavorName ? !(i.food_id === foodId && i.flavor_name === flavorName) : i.food_id !== foodId
      ));
      setVoidItemModal(null);
    } catch (err) {
      setVoidItemModal(null);
      setErrorModal('Incorrect owner password');
    }
  };

  const adjustQty = (foodId, delta, flavorName) => {
    setCart(prev => prev.map(i => {
      if (flavorName ? !(i.food_id === foodId && i.flavor_name === flavorName) : i.food_id !== foodId) return i;
      const newQty = i.quantity + delta;
      const avail = getAvailableStock(foodId, flavorName) - i.quantity;
      if (delta > 0 && avail <= 0) { setErrorModal(`No more stock available.`); return i; }
      return newQty <= 0 ? null : { ...i, quantity: newQty };
    }).filter(Boolean));
  };

  // Helper: Calculate table cost
  // PREPAID (setHours > 0): fixed cost = setHours × ₱200, no rounding
  // OPEN   (setHours = 0): elapsed-based, minimum ₱200 (covers even 30-min sessions)
  //   • 0–59 min = ₱200  • 1h01m–1h29m = ₱300  • 1h30m–1h59m = ₱400 ...
  const calculateTableCost = (elapsedSeconds, setHours = 0) => {
    // Prepaid: always fixed, avoids timing drift giving wrong cost
    if (setHours > 0) return Math.round(setHours * 200);

    // Open session: elapsed-based billing
    const totalMinutes = Math.floor((elapsedSeconds || 0) / 60);
    const wholeHours = Math.floor(totalMinutes / 60);
    const extraMinutes = totalMinutes % 60;

    if (wholeHours === 0) return 200; // 0–59 min → minimum ₱200
    if (extraMinutes === 0) return wholeHours * 200; // Exactly N hr → N × ₱200

    // N hours + partial: first partial 30-min = ₱100, reaching 30min = another ₱100
    let totalHours;
    if (wholeHours === 1) {
      totalHours = extraMinutes >= 30 ? 2 : 1.5;
    } else {
      totalHours = wholeHours + (extraMinutes >= 30 ? 1 : 0.5);
    }
    return totalHours * 200;
  };

  const tableCost = parseFloat(payModal?.cost || selectedTable?.cost || 0);
  const foodTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const grandTotal = tableCost + foodTotal;
  const change = parseFloat(received || 0) - grandTotal;

  const handlePayment = async () => {
    const receivedAmt = parseFloat(received) || 0;
    if (!received || receivedAmt < grandTotal) {
      const shortfall = grandTotal - receivedAmt;
      setShortfallModal({ total: grandTotal, received: receivedAmt, shortfall });
      return;
    }
    setPaying(true);
    try {
      // Calculate actual elapsed hours (not prepaid duration)
      const elapsedHours = (payModal.elapsed_seconds || 0) / 3600;

      const now = new Date().toISOString();
      const batch = writeBatch(db);

      // Save sale
      const saleRef = doc(collection(db, 'sales'));
      const tableNum = payModal.table_number || payModal.table_id || selectedTable?.table_number || 'unknown';
      const foodTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      // Get set_hours from multiple possible sources
      const tableFromModal = tables.find(t => t.id === payModal.table_id?.toString());
      const setHoursValue = payModal.set_hours || tableFromModal?.set_hours || selectedTable?.set_hours || elapsedHours || 0;
      const salePayload = {
        table_number: tableNum,
        start_time: payModal.start_time || null,
        end_time: now, // payModal.end_time may be older 
        table_cost: tableCost,
        food_total: foodTotal,
        food_items: cart,
        total: grandTotal,
        received: parseFloat(received) || 0,
        set_hours: setHoursValue,
        category: 'table',
        payment_mode: paymentMode,
        cashier: user.name,
        created_at: now
      };
      batch.set(saleRef, salePayload);

      // Deduct food stocks
      for (const item of cart) {
        if (!item.food_id) continue;
        const foodDocRef = doc(db, 'foods', item.food_id.toString());
        const foodDoc = foods.find(f => f.id === item.food_id.toString());
        if (foodDoc) {
          if (item.flavor_name && foodDoc.flavors) {
            const newFlavors = [...foodDoc.flavors];
            const fIdx = newFlavors.findIndex(fl => fl.flavor_name === item.flavor_name);
            if (fIdx !== -1) {
              newFlavors[fIdx].stock = Math.max(0, (newFlavors[fIdx].stock || 0) - item.quantity);
              const sum = newFlavors.reduce((a, b) => a + (b.stock || 0), 0);
              batch.update(foodDocRef, { flavors: newFlavors, stock: sum });
            }
          } else {
            batch.update(foodDocRef, { stock: increment(-item.quantity) });
          }
        }
      }

      // Reset extensions
      const extQ = query(collection(db, 'extension_history'), where('table_id', '==', payModal.table_id.toString()));
      const extsSnap = await getDocs(extQ);
      extsSnap.forEach(d => {
        batch.delete(d.ref);
      });

      // Reset Table
      batch.update(doc(db, 'tables', payModal.table_id.toString()), {
        status: 'available',
        start_time: null,
        pause_time: null,
        accumulated_seconds: 0,
        cart_items: [],
        set_hours: 0,
        exhibition_bet: 0,
        exhibition_custom_fee: null,
        cost: 0,
        elapsed_seconds: 0
      });

      await batch.commit();

      const change = parseFloat(received) - grandTotal;

      // Build billing history from extension history
      const billingHistory = [];
      const totalExtended = extensionHistory.reduce((sum, ext) => sum + (ext.extended_hours || 0), 0);
      const initialHours = Math.max(0, (payModal.set_hours || 0) - totalExtended);

      // Initial entry
      billingHistory.push({
        type: 'initial',
        hours: initialHours,
        cost: calculateTableCost(Math.round(initialHours * 3600), initialHours),
      });

      // Extension entries
      extensionHistory.forEach(ext => {
        billingHistory.push({
          type: 'extension',
          hours: ext.extended_hours,
          cost: ext.extended_hours * 200,
        });
      });

      // Show receipt
      setReceipt({
        id: saleRef.id,
        table_number: payModal.table_number || payModal.table_id,
        table_cost: tableCost,
        food_items: cart,
        food_total: foodTotal,
        total: grandTotal,
        received: parseFloat(received),
        change,
        billing_history: billingHistory,
        start_time: payModal.start_time,
        end_time: payModal.end_time || now,
        elapsed_seconds: payModal.elapsed_seconds,
        set_hours: payModal.set_hours,
        payment_mode: paymentMode,
        cashier: user.name,
        created_at: now
      });

      // Full state reset — fresh slate for next customer
      const tableIdToClear = payModal?.table_id;
      setSelectedTable(null);
      setPayModal(null);
      setFrozenElapsed(null);
      setExtensionHistory([]);
      setReceived('');
      setShowFoodModal(false);
      setFoodSearch('');
      setFoodCategoryFilter('All');
      setExtendHours('');
      setFlavorModal(null);
      setVoidItemModal(null);
      setPaymentMode('Cash');
      setTableCarts(prev => { const next = { ...prev }; if (tableIdToClear) delete next[tableIdToClear]; return next; });
    } catch (err) {
      console.error(err);
      setErrorModal('Payment failed: ' + err.message);
    } finally {
      setPaying(false);
    }
  };

  // Auto-stop expired prepaid tables
  useEffect(() => {
    const alreadyAlarmed = new Set(alarms.map(a => a.tableId));
    // Calculate live elapsed like TableCard does (don't use stale elapsed_seconds)
    const getLiveElapsed = (t) => {
      if (!t.start_time) return t.elapsed_seconds || 0;
      const base = t.accumulated_seconds || 0;
      const startMs = new Date(t.start_time).getTime();
      return base + Math.floor((Date.now() - startMs) / 1000);
    };
    const expiredTables = tables.filter(t =>
      t.status === 'running' && t.set_hours > 0 &&
      getLiveElapsed(t) >= Math.round(t.set_hours * 3600)
    );
    const newExpired = expiredTables.filter(t => !alreadyAlarmed.has(t.id));

    newExpired.forEach(async (t) => {
      try {
        // Auto-stop the table
        const res = await tableAction(t, 'stop', {}, user.name);
        // Add to alarms for Time's Up modal
        setAlarms(prev => {
          if (prev.some(a => a.tableId === t.id)) return prev;
          return [...prev, {
            tableId: t.id,
            tableNumber: t.table_number,
            cost: t.set_hours * 200,
            start_time: res.start_time,
            end_time: res.end_time,
          }];
        });
      } catch (err) {
        console.error('Auto-stop failed for table', t.table_number, err);
      }
    });
  }, [now, tables]);

  const dismissAlarm = (tableId) => {
    setAlarms(prev => prev.filter(a => a.tableId !== tableId));
  };

  // Auto-dismiss alarms after 3 seconds
  useEffect(() => {
    if (alarms.length === 0) return;

    const timers = alarms.map(alarm => {
      return setTimeout(() => {
        dismissAlarm(alarm.tableId);
      }, 3000); // 3 seconds
    });

    return () => {
      timers.forEach(timer => clearTimeout(timer));
    };
  }, [alarms]);

  const runningCount = tables.filter(t => t.status === 'running').length;
  const pausedCount = tables.filter(t => t.status === 'paused').length;
  const availableCount = tables.filter(t => t.status === 'available').length;
  const exhibitionCount = tables.filter(t => t.status === 'exhibition').length;

  const isAvailable = selectedTable?.status === 'available';
  const isRunning = selectedTable?.status === 'running';
  const isPaused = selectedTable?.status === 'paused';
  const isFinished = selectedTable?.status === 'finished';
  const isExhibition = selectedTable?.status === 'exhibition';

  return (
    <Layout>
      <div className="page-enter">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-black text-white">Table Monitor</h1>
            <p className="text-xs text-gray-500 mt-1">
              {runningCount} running · {pausedCount} paused · {availableCount} available · {exhibitionCount} exhibition · ₱200/hr
            </p>
          </div>
        </div>

        {/* Time's Up Center Modal */}
        {alarms.length > 0 && alarms.map(alarm => (
          <div key={alarm.tableId} className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
            <div className="bg-gray-900 border border-red-500/50 rounded-2xl max-w-sm w-full overflow-hidden shadow-2xl shadow-red-500/20">
              {/* Red header band */}
              <div className="bg-red-600 px-6 py-5 text-center">
                <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-white/20 flex items-center justify-center">
                  <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-black text-white tracking-tight">Table {alarm.tableNumber}</h2>
                <p className="text-red-100 text-sm font-semibold mt-1">Time is Up!</p>
              </div>

              {/* Body */}
              <div className="px-6 py-5 text-center space-y-4">
                <p className="text-gray-400 text-sm">The prepaid time has expired.</p>

                {/* Cost card */}
                <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                  <p className="text-gray-500 text-xs uppercase tracking-wider font-semibold">Total Cost</p>
                  <p className="text-white text-3xl font-black mt-1">₱{parseFloat(alarm.cost).toFixed(2)}</p>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-1">
                  <button
                    className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-3 rounded-xl transition-colors"
                    onClick={() => {
                      const table = tables.find(t => t.id === alarm.tableId);
                      if (table) {
                        dismissAlarm(alarm.tableId);
                        handleCardClick(table);
                      }
                    }}
                  >
                    Pay Now
                  </button>
                  <button
                    className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold py-3 rounded-xl border border-gray-700 transition-colors"
                    onClick={() => dismissAlarm(alarm.tableId)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}

        {loading ? (
          <div className="text-gray-500 text-sm">Loading tables...</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-4">
            {tables.map(table => (
              <TableCard
                key={table.id}
                table={table}
                onClick={handleCardClick}
                onCctv={setCctvModal}
              />
            ))}
          </div>
        )}
      </div>

      {/* Table Detail Modal */}
      {selectedTable && !payModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-3 sm:p-4">
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4 sm:mb-6">
              <h2 className="text-lg sm:text-xl font-black text-white">Table {selectedTable.table_number}</h2>
              <div className="flex items-center gap-3">
                <button onClick={() => setSelectedTable(null)} className="text-gray-500 hover:text-white text-2xl leading-none">×</button>
              </div>
            </div>

            {/* AVAILABLE: Start with hours */}
            {isAvailable && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-400 uppercase tracking-wider font-semibold mb-3">Select Duration</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
                    {[
                      { label: '1 hr', hours: 1, cost: 200 },
                      { label: '2 hr', hours: 2, cost: 400 },
                      { label: '3 hr', hours: 3, cost: 600 },
                      { label: '4 hr', hours: 4, cost: 800 },
                      { label: '5 hr', hours: 5, cost: 1000 },
                    ].map(opt => (
                      <button
                        key={opt.hours}
                        className={`p-2 rounded-lg border-2 text-center transition-all ${startHours === String(opt.hours)
                          ? 'duration-selected shadow-md'
                          : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white'
                          }`}
                        onClick={() => setStartHours(String(opt.hours))}
                      >
                        <div className="text-sm font-bold">{opt.label}</div>
                        <div className={`text-xs ${startHours === String(opt.hours) ? 'duration-selected-sub' : 'text-gray-500'}`}>₱{opt.cost}</div>
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      className="input flex-1"
                      placeholder="Custom hours (e.g. 4)"
                      value={startHours && ![0.5, 1, 2, 3, 4, 5].includes(parseFloat(startHours)) ? startHours : ''}
                      onChange={e => setStartHours(e.target.value)}
                      min="0"
                      step="0.5"
                    />
                    <span className="text-xs text-gray-500 whitespace-nowrap">or leave blank for unlimited</span>
                  </div>
                  {startHours && parseFloat(startHours) > 0 && (
                    <p className="text-xs text-gray-400 mt-2 text-center font-semibold">
                      {parseFloat(startHours) < 1
                        ? `${Math.round(parseFloat(startHours) * 60)}min`
                        : `${startHours}h`
                      } · ₱{calculateTableCost(0, parseFloat(startHours)).toFixed(2)}
                      {parseFloat(startHours) < 1 && <span className="text-gray-400 ml-1">(min ₱200)</span>}
                    </p>
                  )}

                  {/* Undo button when duration is selected */}
                  {startHours && (
                    <button
                      className="w-full mt-3 py-2 text-xs text-gray-500 hover:text-white border border-gray-700 hover:border-gray-500 rounded-lg transition-colors"
                      onClick={() => setStartHours('')}
                    >
                      ↺ Undo Selection
                    </button>
                  )}
                </div>
                <button
                  className="btn-primary w-full py-3"
                  onClick={handleStart}
                  disabled={busy}
                >
                  {busy ? 'Starting...' : '▶ Start Table'}
                </button>

                {/* Exhibition Match Section - Admin Only */}
                {user?.role === 'admin' && (
                  <>
                    <div className="border-t border-gray-800 my-4"></div>
                    <div className="card-elevated p-4">
                      <label className="block text-xs text-gray-400 uppercase tracking-wider font-semibold mb-3">
                        Exhibition Match
                      </label>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Bet Amount</label>
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400 font-bold">₱</span>
                            <input
                              type="number"
                              className="input flex-1"
                              placeholder="e.g. 27500"
                              value={exhibitionBet}
                              onChange={e => setExhibitionBet(e.target.value)}
                              min="0"
                              step="100"
                            />
                          </div>
                        </div>

                        {exhibitionBet && parseFloat(exhibitionBet) > 0 && (
                          <div className="bg-gray-900 rounded-lg p-3 text-center">
                            <p className="text-xs text-gray-500 uppercase tracking-wider">
                              {useCustomFee ? 'Custom Table Fee' : 'Table Fee (10%)'}
                            </p>
                            <p className="text-xl font-bold text-accent">
                              ₱{(useCustomFee && exhibitionCustomFee
                                ? parseFloat(exhibitionCustomFee)
                                : parseFloat(exhibitionBet) * 0.10
                              ).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                            </p>
                            <p className="text-xs text-gray-600 mt-1">
                              Bet: ₱{parseFloat(exhibitionBet).toLocaleString('en-PH')}
                            </p>
                          </div>
                        )}

                        {/* Custom Fee Toggle */}
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="customFee"
                            checked={useCustomFee}
                            onChange={e => setUseCustomFee(e.target.checked)}
                            className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
                          />
                          <label htmlFor="customFee" className="text-sm text-gray-400 cursor-pointer">
                            Use custom table fee
                          </label>
                        </div>

                        {/* Custom Fee Input */}
                        {useCustomFee && (
                          <div>
                            <label className="block text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">
                              Custom Fee Amount
                            </label>
                            <div className="flex items-center gap-2">
                              <span className="text-gray-500">₱</span>
                              <input
                                type="number"
                                className="input flex-1"
                                placeholder="e.g. 1500"
                                value={exhibitionCustomFee}
                                onChange={e => setExhibitionCustomFee(e.target.value)}
                                min="0"
                                step="100"
                              />
                            </div>
                          </div>
                        )}

                        <button
                          className="btn-outline w-full py-2 border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
                          onClick={() => {
                            if (!exhibitionBet || parseFloat(exhibitionBet) <= 0) {
                              setToast('Please enter bet amount first');
                              setTimeout(() => setToast(''), 2000);
                              return;
                            }
                            handleExhibitionMatch();
                          }}
                          disabled={busy}
                        >
                          {busy ? 'Processing...' : 'Exhibition Match'}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* RUNNING: Timer + actions + food */}
            {isRunning && (
              <div className="space-y-4">
                {/* Live Timer - Frozen when pay modal is open */}
                <div className={`rounded-lg p-3 sm:p-4 text-center font-mono ${selectedTable.set_hours > 0 && (frozenElapsed !== null ? frozenElapsed : localElapsed) >= selectedTable.set_hours * 3600
                  ? 'bg-red-600 text-white' : 'bg-white text-black'
                  }`}>
                  {selectedTable.set_hours > 0 ? (
                    <>
                      <div className="text-2xl sm:text-3xl font-black tracking-widest">
                        {formatTime(Math.max(0, Math.round(selectedTable.set_hours * 3600 - (frozenElapsed !== null ? frozenElapsed : localElapsed))))}
                      </div>
                      <div className="text-sm mt-1 font-semibold">
                        {(frozenElapsed !== null ? frozenElapsed : localElapsed) >= selectedTable.set_hours * 3600
                          ? "TIME'S UP!" : frozenElapsed !== null ? 'STOPPED' : 'remaining'}
                      </div>
                      <div className="text-xs mt-1 opacity-70">
                        Elapsed: {formatTime(frozenElapsed !== null ? frozenElapsed : localElapsed)} · ₱{calculateTableCost(frozenElapsed !== null ? frozenElapsed : localElapsed).toFixed(2)}
                        {frozenElapsed !== null && ' (Stopped)'}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-2xl sm:text-3xl font-black tracking-widest">{formatTime(frozenElapsed !== null ? frozenElapsed : localElapsed)}</div>
                      <div className="text-sm mt-1 font-semibold">₱{calculateTableCost(frozenElapsed !== null ? frozenElapsed : localElapsed).toFixed(2)}</div>
                      {frozenElapsed !== null && <div className="text-xs mt-1 opacity-70">(Stopped)</div>}
                    </>
                  )}
                </div>

                {/* Start time */}
                {selectedTable.start_time && (
                  <p className="text-xs text-gray-500 text-center">Started: {formatStartTime(selectedTable.start_time)}</p>
                )}

                {/* Extend Hours */}
                <div className="card-elevated p-3 border-l-4 border-l-amber-500 bg-gradient-to-r from-amber-500/10 to-transparent">
                  <label className="block text-xs text-amber-400 uppercase tracking-wider font-bold mb-2 flex items-center gap-2">
                    <span></span> Extend Hours
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      className="input flex-1"
                      placeholder="e.g. 1.5"
                      value={extendHours}
                      onChange={e => setExtendHours(e.target.value)}
                      min="0.5"
                      step="0.5"
                    />
                    <button
                      className="btn-primary px-4 py-2 text-sm"
                      onClick={handleExtend}
                      disabled={busy || !extendHours || parseFloat(extendHours) <= 0}
                    >
                      + Add
                    </button>
                  </div>
                  {extendHours && parseFloat(extendHours) > 0 && (
                    <p className="text-xs text-gray-500 mt-2">+{extendHours}h = +₱{(parseFloat(extendHours) * 200).toFixed(2)}</p>
                  )}
                </div>

                {/* Billing History for Running Tables */}
                {(extensionHistory.length > 0 || selectedTable?.set_hours > 0) && (
                  <div className="card-elevated p-3 border-l-4 border-l-gray-500 bg-gradient-to-r from-gray-500/10 to-transparent">
                    <label className="block text-xs text-gray-300 uppercase tracking-wider font-bold mb-2 flex items-center gap-2">
                      <span></span> Billing History
                    </label>
                    <div className="space-y-2 max-h-32 overflow-y-auto">
                      {/* Initial Start - Calculate original hours by subtracting extensions */}
                      {selectedTable?.set_hours > 0 && (
                        <div className="text-xs border-b border-gray-800 pb-1">
                          <div className="flex justify-between text-gray-400">
                            <span>1. Initial</span>
                            <span>{new Date(selectedTable.start_time).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: true })}</span>
                          </div>
                          <div className="flex justify-between text-white mt-1">
                            {(() => {
                              const totalExtended = extensionHistory.reduce((sum, ext) => sum + (ext.extended_hours || 0), 0);
                              const initialHours = Math.max(0, selectedTable.set_hours - totalExtended);
                              return (
                                <>
                                  <span>{initialHours}h / ₱{(initialHours * 200).toFixed(0)}</span>
                                  <span className="text-white">₱{(initialHours * 200).toFixed(2)}</span>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      )}

                      {/* Extensions - Show added hours with + sign */}
                      {extensionHistory.map((ext, idx) => (
                        <div key={idx} className="text-xs border-b border-gray-800 pb-1 last:border-0">
                          <div className="flex justify-between text-gray-400">
                            <span>{idx + 2}. Extend</span>
                            <span>{new Date(ext.extended_at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true })}</span>
                          </div>
                          <div className="flex justify-between text-white mt-1">
                            <span>+{ext.extended_hours}h / +₱{(ext.extended_hours * 200).toFixed(0)}</span>
                            <span className="text-white">+₱{(ext.extended_hours * 200).toFixed(2)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Food Menu Button */}
                <button
                  onClick={() => setShowFoodModal(true)}
                  className="btn-outline w-full py-2 text-sm flex items-center justify-center gap-2"
                >
                  + Open Food Menu
                </button>

                {/* Cart */}
                {cart.length > 0 && (
                  <div className="card-elevated p-3">
                    <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">Cart</p>
                    <div className="space-y-2">
                      {cart.map((item, idx) => (
                        <div key={`${item.food_id}-${item.flavor_name || 'none'}-${idx}`} className="flex items-center gap-1 text-sm">
                          <span className="text-white flex-1 min-w-0 truncate text-xs sm:text-sm">{item.food_name}</span>
                          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                            <button onClick={() => handleDecreaseQty(item.food_id, item.flavor_name)} className="text-gray-400 hover:text-white w-6 h-6 flex items-center justify-center border border-gray-700 rounded" title={item.quantity === 1 ? "Void item (Owner only)" : "Decrease quantity"}>−</button>
                            <span className="text-white w-4 text-center text-xs">{item.quantity}</span>
                            <button onClick={() => adjustQty(item.food_id, 1, item.flavor_name)} className="text-gray-400 hover:text-white w-6 h-6 flex items-center justify-center border border-gray-700 rounded">+</button>
                            <span className="text-white font-semibold w-14 text-right text-xs">₱{(item.price * item.quantity).toFixed(2)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-gray-800 mt-2 pt-2 flex justify-between text-sm">
                      <span className="text-gray-400">Food Total</span>
                      <span className="text-white font-bold">₱{foodTotal.toFixed(2)}</span>
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-3">
                  <button
                    className="btn-outline flex-1 py-2"
                    onClick={() => doAction('pause')}
                    disabled={busy}
                  >
                    ⏸ Pause
                  </button>
                  <button
                    className="btn-danger flex-1 py-2"
                    onClick={() => {
                      // Freeze the current elapsed time
                      const frozenTime = localElapsed;
                      setFrozenElapsed(frozenTime);
                      // Show pay modal instantly with current data (optimistic)
                      const totalSeconds = frozenTime;
                      const cost = calculateTableCost(totalSeconds, selectedTable.set_hours);
                      setPayModal({
                        elapsed_seconds: totalSeconds,
                        cost: cost,
                        start_time: selectedTable.start_time,
                        end_time: new Date().toISOString(),
                        table_number: selectedTable.table_number,
                        table_id: selectedTable.id,
                        set_hours: selectedTable.set_hours || 0
                      });
                      // Close table detail modal so only checkout shows
                      const tableIdToStop = selectedTable.id;
                      setSelectedTable(null);
                      // Then stop the table using Firebase tableAction (use latest table from ref)
                      const latestTable = tablesRef.current.find(t => t.id === tableIdToStop) || selectedTable;
                      tableAction(latestTable, 'stop', {}, user.name)
                        .then(res => {
                          setPayModal(prev => prev ? { ...prev, ...res } : res);
                        })
                        .catch(err => setErrorModal(err.message || 'Failed to stop'))
                        .finally(() => setBusy(false));
                    }}
                    disabled={busy}
                  >
                    ⏹ Stop & Pay
                  </button>
                </div>
              </div>
            )}

            {/* PAUSED: Resume + Stop */}
            {isPaused && (
              <div className="space-y-4">
                <div className="bg-gray-900 text-gray-400 rounded-lg p-3 sm:p-4 text-center font-mono">
                  <div className="text-2xl sm:text-3xl font-black tracking-widest">{formatTime(selectedTable.elapsed_seconds)}</div>
                  <div className="text-sm mt-1 font-semibold">₱{selectedTable.cost?.toFixed(2)}</div>
                </div>

                {selectedTable.start_time && (
                  <p className="text-xs text-gray-500 text-center">Started: {formatStartTime(selectedTable.start_time)}</p>
                )}

                {/* Extend Hours */}
                <div className="card-elevated p-3 border-l-4 border-l-amber-500 bg-gradient-to-r from-amber-500/10 to-transparent">
                  <label className="block text-xs text-amber-400 uppercase tracking-wider font-bold mb-2 flex items-center gap-2">
                    <span></span> Extend Hours
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      className="input flex-1"
                      placeholder="e.g. 1.5"
                      value={extendHours}
                      onChange={e => setExtendHours(e.target.value)}
                      min="0.5"
                      step="0.5"
                    />
                    <button
                      className="btn-primary px-4 py-2 text-sm"
                      onClick={handleExtend}
                      disabled={busy || !extendHours || parseFloat(extendHours) <= 0}
                    >
                      + Add
                    </button>
                  </div>
                  {extendHours && parseFloat(extendHours) > 0 && (
                    <p className="text-xs text-gray-500 mt-2">+{extendHours}h = +₱{(parseFloat(extendHours) * 200).toFixed(2)}</p>
                  )}
                </div>

                {/* Food Menu Button - Owner Only */}
                {user?.role === 'owner' ? (
                  <button
                    onClick={() => setFoodMenuAuthModal(true)}
                    className="btn-outline w-full py-2 text-sm flex items-center justify-center gap-2"
                  >
                    + Open Food Menu (Owner)
                  </button>
                ) : (
                  <div className="text-xs text-gray-500 text-center py-2">
                    Food menu restricted to owner
                  </div>
                )}

                {cart.length > 0 && (
                  <div className="card-elevated p-3">
                    <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">Cart</p>
                    <div className="space-y-2">
                      {cart.map((item, idx) => (
                        <div key={`${item.food_id}-${item.flavor_name || 'none'}-${idx}`} className="flex items-center gap-1 text-sm">
                          <span className="text-white flex-1 min-w-0 truncate text-xs sm:text-sm">{item.food_name}</span>
                          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                            <button onClick={() => handleDecreaseQty(item.food_id, item.flavor_name)} className="text-gray-400 hover:text-white w-6 h-6 flex items-center justify-center border border-gray-700 rounded" title={item.quantity === 1 ? "Void item (Owner only)" : "Decrease quantity"}>−</button>
                            <span className="text-white w-4 text-center text-xs">{item.quantity}</span>
                            <button onClick={() => adjustQty(item.food_id, 1, item.flavor_name)} className="text-gray-400 hover:text-white w-6 h-6 flex items-center justify-center border border-gray-700 rounded">+</button>
                            <span className="text-white font-semibold w-14 text-right text-xs">₱{(item.price * item.quantity).toFixed(2)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-gray-800 mt-2 pt-2 flex justify-between text-sm">
                      <span className="text-gray-400">Food Total</span>
                      <span className="text-white font-bold">₱{foodTotal.toFixed(2)}</span>
                    </div>
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    className="btn-primary flex-1 py-2"
                    onClick={() => doAction('resume')}
                    disabled={busy}
                  >
                    ▶ Resume
                  </button>
                  <button
                    className="btn-danger flex-1 py-2"
                    onClick={() => {
                      // Freeze the current elapsed time
                      const frozenTime = selectedTable.elapsed_seconds || localElapsed;
                      setFrozenElapsed(frozenTime);
                      // Show pay modal instantly with current data (optimistic)
                      const totalSeconds = frozenTime;
                      const cost = calculateTableCost(totalSeconds, selectedTable.set_hours);
                      setPayModal({
                        elapsed_seconds: totalSeconds,
                        cost: cost,
                        start_time: selectedTable.start_time,
                        end_time: new Date().toISOString(),
                        table_number: selectedTable.table_number,
                        table_id: selectedTable.id,
                        set_hours: selectedTable.set_hours || 0
                      });
                      // Close table detail modal so only checkout shows
                      const tableIdToStop = selectedTable.id;
                      setSelectedTable(null);
                      // Then stop the table using Firebase tableAction (use latest table from ref)
                      const latestTable = tablesRef.current.find(t => t.id === tableIdToStop) || selectedTable;
                      tableAction(latestTable, 'stop', {}, user.name)
                        .then(res => {
                          setPayModal(prev => prev ? { ...prev, ...res } : res);
                        })
                        .catch(err => setErrorModal(err.message || 'Failed to stop'))
                        .finally(() => setBusy(false));
                    }}
                    disabled={busy}
                  >
                    ⏹ Stop & Pay
                  </button>
                </div>
              </div>
            )}

            {/* FINISHED: Extend Hours, Pay or Reset */}
            {isFinished && (
              <div className="space-y-4">
                {/* Timer / Cost Display */}
                <div className="bg-black border border-gray-700 rounded-lg p-3 sm:p-4 text-center font-mono">
                  <div className="text-2xl sm:text-3xl font-black tracking-widest text-white">{formatTime(selectedTable.elapsed_seconds)}</div>
                  {(() => {
                    const elapsedHours = (selectedTable.elapsed_seconds || 0) / 3600;
                    const totalMinutes = Math.floor((selectedTable.elapsed_seconds || 0) / 60);
                    const wholeHours = Math.floor(totalMinutes / 60);
                    const extraMinutes = totalMinutes % 60;
                    const roundedHours = extraMinutes > 30 ? wholeHours + 1 : wholeHours;
                    const displayCost = roundedHours * 200;
                    return (
                      <>
                        <div className="text-sm mt-1 font-bold text-white">₱{displayCost.toFixed(2)}</div>
                        <div className="text-[10px] text-gray-400 mt-1">
                          {selectedTable.set_hours > 0
                            ? `${selectedTable.set_hours}h prepaid + ${(elapsedHours - selectedTable.set_hours).toFixed(1)}h overtime`
                            : `${roundedHours}h @ ₱200/hr (rounded)`}
                        </div>
                      </>
                    );
                  })()}
                </div>

                {/* Extend More Hours */}
                <div className="border border-gray-700 rounded-lg p-3">
                  <label className="block text-xs text-gray-300 uppercase tracking-wider font-bold mb-2">Extend More Hours</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      className="input flex-1"
                      placeholder="e.g. 1.5"
                      value={extendHours}
                      onChange={e => setExtendHours(e.target.value)}
                      min="0.5"
                      step="0.5"
                    />
                    <button
                      className="btn-primary px-4 py-2 text-sm"
                      onClick={handleExtend}
                      disabled={busy || !extendHours || parseFloat(extendHours) <= 0}
                    >
                      + Add
                    </button>
                  </div>
                  {extendHours && parseFloat(extendHours) > 0 && (
                    <p className="text-xs text-gray-500 mt-2">+{extendHours}h = +₱{(parseFloat(extendHours) * 200).toFixed(2)}</p>
                  )}
                </div>

                {/* Billing History */}
                {(extensionHistory.length > 0 || selectedTable?.set_hours > 0) && (
                  <div className="border border-gray-700 rounded-lg p-3">
                    <label className="block text-xs text-gray-300 uppercase tracking-wider font-bold mb-2">Billing History</label>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {/* Initial Start */}
                      {selectedTable?.set_hours > 0 && (
                        <div className="text-xs border-b border-gray-700 pb-2">
                          <div className="flex justify-between text-gray-400 mb-1">
                            <span>1. Initial Start</span>
                            <span>{new Date(selectedTable.start_time).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true })}</span>
                          </div>
                          <div className="flex justify-between text-white font-semibold">
                            <span>{selectedTable.set_hours}h (Base Rate)</span>
                            <span>₱{(selectedTable.set_hours * 200).toFixed(2)}</span>
                          </div>
                        </div>
                      )}

                      {/* Extensions */}
                      {extensionHistory.map((ext, idx) => (
                        <div key={idx} className="text-xs border-b border-gray-700 pb-2 last:border-0">
                          <div className="flex justify-between text-gray-400 mb-1">
                            <span>{idx + 2}. Extension #{idx + 1}</span>
                            <span>{new Date(ext.extended_at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true })}</span>
                          </div>
                          <div className="flex justify-between text-white font-semibold">
                            <span>+{ext.extended_hours}h</span>
                            <span>+₱{ext.additional_cost?.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-gray-500 text-[10px] mt-0.5">
                            <span>Running Total: {ext.new_total_hours?.toFixed(1)}h</span>
                            <span>₱{ext.new_total_cost?.toFixed(2)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    {/* Total */}
                    <div className="border-t border-gray-600 mt-2 pt-2">
                      <div className="flex justify-between text-sm font-black">
                        <span className="text-white">TOTAL BILL</span>
                        <span className="text-white text-base">₱{selectedTable.cost?.toFixed(2)}</span>
                      </div>
                      <div className="text-xs text-gray-500 text-right mt-0.5">
                        {(selectedTable.elapsed_seconds / 3600).toFixed(1)} hours total
                      </div>
                    </div>
                  </div>
                )}

                {/* Cart Items Preview for Finished Tables */}
                {cart.length > 0 && (
                  <div className="card-elevated p-3 space-y-2">
                    <label className="block text-xs text-gray-500 uppercase tracking-wider font-semibold">
                      Cart ({cart.length} items)
                    </label>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {cart.map((item, idx) => (
                        <div key={idx} className="flex justify-between text-xs text-gray-400">
                          <span>{item.food_name} × {item.quantity}</span>
                          <span>₱{(item.price * item.quantity).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-gray-700 pt-2 flex justify-between text-xs font-bold text-white">
                      <span>Food Total</span>
                      <span>₱{cart.reduce((sum, i) => sum + i.price * i.quantity, 0).toFixed(2)}</span>
                    </div>
                  </div>
                )}

                <button
                  className="btn-primary w-full py-3"
                  onClick={() => {
                    setPayModal({
                      elapsed_seconds: selectedTable.elapsed_seconds,
                      cost: selectedTable.cost,
                      start_time: selectedTable.start_time,
                      end_time: new Date().toISOString(),
                      table_number: selectedTable.table_number,
                      table_id: selectedTable.id,
                      set_hours: selectedTable.set_hours || 0
                    });
                    // Close detail modal so only checkout shows
                    setSelectedTable(null);
                  }}
                >
                  Pay Now
                </button>
                <button
                  className="btn-outline w-full py-2"
                  onClick={() => { setResetPasswordModal({ tableId: selectedTable.id, tableNumber: selectedTable.table_number }); }}
                  disabled={busy}
                >
                  ↺ Reset Table
                </button>
              </div>
            )}

            {/* EXHIBITION: Show bet amount, Pay or Reset */}
            {isExhibition && (
              <div className="space-y-4">
                <div className="bg-white border border-gray-300 rounded-lg p-4 text-center">
                  <div className="text-black text-sm font-semibold mb-2">EXHIBITION MATCH</div>
                  <div className="text-black text-xl sm:text-2xl font-black">₱{selectedTable.exhibition_bet?.toLocaleString('en-PH') || 0}</div>
                  <div className="text-gray-500 text-xs mt-1">Bet Amount</div>
                  <div className="border-t border-gray-300 mt-3 pt-3">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600 text-sm">
                        {selectedTable.exhibition_custom_fee ? 'Custom Table Fee' : 'Table Fee (10%)'}
                      </span>
                      <span className="text-black font-bold">
                        ₱{(selectedTable.exhibition_custom_fee || selectedTable.exhibition_bet * 0.10 || 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Edit Custom Fee Section */}
                {!editingRunningFee ? (
                  <button
                    className="btn-outline w-full py-2 text-sm"
                    onClick={() => {
                      setEditingRunningFee(true);
                      setRunningCustomFee(selectedTable.exhibition_custom_fee || '');
                    }}
                  >
                    ✎ Edit Table Fee
                  </button>
                ) : (
                  <div className="card-elevated p-3 space-y-2">
                    <label className="block text-xs text-gray-500 uppercase tracking-wider font-semibold">
                      Set Custom Table Fee
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400">₱</span>
                      <input
                        type="number"
                        className="input flex-1"
                        placeholder="e.g. 1500"
                        value={runningCustomFee}
                        onChange={e => setRunningCustomFee(e.target.value)}
                        min="0"
                        step="100"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="btn-primary flex-1 py-2 text-sm"
                        onClick={async () => {
                          const fee = parseFloat(runningCustomFee);
                          if (!fee || fee <= 0) {
                            setErrorModal('Please enter a valid fee amount');
                            return;
                          }
                          try {
                            await updateDoc(doc(db, 'tables', selectedTable.id.toString()), {
                              exhibition_custom_fee: fee
                            });
                            setSelectedTable(prev => ({ ...prev, exhibition_custom_fee: fee }));
                            setEditingRunningFee(false);
                          } catch (err) {
                            setErrorModal(err.message || 'Failed to update fee');
                          }
                        }}
                        disabled={busy || !runningCustomFee || parseFloat(runningCustomFee) <= 0}
                      >
                        Save Fee
                      </button>
                      <button
                        className="btn-outline px-3 py-2 text-sm"
                        onClick={() => setEditingRunningFee(false)}
                      >
                        Cancel
                      </button>
                    </div>
                    {!selectedTable.exhibition_custom_fee && (
                      <p className="text-xs text-gray-500">
                        Current default: ₱{(selectedTable.exhibition_bet * 0.10).toFixed(2)} (10%)
                      </p>
                    )}
                  </div>
                )}

                {/* Cart Items Preview */}
                {cart.length > 0 && (
                  <div className="card-elevated p-3 space-y-2">
                    <label className="block text-xs text-gray-500 uppercase tracking-wider font-semibold">
                      Cart ({cart.length} items)
                    </label>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {cart.map((item, idx) => (
                        <div key={idx} className="flex justify-between text-xs text-gray-400">
                          <span>{item.food_name} × {item.quantity}</span>
                          <span>₱{(item.price * item.quantity).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-gray-700 pt-2 flex justify-between text-xs font-bold text-white">
                      <span>Food Total</span>
                      <span>₱{cart.reduce((sum, i) => sum + i.price * i.quantity, 0).toFixed(2)}</span>
                    </div>
                  </div>
                )}

                <button
                  className="btn-primary w-full py-3"
                  onClick={() => {
                    const fee = selectedTable.exhibition_custom_fee || selectedTable.exhibition_bet * 0.10 || 0;
                    setPayModal({
                      elapsed_seconds: 0,
                      cost: fee,
                      start_time: null,
                      end_time: new Date().toISOString(),
                      isExhibition: true,
                      betAmount: selectedTable.exhibition_bet || 0,
                      isCustomFee: !!selectedTable.exhibition_custom_fee,
                      table_number: selectedTable.table_number,
                      table_id: selectedTable.id
                    });
                    // Close detail modal so only checkout shows
                    setSelectedTable(null);
                  }}
                >
                  Pay Now
                </button>
                <button
                  className="btn-outline w-full py-2"
                  onClick={() => { setResetPasswordModal({ tableId: selectedTable.id, tableNumber: selectedTable.table_number }); }}
                  disabled={busy}
                >
                  ↺ Cancel & Reset Table
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Payment Modal (after stop) */}
      {payModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-3 sm:p-4">
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4 sm:mb-6">
              <h2 className="text-base sm:text-xl font-black text-white">Table {payModal.table_number} — Checkout</h2>
              <button onClick={() => { setPayModal(null); setFrozenElapsed(null); }} className="text-gray-500 hover:text-white text-2xl leading-none">×</button>
            </div>

            {/* Exhibition Match Info */}
            {payModal.isExhibition && (
              <div className="card-elevated p-4 mb-4 border-l-4 border-l-amber-500 bg-gradient-to-r from-amber-500/10 to-transparent">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-gray-400 text-sm">Exhibition Match</span>
                  <span className="text-gray-300 font-bold text-sm">Bet: ₱{payModal.betAmount.toLocaleString('en-PH')}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-sm">
                    {payModal.isCustomFee ? 'Custom Table Fee' : 'Table Fee (10%)'}
                  </span>
                  <span className="text-white font-bold text-lg">₱{tableCost.toFixed(2)}</span>
                </div>
              </div>
            )}

            {/* Table Hours Summary (when no billing history) */}
            {!payModal.isExhibition && extensionHistory.length === 0 && (!payModal.set_hours || payModal.set_hours <= 0) && (
              <div className="card-elevated p-4 mb-4 border-l-4 border-l-gray-500 bg-gradient-to-r from-gray-500/10 to-transparent">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-gray-400 text-sm">Duration</span>
                  <span className="text-white font-bold text-sm">
                    {payModal.elapsed_seconds ? formatTime(payModal.elapsed_seconds) : '--:--:--'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-sm">Table Cost</span>
                  <span className="text-white font-bold text-lg">₱{tableCost.toFixed(2)}</span>
                </div>
              </div>
            )}

            {/* Billing History Breakdown */}
            {!payModal.isExhibition && (extensionHistory.length > 0 || payModal.set_hours > 0) && (
              <div className="card-elevated p-3 mb-4 border-l-4 border-l-gray-500 bg-gradient-to-r from-gray-500/10 to-transparent">
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-xs text-gray-300 uppercase tracking-wider font-bold">
                    Billing History
                  </label>
                  {payModal.elapsed_seconds > 0 && (
                    <span className="text-xs text-white font-bold">
                      Elapsed: {formatTime(payModal.elapsed_seconds)}
                    </span>
                  )}
                </div>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {/* Initial - Calculate original hours by subtracting extensions */}
                  {payModal.set_hours > 0 && (
                    <div className="text-xs border-b border-gray-800 pb-1">
                      <div className="flex justify-between text-gray-400">
                        <span>1. Initial</span>
                        <span>{payModal.start_time ? new Date(payModal.start_time).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true }) : '--'}</span>
                      </div>
                      <div className="flex justify-between text-white mt-1">
                        {(() => {
                          const totalExtended = extensionHistory.reduce((sum, ext) => sum + (ext.extended_hours || 0), 0);
                          const initialHours = Math.max(0, payModal.set_hours - totalExtended);
                          return (
                            <>
                              <span>{initialHours}h / ₱{(initialHours * 200).toFixed(0)}</span>
                              <span className="text-white">₱{(initialHours * 200).toFixed(2)}</span>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  )}

                  {/* Extensions - Show added hours with + sign */}
                  {extensionHistory.map((ext, idx) => (
                    <div key={idx} className="text-xs border-b border-gray-800 pb-1 last:border-0">
                      <div className="flex justify-between text-gray-400">
                        <span>{idx + 2}. Extend</span>
                        <span>{new Date(ext.extended_at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true })}</span>
                      </div>
                      <div className="flex justify-between text-white mt-1">
                        <span>+{ext.extended_hours}h / +₱{(ext.extended_hours * 200).toFixed(0)}</span>
                        <span className="text-white">+₱{(ext.extended_hours * 200).toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t-2 border-gray-500 mt-2 pt-2">
                  <div className="flex justify-between text-sm font-bold">
                    <span className="text-white">Table Cost Total</span>
                    <span className="text-white">₱{tableCost.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Cart - Organized Summary */}
            <div className="space-y-3 mb-4">
              {/* Table Cost */}
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Table Cost</span>
                <span className="text-white font-semibold">₱{tableCost.toFixed(2)}</span>
              </div>

              {/* Food Items - if any */}
              {cart.length > 0 && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Food Items ({cart.length})</span>
                    <span className="text-white font-semibold">₱{foodTotal.toFixed(2)}</span>
                  </div>
                  <div className="space-y-1 pl-4">
                    {cart.map((item, idx) => (
                      <div key={`${item.food_id}-${item.flavor_name || 'none'}-${idx}`} className="flex justify-between text-xs text-gray-500">
                        <span>{item.food_name} × {item.quantity}</span>
                        <span>₱{(item.price * item.quantity).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Divider */}
              <div className="border-t border-gray-700 pt-3">
                <div className="flex justify-between font-bold text-lg">
                  <span className="text-white">TOTAL</span>
                  <span className="text-white">₱{grandTotal.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Payment Mode Selector */}
            <div className="mb-4">
              <label className="block text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Payment Mode</label>
              <div className="flex gap-2">
                {/* Cash */}
                <button
                  type="button"
                  onClick={() => setPaymentMode('Cash')}
                  className={`flex-1 p-2 rounded-lg border-2 text-xs font-bold transition-all ${paymentMode === 'Cash'
                    ? 'border-blue-500 bg-blue-500 text-white'
                    : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white'
                    }`}
                >Cash</button>
                {/* GCash */}
                <button
                  type="button"
                  onClick={() => setPaymentMode('GCash')}
                  className={`flex-1 p-2 rounded-lg border-2 text-xs font-bold transition-all ${paymentMode === 'GCash'
                    ? 'border-blue-500 bg-blue-500 text-white'
                    : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white'
                    }`}
                >GCash</button>
              </div>
            </div>

            {/* Payment input */}
            <div className="mb-4">
              <label className="block text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Amount Received</label>
              <input
                type="number"
                className="input text-lg font-bold"
                placeholder="0.00"
                value={received}
                onChange={e => setReceived(e.target.value)}
              />
              {received && parseFloat(received) >= grandTotal && (
                <p className="text-sm text-gray-400 mt-2">Change: <span className="text-white font-bold">₱{change.toFixed(2)}</span></p>
              )}
            </div>

            <button
              id="confirm-payment-btn"
              className="btn-primary w-full py-3 text-base"
              onClick={payModal.isExhibition ? handleExhibitionPayment : handlePayment}
              disabled={paying || !received}
            >
              {paying ? 'Processing...' : (payModal.isExhibition ? 'Pay & Reset Table' : 'Confirm Payment')}
            </button>
          </div>
        </div>
      )}

      {/* Food Menu Modal */}
      {showFoodModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-3 sm:p-4">
          <div className="card w-full max-w-4xl max-h-[85vh] overflow-y-auto p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">Food Menu</h2>
              <button onClick={() => setShowFoodModal(false)} className="text-gray-500 hover:text-white text-2xl leading-none">×</button>
            </div>

            {/* Search and Filter */}
            <div className="mb-4 space-y-3">
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  placeholder="Search food or drinks..."
                  value={foodSearch}
                  onChange={(e) => setFoodSearch(e.target.value)}
                  className="input flex-1"
                />
                <select
                  value={foodCategoryFilter}
                  onChange={(e) => setFoodCategoryFilter(e.target.value)}
                  className="input sm:max-w-[180px]"
                >
                  <option value="All">All Categories</option>
                  <option value="Food">Food</option>
                  <option value="Drinks">Drinks</option>
                  <optgroup label="Food Categories">
                    {FOOD_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Drink Categories">
                    {DRINK_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </optgroup>
                </select>
              </div>
            </div>

            <div className="space-y-4">
              {[...FOOD_CATEGORIES, ...DRINK_CATEGORIES].map(cat => {
                const catFoods = foods.filter(f => {
                  const matchesCategory = foodCategoryFilter === 'All' || foodCategoryFilter === 'Food' && FOOD_CATEGORIES.includes(f.category) || foodCategoryFilter === 'Drinks' && DRINK_CATEGORIES.includes(f.category) || foodCategoryFilter === f.category;
                  const matchesSearch = f.name.toLowerCase().includes(foodSearch.toLowerCase());
                  // Hide foods with 0 stock (same as POSPage)
                  const hasStock = f.flavors && f.flavors.length > 0
                    ? f.flavors.some(fl => getAvailableStock(f.id, fl.flavor_name) > 0)
                    : getAvailableStock(f.id) > 0;
                  return matchesCategory && matchesSearch && f.category === cat && hasStock;
                });
                if (catFoods.length === 0) return null;
                return (
                  <div key={cat}>
                    <p className="text-xs text-gray-500 font-semibold mb-2 uppercase tracking-wider">{cat}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {catFoods.map(food => {
                        const hasFlavors = food.flavors && food.flavors.length > 0;
                        const avail = hasFlavors
                          ? food.flavors.some(fl => getAvailableStock(food.id, fl.flavor_name) > 0)
                          : getAvailableStock(food.id) > 0;
                        const inCart = cart.find(i => i.food_id === food.id);
                        const totalCartQty = cart.filter(i => i.food_id === food.id).reduce((s, i) => s + i.quantity, 0);
                        return (
                          <button
                            key={food.id}
                            onClick={() => {
                              if (hasFlavors) {
                                setFlavorModal(food);
                              } else {
                                addToCart(food, null);
                              }
                            }}
                            className="card-elevated p-2 text-left hover:border-gray-500 transition-colors relative"
                            disabled={!avail}
                          >
                            {totalCartQty > 0 && (
                              <span className="absolute top-1 right-1 bg-white text-black text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">{totalCartQty}</span>
                            )}
                            <p className="text-white text-xs font-semibold">{food.name}</p>
                            {hasFlavors ? (
                              <p className="text-gray-400 text-xs">₱{food.price} · {food.flavors.length} flavors</p>
                            ) : (
                              <p className="text-gray-400 text-xs">₱{food.price} · {getAvailableStock(food.id)} left</p>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-4 border-t border-gray-800">
              <button
                onClick={() => setShowFoodModal(false)}
                className="btn-primary w-full py-2"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Flavor Selector Modal */}
      {flavorModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[70] p-4">
          <div className="card w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-black text-white">{flavorModal.name}</h2>
              <button onClick={() => setFlavorModal(null)} className="text-gray-500 hover:text-white text-2xl leading-none">×</button>
            </div>
            <p className="text-xs text-gray-400 mb-4">Select a flavor:</p>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {flavorModal.flavors.map(flavor => {
                const avail = getAvailableStock(flavorModal.id, flavor.flavor_name);
                return (
                  <button
                    key={flavor.flavor_name}
                    onClick={() => {
                      addToCart(flavorModal, flavor.flavor_name);
                      setFlavorModal(null);
                    }}
                    disabled={avail <= 0}
                    className="w-full card px-4 py-3 text-left transition-all duration-150 hover:border-gray-500 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <div className="flex justify-between items-center">
                      <p className="text-white text-sm font-semibold">{flavor.flavor_name}</p>
                      <p className="text-gray-300 text-xs font-semibold">₱{parseFloat(flavor.price).toFixed(2)}</p>
                    </div>
                    <p className="text-gray-500 text-[10px] mt-1">{avail} left</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Receipt Modal */}
      {receipt && (
        <Receipt
          data={receipt}
          onClose={() => setReceipt(null)}
        />
      )}

      {/* Error Modal */}
      {errorModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[80] p-4">
          <div className="card w-full max-w-sm p-6 text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-lg font-black text-white mb-2">Error</h2>
            <p className="text-gray-400 text-sm mb-6">{errorModal}</p>
            <button
              onClick={() => setErrorModal('')}
              className="btn-primary w-full py-2"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* Shortfall / Balance Due Modal */}
      {shortfallModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[80] p-4">
          <div className="card w-full max-w-sm p-6">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-amber-500/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-lg font-black text-white mb-4 text-center">Outstanding Balance</h2>

            <div className="space-y-3 mb-6">
              <div className="flex justify-between items-center py-2 border-b border-gray-800">
                <span className="text-gray-400 text-sm">Total Amount Due</span>
                <span className="text-white font-bold">₱{shortfallModal.total.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-800">
                <span className="text-gray-400 text-sm">Amount Received</span>
                <span className="text-white font-bold">₱{shortfallModal.received.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center py-2 bg-amber-500/10 rounded px-3">
                <span className="text-amber-400 font-semibold text-sm">Remaining Balance</span>
                <span className="text-amber-400 font-black text-lg">₱{shortfallModal.shortfall.toFixed(2)}</span>
              </div>
            </div>

            <p className="text-gray-500 text-xs text-center mb-4">
              Please collect the remaining balance before completing payment.
            </p>

            <button
              onClick={() => setShortfallModal(null)}
              className="btn-primary w-full py-2"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* Reset Table Password Modal - Owner Only */}
      {resetPasswordModal && (
        <ResetPasswordModal
          tableNumber={resetPasswordModal.tableNumber}
          onCancel={() => setResetPasswordModal(null)}
          onConfirm={async (password) => {
            try {
              // Verify owner password through Firestore
              const usersSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'owner')));
              const ownerDoc = usersSnap.docs.find(d => d.data().void_password === password);
              if (!ownerDoc) throw new Error('Invalid password');

              const batch = writeBatch(db);

              // Clear extension history for this table (current customer session ended)
              const extQ = query(collection(db, 'extension_history'), where('table_id', '==', resetPasswordModal.tableId.toString()));
              const extsSnap = await getDocs(extQ);
              extsSnap.forEach(d => {
                batch.delete(d.ref);
              });

              batch.update(doc(db, 'tables', resetPasswordModal.tableId.toString()), {
                status: 'available',
                start_time: null,
                pause_time: null,
                accumulated_seconds: 0,
                cart_items: [],
                set_hours: 0,
                exhibition_bet: 0,
                exhibition_custom_fee: null,
                cost: 0,
                elapsed_seconds: 0
              });

              await batch.commit();

              setSelectedTable(null);
              setExtensionHistory([]);
              setResetPasswordModal(null);
            } catch (err) {
              console.error(err);
              setToast('Invalid password');
              setTimeout(() => setToast(''), 2000);
            }
          }}
        />
      )}

      {/* Food Menu Auth Modal - Owner Only */}
      {foodMenuAuthModal && (
        <FoodMenuAuthModal
          onCancel={() => setFoodMenuAuthModal(false)}
          onConfirm={verifyFoodMenuAccess}
        />
      )}

      {/* Void Item Modal - Owner Only */}
      {voidItemModal && (
        <VoidItemModal
          itemName={voidItemModal.foodName}
          quantity={voidItemModal.quantity}
          onCancel={() => setVoidItemModal(null)}
          onConfirm={voidItemModal.onConfirm}
        />
      )}

      {/* CCTV Placeholder Modal */}
      {cctvModal && (
        <CctvModal
          table={cctvModal}
          onClose={() => setCctvModal(null)}
          onSave={async (settings) => {
            try {
              await updateDoc(doc(db, 'tables', cctvModal.id.toString()), {
                cctv_ip: settings.ip || '',
                cctv_port: settings.port || '554',
                cctv_rtsp: settings.rtspUrl || ''
              });
              return true;
            } catch (err) {
              setErrorModal('Failed to save CCTV settings');
              return false;
            }
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] bg-white text-black px-5 py-2.5 rounded-lg text-sm font-bold shadow-lg animate-fade-in">
          {toast}
        </div>
      )}

    </Layout>
  );
}

// ─── JSMpeg live canvas player ───────────────────────────────────────────────
function CctvPlayer({ tableId, zoom }) {
  const canvasRef = useRef(null);
  const playerRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const wsUrl = `ws://localhost:3001/stream/${tableId}`;

    // Tiny delay so the canvas has fully mounted
    const timer = setTimeout(() => {
      try {
        playerRef.current = new JSMpeg.Player(wsUrl, {
          canvas: canvasRef.current,
          autoplay: true,
          audio: false,
          loop: false,
          // No console output from JSMpeg internals
          onVideoDecode: null,
        });
      } catch (err) {
        // Silently ignore — camera may not be reachable yet
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch (_) { }
        playerRef.current = null;
      }
    };
  }, [tableId]);

  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-black"
      style={{ transform: `scale(${zoom})`, transformOrigin: 'center', transition: 'transform 0.2s' }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full object-contain"
      />
      {/* LIVE badge */}
      <div className="absolute top-3 right-3 bg-black/70 px-2 py-0.5 rounded text-[10px] font-mono text-white flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></span>
        LIVE
      </div>
      {/* Cam label */}
      <div className="absolute bottom-3 left-3 bg-black/70 px-2 py-0.5 rounded text-[10px] font-mono text-gray-300">
        CAM-{String(tableId).padStart(2, '0')}
      </div>
    </div>
  );
}

function CctvModal({ table, onClose, onSave }) {
  const [ip, setIp] = useState(table.cctv_ip || '');
  const [port, setPort] = useState(table.cctv_port || '554');
  const [customRtsp, setCustomRtsp] = useState(table.cctv_rtsp || '');
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [showSettings, setShowSettings] = useState(false); // closed by default, click to open

  // A valid config = custom RTSP alone OR ip+port together
  const isValidConfig = customRtsp.trim() !== '' || (ip.trim() !== '' && port.trim() !== '');

  const handleConnect = async () => {
    setSaveError('');
    setSaved(false);
    setConnecting(true);
    setSaving(true);

    // Save to backend first
    if (onSave) {
      const success = await onSave({ ip: ip.trim(), port: port.trim(), rtspUrl: customRtsp.trim() });
      if (!success) {
        setSaveError('Failed to save settings. Check your connection to the server.');
        setSaving(false);
        setConnecting(false);
        return;
      }
    }

    setSaving(false);
    setSaved(true);

    // Brief "Saved ✓" display, then animate connecting
    setTimeout(() => {
      setSaved(false);
      setTimeout(() => {
        setConnecting(false);
        setConnected(true);
      }, 1500);
    }, 600);
  };

  const rtspUrl = customRtsp.trim() !== '' ? customRtsp.trim() : `rtsp://${ip.trim()}:${port.trim()}/stream`;

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[90] p-4">
      <div className="card w-full max-w-2xl max-h-[95vh] overflow-y-auto flex flex-col p-0">

        {/* Header */}
        <div className="bg-gray-900 border-b border-gray-800 p-4 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-lg font-black text-white leading-tight">Live CCTV Preview</h2>
              <p className="text-xs text-gray-500">Monitoring Table {table.table_number}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white hover:bg-red-500/20 p-2 rounded-lg transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content — single column */}
        <div className="flex flex-col gap-4 p-6">

          {/* Main Feed Area */}
          <div className="flex flex-col gap-3">
            <div className="bg-black border border-gray-800 rounded-xl overflow-hidden aspect-video flex items-center justify-center relative group">

              {!connected ? (
                connecting ? (
                  <div className="text-center">
                    <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-blue-400 text-sm font-semibold tracking-wider uppercase">Connecting to Camera...</p>
                    <p className="text-gray-500 text-xs mt-1 font-mono">{rtspUrl}</p>
                  </div>
                ) : (
                  <div className="text-center p-6 bg-gray-900/50 rounded-lg max-w-sm w-full mx-4 border border-gray-800">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-gray-400 text-sm font-semibold mb-1">Camera Not Connected</p>
                    <p className="text-gray-500 text-xs mb-4">Update connection settings and connect to view the live feed.</p>
                  </div>
                )
              ) : (
                /* ── Real JSMpeg live player ── */
                <div className="absolute inset-0 overflow-hidden bg-black">
                  <CctvPlayer tableId={table.id} zoom={zoom} />

                  {/* Floating zoom controls — visible on hover */}
                  <div className="absolute bottom-4 right-4 bg-black/80 p-1.5 rounded-lg border border-gray-700 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      className="p-1.5 hover:bg-white/10 rounded text-gray-300 hover:text-white disabled:opacity-30"
                      onClick={() => setZoom(z => Math.max(1, +(z - 0.2).toFixed(1)))}
                      disabled={zoom <= 1}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
                      </svg>
                    </button>
                    <button
                      className="p-1.5 hover:bg-white/10 rounded text-gray-300 hover:text-white"
                      onClick={() => setZoom(1)}
                    >
                      <span className="text-[10px] font-bold px-1">{Math.round(zoom * 100)}%</span>
                    </button>
                    <button
                      className="p-1.5 hover:bg-white/10 rounded text-gray-300 hover:text-white disabled:opacity-30"
                      onClick={() => setZoom(z => Math.min(3, +(z + 0.2).toFixed(1)))}
                      disabled={zoom >= 3}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {connected && (
              <div className="mt-4 flex gap-3">
                <button className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-xs font-semibold py-2.5 rounded-lg border border-gray-700 transition flex items-center justify-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Snapshot
                </button>
                <button
                  className="flex-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 text-xs font-semibold py-2.5 rounded-lg border border-red-900/50 transition flex items-center justify-center gap-2"
                  onClick={() => {
                    setConnected(false);
                    setZoom(1);
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Disconnect
                </button>
              </div>
            )}
          </div>

          {/* ── Connection Settings — collapsible accordion ── */}
          <div className="border border-gray-800 rounded-xl overflow-hidden">
            {/* Accordion trigger */}
            <button
              type="button"
              onClick={() => setShowSettings(s => !s)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-900 hover:bg-gray-800 transition-colors"
            >
              <div className="flex items-center gap-3">
                <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 transition-colors ${showSettings ? 'text-blue-400' : 'text-gray-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-sm font-bold text-white">Connection Settings</span>
                {/* Live status pill */}
                <span className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${connected ? 'bg-green-500/15 text-green-400' :
                  connecting ? 'bg-blue-500/15 text-blue-400' :
                    'bg-gray-800 text-gray-500'
                  }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400' : connecting ? 'bg-blue-400 animate-pulse' : 'bg-gray-500'}`}></span>
                  {connected ? 'Online' : connecting ? 'Connecting…' : 'Offline'}
                </span>
              </div>
              {/* Chevron */}
              <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 text-gray-500 transition-transform duration-200 ${showSettings ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Dropdown body */}
            {showSettings && (
              <div className="px-4 pb-4 pt-4 bg-gray-950 border-t border-gray-800 space-y-4">
                {/* IP + Port row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 font-semibold mb-1.5">Camera IP Address</label>
                    <input
                      type="text"
                      className="input w-full font-mono text-sm"
                      value={ip}
                      onChange={e => setIp(e.target.value)}
                      placeholder="192.168.1.100"
                      disabled={connected || connecting}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 font-semibold mb-1.5">Port</label>
                    <input
                      type="text"
                      className="input w-full font-mono text-sm"
                      value={port}
                      onChange={e => setPort(e.target.value)}
                      placeholder="554"
                      disabled={connected || connecting}
                    />
                  </div>
                </div>

                {/* Custom RTSP */}
                <div>
                  <label className="block text-xs text-gray-400 font-semibold mb-1.5">
                    Custom RTSP <span className="text-gray-600 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    className="input w-full font-mono text-xs"
                    value={customRtsp}
                    onChange={e => setCustomRtsp(e.target.value)}
                    placeholder="rtsp://user:pass@192.168.1.x:554/cam/realmonitor"
                    disabled={connected || connecting}
                  />
                  <p className="text-[10px] text-gray-600 mt-1.5 leading-snug">
                    If provided, this overrides the default IP/Port stream URL.
                  </p>
                </div>

                {/* Save error */}
                {saveError && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5 flex items-start gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-[11px] text-red-400 leading-snug font-medium">{saveError}</p>
                  </div>
                )}

                {/* Status + Save & Connect */}
                <div className="border-t border-gray-800 pt-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[10px] text-gray-600 uppercase tracking-wider font-semibold mb-1">Status</p>
                    <div className="flex items-center gap-2 text-sm font-bold">
                      {connected ? (
                        <span className="text-green-400 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_6px_#4ade80]"></span> Online
                        </span>
                      ) : saved ? (
                        <span className="text-green-400 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-green-400"></span> Saved ✓
                        </span>
                      ) : connecting ? (
                        <span className="text-blue-400 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span> Connecting…
                        </span>
                      ) : (
                        <span className="text-gray-500 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-gray-600"></span> Offline
                        </span>
                      )}
                    </div>
                  </div>
                  {!connected && (
                    <button
                      className="btn-primary px-5 py-2.5 text-sm whitespace-nowrap disabled:opacity-50"
                      onClick={handleConnect}
                      disabled={connecting || saving || !isValidConfig}
                    >
                      {saving ? 'Saving…' : connecting ? 'Connecting…' : 'Save & Connect'}
                    </button>
                  )}
                </div>

                {/* Info tip */}
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2.5 flex items-start gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-amber-500/70 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="text-[11px] text-amber-500/70 leading-snug font-medium space-y-1">
                    <p>Ensure this device and the camera are on the <strong>same local network</strong> (LAN/Wi-Fi).</p>
                    <p className="text-gray-600">Use <span className="text-gray-400">IP + Port</span> for basic streams, or paste a full <span className="text-gray-400">RTSP URL</span> to override.</p>
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

// Reset Password Modal Component
function ResetPasswordModal({ tableNumber, onCancel, onConfirm }) {
  const [password, setPassword] = useState('');
  const [verifying, setVerifying] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password) return;
    setVerifying(true);
    await onConfirm(password);
    setVerifying(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[80] p-4">
      <div className="card w-full max-w-sm p-6">
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
          <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h2 className="text-lg font-black text-white mb-2 text-center">Owner Authorization Required</h2>
        <p className="text-gray-400 text-sm mb-6 text-center">
          Reset Table {tableNumber}?<br />
          <span className="text-red-400">This will clear all billing data.</span>
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">Owner Password</label>
            <input
              type="password"
              className="input w-full"
              placeholder="Enter owner password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 btn-outline py-2"
              disabled={verifying}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 btn-primary py-2 bg-red-600 hover:bg-red-700"
              disabled={verifying || !password}
            >
              {verifying ? 'Verifying...' : 'Reset Table'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Food Menu Auth Modal Component
function FoodMenuAuthModal({ onCancel, onConfirm }) {
  const [password, setPassword] = useState('');
  const [verifying, setVerifying] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password) return;
    setVerifying(true);
    try {
      await onConfirm(password);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[70] p-4">
      <div className="card max-w-md w-full p-6">
        <div className="flex items-center justify-center mb-4">
          <div className="w-12 h-12 bg-blue-500/20 rounded-full flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
        </div>
        <h2 className="text-lg font-black text-white mb-2 text-center">Owner Authorization Required</h2>
        <p className="text-gray-400 text-sm mb-6 text-center">
          Enter owner password to access food menu.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">Owner Password</label>
            <input
              type="password"
              className="input w-full"
              placeholder="Enter owner password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 btn-outline py-2"
              disabled={verifying}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 btn-primary py-2"
              disabled={verifying || !password}
            >
              {verifying ? 'Verifying...' : 'Access Food Menu'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Void Item Modal Component
function VoidItemModal({ itemName, quantity, onCancel, onConfirm }) {
  const [password, setPassword] = useState('');
  const [verifying, setVerifying] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password) return;
    setVerifying(true);
    try {
      await onConfirm(password);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[70] p-4">
      <div className="card max-w-md w-full p-6">
        <div className="flex items-center justify-center mb-4">
          <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
        </div>
        <h2 className="text-lg font-black text-white mb-2 text-center">Void Item</h2>
        <p className="text-gray-400 text-sm mb-6 text-center">
          Void {quantity} × {itemName}?<br />
          <span className="text-red-400">This action requires manager authorization.</span>
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">Owner Password</label>
            <input
              type="password"
              className="input w-full"
              placeholder="Enter owner password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 btn-outline py-2"
              disabled={verifying}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 btn-primary py-2 bg-red-600 hover:bg-red-700"
              disabled={verifying || !password}
            >
              {verifying ? 'Verifying...' : 'Void Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}



