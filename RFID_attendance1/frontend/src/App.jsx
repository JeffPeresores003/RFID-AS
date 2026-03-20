import { Navigate, Route, Routes } from "react-router-dom";
import MainLayout from "./layout/MainLayout";
import DashboardPage from "./pages/DashboardPage";
import RegisterPage from "./pages/RegisterPage";
import ScannerPage from "./pages/ScannerPage";
import HistoryPage from "./pages/HistoryPage";

export default function App() {
  return (
    <MainLayout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/scanner" element={<ScannerPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MainLayout>
  );
}
