import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { C } from '../theme';
import { Tappable } from './anim';

// HSL (h in degrees, s/l in 0..100) → #rrggbb.
export function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = lN - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const HUES = [0, 20, 40, 55, 90, 140, 165, 185, 205, 225, 260, 290, 320, 345];
const SHADES: [number, number][] = [
  [80, 72],
  [72, 60],
  [66, 48],
  [58, 36],
];
// Full-spectrum grid (+ a neutral column) for picking any color.
const SWATCHES: string[] = (() => {
  const out: string[] = [];
  for (const [s, l] of SHADES) {
    for (const h of HUES) out.push(hslToHex(h, s, l));
  }
  out.push('#ffffff', '#c8c8ce', '#8a8a92', '#5b5b63', '#2a2b2f', '#0b0b0d');
  return out;
})();

const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

// A spectrum grid + hex field. `onPick` fires live as a swatch/valid hex is chosen.
export function CustomColorGrid({ value, onPick }: { value: string; onPick: (hex: string) => void }) {
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  return (
    <View>
      <View style={[styles.preview, { backgroundColor: isHex(hex) ? hex : value }]} />
      <View style={styles.grid}>
        {SWATCHES.map((c) => {
          const on = c.toLowerCase() === hex.toLowerCase();
          return (
            <Tappable
              key={c}
              onPress={() => {
                setHex(c);
                onPick(c);
              }}
              style={[styles.swatch, { backgroundColor: c }, on && styles.swatchOn]}
            />
          );
        })}
      </View>
      <View style={styles.hexRow}>
        <Text style={styles.hexLabel}>HEX</Text>
        <TextInput
          value={hex}
          onChangeText={(t) => {
            const v = t.startsWith('#') ? t : `#${t}`;
            setHex(v);
            if (isHex(v)) onPick(v);
          }}
          autoCapitalize="none"
          placeholder="#7c7cf0"
          placeholderTextColor={C.faint}
          style={styles.hexInput}
        />
      </View>
    </View>
  );
}

// Free-text icon entry: up to two characters or a pasted emoji.
export function CustomIconInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.iconWrap}>
      <View style={styles.iconPreview}>
        <Text style={styles.iconPreviewTxt}>{value || '·'}</Text>
      </View>
      <TextInput
        value={value}
        onChangeText={(t) => onChange([...t].slice(0, 2).join(''))}
        autoFocus
        placeholder="🙂 or AB"
        placeholderTextColor={C.faint}
        style={styles.iconInput}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { height: 44, borderRadius: 12, marginBottom: 14, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  swatch: { width: 30, height: 30, borderRadius: 15 },
  swatchOn: { boxShadow: `0 0 0 2px ${C.sheet}, 0 0 0 4px #fff` },
  hexRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  hexLabel: { fontSize: 12, fontWeight: '700', color: C.muted },
  hexInput: { flex: 1, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, color: C.text, fontSize: 15, fontVariant: ['tabular-nums'] },
  iconWrap: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconPreview: { width: 56, height: 56, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  iconPreviewTxt: { fontSize: 26 },
  iconInput: { flex: 1, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: C.text, fontSize: 18 },
});
