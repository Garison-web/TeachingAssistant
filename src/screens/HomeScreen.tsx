import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
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
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { cardShadow, radius, spacing, ThemeColors } from '../theme';
import { useTheme } from '../context/ThemeContext';
import { useNotifications } from '../context/NotificationContext';
import { checkHealth, deleteLecture, getLectures, getStats } from '../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type Lecture = {
  lecture_id    : string;
  title         : string;
  status        : string;
  total_sessions: number;
  total_messages: number;
  last_activity : string | null;
  created_at    : string;
};

type Stats = {
  total_lectures: number;
  total_sessions: number;
  total_messages: number;
  ready_lectures: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelative(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7)   return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function engagementPct(lecture: Lecture): number {
  if (lecture.status !== 'ready') return 0;
  const s = lecture.total_sessions;
  if (s === 0) return 5;
  if (s <= 2)  return 30;
  if (s <= 5)  return 55;
  if (s <= 10) return 78;
  return 95;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  ready        : { label: 'Ready',        color: '#22C55E' },
  embedding    : { label: 'Processing',   color: '#7C3AED' },
  chunking     : { label: 'Processing',   color: '#7C3AED' },
  transcribed  : { label: 'Transcribed',  color: '#F59E0B' },
  transcribing : { label: 'Transcribing', color: '#F59E0B' },
  uploaded     : { label: 'Uploaded',     color: '#F97316' },
  error        : { label: 'Error',        color: '#EF4444' },
};

const RING_COLORS = ['#7C3AED', '#F97316', '#22C55E', '#F59E0B', '#8B5CF6', '#EC4899'];

// ─── Progress Ring ───────────────────────────────────────────────────────────

function ProgressRing({ pct, color, size = 54 }: { pct: number; color: string; size?: number }) {
  const stroke = size > 50 ? 7 : 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(pct, 100) / 100);
  const fontSize = size > 50 ? 13 : 10;

  if (Platform.OS === 'web') {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        {React.createElement('svg', { width: size, height: size, style: { position: 'absolute', transform: 'rotate(-90deg)' } },
          React.createElement('circle', { cx: size / 2, cy: size / 2, r, stroke: `${color}22`, strokeWidth: stroke, fill: 'none' }),
          React.createElement('circle', { cx: size / 2, cy: size / 2, r, stroke: color, strokeWidth: stroke, fill: 'none',
            strokeDasharray: c, strokeDashoffset: off, strokeLinecap: 'round' })
        )}
        <Text style={{ fontSize, fontWeight: '800', color }}>{pct}%</Text>
      </View>
    );
  }
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: `${color}15` }} />
      <View style={{ position: 'absolute', width: size - stroke * 2, height: size - stroke * 2, borderRadius: (size - stroke * 2) / 2, borderWidth: stroke, borderColor: `${color}30` }} />
      <Text style={{ fontSize, fontWeight: '900', color }}>{pct}%</Text>
    </View>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function SkeletonCard({ colors }: { colors: ThemeColors }) {
  const shimmer = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.6] });
  return (
    <Animated.View style={{ opacity, backgroundColor: colors.card, borderRadius: 22, marginHorizontal: 16, marginBottom: 10, padding: 18, ...cardShadow }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
        <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: colors.border, marginRight: 14 }} />
        <View style={{ flex: 1 }}>
          <View style={{ height: 14, width: '70%', backgroundColor: colors.border, borderRadius: 7, marginBottom: 8 }} />
          <View style={{ height: 11, width: '45%', backgroundColor: colors.border, borderRadius: 6 }} />
        </View>
        <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: colors.border }} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[0, 1, 2].map(i => <View key={i} style={{ flex: 1, height: 34, backgroundColor: colors.border, borderRadius: 10 }} />)}
      </View>
    </Animated.View>
  );
}

// ─── Action button ────────────────────────────────────────────────────────────

function ActionBtn({ icon, label, color, bg, onPress }: {
  icon: any; label: string; color: string; bg: string; onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const press = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.88, duration: 65, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, tension: 220, friction: 8, useNativeDriver: true }),
    ]).start();
    onPress();
  };
  return (
    <Animated.View style={{ flex: 1, transform: [{ scale }] }}>
      <TouchableOpacity
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: bg, borderRadius: 10, paddingVertical: 9 }}
        onPress={press}
        activeOpacity={0.85}
      >
        <Ionicons name={icon} size={13} color={color} />
        <Text style={{ fontSize: 12, fontWeight: '700', color }}>{label}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Lecture card ─────────────────────────────────────────────────────────────

function LectureCard({ lecture, index, colors, onChat, onFlashcards, onQuiz, onDelete }: {
  lecture: Lecture; index: number; colors: ThemeColors;
  onChat: () => void; onFlashcards: () => void; onQuiz: () => void; onDelete: () => void;
}) {
  const ringColor  = RING_COLORS[index % RING_COLORS.length];
  const statusInfo = STATUS_MAP[lecture.status] ?? STATUS_MAP.uploaded;
  const isReady    = lecture.status === 'ready';
  const pct        = engagementPct(lecture);

  const opacity    = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity,    { toValue: 1, duration: 360, delay: index * 60, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, delay: index * 60, tension: 80, friction: 11, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <View style={{
        backgroundColor: colors.card, borderRadius: 22,
        marginHorizontal: 16, marginBottom: 10, padding: 14, ...cardShadow,
        borderWidth: 1, borderColor: colors.border,
      }}>
        {/* Top row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: isReady ? 14 : 0 }}>
          {/* Icon circle */}
          <View style={{
            width: 46, height: 46, borderRadius: 14,
            backgroundColor: `${ringColor}18`, alignItems: 'center',
            justifyContent: 'center', marginRight: 14,
          }}>
            <Ionicons name="book-outline" size={22} color={ringColor} />
          </View>

          {/* Title + meta */}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, lineHeight: 21 }} numberOfLines={2}>
              {lecture.title}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6 }}>
              <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: statusInfo.color }} />
              <Text style={{ fontSize: 12, color: colors.textSecondary }}>
                {statusInfo.label} · {formatRelative(lecture.last_activity ?? lecture.created_at)}
              </Text>
            </View>
            <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
              {lecture.total_sessions} session{lecture.total_sessions !== 1 ? 's' : ''} · {lecture.total_messages} Q&As
            </Text>
          </View>

          {/* Progress ring + delete */}
          <View style={{ alignItems: 'center', gap: 8 }}>
            <ProgressRing pct={pct} color={ringColor} />
            <TouchableOpacity
              onPress={onDelete}
              style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="trash-outline" size={13} color="#EF4444" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Action buttons */}
        {isReady && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <ActionBtn icon="chatbubbles-outline"  label="Chat"       color="#7C3AED" bg={`${colors.accentLight}`} onPress={onChat} />
            <ActionBtn icon="albums-outline"        label="Flashcards" color="#8B5CF6" bg="#F3E8FF"                onPress={onFlashcards} />
            <ActionBtn icon="school-outline"        label="Quiz"       color="#F97316" bg="#FFEDD5"                onPress={onQuiz} />
          </View>
        )}
      </View>
    </Animated.View>
  );
}

// ─── Stats bar ───────────────────────────────────────────────────────────────

function StatsSection({ stats, colors }: { stats: Stats; colors: ThemeColors }) {
  const bars = [
    { label: 'Lectures', value: stats.total_lectures, max: Math.max(stats.total_lectures, 1), color: '#7C3AED' },
    { label: 'Ready',    value: stats.ready_lectures,  max: Math.max(stats.total_lectures, 1), color: '#10B981' },
    { label: 'Sessions', value: Math.min(stats.total_sessions, 20),  max: 20, color: '#8B5CF6' },
    { label: 'Q&As',     value: Math.min(stats.total_messages, 100), max: 100, color: '#F97316' },
  ];
  const readyPct = stats.total_lectures > 0
    ? Math.round((stats.ready_lectures / stats.total_lectures) * 100)
    : 0;

  return (
    <View style={{ marginHorizontal: 16, marginTop: 8, marginBottom: 32 }}>
      <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 12 }}>
        My <Text style={{ color: colors.accent }}>Progress</Text>
      </Text>
      <View style={{
        backgroundColor: colors.card, borderRadius: 20, padding: 20,
        ...cardShadow, borderWidth: 1, borderColor: colors.border,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 90 }}>
          {/* Bar chart */}
          {bars.map((b, i) => {
            const barH = Math.max((b.value / b.max) * 70, 4);
            return (
              <View key={i} style={{ flex: 1, alignItems: 'center', height: 90, justifyContent: 'flex-end' }}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text, marginBottom: 4 }}>
                  {b.value}
                </Text>
                <View style={{
                  width: 22, height: barH, backgroundColor: b.color,
                  borderRadius: 6, marginBottom: 6,
                }} />
                <Text style={{ fontSize: 10, color: colors.textSecondary, textAlign: 'center' }}>
                  {b.label}
                </Text>
              </View>
            );
          })}

          {/* Ready % circle */}
          <View style={{ width: 72, alignItems: 'center', justifyContent: 'center', height: 90 }}>
            <View style={{
              width: 62, height: 62, borderRadius: 31,
              backgroundColor: `${colors.accent}15`,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 3.5, borderColor: colors.accent,
            }}>
              <Text style={{ fontSize: 15, fontWeight: '900', color: colors.accent }}>
                {readyPct}%
              </Text>
            </View>
            <Text style={{ fontSize: 10, color: colors.textSecondary, marginTop: 5 }}>Ready</Text>
          </View>
        </View>

        {/* Legend */}
        <View style={{ flexDirection: 'row', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
          {[{ label: 'Processed', color: '#10B981' }, { label: 'Pending', color: colors.border }].map(l => (
            <View key={l.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: l.color }} />
              <Text style={{ fontSize: 11, color: colors.textSecondary }}>{l.label}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

// ─── Notification panel ───────────────────────────────────────────────────────

const TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  quiz     : 'school-outline',
  flashcard: 'albums-outline',
  upload   : 'checkmark-circle-outline',
  info     : 'information-circle-outline',
};
const TYPE_COLOR: Record<string, string> = {
  quiz: '#7C3AED', flashcard: '#F97316', upload: '#10B981', info: '#F59E0B',
};

function formatAge(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60)  return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function NotificationPanel({ visible, onClose, colors }: {
  visible : boolean;
  onClose : () => void;
  colors  : ThemeColors;
}) {
  const { notifications, unreadCount, markAllRead, clearAll } = useNotifications();
  const slideY  = useRef(new Animated.Value(600)).current;
  const backdropO = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      markAllRead();
      Animated.parallel([
        Animated.spring(slideY,   { toValue: 0, tension: 70, friction: 12, useNativeDriver: true }),
        Animated.timing(backdropO, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideY,    { toValue: 600, duration: 280, useNativeDriver: true }),
        Animated.timing(backdropO, { toValue: 0,   duration: 220, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <Animated.View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', opacity: backdropO }} />
      </TouchableWithoutFeedback>

      <Animated.View style={[npStyles.sheet, { backgroundColor: colors.card, transform: [{ translateY: slideY }] }]}>
        {/* Handle */}
        <View style={[npStyles.handle, { backgroundColor: colors.border }]} />

        {/* Header */}
        <View style={npStyles.sheetHeader}>
          <Text style={[npStyles.sheetTitle, { color: colors.text }]}>Notifications</Text>
          {notifications.length > 0 && (
            <TouchableOpacity onPress={clearAll} style={[npStyles.clearBtn, { backgroundColor: colors.cardAlt }]}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textSecondary }}>Clear all</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
          {notifications.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 48, paddingBottom: 24 }}>
              <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                <Ionicons name="notifications-off-outline" size={34} color={colors.textSecondary} />
              </View>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>No notifications</Text>
              <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 4 }}>
                Notifications will appear here when sessions are ready.
              </Text>
            </View>
          ) : (
            notifications.map(n => (
              <View key={n.id} style={[npStyles.item, { borderBottomColor: colors.border }]}>
                <View style={[npStyles.itemIcon, { backgroundColor: `${TYPE_COLOR[n.type]}18` }]}>
                  <Ionicons name={TYPE_ICON[n.type]} size={20} color={TYPE_COLOR[n.type]} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[npStyles.itemTitle, { color: colors.text }]}>{n.title}</Text>
                  <Text style={[npStyles.itemBody, { color: colors.textSecondary }]} numberOfLines={2}>{n.body}</Text>
                  <Text style={[npStyles.itemAge, { color: colors.textSecondary }]}>{formatAge(n.timestamp)}</Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const npStyles = StyleSheet.create({
  sheet      : { position: 'absolute', bottom: 0, left: 0, right: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 12, maxHeight: '75%' },
  handle     : { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, marginBottom: 12 },
  sheetTitle : { fontSize: 18, fontWeight: '800', flex: 1 },
  clearBtn   : { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  item       : { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingHorizontal: 22, paddingVertical: 14, borderBottomWidth: 1 },
  itemIcon   : { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  itemTitle  : { fontSize: 14, fontWeight: '700', marginBottom: 3 },
  itemBody   : { fontSize: 13, lineHeight: 19, marginBottom: 4 },
  itemAge    : { fontSize: 11, fontWeight: '500' },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const navigation             = useNavigation<any>();
  const { colors, isDark, toggle } = useTheme();
  const { unreadCount }        = useNotifications();

  const [lectures, setLectures]           = useState<Lecture[]>([]);
  const [stats, setStats]                 = useState<Stats | null>(null);
  const [loading, setLoading]             = useState(true);
  const [refreshing, setRefreshing]       = useState(false);
  const [serverOk, setServerOk]           = useState<boolean | null>(null);
  const [error, setError]                 = useState<string | null>(null);
  const [search, setSearch]               = useState('');
  const [showNotifications, setShowNotifications] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError(null);
    try {
      const [ok, data, statsData] = await Promise.all([checkHealth(), getLectures(), getStats()]);
      setServerOk(ok);
      setLectures(data ?? []);
      setStats(statsData);
    } catch (err: any) {
      setServerOk(false);
      setError(err.isNetworkError
        ? 'Cannot connect to server. Make sure backend is running on port 8000.'
        : err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = useCallback(() => { setRefreshing(true); load(true); }, [load]);

  const handleDelete = useCallback(async (lecture: Lecture) => {
    setLectures(prev => prev.filter(l => l.lecture_id !== lecture.lecture_id));
    try {
      await deleteLecture(lecture.lecture_id);
    } catch (err: any) {
      setLectures(prev => [lecture, ...prev]);
      Alert.alert('Could not delete',
        err.isNetworkError ? 'Cannot reach the server.' : err.message || 'Something went wrong.');
    }
  }, []);

  const filtered = useMemo(() =>
    search.trim()
      ? lectures.filter(l => l.title.toLowerCase().includes(search.toLowerCase()))
      : lectures,
  [lectures, search]);

  const recentLecture = useMemo(() =>
    [...lectures]
      .filter(l => l.status === 'ready')
      .sort((a, b) => new Date(b.last_activity || b.created_at).getTime() - new Date(a.last_activity || a.created_at).getTime())[0],
  [lectures]);

  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning,' : hour < 18 ? 'Good afternoon,' : 'Good evening,';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      <NotificationPanel
        visible={showNotifications}
        onClose={() => setShowNotifications(false)}
        colors={colors}
      />

      <FlatList
        data={loading ? [] : filtered}
        keyExtractor={item => item.lecture_id}
        renderItem={({ item, index }) => (
          <LectureCard
            lecture={item}
            index={index}
            colors={colors}
            onChat={() => navigation.navigate('Chat', { lectureId: item.lecture_id, title: item.title })}
            onFlashcards={() => navigation.navigate('Flashcards', { lectureId: item.lecture_id, title: item.title })}
            onQuiz={() => navigation.navigate('Quiz', { lectureId: item.lecture_id, title: item.title })}
            onDelete={() => handleDelete(item)}
          />
        )}
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
        ListHeaderComponent={
          <>
            {/* ── Hero gradient card ──────────────────────────── */}
            <View style={[
              {
                marginHorizontal: 16, marginTop: 12, marginBottom: 6,
                borderRadius: 28, overflow: 'hidden',
                backgroundColor: colors.accent,
                shadowColor: colors.accent,
                shadowOffset: { width: 0, height: 14 },
                shadowOpacity: 0.35, shadowRadius: 30, elevation: 12,
              },
              Platform.OS === 'web'
                ? { background: `linear-gradient(135deg, ${colors.accent} 0%, ${colors.accentDark} 100%)` } as any
                : {},
            ]}>
              {/* Decorative orbs */}
              <View style={{ position: 'absolute', top: -40, right: -30, width: 140, height: 140, borderRadius: 70, backgroundColor: 'rgba(255,255,255,0.08)' }} />
              <View style={{ position: 'absolute', bottom: -50, left: -20, width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(255,255,255,0.06)' }} />

              <View style={{ padding: 18, paddingBottom: 22 }}>
                {/* Top row: avatar, greeting, buttons */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={[
                    { width: 44, height: 44, borderRadius: 22, backgroundColor: '#f97316', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12 },
                    Platform.OS === 'web' ? { background: 'linear-gradient(135deg, #fbbf24, #f97316)', boxShadow: '0 4px 12px rgba(0,0,0,0.15), inset 0 0 0 2px rgba(255,255,255,0.3)' } as any : {},
                  ]}>
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 18 }}>S</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '500' }}>{greeting}</Text>
                    <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 1 }}>Continue Learning!</Text>
                  </View>
                  <TouchableOpacity
                    onPress={toggle}
                    style={[
                      { width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
                      Platform.OS === 'web' ? { outline: 'none', WebkitTapHighlightColor: 'transparent' } as any : {},
                    ]}
                  >
                    <Ionicons name={isDark ? 'sunny' : 'moon-outline'} size={18} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      { position: 'relative' },
                      Platform.OS === 'web' ? { outline: 'none', WebkitTapHighlightColor: 'transparent', backgroundColor: 'transparent' } as any : {},
                    ]}
                    onPress={() => setShowNotifications(true)}
                    activeOpacity={0.8}
                  >
                    <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="notifications-outline" size={18} color="#fff" />
                    </View>
                    {unreadCount > 0 ? (
                      <View style={{
                        position: 'absolute', top: -4, right: -4,
                        minWidth: 18, height: 18, borderRadius: 9,
                        backgroundColor: '#FBBF24',
                        alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
                      }}>
                        <Text style={{ fontSize: 10, fontWeight: '800', color: '#000' }}>
                          {unreadCount > 9 ? '9+' : unreadCount}
                        </Text>
                      </View>
                    ) : serverOk !== null ? (
                      <View style={{
                        position: 'absolute', top: 6, right: 6, width: 8, height: 8,
                        borderRadius: 4,
                        backgroundColor: serverOk ? '#22C55E' : '#EF4444',
                      }} />
                    ) : null}
                  </TouchableOpacity>
                </View>

                {/* Continue where you left off */}
                {recentLecture && !loading && (
                  <TouchableOpacity
                    style={{
                      marginTop: 18, padding: 12, borderRadius: 18,
                      backgroundColor: 'rgba(255,255,255,0.14)',
                      borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                    }}
                    activeOpacity={0.85}
                    onPress={() => navigation.navigate('Chat', { lectureId: recentLecture.lecture_id, title: recentLecture.title })}
                  >
                    <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Ionicons name="book-outline" size={22} color="#fff" />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' }}>
                        Continue where you left off
                      </Text>
                      <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700', marginTop: 2 }} numberOfLines={1}>
                        {recentLecture.title}
                      </Text>
                      <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={{ flex: 1, height: 4, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' }}>
                          <View style={{ height: '100%', width: `${engagementPct(recentLecture)}%` as any, backgroundColor: '#fff', borderRadius: 4 }} />
                        </View>
                        <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{engagementPct(recentLecture)}%</Text>
                      </View>
                    </View>
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', flexShrink: 0, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12 }}>
                      <Ionicons name="play" size={16} color={colors.accent} style={{ marginLeft: 2 }} />
                    </View>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Error banner */}
            {error && (
              <View style={{
                flexDirection: 'row', alignItems: 'center',
                backgroundColor: '#EF4444',
                marginHorizontal: 16, borderRadius: 14,
                paddingHorizontal: 14, paddingVertical: 12,
                marginBottom: 12, gap: 8,
              }}>
                <Ionicons name="wifi-outline" size={14} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '500', flex: 1 }} numberOfLines={2}>{error}</Text>
              </View>
            )}

            {/* Section header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 18, marginBottom: 10 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text, flex: 1 }}>
                Your <Text style={{ color: colors.accent }}>Lectures</Text>
              </Text>
              <View style={{ backgroundColor: colors.accentLight, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: colors.accent }}>
                  {loading ? '–' : lectures.length}
                </Text>
              </View>
            </View>

            {/* Search bar */}
            <View style={{
              flexDirection: 'row', alignItems: 'center',
              backgroundColor: colors.card, borderRadius: 14,
              marginHorizontal: 16, paddingHorizontal: 14,
              marginBottom: 12, ...cardShadow,
              borderWidth: 1, borderColor: colors.border,
            }}>
              <Ionicons name="search-outline" size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
              <TextInput
                style={{ flex: 1, fontSize: 15, color: colors.text, paddingVertical: 12 }}
                placeholder="Search lectures…"
                placeholderTextColor={colors.textSecondary}
                value={search}
                onChangeText={setSearch}
                returnKeyType="search"
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch('')}>
                  <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>

            {/* Skeletons while loading */}
            {loading && [0, 1, 2].map(i => <SkeletonCard key={i} colors={colors} />)}
          </>
        }
        ListFooterComponent={
          !loading && stats ? <StatsSection stats={stats} colors={colors} /> : null
        }
        ListEmptyComponent={
          !loading ? (
            <View style={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 }}>
              <View style={{
                width: 80, height: 80, borderRadius: 24,
                backgroundColor: colors.accentLight,
                alignItems: 'center', justifyContent: 'center', marginBottom: 16,
              }}>
                <Ionicons name={search ? 'search-outline' : 'library-outline'} size={36} color={colors.accent} />
              </View>
              <Text style={{ fontSize: 17, fontWeight: '800', color: colors.text, textAlign: 'center' }}>
                {search ? 'No lectures match your search' : 'No lectures yet'}
              </Text>
              <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginTop: 6 }}>
                {search ? 'Try a different keyword' : 'Go to Upload to add your first lecture'}
              </Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}
