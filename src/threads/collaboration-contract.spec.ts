import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { API_CONTRACT_VERSION } from '../common/swagger/openapi-document';

type Schema = {
  properties?: Record<string, { $ref?: string; nullable?: boolean; enum?: string[] }>;
  required?: string[];
  allOf?: Array<{ properties?: { data?: { items?: { $ref?: string } } } }>;
};

type Operation = {
  operationId?: string;
  security?: Array<Record<string, unknown>>;
  'x-auth-mode'?: string;
  'x-pagination'?: string;
  responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
};

const contract = JSON.parse(
  readFileSync(resolve(__dirname, '../../contracts/openapi.json'), 'utf8'),
) as {
  info: { version: string };
  paths: Record<string, { get?: Operation }>;
  components: { schemas: Record<string, Schema> };
};

function schemaName(reference: string | undefined) {
  return reference?.replace('#/components/schemas/', '');
}

describe('协作管理 OpenAPI 契约', () => {
  it('协作主题端点固定 operationId、AuthRead 与主题卡片分页 envelope', () => {
    const operation = contract.paths['/api/v1/users/me/collaborated-threads']?.get;
    expect(operation).toMatchObject({
      operationId: 'usersGetMyCollaboratedThreads',
      security: [{ bearer: [] }],
      'x-auth-mode': 'authenticated',
      'x-pagination': 'cursor',
    });
    const envelopeName = schemaName(
      operation?.responses?.['200']?.content?.['application/json']?.schema?.$ref,
    );
    const envelope = contract.components.schemas[envelopeName ?? ''];
    expect(schemaName(envelope.allOf?.[1]?.properties?.data?.items?.$ref)).toBe(
      'ThreadListItemResponseDto',
    );
  });

  it('子贴发言能力为必填对象，拒绝原因必填可空', () => {
    const subthread = contract.components.schemas.ThreadSubthreadResponseDto;
    const capability = contract.components.schemas.PostingCapabilityResponseDto;
    expect(subthread.required).toContain('postingCapability');
    expect(subthread.properties?.postingCapability?.$ref).toBe(
      '#/components/schemas/PostingCapabilityResponseDto',
    );
    expect(capability.required).toEqual(['canPost', 'denialReason']);
    expect(capability.properties?.denialReason).toMatchObject({
      nullable: true,
      enum: [
        'AUTHENTICATION_REQUIRED',
        'BLOCKED_RELATION',
        'COLLABORATOR_REQUIRED',
        'PLAYER_REQUIRED',
      ],
    });
  });

  it('通知 payload 声明任免动作需要的结构字段', () => {
    const payload = contract.components.schemas.NotificationPayloadResponseDto;
    expect(Object.keys(payload.properties ?? {})).toEqual(
      expect.arrayContaining([
        'action',
        'threadId',
        'threadTitle',
        'actorId',
        'actorName',
        'replyTargetUserId',
        'replyTargetName',
        'oldRole',
        'newRole',
      ]),
    );
    expect(payload.properties?.replyTargetUserId).toMatchObject({ nullable: true });
    expect(payload.properties?.replyTargetName).toMatchObject({ nullable: true });
    expect(payload.properties?.oldRole?.enum).toEqual(['COLLABORATOR', 'PARTICIPANT']);
    expect(payload.properties?.newRole?.enum).toEqual(['COLLABORATOR', 'PARTICIPANT']);
    expect(contract.info.version).toBe(API_CONTRACT_VERSION);
  });

  it('通知目标状态为必填枚举，客户端只能导航 ACTIVE 目标', () => {
    const target = contract.components.schemas.NotificationTargetResponseDto;
    expect(target.required).toContain('state');
    expect(target.properties?.state?.enum).toEqual([
      'ACTIVE',
      'CONTENT_DELETED',
      'USER_DEACTIVATED',
      'NO_TARGET',
    ]);
  });
});
