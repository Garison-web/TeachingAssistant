import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationType = 'quiz' | 'flashcard' | 'upload' | 'info';

export type AppNotification = {
  id        : string;
  title     : string;
  body      : string;
  timestamp : Date;
  read      : boolean;
  type      : NotificationType;
  lectureId ?: string;
  lectureTitle?: string;
};

interface NotificationCtx {
  notifications : AppNotification[];
  unreadCount   : number;
  addNotification: (n: Omit<AppNotification, 'id' | 'timestamp' | 'read'>) => void;
  markAllRead   : () => void;
  clearAll      : () => void;
}

const NotificationContext = createContext<NotificationCtx>({
  notifications  : [],
  unreadCount    : 0,
  addNotification: () => {},
  markAllRead    : () => {},
  clearAll       : () => {},
});

// ─── Icon map ────────────────────────────────────────────────────────────────

const ICON_MAP: Record<NotificationType, keyof typeof Ionicons.glyphMap> = {
  quiz     : 'school-outline',
  flashcard: 'albums-outline',
  upload   : 'checkmark-circle-outline',
  info     : 'information-circle-outline',
};

// ─── Toast ────────────────────────────────────────────────────────────────────

function NotificationToast({
  notification,
  onDismiss,
}: {
  notification: AppNotification;
  onDismiss   : () => void;
}) {
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, tension: 80, friction: 12, useNativeDriver: true }),
      Animated.timing(opacity,    { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(translateY, { toValue: -120, duration: 320, useNativeDriver: true }),
        Animated.timing(opacity,    { toValue: 0,    duration: 280, useNativeDriver: true }),
      ]).start(onDismiss);
    }, 3800);

    return () => clearTimeout(timer);
  }, []);

  return (
    <Animated.View style={[toastStyles.wrap, { transform: [{ translateY }], opacity }]}>
      <TouchableOpacity style={toastStyles.card} activeOpacity={0.9} onPress={onDismiss}>
        <View style={toastStyles.iconBox}>
          <Ionicons name={ICON_MAP[notification.type]} size={20} color="#fff" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={toastStyles.title} numberOfLines={1}>{notification.title}</Text>
          <Text style={toastStyles.body}  numberOfLines={1}>{notification.body}</Text>
        </View>
        <Ionicons name="close" size={16} color="rgba(255,255,255,0.6)" />
      </TouchableOpacity>
    </Animated.View>
  );
}

const toastStyles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 48,
    left: 14, right: 14,
    zIndex: 9999,
  },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#18162A',
    borderRadius: 20, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35, shadowRadius: 24, elevation: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)',
  },
  iconBox: {
    width: 40, height: 40, borderRadius: 13,
    backgroundColor: '#7C3AED',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: '#fff', fontSize: 13, fontWeight: '700', marginBottom: 2 },
  body : { color: 'rgba(255,255,255,0.65)', fontSize: 12 },
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [activeToast, setActiveToast]     = useState<AppNotification | null>(null);

  const addNotification = useCallback(
    (n: Omit<AppNotification, 'id' | 'timestamp' | 'read'>) => {
      const entry: AppNotification = {
        ...n,
        id       : `n_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        timestamp: new Date(),
        read     : false,
      };
      setNotifications(prev => [entry, ...prev]);
      setActiveToast(entry);
    },
    [],
  );

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => setNotifications([]), []);

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, addNotification, markAllRead, clearAll }}>
      {children}
      {activeToast && (
        <NotificationToast
          key={activeToast.id}
          notification={activeToast}
          onDismiss={() => setActiveToast(null)}
        />
      )}
    </NotificationContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationContext);
