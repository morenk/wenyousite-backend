const { createHash } = require('node:crypto');
const ORIGINAL_SHA = 'cf4a4215e562d6de6e3ee88f25fc5d47d77668d28eb3a0f2533c7290de307423';
const ORIGINAL_BYTES = 18410600;
const SAFETY = { maxSnapshotAssets: 1024, maxSnapshotAssetBytes: 268435456 };

function snapshotOf(manifest) {
  const assets = new Map();
  const registrations = new Map();
  for (const font of manifest.fonts.filter((row) => row.availability === 'ready')) {
    for (const shard of font.shards) {
      const asset = shard.mobile;
      if (assets.has(asset.sha256) && assets.get(asset.sha256) !== asset.bytes)
        throw new Error('snapshot_asset_identity_conflict');
      assets.set(asset.sha256, asset.bytes);
      registrations.set(asset.sha256 + ':' + shard.family, asset.bytes);
    }
  }
  const snapshot = {
    assetCount: assets.size,
    totalAssetBytes: [...assets.values()].reduce((sum, size) => sum + size, 0),
    registrationCount: registrations.size,
    totalRegistrationAssetBytes: [...registrations.values()].reduce((sum, size) => sum + size, 0),
  };
  if (Math.max(snapshot.assetCount, snapshot.registrationCount) > SAFETY.maxSnapshotAssets ||
      Math.max(snapshot.totalAssetBytes, snapshot.totalRegistrationAssetBytes) > SAFETY.maxSnapshotAssetBytes)
    throw new Error('snapshot_exceeds_client_safety_ceiling');
  return snapshot;
}

function policyOf(manifestBytes) {
  const manifest = JSON.parse(manifestBytes);
  const original = manifest.fonts.find((font) => font.id === 'xiaocheng-lafeng');
  if (manifest.schemaVersion !== 1 || manifest.fontVersion !== 1 ||
      original?.fontSha256 !== ORIGINAL_SHA || original.shards?.length !== 1 ||
      original.shards[0].mobile.bytes !== ORIGINAL_BYTES)
    throw new Error('runtime_policy_manifest_identity');
  const network = (maxBytes, maxConcurrent, originalWindowBytes) => ({
    windowMs: 60000, maxRequests: 64, maxBytes, originalWindowBytes,
    maxConcurrent, timeoutMs: 15000,
  });
  return {
    policyVersion: 2,
    manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
    originalAsset: { fontId: 'xiaocheng-lafeng', sha256: ORIGINAL_SHA, bytes: ORIGINAL_BYTES, maxResidentCopies: 1 },
    web: {
      network: network(16777216, 2, ORIGINAL_BYTES),
      residency: { mode: 'lease-lru', scope: 'document', maxFamilies: manifest.fonts.length, maxFaces: 64,
        maxSfntBytes: 16777216, originalSfntBytes: ORIGINAL_BYTES },
    },
    mobile: {
      network: network(25165824, 1, 0),
      registration: { mode: 'fixed-manifest', scope: 'engine', key: 'asset-sha256-and-family',
        maxAttemptsPerKey: 1, failedAttempt: 'quarantine-and-retain-charge',
        snapshot: snapshotOf(manifest), safetyCeiling: { ...SAFETY } },
    },
    retry: { delayCeilingsMs: [1000, 2000, 4000, 8000, 16000, 32000, 60000],
      jitter: 'full', retryableHttpStatuses: [408, 429, 500, 502, 503, 504],
      retryNetworkErrors: true, retryTimeouts: true, respectRetryAfter: true },
  };
}
module.exports = { policyOf, snapshotOf };
