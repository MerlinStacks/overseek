import React, { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { ClipboardCheck, Plus, Trash2, Check, Square, X } from 'lucide-react';
import { toast } from 'sonner';

const TodoPanel = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [newTodo, setNewTodo] = useState('');
    const dropdownRef = useRef(null);

    const todos = useLiveQuery(() =>
        db.todos.orderBy('created_at').reverse().toArray()
    ) || [];

    // Check for incoming POs
    const incomingPOs = useLiveQuery(() => {
        const today = new Date().toISOString().split('T')[0];
        return db.purchase_orders
            .where('expected_date')
            .equals(today)
            .and(po => po.status !== 'received' && po.status !== 'cancelled')
            .toArray();
    }) || [];

    useEffect(() => {
        const syncPOTodos = async () => {
            if (incomingPOs.length > 0) {
                for (const po of incomingPOs) {
                    const todoText = `Receive PO-${po.id} from Supplier #${po.supplier_id}`;
                    const exists = await db.todos.where('text').equals(todoText).first();

                    if (!exists) {
                        await db.todos.add({
                            text: todoText,
                            done: false,
                            created_at: new Date()
                        });
                        toast.info(`New Task: PO-${po.id} arriving today!`);
                    }
                }
            }
        };
        syncPOTodos();
    }, [incomingPOs]);

    const activeCount = todos.filter(t => !t.done).length;

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const addTodo = async (e) => {
        e.preventDefault();
        if (!newTodo.trim()) return;

        try {
            await db.todos.add({
                text: newTodo,
                done: false,
                created_at: new Date()
            });
            setNewTodo('');
        } catch (error) {
            console.error("Failed to add todo", error);
            toast.error("Failed to add note");
        }
    };

    const toggleTodo = async (todo) => {
        await db.todos.update(todo.id, { done: !todo.done });
    };

    const deleteTodo = async (id) => {
        await db.todos.delete(id);
    };

    const clearCompleted = async () => {
        const completedIds = todos.filter(t => t.done).map(t => t.id);
        await db.todos.bulkDelete(completedIds);
        toast.success("Completed items cleared");
    };

    return (
        <div className="todo-wrapper" ref={dropdownRef} style={{ position: 'relative' }}>
            <button
                className="btn-icon"
                onClick={() => setIsOpen(!isOpen)}
                style={{ position: 'relative', background: isOpen ? 'rgba(255,255,255,0.1)' : 'transparent', color: 'var(--text-main)' }}
                title="To-Do List"
            >
                <ClipboardCheck size={20} />
                {activeCount > 0 && (
                    <span style={{
                        position: 'absolute', top: '-2px', right: '-2px',
                        width: '16px', height: '16px', background: '#ec4899', color: 'white',
                        borderRadius: '50%', border: '2px solid var(--bg-color)',
                        fontSize: '0.65rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold'
                    }}>
                        {activeCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <div className="glass-panel" style={{
                    position: 'absolute', top: '120%', right: 0,
                    width: '320px', padding: '0', zIndex: 100,
                    boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
                    border: '1px solid var(--border-glass)',
                    display: 'flex', flexDirection: 'column'
                }}>
                    <div style={{
                        padding: '12px 16px',
                        borderBottom: '1px solid var(--border-glass)',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        background: 'rgba(255,255,255,0.02)'
                    }}>
                        <h4 style={{ fontWeight: 'bold', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <ClipboardCheck size={16} /> To-Do List
                        </h4>
                        {todos.some(t => t.done) && (
                            <button
                                onClick={clearCompleted}
                                className="btn-icon"
                                style={{ fontSize: '0.75rem', padding: '4px', height: 'auto', width: 'auto', gap: '4px', color: 'var(--text-muted)' }}
                            >
                                Clear Done
                            </button>
                        )}
                    </div>

                    <div style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <form onSubmit={addTodo} style={{ display: 'flex', gap: '8px' }}>
                            <input
                                className="form-input"
                                placeholder="Add new task..."
                                value={newTodo}
                                onChange={e => setNewTodo(e.target.value)}
                                style={{ fontSize: '0.9rem', padding: '8px' }}
                                autoFocus
                            />
                            <button type="submit" className="btn btn-primary" style={{ padding: '0 10px' }}>
                                <Plus size={18} />
                            </button>
                        </form>
                    </div>

                    <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
                        {todos.length > 0 ? (
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                                {todos.map(todo => (
                                    <li
                                        key={todo.id}
                                        style={{
                                            padding: '8px 12px',
                                            borderBottom: '1px solid rgba(255,255,255,0.03)',
                                            display: 'flex', alignItems: 'center', gap: '10px',
                                            background: todo.done ? 'rgba(0,0,0,0.1)' : 'transparent',
                                            transition: 'background 0.2s'
                                        }}
                                        className="todo-item"
                                    >
                                        <button
                                            onClick={() => toggleTodo(todo)}
                                            style={{
                                                background: 'transparent', border: 'none', cursor: 'pointer',
                                                color: todo.done ? 'var(--success)' : 'var(--text-muted)',
                                                display: 'flex', alignItems: 'center'
                                            }}
                                        >
                                            {todo.done ? <Check size={18} /> : <Square size={18} />}
                                        </button>
                                        <span style={{
                                            flex: 1,
                                            fontSize: '0.9rem',
                                            textDecoration: todo.done ? 'line-through' : 'none',
                                            color: todo.done ? 'var(--text-muted)' : 'var(--text-main)',
                                            wordBreak: 'break-word'
                                        }}>
                                            {todo.text}
                                        </span>
                                        <button
                                            onClick={() => deleteTodo(todo.id)}
                                            className="btn-icon"
                                            style={{ color: 'var(--danger)', opacity: 0.5, padding: '4px' }}
                                            Title="Delete"
                                        >
                                            <X size={14} />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                <p>No tasks yet.</p>
                                <p style={{ fontSize: '0.8rem', marginTop: '4px' }}>Stay organized!</p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default TodoPanel;
