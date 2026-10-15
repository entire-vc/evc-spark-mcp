FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci && npm run build && npm prune --omit=dev --ignore-scripts

FROM node:24-alpine AS runtime

ENV NODE_ENV=production \
    SPARK_API_URL=https://spark.entire.vc/api/v1 \
    SPARK_SITE_URL=https://spark.entire.vc

WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node LICENSE ./LICENSE

USER node
ENTRYPOINT ["node", "dist/index.js"]
