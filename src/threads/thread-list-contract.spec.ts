import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Schema = {
  properties?: Record<string, unknown>;
  required?: string[];
  allOf?: Array<{
    properties?: {
      data?: { items?: { $ref?: string } };
    };
  }>;
};

type Contract = {
  paths: Record<
    string,
    Record<
      string,
      { responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }> }
    >
  >;
  components: { schemas: Record<string, Schema> };
};

const contract = JSON.parse(
  readFileSync(resolve(__dirname, '../../contracts/openapi.json'), 'utf8'),
) as Contract;

function schemaName(reference: string | undefined) {
  return reference?.replace('#/components/schemas/', '');
}

function paginatedItemSchema(path: string) {
  const responseReference =
    contract.paths[path]?.get?.responses?.['200']?.content?.['application/json']?.schema?.$ref;
  const response = contract.components.schemas[schemaName(responseReference) ?? ''];
  return schemaName(response?.allOf?.[1]?.properties?.data?.items?.$ref);
}

describe('列表卡片 OpenAPI 契约', () => {
  it('所有主题帖列表复用完整基础字段，只保留场景 schema 名称', () => {
    const base = contract.components.schemas.ThreadListItemResponseDto;
    const baseProperties = Object.keys(base.properties ?? {}).sort();
    const baseRequired = [...(base.required ?? [])].sort();

    expect(baseProperties).toEqual([
      '_count',
      'category',
      'coverImages',
      'createdAt',
      'defaultSubthread',
      'deletedAt',
      'id',
      'owner',
      'pinned',
      'preview',
      'published',
      'status',
      'tipTotal',
      'title',
      'topicTags',
      'updatedAt',
      'visibility',
    ]);

    for (const name of [
      'HomeThreadListItemResponseDto',
      'BookmarkThreadResponseDto',
      'OwnBookmarkThreadResponseDto',
      'SearchThreadResponseDto',
    ]) {
      const schema = contract.components.schemas[name];
      for (const property of baseProperties) {
        expect(schema.properties?.[property]).toEqual(base.properties?.[property]);
      }
      expect(schema.required).toEqual(expect.arrayContaining(baseRequired));
    }

    expect(paginatedItemSchema('/api/v1/threads')).toBe('HomeThreadListItemResponseDto');
    expect(paginatedItemSchema('/api/v1/search/threads')).toBe('SearchThreadResponseDto');
    expect(paginatedItemSchema('/api/v1/bookmarks')).toBe('OwnBookmarkThreadResponseDto');
    expect(paginatedItemSchema('/api/v1/users/{id}/bookmarks')).toBe('BookmarkThreadResponseDto');
    expect(paginatedItemSchema('/api/v1/users/{id}/played-threads')).toBe(
      'ThreadListItemResponseDto',
    );
    expect(paginatedItemSchema('/api/v1/users/{id}/created-threads')).toBe(
      'ThreadListItemResponseDto',
    );
  });

  it('所有动态列表继续复用同一基础卡片字段', () => {
    const base = contract.components.schemas.MomentCardResponseDto;
    const search = contract.components.schemas.MomentSearchResponseDto;
    for (const [property, definition] of Object.entries(base.properties ?? {})) {
      expect(search.properties?.[property]).toEqual(definition);
    }
    expect(search.required).toEqual(expect.arrayContaining(base.required ?? []));

    expect(paginatedItemSchema('/api/v1/moments')).toBe('MomentCardResponseDto');
    expect(paginatedItemSchema('/api/v1/search/moments')).toBe('MomentSearchResponseDto');
    expect(paginatedItemSchema('/api/v1/moments/bookmarks')).toBe('MomentCardResponseDto');
    expect(paginatedItemSchema('/api/v1/users/{id}/moments')).toBe('MomentCardResponseDto');
  });
});
