import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (name: string) => JSON.parse(readFileSync(name, 'utf8'));
const spec = read('contracts/openapi.json');
const fixture = read('contracts/rp-identity-profile-post.v1.fixtures.json');
assert.equal(fixture.version, 1);
assert.equal(fixture.contractVersion, spec.info.version);
assert.equal(fixture.capability, 'rpIdentityProfileSupported');
assert.equal(spec.components.schemas.ApiCapabilitiesResponseDto.properties[fixture.capability].type, 'boolean');
for (const name of ['CreateRpIdentityDto', 'UpdateRpIdentityDto', 'UpdateThreadIdentityDto']) {
  const dto = spec.components.schemas[name];
  assert.equal(dto.properties.profilePostId.nullable, true);
  assert.equal(dto.properties.profilePostId.type, 'string');
  assert.equal(dto.properties.clearProfilePost.type, 'boolean');
  assert(!dto.required?.includes('profilePostId'));
}
assert.deepEqual(spec.components.schemas.ThreadIdentityStateDto.properties.profilePostStatus.enum, ['NONE', 'AVAILABLE', 'UNAVAILABLE']);
for (const row of fixture.cases) {
  if (row.state) {
    assert(['NONE', 'AVAILABLE', 'UNAVAILABLE'].includes(row.state.profilePostStatus));
    assert.equal(typeof row.state.profilePostId === 'string', row.state.profilePostStatus === 'AVAILABLE');
  }
}
assert.equal(new Set(fixture.cases.map((row: { id: string }) => row.id)).size, fixture.cases.length);
console.log('RP profile contract fixtures checked');
