import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import 'leaflet/dist/leaflet.css';
import { geocodeAddress } from '../services/api';
import { db } from '../db/db';
import { useNavigate } from 'react-router-dom';

// Fix Leaflet Default Icon in React
import L from 'leaflet';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

const CustomerMap = ({ customers }) => {
    const navigate = useNavigate();
    const [geocodedCustomers, setGeocodedCustomers] = useState([]);

    // Effect: Geocode customers that lack stats
    useEffect(() => {
        let isMounted = true;
        const processQueue = async () => {
            const mapped = [];
            // Prioritize customers with existing lat/lng
            const existing = customers.filter(c => c.latitude && c.longitude);
            mapped.push(...existing);

            // Filter those needing geocoding
            const needsGeocoding = customers.filter(c => !c.latitude && (c.billing?.city || c.billing?.country));

            // Limit to first 20 to avoid spamming OSM API on one load
            const queue = needsGeocoding.slice(0, 20);

            for (const c of queue) {
                if (!isMounted) break;
                // Construct address
                const parts = [
                    c.billing.address_1,
                    c.billing.city,
                    c.billing.state,
                    c.billing.country
                ].filter(Boolean);

                const address = parts.join(', ');
                if (!address) continue;

                // Call API (Cached & Rate Limited inside api.js)
                const coords = await geocodeAddress(address);

                if (coords) {
                    // Update Local State
                    const updated = { ...c, latitude: coords.lat, longitude: coords.lng };
                    mapped.push(updated);

                    // Update Helper: Save to DB for future
                    db.customers.update(c.id, { latitude: coords.lat, longitude: coords.lng });
                }
            }
            if (isMounted) setGeocodedCustomers(prev => {
                // Merge preventing duplicates
                const ids = new Set(prev.map(p => p.id));
                const newItems = mapped.filter(m => !ids.has(m.id));
                return [...prev, ...newItems];
            });
        };

        // Initial set of already geocoded
        setGeocodedCustomers(customers.filter(c => c.latitude));

        // Start processing background queue
        if (customers.length > 0) {
            processQueue();
        }

        return () => { isMounted = false; };
    }, [customers]); // Re-run if list changes

    const center = [20, 0]; // World View

    return (
        <div className="glass-panel" style={{ height: '600px', width: '100%', borderRadius: '16px', overflow: 'hidden' }}>
            <MapContainer center={center} zoom={2} style={{ height: '100%', width: '100%' }}>
                <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                />
                {geocodedCustomers.map(c => (
                    <Marker key={c.id} position={[c.latitude, c.longitude]}>
                        <Popup>
                            <div style={{ minWidth: '150px' }}>
                                <strong>{c.first_name} {c.last_name}</strong><br />
                                {c.billing?.city}, {c.billing?.country}<br />
                                <button
                                    style={{ marginTop: '5px', padding: '4px 8px', cursor: 'pointer', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px' }}
                                    onClick={() => navigate(`/customers/${c.id}`)}
                                >
                                    View Profile
                                </button>
                            </div>
                        </Popup>
                    </Marker>
                ))}
            </MapContainer>
        </div>
    );
};

export default CustomerMap;
