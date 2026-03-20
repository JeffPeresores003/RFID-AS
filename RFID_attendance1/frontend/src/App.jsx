import { Navigate, Route, Routes } from "react-router-dom";
import MainLayout from "./layout/MainLayout";
import LandingPage from "./pages/LandingPage";
import SignInPage from "./pages/SignInPage";
import LoadingPage from "./pages/LoadingPage";
import DashboardPage from "./pages/DashboardPage";
import RegisterPage from "./pages/RegisterPage";
import ScannerPage from "./pages/ScannerPage";
import HistoryPage from "./pages/HistoryPage";
import TeacherProfilePage from "./pages/TeacherProfilePage";
import AdminSigninPage from "./pages/AdminSigninPage";
import AdminDashboardPage from "./pages/AdminDashboardPage";
import { getAdminSession, getTeacherSession } from "./auth";

function RequireAuth({ children }) {
  const teacher = getTeacherSession();
  if (!teacher) {
    return <Navigate to="/signin" replace />;
  }
  return children;
}

function RequireAdminAuth({ children }) {
  const adminSession = getAdminSession();
  if (!adminSession?.token) {
    return <Navigate to="/admin/signin" replace />;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route
        path="/signin"
        element={
          getTeacherSession() ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <SignInPage />
          )
        }
      />
      <Route
        path="/admin/signin"
        element={
          getAdminSession()?.token ? (
            <Navigate to="/admin/dashboard" replace />
          ) : (
            <AdminSigninPage />
          )
        }
      />
      <Route
        path="/admin/dashboard"
        element={
          <RequireAdminAuth>
            <AdminDashboardPage />
          </RequireAdminAuth>
        }
      />
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <MainLayout>
              <DashboardPage />
            </MainLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/loading"
        element={
          <RequireAuth>
            <LoadingPage />
          </RequireAuth>
        }
      />
      <Route
        path="/register"
        element={
          <RequireAuth>
            <MainLayout>
              <RegisterPage />
            </MainLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/scanner"
        element={
          <RequireAuth>
            <MainLayout>
              <ScannerPage />
            </MainLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/history"
        element={
          <RequireAuth>
            <MainLayout>
              <HistoryPage />
            </MainLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/profile"
        element={
          <RequireAuth>
            <MainLayout>
              <TeacherProfilePage />
            </MainLayout>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
