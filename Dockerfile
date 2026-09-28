FROM node:20-bookworm-slim

# Install Python and build dependencies for ChromaDB
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set up Python virtual environment for ChromaDB
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install ChromaDB in the virtual environment
RUN pip install --no-cache-dir chromadb

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application code and assets
COPY . .

# Make startup script executable
RUN chmod +x ./start.sh

# Render sets PORT dynamically (default 10000)
ENV PORT=10000
ENV CHROMA_URL=http://127.0.0.1:8000
EXPOSE 10000

CMD ["./start.sh"]
