import { useState } from 'react';
import senatiLogo from '../assets/logo-senati.png';
import { useAuth } from '../context/AuthContext';
import './LoginView.css';

export default function LoginView() {
    const { login } = useAuth();
    const [identificador, setIdentificador] = useState('');
    const [password, setPassword] = useState('');
    const [mostrarPassword, setMostrarPassword] = useState(false);
    const [error, setError] = useState('');
    const [cargando, setCargando] = useState(false);

    const enviar = async (event) => {
        event.preventDefault();
        setError('');
        setCargando(true);
        try {
            await login(identificador.trim(), password);
        } catch (err) {
            setError(err.message);
        } finally {
            setCargando(false);
        }
    };

    return (
        <main className="login-page">
            <div className="login-shell">
                <section className="login-showcase" aria-label="Sistema de Gestión de Horarios Académicos">
                    <div className="showcase-glow" />
                    <div className="showcase-brand"><span className="brand-mark">S</span><strong>SENATI</strong></div>
                    <div className="showcase-copy">
                        <span className="showcase-kicker">SISTEMA DE</span>
                        <h1>Gestión de<br />Horarios Académicos</h1>
                        <p>Automatiza la planificación de clases, asignación de ambientes y gestión académica de manera eficiente.</p>
                    </div>
                    <div className="showcase-features">
                        <div><i className="far fa-calendar-alt" /><span>Planificación<br />de horarios</span></div>
                        <div><i className="fas fa-users" /><span>Gestión de<br />docentes</span></div>
                        <div><i className="far fa-building" /><span>Asignación<br />de ambientes</span></div>
                    </div>
                    <div className="showcase-footer"><span />Formación para un mundo mejor</div>
                </section>

                <section className="login-form-panel" aria-labelledby="login-title">
                    <div className="login-form-inner">
                        <img className="login-logo" src={senatiLogo} alt="SENATI" />
                        <p className="login-brand-subtitle">GESTIÓN ACADÉMICA</p>
                        <p className="login-system-name">Sistema de Horarios</p>
                        <h2 id="login-title">Iniciar sesión</h2>
                        <p className="login-subtitle">Ingresa tus credenciales para acceder al sistema.</p>
                        <form onSubmit={enviar}>
                            <label className="login-input-wrap" htmlFor="login-identificador">
                                <i className="far fa-envelope" aria-hidden="true" />
                                <input id="login-identificador" name="identificador" type="text" autoComplete="username"
                                    value={identificador} onChange={(event) => setIdentificador(event.target.value)}
                                    placeholder="Correo institucional o DNI" required />
                            </label>
                            <label className="login-input-wrap" htmlFor="login-password">
                                <i className="fas fa-lock" aria-hidden="true" />
                                <input id="login-password" name="password" type={mostrarPassword ? 'text' : 'password'}
                                    autoComplete="current-password" value={password}
                                    onChange={(event) => setPassword(event.target.value)} placeholder="Contraseña" required />
                                <button className="password-toggle" type="button" aria-label={mostrarPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                                    onClick={() => setMostrarPassword((visible) => !visible)}>
                                    <i className={mostrarPassword ? 'far fa-eye-slash' : 'far fa-eye'} />
                                </button>
                            </label>
                            <div className="login-options"><span /> <span className="login-help">¿Olvidaste tu contraseña?</span></div>
                            {error && <p className="login-error" role="alert">{error}</p>}
                            <button className="login-submit" type="submit" disabled={cargando}>
                                {cargando ? 'Ingresando…' : 'Iniciar sesión'}
                            </button>
                        </form>
                        <div className="login-divider"><span /><i /><span /></div>
                        <p className="login-exclusive">Acceso exclusivo para usuarios autorizados</p>
                        <p className="login-footnote">Sistema de Automatización y Gestión de Horarios Académicos</p>
                    </div>
                </section>
            </div>
        </main>
    );
}
