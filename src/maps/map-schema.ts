import { z } from 'zod';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const text = z.string().max(2000);
const point = z.strictObject({ x: z.number().min(0).max(10000), y: z.number().min(0).max(10000) });
export const mapFeatureKinds = ['terrain','water','road','building','region','wall','door','window','stair','room','corridor','furniture'] as const;
export const mapLayers = ['terrain','water','roads','buildings','regions','labels','walls','openings','furniture','markers'] as const;
export const mapStyles = ['ink','parchment','soft'] as const;
const link = z.strictObject({ mapId: z.string().cuid(), version: z.number().int().min(1) });
const feature = z.strictObject({
  id, kind: z.enum(mapFeatureKinds), layer: z.enum(mapLayers), floorId: id.optional(),
  regionId: id.optional(), roomId: id.optional(), name: z.string().max(120), description: text,
  points: z.array(point).min(1).max(128), locked: z.boolean(), hidden: z.boolean(),
  connectsTo: z.array(id).max(20).optional(), interior: link.optional(),
});
const marker = z.strictObject({ id, x: point.shape.x, y: point.shape.y, floorId: id.optional(),
  label: z.string().max(120), description: text, hidden: z.boolean() });
export const mapDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1), kind: z.enum(['town','interior']),
  title: z.string().min(1).max(120), description: text,
  seed: z.string().min(1).max(100), generatorVersion: z.string().min(1).max(40),
  templateId: z.enum(['village','market-town','walled-town','house','inn','shop','manor']),
  templateVersion: z.literal('1.0.0'), style: z.enum(mapStyles),
  width: z.number().positive().max(10000), height: z.number().positive().max(10000),
  parameters: z.strictObject({
    scale: z.number().min(0).max(10000).optional(), density: z.number().min(0).max(1).optional(),
    regularity: z.number().min(0).max(1).optional(), greenery: z.number().min(0).max(1).optional(),
    floors: z.number().int().min(1).max(8).optional(), rooms: z.number().int().min(1).max(100).optional(),
    furnitureDensity: z.number().min(0).max(1).optional(), terrain: z.enum(['plain','river','coast']).optional(),
    walled: z.boolean().optional(), buildingCount: z.number().int().min(1).max(3000).optional(),
    regenerationSeeds: z.record(id, z.number().int().min(0).max(2147483647)).optional(),
  }),
  defaultView: z.strictObject({ x: point.shape.x, y: point.shape.y, zoom: z.number().min(0.05).max(20) }),
  floors: z.array(z.strictObject({ id, name: z.string().max(120), level: z.number().int().min(-8).max(8) })).max(8),
  features: z.array(feature).max(12000), markers: z.array(marker).max(200),
});
export type MapDocument = z.infer<typeof mapDocumentSchema>;
export const publishedMapDocumentSchema = mapDocumentSchema.omit({ parameters: true }).extend({
  features: z.array(feature.omit({ locked: true, hidden: true })).max(12000),
  markers: z.array(marker.omit({ hidden: true })).max(200),
});
export type PublishedMapDocument = z.infer<typeof publishedMapDocumentSchema>;
