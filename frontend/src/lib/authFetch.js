import { tokenKey } from '../context/authContext';

export function authFetch(url, options = {}) {
    const token = localStorage.getItem(tokenKey);
    const headers = new Headers(options.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...options, headers });
}
