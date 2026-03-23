ARG BUILD_FROM
FROM ${BUILD_FROM}

RUN apk add --no-cache \
    postgresql \
    postgresql-client \
    nodejs \
    npm \
    gzip

WORKDIR /app

COPY . .

RUN chmod +x /app/run.sh

EXPOSE 3000

CMD ["/app/run.sh"]
