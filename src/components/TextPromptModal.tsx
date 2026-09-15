import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { C } from '../theme';
import { CenterPopup } from './Overlay';
import { Tappable } from './anim';

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

  // Keep last labels during the close animation to avoid a flash.
  const labels = useRef({ title, submitLabel });
  if (visible) labels.current = { title, submitLabel };

  const submit = () => {
    const t = text.trim();
    if (t) onSubmit(t);
    else onCancel();
  };

  return (
    <CenterPopup open={visible} onClose={onCancel}>
      <Text style={styles.title}>{labels.current.title}</Text>
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
        <Tappable onPress={onCancel} style={styles.cancel}>
          <Text style={styles.cancelTxt}>Cancel</Text>
        </Tappable>
        <Tappable onPress={submit} style={styles.save}>
          <Text style={styles.saveTxt}>{labels.current.submitLabel}</Text>
        </Tappable>
      </View>
    </CenterPopup>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 14 },
  input: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: C.text, marginBottom: 16 },
  actions: { flexDirection: 'row', gap: 10 },
  cancel: { flex: 1, height: 46, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  cancelTxt: { fontSize: 15, fontWeight: '600', color: C.textDim },
  save: { flex: 1, height: 46, borderRadius: 13, backgroundColor: C.accentB, alignItems: 'center', justifyContent: 'center' },
  saveTxt: { fontSize: 15, fontWeight: '700', color: '#0b0b0d' },
});
