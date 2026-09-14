import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';

let counter = 0;

// Diagonal repeating-stripe fill, reproducing the prototype's
// repeating-linear-gradient(45deg, color 0 9px, transparent 9px 18px).
// Clipped to its parent via an overflow-hidden rounded wrapper.
export function Hatch({
  color,
  opacity = 1,
  radius = 13,
  style,
  children,
}: {
  color: string;
  opacity?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const id = React.useMemo(() => `hatch${counter++}`, []);
  return (
    <View style={[styles.wrap, { borderRadius: radius }, style]}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <Pattern
            id={id}
            width={18}
            height={18}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)">
            <Rect width={9} height={18} fill={color} opacity={opacity} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
