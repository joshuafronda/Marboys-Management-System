import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
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

  const h = { headers: { Authorization: `Bearer ${token}` } };

  const fetchFoods = useCallback(async () => {
    try {
      const res = await axios.get('/api/foods', h);
      setFoods(res.data);
    } catch (err) {
      console.error(err);
    }
  }, [token]);

  const fetchTables = useCallback(async () => {
    try {
      const res = await axios.get('/api/tables', h);
      setTables(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchFoods();
    fetchTables();
    const interval = setInterval(fetchTables, 10000);
    return () => clearInterval(interval);
  }, []);

  // Load cart from table when selecting a table
  useEffect(() => {
    if (selectedTableId) {
      const table = tables.find(t => t.id === parseInt(selectedTableId));
      if (table && table.cart_items) {
        setCart(table.cart_items);
      } else {
        setCart([]);
      }
    } else {
      setCart([]);
    }
    setReceived('');
  }, [selectedTableId]);

  // Save cart to server when it changes and a table is selected
  const saveCartToServer = async (tableId, items) => {
    try {
      await axios.put(`/api/tables/${tableId}/cart`, { cart_items: items }, h);
      fetchFoods(); // refresh stock display
    } catch (err) {
      console.error('Failed to save cart:', err);
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
      return flavor.stock - inOtherTableCarts - inPosCart;
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
      const cartKey = flavorName ? `${food.id}-${flavorName}` : String(food.id);
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
      if (selectedTableId) saveCartToServer(parseInt(selectedTableId), next);
      return next;
    });
  };

  const removeFromCart = (foodId, flavorName) => {
    setCart(prev => {
      const next = prev.filter(i => 
        flavorName ? !(i.food_id === foodId && i.flavor_name === flavorName) : i.food_id !== foodId
      );
      if (selectedTableId) saveCartToServer(parseInt(selectedTableId), next);
      return next;
    });
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
      if (selectedTableId) saveCartToServer(parseInt(selectedTableId), next);
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
      const salePayload = {
        table_number: selectedTable ? selectedTable.table_number : null,
        start_time: selectedTable?.start_time || null,
        end_time: new Date().toISOString(),
        table_cost: tableCost,
        food_items: cart,
        received: parseFloat(received) || 0,
      };
      const res = await axios.post('/api/sales', salePayload, h);

      // If table order, reset the table
      if (selectedTableId) {
        await axios.post(`/api/tables/${selectedTableId}/reset`, {}, h);
      }

      setReceipt({
        ...res.data,
        table_number: selectedTable ? selectedTable.table_number : null,
        table_cost: tableCost,
        food_items: cart,
        food_total: foodTotal,
        total: grandTotal,
        received: parseFloat(received),
        change: parseFloat(received) - grandTotal,
        cashier: user.name,
      });

      fetchFoods();
      fetchTables();
      setCart([]);
      setReceived('');
      setSelectedTableId('');
    } catch (err) {
      setErrorModal(err.response?.data?.error || 'Checkout failed');
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
                        <button onClick={() => removeFromCart(item.food_id, item.flavor_name)} className="text-gray-600 hover:text-white text-lg leading-none">×</button>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => adjustQty(item.food_id, -1, item.flavor_name)}
                            className="w-7 h-7 border border-gray-700 rounded text-gray-400 hover:text-white hover:border-gray-500 flex items-center justify-center"
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
                    onClick={handleCheckout}
                    disabled={paying || !received}
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
    </Layout>
  );
}
