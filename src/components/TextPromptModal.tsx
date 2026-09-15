import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { C } from '../theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// A small centered text-entry dialog (Android has no Alert.prompt).
export function TextPromptModal({
  visible,
  title,
  initial = '',
  placeholder,
  submitLabel = 'Save',
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  title: string;
  initial?: string;
  placeholder?: string;
  submitLabel?: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  useEffect(() => {
    if (visible) setText(initial);
  }, [visible, initial]);

  const submit = () => {
    const t = text.trim();
    if (t) onSubmit(t);
    else onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <AnimatedPressable style={styles.backdrop} entering={FadeIn.duration(140)} onPress={onCancel} />
        <Animated.View entering={ZoomIn.duration(200)} style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={placeholder}
            placeholderTextColor={C.faint}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submit}
            style={styles.input}
          />
          <View style={styles.actions}>
            <Pressable onPress={onCancel} style={styles.cancel}>
              <Text style={styles.cancelTxt}>Cancel</Text>
            </Pressable>
            <Pressable onPress={submit} style={styles.save}>
              <Text style={styles.saveTxt}>{submitLabel}</Text>
            </Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: C.sheet,
    borderRadius: 22,
    padding: 20,
    boxShadow: '0 24px 70px -20px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(255,255,255,0.07)',
  },
  title: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 14 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: C.text,
    marginBottom: 16,
  },
  actions: { flexDirection: 'row', gap: 10 },
  cancel: { flex: 1, height: 46, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  cancelTxt: { fontSize: 15, fontWeight: '600', color: C.textDim },
  save: { flex: 1, height: 46, borderRadius: 13, backgroundColor: C.accentB, alignItems: 'center', justifyContent: 'center' },
  saveTxt: { fontSize: 15, fontWeight: '700', color: '#0b0b0d' },
});
