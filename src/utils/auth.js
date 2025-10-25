// src/utils/auth.js

const KEY = 'em2_auth';

export function loginSession({ name }) {
  const payload = { name: String(name || '').trim(), at: Date.now() };
  localStorage.setItem(KEY, JSON.stringify(payload));
  return payload;
}

export function logoutSession() {
  localStorage.removeItem(KEY);
}

export function getSession() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !obj.name) return null;
    return obj;
  } catch {
    return null;
  }
}

export function isAuthed() {
  return !!getSession();
}
