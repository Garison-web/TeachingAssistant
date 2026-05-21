import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { cardShadow, radius, spacing } from '../theme';
import { useTheme } from '../context/ThemeContext';
import { BASE_URL, createSession, generateNotes, getLectureSummary, sendMessage } from '../services/api';

type Source = {
  chunk_id        : string | null;
  start_time      : number | null;
  end_time        : number | null;
  text            : string;
  similarity_score: number | null;
};

type Message = {
  id       : string;
  role     : 'user' | 'assistant';
  text     : string;
  timestamp: string;
  sources  : Source[];
  isTyping ?: boolean;
};

let _msgCounter = 0;
const genId = () => `msg_${++_msgCounter}_${Date.now()}`;

function fmtTime(seconds: number | null): string {
  if (seconds === null) return '?';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function nowTime(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const SUGGESTED_QUESTIONS = [
  'Summarise key concepts',
  'What are the main topics?',
  'Explain the most important point',
  'What should I remember from this?',
];

function TypingIndicator({ colors }: { colors: any }) {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  useEffect(() => {
    const anims = dots.map((dot, i) =>
      Animated.loop(Animated.sequence([
        Animated.delay(i * 160),
        Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(dot, { toValue: 0.3, duration: 300, useNativeDriver: true }),
        Animated.delay(320),
      ]))
    );
    const all = Animated.parallel(anims);
    all.start();
    return () => all.stop();
  }, []);
  return (
    <View style={styles.messageWrapper}>
      <View style={[styles.aiAvatar, { backgroundColor: colors.accent }]}><Text style={styles.aiAvatarText}>AI</Text></View>
      <View style={[styles.bubble, styles.bubbleAI, { backgroundColor: colors.card, paddingVertical: spacing.md }]}>
        <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
          {dots.map((dot, i) => (
            <Animated.View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textSecondary, opacity: dot, transform: [{ scale: dot.interpolate({ inputRange: [0.3, 1], outputRange: [0.8, 1.2] }) }] }} />
          ))}
        </View>
      </View>
    </View>
  );
}

function SourceModal({ sources, visible, onClose, colors }: { sources: Source[]; visible: boolean; onClose: () => void; colors: any }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.modalBackdrop} />
      </TouchableWithoutFeedback>
      <View style={[styles.modalSheet, { backgroundColor: colors.card }]}>
        <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />
        <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: spacing.md }}>Source Excerpts</Text>
        <ScrollView showsVerticalScrollIndicator={false}>
          {sources.map((src, i) => (
            <View key={i} style={[styles.modalSourceCard, { backgroundColor: colors.cardAlt }]}>
              <View style={styles.modalSourceHeader}>
                <Ionicons name="time-outline" size={13} color={colors.accent} />
                <Text style={[styles.modalSourceTime, { color: colors.accent }]}>
                  {fmtTime(src.start_time)} – {fmtTime(src.end_time)}
                </Text>
                {src.similarity_score !== null && (
                  <View style={[styles.scoreChip, { backgroundColor: colors.accentLight }]}>
                    <Text style={[styles.scoreText, { color: colors.accent }]}>{Math.round(src.similarity_score * 100)}% match</Text>
                  </View>
                )}
              </View>
              <Text style={{ fontSize: 14, lineHeight: 21, marginTop: spacing.xs, color: colors.text }}>{src.text}</Text>
            </View>
          ))}
        </ScrollView>
        <TouchableOpacity style={[styles.modalClose, { backgroundColor: colors.accent }]} onPress={onClose}>
          <Text style={styles.modalCloseText}>Close</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

function parseInline(text: string, isUser: boolean, colors: any): React.ReactNode[] {
  const parts = text.split(/\*\*/);
  return parts.map((part, i) =>
    i % 2 === 1 ? <Text key={i} style={{ fontWeight: '700' }}>{part}</Text> : part
  );
}

function MarkdownText({ text, isUser, colors }: { text: string; isUser: boolean; colors: any }) {
  const textColor = isUser ? '#fff' : colors.text;
  const accentDot = isUser ? 'rgba(255,255,255,0.85)' : colors.accent;
  const blocks: { type: string; text: string; depth: number }[] = [];
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) { blocks.push({ type: 'spacer', text: '', depth: 0 }); continue; }
    if (trimmed.startsWith('### ')) { blocks.push({ type: 'h3', text: trimmed.slice(4), depth: 0 }); continue; }
    if (trimmed.startsWith('## '))  { blocks.push({ type: 'h2', text: trimmed.slice(3), depth: 0 }); continue; }
    if (trimmed.startsWith('# '))   { blocks.push({ type: 'h1', text: trimmed.slice(2), depth: 0 }); continue; }
    const bulletMatch = raw.match(/^(\s*)[\*\-] (.*)/);
    if (bulletMatch) { blocks.push({ type: 'bullet', text: bulletMatch[2], depth: Math.floor(bulletMatch[1].length / 2) }); continue; }
    blocks.push({ type: 'p', text: trimmed, depth: 0 });
  }
  return (
    <View>
      {blocks.map((block, i) => {
        if (block.type === 'spacer') return <View key={i} style={{ height: 4 }} />;
        if (block.type === 'h1' || block.type === 'h2') return (
          <Text key={i} style={{ fontSize: 16, fontWeight: '800', color: textColor, marginTop: i > 0 ? 10 : 0, marginBottom: 2, lineHeight: 23 }}>
            {parseInline(block.text, isUser, colors)}
          </Text>
        );
        if (block.type === 'h3') return (
          <Text key={i} style={{ fontSize: 15, fontWeight: '700', color: textColor, marginTop: i > 0 ? 8 : 0, marginBottom: 2, lineHeight: 22 }}>
            {parseInline(block.text, isUser, colors)}
          </Text>
        );
        if (block.type === 'bullet') return (
          <View key={i} style={{ flexDirection: 'row', marginTop: 3, paddingLeft: block.depth * 14 }}>
            <Text style={{ color: accentDot, fontWeight: '700', fontSize: 15, marginRight: 7, marginTop: 1 }}>•</Text>
            <Text style={{ flex: 1, fontSize: 15, lineHeight: 22, color: textColor }}>{parseInline(block.text, isUser, colors)}</Text>
          </View>
        );
        return <Text key={i} style={{ fontSize: 15, lineHeight: 22, color: textColor, marginTop: i > 0 ? 2 : 0 }}>{parseInline(block.text, isUser, colors)}</Text>;
      })}
    </View>
  );
}

function MessageBubble({ message, colors, onSourcePress }: { message: Message; colors: any; onSourcePress: (sources: Source[]) => void }) {
  const isUser     = message.role === 'user';
  const opacity    = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(isUser ? 28 : -28)).current;
  const scale      = useRef(new Animated.Value(0.88)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity,    { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.spring(translateX, { toValue: 0, tension: 100, friction: 12, useNativeDriver: true }),
      Animated.spring(scale,      { toValue: 1, tension: 120, friction: 10, useNativeDriver: true }),
    ]).start();
  }, []);

  if (message.isTyping) return <TypingIndicator colors={colors} />;

  return (
    <Animated.View style={[styles.messageWrapper, isUser && styles.messageWrapperUser, { opacity, transform: [{ translateX }, { scale }] }]}>
      {!isUser && (
        <View style={[styles.aiAvatar, { backgroundColor: colors.accent }]}><Text style={styles.aiAvatarText}>AI</Text></View>
      )}
      <View style={[styles.bubble, isUser ? [styles.bubbleUser, { backgroundColor: colors.accent }] : [styles.bubbleAI, { backgroundColor: colors.card }]]}>
        <MarkdownText text={message.text} isUser={isUser} colors={colors} />
        {!isUser && message.sources.length > 0 && !message.text.toLowerCase().includes("couldn't find") && (
          <View style={[styles.sourcesContainer, { borderTopColor: colors.border }]}>
            <Text style={[styles.sourcesLabel, { color: colors.textSecondary }]}>SOURCES</Text>
            <TouchableOpacity style={[styles.sourceChip, { backgroundColor: colors.accentLight }]} onPress={() => onSourcePress(message.sources)}>
              <Ionicons name="location" size={11} color={colors.accent} style={{ marginRight: 4 }} />
              <Text style={[styles.sourceChipText, { color: colors.accent }]}>
                {message.sources.length} excerpt{message.sources.length !== 1 ? 's' : ''} · {fmtTime(Math.min(...message.sources.map(s => s.start_time ?? 0)))} – {fmtTime(Math.max(...message.sources.map(s => s.end_time ?? 0)))}
              </Text>
            </TouchableOpacity>
          </View>
        )}
        <Text style={[styles.timestamp, isUser && styles.timestampUser, { color: isUser ? 'rgba(255,255,255,0.65)' : colors.textSecondary }]}>
          {message.timestamp}
        </Text>
      </View>
    </Animated.View>
  );
}

// ─── Notes modal ──────────────────────────────────────────────────────────────

function NotesModal({ visible, onClose, markdown, title, colors, isDark }: {
  visible  : boolean;
  onClose  : () => void;
  markdown : string;
  title    : string;
  colors   : any;
  isDark   : boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (Platform.OS === 'web') {
      await (navigator as any).clipboard.writeText(markdown);
    } else {
      await Share.share({ message: markdown, title: `${title} — Notes` });
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (Platform.OS === 'web') {
      const safe = title.replace(/[^a-z0-9]/gi, '-').toLowerCase();
      const a = document.createElement('a');
      a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(markdown);
      a.download = `${safe}-notes.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      Share.share({ message: markdown, title: `${title} — Notes` });
    }
  };

  const renderMarkdown = (md: string) => {
    const lines = md.split('\n');
    return lines.map((line, i) => {
      const trimmed = line.trim();
      if (!trimmed) return <View key={i} style={{ height: 6 }} />;

      if (trimmed.startsWith('# ')) {
        return (
          <Text key={i} style={{ fontSize: 20, fontWeight: '800', color: colors.text, marginBottom: 8, marginTop: 4, letterSpacing: -0.4 }}>
            {trimmed.slice(2)}
          </Text>
        );
      }
      if (trimmed.startsWith('## ')) {
        return (
          <View key={i} style={{ marginTop: 18, marginBottom: 6 }}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: colors.accent, textTransform: 'uppercase', letterSpacing: 0.6 }}>
              {trimmed.slice(3)}
            </Text>
            <View style={{ height: 2, backgroundColor: colors.accent, borderRadius: 1, marginTop: 4, width: 32 }} />
          </View>
        );
      }
      if (trimmed.startsWith('### ')) {
        return (
          <Text key={i} style={{ fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 10, marginBottom: 3 }}>
            {trimmed.slice(4)}
          </Text>
        );
      }
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const content = trimmed.slice(2);
        return (
          <View key={i} style={{ flexDirection: 'row', marginTop: 3, paddingLeft: 4 }}>
            <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 14, marginRight: 8, marginTop: 1 }}>•</Text>
            <Text style={{ flex: 1, fontSize: 14, lineHeight: 21, color: colors.text }}>{renderBold(content, colors)}</Text>
          </View>
        );
      }
      return (
        <Text key={i} style={{ fontSize: 14, lineHeight: 22, color: colors.textSecondary, marginTop: 2 }}>
          {renderBold(trimmed, colors)}
        </Text>
      );
    });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {/* Header */}
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14,
          borderBottomWidth: 1, borderBottomColor: colors.border,
          backgroundColor: colors.card, gap: 10,
        }}>
          <TouchableOpacity
            onPress={onClose}
            style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="close" size={20} color={colors.text} />
          </TouchableOpacity>

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: '600', letterSpacing: 0.4 }}>STUDY NOTES</Text>
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }} numberOfLines={1}>{title}</Text>
          </View>

          <TouchableOpacity
            onPress={handleCopy}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 5,
              backgroundColor: copied ? '#D1FAE5' : colors.cardAlt,
              borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
            }}
          >
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={15} color={copied ? '#10B981' : colors.textSecondary} />
            <Text style={{ fontSize: 12, fontWeight: '700', color: copied ? '#10B981' : colors.textSecondary }}>
              {copied ? 'Copied!' : 'Copy'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleDownload}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 5,
              backgroundColor: colors.accent, borderRadius: 12,
              paddingHorizontal: 12, paddingVertical: 8,
            }}
          >
            <Ionicons name={Platform.OS === 'web' ? 'download-outline' : 'share-outline'} size={15} color="#fff" />
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>
              {Platform.OS === 'web' ? 'Download' : 'Share'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Notes content */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
          showsVerticalScrollIndicator={false}
        >
          {markdown ? renderMarkdown(markdown) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function renderBold(text: string, colors: any): React.ReactNode {
  const parts = text.split(/\*\*([^*]+)\*\*/);
  return parts.map((part, i) =>
    i % 2 === 1
      ? <Text key={i} style={{ fontWeight: '700', color: colors.text }}>{part}</Text>
      : part
  );
}

export default function ChatScreen() {
  const navigation = useNavigation<any>();
  const route      = useRoute<any>();
  const { colors, isDark, toggle } = useTheme();

  const { lectureId, title: lectureTitle, sessionId: existingSessionId } = (route.params ?? {}) as {
    lectureId?: string; title?: string; sessionId?: string;
  };

  const flatListRef = useRef<FlatList>(null);
  const sendBounce  = useRef(new Animated.Value(1)).current;

  const [messages,     setMessages]     = useState<Message[]>([]);
  const [inputText,    setInputText]    = useState('');
  const [sessionId,    setSessionId]    = useState<string | null>(existingSessionId ?? null);
  const [initLoading,  setInitLoading]  = useState(false);
  const [sending,      setSending]      = useState(false);
  const [sourceModal,  setSourceModal]  = useState<{ visible: boolean; sources: Source[] }>({ visible: false, sources: [] });
  const [error,        setError]        = useState<string | null>(null);
  const [notesModal,   setNotesModal]   = useState<{ visible: boolean; markdown: string }>({ visible: false, markdown: '' });
  const [notesLoading, setNotesLoading] = useState(false);

  const init = useCallback(async () => {
    if (!lectureId) return;
    setMessages([]); setError(null); setInitLoading(true);
    try {
      const lectureRes = await fetch(`${BASE_URL}/upload/lectures/${lectureId}`);
      if (lectureRes.ok) {
        const lectureData = await lectureRes.json();
        if (lectureData.status !== 'ready') {
          setError(`This lecture is not ready yet (status: ${lectureData.status}). Select a lecture with a green "Ready" badge.`);
          setInitLoading(false);
          return;
        }
      }
      let sid = existingSessionId ?? null;
      if (!sid) {
        const sess = await createSession(lectureId, lectureTitle ?? 'New Chat');
        sid = sess.session_id;
        setSessionId(sid);
        try {
          const summaryRes = await getLectureSummary(lectureId);
          setMessages([{ id: genId(), role: 'assistant', text: `Here's a summary of this lecture:\n\n${summaryRes.summary}`, timestamp: nowTime(), sources: [] }]);
        } catch {
          setMessages([{ id: genId(), role: 'assistant', text: `Hi! I've loaded "${lectureTitle ?? 'your lecture'}". Ask me anything about the material.`, timestamp: nowTime(), sources: [] }]);
        }
      } else {
        setSessionId(sid);
        setMessages([{ id: genId(), role: 'assistant', text: `Continuing session for "${lectureTitle ?? 'your lecture'}". Ask me anything.`, timestamp: nowTime(), sources: [] }]);
      }
    } catch (err: any) {
      setError(err.isNetworkError ? 'Cannot connect to server. Make sure the backend is running on port 8000.' : err.message);
    } finally {
      setInitLoading(false);
    }
  }, [lectureId, existingSessionId, lectureTitle]);

  useEffect(() => { init(); }, [init]);

  const handleNotes = useCallback(async () => {
    if (!lectureId || notesLoading) return;
    setNotesLoading(true);
    try {
      const res = await generateNotes(lectureId);
      setNotesModal({ visible: true, markdown: res.markdown });
    } catch (err: any) {
      setNotesModal({ visible: true, markdown: `# Error\n\nCould not generate notes: ${err?.message || 'Unknown error'}` });
    } finally {
      setNotesLoading(false);
    }
  }, [lectureId, notesLoading]);

  const handleSend = async (text: string) => {
    const q = text.trim();
    if (!q || !sessionId || sending) return;
    setInputText(''); setSending(true);
    const userMsg: Message = { id: genId(), role: 'user', text: q, timestamp: nowTime(), sources: [] };
    const typingId = genId();
    const typingMsg: Message = { id: typingId, role: 'assistant', text: '', timestamp: '', sources: [], isTyping: true };
    setMessages(prev => [...prev, userMsg, typingMsg]);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    try {
      const res = await sendMessage(sessionId, lectureId!, q);
      setMessages(prev => prev.filter(m => m.id !== typingId).concat({ id: genId(), role: 'assistant', text: res.answer, timestamp: nowTime(), sources: res.sources ?? [] }));
    } catch (err: any) {
      setMessages(prev => prev.filter(m => m.id !== typingId).concat({ id: genId(), role: 'assistant', text: err?.isNetworkError ? 'Cannot reach the server.' : err?.message || 'Something went wrong.', timestamp: nowTime(), sources: [] }));
    } finally {
      setSending(false);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  if (!lectureId) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <View style={{ width: 76, height: 76, borderRadius: 24, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <Ionicons name="chatbubble-ellipses-outline" size={36} color={colors.accent} />
          </View>
          <Text style={{ fontSize: 17, fontWeight: '800', color: colors.text, textAlign: 'center' }}>No lecture selected</Text>
          <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginTop: 6 }}>Tap a lecture on the Home screen to start a chat.</Text>
          <TouchableOpacity style={{ marginTop: 24, backgroundColor: colors.accent, borderRadius: 14, paddingHorizontal: 32, paddingVertical: 12, ...cardShadow }} onPress={() => navigation.navigate('Home')}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Go to Home</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View style={{ flex: 1 }}>

        {/* Header */}
        <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: '600', letterSpacing: 0.4 }}>ACTIVE SESSION</Text>
            <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text, letterSpacing: -0.3 }} numberOfLines={1}>{lectureTitle ?? 'Lecture'}</Text>
          </View>
          <TouchableOpacity
            onPress={toggle}
            style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center', marginRight: 8 }}
          >
            <Ionicons name={isDark ? 'sunny' : 'moon-outline'} size={17} color={colors.accent} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleNotes}
            disabled={notesLoading}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 5,
              backgroundColor: colors.accentLight, borderRadius: 12,
              paddingHorizontal: 12, paddingVertical: 8, marginRight: 8,
              opacity: notesLoading ? 0.6 : 1,
            }}
          >
            {notesLoading
              ? <ActivityIndicator size="small" color={colors.accent} />
              : <Ionicons name="document-text-outline" size={15} color={colors.accent} />
            }
            <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 13 }}>
              {notesLoading ? 'Generating…' : 'Notes'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.switchBtn, { backgroundColor: colors.accentLight, borderColor: colors.accentLight }]} onPress={() => navigation.navigate('Home')}>
            <Ionicons name="swap-horizontal-outline" size={14} color={colors.accent} style={{ marginRight: 4 }} />
            <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 13 }}>Switch</Text>
          </TouchableOpacity>
        </View>

        <NotesModal
          visible={notesModal.visible}
          onClose={() => setNotesModal({ visible: false, markdown: '' })}
          markdown={notesModal.markdown}
          title={lectureTitle ?? 'Lecture'}
          colors={colors}
          isDark={isDark}
        />

        {error && (
          <View style={{ flexDirection: 'column', backgroundColor: '#EF4444', paddingHorizontal: spacing.lg, paddingVertical: 10, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="warning-outline" size={14} color="#fff" style={{ marginRight: 6 }} />
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '500', flex: 1 }}>{error}</Text>
            </View>
            <TouchableOpacity style={{ backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, alignSelf: 'flex-start' }} onPress={() => navigation.navigate('Home')}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Go to Home</Text>
            </TouchableOpacity>
          </View>
        )}

        {initLoading && (
          <View style={{ alignItems: 'center', paddingVertical: spacing.md }}>
            <ActivityIndicator color={colors.accent} />
            <Text style={{ color: colors.textSecondary, marginTop: 6, fontSize: 13 }}>Loading lecture summary…</Text>
          </View>
        )}

        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <MessageBubble message={item} colors={colors} onSourcePress={(sources) => setSourceModal({ visible: true, sources })} />}
          contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: spacing.sm }}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          ListFooterComponent={
            messages.length > 0 && !sending ? (
              <View style={{ marginTop: spacing.sm, marginBottom: spacing.md }}>
                <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 6 }}>Suggested</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {SUGGESTED_QUESTIONS.map((q, i) => (
                    <TouchableOpacity
                      key={i}
                      style={{ backgroundColor: colors.card, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 6, borderWidth: 1, borderColor: colors.border, ...cardShadow }}
                      onPress={() => handleSend(q)}
                    >
                      <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '500' }}>{q}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null
          }
        />

        {!error && (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[styles.inputBar, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
              <TextInput
                style={[styles.input, { backgroundColor: colors.cardAlt, color: colors.text }]}
                placeholder="Ask about this lecture…"
                placeholderTextColor={colors.textSecondary}
                value={inputText}
                onChangeText={setInputText}
                multiline
                maxLength={500}
                editable={!sending && !initLoading}
              />
              <TouchableOpacity style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="mic-outline" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
              <Animated.View style={{ transform: [{ scale: sendBounce }] }}>
                <TouchableOpacity
                  style={[styles.sendBtn, { backgroundColor: (!inputText.trim() || sending) ? colors.border : colors.accent }]}
                  onPress={() => {
                    if (!inputText.trim() || sending) return;
                    Animated.sequence([
                      Animated.timing(sendBounce, { toValue: 0.78, duration: 75, useNativeDriver: true }),
                      Animated.spring(sendBounce, { toValue: 1, tension: 280, friction: 6, useNativeDriver: true }),
                    ]).start();
                    handleSend(inputText);
                  }}
                  disabled={!inputText.trim() || sending}
                >
                  {sending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="arrow-up" size={20} color="#fff" />}
                </TouchableOpacity>
              </Animated.View>
            </View>
          </KeyboardAvoidingView>
        )}

        <SourceModal sources={sourceModal.sources} visible={sourceModal.visible} onClose={() => setSourceModal({ visible: false, sources: [] })} colors={colors} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:           { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  switchBtn:        { flexDirection: 'row', alignItems: 'center', borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1 },
  messageWrapper:   { flexDirection: 'row', alignItems: 'flex-end', marginBottom: spacing.md },
  messageWrapperUser: { justifyContent: 'flex-end' },
  aiAvatar:         { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm, marginBottom: 4, ...cardShadow },
  aiAvatarText:     { color: '#fff', fontSize: 11, fontWeight: '700' },
  bubble:           { maxWidth: '78%', borderRadius: radius.lg, padding: spacing.md },
  bubbleUser:       { borderBottomRightRadius: 4, ...cardShadow },
  bubbleAI:         { borderBottomLeftRadius: 4, ...cardShadow },
  sourcesContainer: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1 },
  sourcesLabel:     { fontSize: 10, fontWeight: '700', marginBottom: 5, letterSpacing: 0.8 },
  sourceChip:       { flexDirection: 'row', alignItems: 'center', borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4, alignSelf: 'flex-start' },
  sourceChipText:   { fontSize: 12, fontWeight: '600' },
  timestamp:        { fontSize: 10, marginTop: spacing.xs, alignSelf: 'flex-end' },
  timestampUser:    { color: 'rgba(255,255,255,0.65)' },
  inputBar:         { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1, gap: spacing.sm },
  input:            { flex: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 15, maxHeight: 100 },
  sendBtn:          { width: 42, height: 42, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', ...cardShadow },
  modalBackdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet:       { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, maxHeight: '65%' },
  modalHandle:      { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.md },
  modalSourceCard:  { borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  modalSourceHeader:{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  modalSourceTime:  { fontSize: 12, fontWeight: '700', flex: 1 },
  scoreChip:        { borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  scoreText:        { fontSize: 11, fontWeight: '600' },
  modalClose:       { borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', marginTop: spacing.md },
  modalCloseText:   { color: '#fff', fontWeight: '700', fontSize: 15 },
});
