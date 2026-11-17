FROM node:20-slim

WORKDIR /app

# Install Python and a virtual environment for local faster-whisper speech-to-text.
# The Python venv avoids conflicts with Debian's externally-managed system Python.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/whisper-venv
ENV PATH="/opt/whisper-venv/bin:${PATH}"
RUN pip install --no-cache-dir faster-whisper

# Install Node dependencies first (better caching)
COPY package*.json ./
RUN npm install --production

# Copy application code
COPY . .

# Create audio directory
RUN mkdir -p /app/audio

# HTTP API port
EXPOSE 3000
# WebSocket for audio streaming
EXPOSE 3001

CMD ["node", "index.js"]
