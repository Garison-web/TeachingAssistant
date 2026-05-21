import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import HomeScreen    from '../screens/HomeScreen';
import UploadScreen  from '../screens/UploadScreen';
import ChatScreen    from '../screens/ChatScreen';
import HistoryScreen from '../screens/HistoryScreen';
import { radius } from '../theme';
import { useTheme } from '../context/ThemeContext';

const Tab = createBottomTabNavigator();

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

type IconConfig = {
  active  : IoniconsName;
  inactive: IoniconsName;
  activeColor: string;
  label   : string;
};

const TABS: Record<string, IconConfig> = {
  Home:    { active: 'home',                inactive: 'home-outline',                activeColor: '#A78BFA', label: 'Home'    },
  Upload:  { active: 'cloud-upload',        inactive: 'cloud-upload-outline',        activeColor: '#FB923C', label: 'Upload'  },
  Chat:    { active: 'chatbubble-ellipses', inactive: 'chatbubble-ellipses-outline', activeColor: '#34D399', label: 'Chat'    },
  History: { active: 'time',               inactive: 'time-outline',                activeColor: '#FBBF24', label: 'History' },
};

function AnimatedTabIcon({ name, focused }: { name: string; focused: boolean }) {
  const cfg        = TABS[name] ?? TABS.Home;
  const scale      = useRef(new Animated.Value(1)).current;
  const pillScale  = useRef(new Animated.Value(focused ? 1 : 0)).current;
  const pillOpacity = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    if (focused) {
      Animated.sequence([
        Animated.spring(scale, { toValue: 1.25, tension: 300, friction: 7, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1.08, tension: 300, friction: 8, useNativeDriver: true }),
      ]).start();
      Animated.parallel([
        Animated.spring(pillScale,   { toValue: 1, tension: 200, friction: 12, useNativeDriver: true }),
        Animated.timing(pillOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.spring(scale, { toValue: 1, tension: 200, friction: 10, useNativeDriver: true }).start();
      Animated.parallel([
        Animated.spring(pillScale,   { toValue: 0.5, tension: 200, friction: 12, useNativeDriver: true }),
        Animated.timing(pillOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
      ]).start();
    }
  }, [focused]);

  const iconColor = focused ? cfg.activeColor : 'rgba(255,255,255,0.38)';

  return (
    <View style={styles.iconWrap}>
      <Animated.View style={[styles.pill, { backgroundColor: `${cfg.activeColor}22`, opacity: pillOpacity, transform: [{ scaleX: pillScale }] }]} />
      <Animated.View style={{ transform: [{ scale }] }}>
        <Ionicons name={focused ? cfg.active : cfg.inactive} size={22} color={iconColor} />
      </Animated.View>
      {focused && <View style={[styles.dot, { backgroundColor: cfg.activeColor }]} />}
    </View>
  );
}

export default function TabNavigator() {
  const { colors } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: [styles.tabBar, { backgroundColor: colors.tabBar }],
        tabBarShowLabel: true,
        tabBarActiveTintColor:   TABS[route.name]?.activeColor ?? '#A78BFA',
        tabBarInactiveTintColor: 'rgba(255,255,255,0.38)',
        tabBarLabelStyle: styles.tabLabel,
        tabBarIcon: ({ focused }) => <AnimatedTabIcon name={route.name} focused={focused} />,
      })}
    >
      <Tab.Screen name="Home"    component={HomeScreen}    />
      <Tab.Screen name="Upload"  component={UploadScreen}  />
      <Tab.Screen name="Chat"    component={ChatScreen}    />
      <Tab.Screen name="History" component={HistoryScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    borderTopWidth: 0,
    height: 72,
    paddingBottom: 10,
    paddingTop: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 20,
  },
  tabLabel: { fontSize: 11, fontWeight: '600' },
  iconWrap: { width: 54, height: 36, alignItems: 'center', justifyContent: 'center' },
  pill: { position: 'absolute', width: 54, height: 34, borderRadius: radius.full },
  dot:  { position: 'absolute', bottom: -1, width: 4, height: 4, borderRadius: 2 },
});
