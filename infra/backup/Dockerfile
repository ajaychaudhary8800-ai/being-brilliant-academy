FROM postgres:16-alpine
RUN apk add --no-cache dcron tar gzip aws-cli
COPY backup.sh restore.sh entrypoint.sh healthcheck.sh verify-checksums.sh /usr/local/bin/
# A Windows checkout may silently replace LF with CRLF; validate all executable
# scripts during image build (and fail before any backup/restore runs).
RUN set -eu; \
    for file in /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/entrypoint.sh /usr/local/bin/healthcheck.sh /usr/local/bin/verify-checksums.sh; do \
      sed -i 's/\r$//' "$file"; \
      /bin/sh -n "$file"; \
      chmod 0755 "$file"; \
      test -x "$file"; \
    done
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
