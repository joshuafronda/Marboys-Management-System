import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Users, Clock, TrendingUp, Calendar, Coffee, UtensilsCrossed, Download, Eye, EyeOff } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// Helper to get current date in Philippines timezone (UTC+8)
function getPhilippinesDate() {
  return new Date().toLocaleString('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).split(',')[0];
}

function StatCard({ label, value, sub, icon: Icon }) {
  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 mb-2">
        {Icon && <Icon className="w-4 h-4 text-gray-500" />}
        <p className="text-xs text-gray-500 uppercase tracking-widest font-semibold">{label}</p>
      </div>
      <p className="text-3xl font-black text-white">{value}</p>
      {sub && <p className="text-xs text-gray-600 mt-1">{sub}</p>}
    </div>
  );
}

export default function OwnerDashboard() {
  const { token } = useAuth();
  const [todaySales, setTodaySales] = useState([]);
  const [monthData, setMonthData] = useState({ totalRevenue: 0, count: 0 });
  const [bestSelling, setBestSelling] = useState([]);
  const [foods, setFoods] = useState([]);
  const [chartData, setChartData] = useState(null);
  const [chartRange, setChartRange] = useState('week');
  const [expandedSale, setExpandedSale] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState(getPhilippinesDate()); // empty string = all time
  const [showMonthSales, setShowMonthSales] = useState(false);
  const [showMonthSummary, setShowMonthSummary] = useState(false);
  const todayStr = getPhilippinesDate();

  const h = { headers: { Authorization: `Bearer ${token}` } };

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const params = new URLSearchParams({ limit: 100 });
        if (dateFilter) params.append('date', dateFilter);
        const [todayRes, monthRes, bestRes, foodsRes, chartRes] = await Promise.all([
          axios.get(`/api/sales/all?${params}`, h),
          axios.get('/api/sales/month', h),
          axios.get('/api/sales/best-selling', h),
          axios.get('/api/foods', h),
          axios.get(`/api/sales/chart?range=${chartRange}`, h),
        ]);
        setTodaySales(todayRes.data);
        setMonthData(monthRes.data);
        setBestSelling(bestRes.data);
        setFoods(foodsRes.data);
        setChartData(chartRes.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [chartRange, dateFilter]);

  // Calculate separate food and drink totals
  const drinkCategories = ['Beverages', 'Coffee & Tea', 'Beers', 'Beer Buckets (6 Bottles + Pulutan)', 'Liquors', 'Wines & Spirits', 'Marboys Batangas Cocktails'];
  const foodCategorySet = new Set(foods.filter(f => !drinkCategories.includes(f.category)).map(f => f.id));
  const drinkCategorySet = new Set(foods.filter(f => drinkCategories.includes(f.category)).map(f => f.id));
  
  let todayFoodSales = 0;
  let todayDrinkSales = 0;
  
  todaySales.forEach(sale => {
    if (sale.items && sale.items.length > 0) {
      sale.items.forEach(item => {
        const itemTotal = item.price * item.quantity;
        if (drinkCategorySet.has(item.food_id)) {
          todayDrinkSales += itemTotal;
        } else {
          todayFoodSales += itemTotal;
        }
      });
    }
  });
  
  const todayTableSales = todaySales.reduce((s, sale) => s + parseFloat(sale.table_cost || 0), 0);
  const todayTotal = todayTableSales + todayFoodSales + todayDrinkSales;
  const formattedDate = dateFilter 
    ? new Date(dateFilter).toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : 'All Time';

  const downloadTodaySales = () => {
    const doc = new jsPDF();

    // Header
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('MARBOYS - Transactions Report', 14, 20);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Date: ${formattedDate}`, 14, 28);
    doc.text(`Total Sales: ${todayTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })} PHP`, 14, 34);
    doc.text(`Transactions: ${todaySales.length}`, 14, 40);

    // Table data
    const tableData = todaySales.map(sale => {
      const foodTotal = sale.items?.reduce((sum, item) => {
        const itemTotal = item.price * item.quantity;
        return drinkCategorySet.has(item.food_id) ? sum : sum + itemTotal;
      }, 0) || 0;

      const drinkTotal = sale.items?.reduce((sum, item) => {
        const itemTotal = item.price * item.quantity;
        return drinkCategorySet.has(item.food_id) ? sum + itemTotal : sum;
      }, 0) || 0;

      return [
        sale.end_time
          ? new Date(sale.end_time).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true })
          : '-',
        sale.table_number ? `Table ${sale.table_number}` : 'Walk-in',
        sale.table_cost > 0 ? sale.table_cost.toFixed(2) : '-',
        foodTotal > 0 ? foodTotal.toFixed(2) : '-',
        drinkTotal > 0 ? drinkTotal.toFixed(2) : '-',
        sale.total.toFixed(2),
      ];
    });

    // Add total row
    const totalFood = tableData.reduce((sum, row) => sum + (row[3] !== '-' ? parseFloat(row[3]) : 0), 0);
    const totalDrinks = tableData.reduce((sum, row) => sum + (row[4] !== '-' ? parseFloat(row[4]) : 0), 0);
    const totalTable = tableData.reduce((sum, row) => sum + (row[2] !== '-' ? parseFloat(row[2]) : 0), 0);
    const grandTotal = totalTable + totalFood + totalDrinks;

    tableData.push([
      '',
      'TOTAL',
      totalTable.toFixed(2),
      totalFood.toFixed(2),
      totalDrinks.toFixed(2),
      grandTotal.toFixed(2),
    ]);

    autoTable(doc, {
      startY: 48,
      head: [['Time', 'Type', 'Table Time (PHP)', 'Food (PHP)', 'Drinks (PHP)', 'Total (PHP)']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [0, 0, 0], textColor: 255 },
      styles: { fontSize: 9, cellPadding: 3 },
      didParseCell: (data) => {
        // Bold and red the total row
        if (data.row.index === tableData.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [255, 200, 200];
          data.cell.styles.textColor = [0, 0, 0];
        }
      },
    });

    doc.save(`marboys-owner-transactions-${dateFilter || 'all'}.pdf`);
  };

  return (
    <Layout>
      <div className="page-enter">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-black text-white">Owner Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">{formattedDate}</p>
        </div>

        {loading ? (
          <div className="text-gray-500 text-sm">Loading dashboard data...</div>
        ) : (
          <>
            {/* Stats Row - Owner sees more detailed breakdown */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
              <StatCard
                label="Sales Today"
                value={`₱${todayTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`}
                sub={`${todaySales.length} transaction${todaySales.length !== 1 ? 's' : ''}`}
                icon={TrendingUp}
              />
              <StatCard
                label="Table Revenue Today"
                value={`₱${todayTableSales.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`}
                sub="Billiard table time"
                icon={Clock}
              />
              <StatCard
                label="Food Sales Today"
                value={`₱${todayFoodSales.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`}
                sub="Food items only"
                icon={UtensilsCrossed}
              />
              <StatCard
                label="Drink Sales Today"
                value={`₱${todayDrinkSales.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`}
                sub="Beverages & drinks"
                icon={Coffee}
              />
              <div className="card p-6 relative">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-4 h-4 text-gray-500" />
                  <p className="text-xs text-gray-500 uppercase tracking-widest font-semibold">Sales This Month</p>
                  <button
                    onClick={() => setShowMonthSales(!showMonthSales)}
                    className="ml-auto p-1 hover:bg-gray-800 rounded transition-colors"
                  >
                    {showMonthSales ? <EyeOff className="w-4 h-4 text-gray-500" /> : <Eye className="w-4 h-4 text-gray-500" />}
                  </button>
                </div>
                <p className="text-3xl font-black text-white">
                  {showMonthSales
                    ? `₱${(monthData.totalRevenue || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
                    : '₱••••••'}
                </p>
                <p className="text-xs text-gray-600 mt-1">{monthData.count} transactions</p>
              </div>
            </div>

            {/* Sales Trend Chart - Owner Analytics */}
            <div className="card p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-accent" />
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">Sales Analytics</h2>
                </div>
                <div className="flex bg-gray-900 rounded-lg p-1">
                  <button
                    onClick={() => setChartRange('week')}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                      chartRange === 'week' ? 'bg-white text-black' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    7 Days
                  </button>
                  <button
                    onClick={() => setChartRange('month')}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                      chartRange === 'month' ? 'bg-white text-black' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    This Month
                  </button>
                </div>
              </div>
              {chartData && (
                <div className="h-64">
                  <Line
                    data={{
                      labels: chartData.data.map(d => d.date),
                      datasets: [
                        {
                          label: 'Total Sales',
                          data: chartData.data.map(d => d.total),
                          borderColor: 'var(--accent)',
                          backgroundColor: 'rgba(255, 255, 255, 0.1)',
                          fill: true,
                          tension: 0.4,
                          pointRadius: 4,
                          pointBackgroundColor: 'var(--accent)',
                        },
                        {
                          label: 'Table Sales',
                          data: chartData.data.map(d => d.tableTotal),
                          borderColor: '#60a5fa',
                          backgroundColor: 'transparent',
                          tension: 0.4,
                          pointRadius: 3,
                        },
                        {
                          label: 'Food Sales',
                          data: chartData.data.map(d => d.foodTotal),
                          borderColor: '#fbbf24',
                          backgroundColor: 'transparent',
                          tension: 0.4,
                          pointRadius: 3,
                        },
                      ],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          labels: { color: '#9ca3af', usePointStyle: true, font: { size: 11 } }
                        },
                        tooltip: {
                          backgroundColor: 'rgba(0, 0, 0, 0.8)',
                          callbacks: {
                            label: (context) => `${context.dataset.label}: ₱${context.parsed.y.toFixed(2)}`,
                          },
                        },
                      },
                      scales: {
                        x: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#6b7280', font: { size: 10 } } },
                        y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#6b7280', callback: (v) => '₱' + v } },
                      },
                    }}
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Best Selling Items */}
              <div className="card p-6">
                <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4">Top Selling Items (All Time)</h2>
                {bestSelling.length === 0 ? (
                  <p className="text-gray-600 text-sm">No sales recorded yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800">
                          <th className="text-left py-2 text-gray-500 font-semibold text-xs uppercase">#</th>
                          <th className="text-left py-2 text-gray-500 font-semibold text-xs uppercase">Item</th>
                          <th className="text-right py-2 text-gray-500 font-semibold text-xs uppercase">Sold</th>
                          <th className="text-right py-2 text-gray-500 font-semibold text-xs uppercase">Revenue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bestSelling.slice(0, 8).map((item, i) => (
                          <tr key={item.food_id} className="border-b border-gray-900 hover:bg-gray-900/50">
                            <td className="py-2 text-gray-600 font-bold">{i + 1}</td>
                            <td className="py-2 text-white font-medium">{item.food_name}</td>
                            <td className="py-2 text-right text-gray-400">{item.total_sold}</td>
                            <td className="py-2 text-right text-white font-semibold">
                              ₱{parseFloat(item.total_revenue).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Monthly Performance */}
              <div className="card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">This Month Summary</h2>
                  <button
                    onClick={() => setShowMonthSummary(!showMonthSummary)}
                    className="p-1 hover:bg-gray-800 rounded transition-colors"
                  >
                    {showMonthSummary ? <EyeOff className="w-4 h-4 text-gray-500" /> : <Eye className="w-4 h-4 text-gray-500" />}
                  </button>
                </div>
                <div className="space-y-4">
                  <div className="flex justify-between items-center py-3 border-b border-gray-900">
                    <span className="text-gray-400 text-sm">Total Revenue</span>
                    <span className="text-2xl font-black text-white">
                      {showMonthSummary
                        ? `₱${(monthData.totalRevenue || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
                        : '₱••••••'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-3 border-b border-gray-900">
                    <span className="text-gray-400 text-sm">Transactions</span>
                    <span className="text-xl font-bold text-white">{monthData.count || 0}</span>
                  </div>
                  <div className="flex justify-between items-center py-3 border-b border-gray-900">
                    <span className="text-gray-400 text-sm">Average Sale</span>
                    <span className="text-lg font-semibold text-white">
                      {showMonthSummary
                        ? `₱${monthData.count > 0 ? (monthData.totalRevenue / monthData.count).toFixed(2) : '0.00'}`
                        : '₱••••'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-3">
                    <span className="text-gray-400 text-sm">Today's Contribution</span>
                    <span className="text-lg font-semibold text-accent">
                      {showMonthSummary
                        ? `${monthData.totalRevenue > 0 ? ((todayTotal / monthData.totalRevenue) * 100).toFixed(1) : 0}%`
                        : '••%'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Detailed Transactions - Owner gets full breakdown */}
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-4">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">Detailed Transactions</h2>
                  <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-1.5 border border-gray-700">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <input
                      type="date"
                      value={dateFilter}
                      onChange={(e) => setDateFilter(e.target.value)}
                      className="bg-transparent text-white text-xs focus:outline-none"
                    />
                  </div>
                  {/* Quick filter buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setDateFilter(todayStr)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${dateFilter === todayStr ? 'bg-white text-black border-white' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}
                    >
                      Today
                    </button>
                    <button
                      onClick={() => setDateFilter('')}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${!dateFilter ? 'bg-white text-black border-white' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}
                    >
                      All Time
                    </button>
                  </div>
                </div>
                {todaySales.length > 0 && (
                  <button
                    onClick={downloadTodaySales}
                    className="flex items-center gap-2 text-xs px-3 py-1.5 bg-white text-black font-bold rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Download PDF
                  </button>
                )}
              </div>
              {todaySales.length === 0 ? (
                <p className="text-gray-600 text-sm">No transactions for selected date.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-gray-800">
                      <tr>
                        <th className="text-left py-2 text-gray-500 font-semibold text-xs uppercase">Time</th>
                        <th className="text-left py-2 text-gray-500 font-semibold text-xs uppercase">Type</th>
                        <th className="text-right py-2 text-gray-500 font-semibold text-xs uppercase">Table</th>
                        <th className="text-right py-2 text-gray-500 font-semibold text-xs uppercase">Food</th>
                        <th className="text-right py-2 text-gray-500 font-semibold text-xs uppercase">Drinks</th>
                        <th className="text-right py-2 text-gray-500 font-semibold text-xs uppercase">Total</th>
                        <th className="text-center py-2 text-gray-500 font-semibold text-xs uppercase"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {todaySales.map(sale => (
                        <React.Fragment key={sale.id}>
                          <tr className="border-b border-gray-900/50 hover:bg-gray-900/30">
                            <td className="py-3 text-gray-400 text-xs">{sale.end_time?.slice(11, 16)}</td>
                            <td className="py-3 text-white font-medium">
                              {sale.table_number ? (
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3 text-blue-400" />Table {sale.table_number}
                                </span>
                              ) : (
                                <span className="flex items-center gap-1">
                                  <Users className="w-3 h-3 text-amber-400" />Walk-in
                                </span>
                              )}
                            </td>
                            <td className="py-3 text-right">
                              {parseFloat(sale.table_cost || 0) > 0 ? (
                                <span className="text-blue-400">₱{parseFloat(sale.table_cost).toFixed(2)}</span>
                              ) : <span className="text-gray-600">-</span>}
                            </td>
                            <td className="py-3 text-right">
                              {(() => {
                                const foodTotal = sale.items?.reduce((sum, item) => {
                                  return drinkCategorySet.has(item.food_id) ? sum : sum + (item.price * item.quantity);
                                }, 0) || 0;
                                return foodTotal > 0 ? (
                                  <span className="text-amber-400">₱{foodTotal.toFixed(2)}</span>
                                ) : (
                                  <span className="text-gray-600">-</span>
                                );
                              })()}
                            </td>
                            <td className="py-3 text-right">
                              {(() => {
                                const drinkTotal = sale.items?.reduce((sum, item) => {
                                  return drinkCategorySet.has(item.food_id) ? sum + (item.price * item.quantity) : sum;
                                }, 0) || 0;
                                return drinkTotal > 0 ? (
                                  <span className="text-blue-400">₱{drinkTotal.toFixed(2)}</span>
                                ) : (
                                  <span className="text-gray-600">-</span>
                                );
                              })()}
                            </td>
                            <td className="py-3 text-right text-white font-bold">₱{parseFloat(sale.total).toFixed(2)}</td>
                            <td className="py-3 text-center">
                              {(sale.items?.length > 0 || parseFloat(sale.table_cost) > 0) && (
                                <button
                                  onClick={() => setExpandedSale(expandedSale === sale.id ? null : sale.id)}
                                  className="text-gray-500 hover:text-white transition-colors"
                                >
                                  <svg className={`w-4 h-4 transform transition-transform ${expandedSale === sale.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </button>
                              )}
                            </td>
                          </tr>
                          {expandedSale === sale.id && (
                            <tr>
                              <td colSpan="7" className="py-0">
                                <div className="bg-gray-900/50 px-4 py-3 mb-2 rounded-lg">
                                  {parseFloat(sale.table_cost) > 0 && (
                                    <div className="mb-3 pb-3 border-b border-gray-800">
                                      <p className="text-xs text-gray-500 uppercase mb-2">Table Time</p>
                                      <div className="flex justify-between text-sm">
                                        <span className="text-gray-400">
                                          {sale.start_time?.slice(11, 16)} - {sale.end_time?.slice(11, 16)}
                                          {sale.set_hours > 0 && <span className="text-gray-600 ml-2">({sale.set_hours} hrs)</span>}
                                        </span>
                                        <span className="text-blue-400 font-medium">₱{parseFloat(sale.table_cost).toFixed(2)}</span>
                                      </div>
                                    </div>
                                  )}
                                  {sale.items?.length > 0 && (
                                    <div>
                                      <p className="text-xs text-gray-500 uppercase mb-2">Items</p>
                                      {sale.items.map((item, idx) => (
                                        <div key={idx} className="flex justify-between text-sm">
                                          <span className="text-gray-300">{item.food_name} <span className="text-gray-500">× {item.quantity}</span></span>
                                          <span className="text-amber-400">₱{(item.price * item.quantity).toFixed(2)}</span>
                                        </div>
                                      ))}
                                      <div className="flex justify-between text-sm mt-2 pt-2 border-t border-gray-800">
                                        <span className="text-gray-500">Subtotal</span>
                                        <span className="text-amber-400 font-medium">₱{parseFloat(sale.food_total).toFixed(2)}</span>
                                      </div>
                                    </div>
                                  )}
                                  <div className="mt-3 pt-2 border-t border-gray-800 text-xs text-gray-600">Cashier: {sale.cashier}</div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                    <tfoot className="border-t border-gray-800">
                      <tr>
                        <td colSpan="2" className="py-3 text-gray-500 text-xs uppercase font-semibold">Total ({todaySales.length})</td>
                        <td className="py-3 text-right text-blue-400 font-bold">₱{todayTableSales.toFixed(2)}</td>
                        <td className="py-3 text-right text-amber-400 font-bold">₱{todayFoodSales.toFixed(2)}</td>
                        <td className="py-3 text-right text-blue-400 font-bold">₱{todayDrinkSales.toFixed(2)}</td>
                        <td className="py-3 text-right text-white font-black">₱{todayTotal.toFixed(2)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
