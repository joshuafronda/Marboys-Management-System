export default function Receipt({ data, onClose }) {
  const receiptDate = data.sale_date ? new Date(data.sale_date) : new Date();
  const dateStr = receiptDate.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = receiptDate.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: true });

  const handlePrint = () => window.print();

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
      <div className="bg-white text-black w-full max-w-xs rounded-lg overflow-hidden">
        {/* Receipt Content */}
        <div id="receipt-content" className="p-6 font-mono text-sm">
          {/* Header */}
          <div className="text-center border-b-2 border-black pb-4 mb-4">
            <p className="text-2xl font-black">MARBOYS</p>
            <p className="text-xs font-bold uppercase tracking-widest">Batangas City</p>
            <p className="text-xs mt-1">Official Receipt</p>
          </div>

          {/* Info */}
          <div className="text-xs mb-4 space-y-1">
            <div className="flex justify-between">
              <span>Date:</span><span>{dateStr}</span>
            </div>
            <div className="flex justify-between">
              <span>Time:</span><span>{timeStr}</span>
            </div>
            <div className="flex justify-between">
              <span>Cashier:</span><span>{data.cashier}</span>
            </div>
            {data.table_number && (
              <div className="flex justify-between font-bold">
                <span>Table:</span><span>#{data.table_number}</span>
              </div>
            )}
          </div>

          {/* Dashed separator */}
          <div className="border-t border-dashed border-black my-3"></div>

          {/* Table cost */}
          {data.table_cost > 0 && (
            <div className="flex justify-between text-xs mb-1">
              <span>Table Time</span>
              <span>₱{parseFloat(data.table_cost).toFixed(2)}</span>
            </div>
          )}

          {/* Food items */}
          {data.food_items && data.food_items.map((item, i) => (
            <div key={i} className="text-xs mb-1">
              <div className="flex justify-between">
                <span className="flex-1 mr-2">{item.food_name}</span>
                <span>₱{(item.price * item.quantity).toFixed(2)}</span>
              </div>
              <div className="text-gray-500 pl-2">
                {item.quantity} × ₱{parseFloat(item.price).toFixed(2)}
              </div>
            </div>
          ))}

          {/* Totals */}
          <div className="border-t border-dashed border-black mt-3 pt-3 space-y-1">
            <div className="flex justify-between text-sm font-black">
              <span>TOTAL</span>
              <span>₱{parseFloat(data.total).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span>Cash Received</span>
              <span>₱{parseFloat(data.received).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs font-bold">
              <span>Change</span>
              <span>₱{parseFloat(data.change).toFixed(2)}</span>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-dashed border-black mt-4 pt-4 text-center text-xs">
            <p className="font-bold">Thank you!</p>
            <p className="text-gray-500 mt-1">Come back and play again!</p>
          </div>
        </div>

        {/* Actions */}
        <div className="bg-gray-100 p-3 flex gap-2 no-print">
          <button
            id="print-receipt-btn"
            onClick={handlePrint}
            className="bg-black text-white px-4 py-2 rounded-lg text-sm font-bold flex-1 hover:bg-gray-900"
          >
            🖨 Print
          </button>
          <button
            id="close-receipt-btn"
            onClick={onClose}
            className="bg-gray-200 text-black px-4 py-2 rounded-lg text-sm font-medium flex-1 hover:bg-gray-300"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
