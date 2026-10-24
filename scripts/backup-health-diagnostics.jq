# 错误正文可能含签名 URL、鉴权头和 S3 响应。仅提取白名单诊断字段，禁止回显原文。
def status_code:
  if type == "number" and . >= 0 and . <= 999 and floor == . then . else -1 end;

def status_message:
  {
    "0": "ok", "1": "missing stanza path", "2": "no valid backups",
    "3": "missing stanza data", "4": "different across repos",
    "5": "database mismatch across repos", "6": "requested backup not found",
    "99": "other"
  }[tostring] // "unknown";

def text_value:
  if type == "string" then . else "" end;

def diagnostics:
  text_value as $raw |
  $raw[0:32768] as $text |
  {
    present: ($raw | length > 0),
    truncated: ($raw | length > 32768),
    error_types: ([
      "AccessError", "ArchiveTimeoutError", "AssertError", "ChecksumError", "ClockError",
      "CommandError", "ConfigError", "CryptoError", "ExecuteError", "FileInfoError",
      "FileInvalidError", "FileMissingError", "FileOpenError", "FileReadError", "FormatError",
      "HostConnectError", "HostInvalidError", "JsonFormatError", "KernelError", "LockAcquireError", "MemoryError",
      "OptionInvalidError", "OptionInvalidValueError", "OptionRequiredError", "PathMissingError",
      "PathOpenError", "ProtocolError", "RepoInvalidError", "ServiceError"
    ] | map(select(. as $kind | $text | contains("[" + $kind + "]"))) | .[0:6]),
    causes: ([
      {name: "timeout", pattern: "timed? ?out|timeout"},
      {name: "retry_exhausted", pattern: "retr(y|ies).*exhausted"},
      {name: "dns", pattern: "getaddrinfo|name or service not known|name resolution|resolve host|unable to get address for"},
      {name: "connection_refused", pattern: "connection refused"},
      {name: "connection_reset", pattern: "connection reset|unexpected eof|broken pipe"},
      {name: "network_unreachable", pattern: "network is unreachable|no route to host"},
      {name: "tls", pattern: "\\b(TLS|SSL|certificate|handshake)\\b"},
      {name: "permission_denied", pattern: "permission denied|access denied|AccessDenied|Forbidden"},
      {name: "authentication", pattern: "SignatureDoesNotMatch|InvalidAccessKeyId|ExpiredToken|InvalidToken"},
      {name: "not_found", pattern: "NoSuchBucket|NoSuchKey|no such file|not found|does not exist"},
      {name: "invalid_configuration", pattern: "invalid option|requires option|invalid configuration"},
      {name: "repository_invalid", pattern: "checksum|cipher|decrypt|invalid backup|invalid archive"},
      {name: "docker_unavailable", pattern: "cannot connect to the docker daemon|no such container|container .* is not running"}
    ] | map(select(.pattern as $pattern | $text | test($pattern; "i")) | .name) | .[0:8]),
    http_status: ([$text | scan("(?:HTTP/[0-9.]+ |HTTP request failed with |HTTP status[=: ]+)([1-5][0-9]{2})(?:[^0-9]|$)"; "i") | .[0] | tonumber] | unique | .[0:4]),
    timeout_ms: ([$text | scan("(?:timeout|timed out) after ([0-9]{1,9})ms"; "i") | .[0] | tonumber] | unique | .[0:4]),
    s3_codes: ([
      "AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch", "ExpiredToken", "InvalidToken",
      "RequestTimeTooSkewed", "RequestTimeout", "SlowDown", "ServiceUnavailable", "InternalError",
      "NoSuchBucket", "NoSuchKey"
    ] | map(select(. as $code | $text | test("<Code>" + $code + "</Code>"))) | .[0:4]),
    pgbackrest_error_codes: ([$text | scan("(?:ERROR|WARN): \\[([0-9]{3})\\]") | .[0] | tonumber] | unique | .[0:6])
  };

def valid_repo:
  if type != "object" then false
  else (.key | status_code) > 0 and (.status | type) == "object" and (.status.code | status_code) >= 0
  end;

($info | try {parsed: true, value: fromjson} catch {parsed: false, value: null}) as $parsed |
(if ($parsed.value | type) == "array" then $parsed.value else [] end) as $stanzas |
(if ($stanzas[0] | type) == "object" then $stanzas[0] else {} end) as $stanza |
(if ($stanza.status | type) == "object" then $stanza.status else {} end) as $status |
(if ($stanza.repo | type) == "array" then $stanza.repo else [] end) as $repos |
(
  if ($info | test("^\\s*$")) then "empty"
  elif $parsed.parsed != true then "invalid_json"
  elif ($stanzas | length) != 1 or ($stanza.status | type) != "object"
    or ($status.code | status_code) < 0 or ($repos | length) == 0
    or (all($repos[]; valid_repo) | not) then "invalid_shape"
  else "valid"
  end
) as $output_state |
{
  output_state: $output_state,
  healthy: ($output_state == "valid" and $status.code == 0 and all($repos[]; .status.code == 0)),
  status: ($status.code | status_code),
  message: ($status.code | status_code | status_message),
  detail: ($status.message | diagnostics),
  repository_count: ($repos | length),
  repositories_truncated: ($repos | length > 4),
  repositories: ([$repos[] | select(valid_repo and .status.code != 0) | {
    key: (.key | status_code),
    status: (.status.code | status_code),
    message: (.status.code | status_code | status_message),
    detail: (.status.message | diagnostics)
  }] | .[0:4]),
  stderr: ($stderr | diagnostics),
  stdout: (if $output_state == "valid" then null else ($info | diagnostics) end)
}
