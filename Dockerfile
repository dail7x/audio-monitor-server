FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Create directory for persistent recordings storage
RUN mkdir -p storage/recordings

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
