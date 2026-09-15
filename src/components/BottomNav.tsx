import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../theme';
import { Tappable } from './anim';

export type Tab = 'today' | 'todo';

export function BottomNav({ tab, onTab, onAdd }: { tab: Tab; onTab: (t: Tab) => void; onAdd: () => void }) {
  const insets = useSafeAreaInsets();
  const barBottom = Math.max(insets.bottom, 10) + 6;
  const fabBottom = barBottom + 22;

  return (
    <View style={styles.root}>
      <View style={[styles.bar, { bottom: barBottom }]}>
        <NavItem icon="today-outline" iconOn="today" label="Today" active={tab === 'today'} onPress={() => onTab('today')} />
        <View style={{ width: 60 }} />
        <NavItem icon="checkbox-outline" iconOn="checkbox" label="To-do" active={tab === 'todo'} onPress={() => onTab('todo')} />
      </View>

      <Tappable style={[styles.fab, { bottom: fabBottom }]} onPress={onAdd} hitSlop={8} scaleTo={0.9}>
        <LinearGradient colors={['#33343a', '#17181c']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.fabGrad}>
          <Ionicons name="add" size={30} color="#fff" />
        </LinearGradient>
      </Tappable>
    </View>
  );
}

function NavItem({
  icon,
  iconOn,
  label,
  active,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconOn: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const s = useSharedValue(1);
  useEffect(() => {
    s.value = withSpring(active ? 1.14 : 1, { mass: 0.5, damping: 10, stiffness: 220 });
  }, [active, s]);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Tappable style={styles.item} onPress={onPress} hitSlop={10}>
      <Animated.View style={aStyle}>
        <Ionicons name={active ? iconOn : icon} size={20} color={active ? C.text : C.faint} />
      </Animated.View>
      <Text style={[styles.itemTxt, { color: active ? C.text : C.faint }]}>{label}</Text>
    </Tappable>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, pointerEvents: 'box-none' },
  bar: {
    position: 'absolute',
    left: 18,
    right: 18,
    height: 64,
    borderRadius: 24,
    backgroundColor: 'rgba(20,21,24,0.94)',
    boxShadow: '0 0 0 1px rgba(255,255,255,0.07), 0 18px 44px -14px rgba(0,0,0,0.85)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 44,
  },
  item: { alignItems: 'center', gap: 3, width: 54 },
  itemTxt: { fontSize: 10, fontWeight: '600' },
  fab: {
    position: 'absolute',
    left: '50%',
    marginLeft: -30,
    width: 60,
    height: 60,
    borderRadius: 30,
    boxShadow: '0 0 0 1px rgba(255,255,255,0.1), 0 0 26px -2px rgba(124,124,240,0.75), 0 0 46px -6px rgba(79,209,197,0.5), 0 14px 30px -8px rgba(0,0,0,0.85)',
  },
  fabGrad: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
});
