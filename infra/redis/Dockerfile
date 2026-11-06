# SchoolOS V5 staging Redis authentication hardened image only.
# Credential values MUST enter at container startup, never as Docker build args.
FROM redis:7-alpine
COPY --chmod=755 infra/redis/schoolos-v5-redis-entrypoint.sh /usr/local/bin/schoolos-v5-redis-entrypoint
RUN /bin/sh -n /usr/local/bin/schoolos-v5-redis-entrypoint
ENTRYPOINT ["/usr/local/bin/schoolos-v5-redis-entrypoint"]
