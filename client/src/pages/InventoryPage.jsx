import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Package, History, Plus } from 'lucide-react';

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

const ALL_CATEGORIES = [...FOOD_CATEGORIES, ...DRINK_CATEGORIES];

function FoodModal({ food, onSave, onClose, saveError }) {
  const [name, setName] = useState(food?.name || '');
  const [price, setPrice] = useState(food?.price || '');
  const [stock, setStock] = useState(food?.stock ?? '');
  const [category, setCategory] = useState(food?.category || 'Appetizers');
  const [status, setStatus] = useState(food?.status || 'available');
  const [flavors, setFlavors] = useState(
    food?.flavors && food.flavors.length > 0
      ? food.flavors.map(f => ({ flavor_name: f.flavor_name || '', price: String(f.price ?? ''), stock: String(f.stock ?? '') }))
      : []
  );

  const hasFlavors = flavors.length > 0 && flavors.some(f => f.flavor_name.trim() !== '');

  const handleAddFlavor = () => {
    setFlavors([...flavors, { flavor_name: '', price: '', stock: '' }]);
  };

  const handleRemoveFlavor = (index) => {
    setFlavors(flavors.filter((_, i) => i !== index));
  };

  const handleFlavorChange = (index, field, value) => {
    const updated = [...flavors];
    updated[index][field] = value;
    setFlavors(updated);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const validFlavors = flavors.filter(f => f.flavor_name.trim() !== '');
    const flavorData = validFlavors.length > 0
      ? validFlavors.map(f => ({
          flavor_name: f.flavor_name.trim(),
          price: parseFloat(f.price) || parseFloat(price) || 0,
          stock: parseInt(f.stock) || 0,
        }))
      : null;

    onSave({
      name,
      price: parseFloat(price),
      stock: hasFlavors ? 0 : parseInt(stock),
      category,
      status: food ? status : 'available',
      flavors: flavorData,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className={`card w-full p-6 ${hasFlavors ? 'max-w-lg' : 'max-w-sm'}`}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-black text-white">{food ? 'Edit Food Item' : 'Add New Food'}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {saveError && (
            <div className="bg-white/10 border border-white/20 text-white text-xs px-3 py-2 rounded-lg font-medium">
              {saveError}
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1.5">Food/Drink Name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Chicken Wings" required />
          </div>
          <div>
            <label className="block text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1.5">Category</label>
            <select className="input" value={category} onChange={e => setCategory(e.target.value)}>
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
          <div>
            <label className="block text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1.5">
              {hasFlavors ? 'Default Price (₱)' : 'Price (₱)'}
            </label>
            <input className="input" type="number" min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)} placeholder={hasFlavors ? 'Auto-fills flavor prices' : '0.00'} required />
          </div>

          {/* Flavor List Section (Optional) */}
          <div className="border-t border-gray-800 pt-4">
            <div className="flex items-center justify-between mb-3">
              <label className="block text-xs text-gray-400 uppercase tracking-wider font-semibold">
                Flavor List <span className="text-gray-600 lowercase font-normal">(Optional)</span>
              </label>
              <button
                type="button"
                onClick={handleAddFlavor}
                className="text-xs text-gray-400 hover:text-white underline"
              >
                + Add Flavor
              </button>
            </div>

            {flavors.length > 0 && (
              <>
                <div className="grid grid-cols-12 gap-2 text-xs text-gray-500 mb-2">
                  <div className="col-span-5">Flavor Name</div>
                  <div className="col-span-3">Price</div>
                  <div className="col-span-3">Stock</div>
                  <div className="col-span-1"></div>
                </div>
                <div className="space-y-2">
                  {flavors.map((flavor, index) => (
                    <div key={index} className="grid grid-cols-12 gap-2 items-center">
                      <input
                        className="input text-sm col-span-5"
                        placeholder="e.g. Buffalo"
                        value={flavor.flavor_name}
                        onChange={e => handleFlavorChange(index, 'flavor_name', e.target.value)}
                      />
                      <input
                        className="input text-sm col-span-3"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder={price || '0'}
                        value={flavor.price}
                        onChange={e => handleFlavorChange(index, 'price', e.target.value)}
                      />
                      <input
                        className="input text-sm col-span-3"
                        type="number"
                        min="0"
                        placeholder="0"
                        value={flavor.stock}
                        onChange={e => handleFlavorChange(index, 'stock', e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveFlavor(index)}
                        className="text-gray-500 hover:text-red-400 text-lg leading-none col-span-1 text-center"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Stock field shown only when no flavors */}
          {!hasFlavors && (
            <div>
              <label className="block text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1.5">Stock Quantity</label>
              <input className="input" type="number" min="0" value={stock} onChange={e => setStock(e.target.value)} placeholder="0" required />
            </div>
          )}
          {food && (
            <div>
              <label className="block text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1.5">Availability</label>
              <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
                <option value="available">Available</option>
                <option value="unavailable">Unavailable</option>
              </select>
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1 py-2">
              {food ? 'Save Changes' : 'Add Item'}
            </button>
            <button type="button" onClick={onClose} className="btn-outline flex-1 py-2">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function InventoryPage() {
  const { token } = useAuth();
  const [foods, setFoods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | 'add' | food object
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [saveError, setSaveError] = useState('');
  const [toast, setToast] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [activeTab, setActiveTab] = useState('inventory'); // 'inventory' | 'daily-stock' | 'stock-history'

  // Daily Stock state
  const [stockRecords, setStockRecords] = useState([]);
  const [stockLoading, setStockLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedItems, setSelectedItems] = useState([]);
  const [stockSearch, setStockSearch] = useState('');
  const [stockCategoryFilter, setStockCategoryFilter] = useState('');
  
  // Stock History Edit/Delete state
  const [showStockModal, setShowStockModal] = useState(false);
  const [editingStockRecord, setEditingStockRecord] = useState(null);
  const [stockDeleteTarget, setStockDeleteTarget] = useState(null);
  const [stockFormData, setStockFormData] = useState({
    food_id: '',
    food_name: '',
    flavor_name: '',
    added_stock: '',
    stock_date: new Date().toISOString().split('T')[0],
  });

  const h = { headers: { Authorization: `Bearer ${token}` } };

  const fetchFoods = async () => {
    try {
      const res = await axios.get('/api/foods', h);
      setFoods(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchStockRecords = async () => {
    try {
      const res = await axios.get('/api/daily-stock', h);
      setStockRecords(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setStockLoading(false);
    }
  };

  useEffect(() => { 
    fetchFoods();
    fetchStockRecords();
  }, []);

  const handleSave = async (data) => {
    try {
      if (modal === 'add') {
        await axios.post('/api/foods', data, h);
      } else {
        await axios.put(`/api/foods/${modal.id}`, data, h);
      }
      setModal(null);
      setSaveError('');
      fetchFoods();
      if (modal === 'add') {
        setToast('Successfully added new food');
        setTimeout(() => setToast(''), 2500);
      } else {
        setToast('Successfully updated');
        setTimeout(() => setToast(''), 2500);
      }
    } catch (err) {
      setSaveError(err.response?.data?.error || 'Failed to save');
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`/api/foods/${id}`, h);
      setDeleteTarget(null);
      fetchFoods();
      setToast('Successfully deleted');
      setTimeout(() => setToast(''), 2500);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete');
    }
  };

  const toggleAvailability = async (food) => {
    const newStatus = food.status === 'available' ? 'unavailable' : 'available';
    try {
      await axios.put(`/api/foods/${food.id}`, { status: newStatus }, h);
      fetchFoods();
    } catch (err) {
      alert('Failed to update');
    }
  };

  const filtered = foods.filter(f =>
    f.name.toLowerCase().includes(search.toLowerCase()) &&
    (!categoryFilter || f.category === categoryFilter)
  );

  // Daily Stock handlers - batch selection workflow
  const handleAddToSelection = (food) => {
    const existingIndex = selectedItems.findIndex(item => item.food_id === food.id);
    if (existingIndex !== -1) {
      // Item already selected, remove it
      setSelectedItems(selectedItems.filter(item => item.food_id !== food.id));
    } else {
      // Add new item to selection
      setSelectedItems([
        ...selectedItems,
        {
          food_id: food.id,
          food_name: food.name,
          flavor_name: '',
          added_stock: '',
          stock_date: selectedDate,
        }
      ]);
    }
  };

  const handleSelectionChange = (index, field, value) => {
    const updated = [...selectedItems];
    updated[index][field] = value;
    setSelectedItems(updated);
  };

  const handleRemoveFromSelection = (index) => {
    setSelectedItems(selectedItems.filter((_, i) => i !== index));
  };

  const handleBatchSubmit = async () => {
    if (selectedItems.length === 0) {
      alert('Please select at least one item');
      return;
    }

    const records = selectedItems.map(item => ({
      food_id: item.food_id,
      food_name: item.food_name,
      flavor_name: item.flavor_name || null,
      added_stock: parseInt(item.added_stock) || 0,
      stock_date: item.stock_date,
      notes: null,
    }));

    try {
      await axios.post('/api/daily-stock/batch', { records }, h);
      setSelectedItems([]);
      fetchStockRecords();
      fetchFoods();
      setToast(`${records.length} stock records added successfully`);
      setTimeout(() => setToast(''), 2500);
    } catch (err) {
      console.error(err);
      alert('Failed to submit stock records');
    }
  };

  const handleStockEdit = (record) => {
    setEditingStockRecord(record);
    setStockFormData({
      food_id: record.food_id.toString(),
      food_name: record.food_name,
      flavor_name: record.flavor_name || '',
      added_stock: record.added_stock.toString(),
      stock_date: record.stock_date,
    });
    setShowStockModal(true);
  };

  const handleStockDelete = async (id) => {
    try {
      await axios.delete(`/api/daily-stock/${id}`, h);
      setStockDeleteTarget(null);
      fetchStockRecords();
      fetchFoods();
      setToast('Stock record deleted');
      setTimeout(() => setToast(''), 2500);
    } catch (err) {
      console.error(err);
      alert('Failed to delete record');
    }
  };

  const handleStockUpdate = async (e) => {
    e.preventDefault();
    const payload = {
      added_stock: parseInt(stockFormData.added_stock),
      stock_date: stockFormData.stock_date,
      notes: null,
    };

    try {
      await axios.put(`/api/daily-stock/${editingStockRecord.id}`, payload, h);
      setShowStockModal(false);
      setEditingStockRecord(null);
      fetchStockRecords();
      fetchFoods();
      setToast('Stock record updated');
      setTimeout(() => setToast(''), 2500);
    } catch (err) {
      console.error(err);
      alert('Failed to update record');
    }
  };

  const closeStockModal = () => {
    setShowStockModal(false);
    setEditingStockRecord(null);
    setStockFormData({
      food_id: '',
      food_name: '',
      flavor_name: '',
      added_stock: '',
      stock_date: new Date().toISOString().split('T')[0],
    });
  };

  const filteredStockRecords = stockRecords.filter(r => r.stock_date === selectedDate);
  const totalAdded = filteredStockRecords.reduce((sum, r) => sum + r.added_stock, 0);
  
  const filteredMenuList = foods.filter(f =>
    f.name.toLowerCase().includes(stockSearch.toLowerCase()) &&
    (!stockCategoryFilter || f.category === stockCategoryFilter)
  );

  return (
    <Layout>
      <div className="page-enter">
        {/* Header with Tabs */}
        <div className="mb-6">
          <h1 className="text-2xl font-black text-white mb-4">Inventory Management</h1>
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('inventory')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                activeTab === 'inventory'
                  ? 'bg-white text-black'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              <Package className="w-4 h-4" />
              Food Inventory
            </button>
            <button
              onClick={() => setActiveTab('daily-stock')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                activeTab === 'daily-stock'
                  ? 'bg-white text-black'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              <Plus className="w-4 h-4" />
              Daily Stock
            </button>
            <button
              onClick={() => setActiveTab('stock-history')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                activeTab === 'stock-history'
                  ? 'bg-white text-black'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              <History className="w-4 h-4" />
              Stock History
            </button>
          </div>
        </div>

        {/* Food Inventory Tab */}
        {activeTab === 'inventory' && (
          <>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-gray-500 text-sm">{foods.length} items · {foods.filter(f => f.status === 'available').length} available</p>
              </div>
              <button
                id="add-food-btn"
                className="btn-primary px-5 py-2"
                onClick={() => setModal('add')}
              >
                + Add Food
              </button>
            </div>

            {/* Search + Category Dropdown */}
            <div className="flex gap-3 mb-4">
          <input
            type="text"
            className="input"
            style={{ flex: 1 }}
            placeholder="Search inventory..."
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

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="card p-4 text-center">
            <p className="text-2xl font-black text-white">{foods.length}</p>
            <p className="text-xs text-gray-500 mt-1">Total Items</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-black text-white">{foods.filter(f => f.status === 'available' && f.stock > 0).length}</p>
            <p className="text-xs text-gray-500 mt-1">Available</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-black text-white">{foods.filter(f => f.stock <= 0 || f.status === 'unavailable').length}</p>
            <p className="text-xs text-gray-500 mt-1">Out of Stock</p>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <p className="text-gray-500 text-sm">Loading inventory...</p>
        ) : (
          <div className="card overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 360px)' }}>
            {/* Fixed Header */}
            <table className="w-full text-sm flex-shrink-0">
              <colgroup>
                <col className="w-[25%]" /><col className="w-[18%]" /><col className="w-[12%]" />
                <col className="w-[10%]" /><col className="w-[15%]" /><col className="w-[20%]" />
              </colgroup>
              <thead className="border-b border-gray-800">
                <tr>
                  <th className="text-left px-4 py-2.5 text-gray-500 font-semibold text-xs uppercase tracking-wider">Food Item</th>
                  <th className="text-left px-4 py-2.5 text-gray-500 font-semibold text-xs uppercase tracking-wider">Category</th>
                  <th className="text-right px-4 py-2.5 text-gray-500 font-semibold text-xs uppercase tracking-wider">Price</th>
                  <th className="text-right px-4 py-2.5 text-gray-500 font-semibold text-xs uppercase tracking-wider">Stock</th>
                  <th className="text-center px-4 py-2.5 text-gray-500 font-semibold text-xs uppercase tracking-wider">Status</th>
                  <th className="text-right px-4 py-2.5 text-gray-500 font-semibold text-xs uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
            </table>

            {/* Scrollable Body */}
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-sm">
                <colgroup>
                  <col className="w-[25%]" /><col className="w-[18%]" /><col className="w-[12%]" />
                  <col className="w-[10%]" /><col className="w-[15%]" /><col className="w-[20%]" />
                </colgroup>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-gray-600">No food items found.</td>
                    </tr>
                  ) : filtered.map(food => (
                    <tr key={food.id} className="border-b border-gray-900 hover:bg-gray-900/30 transition-colors">
                      <td className="px-4 py-2.5">
                        <p className="text-white font-medium">{food.name}</p>
                        {food.flavors && food.flavors.length > 0 && (
                          <p className="text-gray-500 text-[10px] mt-0.5">
                            {food.flavors.map(f => `${f.flavor_name} (₱${parseFloat(f.price).toFixed(0)})`).join(' · ')}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-gray-400 text-xs">{food.category}</td>
                      <td className="px-4 py-2.5 text-right text-gray-300">₱{parseFloat(food.price).toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-right">
                        {food.flavors && food.flavors.length > 0 ? (
                          <span className="text-gray-400 text-[10px]">
                            {food.flavors.map(f => `${f.flavor_name}: ${f.available ?? f.stock}`).join(' / ')}
                          </span>
                        ) : (
                          <span className={food.stock <= 5 ? 'text-gray-400 font-bold' : 'text-gray-300'}>
                            {food.stock}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <button
                          onClick={() => toggleAvailability(food)}
                          title="Toggle availability"
                        >
                          {(() => {
                            const effectiveStock = food.flavors && food.flavors.length > 0
                              ? food.flavors.reduce((sum, f) => sum + (f.available ?? f.stock ?? 0), 0)
                              : food.stock;
                            return effectiveStock <= 0
                              ? <span className="badge-outofstock">Out of Stock</span>
                              : food.status === 'available'
                              ? <span className="badge-available">Available</span>
                              : <span className="badge-paused">Disabled</span>;
                          })()}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            id={`edit-food-${food.id}`}
                            onClick={() => setModal(food)}
                            className="btn-outline px-3 py-1 text-xs"
                          >
                            Edit
                          </button>
                          <button
                            id={`delete-food-${food.id}`}
                            onClick={() => setDeleteTarget(food)}
                            className="btn-danger px-3 py-1 text-xs"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Fixed Footer */}
            <div className="px-4 py-2 border-t border-gray-800 flex items-center justify-between flex-shrink-0">
              <span className="text-gray-500 text-xs">Showing {filtered.length} of {foods.length} items</span>
              <span className="text-gray-500 text-xs">{foods.filter(f => f.stock <= 5 && f.stock > 0).length} low stock</span>
            </div>
          </div>
        )}
      </>
    )}

    {/* Daily Stock Tab */}
    {activeTab === 'daily-stock' && (
      <>
        {/* Compact Header with Date and Stats */}
        <div className="card p-4 mb-6">
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-400">Date:</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="input"
              />
              <button
                onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}
                className="text-xs px-2 py-1 bg-gray-800 text-gray-300 rounded hover:bg-gray-700"
              >
                Today
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-gray-500" />
              <p className="text-xs text-gray-400">Selected: <span className="text-white font-bold">{selectedItems.length}</span></p>
            </div>
          </div>
        </div>

        {/* Menu List */}
        <div className="card p-6 mb-6">
          <div className="flex items-center justify-between mb-4 gap-3">
            <h3 className="text-lg font-bold text-white">Menu List</h3>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={stockSearch}
                onChange={(e) => setStockSearch(e.target.value)}
                placeholder="Search..."
                className="input w-40"
              />
              <select
                value={stockCategoryFilter}
                onChange={(e) => setStockCategoryFilter(e.target.value)}
                className="input w-40"
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
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {filteredMenuList.map((food) => {
              const isSelected = selectedItems.some(item => item.food_id === food.id);
              return (
                <div
                  key={food.id}
                  className={`card p-2 flex items-center justify-between cursor-pointer transition-colors ${
                    isSelected ? 'bg-gray-800 border-2 border-white' : 'hover:bg-gray-900/50'
                  }`}
                  onClick={() => handleAddToSelection(food)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-medium truncate">{food.name}</p>
                    <p className="text-gray-500 text-[10px] truncate">{food.category}</p>
                  </div>
                  <button
                    className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ml-2 ${
                      isSelected ? 'bg-green-500 text-white' : 'bg-gray-700 text-gray-400'
                    }`}
                  >
                    {isSelected ? '✓' : '+'}
                  </button>
                </div>
              );
            })}
          </div>
          {filteredMenuList.length === 0 && (
            <p className="text-gray-500 text-sm text-center py-4">No menu items found</p>
          )}
        </div>

        {/* Selected Items Table */}
        {selectedItems.length > 0 && (
          <div className="card p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">Selected Items</h3>
              <span className="text-sm text-gray-400">{selectedItems.length} items</span>
            </div>
            <div className="overflow-x-auto border border-gray-800 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-900/50">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-400 font-semibold text-xs uppercase border-b border-gray-800">Food Item</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-semibold text-xs uppercase border-b border-gray-800">Flavor</th>
                    <th className="text-right px-4 py-3 text-gray-400 font-semibold text-xs uppercase border-b border-gray-800">Added Stock</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-semibold text-xs uppercase border-b border-gray-800">Date</th>
                    <th className="text-center px-4 py-3 text-gray-400 font-semibold text-xs uppercase border-b border-gray-800">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedItems.map((item, index) => (
                    <tr key={index} className="border-b border-gray-800 last:border-0 hover:bg-gray-900/30">
                      <td className="px-4 py-3 text-white font-medium">{item.food_name}</td>
                      <td className="px-4 py-3 text-left">
                        {(() => {
                          const food = foods.find(f => f.id === item.food_id);
                          const flavors = food?.flavors;
                          const flavorsArray = typeof flavors === 'string' ? JSON.parse(flavors || '[]') : (flavors || []);
                          return flavorsArray && flavorsArray.length > 0 ? (
                            <select
                              value={item.flavor_name}
                              onChange={(e) => handleSelectionChange(index, 'flavor_name', e.target.value)}
                              className="bg-gray-800 border border-gray-700 text-white text-xs px-2 py-1.5 rounded focus:outline-none focus:border-white w-full text-left"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {flavorsArray.map((flavor, idx) => (
                                <option key={idx} value={flavor.flavor_name}>{flavor.flavor_name}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-gray-500">-</span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="number"
                          value={item.added_stock}
                          onChange={(e) => handleSelectionChange(index, 'added_stock', e.target.value)}
                          className="bg-gray-800 border border-gray-700 text-white text-xs px-2 py-1.5 rounded w-24 text-right focus:outline-none focus:border-white"
                          min="0"
                          placeholder="0"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="px-4 py-3 text-left">
                        <input
                          type="date"
                          value={item.stock_date}
                          onChange={(e) => handleSelectionChange(index, 'stock_date', e.target.value)}
                          className="bg-gray-800 border border-gray-700 text-white text-xs px-2 py-1.5 rounded focus:outline-none focus:border-white w-full text-left"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRemoveFromSelection(index); }}
                          className="bg-red-500/10 text-red-400 hover:bg-red-500/20 px-3 py-1.5 rounded text-xs font-medium transition-colors"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={handleBatchSubmit}
                className="btn-primary px-6 py-2"
              >
                Submit All ({selectedItems.length})
              </button>
            </div>
          </div>
        )}

        {/* Records Table */}
        <div className="card p-6">
          <h3 className="text-lg font-bold text-white mb-4">Today's Records</h3>
          {stockLoading ? (
            <p className="text-gray-500 text-sm">Loading...</p>
          ) : filteredStockRecords.length === 0 ? (
            <p className="text-gray-600 text-sm">No stock records for {selectedDate}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-800">
                  <tr>
                    <th className="text-left py-3 text-gray-500 font-semibold text-xs uppercase">Food Item</th>
                    <th className="text-left py-3 text-gray-500 font-semibold text-xs uppercase">Flavor</th>
                    <th className="text-right py-3 text-gray-500 font-semibold text-xs uppercase">Added Stock</th>
                    <th className="text-left py-3 text-gray-500 font-semibold text-xs uppercase">Category</th>
                    <th className="text-left py-3 text-gray-500 font-semibold text-xs uppercase">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStockRecords.map((record) => (
                    <tr key={record.id} className="border-b border-gray-900">
                      <td className="py-3 text-white">{record.food_name}</td>
                      <td className="py-3 text-gray-400">{record.flavor_name || '-'}</td>
                      <td className="py-3 text-right text-green-400 font-semibold">+{record.added_stock}</td>
                      <td className="py-3 text-gray-400">{record.category || '-'}</td>
                      <td className="py-3 text-gray-500 text-xs">
                        {new Date(record.created_at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>
    )}

    {/* Stock History Tab */}
    {activeTab === 'stock-history' && (
      <>
        <div className="card p-6">
          {stockLoading ? (
            <p className="text-gray-500 text-sm">Loading...</p>
          ) : stockRecords.length === 0 ? (
            <p className="text-gray-600 text-sm">No stock history yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-800">
                  <tr>
                    <th className="text-left py-3 text-gray-500 font-semibold text-xs uppercase">Date</th>
                    <th className="text-left py-3 text-gray-500 font-semibold text-xs uppercase">Food Item</th>
                    <th className="text-left py-3 text-gray-500 font-semibold text-xs uppercase">Flavor</th>
                    <th className="text-right py-3 text-gray-500 font-semibold text-xs uppercase">Added Stock</th>
                    <th className="text-left py-3 text-gray-500 font-semibold text-xs uppercase">Time</th>
                    <th className="text-center py-3 text-gray-500 font-semibold text-xs uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {stockRecords.map((record) => (
                    <tr key={record.id} className="border-b border-gray-900">
                      <td className="py-3 text-white">{record.stock_date}</td>
                      <td className="py-3 text-white">{record.food_name}</td>
                      <td className="py-3 text-gray-400">{record.flavor_name || '-'}</td>
                      <td className="py-3 text-right text-green-400 font-semibold">+{record.added_stock}</td>
                      <td className="py-3 text-gray-500 text-xs">
                        {new Date(record.created_at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleStockEdit(record)}
                            className="text-gray-400 hover:text-white text-xs"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setStockDeleteTarget(record)}
                            className="text-gray-400 hover:text-red-400 text-xs"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>
    )}
  </div>

  {/* Toast */}
  {toast && (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[70] bg-white text-black px-5 py-2.5 rounded-lg text-sm font-bold shadow-lg animate-fade-in">
      {toast}
    </div>
  )}

  {/* Modal */}
  {modal && (
    <FoodModal
      food={modal === 'add' ? null : modal}
      onSave={handleSave}
      onClose={() => { setModal(null); setSaveError(''); }}
      saveError={saveError}
    />
  )}

  {/* Delete Confirmation Modal */}
  {deleteTarget && (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-xs p-6 text-center">
        <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-white/10 flex items-center justify-center">
          <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </div>
        <h2 className="text-lg font-black text-white mb-1">Delete Item</h2>
        <p className="text-sm text-gray-400 mb-6">Are you sure you want to delete <span className="text-white font-semibold">{deleteTarget.name}</span>?</p>
        <div className="flex gap-3">
          <button
            onClick={() => setDeleteTarget(null)}
            className="btn-outline flex-1 py-2"
          >
            Cancel
          </button>
          <button
            onClick={() => handleDelete(deleteTarget.id)}
            className="btn-primary flex-1 py-2"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )}

  {/* Stock Delete Confirmation Modal */}
  {stockDeleteTarget && (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-xs p-6 text-center">
        <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-white/10 flex items-center justify-center">
          <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </div>
        <h2 className="text-lg font-black text-white mb-1">Delete Stock Record</h2>
        <p className="text-sm text-gray-400 mb-6">
          Are you sure you want to delete the record for <span className="text-white font-semibold">{stockDeleteTarget.food_name}</span>
          {stockDeleteTarget.flavor_name && <span> ({stockDeleteTarget.flavor_name})</span>}?
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setStockDeleteTarget(null)}
            className="btn-outline flex-1 py-2"
          >
            Cancel
          </button>
          <button
            onClick={() => handleStockDelete(stockDeleteTarget.id)}
            className="btn-primary flex-1 py-2"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )}

  {/* Stock Edit Modal */}
  {showStockModal && (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4">
      <div className="card w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">Edit Stock Record</h2>
          <button onClick={closeStockModal} className="text-gray-500 hover:text-white text-2xl leading-none">×</button>
        </div>

        <form onSubmit={handleStockUpdate} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Food Item</label>
            <input
              type="text"
              value={stockFormData.food_name}
              disabled
              className="input w-full bg-gray-800"
            />
          </div>

          {stockFormData.flavor_name && (
            <div>
              <label className="block text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Flavor</label>
              <input
                type="text"
                value={stockFormData.flavor_name}
                disabled
                className="input w-full bg-gray-800"
              />
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Added Stock</label>
            <input
              type="number"
              value={stockFormData.added_stock}
              onChange={(e) => setStockFormData({ ...stockFormData, added_stock: e.target.value })}
              className="input w-full"
              min="0"
              required
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Date</label>
            <input
              type="date"
              value={stockFormData.stock_date}
              onChange={(e) => setStockFormData({ ...stockFormData, stock_date: e.target.value })}
              className="input w-full"
              required
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={closeStockModal} className="btn-outline flex-1 py-2">
              Cancel
            </button>
            <button type="submit" className="btn-primary flex-1 py-2">
              Update
            </button>
          </div>
        </form>
      </div>
    </div>
  )}
</Layout>
);
}
