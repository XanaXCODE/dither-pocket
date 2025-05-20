import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, ScrollView } from 'react-native';

type Props = {
  selectedDither: string | null;
  onDitherSelect: (t: string) => void;
};

const DITHER_TYPES = [
  { id: 'FloydSteinberg', name: 'Floyd-Steinberg' },
  { id: 'Ordered', name: 'Ordered' },
  { id: 'Bayer2x2', name: 'Bayer 2x2' },
  { id: 'Bayer4x4', name: 'Bayer 4x4' },
  { id: 'Halftone', name: 'Halftone' },
  { id: 'None', name: 'No Dither' }
];

export function DitherOptions({ selectedDither, onDitherSelect }: Props) {
  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {DITHER_TYPES.map((item) => {
          const isSelected = item.id === selectedDither;
          return (
            <TouchableOpacity
              key={item.id}
              style={[styles.option, isSelected && styles.optionSelected]}
              onPress={() => onDitherSelect(item.id)}
            >
              <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                {item.name}
              </Text>
              {isSelected && <View style={styles.activeDot} />}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: 5,
    paddingLeft: 5,
  },
  option: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#222',
    marginRight: 8,
    position: 'relative',
  },
  optionSelected: {
    backgroundColor: '#222',
    borderColor: '#FF9500',
    borderWidth: 1,
  },
  optionText: {
    color: '#AAA',
    fontSize: 14,
    fontWeight: '500',
  },
  optionTextSelected: {
    color: '#FF9500',
    fontWeight: 'bold',
  },
  activeDot: {
    position: 'absolute',
    width: 4,
    height: 4,
    backgroundColor: '#FF9500',
    borderRadius: 2,
    bottom: 2,
    alignSelf: 'center',
  },
});