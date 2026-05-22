<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:0f0c29,40:1a1040,70:2d1b69,100:4c1d95&height=220&section=header&text=Teaching%20Assistant&fontSize=68&fontColor=a78bfa&fontAlignY=40&desc=Transform%20Lectures%20into%20Interactive%20Study%20Materials&descAlignY=62&descColor=7dd3fc&animation=fadeIn" width="100%"/>
</p>

<p align="center">
  <a href="https://expo.dev/artifacts/eas/iL8AjkT5HTRhPm5QwuYN7r.apk">
    <img src="https://img.shields.io/badge/Download%20APK-%E2%AC%87%20Get%20It%20Now-3ddc84?style=for-the-badge&logo=android&logoColor=white" />
  </a>
  &nbsp;
  <img src="https://img.shields.io/badge/Platform-Android%20%7C%20iOS-34d399?style=for-the-badge&logo=expo&logoColor=white" />
  &nbsp;
  <img src="https://img.shields.io/badge/License-MIT-fbbf24?style=for-the-badge" />
</p>

<p align="center">
  <img src="https://readme-typing-svg.demolab.com?font=Orbitron&size=16&duration=2800&pause=900&color=A78BFA&center=true&vCenter=true&multiline=true&width=650&height=80&lines=Upload+your+lecture+%E2%80%94+AI+transcribes+it+instantly;Ask+questions+grounded+in+your+actual+notes;Generate+flashcards+%26+quizzes+in+one+tap" alt="Typing SVG" />
</p>

---

## What is Teaching Assistant?

**Teaching Assistant** is an AI-powered mobile app that transforms raw lecture recordings into a complete, interactive study toolkit. Upload any audio or video file, and the app transcribes it locally, indexes it for semantic search, and lets you chat with your lecture content, drill yourself with flashcards, test your knowledge with quizzes, and export polished study notes — all without leaving the app.

---

## Features

| Feature | Description |
|---|---|
| **Lecture Upload** | Import audio or video directly from your device |
| **Local Transcription** | On-device Whisper model — no audio leaves your phone |
| **AI Chat (RAG)** | Ask questions; answers are grounded in the actual transcript |
| **Flashcard Generator** | AI-authored flip cards with smooth spring animations |
| **Quiz Mode** | 5-question multiple-choice tests with instant scoring |
| **Study Notes Export** | One-tap export of structured markdown summaries |
| **Session History** | Browse and revisit all previous lecture sessions |
| **Dark / Light Mode** | Full theme support with animated tab indicators |
| **Notifications** | In-app notification centre with unread badge count |

---

## Download

<p align="left">
  <a href="https://expo.dev/artifacts/eas/iL8AjkT5HTRhPm5QwuYN7r.apk">
    <img src="https://img.shields.io/badge/Android%20APK-Direct%20Download-3ddc84?style=for-the-badge&logo=android&logoColor=white" />
  </a>
</p>

**[⬇ Download APK](https://expo.dev/artifacts/eas/iL8AjkT5HTRhPm5QwuYN7r.apk)** — built with EAS, ready to sideload.

**Install on Android**
1. Transfer or open the `.apk` link on your device
2. Go to **Settings → Security → Install unknown apps** and allow your browser/file manager
3. Tap the APK to install

To build your own APK from source:
```bash
npm install -g eas-cli
eas login
eas build --platform android --profile preview
```

---

## Tech Stack

<p align="left">
  <img src="https://img.shields.io/badge/React_Native-20232A?style=flat-square&logo=react&logoColor=61DAFB" />
  <img src="https://img.shields.io/badge/Expo_v54-000020?style=flat-square&logo=expo&logoColor=white" />
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white" />
  <img src="https://img.shields.io/badge/Python_3.10+-3776AB?style=flat-square&logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/OpenAI-412991?style=flat-square&logo=openai&logoColor=white" />
  <img src="https://img.shields.io/badge/ChromaDB-F97316?style=flat-square&logo=databricks&logoColor=white" />
  <img src="https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white" />
</p>

| Layer | Technology |
|---|---|
| **Mobile Frontend** | React Native · Expo ~54 · TypeScript |
| **Navigation** | React Navigation (native stack + bottom tabs) |
| **Backend API** | FastAPI · Uvicorn · Python 3.10+ |
| **Transcription** | OpenAI Whisper (local, base model) |
| **Embeddings** | Sentence-Transformers (local) |
| **Vector Store** | ChromaDB (persistent) |
| **Language Model** | GPT-4o-mini via OpenAI API |
| **RAG Pipeline** | LangChain |
| **Database** | SQLite · SQLAlchemy · aiosqlite |
| **Build / Deploy** | EAS Build · Expo Go |

---

## Project Structure

```
TeachingAssistant/
├── App.tsx                     # Root component — providers + navigation
├── app.json                    # Expo app config
├── eas.json                    # EAS build profiles (preview APK / prod AAB)
├── src/
│   ├── context/
│   │   ├── ThemeContext.tsx     # Dark / light theme state
│   │   └── NotificationContext.tsx
│   ├── navigation/
│   │   ├── RootNavigator.tsx   # Stack: Tabs, Flashcards, Quiz
│   │   └── TabNavigator.tsx    # Bottom tabs: Home, Upload, Chat, History
│   ├── screens/
│   │   ├── HomeScreen.tsx      # Dashboard — lecture list, stats, notifications
│   │   ├── UploadScreen.tsx    # File picker + upload progress
│   │   ├── ChatScreen.tsx      # RAG-powered Q&A chat
│   │   ├── FlashcardScreen.tsx # Animated flip-card study mode
│   │   ├── QuizScreen.tsx      # Multiple-choice quiz with scoring
│   │   └── HistoryScreen.tsx   # Past sessions browser
│   ├── services/               # API client functions
│   └── theme/                  # Colour tokens and style helpers
├── backend/
│   ├── main.py                 # FastAPI app, CORS, router registration
│   ├── requirements.txt
│   ├── .env.example
│   ├── database/               # SQLAlchemy models and session setup
│   ├── models/                 # Pydantic request / response schemas
│   ├── routes/
│   │   ├── upload.py           # POST /api/upload
│   │   ├── chat.py             # POST /api/chat
│   │   ├── history.py          # GET  /api/history
│   │   └── study.py            # GET  /api/study (flashcards, quiz, notes)
│   └── services/               # Whisper transcription, RAG, DB helpers
└── assets/                     # Icons and splash images
```

---

## Getting Started

### Prerequisites

| Tool | Version |
|---|---|
| Node.js | 18 + |
| Python | 3.10 + |
| Expo CLI | Latest (`npm i -g expo-cli`) |
| OpenAI API key | [platform.openai.com](https://platform.openai.com) |

---

### 1 · Backend

```bash
cd backend

# Create and activate a virtual environment
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY
```

**`.env` reference**

```env
OPENAI_API_KEY=sk-...           # Required for RAG answers
DB_PATH=./teaching_assistant.db
CHROMA_DB_PATH=./chroma_store
WHISPER_MODEL_SIZE=base         # tiny | base | small | medium | large
UPLOAD_DIR=./uploads
FRONTEND_URL=http://localhost:19006
```

```bash
# Start the API server (hot-reload enabled)
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

API will be live at `http://localhost:8000` — health check: `GET /health`.

---

### 2 · Mobile App

```bash
# From the repo root
npm install

# Point the app at your machine's IP (e.g. 192.168.1.x:8000)
# Edit src/services/api.ts BASE_URL accordingly

# Start Expo dev server
npx expo start
```

Scan the QR code in **Expo Go** (iOS/Android) or press `a` to launch an Android emulator.

---

### 3 · Build an APK

```bash
# Install EAS CLI
npm install -g eas-cli

# Log in to your Expo account
eas login

# Build a preview APK (sideloadable)
eas build --platform android --profile preview
```

The finished `.apk` is downloadable from your [Expo dashboard](https://expo.dev).

---

## API Endpoints

| Method | Route | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/api/upload` | Upload lecture audio / video |
| `POST` | `/api/chat` | RAG-powered Q&A on a session |
| `GET` | `/api/history` | List all lecture sessions |
| `GET` | `/api/study/flashcards` | Generate flashcards for a session |
| `GET` | `/api/study/quiz` | Generate a 5-question quiz |
| `GET` | `/api/study/notes` | Export study notes as markdown |

---

## How It Works

```
┌─────────────────────────────────────────────────────┐
│                   Mobile App (Expo)                  │
│  Upload ──► Chat ──► Flashcards ──► Quiz ──► Notes  │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP (local network)
┌──────────────────────▼──────────────────────────────┐
│                 FastAPI Backend                      │
│                                                      │
│  Audio/Video ──► Whisper ──► Transcript              │
│  Transcript  ──► Sentence-Transformers ──► Vectors   │
│  Vectors     ──► ChromaDB (stored)                   │
│  Query       ──► ChromaDB (retrieved) ──► GPT-4o-mini│
│  Response    ──► Mobile App                          │
└──────────────────────────────────────────────────────┘
```

1. **Upload** — the backend receives the media file and runs the local Whisper model to produce a transcript.
2. **Index** — the transcript is chunked, converted to vectors by Sentence-Transformers, and stored in ChromaDB.
3. **Chat** — user questions are embedded, the closest transcript chunks are retrieved, and GPT-4o-mini generates a grounded answer.
4. **Study tools** — the same pipeline powers flashcard, quiz, and summary generation.

---

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit your changes: `git commit -m "feat: add your feature"`
4. Push and open a Pull Request

Please keep files under 500 lines and validate all input at system boundaries.

---

## License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for details.

---

<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:4c1d95,50:2d1b69,100:0f0c29&height=130&section=footer&text=Made%20with%20%E2%9C%A8%20by%20Garison&fontSize=22&fontColor=a78bfa&fontAlignY=65&animation=fadeIn" width="100%" />
</p>
