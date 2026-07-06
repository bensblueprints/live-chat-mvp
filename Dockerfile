FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY scripts ./scripts
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY scripts ./scripts
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
COPY --from=build /app/dist ./dist
ENV PORT=5314
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 5314
CMD ["node", "server/index.js"]
