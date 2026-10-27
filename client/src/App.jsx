import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Login from './pages/Login';
import StudentDashboard from './pages/StudentDashboard';
import DeptDashboard from './pages/DeptDashboard';
import DeanDashboard from './pages/DeanDashboard';

function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const navigate = useNavigate();

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser && token) {
      setUser(JSON.parse(storedUser));
    }
  }, [token]);

  const handleLogin = (userData, userToken) => {
    localStorage.setItem('token', userToken);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
    setToken(userToken);

    // Redirect based on user role
    if (userData.role === 'student') navigate('/student');
    else if (userData.role === 'authority') navigate('/department');
    else if (userData.role === 'admin') navigate('/dean');
    else navigate('/');
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setToken('');
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <Routes>
        <Route 
          path="/login" 
          element={!token ? <Login onLogin={handleLogin} /> : <Navigate to={`/${user?.role === 'authority' ? 'department' : user?.role === 'admin' ? 'dean' : 'student'}`} />} 
        />
        <Route 
          path="/student" 
          element={token && user?.role === 'student' ? <StudentDashboard user={user} onLogout={handleLogout} /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/department" 
          element={token && user?.role === 'authority' ? <DeptDashboard user={user} onLogout={handleLogout} /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/dean" 
          element={token && user?.role === 'admin' ? <DeanDashboard user={user} onLogout={handleLogout} /> : <Navigate to="/login" />} 
        />
        <Route 
          path="*" 
          element={<Navigate to={token ? `/${user?.role === 'authority' ? 'department' : user?.role === 'admin' ? 'dean' : 'student'}` : "/login"} />} 
        />
      </Routes>
    </div>
  );
}

export default App;