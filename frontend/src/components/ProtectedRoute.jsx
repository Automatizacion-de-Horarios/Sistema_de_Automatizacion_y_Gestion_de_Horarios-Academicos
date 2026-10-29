import { useAuth } from '../context/AuthContext';
import LoginView from '../views/LoginView';

export default function ProtectedRoute({ children }) {
    const { ready, user } = useAuth();
    if (!ready) return <div className="auth-loading" role="status">Verificando sesión…</div>;
    return user ? children : <LoginView />;
}
