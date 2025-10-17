// src/pages/Dashboard.jsx
import { Link, useNavigate } from 'react-router-dom';
import { logout } from '../utils/auth';

const styles = {
  page: { minHeight: '100vh', background: '#f7f9fc', display: 'grid', placeItems: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 640, background: '#fff', border: '1px solid #e9eef5', borderRadius: 14, padding: 20, boxShadow: '0 8px 24px rgba(31,42,68,0.06)' },
  title: { fontSize: 22, fontWeight: 900, color: '#1f2a44', margin: '0 0 6px' },
  sub: { fontSize: 13, color: '#667185', margin: 0 },
  grid: { display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginTop: 20 },
  btn: { width: '100%', padding: '14px 16px', borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff', fontWeight: 800, color: '#1f2a44', cursor: 'pointer', textAlign: 'center' },
  primary: { width: '100%', padding: '14px 16px', borderRadius: 10, border: 'none', background: '#3b82f6', color: '#fff', fontWeight: 900, cursor: 'pointer', textAlign: 'center' },
  topbar: { display: 'flex', justifyContent: 'flex-end', marginBottom: 10 },
  link: { textDecoration: 'none' },
};

export default function Dashboard() {
  const nav = useNavigate();

  const onLogout = () => {
    logout();
    nav('/login', { replace: true });
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.topbar}>
          <button onClick={onLogout} style={{ ...styles.btn, width: 'auto', padding: '8px 12px' }}>로그아웃</button>
        </div>
        <h2 style={styles.title}>대시보드</h2>
        <p style={styles.sub}>작업을 선택하세요.</p>

        <div style={styles.grid}>
          <Link to="/category/manage" style={styles.link}>
            <div style={styles.btn}>분류 관리</div>
          </Link>

          <Link to="/category/start" style={styles.link}>
            <div style={styles.primary}>분류 시작하기</div>
          </Link>

          <Link to="/category/done" style={styles.link}>
            <div style={styles.btn}>분류 완료 목록</div>
          </Link>
        </div>
      </div>
    </div>
  );
}
