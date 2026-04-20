import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, increment } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { Plus, Edit2, Trash2, Calendar, Package } from 'lucide-react';

export default function DailyStock() {
  const { token } = useAuth();
  const [records, setRecords] = useState([]);
  const [foods, setFoods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  const [formData, setFormData] = useState({
    food_id: '',
    food_name: '',
    flavor_name: '',
    added_stock: '',
    stock_date: new Date().toISOString().split('T')[0],
    notes: '',
  });

  const h = { headers: { Authorization: `Bearer ${token}` } };

  const fetchRecords = async () => {
    try {
      const snap = await getDocs(collection(db, 'daily_stock_inventory'));
      const fetched = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      fetched.sort((a, b) => {
        if (a.stock_date !== b.stock_date) return b.stock_date.localeCompare(a.stock_date);
        return (b.created_at || '').localeCompare(a.created_at || '');
      });
      setRecords(fetched);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchFoods = async () => {
    try {
      const snap = await getDocs(collection(db, 'foods'));
      const fetched = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const sorted = fetched.sort((a, b) => a.name.localeCompare(b.name));
      setFoods(sorted);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchRecords();
    fetchFoods();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const parsedAdded = parseInt(formData.added_stock) || 0;
    
    try {
      const batch = writeBatch(db);

      if (editingRecord) {
        batch.update(doc(db, 'daily_stock_inventory', editingRecord.id), {
          added_stock: parsedAdded,
          stock_date: formData.stock_date,
          notes: formData.notes || null,
        });

        const diff = parsedAdded - editingRecord.added_stock;
        if (diff !== 0) {
           const foodDocRef = doc(db, 'foods', formData.food_id);
           const foodDoc = await getDoc(foodDocRef);
           if (foodDoc.exists()) {
             const fData = foodDoc.data();
             let newStock = fData.stock + diff;
             if (formData.flavor_name) {
                const newFlavors = fData.flavors || [];
                const mIdx = newFlavors.findIndex(fl => fl.flavor_name === formData.flavor_name);
                if (mIdx !== -1) {
                  newFlavors[mIdx].stock = (newFlavors[mIdx].stock || 0) + diff;
                  const sum = newFlavors.reduce((a, b) => a + (b.stock || 0), 0);
                  batch.update(foodDocRef, { flavors: newFlavors, stock: sum });
                }
             } else {
                batch.update(foodDocRef, { stock: increment(diff) });
             }
           }
        }
      } else {
        const newRef = doc(collection(db, 'daily_stock_inventory'));
        batch.set(newRef, {
          food_id: formData.food_id,
          food_name: formData.food_name,
          flavor_name: formData.flavor_name || null,
          added_stock: parsedAdded,
          stock_date: formData.stock_date,
          notes: formData.notes || null,
          created_at: new Date().toISOString()
        });

        const foodDocRef = doc(db, 'foods', formData.food_id);
        const foodDoc = await getDoc(foodDocRef);
        if (foodDoc.exists()) {
           const fData = foodDoc.data();
           let newStock = (fData.stock || 0) + parsedAdded;
           if (formData.flavor_name) {
              const newFlavors = fData.flavors || [];
              const mIdx = newFlavors.findIndex(fl => fl.flavor_name === formData.flavor_name);
              if (mIdx !== -1) {
                newFlavors[mIdx].stock = (newFlavors[mIdx].stock || 0) + parsedAdded;
                const sum = newFlavors.reduce((a, b) => a + (b.stock || 0), 0);
                if (fData.status === 'unavailable' && sum > 0) {
                   batch.update(foodDocRef, { flavors: newFlavors, stock: sum, status: 'available' });
                } else {
                   batch.update(foodDocRef, { flavors: newFlavors, stock: sum });
                }
              }
           } else {
              if (fData.status === 'unavailable' && newStock > 0) {
                 batch.update(foodDocRef, { stock: increment(parsedAdded), status: 'available' });
              } else {
                 batch.update(foodDocRef, { stock: increment(parsedAdded) });
              }
           }
        }
      }

      await batch.commit();

      fetchRecords();
      closeModal();
    } catch (err) {
      console.error(err);
      alert('Failed to save daily stock record');
    }
  };

  const handleEdit = (record) => {
    setEditingRecord(record);
    setFormData({
      food_id: record.food_id.toString(),
      food_name: record.food_name,
      flavor_name: record.flavor_name || '',
      added_stock: record.added_stock.toString(),
      stock_date: record.stock_date,
      notes: record.notes || '',
    });
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this record?')) return;
    try {
      const record = records.find(r => r.id === id);
      if (!record) return;

      const batch = writeBatch(db);
      batch.delete(doc(db, 'daily_stock_inventory', id));

      const foodDocRef = doc(db, 'foods', record.food_id);
      const foodDoc = await getDoc(foodDocRef);
      if (foodDoc.exists()) {
        const fData = foodDoc.data();
        if (record.flavor_name) {
          const newFlavors = fData.flavors || [];
          const mIdx = newFlavors.findIndex(fl => fl.flavor_name === record.flavor_name);
          if (mIdx !== -1) {
            newFlavors[mIdx].stock = Math.max(0, (newFlavors[mIdx].stock || 0) - record.added_stock);
            const sum = newFlavors.reduce((a, b) => a + (b.stock || 0), 0);
            batch.update(foodDocRef, { flavors: newFlavors, stock: sum });
          }
        } else {
          batch.update(foodDocRef, { stock: increment(-record.added_stock) });
        }
      }

      await batch.commit();
      fetchRecords();
    } catch (err) {
      console.error(err);
      alert('Failed to delete record');
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingRecord(null);
    setFormData({
      food_id: '',
      food_name: '',
      flavor_name: '',
      added_stock: '',
      stock_date: new Date().toISOString().split('T')[0],
      notes: '',
    });
  };

  const handleFoodChange = (foodId) => {
    const food = foods.find(f => f.id === foodId);
    if (food) {
      setFormData({
        ...formData,
        food_id: foodId,
        food_name: food.name,
        flavor_name: '',
      });
    }
  };

  // Filter records by selected date
  const filteredRecords = records.filter(r => r.stock_date === selectedDate);

  // Calculate totals for the selected date
  const totalAdded = filteredRecords.reduce((sum, r) => sum + r.added_stock, 0);

  return (
    <Layout>
      <div className="page-enter">
        <div className="mb-8">
          <h1 className="text-2xl font-black text-white">Daily Stock Inventory</h1>
          <p className="text-gray-500 text-sm mt-1">Track daily stock additions and history</p>
        </div>

        {/* Date Filter */}
        <div className="card p-4 mb-6">
          <div className="flex items-center gap-4">
            <Calendar className="w-5 h-5 text-gray-500" />
            <label className="text-sm text-gray-400">Select Date:</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="input"
            />
            <button
              onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}
              className="text-xs px-3 py-1.5 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700"
            >
              Today
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Package className="w-4 h-4 text-gray-500" />
              <p className="text-xs text-gray-500 uppercase tracking-widest font-semibold">Total Added Today</p>
            </div>
            <p className="text-2xl font-black text-white">{totalAdded}</p>
            <p className="text-xs text-gray-600 mt-1">{filteredRecords.length} records</p>
          </div>
        </div>

        {/* Add Button */}
        <div className="mb-6">
          <button
            onClick={() => setShowModal(true)}
            className="btn-primary flex items-center gap-2 px-4 py-2"
          >
            <Plus className="w-4 h-4" />
            Add Daily Stock
          </button>
        </div>

        {/* Records Table */}
        <div className="card p-6">
          {loading ? (
            <p className="text-gray-500 text-sm">Loading...</p>
          ) : filteredRecords.length === 0 ? (
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
                    <th className="text-left py-3 text-gray-500 font-semibold text-xs uppercase">Notes</th>
                    <th className="text-left py-3 text-gray-500 font-semibold text-xs uppercase">Time</th>
                    <th className="text-center py-3 text-gray-500 font-semibold text-xs uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map((record) => (
                    <tr key={record.id} className="border-b border-gray-900">
                      <td className="py-3 text-white">{record.food_name}</td>
                      <td className="py-3 text-gray-400">{record.flavor_name || '-'}</td>
                      <td className="py-3 text-right text-green-400 font-semibold">+{record.added_stock}</td>
                      <td className="py-3 text-gray-400">{record.category || '-'}</td>
                      <td className="py-3 text-gray-500">{record.notes || '-'}</td>
                      <td className="py-3 text-gray-500 text-xs">
                        {new Date(record.created_at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleEdit(record)}
                            className="text-gray-400 hover:text-white"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(record.id)}
                            className="text-gray-400 hover:text-red-400"
                          >
                            <Trash2 className="w-4 h-4" />
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

        {/* Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4">
            <div className="card w-full max-w-md p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-white">
                  {editingRecord ? 'Edit Daily Stock' : 'Add Daily Stock'}
                </h2>
                <button onClick={closeModal} className="text-gray-500 hover:text-white text-2xl leading-none">×</button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Food Item</label>
                  <select
                    value={formData.food_id}
                    onChange={(e) => handleFoodChange(e.target.value)}
                    className="input w-full"
                    required
                    disabled={!!editingRecord}
                  >
                    <option value="">Select food item</option>
                    {foods.map((food) => (
                      <option key={food.id} value={food.id}>
                        {food.name}
                      </option>
                    ))}
                  </select>
                </div>

                {formData.food_id && foods.find(f => f.id === formData.food_id)?.flavors && (
                  <div>
                    <label className="block text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Flavor</label>
                    <select
                      value={formData.flavor_name}
                      onChange={(e) => setFormData({ ...formData, flavor_name: e.target.value })}
                      className="input w-full"
                    >
                      <option value="">No flavor</option>
                      {(foods.find(f => f.id === formData.food_id)?.flavors || []).map((flavor, idx) => (
                        <option key={idx} value={flavor.flavor_name}>{flavor.flavor_name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Added Stock</label>
                  <input
                    type="number"
                    value={formData.added_stock}
                    onChange={(e) => setFormData({ ...formData, added_stock: e.target.value })}
                    className="input w-full"
                    min="0"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Date</label>
                  <input
                    type="date"
                    value={formData.stock_date}
                    onChange={(e) => setFormData({ ...formData, stock_date: e.target.value })}
                    className="input w-full"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Notes (Optional)</label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="input w-full"
                    rows="2"
                    placeholder="e.g., Morning stock, Refill, etc."
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={closeModal} className="btn-outline flex-1 py-2">
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary flex-1 py-2">
                    {editingRecord ? 'Update' : 'Add Stock'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
