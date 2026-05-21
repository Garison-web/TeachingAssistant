import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useNavigation } from '@react-navigation/native';
import { cardShadow, radius, spacing } from '../theme';
import { useTheme } from '../context/ThemeContext';
import { uploadLecture } from '../services/api';

type SelectedFile = {
  uri     : string;
  name    : string;
  mimeType: string;
  size    : number | undefined;
};

type Step = { label: string; done: boolean; active: boolean };

function formatBytes(bytes: number | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ProgressSteps({ steps, colors }: { steps: Step[]; colors: any }) {
  const doneCount = steps.filter(s => s.done).length + (steps.some(s => s.active) ? 1 : 0);
  return (
    <View style={[styles.stepsCard, { backgroundColor: colors.card }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <Text style={[styles.stepsTitle, { color: colors.text }]}>Processing pipeline</Text>
        <View style={{ backgroundColor: colors.accentLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: colors.accent }}>{doneCount}/{steps.length}</Text>
        </View>
      </View>
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        return (
          <View key={i} style={{ flexDirection: 'row', gap: 12 }}>
            {/* Dot + vertical connector */}
            <View style={{ alignItems: 'center', width: 24 }}>
              <View style={{
                width: 24, height: 24, borderRadius: 12,
                backgroundColor: step.done ? '#10B981' : step.active ? colors.accent : 'transparent',
                borderWidth: step.done || step.active ? 0 : 2,
                borderColor: step.done ? '#10B981' : step.active ? colors.accent : colors.border,
                alignItems: 'center', justifyContent: 'center',
              }}>
                {step.done  && <Ionicons name="checkmark" size={13} color="#fff" />}
                {step.active && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff' }} />}
              </View>
              {!isLast && (
                <View style={{ width: 2, flex: 1, minHeight: 18, backgroundColor: step.done ? '#10B981' : colors.border }} />
              )}
            </View>
            {/* Label + active bar */}
            <View style={{ flex: 1, paddingBottom: isLast ? 0 : 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
                <Text style={[
                  styles.stepLabel,
                  { color: step.done ? '#10B981' : step.active ? colors.text : colors.textSecondary },
                  step.active && { fontWeight: '700' },
                ]}>
                  {step.label}
                </Text>
                {step.active && (
                  <View style={{ backgroundColor: colors.accentLight, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                    <Text style={{ fontSize: 9, fontWeight: '700', color: colors.accent }}>IN PROGRESS</Text>
                  </View>
                )}
                {step.done && <Text style={{ fontSize: 10, fontWeight: '700', color: '#10B981' }}>✓</Text>}
              </View>
              {step.active && (
                <View style={{ marginTop: 5, height: 4, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' }}>
                  <View style={{ height: '100%', width: '60%', backgroundColor: colors.accent, borderRadius: 4 }} />
                </View>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export default function UploadScreen() {
  const navigation = useNavigation<any>();
  const { colors, isDark, toggle } = useTheme();

  const [title, setTitle]               = useState('');
  const [file, setFile]                 = useState<SelectedFile | null>(null);
  const [processing, setProcessing]     = useState(false);
  const [currentStep, setCurrentStep]   = useState(0);
  const [readyLecture, setReadyLecture] = useState<{ id: string; title: string } | null>(null);

  const successOpacity = useRef(new Animated.Value(0)).current;
  const successScale   = useRef(new Animated.Value(0.82)).current;
  const checkScale     = useRef(new Animated.Value(0)).current;
  const btnTranslate   = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    if (!readyLecture) return;
    Animated.sequence([
      Animated.parallel([
        Animated.timing(successOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.spring(successScale,   { toValue: 1, tension: 80, friction: 9, useNativeDriver: true }),
      ]),
      Animated.spring(checkScale,    { toValue: 1, tension: 120, friction: 6, useNativeDriver: true }),
      Animated.spring(btnTranslate,  { toValue: 0, tension: 100, friction: 10, useNativeDriver: true }),
    ]).start();
  }, [readyLecture]);

  const resetForm = () => {
    setFile(null); setTitle(''); setCurrentStep(0); setReadyLecture(null);
    successOpacity.setValue(0); successScale.setValue(0.82);
    checkScale.setValue(0); btnTranslate.setValue(24);
  };

  const steps: Step[] = [
    { label: 'Uploading file',                   done: currentStep > 1, active: currentStep === 1 },
    { label: 'Transcribing audio',               done: currentStep > 2, active: currentStep === 2 },
    { label: 'Processing & creating embeddings', done: currentStep > 3, active: currentStep === 3 },
    { label: 'Lecture is ready!',                done: currentStep > 4, active: currentStep === 4 },
  ];

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['audio/*', 'video/*'], copyToCacheDirectory: true });
      if (!result.canceled && result.assets.length > 0) {
        const asset = result.assets[0];
        setFile({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? 'application/octet-stream', size: asset.size });
        if (!title) setTitle(asset.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' '));
      }
    } catch {
      Alert.alert('Error', 'Could not open file picker.');
    }
  };

  const handleProcess = async () => {
    if (!file) { Alert.alert('No file selected', 'Tap the file picker to choose an audio or video file.'); return; }
    if (!title.trim()) { Alert.alert('Missing title', 'Please enter a title for this lecture.'); return; }
    setProcessing(true); setCurrentStep(0);
    try {
      const result = await uploadLecture(file, title.trim(), (step: number) => setCurrentStep(step));
      setCurrentStep(5);
      setReadyLecture({ id: result.lecture_id, title: title.trim() });
    } catch (err: any) {
      setCurrentStep(0);
      Alert.alert('Upload Failed', err.isNetworkError
        ? 'Cannot connect to server. Make sure the backend is running on port 8000.'
        : err.message || 'Something went wrong. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const isReady   = !!file && title.trim().length > 0 && !processing && !readyLecture;
  const showSteps = currentStep > 0 && !readyLecture;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>

        {/* ── Header ──────────────────────────────────────────── */}
        <View style={{ paddingHorizontal: 24, paddingTop: 20, paddingBottom: 24, flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, color: colors.textSecondary, fontWeight: '500' }}>Add content</Text>
            <Text style={{ fontSize: 26, fontWeight: '800', color: colors.text, letterSpacing: -0.5 }}>Upload Lecture</Text>
            <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 4 }}>MP4 · MOV · MP3 · M4A · WAV</Text>
          </View>
          <TouchableOpacity
            onPress={toggle}
            style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center', marginRight: 10 }}
          >
            <Ionicons name={isDark ? 'sunny' : 'moon-outline'} size={19} color={colors.accent} />
          </TouchableOpacity>
          <TouchableOpacity
            style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', ...cardShadow }}
            onPress={pickFile}
            disabled={processing}
          >
            <Ionicons name="add" size={26} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={{ paddingHorizontal: 24 }}>

          {/* Title input */}
          <Text style={[styles.label, { color: colors.textSecondary }]}>Lecture Title</Text>
          <View style={[styles.inputCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="pencil-outline" size={18} color={colors.textSecondary} style={{ marginRight: 10 }} />
            <TextInput
              style={{ flex: 1, paddingVertical: 14, color: colors.text, fontSize: 15 }}
              placeholder="e.g. Neural Networks — Lecture 12"
              placeholderTextColor={colors.textSecondary}
              value={title}
              onChangeText={setTitle}
              editable={!processing}
              maxLength={120}
            />
          </View>

          {/* File picker */}
          <Text style={[styles.label, { color: colors.textSecondary }]}>Audio / Video File</Text>
          <TouchableOpacity
            style={[
              styles.dropZone,
              { borderColor: file ? '#22C55E' : colors.accent, backgroundColor: file ? '#F0FFF4' : colors.cardAlt },
              file && { borderStyle: 'solid' },
            ]}
            activeOpacity={0.85}
            onPress={pickFile}
            disabled={processing}
          >
            <View style={[
              styles.dropIconRing,
              { backgroundColor: file ? '#DCFCE7' : colors.accentLight, borderColor: file ? '#22C55E' : colors.accent },
            ]}>
              <Ionicons name={file ? 'checkmark-circle' : 'cloud-upload-outline'} size={34} color={file ? '#22C55E' : colors.accent} />
            </View>
            {file ? (
              <>
                <Text style={styles.dropFilename} numberOfLines={1}>{file.name}</Text>
                <Text style={[styles.dropSub, { color: colors.textSecondary }]}>{formatBytes(file.size)} · Tap to change</Text>
              </>
            ) : (
              <>
                <Text style={[styles.dropHeading, { color: colors.text }]}>Tap to browse files</Text>
                <Text style={[styles.dropSub, { color: colors.textSecondary }]}>Choose any audio or video file from your device</Text>
              </>
            )}
          </TouchableOpacity>

          {showSteps && <ProgressSteps steps={steps} colors={colors} />}

          {/* Success card */}
          {readyLecture && (
            <Animated.View style={[
              styles.successCard,
              { backgroundColor: colors.card, opacity: successOpacity, transform: [{ scale: successScale }] },
            ]}>
              <Animated.View style={[styles.successCheckWrap, { transform: [{ scale: checkScale }] }]}>
                <Ionicons name="checkmark-circle" size={56} color="#22C55E" />
              </Animated.View>
              <Text style={[styles.successTitle, { color: colors.text }]}>Lecture Ready!</Text>
              <Text style={[styles.successSub, { color: colors.textSecondary }]} numberOfLines={2}>
                "{readyLecture.title}" has been processed and is ready to chat.
              </Text>
              <Animated.View style={[{ width: '100%', gap: 10 }, { transform: [{ translateY: btnTranslate }] }]}>
                <TouchableOpacity
                  style={[styles.chatBtn, { backgroundColor: colors.accent }]}
                  activeOpacity={0.85}
                  onPress={() => {
                    const { id, title: t } = readyLecture;
                    resetForm();
                    navigation.navigate('Chat', { lectureId: id, title: t });
                  }}
                >
                  <Ionicons name="chatbubble-ellipses" size={17} color="#fff" style={{ marginRight: 7 }} />
                  <Text style={styles.chatBtnText}>Start Chat</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.uploadAnotherBtn, { borderColor: colors.accent }]}
                  activeOpacity={0.75}
                  onPress={resetForm}
                >
                  <Ionicons name="add-circle-outline" size={17} color={colors.accent} style={{ marginRight: 6 }} />
                  <Text style={[styles.uploadAnotherBtnText, { color: colors.accent }]}>Upload Another</Text>
                </TouchableOpacity>
              </Animated.View>
            </Animated.View>
          )}

          {/* Process button */}
          {!readyLecture && (
            <TouchableOpacity
              style={[styles.processBtn, { backgroundColor: isReady ? colors.accent : colors.border }]}
              activeOpacity={0.88}
              onPress={handleProcess}
              disabled={!isReady}
            >
              {processing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="sparkles-outline" size={18} color={isReady ? '#fff' : colors.textSecondary} style={{ marginRight: 8 }} />
                  <Text style={{ color: isReady ? '#fff' : colors.textSecondary, fontWeight: '700', fontSize: 16 }}>
                    Process Lecture
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {!readyLecture && (
            <Text style={{ textAlign: 'center', color: colors.textSecondary, fontSize: 13, lineHeight: 20, paddingHorizontal: 16, marginTop: 8 }}>
              Your lecture will be transcribed with Whisper AI, then embedded into a vector database so you can ask questions about it.
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.8 },
  inputCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, paddingHorizontal: 16, marginBottom: 24, borderWidth: 1, ...cardShadow },
  dropZone: { borderWidth: 2, borderStyle: 'dashed', borderRadius: 22, paddingVertical: 32, alignItems: 'center', marginBottom: 20 },
  dropIconRing: { width: 72, height: 72, borderRadius: 36, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 14, ...cardShadow },
  dropHeading:  { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  dropFilename: { fontSize: 15, fontWeight: '600', color: '#22C55E', marginBottom: 4, textAlign: 'center', paddingHorizontal: 16 },
  dropSub:      { fontSize: 13, textAlign: 'center', paddingHorizontal: 16 },
  stepsCard:    { borderRadius: 20, padding: 16, marginBottom: 20, ...cardShadow },
  stepsTitle:   { fontSize: 13, fontWeight: '700' },
  stepRow:      { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 12 },
  stepBubble:   { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stepNum:      { fontSize: 12, fontWeight: '700' },
  stepLabel:    { flex: 1, fontSize: 14, fontWeight: '500' },
  processBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 16, paddingVertical: 16, marginBottom: 14, ...cardShadow },
  successCard:  { borderRadius: 22, padding: 24, alignItems: 'center', marginBottom: 20, borderWidth: 1.5, borderColor: '#22C55E', ...cardShadow },
  successCheckWrap: { marginBottom: 12 },
  successTitle: { fontSize: 22, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  successSub:   { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 20, paddingHorizontal: 8 },
  chatBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 14, paddingVertical: 14, ...cardShadow },
  chatBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  uploadAnotherBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderRadius: 14, paddingVertical: 12 },
  uploadAnotherBtnText: { fontWeight: '700', fontSize: 14 },
});
