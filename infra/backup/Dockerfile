FROM postgres:16-alpine
RUN apk add --no-cache dcron tar gzip aws-cli
COPY backup.sh restore.sh verify-offsite.sh restore-from-s3.sh configure-retention.sh entrypoint.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/verify-offsite.sh /usr/local/bin/restore-from-s3.sh /usr/local/bin/configure-retention.sh /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
