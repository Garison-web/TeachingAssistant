import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import TabNavigator from './TabNavigator';
import FlashcardScreen from '../screens/FlashcardScreen';
import QuizScreen from '../screens/QuizScreen';

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs"       component={TabNavigator} />
      <Stack.Screen name="Flashcards" component={FlashcardScreen} options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="Quiz"       component={QuizScreen}       options={{ animation: 'slide_from_bottom' }} />
    </Stack.Navigator>
  );
}
