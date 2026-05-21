import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  PanResponder,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { cardShadow, radius, spacing } from '../theme';
import { useTheme } from '../context/ThemeContext';
import { deleteLecture, deleteSession, getLectures, getSessions } from '../services/api';

type Lecture = {
  lecture_id    : string;
  title         : string;
  status        : string;
  total_sessions: number;
  total_messages: number;
  last_activity : string | null;
  created_at    : string;
};

type Session = {
  session_id   : string;
  lecture_id   : string;
  title        : string;
  created_at   : string;
  updated_at   : string;
  message_count: number;
  last_message : string | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return '–';
  const d    = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7)   return `${days}d ago`;
  return d.toLocaleDateString();
}

const RING_COLORS = ['#7C3AED', '#22C55E', '#F97316', '#F59E0B', '#8B5CF6'];

const STATUS_STYLE: Record<string, { color: string; label: string }> = {
  ready       : { color: '#22C55E', label: 'Ready'       },
  error       : { color: '#EF4444', label: 'Error'       },
  transcribing: { color: '#F59E0B', label: 'Transcribing'},
  transcribed : { color: '#F59E0B', label: 'Transcribed' },
  embedding   : { color: '#7C3AED', label: 'Processing'  },
  chunking    : { color: '#7C3AED', label: 'Processing'  },
  uploaded    : { color: '#F97316', label: 'Uploaded'    },
};

function SwipeableRow({ children, onDelete }: { children: React.ReactNode; onDelete: () => void }) {
  const translateX  = useRef(new Animated.Value(0)).current;
  const DELETE_WIDTH = 80;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 8,
      onPanResponderMove:    (_, g) => { if (g.dx < 0) translateX.setValue(Math.max(g.dx, -DELETE_WIDTH)); },
      onPanResponderRelease: (_, g) => {
        if (g.dx < -DELETE_WIDTH / 2) {
          Animated.spring(translateX, { toValue: -DELETE_WIDTH, useNativeDriver: true }).start();
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;
  const close = () => Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
  return (
    <View style={{ position: 'relative', marginBottom: 10 }}>
      <View style={[styles.deleteReveal, { width: DELETE_WIDTH }]}>
        <TouchableOpacity style={styles.deleteBtn} onPress={() => { close(); onDelete(); }}>
          <Ionicons name="trash-outline" size={18} color="#fff" />
          <Text style={styles.deleteBtnText}>Delete</Text>
        </TouchableOpacity>
      </View>
      <Animated.View {...panResponder.panHandlers} style={{ transform: [{ translateX }] }}>
        {children}
      </Animated.View>
    </View>
  );
}

function SessionCard({ session, colors, onContinue, onDelete }: {
  session: Session; colors: any; onContinue: () => void; onDelete: () => void;
}) {
  return (
    <SwipeableRow onDelete={onDelete}>
      <View style={[styles.sessionCard, { backgroundColor: colors.cardAlt }]}>
        <View style={[styles.sessionIconWrap, { backgroundColor: colors.accentLight }]}>
          <Ionicons name="chatbubble-ellipses-outline" size={15} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.sessionTitle, { color: colors.text }]} numberOfLines={1}>{session.title}</Text>
          {session.last_message && (
            <Text style={[styles.sessionPreview, { color: colors.textSecondary }]} numberOfLines={1}>{session.last_message}</Text>
          )}
          <Text style={[styles.sessionMeta, { color: colors.textSecondary }]}>
            {session.message_count} msg{session.message_count !== 1 ? 's' : ''} · {formatDate(session.updated_at)}
          </Text>
        </View>
        <TouchableOpacity style={[styles.continueBtn, { backgroundColor: colors.accentLight }]} onPress={onContinue}>
          <Text style={[styles.continueBtnText, { color: colors.accent }]}>Continue</Text>
          <Ionicons name="arrow-forward" size={12} color={colors.accent} style={{ marginLeft: 3 }} />
        </TouchableOpacity>
      </View>
    </SwipeableRow>
  );
}

function LectureCard({ lecture, index, colors, onDelete, onNavigate }: {
  lecture: Lecture; index: number; colors: any;
  onDelete: () => void; onNavigate: (sessionId?: string) => void;
}) {
  const ringColor    = RING_COLORS[index % RING_COLORS.length];
  const statusSt     = STATUS_STYLE[lecture.status] ?? STATUS_STYLE.uploaded;
  const deleteBounce = useRef(new Animated.Value(1)).current;
  const entryOpacity = useRef(new Animated.Value(0)).current;
  const entryY       = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(entryOpacity, { toValue: 1, duration: 350, delay: index * 55, useNativeDriver: true }),
      Animated.spring(entryY, { toValue: 0, delay: index * 55, tension: 80, friction: 11, useNativeDriver: true }),
    ]).start();
  }, []);

  const pressDelete = () => {
    onDelete();
    Animated.sequence([
      Animated.timing(deleteBounce, { toValue: 1.4, duration: 80, useNativeDriver: true }),
      Animated.timing(deleteBounce, { toValue: 1,   duration: 120, useNativeDriver: true }),
    ]).start();
  };

  const [expanded,    setExpanded]    = useState(false);
  const [sessions,    setSessions]    = useState<Session[]>([]);
  const [loadingSess, setLoadingSess] = useState(false);

  const toggleExpand = async () => {
    if (!expanded && sessions.length === 0) {
      setLoadingSess(true);
      try   { setSessions((await getSessions(lecture.lecture_id)) ?? []); }
      catch { /* ignore */ }
      finally { setLoadingSess(false); }
    }
    setExpanded(e => !e);
  };

  const handleDeleteSession = (sessionId: string) => {
    Alert.alert('Delete Session', 'This will permanently delete this chat session and all its messages.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await deleteSession(sessionId);
            setSessions(prev => prev.filter(s => s.session_id !== sessionId));
          } catch (err: any) {
            Alert.alert('Error', err.message || 'Could not delete session.');
          }
        },
      },
    ]);
  };

  return (
    <Animated.View style={{ opacity: entryOpacity, transform: [{ translateY: entryY }] }}>
      <SwipeableRow onDelete={onDelete}>
        <View style={[styles.lectureCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.lectureBar, { backgroundColor: ringColor }]} />
          <View style={{ flex: 1 }}>
            <TouchableOpacity style={styles.lectureHeader} onPress={toggleExpand} activeOpacity={0.8}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.lectureTitle, { color: colors.text }]} numberOfLines={2}>{lecture.title}</Text>
                <View style={[styles.lectureMeta]}>
                  <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: statusSt.color, marginRight: 5 }} />
                  <Text style={[styles.lectureMetaText, { color: colors.textSecondary }]}>
                    {statusSt.label} · {lecture.total_sessions} session{lecture.total_sessions !== 1 ? 's' : ''} · {formatDate(lecture.last_activity ?? lecture.created_at)}
                  </Text>
                </View>
              </View>
              <View style={styles.lectureRight}>
                <View style={[styles.sessionCount, { borderColor: ringColor, backgroundColor: `${ringColor}15` }]}>
                  <Text style={[styles.sessionCountText, { color: ringColor }]}>{lecture.total_sessions}</Text>
                </View>
                <Animated.View style={{ transform: [{ scale: deleteBounce }] }}>
                  <TouchableOpacity style={styles.lectureDeleteBtn} onPress={pressDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="trash-outline" size={13} color="#EF4444" />
                  </TouchableOpacity>
                </Animated.View>
                <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
              </View>
            </TouchableOpacity>

            {expanded && (
              <View style={[styles.sessionsList, { borderTopColor: colors.border }]}>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                {loadingSess ? (
                  <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} />
                ) : sessions.length === 0 ? (
                  <Text style={{ color: colors.textSecondary, textAlign: 'center', paddingVertical: 16, fontSize: 13 }}>
                    No sessions yet — start a chat from the Home screen.
                  </Text>
                ) : (
                  sessions.map(sess => (
                    <SessionCard
                      key={sess.session_id}
                      session={sess}
                      colors={colors}
                      onContinue={() => onNavigate(sess.session_id)}
                      onDelete={() => handleDeleteSession(sess.session_id)}
                    />
                  ))
                )}
                <TouchableOpacity style={styles.newChatBtn} onPress={() => onNavigate(undefined)}>
                  <Ionicons name="add-circle-outline" size={16} color={colors.accent} style={{ marginRight: 6 }} />
                  <Text style={[styles.newChatText, { color: colors.accent }]}>New chat for this lecture</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </SwipeableRow>
    </Animated.View>
  );
}

const FILTER_TABS = ['All', 'Ready', 'Recent'];

export default function HistoryScreen() {
  const navigation = useNavigation<any>();
  const { colors, isDark, toggle } = useTheme();

  const [lectures,     setLectures]     = useState<Lecture[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchText,   setSearchText]   = useState('');
  const [error,        setError]        = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError(null);
    try {
      setLectures((await getLectures()) ?? []);
    } catch (err: any) {
      setError(err.isNetworkError
        ? 'Cannot connect to server. Make sure the backend is running on port 8000.'
        : err.message);
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); load(true); }, [load]);

  const filtered = lectures.filter(lec => {
    if (activeFilter === 'Ready'  && lec.status !== 'ready') return false;
    if (activeFilter === 'Recent') {
      const diff = Date.now() - new Date(lec.last_activity ?? lec.created_at).getTime();
      if (diff > 7 * 24 * 60 * 60 * 1000) return false;
    }
    if (searchText) return lec.title.toLowerCase().includes(searchText.toLowerCase());
    return true;
  });

  const handleDeleteLecture = (lecture: Lecture) => {
    Alert.alert('Delete Lecture', `"${lecture.title}" and ALL its sessions, messages, and embeddings will be permanently deleted.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await deleteLecture(lecture.lecture_id);
            setLectures(prev => prev.filter(l => l.lecture_id !== lecture.lecture_id));
          } catch (err: any) {
            Alert.alert('Error', err.message || 'Could not delete lecture.');
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {error && (
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#EF4444', paddingHorizontal: 24, paddingVertical: 12, gap: 8 }}>
          <Ionicons name="wifi-outline" size={14} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '500', flex: 1 }} numberOfLines={2}>{error}</Text>
        </View>
      )}

      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 20 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, color: colors.textSecondary, fontWeight: '500' }}>Your progress</Text>
          <Text style={{ fontSize: 26, fontWeight: '800', color: colors.text, letterSpacing: -0.5 }}>History</Text>
        </View>
        <TouchableOpacity
          onPress={toggle}
          style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center', marginRight: 10 }}
        >
          <Ionicons name={isDark ? 'sunny' : 'moon-outline'} size={19} color={colors.accent} />
        </TouchableOpacity>
        <View style={{ backgroundColor: colors.accentLight, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6 }}>
          <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '700' }}>
            {lectures.length} lecture{lectures.length !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>

      {/* Search + filters */}
      <View style={{ paddingHorizontal: 24, marginBottom: 12 }}>
        <View style={[styles.searchRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="search-outline" size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
          <TextInput
            style={{ flex: 1, color: colors.text, fontSize: 15, paddingVertical: 12 }}
            placeholder="Search lectures…"
            placeholderTextColor={colors.textSecondary}
            value={searchText}
            onChangeText={setSearchText}
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={() => setSearchText('')}>
              <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          {FILTER_TABS.map(tab => (
            <TouchableOpacity
              key={tab}
              style={[
                styles.filterTab,
                { backgroundColor: activeFilter === tab ? colors.accent : colors.card, borderColor: activeFilter === tab ? colors.accent : colors.border },
              ]}
              onPress={() => setActiveFilter(tab)}
            >
              <Text style={{ color: activeFilter === tab ? '#fff' : colors.textSecondary, fontSize: 13, fontWeight: '600' }}>
                {tab}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 32 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.lecture_id}
          renderItem={({ item, index }) => (
            <LectureCard
              lecture={item}
              index={index}
              colors={colors}
              onDelete={() => handleDeleteLecture(item)}
              onNavigate={(sessionId) => navigation.navigate('Chat', {
                lectureId: item.lecture_id,
                title: item.title,
                ...(sessionId ? { sessionId } : {}),
              })}
            />
          )}
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 }}>
              <View style={{ width: 76, height: 76, borderRadius: 24, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Ionicons name="time-outline" size={36} color={colors.accent} />
              </View>
              <Text style={{ fontSize: 17, fontWeight: '800', color: colors.text, textAlign: 'center' }}>
                {searchText ? 'No results found' : 'No lectures yet'}
              </Text>
              <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginTop: 6 }}>
                {searchText ? 'Try a different search term' : 'Upload a lecture to get started'}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, paddingHorizontal: 14, borderWidth: 1, ...cardShadow },
  filterTab: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: radius.full, borderWidth: 1 },
  lectureCard: { flexDirection: 'row', borderRadius: 18, overflow: 'hidden', borderWidth: 1, ...cardShadow },
  lectureBar:   { width: 5, minHeight: 72 },
  lectureHeader:{ flexDirection: 'row', alignItems: 'center', padding: 14, flex: 1 },
  lectureTitle: { fontSize: 15, fontWeight: '600', marginBottom: 6, lineHeight: 21 },
  lectureMeta:  { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  lectureMetaText: { fontSize: 12 },
  lectureRight: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 10 },
  lectureDeleteBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' },
  sessionCount: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  sessionCountText: { fontSize: 13, fontWeight: '800' },
  sessionsList: { paddingHorizontal: 14, paddingBottom: 10, borderTopWidth: 1 },
  divider: { height: 1, marginBottom: 10 },
  sessionCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 10, paddingHorizontal: 12, gap: 10, marginBottom: 8 },
  sessionIconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  sessionTitle:   { fontSize: 14, fontWeight: '600' },
  sessionPreview: { fontSize: 12, marginTop: 1 },
  sessionMeta:    { fontSize: 12, marginTop: 1 },
  continueBtn: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 5 },
  continueBtnText: { fontSize: 12, fontWeight: '700' },
  newChatBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, marginTop: 4 },
  newChatText: { fontSize: 13, fontWeight: '600' },
  deleteReveal: { position: 'absolute', right: 0, top: 0, bottom: 0, backgroundColor: '#EF4444', borderRadius: 18, justifyContent: 'center', alignItems: 'flex-end' },
  deleteBtn: { width: 80, alignItems: 'center', justifyContent: 'center', flex: 1, gap: 3 },
  deleteBtnText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
