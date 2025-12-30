import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { useAccount } from '../../context/AccountContext';
import { Save, Tag, AlertTriangle, Plus, X } from 'lucide-react';
import { toast } from 'sonner';

const AutoTagSettings = () => {
    const { activeAccount } = useAccount();
    const [selectedTags, setSelectedTags] = useState([]);
    const [availableTags, setAvailableTags] = useState([]);
    const [loading, setLoading] = useState(true);

    // Fetch existing settings
    useEffect(() => {
        if (activeAccount?.features?.autoTaggingRules) {
            setSelectedTags(activeAccount.features.autoTaggingRules || []);
        } else {
            setSelectedTags([]);
        }
    }, [activeAccount]);

    // Fetch unique tags from products to offer as choices
    useEffect(() => {
        const fetchTags = async () => {
            if (!activeAccount) return;
            try {
                const products = await db.products.where('account_id').equals(activeAccount.id).toArray();
                const tagSet = new Set();

                products.forEach(p => {
                    const data = typeof p.data === 'string' ? JSON.parse(p.data) : p.data;
                    if (data.tags && Array.isArray(data.tags)) {
                        data.tags.forEach(t => tagSet.add(t.name || t));
                    }
                });

                setAvailableTags(Array.from(tagSet).sort());
            } catch (e) {
                console.error("Failed to fetch tags", e);
            } finally {
                setLoading(false);
            }
        };
        fetchTags();
    }, [activeAccount]);

    const handleSave = async () => {
        try {
            await db.accounts.update(activeAccount.id, {
                features: {
                    ...activeAccount.features,
                    autoTaggingRules: selectedTags
                }
            });

            // Force reload active account context effectively
            // But AccountContext watches db? Maybe not deeply.
            // Using window.location.reload() for safety as seen in AdminAccounts

            toast.success("Auto-tagging rules saved");

            // Optional: trigger account refresh
            // window.location.reload(); 
        } catch (e) {
            toast.error("Failed to save rules");
            console.error(e);
        }
    };

    const toggleTag = (tag) => {
        if (selectedTags.includes(tag)) {
            setSelectedTags(selectedTags.filter(t => t !== tag));
        } else {
            setSelectedTags([...selectedTags, tag]);
        }
    };

    return (
        <div className="glass-card" style={{ padding: '2rem' }}>
            <h3 className="card-title">
                <Tag size={20} className="text-primary" />
                Order Auto-Tagging
            </h3>

            <div style={{ marginBottom: '1.5rem', color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: '1.5' }}>
                <p>When a new order arrives, if it contains products with any of the selected tags below, the order itself will be tagged with that same tag.</p>
            </div>

            {loading ? (
                <div className="animate-pulse" style={{ height: '100px', background: 'var(--bg-panel)', borderRadius: '8px' }}></div>
            ) : (
                <>
                    <div style={{ marginBottom: '1rem' }}>
                        <label className="input-label">Select Trigger Tags</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', minHeight: '100px', maxHeight: '300px', overflowY: 'auto' }}>
                            {availableTags.length === 0 && (
                                <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No product tags found in your catalog.</p>
                            )}

                            {availableTags.map(tag => {
                                const isSelected = selectedTags.includes(tag);
                                return (
                                    <button
                                        key={tag}
                                        onClick={() => toggleTag(tag)}
                                        style={{
                                            padding: '6px 12px',
                                            borderRadius: '20px',
                                            border: isSelected ? '1px solid var(--primary)' : '1px solid var(--border-glass)',
                                            background: isSelected ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                                            color: isSelected ? 'var(--primary)' : 'var(--text-muted)',
                                            cursor: 'pointer',
                                            fontSize: '0.8rem',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        {tag}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div style={{ padding: '1rem', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.2)', marginBottom: '1.5rem', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                        <Tag size={18} color="#10b981" style={{ marginTop: '2px' }} />
                        <div>
                            <span style={{ color: '#10b981', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Active Rules</span>
                            <div style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>
                                {selectedTags.length === 0 ? 'No tags selected. Feature is effectively idle.' :
                                    `Orders containing products tagged with: ${selectedTags.join(', ')} will be auto-tagged.`
                                }
                            </div>
                        </div>
                    </div>

                    <button onClick={handleSave} className="btn btn-primary">
                        <Save size={18} /> Save Rules
                    </button>
                </>
            )}
        </div>
    );
};

export default AutoTagSettings;
