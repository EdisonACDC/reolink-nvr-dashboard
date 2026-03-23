FROM node:24-alpine

# Install system dependencies
RUN apk add --no-cache \
    postgresql17 \
    postgresql17-client \
    bash \
    su-exec \
    python3 \
    make \
    g++

# Install pnpm
RUN npm install -g pnpm@10

WORKDIR /app

# Copy project files
COPY . .

# Remove local artifacts that shouldn't be in image
RUN rm -rf node_modules artifacts/*/node_modules lib/*/node_modules

# Install all dependencies
RUN pnpm install --no-frozen-lockfile

# Build frontend (static files)
RUN pnpm --filter @workspace/nvr-dashboard run build

# Build backend API server
RUN pnpm --filter @workspace/api-server run build

# Make startup script executable
RUN chmod +x /app/run.sh

EXPOSE 3000

CMD ["/app/run.sh"]
