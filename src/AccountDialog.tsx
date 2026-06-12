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
import { ProjectMeta } from './storage';

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Ошибка');

// Диалог аккаунта: смена своего пароля + (для admin) пользователи и проекты.
export function AccountDialog({
  session,
  projects,
  projectMeta,
  onAddProject,
  onRenameProject,
  onDeleteProject,
  onSetProjectColor,
  onSetProjectIcon,
  onToggleArchiveProject,
  onClose,
}: {
  session: Session;
  projects: string[];
  projectMeta: ProjectMeta;
  onAddProject: (name: string) => void;
  onRenameProject: (from: string, to: string) => void;
  onDeleteProject: (name: string) => void;
  onSetProjectColor: (name: string, color: string) => void;
  onSetProjectIcon: (name: string, icon: string) => void;
  onToggleArchiveProject: (name: string) => void;
  onClose: () => void;
}) {
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
        {session.role === 'admin' ? (
          <ProjectsSection
            projects={projects}
            meta={projectMeta}
            onAdd={onAddProject}
            onRename={onRenameProject}
            onDelete={onDeleteProject}
            onSetColor={onSetProjectColor}
            onSetIcon={onSetProjectIcon}
            onToggleArchive={onToggleArchiveProject}
          />
        ) : null}
        {session.role === 'admin' ? <UsersSection currentUser={session.username} /> : null}
      </div>
    </div>,
    document.body,
  );
}

function ProjectsSection({
  projects,
  meta,
  onAdd,
  onRename,
  onDelete,
  onSetColor,
  onSetIcon,
  onToggleArchive,
}: {
  projects: string[];
  meta: ProjectMeta;
  onAdd: (name: string) => void;
  onRename: (from: string, to: string) => void;
  onDelete: (name: string) => void;
  onSetColor: (name: string, color: string) => void;
  onSetIcon: (name: string, icon: string) => void;
  onToggleArchive: (name: string) => void;
}) {
  const [name, setName] = useState('');

  const rename = (p: string) => {
    const next = window.prompt(`Новое имя проекта «${p}»:`, p)?.trim();
    if (next && next !== p) onRename(p, next);
  };
  const del = (p: string) => {
    if (window.confirm(`Удалить проект «${p}»? Его записи останутся, но станут «без проекта».`)) onDelete(p);
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd(name.trim());
    setName('');
  };

  return (
    <div className="account-section">
      <h4>Проекты</h4>
      <p className="hint">
        Цвет/иконка — оформление; «В архив» прячет проект из переключателя в шапке (данные остаются). Переименование и
        удаление затрагивают все разделы и перезагружают страницу.
      </p>
      {projects.length === 0 ? (
        <p className="empty-state">Проектов пока нет.</p>
      ) : (
        <div className="user-list">
          {projects.map((p) => {
            const m = meta[p] || {};
            return (
              <div key={p} className={m.archived ? 'project-row archived' : 'project-row'}>
                <input
                  className="project-color"
                  type="color"
                  value={m.color || '#3b82f6'}
                  onChange={(e) => onSetColor(p, e.target.value)}
                  title="Цвет"
                />
                <input
                  className="project-icon"
                  value={m.icon || ''}
                  onChange={(e) => onSetIcon(p, e.target.value.slice(0, 2))}
                  placeholder="🎯"
                  title="Иконка (эмодзи)"
                />
                <span className="user-name">
                  {p}
                  {m.archived ? ' · в архиве' : ''}
                </span>
                <button type="button" className="clear-button" onClick={() => onToggleArchive(p)}>
                  {m.archived ? 'Из архива' : 'В архив'}
                </button>
                <button type="button" className="clear-button" onClick={() => rename(p)}>
                  Переименовать
                </button>
                <button type="button" className="delete-button" onClick={() => del(p)}>
                  Удалить
                </button>
              </div>
            );
          })}
        </div>
      )}
      <form className="user-add" onSubmit={add}>
        <input placeholder="Новый проект" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="primary-button" disabled={!name.trim()}>
          Добавить
        </button>
      </form>
    </div>
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
