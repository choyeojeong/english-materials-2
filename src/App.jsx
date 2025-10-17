// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import { isAuthed } from './utils/auth';

// 페이지들
import CategoryManagePage from './pages/CategoryManagePage.jsx';
import ClassifyStartPage from './pages/ClassifyStartPage.jsx';
import SplitReviewPage from './pages/SplitReviewPage.jsx';
import ClassifiedListPage from './pages/ClassifiedListPage.jsx';
import CategoryRecommendPage from './pages/CategoryRecommendPage.jsx'; // ⬅️ 분류 추천

function Protected({ children }) {
  const location = useLocation();
  if (!isAuthed()) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 로그인은 항상 오픈 */}
        <Route path="/login" element={<LoginPage />} />

        {/* 대시보드 */}
        <Route
          path="/"
          element={
            <Protected>
              <Dashboard />
            </Protected>
          }
        />

        {/* 분류 관리 */}
        <Route
          path="/category/manage"
          element={
            <Protected>
              <CategoryManagePage />
            </Protected>
          }
        />

        {/* 분류 시작 */}
        <Route
          path="/category/start"
          element={
            <Protected>
              <ClassifyStartPage />
            </Protected>
          }
        />

        {/* 문장 분리 검수 */}
        <Route
          path="/category/start/review"
          element={
            <Protected>
              <SplitReviewPage />
            </Protected>
          }
        />

        {/* 자동 분류 추천 (문장별 추천 후 복수 선택 저장) */}
        {/* 두 가지 파라미터 패턴 모두 지원 */}
        <Route
          path="/category/recommend/:id"   // :id = material_id (uuid)
          element={
            <Protected>
              <CategoryRecommendPage />
            </Protected>
          }
        />
        <Route
          path="/category/recommend/:materialId" // :materialId = material_id (uuid)
          element={
            <Protected>
              <CategoryRecommendPage />
            </Protected>
          }
        />

        {/* 분류 완료 목록 */}
        <Route
          path="/category/done"
          element={
            <Protected>
              <ClassifiedListPage />
            </Protected>
          }
        />

        {/* 그 외 모든 경로는 대시보드로 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
