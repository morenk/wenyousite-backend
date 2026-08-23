import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const baseUrl = (__ENV.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const tokens = JSON.parse(__ENV.AUTH_TOKENS || '[]');
if (!Array.isArray(tokens) || tokens.length === 0) {
  throw new Error('AUTH_TOKENS 必须是专用压测账号 Bearer token 的 JSON 数组');
}

const fixturePaths = {
  small: __ENV.MEDIA_SMALL_FILE || './loadtest/fixtures/small.png',
  medium: __ENV.MEDIA_MEDIUM_FILE || './loadtest/fixtures/medium.png',
  large: __ENV.MEDIA_LARGE_FILE || './loadtest/fixtures/large.png',
};
const fixtures = {
  small: open(fixturePaths.small, 'b'),
  medium: open(fixturePaths.medium, 'b'),
  large: open(fixturePaths.large, 'b'),
};

const failed = new Rate('media_flow_failures');
const completed = new Counter('media_completed');
const signLatency = new Trend('media_sign_ms', true);
const putLatency = new Trend('media_put_ms', true);
const confirmLatency = new Trend('media_confirm_ms', true);
const processingLatency = new Trend('media_processing_ms', true);
const endToEndLatency = new Trend('media_end_to_end_ms', true);

export const options = {
  scenarios: {
    media_uploads: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.MEDIA_RPS || 4),
      timeUnit: '1s',
      duration: __ENV.MEDIA_DURATION || '5m',
      preAllocatedVUs: Number(__ENV.MEDIA_PREALLOCATED_VUS || 100),
      maxVUs: Number(__ENV.MEDIA_MAX_VUS || 500),
      gracefulStop: __ENV.MEDIA_GRACEFUL_STOP || '2m',
    },
  },
  thresholds: {
    media_flow_failures: ['rate<0.01'],
    media_sign_ms: ['p(95)<500'],
    'media_put_ms{size_class:small}': ['p(95)<3000'],
    'media_put_ms{size_class:medium}': ['p(95)<12000'],
    'media_put_ms{size_class:large}': ['p(95)<30000'],
    media_confirm_ms: ['p(95)<750'],
    media_processing_ms: ['p(95)<30000', 'p(99)<60000'],
    media_end_to_end_ms: ['p(95)<45000', 'p(99)<90000'],
    dropped_iterations: ['count<1'],
  },
};

function chooseSize() {
  const bucket = (__VU * 31 + __ITER * 17) % 100;
  if (bucket < 70) return 'small';
  if (bucket < 95) return 'medium';
  return 'large';
}

function choosePurpose() {
  const bucket = (__VU * 13 + __ITER * 29) % 100;
  if (bucket < 45) return 'DIRECT_MESSAGE';
  if (bucket < 75) return 'MOMENT';
  if (bucket < 90) return 'RICH_CONTENT';
  return 'AVATAR';
}

function parseData(response) {
  try {
    return response.json('data');
  } catch (_) {
    return null;
  }
}

export default function () {
  const startedAt = Date.now();
  const sizeClass = chooseSize();
  const purpose = choosePurpose();
  const source = fixtures[sizeClass];
  const tags = { size_class: sizeClass, purpose };
  const token = tokens[(__VU + __ITER) % tokens.length];
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  let response = http.post(
    `${baseUrl}/api/v1/media/upload-url`,
    JSON.stringify({
      filename: `${sizeClass}.png`,
      contentType: 'image/png',
      size: source.byteLength,
      purpose,
    }),
    { headers, tags: { ...tags, stage: 'sign' } },
  );
  signLatency.add(response.timings.duration, tags);
  if (!check(response, { 'media sign is 2xx': (value) => value.status >= 200 && value.status < 300 })) {
    failed.add(true, { ...tags, failed_stage: 'sign' });
    return;
  }
  const signed = parseData(response);
  if (!signed?.uploadUrl || !signed?.mediaId) {
    failed.add(true, { ...tags, failed_stage: 'sign_payload' });
    return;
  }

  response = http.put(signed.uploadUrl, source, {
    headers: { 'Content-Type': 'image/png' },
    tags: { ...tags, stage: 'put' },
    timeout: __ENV.MEDIA_PUT_TIMEOUT || '60s',
  });
  putLatency.add(response.timings.duration, tags);
  if (!check(response, { 'media PUT is 2xx': (value) => value.status >= 200 && value.status < 300 })) {
    failed.add(true, { ...tags, failed_stage: 'put' });
    return;
  }

  response = http.post(
    `${baseUrl}/api/v1/media/upload-done`,
    JSON.stringify({ mediaId: signed.mediaId }),
    { headers, tags: { ...tags, stage: 'confirm' } },
  );
  confirmLatency.add(response.timings.duration, tags);
  if (!check(response, { 'media confirm is 2xx': (value) => value.status >= 200 && value.status < 300 })) {
    failed.add(true, { ...tags, failed_stage: 'confirm' });
    return;
  }

  const processingStartedAt = Date.now();
  const deadline = processingStartedAt + Number(__ENV.MEDIA_PROCESS_TIMEOUT_MS || 120000);
  while (Date.now() < deadline) {
    response = http.get(`${baseUrl}/api/v1/media/${signed.mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
      tags: { ...tags, stage: 'poll' },
    });
    const media = parseData(response);
    if (response.status >= 200 && response.status < 300 && media?.status === 'COMPLETED') {
      processingLatency.add(Date.now() - processingStartedAt, tags);
      endToEndLatency.add(Date.now() - startedAt, tags);
      completed.add(1, tags);
      failed.add(false, tags);
      return;
    }
    if (media?.status === 'FAILED') {
      failed.add(true, { ...tags, failed_stage: 'processing' });
      return;
    }
    sleep(Number(__ENV.MEDIA_POLL_SECONDS || 0.5));
  }
  failed.add(true, { ...tags, failed_stage: 'timeout' });
}

export function handleSummary(data) {
  return { [__ENV.SUMMARY_PATH || 'stdout']: JSON.stringify(data, null, 2) };
}
