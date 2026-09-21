import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleProp, StyleSheet, useWindowDimensions, View, ViewStyle } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  FadeIn,
  FadeOut,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Bottom sheet with a spring open/close driven by one shared value, so it can
// be dragged down by its handle to dismiss. Extends under the nav bar
// (navigationBarTranslucent) so there is never a gap at the screen bottom.
export function BottomSheet({
  open,
  onClose,
  children,
  height,
  avoidKeyboard,
  contentStyle,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  height?: number | `${number}%`;
  avoidKeyboard?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const [mounted, setMounted] = useState(open);
  const ty = useSharedValue(winH);

  useEffect(() => {
    if (open) {
      setMounted(true);
      ty.value = withSpring(0, { damping: 24, stiffness: 240, mass: 0.9 });
    } else {
      ty.value = withTiming(winH, { duration: 250, easing: Easing.in(Easing.cubic) }, (f) => {
        'worklet';
        if (f) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, winH]);

  const drag = Gesture.Pan()
    .onUpdate((e) => {
      'worklet';
      ty.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      'worklet';
      if (e.translationY > 120 || e.velocityY > 900) {
        runOnJS(onClose)();
      } else {
        ty.value = withSpring(0, { damping: 24, stiffness: 260 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: interpolate(ty.value, [0, winH], [1, 0], Extrapolation.CLAMP) }));

  if (!mounted) return <Modal visible={false} transparent />;

  const body = (
    <View style={styles.fillEnd} pointerEvents="box-none">
      <AnimatedPressable style={[styles.backdrop, backdropStyle]} onPress={onClose} />
      <Animated.View
        style={[styles.sheet, { paddingBottom: insets.bottom + 24 }, height != null ? { height } : null, contentStyle, sheetStyle]}>
        <GestureDetector gesture={drag}>
          <View style={styles.handleZone}>
            <View style={styles.handle} />
          </View>
        </GestureDetector>
        {children}
      </Animated.View>
    </View>
  );

  return (
    <Modal visible transparent statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.flex}>
        {avoidKeyboard ? (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
            {body}
          </KeyboardAvoidingView>
        ) : (
          body
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

// Centered popup with zoom-in / zoom-out.
export function CenterPopup({
  open,
  onClose,
  children,
  cardStyle,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  cardStyle?: StyleProp<ViewStyle>;
}) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), 320);
    return () => clearTimeout(t);
  }, [open]);
  if (!mounted) return <Modal visible={false} transparent />;

  return (
    <Modal visible transparent statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.flex}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fillCenter}>
          {open ? (
            <>
              <AnimatedPressable style={styles.backdrop} entering={FadeIn.duration(160)} exiting={FadeOut.duration(180)} onPress={onClose} />
              <Animated.View
                entering={ZoomIn.duration(220).easing(Easing.out(Easing.cubic))}
                exiting={ZoomOut.duration(170).withCallback((f) => {
                  'worklet';
                  if (f) runOnJS(setMounted)(false);
                })}
                style={[styles.card, cardStyle]}>
                {children}
              </Animated.View>
            </>
          ) : null}
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  fillEnd: { flex: 1, justifyContent: 'flex-end' },
  fillCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 26 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: C.sheet,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 6,
    paddingBottom: 30,
    boxShadow: '0 -20px 60px -20px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(255,255,255,0.06)',
  },
  handleZone: { alignSelf: 'stretch', alignItems: 'center', paddingTop: 8, paddingBottom: 14 },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.18)' },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: C.sheet,
    borderRadius: 22,
    padding: 20,
    boxShadow: '0 24px 70px -20px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(255,255,255,0.07)',
  },
});
