// src/utils/auth.js

const KEY = 'em2_authed';

export function isAuthed() {
  try {
    return localStorage.getItem(KEY) === 'yes';
  } catch {
    return false;
  }
}

export function tryLogin(id, pw) {
  // 요구사항: 아이디 rabbit / 비밀번호 habit
  const ok = (id || '').trim() === 'rabbit' && (pw || '').trim() === 'habit';
  if (ok) {
    localStorage.setItem(KEY, 'yes');
  }
  return ok;
}

export function logout() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
export const login = tryLogin;
