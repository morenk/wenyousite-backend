"""仅使用合成数据验证真实字体解析沙箱，不加载应用或用户字体。"""

import errno
import json
import os
import resource
import socket
import sys

resource.setrlimit(resource.RLIMIT_NPROC, (0, 0))
assert os.getuid() != 0
assert resource.getrlimit(resource.RLIMIT_AS) == (2147483648, 2147483648)
assert resource.getrlimit(resource.RLIMIT_CPU) == (600, 600)
status = dict(line.split(":", 1) for line in open("/proc/self/status"))
assert status["NoNewPrivs"].strip() == "1"
for key in ("CapEff", "CapPrm", "CapInh", "CapAmb", "CapBnd"):
    assert int(status[key].strip(), 16) == 0

for path in ("/", "/proc", "/dev", "/input", "/toolchain"):
    assert os.statvfs(path).f_flag & os.ST_RDONLY
assert not os.path.exists("/etc/wenyousite/backend.env")
with open("/input/probe.json") as source:
    config = json.load(source)
assert not os.path.exists(config["outsideCanary"])
assert open("/input/source").read() == "synthetic-font-sandbox-input"
for path in ("/input/source", "/unexpected-write"):
    try:
        with open(path, "w"):
            pass
        raise AssertionError("filesystem boundary bypass")
    except OSError as error:
        assert error.errno in (errno.EROFS, errno.EACCES, errno.EPERM)

assert [name for _, name in socket.if_nameindex()] == ["lo"]
try:
    socket.create_connection(("1.1.1.1", 443), timeout=1)
    raise AssertionError("network boundary bypass")
except OSError as error:
    assert error.errno in (errno.ENETUNREACH, errno.EPERM, errno.EACCES)
try:
    os.fork()
    os._exit(93)
except OSError as error:
    assert error.errno in (errno.EAGAIN, errno.EPERM)
try:
    bytearray(3 * 1024 * 1024 * 1024)
    raise AssertionError("memory boundary bypass")
except MemoryError:
    pass

sys.path.insert(0, "/toolchain")
import fontTools
import PIL
import brotli

assert (fontTools.__version__, PIL.__version__, brotli.__version__) == (
    "4.67.0", "13.0.0", "1.2.0"
)
with open("/output/evidence.json", "w") as evidence:
    json.dump({"passed": True}, evidence)
