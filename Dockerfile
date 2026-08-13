# Build stage: compile TypeScript to JavaScript.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime stage: production dependencies plus the compiled output.
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Migrations are read at start-up, so they must be present in the image.
COPY migrations ./migrations

EXPOSE 3000
USER node
CMD ["node", "dist/server.js"]
