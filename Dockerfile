    # Use an official Node.js runtime as the parent image.
    # Node.js 20 on a lean Alpine Linux base.
    FROM node:20-alpine

    # Set the working directory inside the container.
    # All subsequent commands will be run from this directory.
    WORKDIR /app

    # Copy package.json and package-lock.json (or yarn.lock) to the working directory.
    # This step is done first to leverage Docker's layer caching.
    # If package.json doesn't change, these layers are reused, speeding up builds.
    COPY package*.json ./

    # Install Node.js dependencies.
    # `--omit=dev` ensures only production dependencies are installed, keeping the image small.
    RUN npm install --omit=dev

    # Copy the rest of the application code into the container.
    COPY . .

    # Expose the port your application listens on.
    # Cloud Run expects your app to listen on the port specified by the PORT environment variable.
    # By default, if process.env.PORT is not set, your app listens on 5000.
    # It's good practice to explicitly EXPOSE it.
    EXPOSE 5000

    # Define the command to run your application when the container starts.
    # This matches how you start your app locally.
    CMD [ "npm", "start" ]
    