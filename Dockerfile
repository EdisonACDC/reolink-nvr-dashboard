FROM node:20-alpine

RUN apk add --no-cache \
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
