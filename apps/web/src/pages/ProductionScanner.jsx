
import React, { useEffect, useState, useRef } from 'react';
import { useAccount } from '../context/AccountContext';
import { db } from '../db/db';
import { Toaster, toast } from 'sonner';
import { Scan, Package, Check, AlertTriangle, Printer, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/button';


const ProductionScanner = () => {
    const { activeAccount } = useAccount();
    const [scannedData, setScannedData] = useState('');
    const [lastScan, setLastScan] = useState(null);
    const [scanHistory, setScanHistory] = useState([]);

    // HID Scanner Listener
    // Scanners usually emulate a keyboard: Type characters -> Press Enter.
    useEffect(() => {
        let buffer = '';
        let timer = null;

        const handleKeyDown = (e) => {
            if (e.key === 'Enter') {
                if (buffer.length > 2) { // Minimum length to avoid noise
                    handleScan(buffer);
                }
                buffer = '';
                clearTimeout(timer);
            } else if (e.key.length === 1) { // Regular char
                buffer += e.key;
                // Reset buffer if typing stops (prevent random keypresses from accumulating)
                clearTimeout(timer);
                timer = setTimeout(() => { buffer = ''; }, 100);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleScan = async (code) => {
        const timestamp = new Date().toLocaleTimeString();

        // 1. Identify Scan Type
        let type = 'unknown';
        let details = null;
        let success = false;

        // Try Order ID (Simple numeric or #123)
        if (code.startsWith('#') || !isNaN(code)) {
            const id = code.replace('#', '');
            const order = await db.orders.get(parseInt(id));
            if (order) {
                type = 'order';
                details = `Order #${order.id} - ${order.status}`;
                success = true;
                // Logic: Open Order Modal or Auto-Pack?
                toast.success(`Order #${id} Scanned!`);
            }
        }

        // Try SKU (Alpha-numeric)
        if (type === 'unknown') {
            const product = await db.products.where('sku').equals(code).first();
            if (product) {
                type = 'product';
                details = `${product.name} (${product.stock_quantity})`;
                success = true;
                toast.success(`Product Scanned: ${product.name}`);
            }
        }

        const scanEvent = { code, type, details, timestamp, success };
        setLastScan(scanEvent);
        setScanHistory(prev => [scanEvent, ...prev].slice(0, 10)); // Keep last 10
    };

    return (
        <div className="min-h-screen bg-black text-green-400 font-mono p-6 flex flex-col">
            <Toaster position="top-center" theme="dark" />

            {/* Header */}
            <div className="flex justify-between items-center border-b border-green-900 pb-4 mb-6">
                <div className="flex items-center gap-4">
                    <Scan size={32} />
                    <h1 className="text-2xl font-bold tracking-wider">TERMINAL // SCANNER</h1>
                </div>
                <Link to="/">
                    <Button variant="ghost" className="text-green-600 hover:text-green-400 hover:bg-green-900/20">
                        <ArrowLeft className="mr-2" size={16} /> EXIT
                    </Button>
                </Link>
            </div>

            {/* Main Display */}
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-8">

                {/* Active Scan Area */}
                <div className="flex flex-col items-center justify-center border-2 border-dashed border-green-900 rounded-xl p-10 bg-green-950/10">
                    {lastScan ? (
                        <div className="text-center space-y-4 animate-in zoom-in duration-200">
                            {lastScan.success ? (
                                <Check size={80} className="mx-auto text-green-500" />
                            ) : (
                                <AlertTriangle size={80} className="mx-auto text-yellow-500" />
                            )}
                            <h2 className="text-4xl font-black">{lastScan.code}</h2>
                            <p className="text-xl text-green-300">{lastScan.details || 'Unknown Barcode'}</p>
                            <div className="inline-block px-4 py-1 bg-green-900/50 rounded-full text-sm">
                                TYPE: {lastScan.type.toUpperCase()}
                            </div>
                        </div>
                    ) : (
                        <div className="text-center text-green-700 animate-pulse">
                            <Scan size={64} className="mx-auto mb-4 opacity-50" />
                            <h2 className="text-2xl">READY TO SCAN</h2>
                            <p>Waiting for HID Input...</p>
                        </div>
                    )}
                </div>

                {/* Log */}
                <div className="border border-green-900 rounded-xl overflow-hidden bg-black">
                    <div className="bg-green-900/30 p-2 text-center text-sm font-bold border-b border-green-900">
                        SESSION LOG
                    </div>
                    <div className="p-4 space-y-2 max-h-[60vh] overflow-y-auto">
                        {scanHistory.length === 0 && (
                            <div className="text-green-800 text-center italic py-10">No scans yet...</div>
                        )}
                        {scanHistory.map((s, i) => (
                            <div key={i} className="flex items-center justify-between border-b border-green-900/30 pb-2">
                                <div className="flex items-center gap-3">
                                    <span className="text-xs text-green-600 font-mono">{s.timestamp}</span>
                                    {s.type === 'order' && <Package size={14} />}
                                    {s.type === 'product' && <Printer size={14} />}
                                    <span className={s.success ? 'text-green-400' : 'text-yellow-600'}>
                                        {s.code}
                                    </span>
                                </div>
                                <span className="text-xs text-green-700 truncate max-w-[150px]">
                                    {s.details}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="mt-6 text-center text-xs text-green-800">
                OVERSEEK PRODUCTION TERMINAL v1.0 • CONNECTED: {activeAccount?.storeUrl || 'OFFLINE'}
            </div>
        </div>
    );
};

export default ProductionScanner;
