import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View, FlatList} from 'react-native';

export type MenuOption = 'Crop' | 'Dither' | 'Tamanho' | 'Brilho';


type Props = {
  selectedOption: MenuOption | null;
  onOptionSelect: (opt: MenuOption) => void;
};

const OPTIONS: MenuOption[] = ['Crop', 'Dither', 'Tamanho', 'Brilho'];

export function EditMenu({selectedOption, onOptionSelect}: Props) {
  return (
    <View style={styles.container}>
      <FlatList
        data={OPTIONS}
        horizontal
        keyExtractor={(item) => item}
        showsHorizontalScrollIndicator={false}
        renderItem={({item}) => {
          const isSelected = item === selectedOption;
          return (
            <TouchableOpacity
              style={[styles.button, isSelected && styles.buttonSelected]}
              onPress={() => onOptionSelect(item)}>
              <Text style={[styles.text, isSelected && styles.textSelected]}>
                {item}
              </Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 60,
    borderTopWidth: 1,
    borderColor: '#444444', // Borda escura sutil
    justifyContent: 'center',
    backgroundColor: '#2A2A2A', // Fundo mais escuro para o menu
    paddingVertical: 5, // Padding para o conteúdo
    shadowColor: '#000', // Sombra para o menu
    shadowOffset: { width: 0, height: -2 }, // Sombra para cima
    shadowOpacity: 0.5,
    shadowRadius: 5,
    elevation: 8,
  },
  button: {
    marginHorizontal: 10,
    paddingHorizontal: 18, // Aumentado o padding
    paddingVertical: 10, // Aumentado o padding
    borderRadius: 8, // Cantos arredondados
    backgroundColor: '#1A1A1A', // Fundo ainda mais escuro para botões normais
    borderColor: '#333333', // Borda mais escura
    borderWidth: 1,
  },
  buttonSelected: {
    backgroundColor: '#FFA500', // Laranja vibrante quando selecionado
    borderColor: '#FFA500', // Borda da mesma cor
  },
  text: {
    fontSize: 16,
    color: '#EEEEEE', // Texto claro
    fontWeight: '600', // Um pouco mais de peso
  },
  textSelected: {
    color: '#1A1A1A', // Texto escuro no botão vibrante
    fontWeight: 'bold',
  },
});