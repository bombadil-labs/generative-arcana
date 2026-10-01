FROM node:24-alpine AS authoring-build
WORKDIR /srv
COPY tools/build-authoring-guide.mjs ./tools/build-authoring-guide.mjs
COPY skill/generative-arcana ./skill/generative-arcana
COPY docs/contracts-and-readings.md docs/deck-manifest.md docs/schema-v2.md docs/visual-grammar.md ./docs/
RUN node tools/build-authoring-guide.mjs && node tools/build-authoring-guide.mjs --check

FROM node:24-alpine

WORKDIR /srv

COPY mcp/package.json mcp/package-lock.json ./mcp/
RUN cd mcp && npm ci --omit=dev

COPY app/src ./app/src
COPY mcp/src ./mcp/src
COPY mcp/tsconfig.json ./mcp/tsconfig.json
COPY --from=authoring-build /srv/mcp/generated ./mcp/generated
COPY tools/build-authoring-guide.mjs ./tools/build-authoring-guide.mjs
RUN node --input-type=module -e 'import { readBuiltAuthoringGuide } from "./tools/build-authoring-guide.mjs"; readBuiltAuthoringGuide();'
COPY tools/check-packaged-authoring-guide.mjs ./tools/check-packaged-authoring-guide.mjs
RUN node tools/check-packaged-authoring-guide.mjs
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
