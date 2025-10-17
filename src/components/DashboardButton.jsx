// src/components/DashboardButton.jsx
import { Link } from 'react-router-dom';

export default function DashboardButton({ className = '' }) {
  return (
    <Link to="/" className={`ui-btn ghost sm ${className}`} aria-label="대시보드로">
      {/* Inline SVG (집 아이콘) */}
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: 'block' }}
      >
        <path
          d="M3 10.5L12 3l9 7.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M9.5 21V14.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V21"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>대시보드로</span>
    </Link>
  );
}
