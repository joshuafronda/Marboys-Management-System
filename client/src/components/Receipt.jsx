export default function Receipt({ data, onClose }) {
  const receiptDate = data.sale_date ? new Date(data.sale_date) : new Date();
  const dateStr = receiptDate.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = receiptDate.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: true });

  const handlePrint = () => {
    // Create a hidden iframe for printing - this ensures single page and proper content
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.visibility = 'hidden';
    document.body.appendChild(iframe);

    const receiptEl = document.getElementById('receipt-content');
    if (!receiptEl) return;

    // Copy the HTML and preserve Tailwind classes by converting to inline styles
    const html = receiptEl.innerHTML;
    
    const doc = iframe.contentWindow.document;
    doc.write(`<!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Receipt</title>
        <style>
          @page {
            size: 80mm auto;
            margin: 0;
            padding: 0;
          }
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          html, body {
            width: 80mm;
            max-width: 80mm;
            margin: 0;
            padding: 0;
            font-family: 'Courier New', monospace;
            font-size: 10pt;
            color: black;
            background: white;
          }
          body {
            padding: 3mm;
          }
          /* All text bold and black by default */
          body { font-weight: 700 !important; color: black !important; }
          * { font-weight: 700 !important; color: black !important; }
          /* Layout classes */
          .flex { display: flex; justify-content: space-between; align-items: flex-start; }
          .text-center { text-align: center; }
          .font-black { font-weight: 900 !important; }
          .font-bold { font-weight: 700 !important; }
          .font-semibold { font-weight: 700 !important; }
          .text-xs { font-size: 8pt; }
          .text-sm { font-size: 9pt; }
          .text-base { font-size: 10pt; }
          .text-xl { font-size: 12pt; }
          .text-2xl { font-size: 14pt; }
          .text-gray-500, .text-gray-600 { color: #666; }
          .text-red-500 { color: #dc2626; }
          .uppercase { text-transform: uppercase; }
          .tracking-wide { letter-spacing: 0.05em; }
          .tracking-wider { letter-spacing: 0.1em; }
          /* Black borders/lines for consistency */
          .border-t { border-top: 1px dashed black; }
          .border-gray-200 { border-top: 1px solid black; }
          .border-gray-400 { border-top: 1px dashed black; }
          /* Spacing - more generous for cleaner look */
          .pb-2 { padding-bottom: 8px; }
          .pb-3 { padding-bottom: 12px; }
          .mb-1 { margin-bottom: 4px; }
          .mb-2 { margin-bottom: 8px; }
          .mb-3 { margin-bottom: 12px; }
          .mb-4 { margin-bottom: 16px; }
          .mt-1 { margin-top: 4px; }
          .mt-2 { margin-top: 8px; }
          .mt-4 { margin-top: 16px; }
          .pt-1 { padding-top: 4px; }
          .pt-2 { padding-top: 8px; }
          .my-3 { margin-top: 12px; margin-bottom: 12px; }
          .my-4 { margin-top: 16px; margin-bottom: 16px; }
          .space-y-1 > * + * { margin-top: 4px; }
          .space-y-2 > * + * { margin-top: 8px; }
          .pl-2 { padding-left: 8px; }
          .mr-2 { margin-right: 8px; }
          .p-6 { padding: 24px; }
          .flex-1 { flex: 1; min-width: 0; overflow-wrap: break-word; word-wrap: break-word; }
          /* Prevent text overflow */
          * {
            max-width: 100%;
            overflow-wrap: break-word;
            word-wrap: break-word;
          }
          /* No page breaks inside items */
          * {
            page-break-inside: avoid;
          }
        </style>
      </head>
      <body>${html}</body>
      </html>`);
    doc.close();

    // Print the iframe
    iframe.contentWindow.focus();
    iframe.contentWindow.print();

    // Remove iframe after printing
    setTimeout(() => {
      document.body.removeChild(iframe);
    }, 1000);
  };

  // Format time helper
  const formatTimeShort = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  // Format hours to readable string
  const formatHours = (hours) => {
    if (!hours) return '0h';
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    if (h === 0) return `${m}min`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}min`;
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
        <div className="bg-white text-black w-full max-w-xs rounded-lg overflow-hidden">
        {/* Receipt Content */}
        <div id="receipt-content" className="p-6 font-mono text-sm">
          {/* Header */}
          <div className="text-center pb-3 mb-3">
            <p className="text-xl font-black">MARBOYS</p>
            <p className="text-xs font-bold uppercase tracking-wider">Batangas City</p>
            <p className="text-xs mt-1 text-gray-600">Official Receipt</p>
          </div>
          
          {/* Separator */}
          <div className="border-t border-dashed border-gray-400 mb-3"></div>

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

          {/* Separator */}
          <div className="border-t border-dashed border-gray-400 my-3"></div>

          {/* Exhibition Match Details */}
          {data.category === 'exhibition' && (
            <div className="mb-4">
              <div className="text-xs font-bold mb-2 uppercase tracking-wide">Exhibition Match</div>
              <div className="space-y-1 mb-2">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-600">{data.details || 'Table Fee'}</span>
                  <span>₱{parseFloat(data.table_cost).toFixed(2)}</span>
                </div>
              </div>
              <div className="flex justify-between text-xs font-semibold pt-2 mt-2 border-t border-gray-200">
                <span>Table Fee Total</span>
                <span>₱{parseFloat(data.table_cost).toFixed(2)}</span>
              </div>
            </div>
          )}

          {/* Table Time Details */}
          {data.table_cost > 0 && data.category !== 'exhibition' && (
            <div className="mb-4">
              <div className="text-xs font-bold mb-2 uppercase tracking-wide">Table Time</div>
              
              {/* Billing History */}
              {data.billing_history && data.billing_history.length > 0 ? (
                <div className="space-y-1 mb-2">
                  {data.billing_history.map((entry, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="text-gray-600">
                        {i + 1}. {entry.type === 'initial' ? 'Initial' : 'Extension'}
                        {entry.hours && ` (${formatHours(entry.hours)})`}
                      </span>
                      <span>₱{parseFloat(entry.cost || 0).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              ) : data.set_hours > 0 ? (
                <div className="space-y-1 mb-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-600">1. Initial ({formatHours(data.set_hours)})</span>
                    <span>₱{parseFloat(data.table_cost).toFixed(2)}</span>
                  </div>
                </div>
              ) : data.elapsed_seconds > 0 ? (
                <div className="space-y-1 mb-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-600">Time Used: {formatHours(data.elapsed_seconds / 3600)}</span>
                    <span>₱{parseFloat(data.table_cost).toFixed(2)}</span>
                  </div>
                </div>
              ) : null}

              {/* Time Range */}
              {(data.start_time || data.end_time) && (
                <div className="text-[10px] text-gray-500 mb-1">
                  {formatTimeShort(data.start_time)} - {formatTimeShort(data.end_time)}
                </div>
              )}

              {/* Total */}
              <div className="flex justify-between text-xs font-semibold pt-2 mt-2 border-t border-gray-200">
                <span>Table Cost Total</span>
                <span>₱{parseFloat(data.table_cost).toFixed(2)}</span>  
              </div>
            </div>
          )}

          {/* Food items */}
          {data.food_items && data.food_items.length > 0 && (
            <div className="mb-4">
              <div className="text-xs font-bold mb-2 uppercase tracking-wide">Food Orders</div>
              <div className="space-y-1">
                {data.food_items.map((item, i) => (
                  <div key={i} className="text-xs">
                    <div className="flex justify-between">
                      <span className="flex-1 mr-2">{item.food_name}</span>
                      <span>₱{(item.price * item.quantity).toFixed(2)}</span>
                    </div>
                    <div className="text-gray-500 text-[10px] pl-2">
                      {item.quantity} × ₱{parseFloat(item.price).toFixed(2)}
                      {item.voided && <span className="text-red-500 ml-1">(VOIDED)</span>}
                    </div>
                  </div>
                ))}
              </div>
              {data.food_total > 0 && (
                <div className="flex justify-between text-xs font-semibold pt-2 mt-2 border-t border-gray-200">
                  <span>Food Total</span>
                  <span>₱{parseFloat(data.food_total).toFixed(2)}</span>
                </div>
              )}
            </div>
          )}

          {/* Separator */}
          <div className="border-t border-dashed border-gray-400 my-4"></div>
          
          {/* Totals */}
          <div className="space-y-2">
            <div className="flex justify-between text-base font-bold">
              <span>TOTAL</span>
              <span>₱{parseFloat(data.total).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-600">
              <span>Amount Received</span>
              <span>₱{parseFloat(data.received).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs font-semibold">
              <span>Change</span>
              <span>₱{parseFloat(data.change).toFixed(2)}</span>
            </div>
            {data.payment_mode && (
              <div className="flex justify-between text-xs pt-2 mt-2 border-t border-gray-200">
                <span className="text-gray-600">Payment Mode</span>
                <span className="font-semibold">
                  {data.payment_mode === 'Cash' ? 'Cash' : data.payment_mode === 'GCash' ? 'GCash' : data.payment_mode}
                </span>
              </div>
            )}
          </div>


          {/* Separator */}
          <div className="border-t border-dashed border-gray-400 my-4"></div>
          
          {/* Footer */}
          <div className="text-center text-xs pb-2">
            <p className="font-semibold">Thank you!</p>
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
    </>
  );
}
