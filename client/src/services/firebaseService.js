import { db } from '../firebase';
import { 
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, 
  addDoc, query, where, orderBy, limit, writeBatch, increment,
  serverTimestamp, onSnapshot
} from 'firebase/firestore';

// ========== FOODS ==========
export async function getFoods() {
  const snap = await getDocs(collection(db, 'foods'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addFood(foodData) {
  const docRef = await addDoc(collection(db, 'foods'), {
    ...foodData,
    createdAt: serverTimestamp()
  });
  return { id: docRef.id, ...foodData };
}

export async function updateFood(id, foodData) {
  await updateDoc(doc(db, 'foods', id), foodData);
  return { id, ...foodData };
}

export async function deleteFood(id) {
  await deleteDoc(doc(db, 'foods', id));
  return { id };
}

// ========== TABLES ==========
export async function getTables() {
  const snap = await getDocs(collection(db, 'tables'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function updateTable(id, tableData) {
  await updateDoc(doc(db, 'tables', id), tableData);
  return { id, ...tableData };
}

export async function resetTable(id) {
  await updateDoc(doc(db, 'tables', id), {
    status: 'available',
    start_time: null,
    pause_time: null,
    accumulated_seconds: 0,
    cart_items: [],
    set_hours: 0,
    exhibition_bet: 0,
    exhibition_custom_fee: null,
  });
  return { id };
}

// ========== SALES ==========
export async function createSale(saleData) {
  const saleRef = await addDoc(collection(db, 'sales'), {
    ...saleData,
    createdAt: serverTimestamp()
  });
  
  // Add sale items
  if (saleData.food_items && saleData.food_items.length > 0) {
    const batch = writeBatch(db);
    for (const item of saleData.food_items) {
      const itemRef = doc(collection(db, 'sale_items'));
      batch.set(itemRef, {
        sale_id: saleRef.id,
        ...item,
        createdAt: serverTimestamp()
      });
    }
    await batch.commit();
  }
  
  return { id: saleRef.id, ...saleData };
}

export async function getSalesByDate(date) {
  const q = query(collection(db, 'sales'), where('date', '==', date), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getAllSales() {
  const snap = await getDocs(query(collection(db, 'sales'), orderBy('createdAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function deleteSale(id) {
  // Delete associated sale items first
  const itemsQuery = query(collection(db, 'sale_items'), where('sale_id', '==', id));
  const itemsSnap = await getDocs(itemsQuery);
  const batch = writeBatch(db);
  itemsSnap.docs.forEach(d => batch.delete(d.ref));
  batch.delete(doc(db, 'sales', id));
  await batch.commit();
  return { id };
}

// ========== SALE ITEMS ==========
export async function getSaleItems(saleId) {
  const q = query(collection(db, 'sale_items'), where('sale_id', '==', saleId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function voidSaleItem(itemId, voidData) {
  await updateDoc(doc(db, 'sale_items', itemId), {
    voided: true,
    void_reason: voidData.reason,
    voided_by: voidData.authorized_by,
    voided_at: serverTimestamp()
  });
  return { id: itemId };
}

// ========== DAILY STOCK ==========
export async function getDailyStock() {
  const snap = await getDocs(query(collection(db, 'daily_stock_inventory'), orderBy('stock_date', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getDailyStockByDate(date) {
  const q = query(collection(db, 'daily_stock_inventory'), where('stock_date', '==', date));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addDailyStock(record) {
  const docRef = await addDoc(collection(db, 'daily_stock_inventory'), {
    ...record,
    created_at: new Date().toISOString()
  });
  return { id: docRef.id, ...record };
}

export async function updateDailyStock(id, record) {
  await updateDoc(doc(db, 'daily_stock_inventory', id), record);
  return { id, ...record };
}

export async function deleteDailyStock(id) {
  await deleteDoc(doc(db, 'daily_stock_inventory', id));
  return { id };
}

// ========== VOID PASSWORD ==========
export async function setVoidPassword(userId, passwordHash) {
  await updateDoc(doc(db, 'users', userId), { void_password: passwordHash });
  return { userId };
}

export async function verifyVoidPassword(password) {
  // Get all users and check password (client-side for now, should use Cloud Function for security)
  const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'owner')));
  const owners = snap.docs.map(d => d.data());
  const owner = owners.find(o => o.void_password === password);
  return !!owner;
}

// ========== REALTIME SUBSCRIPTIONS ==========
export function subscribeToTables(callback) {
  return onSnapshot(collection(db, 'tables'), (snap) => {
    const tables = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(tables);
  });
}

export function subscribeToFoods(callback) {
  return onSnapshot(collection(db, 'foods'), (snap) => {
    const foods = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(foods);
  });
}

export function subscribeToSales(callback) {
  return onSnapshot(collection(db, 'sales'), (snap) => {
    const sales = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(sales);
  });
}

export default {
  getFoods, addFood, updateFood, deleteFood,
  getTables, updateTable, resetTable,
  createSale, getSalesByDate, getAllSales, deleteSale,
  getSaleItems, voidSaleItem,
  getDailyStock, getDailyStockByDate, addDailyStock, updateDailyStock, deleteDailyStock,
  setVoidPassword, verifyVoidPassword,
  subscribeToTables, subscribeToFoods, subscribeToSales
};
