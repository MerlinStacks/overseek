import React, { createContext, useContext, useState, useEffect } from 'react';
import { db } from '../db/db';
import bcrypt from 'bcryptjs';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [permissions, setPermissions] = useState([]);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    const loadPermissions = async (roleName) => {
        if (!roleName) return;
        try {
            // Case-insensitive lookup
            const allRoles = await db.roles.toArray();
            const role = allRoles.find(r => r.name.toLowerCase() === roleName.toLowerCase());

            if (role) {
                setPermissions(role.permissions || []);
            } else {
                console.warn(`Role ${roleName} not found in DB`);
                setPermissions([]);
            }
        } catch (e) {
            console.error("Error loading permissions", e);
            setPermissions([]);
        }
    };

    useEffect(() => {
        const checkSession = async () => {
            try {
                // Ensure Admin role exists (Seeding for fresh installs)
                const allRoles = await db.roles.toArray();
                if (!allRoles.some(r => r.name.toLowerCase() === 'admin')) {
                    console.log("Seeding Admin Role...");
                    await db.roles.add({ name: 'Admin', permissions: ['*'] });
                }

                const storedId = sessionStorage.getItem('dashboard_user_id');
                if (storedId) {
                    const foundUser = await db.dashboard_users.get(parseInt(storedId));
                    if (foundUser) {
                        setUser(foundUser);
                        setIsAuthenticated(true);
                        await loadPermissions(foundUser.role);
                    }
                } else {
                    // Check if any users exist, if not create default admin
                    const count = await db.dashboard_users.count();
                    if (count === 0) {
                        const hashedPassword = await bcrypt.hash('admin', 10);
                        await db.dashboard_users.add({
                            username: 'admin',
                            password: hashedPassword,
                            name: 'Administrator',
                            role: 'Admin',
                            avatar: ''
                        });
                    }
                }
            } catch (err) {
                console.error("Session Check Failed:", err);
            } finally {
                setIsLoading(false);
            }
        };
        checkSession();
    }, []);

    const login = async (username, password) => {
        const foundUser = await db.dashboard_users.where('username').equals(username).first();
        if (foundUser) {
            // Check Hash
            const match = await bcrypt.compare(password, foundUser.password);
            if (match) {
                setUser(foundUser);
                setIsAuthenticated(true);
                sessionStorage.setItem('dashboard_user_id', foundUser.id);
                await loadPermissions(foundUser.role);
                return true;
            }

            // Fallback: Check Plaintext (Migration Strategy)
            if (foundUser.password === password) {
                // Determine if it was actually plaintext or just a coincidence (unlikely with strong hashes)
                // But for a dev/demo context, this is the migration path.
                const newHash = await bcrypt.hash(password, 10);
                await db.dashboard_users.update(foundUser.id, { password: newHash });

                setUser({ ...foundUser, password: newHash });
                setIsAuthenticated(true);
                sessionStorage.setItem('dashboard_user_id', foundUser.id);
                await loadPermissions(foundUser.role);
                return true;
            }
        }
        return false;
    };

    const logout = () => {
        setUser(null);
        setPermissions([]);
        setIsAuthenticated(false);
        sessionStorage.removeItem('dashboard_user_id');
    };

    const hasPermission = (permissionId) => {
        if (permissions.includes('*')) return true; // Super Admin
        return permissions.includes(permissionId);
    };

    return (
        <AuthContext.Provider value={{ user, isAuthenticated, isLoading, login, logout, permissions, hasPermission }}>
            {children}
        </AuthContext.Provider>
    );
};
