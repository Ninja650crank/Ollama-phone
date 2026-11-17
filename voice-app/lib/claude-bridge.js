/**
 * Ollama HTTP API Bridge
 * HTTP client for the local Ollama API server with session management
 */

const axios = require('axios');

const OLLAMA_API_URL = process.env.OLLAMA_API_URL || process.env.CLAUDE_API_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1';

/**
 * Query Ollama via HTTP API with optional call session metadata
 * @param {string} prompt - The prompt/question to send to Ollama
 * @param {Object} options - Options including callId for session management
 * @param {string} options.callId - Call UUID for maintaining conversation context
 * @param {string} options.devicePrompt - Device-specific personality prompt
 * @param {number} options.timeout - Timeout in seconds (default: 60)
 * @returns {Promise<string>} Ollama's response
 */
async function query(prompt, options = {}) {
  const { callId, devicePrompt, timeout = 60 } = options;
  const timestamp = new Date().toISOString();

  try {
    console.log(`[${timestamp}] OLLAMA Sending query to ${OLLAMA_API_URL}...`);
    if (callId) {
      console.log(`[${timestamp}] OLLAMA Session: ${callId}`);
    }
    if (devicePrompt) {
      console.log(`[${timestamp}] OLLAMA Device prompt: ${devicePrompt.substring(0, 50)}...`);
    }

    const fullPrompt = devicePrompt
      ? `${devicePrompt}\n\n${prompt}`
      : prompt;

    const response = await axios.post(
      `${OLLAMA_API_URL}/api/chat`,
      {
        model: OLLAMA_MODEL,
        stream: false,
        messages: [
          { role: 'user', content: fullPrompt }
        ]
      },
      {
        timeout: timeout * 1000,
        headers: { 'Content-Type': 'application/json' }
      }
    );

    const content = response.data?.message?.content;
    if (!content) {
      throw new Error('Ollama API returned no message content');
    }

    console.log(`[${timestamp}] OLLAMA Response received (${response.data?.eval_duration || 0}ms)`);
    return content;

  } catch (error) {
    const code = error && error.code;
    if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
      console.warn(`[${timestamp}] OLLAMA API server unreachable (${code})`);
      return "I'm having trouble connecting to my model right now. The Ollama API server may be offline or unreachable. Please try again later.";
    }

    if (code === 'ETIMEDOUT' || code === 'ECONNABORTED') {
      console.error(`[${timestamp}] OLLAMA Timeout after ${timeout} seconds`);
      return "I'm sorry, that request took too long. This might mean the Ollama API server is slow or there's a network issue. Try asking something simpler, or check that the Ollama service is running.";
    }

    console.error(`[${timestamp}] OLLAMA Error:`, error.message);
    return "I encountered an unexpected error. Please check that the Ollama API server is running and reachable.";
  }
}

/**
 * End an Ollama session when a call ends
 * @param {string} callId - The call UUID to end the session for
 */
async function endSession(callId) {
  if (!callId) return;

  const timestamp = new Date().toISOString();

  try {
    // Ollama is stateless by default; this is kept for compatibility with the existing call flow.
    console.log(`[${timestamp}] OLLAMA Session cleanup: ${callId}`);
  } catch (error) {
    console.warn(`[${timestamp}] OLLAMA Session cleanup warning: ${error.message}`);
  }
}

/**
 * Check if Ollama API is available
 * @returns {Promise<boolean>} True if API is reachable
 */
async function isAvailable() {
  try {
    await axios.get(`${OLLAMA_API_URL}/api/tags`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  query,
  endSession,
  isAvailable
};
