import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import MyTeam from './pages/MyTeam';
import DraftRoom from './pages/DraftRoom';
import Standings from './pages/Standings';
import AISuggestions from './pages/AISuggestions';

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-950">
        <Sidebar />
        {/* Main content area offset for sidebar */}
        <main className="md:ml-60 pt-14 md:pt-0 px-4 py-6 max-w-5xl mx-auto md:mx-0">
          <Routes>
            <Route path="/"          element={<Dashboard />} />
            <Route path="/my-team"   element={<MyTeam />} />
            <Route path="/draft"     element={<DraftRoom />} />
            <Route path="/standings" element={<Standings />} />
            <Route path="/ai"        element={<AISuggestions />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
