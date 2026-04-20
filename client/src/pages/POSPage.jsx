import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import Receipt from '../components/Receipt';
import { collection, doc, updateDoc, writeBatch, increment, onSnapshot, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
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

export default function POSPage() {
  const { token, user } = useAuth();
  const [foods, setFoods] = useState([]);
  const [tables, setTables] = useState([]);
  const [selectedTableId, setSelectedTableId] = useState(''); // '' = walk-in
  const [cart, setCart] = useState([]);
  const [received, setReceived] = useState('');
  const [loading, setLoading] = useState(true);
  const [receipt, setReceipt] = useState(null);
  const [paying, setPaying] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [flavorModal, setFlavorModal] = useState(null); // food object when flavor selector is open
  const [errorModal, setErrorModal] = useState(''); // error message for styled modal
  const [voidItemModal, setVoidItemModal] = useState(null); // { foodId, flavorName, foodName, quantity, onConfirm }
  const [paymentMode, setPaymentMode] = useState('Cash'); // payment method
  const [toast, setToast] = useState(''); // success/error message toast

  useEffect(() => {
    const unsubFoods = onSnapshot(collection(db, 'foods'), (snap) => {
      setFoods(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => console.error(err));

    const unsubTables = onSnapshot(collection(db, 'tables'), (snap) => {
      const tb = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTables(tb.sort((a,b) => a.table_number - b.table_number));
      setLoading(false);
    }, (err) => console.error(err));

    return () => {
      unsubFoods();
      unsubTables();
    };
  }, []);

  // Load cart from table or localStorage when selecting
  useEffect(() => {
    if (selectedTableId) {
      const table = tables.find(t => t.id === parseInt(selectedTableId));
      if (table && table.cart_items) {
        setCart(table.cart_items);
      } else {
        setCart([]);
      }
    } else {
      // Walk-in: load from localStorage (survives restart)
      const saved = localStorage.getItem('pos_walkin_cart');
      if (saved) {
        try {
          setCart(JSON.parse(saved));
        } catch {
          setCart([]);
        }
      } else {
        setCart([]);
      }
    }
    setReceived('');
  }, [selectedTableId]);

  // Save cart to server (tables) or localStorage (walk-in)
  const saveCartToServer = async (tableId, items) => {
    if (tableId) {
      try {
        await updateDoc(doc(db, 'tables', tableId.toString()), { cart_items: items });
      } catch (err) {
        console.error('Failed to save cart:', err);
      }
    } else {
      // Walk-in: persist to localStorage
      localStorage.setItem('pos_walkin_cart', JSON.stringify(items));
    }
  };

  // Compute available stock = db_stock - cart qty across ALL tables (excluding selected) - current POS cart
  const getAvailableStock = (foodId, flavorName) => {
    const food = foods.find(f => f.id === foodId);
    if (!food) return 0;
    
    // If food has flavors and a specific flavor is requested, check per-flavor stock
    if (food.flavors && food.flavors.length > 0 && flavorName) {
      const flavor = food.flavors.find(f => f.flavor_name === flavorName);
      if (!flavor) return 0;
      const inOtherTableCarts = tables.reduce((sum, t) => {
        if (selectedTableId && t.id === parseInt(selectedTableId)) return sum;
        const items = t.cart_items || [];
        const found = items.find(i => i.food_id === foodId && i.flavor_name === flavorName);
        return sum + (found ? found.quantity : 0);
      }, 0);
      const inPosCart = cart.find(i => i.food_id === foodId && i.flavor_name === flavorName)?.quantity || 0;
      return (flavor.available ?? flavor.stock) - inOtherTableCarts - inPosCart;
    }
    
    // No flavors - use total stock
    const inOtherTableCarts = tables.reduce((sum, t) => {
      if (selectedTableId && t.id === parseInt(selectedTableId)) return sum;
      const items = t.cart_items || [];
      const found = items.find(i => i.food_id === foodId);
      return sum + (found ? found.quantity : 0);
    }, 0);
    const inPosCart = cart.find(i => i.food_id === foodId)?.quantity || 0;
    return food.stock - inOtherTableCarts - inPosCart;
  };

  const availableFoods = foods.filter(f =>
    f.status === 'available' &&
    (f.flavors && f.flavors.length > 0
      ? f.flavors.some(fl => getAvailableStock(f.id, fl.flavor_name) > 0)
      : getAvailableStock(f.id) > 0) &&
    f.name.toLowerCase().includes(search.toLowerCase()) &&
    (!categoryFilter || f.category === categoryFilter)
  );

  const handleFoodClick = (food) => {
    // If food has flavors, show flavor selector
    if (food.flavors && food.flavors.length > 0) {
      setFlavorModal(food);
      return;
    }
    addToCart(food, null);
  };

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
      let next;
      if (existing) {
        next = prev.map(i => 
          (flavorName ? (i.food_id === food.id && i.flavor_name === flavorName) : (i.food_id === food.id && !i.flavor_name))
            ? { ...i, quantity: i.quantity + 1 } : i
        );
      } else {
        const flavor = flavorName ? food.flavors?.find(f => f.flavor_name === flavorName) : null;
        const itemPrice = flavor ? flavor.price : food.price;
        next = [...prev, { 
          food_id: food.id, 
          food_name: flavorName ? `${food.name} - ${flavorName}` : food.name, 
          price: itemPrice, 
          quantity: 1,
          flavor_name: flavorName || null,
        }];
      }
      saveCartToServer(selectedTableId ? parseInt(selectedTableId) : null, next);
      return next;
    });
  };

  const removeFromCart = (foodId, flavorName) => {
    setCart(prev => {
      const next = prev.filter(i => 
        flavorName ? !(i.food_id === foodId && i.flavor_name === flavorName) : i.food_id !== foodId
      );
      saveCartToServer(selectedTableId ? parseInt(selectedTableId) : null, next);
      return next;
    });
  };

  // Handle quantity decrease — void auth required when removing last item (any role)
  const handleDecreaseQty = (foodId, flavorName) => {
    const item = cart.find(i =>
      flavorName ? (i.food_id === foodId && i.flavor_name === flavorName) : i.food_id === foodId
    );
    if (!item) return;

    if (item.quantity === 1) {
      // Removing the last piece = void → owner password always required
      setVoidItemModal({
        foodId,
        flavorName,
        foodName: item.food_name,
        quantity: 1,
        onConfirm: (password) => confirmVoidAndRemove(foodId, flavorName, password),
      });
    } else {
      adjustQty(foodId, -1, flavorName);
    }
  };

  // Verify owner password and remove the item
  const confirmVoidAndRemove = async (foodId, flavorName, password) => {
    try {
      // Check void password from Firestore users collection
      const usersSnap = await getDocs(collection(db, 'users'));
      const ownerDoc = usersSnap.docs.find(d => d.data().role === 'owner' && d.data().void_password === password);
      
      if (!ownerDoc) {
        setVoidItemModal(null);
        setErrorModal('Incorrect owner password');
        return;
      }
      
      setCart(prev => {
        const next = prev.filter(i =>
          flavorName ? !(i.food_id === foodId && i.flavor_name === flavorName) : i.food_id !== foodId
        );
        saveCartToServer(selectedTableId ? parseInt(selectedTableId) : null, next);
        return next;
      });
      setVoidItemModal(null);
    } catch (err) {
      console.error(err);
      setErrorModal('Failed to remove item');
    }
  };

  const adjustQty = (foodId, delta, flavorName) => {
    setCart(prev => {
      const next = prev.map(i => {
        if (flavorName ? !(i.food_id === foodId && i.flavor_name === flavorName) : i.food_id !== foodId) return i;
        const newQty = i.quantity + delta;
        const avail = getAvailableStock(foodId, flavorName) - i.quantity;
        if (delta > 0 && avail <= 0) { setErrorModal(`No more stock available.`); return i; }
        return newQty <= 0 ? null : { ...i, quantity: newQty };
      }).filter(Boolean);
      saveCartToServer(selectedTableId ? parseInt(selectedTableId) : null, next);
      return next;
    });
  };

  const foodTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const change = parseFloat(received || 0) - foodTotal;

  const selectedTable = tables.find(t => t.id === parseInt(selectedTableId));
  const tableCost = selectedTable ? parseFloat(selectedTable.cost || 0) : 0;
  const grandTotal = selectedTableId ? tableCost + foodTotal : foodTotal;

  const handleCheckout = async () => {
    if (cart.length === 0 && !selectedTableId) { setErrorModal('Cart is empty.'); return; }
    if (!received || parseFloat(received) < grandTotal) { setErrorModal('Amount received is not enough.'); return; }

    setPaying(true);
    try {
      const batch = writeBatch(db);
      const now = new Date().toISOString();

      const foodTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const salePayload = {
        table_number: selectedTable ? selectedTable.table_number : null,
        start_time: selectedTable?.start_time || null,
        end_time: now,
        table_cost: tableCost,
        food_total: foodTotal,
        food_items: cart,
        total: grandTotal,
        received: parseFloat(received) || 0,
        payment_mode: paymentMode,
        category: selectedTableId ? 'table' : 'takeout',
        cashier: user.name,
        created_at: now
      };

      const saleRef = doc(collection(db, 'sales'));
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

      // If table order, reset the table
      if (selectedTableId) {
        batch.update(doc(db, 'tables', selectedTableId.toString()), {
          status: 'available',
          start_time: null,
          end_time: null,
          elapsed_seconds: 0,
          cost: 0,
          accumulated_seconds: 0,
          set_hours: 0,
          cart_items: [],
          custom_fee: null
        });
      }

      await batch.commit();

      setReceipt({
        id: saleRef.id,
        table_number: selectedTable ? selectedTable.table_number : null,
        table_cost: tableCost,
        food_items: cart,
        food_total: foodTotal,
        total: grandTotal,
        received: parseFloat(received),
        change: parseFloat(received) - grandTotal,
        cashier: user.name,
        payment_mode: paymentMode,
        created_at: now
      });

      setCart([]);
      setReceived('');
      setSelectedTableId('');
      setPaymentMode('Cash');
      
      // Clear walk-in cart from localStorage after payment
      if (!selectedTableId) {
        localStorage.removeItem('pos_walkin_cart');
      }
    } catch (err) {
      console.error(err);
      setErrorModal('Checkout failed: ' + err.message);
    } finally {
      setPaying(false);
    }
  };

  const activeTables = tables.filter(t => t.status === 'running' || t.status === 'paused' || t.status === 'finished');

  return (
    <Layout fullWidth>
      <div className="page-enter">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-sm font-black text-white">Point of Sale</h1>
            <p className="text-gray-500 text-xs mt-0.5">Food &amp; beverage sales</p>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-4" style={{ height: 'calc(100vh - 140px)' }}>
          {/* Food Grid */}
          <div className="flex-1 flex flex-col min-h-0">
            {/* Search + Category Dropdown - Fixed */}
            <div className="flex gap-3 mb-4 flex-shrink-0">
              <input
                type="text"
                className="input"
                style={{ flex: 1 }}
                placeholder="Search food items..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <select
                className="input"
                style={{ width: '220px' }}
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value)}
              >
                <option value="">All Categories</option>
                <optgroup label="Food">
                  {FOOD_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </optgroup>
                <optgroup label="Drinks">
                  {DRINK_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div className="card border border-gray-800 flex-1 flex flex-col overflow-hidden min-h-0">
              {loading ? (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-gray-500 text-sm">Loading menu...</p>
                </div>
              ) : availableFoods.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-gray-600 text-sm">No available items.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2 content-start overflow-y-auto flex-1 p-3">
                  {availableFoods.map(food => (
                      <button
                        key={food.id}
                        id={`food-${food.id}`}
                        onClick={() => handleFoodClick(food)}
                        className="card px-3 py-2.5 text-left transition-all duration-150 hover:border-gray-500 cursor-pointer"
                      >
                        <p className="text-gray-500 text-[10px] mb-0.5 truncate">{food.category}</p>
                        <p className="text-white font-bold text-xs truncate">{food.name}</p>
                        {food.flavors && food.flavors.length > 0 ? (
                          <div className="flex items-center justify-between mt-1">
                            <p className="text-gray-300 text-xs font-semibold">₱{parseFloat(food.price).toFixed(2)}</p>
                            <p className="text-gray-600 text-[10px]">{food.flavors.length} flavors</p>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between mt-1">
                            <p className="text-gray-300 text-xs font-semibold">₱{parseFloat(food.price).toFixed(2)}</p>
                            <p className="text-gray-600 text-[10px]">{getAvailableStock(food.id)} left</p>
                          </div>
                        )}
                      </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Cart */}
          <div className="w-full lg:w-80 xl:w-96 flex flex-col lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-140px)]">
            <div className="card p-4 flex-1 flex flex-col overflow-hidden">
              {/* Cart Header */}
              <div className="flex-shrink-0 border-b border-gray-800 pb-3 mb-2">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-black text-white uppercase tracking-wider">
                    {selectedTableId ? `Table ${selectedTable?.table_number}` : 'Cart'}
                  </h2>
                  {cart.length > 0 && (
                    <span className="text-xs text-gray-500">{cart.reduce((s, i) => s + i.quantity, 0)} items</span>
                  )}
                </div>
                <select
                  className="input text-xs"
                  value={selectedTableId}
                  onChange={e => setSelectedTableId(e.target.value)}
                >
                  <option value="">Walk-in Customer</option>
                  {activeTables.map(t => (
                    <option key={t.id} value={t.id}>
                      Table {t.table_number} ({t.status})
                    </option>
                  ))}
                </select>
              </div>

              {cart.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-gray-600 text-sm text-center">No items added yet.<br />Click food to add.</p>
                </div>
              ) : (
                <div className="flex-1 space-y-3 overflow-y-auto mb-4 min-h-0">
                  {cart.map((item, idx) => (
                    <div key={`${item.food_id}-${item.flavor_name || 'none'}-${idx}`} className="border-b border-gray-800 pb-3">
                      <div className="flex justify-between items-start mb-1">
                        <p className="text-white text-sm font-medium flex-1 mr-2">{item.food_name}</p>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleDecreaseQty(item.food_id, item.flavor_name)}
                            className="w-7 h-7 border border-gray-700 rounded text-gray-400 hover:text-white hover:border-gray-500 flex items-center justify-center"
                            title={item.quantity === 1 ? 'Void item (Owner only)' : 'Decrease quantity'}
                          >−</button>
                          <span className="text-white font-bold w-6 text-center">{item.quantity}</span>
                          <button
                            onClick={() => adjustQty(item.food_id, 1, item.flavor_name)}
                            className="w-7 h-7 border border-gray-700 rounded text-gray-400 hover:text-white hover:border-gray-500 flex items-center justify-center"
                          >+</button>
                        </div>
                        <span className="text-white font-bold text-sm mr-5">₱{(item.price * item.quantity).toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Totals + Checkout */}
              {cart.length > 0 && (
                <>
                  <div className="border-t border-gray-800 pt-4 mb-4 flex-shrink-0">
                    {selectedTableId && (
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-400">Table Cost</span>
                        <span className="text-white">₱{tableCost.toFixed(2)}</span>
                      </div>
                    )}
                    {selectedTableId && cart.length > 0 && (
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-400">Food Total</span>
                        <span className="text-white">₱{foodTotal.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-black text-lg mb-3">
                      <span className="text-white">TOTAL</span>
                      <span className="text-white">₱{grandTotal.toFixed(2)}</span>
                    </div>

                    {/* Payment Mode */}
                    <label className="block text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">
                      Payment Mode
                    </label>
                    <div className="flex gap-2 mb-3">
                      {/* Cash */}
                      <button
                        type="button"
                        onClick={() => setPaymentMode('Cash')}
                        className={`flex-1 p-2 rounded-lg border-2 text-xs font-bold transition-all ${
                          paymentMode === 'Cash'
                            ? 'border-blue-500 bg-blue-500 text-white'
                            : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white'
                        }`}
                      >Cash</button>
                      {/* GCash */}
                      <button
                        type="button"
                        onClick={() => setPaymentMode('GCash')}
                        className={`flex-1 p-2 rounded-lg border-2 text-xs font-bold transition-all ${
                          paymentMode === 'GCash'
                            ? 'border-blue-500 bg-blue-500 text-white'
                            : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white'
                        }`}
                      >GCash</button>
                    </div>

                    <label className="block text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">
                      Amount Received
                    </label>
                    <input
                      id="pos-received"
                      type="number"
                      className="input text-lg font-bold mb-2"
                      placeholder="0.00"
                      value={received}
                      onChange={e => setReceived(e.target.value)}
                    />
                    {received && parseFloat(received) >= grandTotal && (
                      <p className="text-sm text-gray-400">
                        Change: <span className="text-white font-bold">₱{(parseFloat(received) - grandTotal).toFixed(2)}</span>
                      </p>
                    )}
                  </div>
                  <button
                    id="checkout-btn"
                    className="btn-primary w-full py-3"
                    onClick={() => {
                      if (!received || parseFloat(received) <= 0) {
                        setToast('Please enter amount received');
                        setTimeout(() => setToast(''), 2000);
                        return;
                      }
                      handleCheckout();
                    }}
                    disabled={paying}
                  >
                    {paying ? 'Processing...' : 'Complete Payment'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {receipt && <Receipt data={receipt} onClose={() => setReceipt(null)} />}

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

      {/* Flavor Selector Modal */}
      {flavorModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
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

      {/* Void Item Authorization Modal (Owner only) */}
      {voidItemModal && (
        <VoidItemModal
          itemName={voidItemModal.foodName}
          quantity={voidItemModal.quantity}
          onCancel={() => setVoidItemModal(null)}
          onConfirm={voidItemModal.onConfirm}
        />
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[70] bg-black text-white px-5 py-2.5 rounded-lg text-sm font-bold shadow-lg">
          {toast}
        </div>
      )}
    </Layout>
  );
}

// ─── Void Item Modal Component ──────────────────────────────────────────────
function VoidItemModal({ itemName, quantity, onCancel, onConfirm }) {
  const [password, setPassword] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [localError, setLocalError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password) return;
    setVerifying(true);
    setLocalError('');
    try {
      await onConfirm(password);
    } catch {
      // errors handled by parent via setErrorModal
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-[80] p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-sm w-full overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="bg-black px-6 py-5 text-center border-b border-gray-800">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-white/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-xl font-black text-white">Owner Authorization</h2>
          <p className="text-gray-400 text-sm mt-1">This action requires manager authorization.</p>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <h2 className="text-lg font-black text-white mb-2 text-center">Remove Item</h2>
          <p className="text-gray-400 text-sm mb-6 text-center">
            Remove {quantity} × {itemName}?<br />
            <span className="text-red-400">This action requires manager authorization.</span>
          </p>

          {localError && (
            <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-red-400 text-xs">
              {localError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">Owner Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter owner password"
                className="input w-full"
                autoFocus
              />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onCancel}
                disabled={verifying}
                className="flex-1 btn-outline py-2"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={verifying || !password}
                className="flex-1 btn-primary py-2 bg-red-600 hover:bg-red-700"
              >
                {verifying ? 'Verifying...' : 'Remove Item'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
