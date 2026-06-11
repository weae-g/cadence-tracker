// Минимальный ZIP-упаковщик без сжатия (метод store). Нужен, чтобы выгрузить
// все файлы документов одним архивом, не таща стороннюю библиотеку.
// Имена пишутся в UTF-8 (выставлен флаг 0x0800), поэтому кириллица в названиях
// корректно отображается в Windows Explorer, 7-Zip и т.п.

export type ZipEntry = { name: string; data: Uint8Array };

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

export function buildZip(files: ZipEntry[]): Blob {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); // сигнатура локального заголовка
    lh.setUint16(4, 20, true); // версия для распаковки
    lh.setUint16(6, 0x0800, true); // флаги: имена в UTF-8
    lh.setUint16(8, 0, true); // метод: store (без сжатия)
    lh.setUint16(10, 0, true); // время
    lh.setUint16(12, 0, true); // дата
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true); // сжатый размер = исходному
    lh.setUint32(22, size, true);
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true); // длина extra
    const local = new Uint8Array(lh.buffer);
    chunks.push(local, nameBytes, f.data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); // сигнатура записи каталога
    cd.setUint16(4, 20, true); // версия создателя
    cd.setUint16(6, 20, true); // версия для распаковки
    cd.setUint16(8, 0x0800, true); // флаги UTF-8
    cd.setUint16(10, 0, true); // метод store
    cd.setUint16(12, 0, true);
    cd.setUint16(14, 0, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint16(30, 0, true); // extra
    cd.setUint16(32, 0, true); // комментарий
    cd.setUint16(34, 0, true); // № диска
    cd.setUint16(36, 0, true); // внутренние атрибуты
    cd.setUint32(38, 0, true); // внешние атрибуты
    cd.setUint32(42, offset, true); // смещение локального заголовка
    central.push(new Uint8Array(cd.buffer), nameBytes);

    offset += local.length + nameBytes.length + f.data.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  central.forEach((c) => (centralSize += c.length));

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); // сигнатура End Of Central Directory
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, centralStart, true);
  eocd.setUint16(20, 0, true);

  const parts: Uint8Array[] = [...chunks, ...central, new Uint8Array(eocd.buffer)];
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return new Blob([out], { type: 'application/zip' });
}
