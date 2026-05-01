FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Data lives on a mounted volume so it survives restarts/redeploys
ENV DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 3000

CMD ["node", "server.js"]
