FROM postgres@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193 AS pgbackrest-package

ADD --checksum=sha256:63eba0121f33ae368363df12d29adeab6feff3f7862587e7b903f30c77298c0b \
  https://dl-cdn.alpinelinux.org/alpine/v3.24/community/x86_64/pgbackrest-2.58.0-r0.apk \
  /tmp/pgbackrest.apk
RUN mkdir -p /opt/pgbackrest-package \
    && tar -xzf /tmp/pgbackrest.apk -C /opt/pgbackrest-package

FROM postgres@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193

# The base digest is PostgreSQL 17.10 on Alpine 3.24. Install only pgBackRest's
# shared libraries: installing Alpine's `postgresql` dependency would add a
# second PostgreSQL major version beside the official image binaries.
RUN apk add --no-cache \
      libbz2 \
      libssh2 \
      libxml2 \
      lz4-libs \
      zlib \
      zstd-libs
COPY --from=pgbackrest-package /opt/pgbackrest-package/usr/bin/pgbackrest /usr/local/bin/pgbackrest
RUN pgbackrest version \
    && test ! -e /usr/bin/postgres
