import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from '../config/api';
import { AuthContext, tokenKey } from './authContext.js';

export function AuthProvider({ children }) {
    const [token, setToken] = useState(() => localStorage.getItem(tokenKey));
    const [user, setUser] = useState(null);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const verifySession = async () => {
            if (!token) {
                setReady(true);
                return;
            }
            try {
                const response = await fetch(`${API_BASE_URL}/api/auth/verify`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.mensaje || 'La sesión venció.');
                if (!cancelled) setUser(data.usuario);
            } catch {
                localStorage.removeItem(tokenKey);
                if (!cancelled) {
                    setToken(null);
                    setUser(null);
                }
            } finally {
                if (!cancelled) setReady(true);
            }
        };
        verifySession();
        return () => { cancelled = true; };
    }, [token]);

    const login = useCallback(async (identificador, password) => {
        const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identificador, password })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.mensaje || 'No se pudo iniciar sesión.');
        localStorage.setItem(tokenKey, data.token);
        setToken(data.token);
        setUser(data.usuario);
        setReady(true);
    }, []);

    const logout = useCallback(() => {
        localStorage.removeItem(tokenKey);
        setToken(null);
        setUser(null);
        setReady(true);
    }, []);

    const value = useMemo(() => ({ token, user, ready, login, logout }), [token, user, ready, login, logout]);
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}