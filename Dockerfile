# Build stage
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# Run stage
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    DATABASE_PATH=/data/ittracks.db \
    PORT=3000
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/drizzle ./drizzle
COPY package.json ./
VOLUME /data
EXPOSE 3000
CMD ["node", "build"]
