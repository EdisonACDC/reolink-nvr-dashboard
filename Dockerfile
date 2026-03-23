ARG BUILD_FROM
FROM ${BUILD_FROM}

# Install Node.js, PostgreSQL and su-exec
RUN apk add --no-cache \
    nodejs \
    npm \
    postgresql \
    postgresql-client \
    bash \
    su-exec \
    gzip

WORKDIR /app

COPY . .

RUN chmod +x /app/run.sh

EXPOSE 3000

CMD ["/app/run.sh"]
