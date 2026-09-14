import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { C } from '../theme';
import { WeekStart } from '../types';
import { dateFromKey, todayKey, weekdayLetters, weekOf } from '../utils';

type Props = {
  selectedKey: string;
  weekStart: WeekStart;
  daysWithTasks: Set<string>;
  onSelect: (key: string) => void;
  onPageWeek: (delta: number) => void;
};

export function WeekStrip({ selectedKey, weekStart, daysWithTasks, onSelect, onPageWeek }: Props) {
  const week = weekOf(selectedKey, weekStart);
  const letters = weekdayLetters(weekStart);
  const today = todayKey();

  const swipe = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-14, 14])
    .onEnd((e) => {
      'worklet';
      if (e.translationX > 40 || e.velocityX > 500) runOnJS(onPageWeek)(-1);
      else if (e.translationX < -40 || e.velocityX < -500) runOnJS(onPageWeek)(1);
    });

  return (
    <GestureDetector gesture={swipe}>
      <View style={styles.row}>
        {week.map((key, i) => {
          const selected = key === selectedKey;
          const isToday = key === today;
          const n = dateFromKey(key).getDate();
          const hasTasks = daysWithTasks.has(key);
          return (
            <Pressable
              key={key}
              onPress={() => onSelect(key)}
              style={[styles.cell, selected && styles.cellSelected]}>
              {selected && (
                <LinearGradient
                  colors={['rgba(124,124,240,0.28)', 'rgba(79,209,197,0.14)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
              )}
              <Text style={[styles.dow, { color: selected ? '#fff' : C.muted }]}>{letters[i]}</Text>
              <Text style={[styles.num, { color: selected ? '#fff' : isToday ? C.accentB : C.text }]}>
                {n}
              </Text>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: hasTasks
                      ? selected
                        ? '#fff'
                        : C.accentB
                      : 'transparent',
                  },
                ]}
              />
            </Pressable>
          );
        })}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4, marginTop: 14 },
  cell: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 7,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  cellSelected: {
    boxShadow:
      'inset 0 0 0 1px rgba(255,255,255,0.08), 0 6px 18px -8px rgba(124,124,240,0.6)',
  },
  dow: { fontSize: 11, fontWeight: '600', opacity: 0.6 },
  num: { fontSize: 16, fontWeight: '600', marginTop: 3 },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 4 },
});
