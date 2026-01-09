import { useState, useEffect, useCallback, useRef } from 'react';
import { Sparkles, Plus, Check, Trash2, Loader2, ListChecks, Star, Clock, AlertCircle, Flame, Trophy, Zap, Target } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { WidgetProps } from './WidgetRegistry';

interface Todo {
    id: string;
    title: string;
    completed: boolean;
    priority: 'LOW' | 'NORMAL' | 'HIGH';
    aiGenerated: boolean;
    dueDate?: string;
    createdAt: string;
}

interface GameStats {
    xp: number;
    level: number;
    streak: number;
    todayCompleted: number;
    totalCompleted: number;
}

// XP required for each level (cumulative)
const LEVEL_THRESHOLDS = [0, 50, 150, 300, 500, 750, 1100, 1500, 2000, 2600, 3300];
const XP_PER_TASK = { LOW: 10, NORMAL: 25, HIGH: 50 };
const DAILY_BONUS_THRESHOLD = 5; // Complete 5 tasks for daily bonus
const DAILY_BONUS_XP = 100;

/**
 * Confetti particle component for celebrations
 */
function Confetti({ active }: { active: boolean }) {
    if (!active) return null;

    const colors = ['#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#3B82F6'];
    const particles = Array.from({ length: 30 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        delay: Math.random() * 0.5,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 4 + Math.random() * 6,
        drift: (Math.random() - 0.5) * 40
    }));

    return (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-50">
            {particles.map(p => (
                <div
                    key={p.id}
                    className="absolute animate-confetti"
                    style={{
                        left: `${p.x}%`,
                        top: '-10px',
                        width: p.size,
                        height: p.size,
                        backgroundColor: p.color,
                        borderRadius: Math.random() > 0.5 ? '50%' : '2px',
                        animationDelay: `${p.delay}s`,
                        '--drift': `${p.drift}px`
                    } as React.CSSProperties}
                />
            ))}
            <style>{`
                @keyframes confetti-fall {
                    0% { transform: translateY(0) translateX(0) rotate(0deg); opacity: 1; }
                    100% { transform: translateY(300px) translateX(var(--drift)) rotate(720deg); opacity: 0; }
                }
                .animate-confetti {
                    animation: confetti-fall 1.5s ease-out forwards;
                }
            `}</style>
        </div>
    );
}

/**
 * XP popup animation
 */
function XPPopup({ amount, visible }: { amount: number; visible: boolean }) {
    if (!visible) return null;
    return (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 animate-xp-pop pointer-events-none">
            <div className="flex items-center gap-1 px-3 py-1.5 bg-linear-to-r from-amber-400 to-yellow-500 text-white font-bold rounded-full shadow-lg">
                <Zap size={16} />
                +{amount} XP
            </div>
            <style>{`
                @keyframes xp-pop {
                    0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
                    50% { transform: translate(-50%, -80%) scale(1.2); opacity: 1; }
                    100% { transform: translate(-50%, -120%) scale(1); opacity: 0; }
                }
                .animate-xp-pop {
                    animation: xp-pop 1s ease-out forwards;
                }
            `}</style>
        </div>
    );
}

/**
 * Level progress bar
 */
function LevelProgress({ xp, level }: { xp: number; level: number }) {
    const currentThreshold = LEVEL_THRESHOLDS[level] || 0;
    const nextThreshold = LEVEL_THRESHOLDS[level + 1] || currentThreshold + 500;
    const progress = ((xp - currentThreshold) / (nextThreshold - currentThreshold)) * 100;

    return (
        <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
                <div className="w-6 h-6 bg-linear-to-br from-amber-400 to-orange-500 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-xs">
                    {level}
                </div>
            </div>
            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                    className="h-full bg-linear-to-r from-violet-500 to-purple-500 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${Math.min(progress, 100)}%` }}
                />
            </div>
            <span className="text-xs text-gray-500 font-medium">{xp} XP</span>
        </div>
    );
}

/**
 * Streak badge
 */
function StreakBadge({ streak }: { streak: number }) {
    if (streak < 2) return null;

    const isHot = streak >= 7;
    const isOnFire = streak >= 14;

    return (
        <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${isOnFire ? 'bg-linear-to-r from-red-500 to-orange-500 text-white animate-pulse' :
                isHot ? 'bg-linear-to-r from-orange-400 to-amber-400 text-white' :
                    'bg-orange-100 text-orange-600'
            }`}>
            <Flame size={12} className={isOnFire ? 'animate-bounce' : ''} />
            {streak} day streak!
        </div>
    );
}

/**
 * Daily challenge progress
 */
function DailyChallenge({ completed, target }: { completed: number; target: number }) {
    const progress = Math.min((completed / target) * 100, 100);
    const isDone = completed >= target;

    return (
        <div className={`flex items-center gap-2 px-2 py-1 rounded-lg text-xs ${isDone ? 'bg-green-100 text-green-700' : 'bg-amber-50 text-amber-700'
            }`}>
            <Target size={12} />
            <span className="font-medium">
                {isDone ? '🎉 Daily bonus earned!' : `${completed}/${target} for +${DAILY_BONUS_XP} XP`}
            </span>
        </div>
    );
}

/**
 * AI-powered Gamified Todo Widget for the dashboard.
 * Features XP, levels, streaks, and celebratory animations.
 */
export function AITodoWidget(_props: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [todos, setTodos] = useState<Todo[]>([]);
    const [loading, setLoading] = useState(true);
    const [newTask, setNewTask] = useState('');
    const [adding, setAdding] = useState(false);
    const [suggesting, setSuggesting] = useState(false);
    const [justCompleted, setJustCompleted] = useState<string | null>(null);

    // Gamification state
    const [gameStats, setGameStats] = useState<GameStats>({
        xp: 0,
        level: 1,
        streak: 0,
        todayCompleted: 0,
        totalCompleted: 0
    });
    const [showConfetti, setShowConfetti] = useState(false);
    const [xpGained, setXpGained] = useState(0);
    const [showXpPopup, setShowXpPopup] = useState(false);
    const [levelUp, setLevelUp] = useState(false);

    // Load game stats from localStorage
    useEffect(() => {
        if (!currentAccount) return;
        const stored = localStorage.getItem(`todo-game-${currentAccount.id}`);
        if (stored) {
            const parsed = JSON.parse(stored);
            // Check if it's a new day
            const lastDate = localStorage.getItem(`todo-last-date-${currentAccount.id}`);
            const today = new Date().toDateString();
            if (lastDate !== today) {
                // New day - check streak
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                if (lastDate === yesterday.toDateString() && parsed.todayCompleted > 0) {
                    parsed.streak += 1;
                } else if (lastDate !== today) {
                    parsed.streak = parsed.todayCompleted > 0 ? 1 : 0;
                }
                parsed.todayCompleted = 0;
                localStorage.setItem(`todo-last-date-${currentAccount.id}`, today);
            }
            setGameStats(parsed);
        } else {
            localStorage.setItem(`todo-last-date-${currentAccount.id}`, new Date().toDateString());
        }
    }, [currentAccount]);

    // Save game stats
    useEffect(() => {
        if (!currentAccount || gameStats.xp === 0 && gameStats.totalCompleted === 0) return;
        localStorage.setItem(`todo-game-${currentAccount.id}`, JSON.stringify(gameStats));
    }, [gameStats, currentAccount]);

    const fetchTodos = useCallback(async () => {
        if (!currentAccount || !token) return;

        try {
            const res = await fetch('/api/todos', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                const data = await res.json();
                setTodos(data);
            }
        } catch (error) {
            console.error('Failed to fetch todos:', error);
        } finally {
            setLoading(false);
        }
    }, [currentAccount, token]);

    useEffect(() => {
        fetchTodos();
    }, [fetchTodos]);

    const calculateLevel = (xp: number): number => {
        for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
            if (xp >= LEVEL_THRESHOLDS[i]) return i + 1;
        }
        return 1;
    };

    const awardXP = (priority: 'LOW' | 'NORMAL' | 'HIGH', wasDailyBonusTask: boolean) => {
        let xp = XP_PER_TASK[priority];

        // Streak multiplier
        if (gameStats.streak >= 7) xp = Math.floor(xp * 1.5);
        else if (gameStats.streak >= 3) xp = Math.floor(xp * 1.25);

        // Daily bonus
        if (wasDailyBonusTask) xp += DAILY_BONUS_XP;

        const newXP = gameStats.xp + xp;
        const oldLevel = gameStats.level;
        const newLevel = calculateLevel(newXP);

        setXpGained(xp);
        setShowXpPopup(true);
        setTimeout(() => setShowXpPopup(false), 1000);

        // Level up celebration
        if (newLevel > oldLevel) {
            setLevelUp(true);
            setShowConfetti(true);
            setTimeout(() => {
                setShowConfetti(false);
                setLevelUp(false);
            }, 2000);
        } else if (xp >= 50) {
            // Big XP celebration for high priority tasks
            setShowConfetti(true);
            setTimeout(() => setShowConfetti(false), 1500);
        }

        const newTodayCompleted = gameStats.todayCompleted + 1;
        const earnedDailyBonus = !wasDailyBonusTask && newTodayCompleted === DAILY_BONUS_THRESHOLD;

        setGameStats(prev => ({
            ...prev,
            xp: newXP + (earnedDailyBonus ? DAILY_BONUS_XP : 0),
            level: newLevel,
            todayCompleted: newTodayCompleted,
            totalCompleted: prev.totalCompleted + 1,
            streak: prev.streak || 1
        }));

        if (earnedDailyBonus) {
            setTimeout(() => {
                setXpGained(DAILY_BONUS_XP);
                setShowXpPopup(true);
                setShowConfetti(true);
                setTimeout(() => {
                    setShowXpPopup(false);
                    setShowConfetti(false);
                }, 1500);
            }, 1200);
        }
    };

    const addTodo = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTask.trim() || !currentAccount || !token) return;

        setAdding(true);
        try {
            const res = await fetch('/api/todos', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify({ title: newTask.trim() })
            });
            if (res.ok) {
                const todo = await res.json();
                setTodos(prev => [todo, ...prev]);
                setNewTask('');
            }
        } catch (error) {
            console.error('Failed to add todo:', error);
        } finally {
            setAdding(false);
        }
    };

    const toggleTodo = async (id: string, completed: boolean, priority: 'LOW' | 'NORMAL' | 'HIGH') => {
        if (!currentAccount || !token) return;

        // Optimistic update with animation trigger
        setTodos(prev => prev.map(t => t.id === id ? { ...t, completed: !completed } : t));

        if (!completed) {
            setJustCompleted(id);
            setTimeout(() => setJustCompleted(null), 600);

            // Award XP for completing a task
            const willEarnDailyBonus = gameStats.todayCompleted + 1 === DAILY_BONUS_THRESHOLD;
            awardXP(priority, willEarnDailyBonus);
        }

        try {
            await fetch(`/api/todos/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify({ completed: !completed })
            });
        } catch (error) {
            // Revert on failure
            setTodos(prev => prev.map(t => t.id === id ? { ...t, completed } : t));
        }
    };

    const deleteTodo = async (id: string) => {
        if (!currentAccount || !token) return;

        // Optimistic update
        setTodos(prev => prev.filter(t => t.id !== id));

        try {
            await fetch(`/api/todos/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
        } catch (error) {
            fetchTodos(); // Revert by refetching
        }
    };

    const getSuggestions = async () => {
        if (!currentAccount || !token) return;

        setSuggesting(true);
        try {
            const res = await fetch('/api/todos/suggest', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                const data = await res.json();
                // Add each suggestion as a new todo
                for (const suggestion of data.suggestions) {
                    const createRes = await fetch('/api/todos', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`,
                            'x-account-id': currentAccount.id
                        },
                        body: JSON.stringify({
                            title: suggestion.title,
                            priority: suggestion.priority,
                            aiGenerated: true
                        })
                    });
                    if (createRes.ok) {
                        const newTodo = await createRes.json();
                        setTodos(prev => [newTodo, ...prev]);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to get suggestions:', error);
        } finally {
            setSuggesting(false);
        }
    };

    const getPriorityColor = (priority: string) => {
        switch (priority) {
            case 'HIGH': return 'text-red-500';
            case 'LOW': return 'text-blue-400';
            default: return 'text-amber-500';
        }
    };

    const getPriorityIcon = (priority: string) => {
        switch (priority) {
            case 'HIGH': return <AlertCircle size={12} />;
            case 'LOW': return <Clock size={12} />;
            default: return <Star size={12} />;
        }
    };

    const getPriorityXP = (priority: string) => {
        return XP_PER_TASK[priority as keyof typeof XP_PER_TASK] || 25;
    };

    const incompleteTodos = todos.filter(t => !t.completed);
    const completedTodos = todos.filter(t => t.completed);

    return (
        <div className="bg-white/80 backdrop-blur-md rounded-xl shadow-xs border border-gray-200/50 flex flex-col h-full overflow-hidden relative">
            {/* Confetti */}
            <Confetti active={showConfetti} />

            {/* XP Popup */}
            <XPPopup amount={xpGained} visible={showXpPopup} />

            {/* Level Up Overlay */}
            {levelUp && (
                <div className="absolute inset-0 bg-linear-to-b from-violet-500/20 to-purple-500/20 z-40 flex items-center justify-center animate-pulse">
                    <div className="bg-white rounded-2xl shadow-2xl px-6 py-4 text-center">
                        <Trophy className="w-12 h-12 text-amber-500 mx-auto mb-2" />
                        <p className="text-xl font-bold text-gray-900">Level Up!</p>
                        <p className="text-violet-600 font-semibold">Level {gameStats.level}</p>
                    </div>
                </div>
            )}

            {/* Header with Game Stats */}
            <div className="px-4 py-3 border-b border-gray-100 bg-linear-to-r from-violet-50 to-purple-50">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-violet-100 rounded-lg">
                            <ListChecks size={16} className="text-violet-600" />
                        </div>
                        <h3 className="font-semibold text-gray-800">Quest Log</h3>
                        {incompleteTodos.length > 0 && (
                            <span className="px-2 py-0.5 text-xs font-medium bg-violet-100 text-violet-700 rounded-full">
                                {incompleteTodos.length}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <StreakBadge streak={gameStats.streak} />
                        <button
                            onClick={getSuggestions}
                            disabled={suggesting}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-violet-600 bg-violet-100 hover:bg-violet-200 rounded-lg transition-colors disabled:opacity-50"
                            title="Get AI suggestions"
                        >
                            {suggesting ? (
                                <Loader2 size={12} className="animate-spin" />
                            ) : (
                                <Sparkles size={12} />
                            )}
                            Suggest
                        </button>
                    </div>
                </div>

                {/* Level Progress */}
                <LevelProgress xp={gameStats.xp} level={gameStats.level} />

                {/* Daily Challenge */}
                <div className="mt-2">
                    <DailyChallenge completed={gameStats.todayCompleted} target={DAILY_BONUS_THRESHOLD} />
                </div>
            </div>

            {/* Add Task Form */}
            <form onSubmit={addTodo} className="px-4 py-2 border-b border-gray-50">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newTask}
                        onChange={(e) => setNewTask(e.target.value)}
                        placeholder="Add a quest..."
                        className="flex-1 px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg outline-hidden focus:ring-2 focus:ring-violet-200 focus:border-violet-400 transition-all"
                    />
                    <button
                        type="submit"
                        disabled={adding || !newTask.trim()}
                        className="px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {adding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                    </button>
                </div>
            </form>

            {/* Task List */}
            <div className="flex-1 overflow-y-auto px-2 py-2">
                {loading ? (
                    <div className="flex items-center justify-center h-full">
                        <Loader2 className="animate-spin text-violet-500" size={24} />
                    </div>
                ) : todos.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center p-4">
                        <div className="w-12 h-12 bg-violet-100 rounded-full flex items-center justify-center mb-3">
                            <Trophy size={24} className="text-violet-500" />
                        </div>
                        <p className="text-sm text-gray-500 mb-1">No quests yet!</p>
                        <p className="text-xs text-gray-400">Add a quest to earn XP ⚡</p>
                    </div>
                ) : (
                    <div className="space-y-1">
                        {/* Incomplete Tasks */}
                        {incompleteTodos.map((todo) => (
                            <div
                                key={todo.id}
                                className={`group flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 transition-all ${justCompleted === todo.id ? 'animate-pulse bg-green-50 scale-105' : ''
                                    }`}
                            >
                                <button
                                    onClick={() => toggleTodo(todo.id, todo.completed, todo.priority)}
                                    className="w-5 h-5 border-2 border-gray-300 rounded-full hover:border-violet-500 hover:scale-110 transition-all flex items-center justify-center shrink-0"
                                >
                                    {justCompleted === todo.id && (
                                        <Check size={12} className="text-green-500" />
                                    )}
                                </button>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-gray-700 truncate">{todo.title}</p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        {todo.aiGenerated && (
                                            <span className="inline-flex items-center gap-1 text-[10px] text-violet-500">
                                                <Sparkles size={8} /> AI
                                            </span>
                                        )}
                                        <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 font-medium">
                                            <Zap size={8} /> {getPriorityXP(todo.priority)} XP
                                        </span>
                                    </div>
                                </div>
                                <span className={`${getPriorityColor(todo.priority)} shrink-0`}>
                                    {getPriorityIcon(todo.priority)}
                                </span>
                                <button
                                    onClick={() => deleteTodo(todo.id)}
                                    className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}

                        {/* Completed Section */}
                        {completedTodos.length > 0 && (
                            <>
                                <div className="px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-wide flex items-center gap-2">
                                    <Trophy size={12} className="text-amber-400" />
                                    Conquered ({completedTodos.length})
                                </div>
                                {completedTodos.slice(0, 3).map((todo) => (
                                    <div
                                        key={todo.id}
                                        className="group flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 transition-all opacity-60"
                                    >
                                        <button
                                            onClick={() => toggleTodo(todo.id, todo.completed, todo.priority)}
                                            className="w-5 h-5 bg-linear-to-br from-green-400 to-emerald-500 border-2 border-green-500 rounded-full flex items-center justify-center shrink-0 shadow-xs"
                                        >
                                            <Check size={12} className="text-white" />
                                        </button>
                                        <p className="flex-1 text-sm text-gray-500 line-through truncate">{todo.title}</p>
                                        <button
                                            onClick={() => deleteTodo(todo.id)}
                                            className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                ))}
                                {completedTodos.length > 3 && (
                                    <p className="px-3 py-1 text-xs text-gray-400">
                                        +{completedTodos.length - 3} more conquered
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Footer Stats */}
            <div className="px-4 py-2 border-t border-gray-100 bg-linear-to-r from-gray-50 to-violet-50/50 flex items-center justify-between text-xs text-gray-500">
                <span className="flex items-center gap-1">
                    <Trophy size={12} className="text-amber-500" />
                    {gameStats.totalCompleted} total
                </span>
                <span className="flex items-center gap-1">
                    <Target size={12} className="text-violet-500" />
                    {gameStats.todayCompleted} today
                </span>
            </div>
        </div>
    );
}

export default AITodoWidget;
