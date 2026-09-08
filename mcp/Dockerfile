FROM node:22-alpine

WORKDIR /srv

COPY mcp/package.json ./mcp/package.json
RUN cd mcp && npm install --omit=dev

COPY app/src ./app/src
COPY decks ./decks
COPY mcp/src ./mcp/src
COPY mcp/tsconfig.json ./mcp/tsconfig.json

WORKDIR /srv/mcp
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

# Public/container binding intentionally fails closed unless the deployer supplies
# MCP_ALLOWED_HOSTS (and optionally MCP_ALLOWED_ORIGINS).
CMD ["npm", "run", "http"]
