import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const baseUrl = (__ENV.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const requestFailures = new Rate('core_request_failures');

export const options = {
  discardResponseBodies: true,
  scenarios: {
    online_sessions: {
      executor: 'constant-vus',
      exec: 'onlineSession',
      vus: Number(__ENV.ONLINE_VUS || 500),
      duration: __ENV.ONLINE_DURATION || '10m',
      gracefulStop: '15s',
    },
    active_reads: {
      executor: 'constant-arrival-rate',
      exec: 'activeRead',
      rate: Number(__ENV.ACTIVE_RPS || 50),
      timeUnit: '1s',
      duration: __ENV.ACTIVE_DURATION || '8m',
      preAllocatedVUs: Number(__ENV.ACTIVE_VUS || 100),
      maxVUs: Number(__ENV.ACTIVE_MAX_VUS || 150),
      gracefulStop: '15s',
    },
    spike_reads: {
      executor: 'ramping-arrival-rate',
      exec: 'activeRead',
      startTime: __ENV.SPIKE_START || '8m',
      startRate: Number(__ENV.ACTIVE_RPS || 50),
      timeUnit: '1s',
      preAllocatedVUs: Number(__ENV.ACTIVE_MAX_VUS || 150),
      maxVUs: Number(__ENV.SPIKE_MAX_VUS || 300),
      stages: [
        { target: Number(__ENV.SPIKE_RPS || 150), duration: '30s' },
        { target: Number(__ENV.SPIKE_RPS || 150), duration: '60s' },
        { target: 0, duration: '30s' },
      ],
      gracefulStop: '15s',
    },
  },
  thresholds: {
    core_request_failures: ['rate<0.01'],
    'http_req_duration{scenario:online_sessions}': ['p(95)<750', 'p(99)<1500'],
    'http_req_duration{scenario:active_reads}': ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{scenario:spike_reads}': ['p(95)<1000', 'p(99)<2000'],
    dropped_iterations: ['count<1'],
  },
};

const activeRoutes = [
  '/api/v1/threads?limit=20',
  '/api/v1/moments?limit=20',
  '/api/v1/meta',
  '/api/v1/health',
];

function get(path, tags) {
  const response = http.get(`${baseUrl}${path}`, { tags });
  const ok = check(response, { 'core response is 2xx': (value) => value.status >= 200 && value.status < 300 });
  requestFailures.add(!ok, tags);
}

export function onlineSession() {
  get('/api/v1/meta', { journey: 'online_poll' });
  sleep(Number(__ENV.ONLINE_POLL_SECONDS || 30));
}

export function activeRead() {
  const route = activeRoutes[(__VU + __ITER) % activeRoutes.length];
  get(route, { journey: 'active_read', route });
}

export function handleSummary(data) {
  return { [__ENV.SUMMARY_PATH || 'stdout']: JSON.stringify(data, null, 2) };
}
