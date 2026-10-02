import { writeFileSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { mapDocumentSchema, publishedMapDocumentSchema } from '../src/maps/map-schema';
for (const [name, schema] of [['map-v1', mapDocumentSchema], ['map-published-v1', publishedMapDocumentSchema]] as const) {
  const output = JSON.stringify(z.toJSONSchema(schema, { target: 'draft-7' }), null, 2) + '\n';
  const path = `contracts/${name}.schema.json`;
  if (process.argv.includes('--check')) {
    if (readFileSync(path,'utf8') !== output) throw new Error(`地图契约漂移：${path}`);
  } else writeFileSync(path, output);
}
