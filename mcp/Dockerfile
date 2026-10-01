FROM node:24-alpine

WORKDIR /srv

COPY mcp/package.json mcp/package-lock.json ./mcp/
RUN cd mcp && npm ci --omit=dev

COPY app/src ./app/src
COPY mcp/src ./mcp/src
COPY mcp/tsconfig.json ./mcp/tsconfig.json
COPY tools/check-public-distribution.mjs ./tools/check-public-distribution.mjs
RUN node tools/check-public-distribution.mjs --runtime /srv

WORKDIR /srv/mcp
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

# Public/container binding intentionally fails closed unless the deployer supplies
# MCP_ALLOWED_HOSTS (and optionally MCP_ALLOWED_ORIGINS).
CMD ["npm", "run", "http"]
