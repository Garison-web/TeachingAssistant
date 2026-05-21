import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { cardShadow, radius, spacing } from '../theme';
import { useTheme } from '../context/ThemeContext';
import { useNotifications } from '../context/NotificationContext';
import { generateFlashcards } from '../services/api';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = SCREEN_W - spacing.lg * 2;
const CARD_H = 260;

type Card = { front: string; back: string };

// ─── Single flippable card (scaleX squeeze — smooth and fast) ─────────────────

function FlipCard({ card, colors, index, total }: { card: Card; colors: any; index: number; total: number }) {
  const [showBack, setShowBack] = useState(false);
  const scaleX      = useRef(new Animated.Value(1)).current;
  const isAnimating = useRef(false);

  const doFlip = () => {
    if (isAnimating.current) return;
    isAnimating.current = true;
    Animated.timing(scaleX, { toValue: 0, duration: 140, useNativeDriver: true }).start(() => {
      setShowBack(s => !s);
      Animated.spring(scaleX, { toValue: 1, tension: 180, friction: 10, useNativeDriver: true }).start(() => {
        isAnimating.current = false;
      });
    });
  };

  return (
    <TouchableOpacity activeOpacity={0.95} onPress={doFlip} style={styles.cardTouchable}>
      <Animated.View
        style={[
          styles.card,
          showBack
            ? { backgroundColor: colors.accent }
            : { backgroundColor: colors.card },
          { transform: [{ scaleX }], ...cardShadow },
        ]}
      >
        {/* Decorative orbs */}
        {showBack ? (
          <>
            <View style={{ position: 'absolute', top: -60, right: -40, width: 160, height: 160, borderRadius: 80, backgroundColor: 'rgba(255,255,255,0.08)' }} />
            <View style={{ position: 'absolute', bottom: -50, left: -30, width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,255,255,0.06)' }} />
          </>
        ) : (
          <>
            <View style={{ position: 'absolute', top: -50, right: -50, width: 130, height: 130, borderRadius: 65, backgroundColor: `${colors.accent}10` }} />
            <View style={{ position: 'absolute', bottom: -40, left: -40, width: 100, height: 100, borderRadius: 50, backgroundColor: `${colors.accent}08` }} />
          </>
        )}

        {showBack ? (
          <>
            <View style={styles.cardLabel}>
              <Ionicons name="bulb-outline" size={16} color="rgba(255,255,255,0.85)" />
              <Text style={[styles.cardLabelText, { color: 'rgba(255,255,255,0.8)' }]}>Answer</Text>
            </View>
            <Text style={styles.cardBackText}>{card.back}</Text>
            <Text style={{ position: 'absolute', bottom: 16, right: 18, fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Tap to flip</Text>
          </>
        ) : (
          <>
            <View style={styles.cardLabel}>
              <Ionicons name="sparkles" size={14} color={colors.accent} />
              <Text style={[styles.cardLabelText, { color: colors.accent }]}>Question</Text>
            </View>
            <Text style={[styles.cardFrontText, { color: colors.text }]}>{card.front}</Text>
            {/* Dot pagination */}
            <View style={{ position: 'absolute', bottom: 16, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 }}>
              {Array.from({ length: Math.min(total, 8) }).map((_, i) => (
                <View key={i} style={{
                  width: i === index ? 18 : 6, height: 6, borderRadius: 3,
                  backgroundColor: i === index ? colors.accent : `${colors.accent}28`,
                }} />
              ))}
            </View>
          </>
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────

function Header({ title, onBack, onToggle, isDark }: { title: string; onBack: () => void; onToggle: () => void; isDark: boolean }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.backBtn}>
        <Ionicons name="arrow-back" size={22} color="#fff" />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerSub}>Flashcards</Text>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      </View>
      <TouchableOpacity onPress={onToggle} style={[styles.backBtn, { marginRight: 8 }]}>
        <Ionicons name={isDark ? 'sunny' : 'moon-outline'} size={18} color="#fff" />
      </TouchableOpacity>
      <View style={styles.headerIcon}>
        <Ionicons name="albums-outline" size={22} color="rgba(255,255,255,0.9)" />
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function FlashcardScreen() {
  const navigation = useNavigation<any>();
  const route      = useRoute<any>();
  const { colors, isDark, toggle } = useTheme();
  const { addNotification } = useNotifications();
  const { lectureId, title } = (route.params ?? {}) as { lectureId: string; title: string };

  const [cards, setCards]     = useState<Card[]>([]);
  const [index, setIndex]     = useState(0);
  const [known, setKnown]     = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [done, setDone]       = useState(false);

  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim  = useRef(new Animated.Value(1)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const doneScale = useRef(new Animated.Value(0)).current;

  // Mount-only entrance animation
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, tension: 80, friction: 9, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await generateFlashcards(lectureId);
        setCards(res.cards);
        addNotification({
          type        : 'flashcard',
          title       : 'Flashcards ready!',
          body        : `${res.cards.length} cards generated for "${title}". Your study session is ready.`,
          lectureId,
          lectureTitle: title,
        });
      } catch (e: any) {
        setError(e.message || 'Failed to generate flashcards');
      } finally {
        setLoading(false);
      }
    })();
  }, [lectureId]);

  const animateTransition = useCallback((direction: 'next' | 'prev', cb: () => void) => {
    const toValue = direction === 'next' ? -SCREEN_W : SCREEN_W;
    Animated.parallel([
      Animated.timing(slideAnim, { toValue, duration: 220, useNativeDriver: true }),
      Animated.timing(fadeAnim,  { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => {
      slideAnim.setValue(direction === 'next' ? SCREEN_W : -SCREEN_W);
      fadeAnim.setValue(0);
      scaleAnim.setValue(0.88);
      cb();
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, tension: 100, friction: 12, useNativeDriver: true }),
        Animated.timing(fadeAnim,  { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, tension: 90, friction: 10, useNativeDriver: true }),
      ]).start();
    });
  }, [slideAnim, fadeAnim, scaleAnim]);

  const goNext = useCallback((markKnown?: boolean) => {
    if (markKnown) setKnown(prev => new Set(prev).add(index));
    if (index >= cards.length - 1) {
      setDone(true);
      Animated.spring(doneScale, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }).start();
      return;
    }
    animateTransition('next', () => setIndex(i => i + 1));
  }, [index, cards.length, animateTransition, doneScale]);

  const goPrev = useCallback(() => {
    if (index === 0) return;
    animateTransition('prev', () => setIndex(i => i - 1));
  }, [index, animateTransition]);

  const restart = useCallback(() => {
    setDone(false); setIndex(0); setKnown(new Set());
    doneScale.setValue(0); slideAnim.setValue(0);
    fadeAnim.setValue(1); scaleAnim.setValue(1);
  }, [doneScale, slideAnim, fadeAnim, scaleAnim]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.accent }]} edges={['top']}>
        <Header title={title} onBack={() => navigation.goBack()} onToggle={toggle} isDark={isDark} />
        <View style={[styles.center, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={{ marginTop: spacing.md, textAlign: 'center', fontSize: 14, color: colors.textSecondary }}>
            Generating flashcards with AI…{'\n'}this takes a few seconds
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.accent }]} edges={['top']}>
        <Header title={title} onBack={() => navigation.goBack()} onToggle={toggle} isDark={isDark} />
        <View style={[styles.center, { backgroundColor: colors.background }]}>
          <Ionicons name="warning-outline" size={48} color={colors.error} />
          <Text style={{ marginTop: spacing.md, fontSize: 16, fontWeight: '700', color: colors.text, textAlign: 'center' }}>Could not generate flashcards</Text>
          <Text style={{ marginTop: 6, fontSize: 13, color: colors.textSecondary, textAlign: 'center' }}>{error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (done) {
    const knownCount = known.size + 1;
    const pct = Math.round((knownCount / cards.length) * 100);
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.accent }]} edges={['top']}>
        <Header title={title} onBack={() => navigation.goBack()} onToggle={toggle} isDark={isDark} />
        <View style={[styles.center, { backgroundColor: colors.background }]}>
          <Animated.View style={[styles.doneCircle, { backgroundColor: colors.accentLight, transform: [{ scale: doneScale }] }]}>
            <Text style={styles.doneEmoji}>🎉</Text>
          </Animated.View>
          <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text, marginTop: spacing.lg, textAlign: 'center' }}>Deck Complete!</Text>
          <Text style={{ fontSize: 15, color: colors.textSecondary, marginTop: 6, textAlign: 'center' }}>
            You marked {knownCount} of {cards.length} cards as known ({pct}%)
          </Text>
          <View style={[styles.doneBar, { backgroundColor: colors.border }]}>
            <View style={[styles.doneBarFill, { width: `${pct}%` as any, backgroundColor: colors.success }]} />
          </View>
          <View style={styles.doneBtns}>
            <TouchableOpacity style={[styles.restartBtn, { borderColor: colors.accent }]} onPress={restart}>
              <Ionicons name="refresh-outline" size={18} color={colors.accent} style={{ marginRight: 6 }} />
              <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 15 }}>Study Again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.doneBtn, { backgroundColor: colors.accent }]} onPress={() => navigation.goBack()}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Back to Lecture</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const card     = cards[index];
  const progress = (index + 1) / cards.length;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.accent }]} edges={['top']}>
      <Header title={title} onBack={() => navigation.goBack()} onToggle={toggle} isDark={isDark} />

      {/* Progress bar */}
      <View style={[styles.progressRow, { backgroundColor: colors.background }]}>
        <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` as any, backgroundColor: colors.accent }]} />
        </View>
        <Text style={[styles.progressText, { color: colors.textSecondary }]}>{index + 1} / {cards.length}</Text>
      </View>

      {/* Badges */}
      <View style={[styles.badgeRow, { backgroundColor: colors.background }]}>
        <View style={[styles.badge, { backgroundColor: colors.successLight }]}>
          <Ionicons name="checkmark-circle" size={14} color={colors.success} />
          <Text style={[styles.badgeText, { color: colors.success }]}>{known.size} known</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: colors.accentLight }]}>
          <Ionicons name="layers-outline" size={14} color={colors.accent} />
          <Text style={[styles.badgeText, { color: colors.accent }]}>{cards.length - index - 1} left</Text>
        </View>
      </View>

      {/* Card */}
      <Animated.View style={[styles.cardWrapper, { backgroundColor: colors.background, opacity: fadeAnim, transform: [{ translateX: slideAnim }, { scale: scaleAnim }] }]}>
        <FlipCard card={card} key={index} colors={colors} index={index} total={cards.length} />
      </Animated.View>

      {/* Buttons */}
      <View style={[styles.actions, { backgroundColor: colors.background }]}>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.card, flex: 0.7 }, index === 0 && { opacity: 0.4 }]} onPress={goPrev} disabled={index === 0}>
          <Ionicons name="arrow-back" size={20} color={colors.textSecondary} />
          <Text style={{ fontSize: 14, fontWeight: '700', color: colors.textSecondary }}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.warningLight }]} onPress={() => goNext(false)}>
          <Ionicons name="refresh" size={20} color={colors.warning} />
          <Text style={{ fontSize: 14, fontWeight: '700', color: colors.warning }}>Review</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.successLight }]} onPress={() => goNext(true)}>
          <Ionicons name="checkmark" size={20} color={colors.success} />
          <Text style={{ fontSize: 14, fontWeight: '700', color: colors.success }}>Got it!</Text>
        </TouchableOpacity>
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
    paddingBottom: spacing.lg + spacing.sm,
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
    gap: spacing.sm,
  },
  backBtn:     { width: 38, height: 38, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerSub:   { fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: '600', letterSpacing: 0.5 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },
  headerIcon:  { width: 38, height: 38, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  progressRow:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  progressTrack: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill:  { height: 6, borderRadius: 3 },
  progressText:  { fontSize: 13, fontWeight: '700', minWidth: 48, textAlign: 'right' },
  badgeRow:  { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  badge:     { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  cardWrapper: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  cardTouchable: { width: CARD_W, height: CARD_H },
  card: { position: 'absolute', width: CARD_W, height: CARD_H, borderRadius: radius.xl, padding: spacing.lg, justifyContent: 'center' },
  cardLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.md },
  cardLabelText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  cardFrontText: { fontSize: 20, fontWeight: '700', lineHeight: 28, textAlign: 'center' },
  cardBackText:  { fontSize: 17, fontWeight: '500', color: '#fff', lineHeight: 26, textAlign: 'center' },
  tapHint:   { position: 'absolute', bottom: spacing.md, alignSelf: 'center', fontSize: 12 },
  actions:      { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  actionBtn:    { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: spacing.md, borderRadius: radius.md, ...cardShadow },
  flipHint:     { textAlign: 'center', fontSize: 12, paddingBottom: spacing.lg },
  doneCircle: { width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center' },
  doneEmoji:  { fontSize: 52 },
  doneBar:    { width: '80%', height: 10, borderRadius: 5, marginTop: spacing.lg, overflow: 'hidden' },
  doneBarFill: { height: 10, borderRadius: 5 },
  doneBtns:   { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  restartBtn: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  doneBtn:    { borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, justifyContent: 'center' },
});
