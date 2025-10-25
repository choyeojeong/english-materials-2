import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { isAuthed, login, logout } from '../utils/auth';

export default function LoginPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');

  // ❌ 렌더 중 navigate 금지
  // ✅ 이미 로그인 상태면 렌더 반환을 <Navigate>로 처리
  if (isAuthed()) {
    const to = (loc.state && loc.state.from) ? loc.state.from.pathname : '/';
    return <Navigate to={to} replace />;
  }

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      // english-materials-2: 간단 로그인 (rabbit / habit)
      if (id.trim() === 'rabbit' && pw.trim() === 'habit') {
        login({ name: 'rabbit' }); // localStorage 등에 저장
        nav('/', { replace: true }); // ✅ 이벤트 핸들러 안에서 navigate
      } else {
        setErr('아이디 또는 비밀번호가 올바르지 않습니다.');
      }
    } catch (e2) {
      setErr(e2.message || '로그인 오류');
    }
  };

  return (
    <div className="ui-page">
      <div className="ui-wrap" style={{maxWidth:420}}>
        <div className="ui-card">
          <h2 className="ui-title">로그인</h2>
          <form onSubmit={onSubmit} style={{display:'grid', gap:10}}>
            <input className="ui-input" placeholder="아이디 (rabbit)"
                   value={id} onChange={e=>setId(e.target.value)} />
            <input className="ui-input" placeholder="비밀번호 (habit)"
                   type="password" value={pw} onChange={e=>setPw(e.target.value)} />
            {err && <div className="ui-warn">{err}</div>}
            <button className="ui-btn primary" type="submit">로그인</button>
          </form>
          <div style={{marginTop:10, fontSize:12, color:'#6b7280'}}>
            데모 계정: rabbit / habit
          </div>
        </div>
      </div>
    </div>
  );
}
