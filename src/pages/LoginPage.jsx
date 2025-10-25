// src/pages/LoginPage.jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginSession } from '../utils/auth';

export default function LoginPage() {
  const nav = useNavigate();
  const [uid, setUid] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;

    const id = String(uid ?? '').trim();
    const pass = String(pw ?? '').trim();
    if (!id || !pass) {
      alert('아이디와 비밀번호를 입력하세요.');
      return;
    }

    try {
      setBusy(true);

      // 현재 프로젝트는 Supabase Auth 미적용 상태이므로
      // 임시 “정식 로그인” 형태로 동작: 자격 검증은 서버/DB로 교체 예정.
      // (화면에는 힌트/데모 문구를 전혀 표시하지 않습니다.)
      //
      // TODO: 추후 Supabase Auth 또는 사내 인증으로 교체
      const ok = id === 'rabbit' && pass === 'habit';
      if (!ok) {
        throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');
      }

      loginSession({ name: id });
      nav('/', { replace: true });
    } catch (err) {
      alert(err.message || '로그인에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f7f9fc' }}>
      <form
        onSubmit={onSubmit}
        style={{
          width: 420,
          maxWidth: '92vw',
          background: '#fff',
          border: '1px solid #e9eef5',
          borderRadius: 14,
          padding: 24,
          boxShadow: '0 10px 30px rgba(31,42,68,0.06)',
        }}
      >
        <h1 style={{ fontSize: 26, fontWeight: 900, color: '#1f2a44', marginBottom: 18 }}>로그인</h1>

        <label style={{ display: 'block', fontSize: 13, color: '#5d6b82' }}>아이디</label>
        <input
          value={uid}
          onChange={(e) => setUid(e.target.value)}
          autoFocus
          autoComplete="username"
          disabled={busy}
          style={{
            width: '100%',
            marginTop: 6,
            marginBottom: 12,
            padding: '10px 12px',
            border: '1px solid #d8e2ef',
            borderRadius: 10,
            outline: 'none',
          }}
        />

        <label style={{ display: 'block', fontSize: 13, color: '#5d6b82' }}>비밀번호</label>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoComplete="current-password"
          disabled={busy}
          style={{
            width: '100%',
            marginTop: 6,
            marginBottom: 18,
            padding: '10px 12px',
            border: '1px solid #d8e2ef',
            borderRadius: 10,
            outline: 'none',
          }}
        />

        <button
          type="submit"
          disabled={busy}
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: 12,
            border: 'none',
            background: '#5b7df2',
            color: '#fff',
            fontWeight: 700,
            fontSize: 16,
            cursor: 'pointer',
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? '로그인 중…' : '로그인'}
        </button>
      </form>
    </div>
  );
}
