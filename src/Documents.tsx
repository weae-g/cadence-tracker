import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Item } from './types';
import {
  DocMeta,
  addDocument,
  downloadDocument,
  fileIcon,
  formatSize,
  openDocument,
  removeDocument,
  useDocs,
} from './docs';

function formatDateTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Одна строка документа: иконка, имя, метаданные, действия.
function DocRow({
  doc,
  isAdmin,
  showCompany = false,
  showStage = false,
}: {
  doc: DocMeta;
  isAdmin: boolean;
  showCompany?: boolean;
  showStage?: boolean;
}) {
  const confirmRemove = () => {
    if (window.confirm(`Удалить «${doc.name}»? Файл будет стёрт безвозвратно.`)) {
      removeDocument(doc.id);
    }
  };
  return (
    <div className="doc-row">
      <span className="doc-icon">{fileIcon(doc)}</span>
      <button type="button" className="doc-name" onClick={() => openDocument(doc.id)} title="Открыть">
        {doc.name}
      </button>
      <div className="doc-meta">
        {showCompany ? <span>{doc.counterparty || 'Без контрагента'}</span> : null}
        {showStage && doc.stage ? <span className="doc-stage-tag">{doc.stage}</span> : null}
        <span>{formatSize(doc.size)}</span>
        <span>{formatDateTime(doc.addedAt)}</span>
      </div>
      <div className="doc-actions">
        <button type="button" className="clear-button" onClick={() => downloadDocument(doc)}>
          Скачать
        </button>
        {isAdmin ? (
          <button type="button" className="delete-button" onClick={confirmRemove}>
            Удалить
          </button>
        ) : null}
      </div>
    </div>
  );
}

// Кнопка-«скрепка» в строке письма: показывает число вложений, открывает модалку.
// Намеренно <span role="button">, а не <button>: строка таблицы обёрнута в
// <fieldset disabled> для viewer'а, и обычная кнопка была бы заблокирована.
export function DocCell({ item, isAdmin, stages }: { item: Item; isAdmin: boolean; stages: string[] }) {
  const docs = useDocs();
  const count = docs.filter((d) => d.itemId === item.id).length;
  const [open, setOpen] = useState(false);
  return (
    <>
      <span
        role="button"
        tabIndex={0}
        className="doc-chip"
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        title="Документы письма"
      >
        📎 {count}
      </span>
      {open ? <DocModal item={item} isAdmin={isAdmin} stages={stages} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

// Модалка вложений конкретного письма. Рендерится через портал в body,
// чтобы её кнопки не попадали под <fieldset disabled> таблицы.
function DocModal({
  item,
  isAdmin,
  stages,
  onClose,
}: {
  item: Item;
  isAdmin: boolean;
  stages: string[];
  onClose: () => void;
}) {
  const docs = useDocs();
  const [stage, setStage] = useState(item.status);
  const [busy, setBusy] = useState(false);
  const list = useMemo(
    () => docs.filter((d) => d.itemId === item.id).sort((a, b) => b.addedAt.localeCompare(a.addedAt)),
    [docs, item.id],
  );

  const stageOptions = stages.includes(stage) ? stages : [stage, ...stages];

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        await addDocument(file, { itemId: item.id, counterparty: item.counterparty, stage });
      }
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="doc-overlay" onClick={onClose}>
      <div className="doc-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="doc-dialog-head">
          <div>
            <h3>Документы письма</h3>
            <p className="hint">
              {(item.counterparty || 'Без контрагента') + (item.subject ? ` · ${item.subject}` : '')}
            </p>
          </div>
          <button type="button" className="doc-close" onClick={onClose} title="Закрыть">
            ✕
          </button>
        </div>

        {isAdmin ? (
          <div className="doc-upload">
            <label className="inline-label">
              Этап
              <select value={stage} onChange={(e) => setStage(e.target.value)}>
                {stageOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="doc-file-btn primary-button">
              {busy ? 'Загрузка…' : '＋ Загрузить файлы'}
              <input
                type="file"
                multiple
                disabled={busy}
                onChange={(e) => {
                  upload(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        ) : null}

        <div className="doc-list">
          {list.length === 0 ? (
            <p className="empty-state">Вложений пока нет.</p>
          ) : (
            list.map((doc) => <DocRow key={doc.id} doc={doc} isAdmin={isAdmin} showStage />)
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Глобальный браузер всех документов: фильтры, группировка по компании /
// этапу / дате (история), загрузка на уровне компании.
export function Documents({ items, stages, isAdmin }: { items: Item[]; stages: string[]; isAdmin: boolean }) {
  const docs = useDocs();
  const [groupBy, setGroupBy] = useState<'company' | 'stage' | 'date'>('company');
  const [filterCompany, setFilterCompany] = useState('Все');
  const [filterStage, setFilterStage] = useState('Все');
  const [search, setSearch] = useState('');

  // Загрузка на уровне компании (без привязки к письму).
  const [upCompany, setUpCompany] = useState('');
  const [upStage, setUpStage] = useState('');
  const [busy, setBusy] = useState(false);

  // Контрагенты: из писем и из самих документов (вдруг письмо удалили).
  const companies = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => set.add(i.counterparty.trim() || 'Без контрагента'));
    docs.forEach((d) => set.add(d.counterparty.trim() || 'Без контрагента'));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [items, docs]);

  // Этапы для фильтра/группировки: список воронки + «осиротевшие» из документов.
  const stageOrder = useMemo(() => {
    const extra = docs.map((d) => d.stage).filter((s) => s && !stages.includes(s));
    return [...stages, ...Array.from(new Set(extra))];
  }, [docs, stages]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return docs.filter((d) => {
      if (filterCompany !== 'Все' && (d.counterparty.trim() || 'Без контрагента') !== filterCompany) return false;
      if (filterStage !== 'Все' && (d.stage || '—') !== filterStage) return false;
      if (query && !d.name.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [docs, filterCompany, filterStage, search]);

  const groups = useMemo(() => {
    const byDate = [...filtered].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    if (groupBy === 'date') {
      return [{ key: 'История загрузок', docs: byDate }];
    }
    const map = new Map<string, DocMeta[]>();
    for (const d of byDate) {
      const key =
        groupBy === 'company' ? d.counterparty.trim() || 'Без контрагента' : d.stage || 'Без этапа';
      const arr = map.get(key);
      if (arr) arr.push(d);
      else map.set(key, [d]);
    }
    let keys = Array.from(map.keys());
    if (groupBy === 'stage') {
      const rank = (k: string) => {
        const i = stageOrder.indexOf(k);
        return i === -1 ? stageOrder.length : i;
      };
      keys.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'ru'));
    } else {
      keys.sort((a, b) => a.localeCompare(b, 'ru'));
    }
    return keys.map((key) => ({ key, docs: map.get(key)! }));
  }, [filtered, groupBy, stageOrder]);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        await addDocument(file, { itemId: '', counterparty: upCompany, stage: upStage });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {isAdmin ? (
        <section className="card">
          <h2>Загрузить документ к компании</h2>
          <div className="form-grid">
            <label>
              Контрагент
              <input
                list="doc-companies"
                value={upCompany}
                onChange={(e) => setUpCompany(e.target.value)}
                placeholder="Компания / организация"
              />
              <datalist id="doc-companies">
                {companies.filter((c) => c !== 'Без контрагента').map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label>
              Этап (необязательно)
              <select value={upStage} onChange={(e) => setUpStage(e.target.value)}>
                <option value="">— без этапа —</option>
                {stageOrder.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="doc-file-field">
              Файлы (.pdf, .docx, картинки…)
              <label className="doc-file-btn primary-button">
                {busy ? 'Загрузка…' : '＋ Выбрать и загрузить'}
                <input
                  type="file"
                  multiple
                  disabled={busy}
                  onChange={(e) => {
                    upload(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </label>
          </div>
          <span className="hint">Файлы хранятся локально в браузере (IndexedDB). Без привязки к письму.</span>
        </section>
      ) : null}

      <section className="card">
        <div className="table-header">
          <div>
            <h2>Документы ({docs.length})</h2>
            <div className="table-filters">
              <label>
                Контрагент
                <select value={filterCompany} onChange={(e) => setFilterCompany(e.target.value)}>
                  <option value="Все">Все</option>
                  {companies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Этап
                <select value={filterStage} onChange={(e) => setFilterStage(e.target.value)}>
                  <option value="Все">Все</option>
                  {stageOrder.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  <option value="—">Без этапа</option>
                </select>
              </label>
              <label>
                Поиск
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="по имени файла…" />
              </label>
            </div>
          </div>
          <div className="mode-switch">
            <button
              type="button"
              className={groupBy === 'company' ? 'toggle-button active' : 'toggle-button'}
              onClick={() => setGroupBy('company')}
            >
              По компаниям
            </button>
            <button
              type="button"
              className={groupBy === 'stage' ? 'toggle-button active' : 'toggle-button'}
              onClick={() => setGroupBy('stage')}
            >
              По этапам
            </button>
            <button
              type="button"
              className={groupBy === 'date' ? 'toggle-button active' : 'toggle-button'}
              onClick={() => setGroupBy('date')}
            >
              История
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="empty-state">Документов нет.</p>
        ) : (
          <div className="doc-groups">
            {groups.map((group) => (
              <div key={group.key} className="doc-group">
                <div className="doc-group-head">
                  <strong>{group.key}</strong>
                  <span className="stages-count">{group.docs.length}</span>
                </div>
                <div className="doc-list">
                  {group.docs.map((doc) => (
                    <DocRow
                      key={doc.id}
                      doc={doc}
                      isAdmin={isAdmin}
                      showCompany={groupBy !== 'company'}
                      showStage={groupBy !== 'stage'}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
