ARG BUILD_FROM
FROM ${BUILD_FROM}

# Install Node.js and PostgreSQL only (no build tools needed - files are pre-built)
RUN apk add --no-cache \
    nodejs \
    npm \
    postgresql \
    postgresql-client \
    bash

WORKDIR /app

COPY . .

RUN chmod +x /app/run.sh

EXPOSE 3000

CMD ["/app/run.sh"]
