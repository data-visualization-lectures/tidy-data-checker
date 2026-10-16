import Encoding from 'encoding-japanese';
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

const fixturesDir = path.join(process.cwd(), 'src/__tests__/fixtures');

if (!fs.existsSync(fixturesDir)) {
  fs.mkdirSync(fixturesDir, { recursive: true });
}

const prefectureData = `都道府県別人口（令和5年）

都道府県,人口（人）,世帯数
北海道,5140000,2890000
青森県,1190000,580000
岩手県,1180000,540000
宮城県,2290000,1090000

出典：総務省統計局
`;

const unicodeArray = Encoding.stringToCode(prefectureData);
const sjisArray = Encoding.convert(unicodeArray, {
  to: 'SJIS',
  from: 'UNICODE',
});
const sjisBuffer = Buffer.from(sjisArray);
fs.writeFileSync(path.join(fixturesDir, 'prefecture-sjis.csv'), sjisBuffer);

const utf8BomBuffer = Buffer.concat([
  Buffer.from([0xEF, 0xBB, 0xBF]),
  Buffer.from(prefectureData, 'utf8')
]);
fs.writeFileSync(path.join(fixturesDir, 'prefecture-utf8-bom.csv'), utf8BomBuffer);

const utf8Buffer = Buffer.from(prefectureData, 'utf8');
fs.writeFileSync(path.join(fixturesDir, 'prefecture-utf8.csv'), utf8Buffer);

const emptyRowsData = `商品コード,商品名,価格
A001,りんご,150
A002,みかん,100

A003,バナナ,200

B001,牛乳,180
`;

const emptyRowsBuffer = Buffer.from(emptyRowsData, 'utf8');
fs.writeFileSync(path.join(fixturesDir, 'with-empty-rows.csv'), emptyRowsBuffer);

const emptyColsData = `ID,,名前,年齢,
1,,田中太郎,25,
2,,山田花子,30,
3,,佐藤次郎,28,
`;

const emptyColsBuffer = Buffer.from(emptyColsData, 'utf8');
fs.writeFileSync(path.join(fixturesDir, 'with-empty-cols.csv'), emptyColsBuffer);

const mixedEmptyData = `,,
商品コード,,商品名,価格,
A001,,りんご,150,

A002,,みかん,100,
,,
`;

const mixedEmptyBuffer = Buffer.from(mixedEmptyData, 'utf8');
fs.writeFileSync(path.join(fixturesDir, 'with-empty-mixed.csv'), mixedEmptyBuffer);

function createExcelWithMergedHeaders() {
  const wb = XLSX.utils.book_new();

  const sheet1Data = [
    ['表1 都道府県別人口統計（令和5年）', '', '', '', ''],
    ['単位：人', '', '', '', ''],
    ['', '', '人口', '', '世帯数'],
    ['都道府県コード', '都道府県', '男', '女', ''],
    ['01', '北海道', '2450000', '2690000', '2890000'],
    ['02', '青森県', '560000', '630000', '580000'],
    ['03', '岩手県', '570000', '610000', '540000'],
    ['04', '宮城県', '1120000', '1170000', '1090000'],
    ['', '', '', '', ''],
    ['注：人口は推計値', '', '', '', ''],
    ['出典：総務省統計局「住民基本台帳人口」', '', '', '', ''],
  ];

  const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);
  
  ws1['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
    { s: { r: 2, c: 2 }, e: { r: 2, c: 3 } },
    { s: { r: 9, c: 0 }, e: { r: 9, c: 4 } },
    { s: { r: 10, c: 0 }, e: { r: 10, c: 4 } },
  ];

  XLSX.utils.book_append_sheet(wb, ws1, '人口');

  const sheet2Data = [
    ['地域別農業生産額', '', '', ''],
    ['', '米', '野菜', '果物'],
    ['北海道', '5000', '3000', '500'],
    ['東北', '8000', '4000', '2000'],
    ['関東', '3000', '10000', '3000'],
  ];

  const ws2 = XLSX.utils.aoa_to_sheet(sheet2Data);
  ws2['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
  ];

  XLSX.utils.book_append_sheet(wb, ws2, '農業');

  const sheet3Data = [
    ['年度別推移', '', '', '', '', ''],
    ['', '2020年', '2020年', '2021年', '2021年', ''],
    ['地域', '売上', '利益', '売上', '利益', '備考'],
    ['北海道', '1000', '100', '1100', '120', '好調'],
    ['東北', '800', '80', '750', '60', ''],
    ['関東', '3000', '300', '3200', '350', ''],
  ];

  const ws3 = XLSX.utils.aoa_to_sheet(sheet3Data);
  ws3['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
    { s: { r: 1, c: 1 }, e: { r: 1, c: 2 } },
    { s: { r: 1, c: 3 }, e: { r: 1, c: 4 } },
  ];

  XLSX.utils.book_append_sheet(wb, ws3, '年度推移');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  fs.writeFileSync(path.join(fixturesDir, 'government-style.xlsx'), buffer);
}

function createExcelWithBodyMerges() {
  const wb = XLSX.utils.book_new();

  const sheetData = [
    ['地域', '都道府県', '人口', '面積'],
    ['北海道', '北海道', '5140000', '83424'],
    ['東北', '青森県', '1190000', '9646'],
    ['', '岩手県', '1180000', '15275'],
    ['', '秋田県', '930000', '11638'],
    ['', '宮城県', '2290000', '7282'],
    ['関東', '東京都', '14000000', '2194'],
    ['', '神奈川県', '9200000', '2416'],
    ['', '埼玉県', '7300000', '3798'],
  ];

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  
  ws['!merges'] = [
    { s: { r: 2, c: 0 }, e: { r: 5, c: 0 } },
    { s: { r: 6, c: 0 }, e: { r: 8, c: 0 } },
  ];

  XLSX.utils.book_append_sheet(wb, ws, '地域別');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  fs.writeFileSync(path.join(fixturesDir, 'body-merges.xlsx'), buffer);
}

createExcelWithMergedHeaders();
createExcelWithBodyMerges();

console.log('Fixtures created successfully!');
