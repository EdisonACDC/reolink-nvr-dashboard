FROM node:20-alpine

# Install only what's needed at runtime - no build tools
RUN apk add --no-cache \
    postgresql17 \
    postgresql17-client \
    bash \
    gzip

WORKDIR /app

COPY . .

RUN chmod a+x /app/run.sh

EXPOSE 3000

CMD ["/app/run.sh"]
