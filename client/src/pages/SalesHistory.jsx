import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import Receipt from '../components/Receipt';
import { collection, query, where, orderBy, getDocs, doc, deleteDoc, updateDoc, getDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';

export default function SalesHistory() {
  const { token, user } = useAuth();
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [page, setPage] = useState(1);
  const [voidModal, setVoidModal] = useState(null); // { saleId, itemId, itemName, maxQty }
  const [voidPassword, setVoidPassword] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const [voidQty, setVoidQty] = useState(1);
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState('');
  const [voidPwSet, setVoidPwSet] = useState(false);
  const [showPwSetup, setShowPwSetup] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState('');
  const [viewReceipt, setViewReceipt] = useState(null); // sale object for receipt preview
  const [toast, setToast] = useState(''); // success message toast
  const [deleteModal, setDeleteModal] = useState(null); // { saleId, tableNumber }
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const fetchSales = async () => {
    setLoading(true);
    try {
      let q;
      if (dateFilter) {
        // Filter by created_at date range (start of day to end of day in UTC)
        const startDate = dateFilter + 'T00:00:00.000Z';
        const endDate = dateFilter + 'T23:59:59.999Z';
        q = query(collection(db, 'sales'), where('created_at', '>=', startDate), where('created_at', '<=', endDate), orderBy('created_at', 'desc'));
      } else {
        q = query(collection(db, 'sales'), orderBy('created_at', 'desc'));
      }
      const snap = await getDocs(q);
      const allSales = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      // Manual pagination
      const start = (page - 1) * 30;
      const paged = allSales.slice(start, start + 30);
      
      // Fetch items for each sale
      const salesWithItems = await Promise.all(paged.map(async (sale) => {
        const itemsQuery = query(collection(db, 'sale_items'), where('sale_id', '==', sale.id));
        const itemsSnap = await getDocs(itemsQuery);
        const items = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        return { ...sale, items };
      }));
      
      setSales(salesWithItems);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSales(); }, [page, dateFilter]);

  // Check if void password is set (owner only)
  useEffect(() => {
    if (user?.role === 'owner') {
      const checkVoidPw = async () => {
        const usersSnap = await getDocs(collection(db, 'users'));
        const ownerDoc = usersSnap.docs.find(d => d.data().role === 'owner');
        if (ownerDoc) {
          setVoidPwSet(!!ownerDoc.data().void_password);
        }
      };
      checkVoidPw().catch(() => {});
    }
  }, [user?.role]);

  // Get today's date YYYY-MM-DD
  const todayStr = new Date().toISOString().split('T')[0];
  const totalRevenue = sales.reduce((s, sale) => s + (sale.total || 0), 0);

  const toggleExpand = (id) => {
    setExpanded(prev => (prev === id ? null : id));
  };

  const openVoidModal = (saleId, item) => {
    setVoidModal({ saleId, itemId: item.id, itemName: item.food_name, maxQty: item.quantity });
    setVoidPassword('');
    setVoidReason('');
    setVoidQty(item.quantity);
    setVoidError('');
  };

  const handleVoid = async () => {
    if (!voidPassword || !voidReason) {
      setVoidError('Password and reason are required');
      return;
    }
    setVoiding(true);
    setVoidError('');
    try {
      // Verify void password
      const usersSnap = await getDocs(collection(db, 'users'));
      const ownerDoc = usersSnap.docs.find(d => d.data().role === 'owner' && d.data().void_password === voidPassword);
      if (!ownerDoc) {
        setVoidError('Invalid void password');
        setVoiding(false);
        return;
      }
      
      // Update sale item as voided
      const itemRef = doc(db, 'sale_items', voidModal.itemId);
      await updateDoc(itemRef, {
        voided: true,
        void_reason: voidReason,
        voided_by: user.name,
        voided_at: new Date().toISOString()
      });
      
      // Recalculate sale totals
      const saleRef = doc(db, 'sales', voidModal.saleId);
      const saleSnap = await getDoc(saleRef);
      if (saleSnap.exists()) {
        const saleData = saleSnap.data();
        const itemsQuery = query(collection(db, 'sale_items'), where('sale_id', '==', voidModal.saleId));
        const itemsSnap = await getDocs(itemsQuery);
        let newFoodTotal = 0;
        itemsSnap.forEach(d => {
          const item = d.data();
          if (!item.voided) {
            newFoodTotal += (item.price || 0) * (item.quantity || 0);
          }
        });
        const newTotal = (saleData.table_cost || 0) + newFoodTotal;
        await updateDoc(saleRef, { food_total: newFoodTotal, total: newTotal });
      }
      
      setVoidModal(null);
      setToast(`Voided ${voidQty} × ${voidModal.itemName}`);
      setTimeout(() => setToast(''), 3000);
      fetchSales();
    } catch (err) {
      setVoidError(err.message || 'Failed to void item');
    } finally {
      setVoiding(false);
    }
  };

  const openDeleteModal = (saleId, tableNumber) => {
    setDeleteModal({ saleId, tableNumber });
    setDeletePassword('');
    setDeleteError('');
  };

  const handleDeleteSale = async () => {
    if (!deletePassword) {
      setDeleteError('Password is required');
      return;
    }
    setDeleting(true);
    setDeleteError('');
    try {
      // Verify owner password
      const usersSnap = await getDocs(collection(db, 'users'));
      const ownerDoc = usersSnap.docs.find(d => d.data().role === 'owner' && d.data().void_password === deletePassword);
      if (!ownerDoc) {
        setDeleteError('Invalid password');
        setDeleting(false);
        return;
      }
      
      // Delete sale and related items
      const batch = writeBatch(db);
      
      // Delete sale items first
      const itemsQuery = query(collection(db, 'sale_items'), where('sale_id', '==', deleteModal.saleId));
      const itemsSnap = await getDocs(itemsQuery);
      itemsSnap.forEach(d => batch.delete(d.ref));
      
      // Delete sale
      batch.delete(doc(db, 'sales', deleteModal.saleId));
      
      await batch.commit();
      
      setDeleteModal(null);
      setToast('Sale deleted successfully');
      setTimeout(() => setToast(''), 3000);
      fetchSales();
    } catch (err) {
      setDeleteError(err.message || 'Failed to delete sale');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Layout>
      <div className="page-enter">
          {/* Header */}
          <div className="responsive-header mb-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-white">Sales History</h1>
              <p className="text-gray-500 text-sm mt-1">
                {sales.length} records · ₱{totalRevenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })} total
              </p>
            </div>

            <div className="flex flex-wrap gap-2 sm:gap-4 items-center">
              <input
                id="date-filter"
                type="date"
                className="input flex-1 min-w-[140px] max-w-[180px]"
                value={dateFilter}
                onChange={e => { setDateFilter(e.target.value); setPage(1); }}
                max={todayStr}
              />
              {user?.role === 'owner' && (
                <button
                  onClick={() => { setShowPwSetup(true); setNewPw(''); setConfirmPw(''); setPwError(''); }}
                  className="btn-primary px-4 py-2 text-sm"
                >
                  {voidPwSet ? 'Password' : 'Set Void Password'}
                </button>
              )}
            </div>
          </div>

          {/* Quick filter buttons */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => { setDateFilter(todayStr); setPage(1); }}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${dateFilter === todayStr ? 'bg-white text-black border-white' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}
            >
              Today
            </button>
            <button
              onClick={() => { setDateFilter(''); setPage(1); }}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${!dateFilter ? 'bg-white text-black border-white' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}
            >
              All Time
            </button>
          </div>

          {loading ? (
            <p className="text-gray-500 text-sm">Loading sales...</p>
          ) : sales.length === 0 ? (
            <div className="card p-12 text-center">
              <p className="text-gray-600">No sales records found.</p>
            </div>
          ) : (
            <div className="card overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 240px)', minHeight: '300px' }}>
              {/* Fixed Header */}
              <table className="w-full text-sm flex-shrink-0">
                <colgroup>
                    <col className="w-[5%]" /><col className="w-[12%]" /><col className="w-[12%]" />
                    <col className="w-[8%]" /><col className="w-[10%]" /><col className="w-[10%]" />
                    <col className="w-[10%]" /><col className="w-[10%]" /><col className="w-[8%]" />
                    {user?.role === 'owner' && <col className="w-[10%]" />}
                </colgroup>
                <thead className="border-b border-gray-800">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-gray-500 font-semibold text-xs uppercase tracking-wider">#</th>
                    <th className="text-left px-4 py-2.5 text-gray-500 font-semibold text-xs uppercase tracking-wider">Table</th>
                    <th className="text-left px-4 py-2.5 text-gray-500 font-semibold text-xs uppercase tracking-wider">Date</th>
                    <th className="text-center px-4 py-2.5 text-gray-500 font-semibold text-xs uppercase tracking-wider">Hours</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-semibold text-xs uppercase tracking-wider">Table Cost</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-semibold text-xs uppercase tracking-wider">Food</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-semibold text-xs uppercase tracking-wider">Total</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-semibold text-xs uppercase tracking-wider">Received</th>
                    <th className="text-center px-4 py-2.5 text-gray-500 font-semibold text-xs uppercase tracking-wider">By</th>
                    <th className="text-center px-4 py-2.5 text-gray-500 font-semibold text-xs uppercase tracking-wider">Details</th>
                    {user?.role === 'owner' && <th className="text-center px-4 py-2.5 text-gray-500 font-semibold text-xs uppercase tracking-wider">Action</th>}
                  </tr>
                </thead>
              </table>

              {/* Scrollable Body */}
              <div className="overflow-y-auto flex-1">
                <table className="w-full text-sm">
                  <colgroup>
                    <col className="w-[5%]" /><col className="w-[12%]" /><col className="w-[12%]" />
                    <col className="w-[8%]" /><col className="w-[10%]" /><col className="w-[10%]" />
                    <col className="w-[10%]" /><col className="w-[10%]" /><col className="w-[8%]" />
                    {user?.role === 'owner' && <col className="w-[10%]" />}
                  </colgroup>
                  <tbody>
                  {sales.map((sale, index) => (
                    <React.Fragment key={sale.id}>
                      <tr
                        className="border-b border-gray-900 hover:bg-gray-900/30 transition-colors cursor-pointer"
                        onClick={() => toggleExpand(sale.id)}
                      >
                        <td className="px-4 py-2.5 text-gray-500 font-bold text-sm">{(page - 1) * 30 + (sales.length - index)}</td>
                        <td className="px-4 py-2.5 text-white font-medium">
                          {sale.table_number ? `Table ${sale.table_number}` : 'Walk-in'}
                        </td>
                        <td className="px-4 py-2.5 text-gray-400 text-xs">
                          <div>{new Date(sale.end_time || sale.date).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric' })}</div>
                          {sale.end_time && <div className="text-gray-600">{new Date(sale.end_time).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: true })}</div>}
                        </td>
                        <td className="px-4 py-2.5 text-center text-gray-300 text-xs">
                          {sale.set_hours > 0 ? (
                            <span className="bg-gray-800 px-2 py-0.5 rounded font-semibold">
                              {sale.set_hours >= 1 
                                ? `${Math.floor(sale.set_hours)}h${sale.set_hours % 1 > 0 ? ` ${Math.round((sale.set_hours % 1) * 60)}m` : ''}` 
                                : sale.set_hours * 60 >= 1
                                  ? `${Math.round(sale.set_hours * 60)}m`
                                  : `${Math.round(sale.set_hours * 3600)}s`}
                            </span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-300">
                          {(sale.table_cost || 0) > 0 ? `₱${parseFloat(sale.table_cost).toFixed(2)}` : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-300">
                          {(() => {
                            const foodTotal = sale.food_total || sale.food_items?.reduce((sum, item) => sum + (item.price * item.quantity), 0) || 0;
                            return foodTotal > 0 ? `₱${parseFloat(foodTotal).toFixed(2)}` : '—';
                          })()}
                        </td>
                        <td className="px-4 py-2.5 text-right text-white font-bold">
                          ₱{parseFloat(sale.total || 0).toFixed(2)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-green-400 font-medium">
                          ₱{parseFloat(sale.received || 0).toFixed(2)}
                        </td>
                        <td className="px-4 py-2.5 text-center text-gray-400 text-xs">{sale.cashier}</td>
                        <td className="px-4 py-2.5 text-center text-gray-600 text-xs">
                          {expanded === sale.id ? '▲' : '▼'}
                        </td>
                        {user?.role === 'owner' && (
                          <td className="px-4 py-2.5 text-center">
                            <button
                              onClick={(e) => { e.stopPropagation(); openDeleteModal(sale.id, sale.table_number); }}
                              className="px-2 py-1 text-[10px] font-bold bg-red-600 text-white border border-red-500 rounded hover:bg-red-500 transition-colors"
                            >
                              DELETE
                            </button>
                          </td>
                        )}
                      </tr>
                      {expanded === sale.id && (sale.set_hours > 0 || sale.category === 'exhibition' || (sale.items && sale.items.length > 0) || (sale.food_items && sale.food_items.length > 0)) && (
                        <tr key={`${sale.id}-items`} className="bg-gray-950">
                          <td colSpan={user?.role === 'owner' ? 11 : 10} className="px-4 py-2">
                            <div className="pl-4 border-l-2 border-gray-800 space-y-1">
                              <button
                                onClick={(e) => { e.stopPropagation(); setViewReceipt(sale); }}
                                className="text-xs px-3 py-1.5 bg-white text-black font-bold rounded-lg hover:bg-gray-200 transition-colors mb-2"
                              >
                                View Receipt
                              </button>
                              {sale.set_hours > 0 && (
                                <div>
                                  <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">Table Time</p>
                                  <div className="flex justify-between text-xs text-gray-400 py-0.5">
                                    <span>Prepaid Duration</span>
                                    <span className="text-gray-300">
                                      {sale.set_hours >= 1 
                                        ? `${Math.floor(sale.set_hours)}h${sale.set_hours % 1 > 0 ? ` ${Math.round((sale.set_hours % 1) * 60)}m` : ''}` 
                                        : sale.set_hours * 60 >= 1
                                          ? `${Math.round(sale.set_hours * 60)}m`
                                          : `${Math.round(sale.set_hours * 3600)}s`}
                                    </span>
                                  </div>
                                  <div className="flex justify-between text-xs text-gray-400 py-0.5">
                                    <span>Rate</span>
                                    <span className="text-gray-300">₱200/hr</span>
                                  </div>
                                </div>
                              )}
                              {sale.category === 'exhibition' && (
                                <div>
                                  <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">Exhibition Match</p>
                                  <div className="text-xs text-gray-400 py-0.5">
                                    <span className="text-gray-300">{sale.details || 'Table Fee'}</span>
                                  </div>
                                  <div className="flex justify-between text-xs text-gray-400 py-0.5">
                                    <span>Table Fee</span>
                                    <span className="text-gray-300">₱{parseFloat(sale.table_cost || 0).toFixed(2)}</span>
                                  </div>
                                </div>
                              )}
                              {(() => {
                                // Get items from either sale_items collection or food_items array in sale doc
                                const items = (sale.items && sale.items.length > 0) ? sale.items : (sale.food_items || []);
                                if (items.length === 0) return null;
                                return (
                                  <div>
                                    <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">Food Items</p>
                                    {items.map((item, idx) => (
                                      <div key={item.id || idx} className={`flex justify-between items-center text-xs py-1 ${item.voided ? 'opacity-40 line-through' : 'text-gray-400'}`}>
                                        <span>{item.food_name}{item.flavor_name && !item.food_name.includes(item.flavor_name) ? ` - ${item.flavor_name}` : ''} × {item.quantity}{item.voided ? <span className="text-red-400 no-underline font-bold ml-1"> VOIDED</span> : ''}</span>
                                        <div className="flex items-center gap-2">
                                          <span className={item.voided ? 'text-gray-600' : 'text-gray-300'}>₱{(item.price * item.quantity).toFixed(2)}</span>
                                          {sale.items && sale.items.length > 0 && !item.voided && (
                                            <button
                                              onClick={(e) => { e.stopPropagation(); openVoidModal(sale.id, item); }}
                                              className="px-2 py-1 text-[10px] font-bold bg-red-600 text-white border border-red-500 rounded hover:bg-red-500 transition-colors"
                                            >
                                              VOID
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                );
                              })()}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
              </div>

              {/* Pagination - Fixed Footer */}
              <div className="p-4 border-t border-gray-800 flex items-center justify-between flex-shrink-0">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="btn-outline px-3 py-1.5 text-xs disabled:opacity-30"
                >
                  ← Prev
                </button>
                <span className="text-gray-500 text-xs">Page {page}</span>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={sales.length < 30}
                  className="btn-outline px-3 py-1.5 text-xs disabled:opacity-30"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Void Authorization Modal */}
        {voidModal && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-sm w-full overflow-hidden shadow-2xl">
              {/* Header - Black */}
              <div className="bg-black px-6 py-5 text-center border-b border-gray-800">
                <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-white/10 flex items-center justify-center">
                  <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h2 className="text-xl font-black text-white">Owner Authorization</h2>
                <p className="text-gray-500 text-sm mt-1">Required to void item</p>
              </div>

              {/* Body */}
              <div className="px-6 py-5 space-y-4">
                {/* Item Info */}
                <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                  <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Item to Void</p>
                  <p className="text-white font-bold mt-1">{voidModal.itemName}</p>
                </div>

                {/* Quantity */}
                <div>
                  <label className="block text-xs text-gray-500 font-semibold mb-1.5">Quantity to Void</label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setVoidQty(q => Math.max(1, q - 1))}
                      className="w-8 h-8 flex items-center justify-center bg-gray-800 border border-gray-700 rounded-lg text-gray-400 hover:bg-gray-700 hover:text-white transition-colors text-sm font-bold"
                    >−</button>
                    <span className="text-white font-bold text-lg w-8 text-center">{voidQty}</span>
                    <button
                      type="button"
                      onClick={() => setVoidQty(q => Math.min(voidModal.maxQty, q + 1))}
                      className="w-8 h-8 flex items-center justify-center bg-gray-800 border border-gray-700 rounded-lg text-gray-400 hover:bg-gray-700 hover:text-white transition-colors text-sm font-bold"
                    >+</button>
                    <span className="text-gray-500 text-xs ml-1">of {voidModal.maxQty}</span>
                    {voidQty < voidModal.maxQty && (
                      <button
                        type="button"
                        onClick={() => setVoidQty(voidModal.maxQty)}
                        className="ml-auto text-[10px] px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
                      >All</button>
                    )}
                  </div>
                </div>

                {/* Error */}
                {voidError && (
                  <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-red-400 text-xs">
                    {voidError}
                  </div>
                )}

                <form onSubmit={(e) => { e.preventDefault(); handleVoid(); }}>
                  {/* Password */}
                  <div>
                    <label className="block text-xs text-gray-500 font-semibold mb-1.5">Void Password</label>
                    <input
                      type="password"
                      value={voidPassword}
                      onChange={e => setVoidPassword(e.target.value)}
                      placeholder="Enter void password"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white"
                      autoFocus
                    />
                  </div>

                  {/* Reason */}
                  <div className="mt-4">
                    <label className="block text-xs text-gray-500 font-semibold mb-1.5">Reason</label>
                    <select
                      value={voidReason}
                      onChange={e => setVoidReason(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white"
                    >
                      <option value="">Select reason...</option>
                      <option value="Wrong Order">Wrong Order</option>
                      <option value="Customer Cancelled">Customer Cancelled</option>
                      <option value="Duplicate Entry">Duplicate Entry</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  {/* Buttons */}
                  <div className="flex gap-3 pt-4">
                    <button
                      type="button"
                      onClick={() => setVoidModal(null)}
                      className="flex-1 px-4 py-2.5 text-sm font-semibold border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-800 hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={voiding || !voidPassword || !voidReason}
                      className="flex-1 px-4 py-2.5 text-sm font-bold bg-white text-black rounded-lg hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      {voiding ? 'Voiding...' : 'Confirm Void'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
        {/* Void Password Setup Modal (owner only) */}
        {showPwSetup && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl max-w-sm w-full overflow-hidden shadow-2xl">
              <div className="bg-white px-6 py-5 text-center">
                <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-black/10 flex items-center justify-center">
                  <svg className="w-8 h-8 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                </div>
                <h2 className="text-xl font-black text-black">Void Password Setup</h2>
                <p className="text-gray-600 text-sm mt-1">This password is required to void items</p>
              </div>
              <div className="px-6 py-5 space-y-4">
                {voidPwSet && (
                  <div className="bg-white/5 border border-gray-600 rounded-lg p-3 text-gray-300 text-xs">
                    Password is already set. Enter a new one to change it.
                  </div>
                )}
                {pwError && (
                  <div className="bg-red-900/50 border border-red-800 rounded-lg p-3 text-red-300 text-xs">
                    {pwError}
                  </div>
                )}
                <form onSubmit={async (e) => {
                  e.preventDefault();
                  if (newPw.length < 4) { setPwError('Password must be at least 4 characters'); return; }
                  if (newPw !== confirmPw) { setPwError('Passwords do not match'); return; }
                  setPwSaving(true); setPwError('');
                  try {
                    // Update void password in Firestore for current user
                    const userRef = doc(db, 'users', user.id);
                    await updateDoc(userRef, { void_password: newPw });
                    setVoidPwSet(true);
                    setShowPwSetup(false);
                    setToast('Void password set successfully');
                    setTimeout(() => setToast(''), 3000);
                  } catch (err) {
                    setPwError(err.message || 'Failed to save password');
                  } finally {
                    setPwSaving(false);
                  }
                }}>
                  <div>
                    <label className="block text-xs text-gray-400 font-semibold mb-1.5">New Password</label>
                    <input
                      type="password"
                      value={newPw}
                      onChange={e => setNewPw(e.target.value)}
                      placeholder="Min 4 characters"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-white"
                      autoFocus
                    />
                  </div>
                  <div className="mt-4">
                    <label className="block text-xs text-gray-400 font-semibold mb-1.5">Confirm Password</label>
                    <input
                      type="password"
                      value={confirmPw}
                      onChange={e => setConfirmPw(e.target.value)}
                      placeholder="Re-enter password"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-white"
                    />
                  </div>
                  <div className="flex gap-3 pt-4">
                    <button
                      type="button"
                      onClick={() => setShowPwSetup(false)}
                      className="flex-1 px-4 py-2.5 text-sm font-semibold border border-white/20 text-white rounded-lg hover:bg-white/10 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={pwSaving || !newPw || !confirmPw}
                      className="flex-1 px-4 py-2.5 text-sm font-bold bg-white text-black rounded-lg hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      {pwSaving ? 'Saving...' : 'Save Password'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Delete Sale Authorization Modal (owner only) */}
        {deleteModal && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-sm w-full overflow-hidden shadow-2xl">
              {/* Header - Black with red accent */}
              <div className="bg-black px-6 py-5 text-center border-b border-red-600">
                <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-red-600/20 flex items-center justify-center">
                  <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <h2 className="text-xl font-black text-white">Delete Sale</h2>
                <p className="text-gray-500 text-sm mt-1">Owner authorization required</p>
              </div>

              {/* Body */}
              <div className="px-6 py-5 space-y-4">
                {/* Sale Info */}
                <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                  <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Sale to Delete</p>
                  <p className="text-white font-bold mt-1">Sale #{deleteModal.saleId} {deleteModal.tableNumber ? `(Table ${deleteModal.tableNumber})` : '(Walk-in)'}</p>
                </div>

                <div className="flex items-start gap-2 bg-red-900/20 border border-red-800/40 rounded-lg p-3">
                  <svg className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <p className="text-xs text-red-400">This action cannot be undone. The sale will be permanently removed from the system.</p>
                </div>

                {/* Error */}
                {deleteError && (
                  <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-red-400 text-xs">
                    {deleteError}
                  </div>
                )}

                <form onSubmit={(e) => { e.preventDefault(); handleDeleteSale(); }}>
                  {/* Password */}
                  <div>
                    <label className="block text-xs text-gray-500 font-semibold mb-1.5">Void Password</label>
                    <input
                      type="password"
                      value={deletePassword}
                      onChange={e => setDeletePassword(e.target.value)}
                      placeholder="Enter void password"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-red-500"
                      autoFocus
                    />
                  </div>

                  {/* Buttons */}
                  <div className="flex gap-3 pt-4">
                    <button
                      type="button"
                      onClick={() => setDeleteModal(null)}
                      className="flex-1 px-4 py-2.5 text-sm font-semibold border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-800 hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={deleting || !deletePassword}
                      className="flex-1 px-4 py-2.5 text-sm font-bold bg-red-600 text-white rounded-lg hover:bg-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      {deleting ? 'Deleting...' : 'Delete Sale'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </Layout>

      {viewReceipt && (
        <Receipt
          data={{
            table_number: viewReceipt.table_number,
            table_cost: viewReceipt.table_cost,
            food_items: (viewReceipt.items && viewReceipt.items.length > 0) ? viewReceipt.items : (viewReceipt.food_items || []),
            food_total: viewReceipt.food_total || (viewReceipt.food_items ? viewReceipt.food_items.reduce((sum, i) => sum + (i.price * i.quantity), 0) : 0) || (viewReceipt.items ? viewReceipt.items.reduce((sum, i) => sum + (i.price * i.quantity), 0) : 0),
            total: viewReceipt.total,
            received: parseFloat(viewReceipt.received || viewReceipt.total || 0),
            change: parseFloat(viewReceipt.received || viewReceipt.total || 0) - parseFloat(viewReceipt.total),
            cashier: viewReceipt.cashier,
            sale_date: viewReceipt.end_time || viewReceipt.date,
            payment_mode: viewReceipt.payment_mode,
            // Table time details
            set_hours: viewReceipt.set_hours,
            start_time: viewReceipt.start_time,
            end_time: viewReceipt.end_time,
            elapsed_seconds: viewReceipt.elapsed_seconds || (viewReceipt.set_hours ? viewReceipt.set_hours * 3600 : 0),
            // Exhibition match details
            category: viewReceipt.category,
            details: viewReceipt.details,
          }}
          onClose={() => setViewReceipt(null)}
        />
      )}

      {/* Success Toast */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[70] bg-black text-white px-5 py-2.5 rounded-lg text-sm font-bold shadow-lg">
          {toast}
        </div>
      )}
    </>

  );
}
