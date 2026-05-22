# Teaching Assistant — AI Lecture Companion

An AI-powered mobile app that turns your lecture recordings into an interactive study tool. Upload audio or video, get it transcribed, then chat with an AI about the content, generate flashcards, take quizzes, and export structured study notes.

---

## Download APK

[![Download APK](https://img.shields.io/badge/Download-APK%20v1.0.0-7C3AED?style=for-the-badge&logo=android)](https://expo.dev/artifacts/eas/iL8AjkT5HTRhPm5QwuYN7r.apk)

> **Android only.** Tap the badge above or [click here](https://expo.dev/artifacts/eas/iL8AjkT5HTRhPm5QwuYN7r.apk) to download. Enable "Install from unknown sources" in your Android settings before installing.

---

## Screenshots

| Home | Chat | Flashcards | Quiz |
|------|------|------------|------|
| ![Home](assets/screenshots/home.png) | ![Chat](assets/screenshots/chat.png) | ![Flashcards](assets/screenshots/flashcards.png) | ![Quiz](assets/screenshots/quiz.png) |

> Add your own screenshots to `assets/screenshots/` and they will appear here.

---

## Features

- **Upload** — Import lecture audio or video files directly from your device
- **AI Transcription** — Powered by OpenAI Whisper running locally
- **RAG Chat** — Ask questions about your lecture; answers are grounded in the actual transcript
- **Flashcards** — AI-generated Q&A cards with flip animation and dot pagination
- **Quiz** — 5-question multiple-choice quiz with live score tracking and shake feedback
- **Study Notes** — Export a structured markdown summary (key concepts, definitions, takeaways) — copy or download as `.txt`
- **History** — Browse all past sessions per lecture
- **Dark / Light mode** — Toggle from the home screen hero card
- **Notifications** — In-app toast + bell panel for flashcard/quiz ready events

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React Native (Expo ~54) + TypeScript |
| Backend | FastAPI (Python) |
| Transcription | OpenAI Whisper (local, `base` model) |
| Embeddings | `all-MiniLM-L6-v2` via sentence-transformers (384-dim) |
| Vector DB | ChromaDB |
| LLM | OpenAI `gpt-4o-mini` |
| Database | SQLite + SQLAlchemy (async) |

---

## Architecture

```
Mobile App (Expo)
      │
      ▼
FastAPI Backend (:8000)
      ├── /upload   — file ingestion, Whisper transcription, chunking + embedding
      ├── /chat     — RAG pipeline (ChromaDB retrieval → GPT-4o-mini)
      ├── /study    — flashcards, quiz, notes generation
      └── /history  — lectures, sessions, messages CRUD
```

---

## Running Locally

### Prerequisites
- Node.js 18+
- Python 3.10+
- An OpenAI API key

### Backend

```bash
cd backend
python -m venv venv
# Windows:
.\venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

pip install -r requirements.txt

# Create .env from example
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend (web)

```bash
# In the project root
npm install
npx expo start --web
```

Open `http://localhost:8081` in your browser.

### Frontend (Android device / emulator)

```bash
npx expo start
# Press 'a' for Android, or scan the QR code with Expo Go
```

> **Real device:** edit `src/services/api.js` and set `LAN_IP` to your machine's local IP address (`ipconfig` on Windows).

---

## Building the APK

This project uses [EAS Build](https://docs.expo.dev/build/introduction/) for cloud APK generation.

```bash
npm install -g eas-cli
eas login
eas build -p android --profile preview
```

The build runs in Expo's cloud (~10–15 min) and produces a downloadable `.apk`.

---

## Project Structure

```
TeachingAssistantExpo/
├── App.tsx                        # Root: SafeAreaProvider → Theme → Notifications → Nav
├── app.json                       # Expo config (package name, icons, splash)
├── eas.json                       # EAS Build profiles
├── src/
│   ├── context/
│   │   ├── ThemeContext.tsx        # Light/dark theme, useTheme() hook
│   │   └── NotificationContext.tsx # Toast overlay + bell panel
│   ├── navigation/
│   │   ├── RootNavigator.tsx
│   │   └── TabNavigator.tsx        # Dark bottom tab bar
│   ├── screens/
│   │   ├── HomeScreen.tsx          # Gradient hero, lecture list, stats
│   │   ├── UploadScreen.tsx        # File picker + pipeline progress steps
│   │   ├── ChatScreen.tsx          # RAG chat + notes export modal
│   │   ├── FlashcardScreen.tsx     # Flip cards with dot pagination
│   │   ├── QuizScreen.tsx          # MCQ quiz with live score strip
│   │   └── HistoryScreen.tsx       # Session history
│   ├── services/
│   │   └── api.js                  # All API calls, BASE_URL config
│   └── theme/
│       └── index.ts                # lightColors / darkColors
└── backend/
    ├── main.py                     # FastAPI app, CORS, router mounting
    ├── requirements.txt
    ├── .env.example
    ├── database/db.py              # SQLAlchemy models + async session
    ├── routes/
    │   ├── upload.py               # Whisper transcription pipeline
    │   ├── chat.py                 # RAG chat + summary
    │   ├── study.py                # Flashcards, quiz, notes endpoints
    │   └── history.py              # Lecture/session CRUD
    └── services/
        ├── rag_service.py          # ChromaDB retrieval + OpenAI chat
        ├── whisper_service.py      # Local Whisper transcription
        ├── embedding_service.py    # sentence-transformers embeddings
        └── chunking_service.py     # Text chunking for RAG
```

---

## License

MIT
