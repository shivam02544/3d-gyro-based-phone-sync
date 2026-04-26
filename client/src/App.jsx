import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import PhoneController from './pages/PhoneController';
import PCViewer from './pages/PCViewer';

function Home() {
  const navigate = useNavigate();

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: '#0f172a', color: 'white', fontFamily: 'sans-serif'
    }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '2rem', color: '#60a5fa' }}>Mobile Bridge</h1>
      <div style={{ display: 'flex', gap: '1rem' }}>
        <button 
          onClick={() => navigate('/phone')}
          style={{ padding: '1rem 2rem', fontSize: '1.2rem', borderRadius: '12px', background: '#3b82f6', border: 'none', color: 'white', cursor: 'pointer' }}>
          📱 Open Phone Controller
        </button>
        <button 
          onClick={() => navigate('/pc')}
          style={{ padding: '1rem 2rem', fontSize: '1.2rem', borderRadius: '12px', background: '#8b5cf6', border: 'none', color: 'white', cursor: 'pointer' }}>
          💻 Open PC Viewer
        </button>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/phone" element={<PhoneController />} />
        <Route path="/pc" element={<PCViewer />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
