import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import TableCard from '../components/TableCard';
import Receipt from '../components/Receipt';
import axios from 'axios';
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
  const { token, user } = useAuth();
  const [tables, setTables] = useState([]);
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

  // Save cart to server (debounced)
  const saveCartToServer = useCallback(async (tableId, items) => {
    try {
      await axios.put(`/api/tables/${tableId}/cart`, { cart_items: items }, h);
      fetchFoods(); // refresh stock display
    } catch (err) {
      console.error('Failed to save cart:', err);
    }
  }, [token]);

  // Current cart for selected table
  const cart = selectedTable ? (tableCarts[selectedTable.id] || []) : [];
  const setCart = (itemsOrFn) => {
    if (!selectedTable) return;
    setTableCarts(prev => {
      const current = prev[selectedTable.id] || [];
      const next = typeof itemsOrFn === 'function' ? itemsOrFn(current) : itemsOrFn;
      saveCartToServer(selectedTable.id, next);
      return { ...prev, [selectedTable.id]: next };
    });
  };

  const h = { headers: { Authorization: `Bearer ${token}` } };

  const fetchTables = useCallback(async () => {
    try {
      const res = await axios.get('/api/tables', h);
      setTables(res.data);
      // Sync cart_items from server into tableCarts
      setTableCarts(prev => {
        const next = { ...prev };
        for (const t of res.data) {
          if (t.cart_items && t.cart_items.length > 0) {
            next[t.id] = t.cart_items;
          }
        }
        return next;
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const fetchFoods = useCallback(async () => {
    try {
      const res = await axios.get('/api/foods', h);
      setFoods(res.data.filter(f => f.status === 'available'));
    } catch (err) {
      console.error(err);
    }
  }, [token]);

  useEffect(() => {
    fetchTables();
    fetchFoods();
    const interval = setInterval(fetchTables, 10000);
    const foodInterval = setInterval(fetchFoods, 10000);
    const tickInterval = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(interval); clearInterval(foodInterval); clearInterval(tickInterval); };
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
  const doAction = async (action, extraBody) => {
    setBusy(true);
    try {
      const res = await axios.post(`/api/tables/${selectedTable.id}/${action}`, extraBody || {}, h);
      if (action === 'stop') {
        setPayModal(res.data);
      } else {
        fetchTables();
        // Refresh selected table data
        const updated = await axios.get(`/api/tables/${selectedTable.id}`, h);
        setSelectedTable(updated.data);
      }
    } catch (err) {
      setErrorModal(err.response?.data?.error || `Failed to ${action}`);
    } finally {
      setBusy(false);
    }
  };

  const handleStart = () => {
    const hours = parseFloat(startHours) || 0;
    doAction('start', { hours });
    setStartHours('');
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
      // Set table to exhibition status
      const exhibitionPayload = { bet_amount: betAmount };
      if (useCustomFee && exhibitionCustomFee && parseFloat(exhibitionCustomFee) > 0) {
        exhibitionPayload.custom_fee = parseFloat(exhibitionCustomFee);
      }
      await axios.post(`/api/tables/${selectedTable.id}/exhibition`, exhibitionPayload, h);
      
      // Refresh table data
      const updated = await axios.get(`/api/tables/${selectedTable.id}`, h);
      setSelectedTable(updated.data);
      fetchTables();
      
      // Set up payment modal for exhibition match
      setPayModal({
        elapsed_seconds: 0,
        cost: tableFee,
        start_time: null,
        end_time: new Date().toISOString(),
        isExhibition: true,
        betAmount: betAmount,
        isCustomFee: useCustomFee && exhibitionCustomFee && parseFloat(exhibitionCustomFee) > 0,
      });
    } catch (err) {
      setErrorModal(err.response?.data?.error || 'Failed to start exhibition match');
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
      // Create sale for exhibition match
      const salePayload = {
        table_number: selectedTable.table_number,
        start_time: null,
        end_time: new Date().toISOString(),
        table_cost: tableFee,
        food_items: cart,
        set_hours: 0,
        category: 'exhibition',
        details: `Exhibition Match (₱${betAmount.toLocaleString('en-PH')})`,
      };
      
      const res = await axios.post('/api/sales', salePayload, h);
      
      // Reset table after payment
      await axios.post(`/api/tables/${selectedTable.id}/reset`, {}, h);
      
      const foodTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
      const grandTotal = tableFee + foodTotal;
      const change = parseFloat(received) - grandTotal;
      
      // Show receipt
      setReceipt({
        ...res.data,
        table_number: selectedTable.table_number,
        table_cost: tableFee,
        food_items: cart,
        food_total: foodTotal,
        total: grandTotal,
        received: parseFloat(received),
        change: change,
        cashier: user.name,
        category: 'exhibition',
        details: `Exhibition Match (₱${betAmount.toLocaleString('en-PH')})`,
      });
      
      // Cleanup
      setSelectedTable(null);
      setPayModal(null);
      setExhibitionBet('');
      setExhibitionCustomFee('');
      setUseCustomFee(false);
      setTableCarts(prev => { const next = { ...prev }; delete next[selectedTable.id]; return next; });
      fetchTables();
    } catch (err) {
      setErrorModal(err.response?.data?.error || 'Payment failed');
    } finally {
      setPaying(false);
    }
  };

  const handleCardClick = (table) => {
    setSelectedTable(table);
    setReceived('');
    setPayModal(null);
    setEditingRunningFee(false);
    setRunningCustomFee('');
  };

  // Compute available stock = db_stock - cart qty across ALL tables
  const getAvailableStock = (foodId, flavorName) => {
    const food = foods.find(f => f.id === foodId);
    if (!food) return 0;
    
    // If food has flavors and a specific flavor is requested, check per-flavor stock
    if (food.flavors && food.flavors.length > 0 && flavorName) {
      const flavor = food.flavors.find(f => f.flavor_name === flavorName);
      if (!flavor) return 0;
      const inCarts = tables.reduce((sum, t) => {
        const items = t.cart_items || [];
        const found = items.find(i => i.food_id === foodId && i.flavor_name === flavorName);
        return sum + (found ? found.quantity : 0);
      }, 0);
      return flavor.stock - inCarts;
    }
    
    const inCarts = tables.reduce((sum, t) => {
      const items = t.cart_items || [];
      const found = items.find(i => i.food_id === foodId);
      return sum + (found ? found.quantity : 0);
    }, 0);
    return food.stock - inCarts;
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

  const removeFromCart = (foodId, flavorName) => {
    setCart(prev => prev.filter(i => 
      flavorName ? !(i.food_id === foodId && i.flavor_name === flavorName) : i.food_id !== foodId
    ));
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
      const salePayload = {
        table_number: selectedTable.table_number,
        start_time: payModal.start_time || selectedTable.start_time || null,
        end_time: payModal.end_time,
        table_cost: tableCost,
        food_items: cart,
        set_hours: selectedTable.set_hours || 0,
      };
      const res = await axios.post('/api/sales', salePayload, h);

      // Reset table after payment
      await axios.post(`/api/tables/${selectedTable.id}/reset`, {}, h);

      const change = parseFloat(received) - grandTotal;

      // Show receipt
      setReceipt({
        ...res.data,
        table_number: selectedTable.table_number,
        table_cost: tableCost,
        food_total: foodTotal,
        total: grandTotal,
        received: parseFloat(received),
        change,
      });

      // Cleanup
      setSelectedTable(null);
      setPayModal(null);
      setTableCarts(prev => { const next = { ...prev }; delete next[selectedTable.id]; return next; });
      fetchTables();
    } catch (err) {
      setErrorModal(err.response?.data?.error || 'Payment failed');
    } finally {
      setPaying(false);
    }
  };

  // Auto-stop expired prepaid tables
  useEffect(() => {
    const alreadyAlarmed = new Set(alarms.map(a => a.tableId));
    const expiredTables = tables.filter(t =>
      t.status === 'running' && t.set_hours > 0 &&
      t.elapsed_seconds >= Math.round(t.set_hours * 3600)
    );
    const newExpired = expiredTables.filter(t => !alreadyAlarmed.has(t.id));

    newExpired.forEach(async (t) => {
      try {
        // Auto-stop the table
        const res = await axios.post(`/api/tables/${t.id}/stop`, {}, h);
        // Add to alarms for Time's Up modal
        setAlarms(prev => {
          if (prev.some(a => a.tableId === t.id)) return prev;
          return [...prev, {
            tableId: t.id,
            tableNumber: t.table_number,
            cost: t.set_hours * 200,
            start_time: res.data.start_time,
            end_time: res.data.end_time,
          }];
        });
        fetchTables();
      } catch (err) {
        console.error('Auto-stop failed for table', t.table_number, err);
      }
    });
  }, [now, tables]);

  const dismissAlarm = (tableId) => {
    setAlarms(prev => prev.filter(a => a.tableId !== tableId));
  };

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
          <button className="btn-outline text-xs" onClick={fetchTables}>↻ Refresh</button>
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {tables.map(table => (
              <TableCard
                key={table.id}
                table={table}
                onClick={handleCardClick}
              />
            ))}
          </div>
        )}
      </div>

      {/* Table Detail Modal */}
      {selectedTable && !payModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-black text-white">Table {selectedTable.table_number}</h2>
              <button onClick={() => setSelectedTable(null)} className="text-gray-500 hover:text-white text-2xl leading-none">×</button>
            </div>

            {/* AVAILABLE: Start with hours */}
            {isAvailable && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-400 uppercase tracking-wider font-semibold mb-3">Select Duration</label>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {[
                      { label: '30 min', hours: 0.5, cost: 100 },
                      { label: '1 hr', hours: 1, cost: 200 },
                      { label: '1.5 hr', hours: 1.5, cost: 300 },
                      { label: '2 hr', hours: 2, cost: 400 },
                      { label: '3 hr', hours: 3, cost: 600 },
                      { label: '5 hr', hours: 5, cost: 1000 },
                    ].map(opt => (
                      <button
                        key={opt.hours}
                        className={`p-2 rounded-lg border-2 text-center transition-all ${
                          startHours === String(opt.hours)
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
                      value={startHours && ![0.5,1,1.5,2,3,5].includes(parseFloat(startHours)) ? startHours : ''}
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
                      } · ₱{(parseFloat(startHours) * 200).toFixed(2)}
                    </p>
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
                          onClick={handleExhibitionMatch}
                          disabled={busy || !exhibitionBet || parseFloat(exhibitionBet) <= 0}
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
                {/* Live Timer */}
                <div className={`rounded-lg p-4 text-center font-mono ${
                  selectedTable.set_hours > 0 && localElapsed >= selectedTable.set_hours * 3600
                    ? 'bg-red-600 text-white' : 'bg-white text-black'
                }`}>
                  {selectedTable.set_hours > 0 ? (
                    <>
                      <div className="text-3xl font-black tracking-widest">
                        {formatTime(Math.max(0, Math.round(selectedTable.set_hours * 3600 - localElapsed)))}
                      </div>
                      <div className="text-sm mt-1 font-semibold">
                        {localElapsed >= selectedTable.set_hours * 3600
                          ? "TIME'S UP!" : 'remaining'}
                      </div>
                      <div className="text-xs mt-1 opacity-70">
                        Elapsed: {formatTime(localElapsed)} · ₱{(localElapsed / 3600 * 200).toFixed(2)}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-3xl font-black tracking-widest">{formatTime(localElapsed)}</div>
                      <div className="text-sm mt-1 font-semibold">₱{(localElapsed / 3600 * 200).toFixed(2)}</div>
                    </>
                  )}
                </div>

                {/* Start time */}
                {selectedTable.start_time && (
                  <p className="text-xs text-gray-500 text-center">Started: {formatStartTime(selectedTable.start_time)}</p>
                )}

                {/* Extend Hours */}
                <div className="card-elevated p-3">
                  <label className="block text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Extend Hours</label>
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
                        <div key={`${item.food_id}-${item.flavor_name || 'none'}-${idx}`} className="flex items-center justify-between text-sm">
                          <span className="text-white flex-1">{item.food_name}</span>
                          <div className="flex items-center gap-2">
                            <button onClick={() => adjustQty(item.food_id, -1, item.flavor_name)} className="text-gray-400 hover:text-white w-6 h-6 flex items-center justify-center border border-gray-700 rounded">−</button>
                            <span className="text-white w-5 text-center">{item.quantity}</span>
                            <button onClick={() => adjustQty(item.food_id, 1, item.flavor_name)} className="text-gray-400 hover:text-white w-6 h-6 flex items-center justify-center border border-gray-700 rounded">+</button>
                            <button onClick={() => removeFromCart(item.food_id, item.flavor_name)} className="text-gray-600 hover:text-white ml-1">×</button>
                            <span className="text-white font-semibold w-16 text-right">₱{(item.price * item.quantity).toFixed(2)}</span>
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
                    onClick={() => doAction('stop')}
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
                <div className="bg-gray-900 text-gray-400 rounded-lg p-4 text-center font-mono">
                  <div className="text-3xl font-black tracking-widest">{formatTime(selectedTable.elapsed_seconds)}</div>
                  <div className="text-sm mt-1 font-semibold">₱{selectedTable.cost?.toFixed(2)}</div>
                </div>

                {selectedTable.start_time && (
                  <p className="text-xs text-gray-500 text-center">Started: {formatStartTime(selectedTable.start_time)}</p>
                )}

                {/* Extend Hours */}
                <div className="card-elevated p-3">
                  <label className="block text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Extend Hours</label>
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

                {/* Food Menu Button */}
                <button
                  onClick={() => setShowFoodModal(true)}
                  className="btn-outline w-full py-2 text-sm flex items-center justify-center gap-2"
                >
                  + Open Food Menu
                </button>

                {cart.length > 0 && (
                  <div className="card-elevated p-3">
                    <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">Cart</p>
                    <div className="space-y-2">
                      {cart.map((item, idx) => (
                        <div key={`${item.food_id}-${item.flavor_name || 'none'}-${idx}`} className="flex items-center justify-between text-sm">
                          <span className="text-white flex-1">{item.food_name}</span>
                          <div className="flex items-center gap-2">
                            <button onClick={() => adjustQty(item.food_id, -1, item.flavor_name)} className="text-gray-400 hover:text-white w-6 h-6 flex items-center justify-center border border-gray-700 rounded">−</button>
                            <span className="text-white w-5 text-center">{item.quantity}</span>
                            <button onClick={() => adjustQty(item.food_id, 1, item.flavor_name)} className="text-gray-400 hover:text-white w-6 h-6 flex items-center justify-center border border-gray-700 rounded">+</button>
                            <button onClick={() => removeFromCart(item.food_id, item.flavor_name)} className="text-gray-600 hover:text-white ml-1">×</button>
                            <span className="text-white font-semibold w-16 text-right">₱{(item.price * item.quantity).toFixed(2)}</span>
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
                    onClick={() => doAction('stop')}
                    disabled={busy}
                  >
                    ⏹ Stop & Pay
                  </button>
                </div>
              </div>
            )}

            {/* FINISHED: Pay or Reset */}
            {isFinished && (
              <div className="space-y-4">
                <div className="bg-gray-900 text-gray-300 rounded-lg p-4 text-center font-mono">
                  <div className="text-3xl font-black tracking-widest">{formatTime(selectedTable.elapsed_seconds)}</div>
                  <div className="text-sm mt-1 font-semibold">₱{selectedTable.cost?.toFixed(2)}</div>
                </div>
                <button
                  className="btn-primary w-full py-3"
                  onClick={() => {
                    setPayModal({
                      elapsed_seconds: selectedTable.elapsed_seconds,
                      cost: selectedTable.cost,
                      start_time: selectedTable.start_time,
                      end_time: new Date().toISOString(),
                    });
                  }}
                >
                  Pay Now
                </button>
                <button
                  className="btn-outline w-full py-2"
                  onClick={() => { doAction('reset'); setSelectedTable(null); }}
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
                  <div className="text-black text-2xl font-black">₱{selectedTable.exhibition_bet?.toLocaleString('en-PH') || 0}</div>
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
                            await axios.post(`/api/tables/${selectedTable.id}/exhibition-fee`, { custom_fee: fee }, h);
                            const updated = await axios.get(`/api/tables/${selectedTable.id}`, h);
                            setSelectedTable(updated.data);
                            setEditingRunningFee(false);
                          } catch (err) {
                            setErrorModal(err.response?.data?.error || 'Failed to update fee');
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
                    });
                  }}
                >
                  Pay Now
                </button>
                <button
                  className="btn-outline w-full py-2"
                  onClick={() => { doAction('reset'); setSelectedTable(null); }}
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
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-black text-white">Table {selectedTable.table_number} — Checkout</h2>
              <button onClick={() => setPayModal(null)} className="text-gray-500 hover:text-white text-2xl leading-none">×</button>
            </div>

            {/* Table Cost / Exhibition Match */}
            <div className="card-elevated p-4 mb-4">
              {payModal.isExhibition ? (
                <>
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
                </>
              ) : (
                <>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-gray-400 text-sm">Time Used</span>
                    <span className="text-white font-mono">
                      {Math.floor(payModal.elapsed_seconds / 3600)}h{' '}
                      {Math.floor((payModal.elapsed_seconds % 3600) / 60)}m{' '}
                      {payModal.elapsed_seconds % 60}s
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400 text-sm">Table Cost</span>
                    <span className="text-white font-bold text-lg">₱{tableCost.toFixed(2)}</span>
                  </div>
                </>
              )}
            </div>

            {/* Add Food Button */}
            <div className="mb-4">
              <button
                onClick={() => setShowFoodModal(true)}
                className="btn-outline w-full py-2 text-sm flex items-center justify-center gap-2"
              >
                + Open Food Menu
              </button>
            </div>

            {/* Cart */}
            {cart.length > 0 && (
              <div className="card-elevated p-3 mb-4">
                <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">Cart</p>
                <div className="space-y-2">
                  {cart.map((item, idx) => (
                    <div key={`${item.food_id}-${item.flavor_name || 'none'}-${idx}`} className="flex items-center justify-between text-sm">
                      <span className="text-white flex-1">{item.food_name}</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => adjustQty(item.food_id, -1, item.flavor_name)} className="text-gray-400 hover:text-white w-6 h-6 flex items-center justify-center border border-gray-700 rounded">−</button>
                        <span className="text-white w-5 text-center">{item.quantity}</span>
                        <button onClick={() => adjustQty(item.food_id, 1, item.flavor_name)} className="text-gray-400 hover:text-white w-6 h-6 flex items-center justify-center border border-gray-700 rounded">+</button>
                        <button onClick={() => removeFromCart(item.food_id, item.flavor_name)} className="text-gray-600 hover:text-white ml-1">×</button>
                        <span className="text-white font-semibold w-16 text-right">₱{(item.price * item.quantity).toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Totals */}
            <div className="border-t border-gray-800 pt-4 mb-4 space-y-1">
              {cart.length > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Food Total</span>
                  <span className="text-white">₱{foodTotal.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Table Cost</span>
                <span className="text-white">₱{tableCost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-black text-lg border-t border-gray-800 pt-2 mt-2">
                <span className="text-white">TOTAL</span>
                <span className="text-white">₱{grandTotal.toFixed(2)}</span>
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
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4">
          <div className="card w-full max-w-4xl max-h-[85vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">Food Menu</h2>
              <button onClick={() => setShowFoodModal(false)} className="text-gray-500 hover:text-white text-2xl leading-none">×</button>
            </div>

            {/* Search and Filter */}
            <div className="mb-4 space-y-3">
              <div className="flex gap-2">
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
                  className="input max-w-[180px]"
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
                  return matchesCategory && matchesSearch && f.category === cat;
                });
                if (catFoods.length === 0) return null;
                return (
                  <div key={cat}>
                    <p className="text-xs text-gray-500 font-semibold mb-2 uppercase tracking-wider">{cat}</p>
                    <div className="grid grid-cols-3 gap-2">
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
    </Layout>
  );
}
