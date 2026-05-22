/**
 * src/services/api.js — Teaching Assistant API client
 * ─────────────────────────────────────────────────────
 * All requests go through the request() helper which:
 *   • Adds Content-Type header
 *   • Throws a readable error on non-2xx responses
 *   • Throws 'NETWORK_ERROR' when the server is unreachable
 *
 * BASE_URL for iOS Simulator  : http://localhost:8000/api
 * BASE_URL for a real device  : http://<YOUR_LAN_IP>:8000/api
 *   Find your IP with: ipconfig (Windows) or ifconfig (Mac/Linux)
 */

import { Platform } from 'react-native';

// Set EXPO_PUBLIC_API_URL in eas.json (or EAS dashboard) for production builds.
// Leave it unset during local development — it falls back to the LAN IP below.
const PROD_URL = process.env.EXPO_PUBLIC_API_URL;
const LAN_IP   = '192.168.31.86';

export const BASE_URL = PROD_URL
  ? PROD_URL
  : Platform.OS === 'web'
    ? 'http://localhost:8000/api'
    : `http://${LAN_IP}:8000/api`;

const HEALTH_URL = PROD_URL
  ? PROD_URL.replace(/\/api$/, '/health')
  : Platform.OS === 'web'
    ? 'http://localhost:8000/health'
    : `http://${LAN_IP}:8000/health`;

// ─── Core fetch wrapper ──────────────────────────────────────────────────────

async function request(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== null) opts.body = JSON.stringify(body);

  try {
    const res = await fetch(`${BASE_URL}${path}`, opts);

    if (res.status === 204) return null; // No Content

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.detail || `Server error ${res.status}`);
    }
    return data;
  } catch (err) {
    if (err.message === 'Network request failed' || err.name === 'TypeError') {
      const netErr = new Error('NETWORK_ERROR');
      netErr.isNetworkError = true;
      throw netErr;
    }
    throw err;
  }
}

// ─── Health ──────────────────────────────────────────────────────────────────

/**
 * Returns true if the backend is reachable, false otherwise.
 * Never throws.
 */
export async function checkHealth() {
  try {
    const res = await fetch(HEALTH_URL, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Upload pipeline ─────────────────────────────────────────────────────────

/**
 * Full 3-step upload pipeline.
 *
 * @param {object} file      - expo-document-picker asset { uri, name, mimeType }
 * @param {string} title     - lecture title entered by the user
 * @param {function} onProgress - callback(step: 1-4, message: string)
 * @returns {{ lecture_id: string, status: 'ready' }}
 */
export async function uploadLecture(file, title, onProgress) {
  // ── Step 1: Upload file ────────────────────────────────────────────────────
  onProgress(1, 'Uploading file…');

  const formData = new FormData();

  // On web the file.uri is a blob: URL — fetch it to get a real Blob.
  // On React Native, pass the { uri, name, type } object (RN's fetch handles it).
  if (Platform.OS === 'web') {
    const blob = await fetch(file.uri).then(r => r.blob());
    formData.append('file', blob, file.name);
  } else {
    formData.append('file', {
      uri:  file.uri,
      name: file.name,
      type: file.mimeType ?? 'application/octet-stream',
    });
  }
  formData.append('title', title);

  let uploadRes;
  try {
    const res = await fetch(`${BASE_URL}/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Upload failed');
    }
    uploadRes = await res.json();
  } catch (err) {
    if (err.message === 'Network request failed' || err.name === 'TypeError') {
      const netErr = new Error('NETWORK_ERROR');
      netErr.isNetworkError = true;
      throw netErr;
    }
    throw err;
  }

  // Backend returns file_id (= lecture_id); use it for subsequent steps.
  const file_id = uploadRes.file_id;

  // ── Step 2: Transcribe ─────────────────────────────────────────────────────
  onProgress(2, 'Transcribing audio… this may take a few minutes');
  await request('POST', '/upload/transcribe', { file_id, model_size: 'base' });

  // ── Step 3: Chunk + embed ──────────────────────────────────────────────────
  onProgress(3, 'Processing and creating embeddings…');
  await request('POST', '/upload/process', { lecture_id: file_id });

  onProgress(4, 'Lecture is ready!');
  return { lecture_id: file_id, status: 'ready' };
}

// ─── Lectures ────────────────────────────────────────────────────────────────

/** Returns list of lectures with session/message counts. */
export const getLectures = () => request('GET', '/history/lectures');

/** Returns single lecture detail. */
export const getLectureDetail = (lectureId) =>
  request('GET', `/history/lectures/${lectureId}`);

/** Returns { total_lectures, total_sessions, total_messages, ready_lectures }. */
export const getStats = () => request('GET', '/history/stats');

// ─── Chat sessions ────────────────────────────────────────────────────────────

/**
 * Creates a new chat session for a lecture.
 * @returns {{ session_id, lecture_id, title, created_at }}
 */
export const createSession = (lectureId, title = 'New Chat') =>
  request('POST', '/chat/session', { lecture_id: lectureId, title });

/**
 * Sends a question through the RAG pipeline.
 * @returns {{ answer, sources, session_id, message_id }}
 */
export const sendMessage = (sessionId, lectureId, question) =>
  request('POST', '/chat/message', {
    session_id: sessionId,
    lecture_id: lectureId,
    question,
  });

/** Returns { session_id, lecture_id, title, messages[] }. */
export const getSessionMessages = (sessionId) =>
  request('GET', `/chat/session/${sessionId}`);

/**
 * Returns all sessions for a lecture with message_count and last_message.
 */
export const getSessions = (lectureId) =>
  request('GET', `/chat/lectures/${lectureId}/sessions`);

/**
 * Generates a structured summary of the lecture transcript.
 * @returns {{ lecture_id, summary }}
 */
export const getLectureSummary = (lectureId) =>
  request('POST', `/chat/summary/${lectureId}`);

// ─── Delete operations ────────────────────────────────────────────────────────

/** Deletes a session and all its messages. Returns null (204). */
export const deleteSession = (sessionId) =>
  request('DELETE', `/history/sessions/${sessionId}`);

/** Deletes a lecture and all related data. Returns null (204). */
export const deleteLecture = (lectureId) =>
  request('DELETE', `/history/lectures/${lectureId}`);

// ─── Study tools ──────────────────────────────────────────────────────────────

/**
 * Generate flashcards from a lecture transcript.
 * @returns {{ lecture_id, cards: [{ front, back }] }}
 */
export const generateFlashcards = (lectureId) =>
  request('POST', `/study/flashcards/${lectureId}`);

/**
 * Generate a multiple-choice quiz from a lecture transcript.
 * @returns {{ lecture_id, questions: [{ question, options, correct, explanation }] }}
 */
export const generateQuiz = (lectureId) =>
  request('POST', `/study/quiz/${lectureId}`);

/**
 * Generate structured markdown study notes from a lecture transcript.
 * @returns {{ lecture_id, markdown: string }}
 */
export const generateNotes = (lectureId) =>
  request('POST', `/study/notes/${lectureId}`);
