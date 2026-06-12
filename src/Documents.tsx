import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Item, stageColor } from './types';
import {
  DocMeta,
  addDocument,
  downloadDocument,
  fileIcon,
  formatSize,
  getDocumentBlob,
  openDocument,
  removeDocument,
  updateDocument,
  useDocs,
} from './docs';

// Можно ли показать встроенный предпросмотр (картинка или PDF).
function canPreview(doc: Pick<DocMeta, 'mime' | 'name'>): boolean {
  if (doc.mime.startsWith('image/')) return true;
  if (doc.mime === 'application/pdf') return true;
  return doc.name.toLowerCase().endsWith('.pdf');
}

// Оверлей предпросмотра: грузит blob, рисует картинку или PDF во весь экран.
function PreviewOverlay({ doc, onClose }: { doc: DocMeta; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl = '';
    let alive = true;
    getDocumentBlob(doc.id).then((blob) => {
      if (!alive) return;
      if (!blob) {
        setFailed(true);
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [doc.id]);

  const isImage = doc.mime.startsWith('image/');

  return createPortal(
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="preview-head">
          <strong title={doc.name}>
            {fileIcon(doc)} {doc.name}
          </strong>
          <div className="preview-head-actions">
            <button type="button" className="clear-button" onClick={() => downloadDocument(doc)}>
              Скачать
            </button>
            <button type="button" className="doc-close" onClick={onClose} title="Закрыть">
              ✕
            </button>
          </div>
        </div>
        <div className="preview-body">
          {failed ? (
            <p className="empty-state">Файл не найден в хранилище.</p>
          ) : !url ? (
            <p className="empty-state">Загрузка…</p>
          ) : isImage ? (
            <img src={url} alt={doc.name} className="preview-image" />
          ) : (
            <iframe src={url} title={doc.name} className="preview-frame" />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
import { BarChart, EMPTY_RANGE, KpiRow, Range, RangeFilter, TrendChart, countBy, inRange, isRangeActive, trendFromDates } from './charts';

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
  const renameDoc = () => {
    const name = window.prompt('Имя документа:', doc.name)?.trim();
    if (name && name !== doc.name) updateDocument(doc.id, { name });
  };
  const [preview, setPreview] = useState(false);
  const previewable = canPreview(doc);
  return (
    <div className="doc-row">
      <div className="doc-row-main">
        <span className="doc-icon">{fileIcon(doc)}</span>
        <button
          type="button"
          className="doc-name"
          onClick={() => (previewable ? setPreview(true) : openDocument(doc.id))}
          title={previewable ? 'Предпросмотр' : 'Открыть'}
        >
          {doc.name}
        </button>
        <div className="doc-meta">
          {showCompany ? <span>{doc.counterparty || 'Без контрагента'}</span> : null}
          {showStage && doc.stage ? <span className="doc-stage-tag">{doc.stage}</span> : null}
          <span>{formatSize(doc.size)}</span>
          <span>{formatDateTime(doc.addedAt)}</span>
        </div>
        <div className="doc-actions">
          {previewable ? (
            <button type="button" className="doc-icon-btn" title="Предпросмотр" onClick={() => setPreview(true)}>
              👁
            </button>
          ) : null}
          {isAdmin ? (
            <button type="button" className="doc-icon-btn" title="Переименовать" onClick={renameDoc}>
              ✎
            </button>
          ) : null}
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
      <DocNote doc={doc} isAdmin={isAdmin} />
      {preview ? <PreviewOverlay doc={doc} onClose={() => setPreview(false)} /> : null}
    </div>
  );
}

// Примечание к документу: админ редактирует (сохранение по уходу с поля),
// просмотрщик видит текст, только если он есть.
function DocNote({ doc, isAdmin }: { doc: DocMeta; isAdmin: boolean }) {
  const [text, setText] = useState(doc.note ?? '');

  // Подхватываем внешние изменения (например, после переоткрытия модалки).
  useEffect(() => {
    setText(doc.note ?? '');
  }, [doc.note]);

  if (!isAdmin) {
    return doc.note ? <p className="doc-note-text">{doc.note}</p> : null;
  }

  const commit = () => {
    if (text !== (doc.note ?? '')) updateDocument(doc.id, { note: text });
  };

  return (
    <textarea
      className="doc-note-input"
      rows={1}
      value={text}
      placeholder="✎ Примечание к документу…"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
    />
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
        await addDocument(file, { itemId: item.id, counterparty: item.counterparty, stage, project: item.project });
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
export function Documents({
  items,
  stages,
  isAdmin,
  project,
}: {
  items: Item[];
  stages: string[];
  isAdmin: boolean;
  project: string;
}) {
  const docs = useDocs().filter((d) => project === '' || d.project === project);
  const [view, setView] = useState<'list' | 'charts'>('list');
  const [pwOpen, setPwOpen] = useState(false);
  const [range, setRange] = useState<Range>(EMPTY_RANGE);
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

  // Аналитика: документы по дате загрузки в выбранном периоде.
  const analytics = useMemo(() => {
    const inWindow = docs.filter((d) => (isRangeActive(range) ? inRange(d.addedAt, range) : true));
    const totalSize = inWindow.reduce((sum, d) => sum + (d.size || 0), 0);
    return {
      total: inWindow.length,
      totalSize,
      byCompany: countBy(inWindow, (d) => d.counterparty, 'Без контрагента').slice(0, 10),
      byStage: countBy(inWindow, (d) => d.stage, 'Без этапа'),
      trend: trendFromDates(inWindow.map((d) => d.addedAt)),
    };
  }, [docs, range]);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        await addDocument(file, { itemId: '', counterparty: upCompany, stage: upStage, project });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card tasks-toolbar">
        <div className="mode-switch">
          <button
            type="button"
            className={view === 'list' ? 'toggle-button active' : 'toggle-button'}
            onClick={() => setView('list')}
          >
            Список
          </button>
          <button
            type="button"
            className={view === 'charts' ? 'toggle-button active' : 'toggle-button'}
            onClick={() => setView('charts')}
          >
            Диаграммы
          </button>
        </div>
      </div>

      {pwOpen ? <PasswordZipDialog onClose={() => setPwOpen(false)} /> : null}

      {view === 'charts' ? (
        <section className="card">
          <h2>Диаграммы документов</h2>
          <RangeFilter range={range} onChange={setRange} />
          <KpiRow
            items={[
              { label: 'Документов', value: analytics.total },
              { label: 'Объём', value: formatSize(analytics.totalSize), tone: 'accent' },
              { label: 'Контрагентов', value: analytics.byCompany.length },
              { label: 'Этапов', value: analytics.byStage.length },
            ]}
          />
          <div className="charts-grid">
            <BarChart title="По контрагентам" subtitle="топ-10" data={analytics.byCompany} />
            <BarChart
              title="По этапам"
              data={analytics.byStage.map((d, i) => ({ ...d, color: stageColor(i) }))}
            />
          </div>
          <div className="charts-grid" style={{ marginTop: 16 }}>
            <TrendChart title="Загрузки по месяцам" data={analytics.trend} color="#0ea5e9" />
          </div>
        </section>
      ) : (
      <>
      {isAdmin ? (
        <div className="card doc-secure-bar">
          <div>
            <strong>Архив документов</strong>
            <p className="hint">Скачать все файлы одним ZIP, зашифрованным паролем (стандарт AES-256).</p>
          </div>
          <button type="button" className="primary-button" onClick={() => setPwOpen(true)} disabled={docs.length === 0}>
            🔒 Зашифрованный ZIP
          </button>
        </div>
      ) : null}

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
      )}
    </>
  );
}

// Диалог пароля для зашифрованного ZIP. Архив собирается стандартом AES-256
// и открывается любым архиватором (WinRAR/7-Zip) по этому же паролю.
function PasswordZipDialog({ onClose }: { onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    if (pw.length < 4) {
      setError('Пароль слишком короткий — минимум 4 символа.');
      return;
    }
    if (pw !== pw2) {
      setError('Пароли не совпадают.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { exportDocumentFilesEncrypted } = await import('./export');
      const count = await exportDocumentFilesEncrypted(pw);
      if (count === 0) {
        setError('Документов для выгрузки нет.');
        setBusy(false);
        return;
      }
      onClose();
    } catch {
      setError('Не удалось создать архив.');
      setBusy(false);
    }
  };

  return createPortal(
    <div className="doc-overlay" onClick={busy ? undefined : onClose}>
      <div className="doc-dialog pw-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="doc-dialog-head">
          <div>
            <h3>🔒 Зашифрованный архив</h3>
            <p className="hint">Все документы будут упакованы в один ZIP с шифрованием AES-256.</p>
          </div>
          <button type="button" className="doc-close" onClick={onClose} disabled={busy} title="Закрыть">
            ✕
          </button>
        </div>

        <div className="pw-fields">
          <label>
            Пароль
            <input
              type={show ? 'text' : 'password'}
              value={pw}
              autoFocus
              onChange={(e) => setPw(e.target.value)}
              placeholder="Придумайте пароль"
            />
          </label>
          <label>
            Повторите пароль
            <input
              type={show ? 'text' : 'password'}
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy) run();
              }}
              placeholder="Ещё раз"
            />
          </label>
          <label className="pw-show">
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
            Показать пароль
          </label>
        </div>

        {error ? <p className="pw-error">{error}</p> : null}
        <p className="hint">Пароль нигде не сохраняется — запишите его. Без пароля архив не открыть.</p>

        <div className="pw-actions">
          <button type="button" className="clear-button" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button type="button" className="primary-button" onClick={run} disabled={busy || !pw || !pw2}>
            {busy ? 'Шифрование…' : 'Создать ZIP'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
