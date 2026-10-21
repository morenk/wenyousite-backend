// 由 scripts/fonts/generate-runtime-policy.cjs 生成；快照账本不是内存上限。
export const TEXT_FONT_RUNTIME_POLICY = {
  "policyVersion": 2,
  "manifestSha256": "e2836703a30eec5f59dd9d4d72f6887756c2dd30c070606db5cee258ebd0efa3",
  "web": {
    "network": {
      "windowMs": 60000,
      "maxRequests": 64,
      "maxBytes": 16777216,
      "maxConcurrent": 2,
      "timeoutMode": "idle-with-total-cap",
      "timeoutMs": 15000,
      "maxTransferMs": 600000
    },
    "residency": {
      "mode": "lease-lru",
      "scope": "document",
      "maxFamilies": 28,
      "maxFaces": 64,
      "maxSfntBytes": 16777216
    }
  },
  "mobile": {
    "network": {
      "windowMs": 60000,
      "maxRequests": 64,
      "maxBytes": 25165824,
      "maxConcurrent": 1,
      "timeoutMode": "idle-with-total-cap",
      "timeoutMs": 15000,
      "maxTransferMs": 600000
    },
    "registration": {
      "mode": "fixed-manifest",
      "scope": "engine",
      "key": "asset-sha256-and-family",
      "maxAttemptsPerKey": 1,
      "failedAttempt": "quarantine-and-retain-charge",
      "snapshot": {
        "assetCount": 868,
        "totalAssetBytes": 184645488,
        "registrationCount": 868,
        "totalRegistrationAssetBytes": 184645488
      },
      "safetyCeiling": {
        "maxSnapshotAssets": 1024,
        "maxSnapshotAssetBytes": 268435456
      }
    }
  },
  "retry": {
    "delayCeilingsMs": [
      1000,
      2000,
      4000,
      8000,
      16000,
      32000,
      60000
    ],
    "jitter": "full",
    "retryableHttpStatuses": [
      408,
      429,
      500,
      502,
      503,
      504
    ],
    "retryNetworkErrors": true,
    "retryTimeouts": true,
    "respectRetryAfter": true
  }
} as const;
