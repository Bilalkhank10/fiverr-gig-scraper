/**
 * Minimal, dependency-free .xlsx writer (one sheet, inline strings, bold header).
 * Enough for a scraper UI download — opens cleanly in Excel, Numbers and Google Sheets.
 */
import { Buffer } from 'node:buffer';

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    return table;
})();

function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}

function zip(files) {
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const file of files) {
        const name = Buffer.from(file.name, 'utf8');
        const data = Buffer.from(file.data, 'utf8');
        const crc = crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6); // UTF-8 names
        local.writeUInt16LE(0, 8); // store
        local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12); // time/date
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);
        chunks.push(local, name, data);

        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(0x02014b50, 0);
        cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
        cd.writeUInt16LE(0x0800, 8);
        cd.writeUInt16LE(0, 10);
        cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14);
        cd.writeUInt32LE(crc, 16);
        cd.writeUInt32LE(data.length, 20);
        cd.writeUInt32LE(data.length, 24);
        cd.writeUInt16LE(name.length, 28);
        cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
        cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36);
        cd.writeUInt32LE(0, 38);
        cd.writeUInt32LE(offset, 42);
        central.push(cd, name);
        offset += local.length + name.length + data.length;
    }
    const cdBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(cdBuf.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...chunks, cdBuf, end]);
}

const esc = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    // strip control chars Excel rejects
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

const colName = (n) => {
    let s = '';
    for (let i = n; i >= 0; i = Math.floor(i / 26) - 1) s = String.fromCharCode(65 + (i % 26)) + s;
    return s;
};

const cellValue = (v) => {
    if (v == null) return '';
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
};

/** items: array of flat objects → xlsx Buffer */
export function toXlsx(items, sheetName = 'Sheet1', { columns } = {}) {
    const headers = columns ?? [...new Set(items.flatMap((it) => Object.keys(it)))];
    const rows = [headers, ...items.map((it) => headers.map((h) => it[h]))];

    const sheetRows = rows.map((row, r) => {
        const cells = row.map((v, c) => {
            const ref = `${colName(c)}${r + 1}`;
            const style = r === 0 ? ' s="1"' : '';
            const raw = cellValue(v);
            const isNum = r > 0 && raw !== '' && /^-?\d+(\.\d+)?$/.test(raw);
            if (isNum) return `<c r="${ref}"${style}><v>${raw}</v></c>`;
            if (raw === '') return `<c r="${ref}"${style}/>`;
            return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(raw)}</t></is></c>`;
        }).join('');
        return `<row r="${r + 1}">${cells}</row>`;
    }).join('');

    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;

    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE6F4EA"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${esc(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

    const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

    return zip([
        { name: '[Content_Types].xml', data: contentTypes },
        { name: '_rels/.rels', data: rootRels },
        { name: 'xl/workbook.xml', data: workbook },
        { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
        { name: 'xl/styles.xml', data: styles },
        { name: 'xl/worksheets/sheet1.xml', data: sheet },
    ]);
}
