// src/pages/LoginPage.jsx
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { login, isAuthed } from '../utils/auth';

const styles = {
  page: { minHeight: '100dvh', background: '#f5f7fb', display: 'grid', placeItems: 'center', padding: 16 },
  card: { width: '100%', maxWidth: 420, background: '#fff', border: '1px solid #e6e9ef', borderRadius: 12, boxShadow: '0 6px 20px rgba(20,30,50,0.06)', padding: 24 },
  title: { margin: 0, fontSize: 22, fontWeight: 800, color: '#2360ff' },
  label: { display: 'block', fontSize: 13, color: '#374151', marginTop: 16, marginBottom: 6 },
  input: { width: '100%', padding: '12px 14px', border: '1px solid #d5d9e2', borderRadius: 10, outline: 'none', fontSize: 14 },
  btn: { marginTop: 20, width: '100%', padding: '12px 16px', background: '#2360ff', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer' },
  err: { marginTop: 12, color: '#d12c2c', fontSize: 13 },
};

export default function LoginPage() {
  const nav = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/';

  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');

  if (isAuthed()) nav('/', { replace: true });

  const onSubmit = (e) => {
    e.preventDefault();
    setErr('');
    const ok = login(id.trim(), pw);
    if (ok) nav(from, { replace: true });
    else setErr('아이디 또는 비밀번호가 올바르지 않습니다.');
  };

  return (
    <div style={styles.page}>
      <form onSubmit={onSubmit} style={styles.card}>
        <h1 style={styles.title}>english-materials-2</h1>

        <label style={styles.label}>아이디</label>
        <input
          style={styles.input}
          value={id}
          onChange={(e) => setId(e.target.value)}
          autoFocus
        />

        <label style={styles.label}>비밀번호</label>
        <input
          style={styles.input}
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />

        <button type="submit" style={styles.btn}>로그인</button>
        {err && <div style={styles.err}>{err}</div>}
      </form>
    </div>
  );
}
