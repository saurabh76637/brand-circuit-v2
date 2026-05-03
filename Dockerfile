# Use official Node.js image
FROM node:20-slim

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Bundle app source
COPY . .

# Expose the port the app listens on
EXPOSE 3011

# Start the server
CMD [ "node", "server.js" ]
