/**
 * Local Whisper / faster-whisper speech-to-text client
 * Converts audio buffers (L16 PCM from FreeSWITCH) to text using a local Python model
 * when available, with OpenAI Whisper as an optional fallback.
 */

const { spawnSync } = require('node:child_process');
const OpenAI = require('openai');
const WaveFile = require('wavefile').WaveFile;
const fs = require('fs');
const path = require('path');

let openai = null;

function getOpenAIClient() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      return null;
    }
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

function runPythonCommand(script, args = []) {
  const pythonCommands = ['python3', 'python'];

  for (const cmd of pythonCommands) {
    const result = spawnSync(cmd, ['-c', script, ...args], {
      encoding: 'utf8'
    });

    if (result.error) {
      continue;
    }

    if (result.status === 0) {
      return {
        stdout: (result.stdout || '').trim(),
        stderr: (result.stderr || '').trim(),
        status: 0
      };
    }

    if (result.stderr && /No module named|ModuleNotFoundError/.test(result.stderr)) {
      continue;
    }

    return {
      stdout: (result.stdout || '').trim(),
      stderr: (result.stderr || '').trim(),
      status: result.status
    };
  }

  return null;
}

function isLocalWhisperAvailable() {
  const script = `
import importlib.util
import sys
has_faster = importlib.util.find_spec('faster_whisper') is not None
has_whisper = importlib.util.find_spec('whisper') is not None
sys.exit(0 if (has_faster or has_whisper) else 1)
`;

  const result = runPythonCommand(script, []);
  return !!result && result.status === 0;
}

function transcribeLocally(audioPath, language = 'en') {
  const modelSize = process.env.LOCAL_WHISPER_MODEL || 'base';
  const script = `
import sys

try:
    from faster_whisper import WhisperModel
    model = WhisperModel(sys.argv[1], device='cpu', compute_type='int8')
    segments, _ = model.transcribe(sys.argv[2], language=sys.argv[3], beam_size=1, vad_filter=True)
    text = ' '.join(segment.text for segment in segments).strip()
    print(text)
except Exception as faster_error:
    try:
        import whisper
        model = whisper.load_model(sys.argv[1])
        result = model.transcribe(sys.argv[2], language=sys.argv[3], fp16=False)
        print(result.get('text', '').strip())
    except Exception as whisper_error:
        print(f'LOCAL_WHISPER_ERROR: faster={type(faster_error).__name__}: {faster_error}; whisper={type(whisper_error).__name__}: {whisper_error}', file=sys.stderr)
        sys.exit(1)
`;

  const result = runPythonCommand(script, [modelSize, audioPath, language]);
  if (!result) {
    return null;
  }

  if (result.status !== 0) {
    const details = result.stderr || 'Local Whisper model unavailable';
    throw new Error(details);
  }

  return result.stdout || '';
}

/**
 * Convert L16 PCM buffer to WAV format for local transcription or Whisper API
 * @param {Buffer} pcmBuffer - Raw L16 PCM audio data
 * @param {number} sampleRate - Sample rate (default: 8000 Hz for telephony)
 * @returns {Buffer} WAV file buffer
 */
function pcmToWav(pcmBuffer, sampleRate = 8000) {
  const wav = new WaveFile();
  const samples = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 2);
  wav.fromScratch(1, sampleRate, '16', samples);
  return Buffer.from(wav.toBuffer());
}

/**
 * Transcribe audio using a local Whisper model when available.
 * Falls back to the OpenAI API if local is unavailable and OPENAI_API_KEY is set.
 * @param {Buffer} audioBuffer - Audio data (either WAV or raw PCM)
 * @param {Object} options - Transcription options
 * @param {string} options.format - Input format: 'wav' or 'pcm' (default: 'pcm')
 * @param {number} options.sampleRate - Sample rate for PCM (default: 8000)
 * @param {string} options.language - Language code (default: 'en')
 * @returns {Promise<string>} Transcribed text
 */
async function transcribe(audioBuffer, options = {}) {
  const {
    format = 'pcm',
    sampleRate = 8000,
    language = 'en'
  } = options;

  let wavBuffer;
  if (format === 'pcm') {
    wavBuffer = pcmToWav(audioBuffer, sampleRate);
  } else {
    wavBuffer = audioBuffer;
  }

  const tempFile = path.join('/tmp', 'speech-' + Date.now() + '.wav');
  fs.writeFileSync(tempFile, wavBuffer);

  let transcription = '';

  try {
    if (isLocalWhisperAvailable()) {
      transcription = transcribeLocally(tempFile, language);
    } else if (process.env.OPENAI_API_KEY) {
      const client = getOpenAIClient();
      if (client) {
        transcription = await client.audio.transcriptions.create({
          file: fs.createReadStream(tempFile),
          model: 'whisper-1',
          language,
          response_format: 'text'
        });
      }
    }

    if (!transcription) {
      throw new Error('No local Whisper model is installed and no OpenAI API key is configured. Install faster-whisper or openai-whisper, or set OPENAI_API_KEY.');
    }

    const timestamp = new Date().toISOString();
    console.log('[' + timestamp + '] STT Transcribed: ' + transcription.substring(0, 100) + (transcription.length > 100 ? '...' : ''));
    return transcription;
  } finally {
    try {
      fs.unlinkSync(tempFile);
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Check if any STT backend is configured and available
 * @returns {boolean} True if local model or OpenAI fallback is available
 */
function isAvailable() {
  return isLocalWhisperAvailable() || !!process.env.OPENAI_API_KEY;
}

module.exports = {
  transcribe,
  pcmToWav,
  isAvailable,
  isLocalWhisperAvailable
};
