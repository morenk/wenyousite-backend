const { createHash } = require('node:crypto');
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
  if (manifest.schemaVersion !== 1 || manifest.fontVersion !== 1 ||
      manifest.fonts.some((font) => font.deliveryMode !== 'subset' || font.budgetException))
    throw new Error('runtime_policy_manifest_identity');
  const network = (maxBytes, maxConcurrent) => ({
    windowMs: 60000, maxRequests: 64, maxBytes,
    maxConcurrent, timeoutMode: 'idle-with-total-cap', timeoutMs: 15000, maxTransferMs: 600000,
  });
  return {
    policyVersion: 2,
    manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
    web: {
      network: network(16777216, 2),
      residency: { mode: 'lease-lru', scope: 'document', maxFamilies: manifest.fonts.length, maxFaces: 64,
        maxSfntBytes: 16777216 },
    },
    mobile: {
      network: network(25165824, 1),
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
