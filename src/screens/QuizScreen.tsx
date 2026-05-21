import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  ScrollView,
  StatusBar,
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
import { generateQuiz } from '../services/api';

type Question = {
  question   : string;
  options    : string[];
  correct    : number;
  explanation: string;
};

const OPTION_LABELS = ['A', 'B', 'C', 'D'];

function ResultBar({ score, total, colors }: { score: number; total: number; colors: any }) {
  const pct    = Math.round((score / total) * 100);
  const width  = useRef(new Animated.Value(0)).current;
  const scale  = useRef(new Animated.Value(0.8)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.spring(scale,   { toValue: 1, tension: 70, friction: 8, useNativeDriver: true }),
      ]),
      Animated.timing(width, { toValue: pct, duration: 800, useNativeDriver: false }),
    ]).start();
  }, []);

  const grade = pct >= 80 ? { label: 'Excellent!',    color: colors.success, icon: 'trophy' as const }
              : pct >= 60 ? { label: 'Good job!',     color: colors.warning, icon: 'thumbs-up' as const }
              :              { label: 'Keep studying', color: colors.error,   icon: 'book' as const };

  return (
    <Animated.View style={[styles.resultCard, { backgroundColor: colors.card, opacity, transform: [{ scale }] }]}>
      <View style={[styles.resultIconWrap, { backgroundColor: `${grade.color}22` }]}>
        <Ionicons name={grade.icon} size={40} color={grade.color} />
      </View>
      <Text style={[styles.resultGrade, { color: grade.color }]}>{grade.label}</Text>
      <Text style={[styles.resultScore, { color: colors.textSecondary }]}>{score} / {total} correct</Text>
      <View style={[styles.resultBarTrack, { backgroundColor: colors.border }]}>
        <Animated.View style={[styles.resultBarFill, { backgroundColor: grade.color, width: width.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }]} />
      </View>
      <Text style={[styles.resultPct, { color: colors.text }]}>{pct}%</Text>
    </Animated.View>
  );
}

function QuizHeader({ title, onBack, onToggle, isDark }: { title: string; onBack: () => void; onToggle: () => void; isDark: boolean }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.backBtn}>
        <Ionicons name="arrow-back" size={22} color="#fff" />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerSub}>Quiz</Text>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      </View>
      <TouchableOpacity onPress={onToggle} style={[styles.backBtn, { marginRight: 8 }]}>
        <Ionicons name={isDark ? 'sunny' : 'moon-outline'} size={18} color="#fff" />
      </TouchableOpacity>
      <View style={styles.headerIcon}>
        <Ionicons name="school-outline" size={22} color="rgba(255,255,255,0.9)" />
      </View>
    </View>
  );
}

export default function QuizScreen() {
  const navigation = useNavigation<any>();
  const route      = useRoute<any>();
  const { colors, isDark, toggle } = useTheme();
  const { addNotification } = useNotifications();
  const { lectureId, title } = (route.params ?? {}) as { lectureId: string; title: string };

  const [questions,    setQuestions]    = useState<Question[]>([]);
  const [qIndex,       setQIndex]       = useState(0);
  const [selected,     setSelected]     = useState<number | null>(null);
  const [answered,     setAnswered]     = useState(false);
  const [answers,      setAnswers]      = useState<(number | null)[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [showResults,  setShowResults]  = useState(false);

  const slideAnim   = useRef(new Animated.Value(0)).current;
  const fadeAnim    = useRef(new Animated.Value(1)).current;
  const optionAnims = useRef([0, 1, 2, 3].map(() => new Animated.Value(0))).current;
  const shakeAnim   = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    (async () => {
      try {
        const res = await generateQuiz(lectureId);
        setQuestions(res.questions);
        setAnswers(new Array(res.questions.length).fill(null));
        addNotification({
          type        : 'quiz',
          title       : 'Quiz ready!',
          body        : `Your ${res.questions.length}-question quiz for "${title}" is ready to start.`,
          lectureId,
          lectureTitle: title,
        });
      } catch (e: any) {
        setError(e.message || 'Failed to generate quiz');
      } finally {
        setLoading(false);
      }
    })();
  }, [lectureId]);

  useEffect(() => {
    optionAnims.forEach(a => a.setValue(0));
    Animated.parallel(
      optionAnims.map((a, i) => Animated.spring(a, { toValue: 1, tension: 80, friction: 9, delay: i * 60, useNativeDriver: true }))
    ).start();
  }, [qIndex]);

  const shake = useCallback(() => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 8,  duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6,  duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0,  duration: 60, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  const handleSelect = useCallback((optIndex: number) => {
    if (answered) return;
    setSelected(optIndex);
    setAnswered(true);
    const newAnswers = [...answers];
    newAnswers[qIndex] = optIndex;
    setAnswers(newAnswers);
    if (optIndex !== questions[qIndex].correct) shake();
  }, [answered, answers, qIndex, questions, shake]);

  const goNext = useCallback(() => {
    if (qIndex >= questions.length - 1) { setShowResults(true); return; }
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: -400, duration: 220, useNativeDriver: true }),
      Animated.timing(fadeAnim,  { toValue: 0,    duration: 180, useNativeDriver: true }),
    ]).start(() => {
      slideAnim.setValue(400);
      fadeAnim.setValue(0);
      setQIndex(i => i + 1);
      setSelected(null);
      setAnswered(false);
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, tension: 100, friction: 12, useNativeDriver: true }),
        Animated.timing(fadeAnim,  { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    });
  }, [qIndex, questions.length, slideAnim, fadeAnim]);

  const restart = useCallback(() => {
    setQIndex(0); setSelected(null); setAnswered(false);
    setAnswers(new Array(questions.length).fill(null));
    setShowResults(false);
    slideAnim.setValue(0); fadeAnim.setValue(1);
  }, [questions.length, slideAnim, fadeAnim]);

  const accentBg = colors.accent;

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: accentBg }]} edges={['top']}>
        <QuizHeader title={title} onBack={() => navigation.goBack()} onToggle={toggle} isDark={isDark} />
        <View style={[styles.center, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={{ marginTop: spacing.md, textAlign: 'center', fontSize: 14, color: colors.textSecondary }}>
            Generating quiz with AI…{'\n'}this takes a few seconds
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: accentBg }]} edges={['top']}>
        <QuizHeader title={title} onBack={() => navigation.goBack()} onToggle={toggle} isDark={isDark} />
        <View style={[styles.center, { backgroundColor: colors.background }]}>
          <Ionicons name="warning-outline" size={48} color={colors.error} />
          <Text style={{ marginTop: spacing.md, fontSize: 16, fontWeight: '700', color: colors.text, textAlign: 'center' }}>Could not generate quiz</Text>
          <Text style={{ marginTop: 6, fontSize: 13, color: colors.textSecondary, textAlign: 'center' }}>{error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (showResults) {
    const score = answers.filter((a, i) => a === questions[i].correct).length;
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: accentBg }]} edges={['top']}>
        <QuizHeader title={title} onBack={() => navigation.goBack()} onToggle={toggle} isDark={isDark} />
        <ScrollView contentContainerStyle={[styles.resultsContainer, { backgroundColor: colors.background }]} showsVerticalScrollIndicator={false}>
          <ResultBar score={score} total={questions.length} colors={colors} />

          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm }}>Review Answers</Text>

          {questions.map((q, i) => {
            const correct = answers[i] === q.correct;
            const userAns = answers[i];
            return (
              <View key={i} style={[styles.reviewCard, { backgroundColor: colors.card, borderLeftColor: correct ? colors.success : colors.error }]}>
                <View style={styles.reviewHeader}>
                  <Ionicons name={correct ? 'checkmark-circle' : 'close-circle'} size={20} color={correct ? colors.success : colors.error} />
                  <Text style={[styles.reviewQ, { color: colors.text }]} numberOfLines={3}>{q.question}</Text>
                </View>
                {!correct && userAns !== null && (
                  <Text style={[styles.reviewWrong, { color: colors.error }]}>Your answer: {OPTION_LABELS[userAns]}. {q.options[userAns]}</Text>
                )}
                <Text style={[styles.reviewCorrect, { color: colors.success }]}>Correct: {OPTION_LABELS[q.correct]}. {q.options[q.correct]}</Text>
                <Text style={[styles.reviewExplanation, { color: colors.textSecondary }]}>{q.explanation}</Text>
              </View>
            );
          })}

          <View style={styles.resultBtns}>
            <TouchableOpacity style={[styles.retryBtn, { borderColor: colors.accent }]} onPress={restart}>
              <Ionicons name="refresh" size={18} color={colors.accent} style={{ marginRight: 6 }} />
              <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 15 }}>Retake Quiz</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.backToLectureBtn, { backgroundColor: colors.accent }]} onPress={() => navigation.goBack()}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Back to Lecture</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const q        = questions[qIndex];
  const progress = (qIndex + 1) / questions.length;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: accentBg }]} edges={['top']}>
      <QuizHeader title={title} onBack={() => navigation.goBack()} onToggle={toggle} isDark={isDark} />

      {/* Progress */}
      <View style={[styles.progressRow, { backgroundColor: colors.background }]}>
        <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` as any, backgroundColor: colors.accent }]} />
        </View>
        <Text style={[styles.progressText, { color: colors.textSecondary }]}>Q{qIndex + 1}/{questions.length}</Text>
      </View>

      {/* Live stats strip */}
      {(() => {
        const answered_count = answers.filter(a => a !== null).length;
        const correct_count  = answers.filter((a, i) => a !== null && a === questions[i]?.correct).length;
        const wrong_count    = answered_count - correct_count;
        const pct = answered_count > 0 ? Math.round((correct_count / answered_count) * 100) : null;
        return (
          <View style={[styles.statsStrip, { backgroundColor: colors.background }]}>
            <View style={[styles.statChip, { backgroundColor: colors.successLight }]}>
              <Ionicons name="checkmark-circle" size={14} color={colors.success} />
              <Text style={[styles.statChipText, { color: colors.success }]}>{correct_count} correct</Text>
            </View>
            <View style={[styles.statChip, { backgroundColor: colors.errorLight }]}>
              <Ionicons name="close-circle" size={14} color={colors.error} />
              <Text style={[styles.statChipText, { color: colors.error }]}>{wrong_count} wrong</Text>
            </View>
            {pct !== null && (
              <View style={[styles.statChip, { backgroundColor: colors.accentLight, marginLeft: 'auto' as any }]}>
                <Text style={[styles.statChipText, { color: colors.accent, fontWeight: '800' }]}>{pct}%</Text>
              </View>
            )}
          </View>
        );
      })()}

      <Animated.View
        style={[
          styles.questionContainer,
          { backgroundColor: colors.background, opacity: fadeAnim, transform: [{ translateX: Animated.add(slideAnim, shakeAnim) }] },
        ]}
      >
        {/* Question card */}
        <View style={[styles.questionCard, { backgroundColor: colors.card }]}>
          <View style={[styles.qNumChip, { backgroundColor: colors.accentLight }]}>
            <Text style={[styles.qNumText, { color: colors.accent }]}>Question {qIndex + 1}</Text>
          </View>
          <Text style={[styles.questionText, { color: colors.text }]}>{q.question}</Text>
        </View>

        {/* Options */}
        <View style={styles.optionsContainer}>
          {q.options.map((opt, i) => {
            const isSelected  = selected === i;
            const isCorrect   = i === q.correct;
            const showCorrect = answered && isCorrect;
            const showWrong   = answered && isSelected && !isCorrect;

            let bg     = colors.card;
            let border = colors.border;
            let textC  = colors.text;
            if (showCorrect) { bg = colors.successLight; border = colors.success; textC = colors.success; }
            if (showWrong)   { bg = colors.errorLight;   border = colors.error;   textC = colors.error; }

            let labelBg   = colors.accentLight;
            let labelText = colors.accent;
            if (answered && isCorrect)  { labelBg = colors.success; labelText = '#fff'; }
            if (answered && isSelected && !isCorrect) { labelBg = colors.error; labelText = '#fff'; }

            return (
              <Animated.View key={i} style={{ opacity: optionAnims[i], transform: [{ translateX: optionAnims[i].interpolate({ inputRange: [0, 1], outputRange: [30, 0] }) }] }}>
                <TouchableOpacity
                  style={[styles.option, { backgroundColor: bg, borderColor: border }]}
                  onPress={() => handleSelect(i)}
                  disabled={answered}
                  activeOpacity={0.85}
                >
                  <View style={[styles.optionLabel, { backgroundColor: labelBg }]}>
                    <Text style={[styles.optionLabelText, { color: labelText }]}>{OPTION_LABELS[i]}</Text>
                  </View>
                  <Text style={[styles.optionText, { color: textC, flex: 1 }]}>{opt}</Text>
                  {showCorrect && <Ionicons name="checkmark-circle" size={20} color={colors.success} />}
                  {showWrong   && <Ionicons name="close-circle"     size={20} color={colors.error} />}
                </TouchableOpacity>
              </Animated.View>
            );
          })}
        </View>

        {/* Explanation */}
        {answered && (
          <View style={[styles.explanationBox, { backgroundColor: colors.card, borderLeftColor: selected === q.correct ? colors.success : colors.error }]}>
            <Text style={[styles.explanationTitle, { color: colors.text }]}>
              {selected === q.correct ? '✓ Correct!' : '✗ Incorrect'}
            </Text>
            <Text style={[styles.explanationText, { color: colors.textSecondary }]}>{q.explanation}</Text>
          </View>
        )}
      </Animated.View>

      {answered && (
        <View style={[styles.nextRow, { backgroundColor: colors.background }]}>
          <TouchableOpacity style={[styles.nextBtn, { backgroundColor: colors.accent }]} onPress={goNext}>
            <Text style={styles.nextBtnText}>{qIndex >= questions.length - 1 ? 'See Results' : 'Next Question'}</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </View>
      )}
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
  progressRow:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs, gap: spacing.sm },
  progressTrack: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill:  { height: 6, borderRadius: 3 },
  progressText:  { fontSize: 13, fontWeight: '700', minWidth: 48, textAlign: 'right' },
  statsStrip:    { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  statChip:      { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  statChipText:  { fontSize: 12, fontWeight: '700' },
  questionContainer: { flex: 1 },
  questionCard: { marginHorizontal: spacing.lg, marginTop: spacing.sm, borderRadius: radius.lg, padding: spacing.lg, ...cardShadow },
  qNumChip: { borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 3, alignSelf: 'flex-start', marginBottom: spacing.sm },
  qNumText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  questionText: { fontSize: 18, fontWeight: '700', lineHeight: 26 },
  optionsContainer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, padding: spacing.md, borderWidth: 2, ...cardShadow },
  optionLabel: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  optionLabelText: { fontSize: 14, fontWeight: '800' },
  optionText: { fontSize: 15, lineHeight: 22 },
  explanationBox: { marginHorizontal: spacing.lg, marginTop: spacing.md, borderRadius: radius.md, padding: spacing.md, borderLeftWidth: 4, ...cardShadow },
  explanationTitle: { fontSize: 14, fontWeight: '800', marginBottom: 4 },
  explanationText:  { fontSize: 14, lineHeight: 20 },
  nextRow: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  nextBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, paddingVertical: spacing.md, ...cardShadow },
  nextBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  resultsContainer: { padding: spacing.lg, paddingBottom: 48 },
  resultCard: { alignItems: 'center', borderRadius: radius.xl, padding: spacing.xl, ...cardShadow },
  resultIconWrap: { width: 90, height: 90, borderRadius: 45, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  resultGrade:    { fontSize: 24, fontWeight: '800', marginBottom: spacing.xs },
  resultScore:    { fontSize: 16, marginBottom: spacing.md },
  resultBarTrack: { width: '80%', height: 10, borderRadius: 5, overflow: 'hidden', marginBottom: spacing.xs },
  resultBarFill:  { height: 10, borderRadius: 5 },
  resultPct:      { fontSize: 28, fontWeight: '900' },
  reviewCard: { borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderLeftWidth: 4, ...cardShadow },
  reviewHeader:      { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginBottom: spacing.xs },
  reviewQ:           { flex: 1, fontSize: 14, fontWeight: '700' },
  reviewWrong:       { fontSize: 13, marginBottom: 2 },
  reviewCorrect:     { fontSize: 13, fontWeight: '600', marginBottom: 4 },
  reviewExplanation: { fontSize: 13, lineHeight: 19 },
  resultBtns: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.xl },
  retryBtn:   { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderRadius: radius.md, paddingVertical: spacing.md },
  backToLectureBtn: { flex: 1, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', justifyContent: 'center' },
});
