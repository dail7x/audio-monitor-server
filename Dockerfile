FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Create directory for persistent recordings & remote files storage
RUN mkdir -p storage/recordings storage/remote_files

# Declare persistent storage volume
VOLUME ["/app/storage"]

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
