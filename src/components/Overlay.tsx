import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  runOnJS,
  SlideInDown,
  SlideOutDown,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Bottom sheet with springy slide-in AND slide-out. The Modal stays mounted
// until the exit animation finishes, so closing feels smooth instead of a cut.
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
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    // Safety net: unmount after the exit even if the animation callback misfires.
    const t = setTimeout(() => setMounted(false), 400);
    return () => clearTimeout(t);
  }, [open]);
  if (!mounted) return <Modal visible={false} transparent />;

  const inner = open ? (
    <>
      <AnimatedPressable style={styles.backdrop} entering={FadeIn.duration(200)} exiting={FadeOut.duration(220)} onPress={onClose} />
      <Animated.View
        entering={SlideInDown.duration(340).easing(Easing.out(Easing.cubic))}
        exiting={SlideOutDown.duration(260).withCallback((f) => {
          'worklet';
          if (f) runOnJS(setMounted)(false);
        })}
        style={[styles.sheet, { paddingBottom: insets.bottom + 24 }, height != null ? { height } : null, contentStyle]}>
        <View style={styles.handle} />
        {children}
      </Animated.View>
    </>
  ) : null;

  return (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={onClose}>
      {avoidKeyboard ? (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fillEnd}>
          {inner}
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.fillEnd}>{inner}</View>
      )}
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
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={onClose}>
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
    </Modal>
  );
}

const styles = StyleSheet.create({
  fillEnd: { flex: 1, justifyContent: 'flex-end' },
  fillCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 26 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: C.sheet,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 30,
    boxShadow: '0 -20px 60px -20px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(255,255,255,0.06)',
  },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.16)', alignSelf: 'center', marginBottom: 16 },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: C.sheet,
    borderRadius: 22,
    padding: 20,
    boxShadow: '0 24px 70px -20px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(255,255,255,0.07)',
  },
});
