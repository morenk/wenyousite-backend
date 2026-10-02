import { mapDocumentSchema, publishedMapDocumentSchema } from './map-schema';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
describe('地图共享契约', () => {
 const fixture = JSON.parse(readFileSync(resolve(__dirname,'../../contracts/map-v1-fixtures.json'),'utf8')).document;
 it('接受跨层固定几何并拒绝未知脚本及非有限坐标', () => {
  expect(mapDocumentSchema.safeParse(fixture).success).toBe(true);
  expect(mapDocumentSchema.safeParse({...fixture,script:'alert(1)'}).success).toBe(false);
  expect(mapDocumentSchema.safeParse({...fixture,width:Infinity}).success).toBe(false);
 });
 it('公开 schema 不接受草稿参数或隐藏状态', () => {
  expect(publishedMapDocumentSchema.safeParse(fixture).success).toBe(false);
 });
});
