import Encoding from 'encoding-japanese';
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

console.log('Fixtures created successfully!');
