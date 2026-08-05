FROM postgres:16-alpine
RUN apk add --no-cache dcron tar gzip aws-cli
COPY backup.sh restore.sh entrypoint.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
