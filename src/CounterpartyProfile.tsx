// Досье контрагента: всё, что связано с компанией, на одной странице-оверлее —
// письма (кликабельны → карточка письма), взаимодействия, документы и (по упоминанию)
// задачи, плюс сводные показатели. Открывается кликом по названию компании.

import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Item, stageColor } from './types';
import { loadInteractions, loadTasks } from './storage';
import { DocMeta, fileIcon, openDocument } from './docs';

const ONE_DAY = 24 * 60 * 60 * 1000;

const parseDate = (v: string) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const fmt = (v: string) => {
  const d = parseDate(v);
  return d ? d.toLocaleDateString('ru-RU') : '—';
};
const waitDays = (it: Item) => {
  const s = parseDate(it.sentDate);
  if (!s) return null;
  const e = parseDate(it.replyDate) ?? new Date();
  return Math.max(0, Math.round((e.getTime() - s.getTime()) / ONE_DAY));
};
const cpKey = (s: string) => s.trim() || 'Без контрагента';

export function CounterpartyProfile({
  name,
  project,
  items,
  stages,
  docs,
  onOpenLetter,
  onClose,
}: {
  name: string;
  project: string;
  items: Item[];
  stages: string[];
  docs: DocMeta[];
  onOpenLetter: (id: string, ids?: string[]) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const data = useMemo(() => {
    const inProj = (p: string) => project === '' || p === project;
    const letters = items
      .filter((i) => inProj(i.project) && cpKey(i.counterparty) === name)
      .slice()
      .sort((a, b) => (b.sentDate || '').localeCompare(a.sentDate || ''));
    const interactions = loadInteractions()
      .filter((i) => inProj(i.project) && cpKey(i.counterparty) === name)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const tasks = loadTasks().filter((t) => inProj(t.project) && cpKey(t.counterparty) === name);
    const cdocs = docs.filter((d) => inProj(d.project) && cpKey(d.counterparty) === name);
    const replied = letters.filter((l) => l.replyDate).length;
    const dates = [
      ...letters.flatMap((l) => [l.sentDate, l.replyDate]),
      ...interactions.map((i) => i.date),
    ]
      .filter(Boolean)
      .sort();
    return {
      letters,
      interactions,
      tasks,
      cdocs,
      letterIds: letters.map((l) => l.id),
      replied,
      noReply: letters.length - replied,
      replyRate: letters.length ? Math.round((replied / letters.length) * 100) : 0,
      lastActivity: dates.length ? dates[dates.length - 1] : '',
    };
  }, [name, project, items, docs]);

  const stageBg = (status: string) => {
    const i = stages.indexOf(status);
    return i === -1 ? '#9ca3af' : stageColor(i);
  };

  return createPortal(
    <div className="doc-overlay" onClick={onClose}>
      <div className="doc-dialog profile-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="doc-dialog-head">
          <div>
            <h3>🏢 {name}</h3>
            <p className="hint">
              {data.lastActivity ? `Последняя активность: ${fmt(data.lastActivity)}` : 'Активности пока нет'}
            </p>
          </div>
          <button type="button" className="doc-close" onClick={onClose} title="Закрыть (Esc)">
            ✕
          </button>
        </div>

        <div className="kpi-row">
          <div className="kpi">
            <span className="kpi-value">{data.letters.length}</span>
            <span className="kpi-label">Писем</span>
          </div>
          <div className="kpi kpi-ok">
            <span className="kpi-value">{data.replyRate}%</span>
            <span className="kpi-label">Ответов</span>
          </div>
          <div className="kpi kpi-warn">
            <span className="kpi-value">{data.noReply}</span>
            <span className="kpi-label">Без ответа</span>
          </div>
          <div className="kpi">
            <span className="kpi-value">{data.interactions.length}</span>
            <span className="kpi-label">Взаимодействий</span>
          </div>
          <div className="kpi">
            <span className="kpi-value">{data.cdocs.length}</span>
            <span className="kpi-label">Документов</span>
          </div>
        </div>

        <div className="profile-section">
          <h4>Письма ({data.letters.length})</h4>
          {data.letters.length === 0 ? (
            <p className="empty-state">Писем нет.</p>
          ) : (
            <div className="profile-list">
              {data.letters.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className="profile-letter"
                  onClick={() => onOpenLetter(l.id, data.letterIds)}
                  title="Открыть карточку письма"
                >
                  <span className="profile-letter-main">
                    <span className="profile-letter-title">{l.subject || l.topic || 'Без темы'}</span>
                    <span className="profile-letter-sub">
                      {fmt(l.sentDate)} → {l.replyDate ? fmt(l.replyDate) : '—'} · {waitDays(l) ?? '—'} дн.
                    </span>
                  </span>
                  <span className="status-chip" style={{ background: stageBg(l.status) }}>
                    {l.status}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {data.interactions.length ? (
          <div className="profile-section">
            <h4>Взаимодействия ({data.interactions.length})</h4>
            <div className="profile-list">
              {data.interactions.map((i) => (
                <div key={i.id} className="profile-static-row">
                  <span className="profile-letter-title">{i.title || 'Без темы'}</span>
                  <span className="profile-letter-sub">
                    {[i.kind, i.date ? fmt(i.date) : 'без даты'].filter(Boolean).join(' · ')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {data.cdocs.length ? (
          <div className="profile-section">
            <h4>Документы ({data.cdocs.length})</h4>
            <div className="company-docs">
              {data.cdocs.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="company-doc-chip"
                  onClick={() => openDocument(d.id)}
                  title={d.name}
                >
                  {fileIcon(d)} {d.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {data.tasks.length ? (
          <div className="profile-section">
            <h4>Задачи ({data.tasks.length})</h4>
            <div className="profile-list">
              {data.tasks.map((t) => (
                <div key={t.id} className="profile-static-row">
                  <span className="profile-letter-title">
                    {t.done ? '✓ ' : ''}
                    {t.title || 'Без названия'}
                  </span>
                  <span className="profile-letter-sub">
                    {t.done ? `выполнено ${fmt(t.completedDate)}` : `срок ${fmt(t.dueDate)}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
