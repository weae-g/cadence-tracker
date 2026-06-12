import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ManagedUser,
  Role,
  Session,
  changePassword,
  createUser,
  deleteUser,
  listUsers,
  updateUser,
} from './auth';

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Ошибка');

// Диалог аккаунта: смена своего пароля + (для admin) управление пользователями.
export function AccountDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  return createPortal(
    <div className="doc-overlay" onClick={onClose}>
      <div className="doc-dialog account-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="doc-dialog-head">
          <div>
            <h3>Аккаунт</h3>
            <p className="hint">
              {session.username} · {session.role === 'admin' ? 'администратор' : 'просмотр'}
            </p>
          </div>
          <button type="button" className="doc-close" onClick={onClose} title="Закрыть">
            ✕
          </button>
        </div>

        <PasswordSection />
        {session.role === 'admin' ? <UsersSection currentUser={session.username} /> : null}
      </div>
    </div>,
    document.body,
  );
}

function PasswordSection() {
  const [cur, setCur] = useState('');
  const [n1, setN1] = useState('');
  const [n2, setN2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (n1 !== n2) {
      setMsg({ ok: false, text: 'Новые пароли не совпадают' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await changePassword(cur, n1);
      setMsg({ ok: true, text: 'Пароль изменён' });
      setCur('');
      setN1('');
      setN2('');
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="account-section" onSubmit={submit}>
      <h4>Сменить пароль</h4>
      <div className="form-grid">
        <label>
          Текущий пароль
          <input type="password" value={cur} autoComplete="current-password" onChange={(e) => setCur(e.target.value)} />
        </label>
        <label>
          Новый пароль
          <input type="password" value={n1} autoComplete="new-password" onChange={(e) => setN1(e.target.value)} />
        </label>
        <label>
          Повторите
          <input type="password" value={n2} autoComplete="new-password" onChange={(e) => setN2(e.target.value)} />
        </label>
      </div>
      {msg ? <p className={msg.ok ? 'account-ok' : 'account-err'}>{msg.text}</p> : null}
      <button type="submit" className="primary-button" disabled={busy || !cur || !n1}>
        {busy ? 'Сохранение…' : 'Сменить пароль'}
      </button>
    </form>
  );
}

function UsersSection({ currentUser }: { currentUser: string }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [err, setErr] = useState('');
  const [nu, setNu] = useState('');
  const [np, setNp] = useState('');
  const [nr, setNr] = useState<Role>('viewer');
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    try {
      setUsers(await listUsers());
    } catch (e) {
      setErr(errText(e));
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await createUser(nu.trim(), np, nr);
      setNu('');
      setNp('');
      setNr('viewer');
      await reload();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (username: string, role: Role) => {
    setErr('');
    try {
      await updateUser(username, { role });
      await reload();
    } catch (e) {
      setErr(errText(e));
    }
  };

  const resetPw = async (username: string) => {
    const password = window.prompt(`Новый пароль для «${username}»:`)?.trim();
    if (!password) return;
    try {
      await updateUser(username, { password });
      window.alert('Пароль сброшен.');
    } catch (e) {
      setErr(errText(e));
    }
  };

  const del = async (username: string) => {
    if (!window.confirm(`Удалить пользователя «${username}»?`)) return;
    setErr('');
    try {
      await deleteUser(username);
      await reload();
    } catch (e) {
      setErr(errText(e));
    }
  };

  return (
    <div className="account-section">
      <h4>Пользователи</h4>
      <p className="hint">Изменение роли вступит в силу после следующего входа пользователя.</p>
      {err ? <p className="account-err">{err}</p> : null}

      <div className="user-list">
        {users.map((u) => (
          <div key={u.username} className="user-row">
            <span className="user-name">
              {u.username}
              {u.username === currentUser ? ' (вы)' : ''}
            </span>
            <select value={u.role} onChange={(e) => changeRole(u.username, e.target.value as Role)}>
              <option value="admin">admin</option>
              <option value="viewer">viewer</option>
            </select>
            <button type="button" className="clear-button" onClick={() => resetPw(u.username)}>
              Сбросить пароль
            </button>
            <button
              type="button"
              className="delete-button"
              disabled={u.username === currentUser}
              onClick={() => del(u.username)}
            >
              Удалить
            </button>
          </div>
        ))}
      </div>

      <form className="user-add" onSubmit={add}>
        <input placeholder="Логин" value={nu} onChange={(e) => setNu(e.target.value)} />
        <input type="password" placeholder="Пароль" value={np} onChange={(e) => setNp(e.target.value)} />
        <select value={nr} onChange={(e) => setNr(e.target.value as Role)}>
          <option value="viewer">viewer</option>
          <option value="admin">admin</option>
        </select>
        <button type="submit" className="primary-button" disabled={busy || !nu.trim() || !np}>
          Добавить
        </button>
      </form>
    </div>
  );
}
