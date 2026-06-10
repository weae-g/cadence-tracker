import { useState } from 'react';
import { authenticate, Session } from './auth';

export function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const session = authenticate(username, password);
    if (session) {
      onLogin(session);
    } else {
      setError('Неверный логин или пароль');
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <p className="brand">Cadence</p>
        <p className="subtitle">Войдите, чтобы продолжить</p>
        <label>
          Логин
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus placeholder="admin / viewer" />
        </label>
        <label>
          Пароль
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••" />
        </label>
        {error ? <p className="login-error">{error}</p> : null}
        <button type="submit" className="primary-button">
          Войти
        </button>
      </form>
    </div>
  );
}
