ARG BUILD_FROM
FROM ${BUILD_FROM}

# Install Node.js, npm, and PostgreSQL from Alpine
RUN apk add --no-cache \
    nodejs \
    npm \
    postgresql \
    postgresql-client \
    bash \
    python3 \
    make \
    g++

# Install pnpm
RUN npm install -g pnpm@10

WORKDIR /app

# Copy project files
COPY . .

# Install all dependencies and build
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @workspace/nvr-dashboard run build
RUN pnpm --filter @workspace/api-server run build

RUN chmod +x /app/run.sh

EXPOSE 3000

CMD ["/app/run.sh"]
