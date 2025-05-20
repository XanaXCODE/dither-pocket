import React from 'react';
import { StyleSheet, TouchableOpacity, View, Text, Alert } from 'react-native';
import { launchImageLibrary, Asset, ImagePickerResponse } from 'react-native-image-picker';
import Icon from 'react-native-vector-icons/Ionicons';

type Props = {
  onImageSelected: (uri: string) => void;
};

const handleImagePickerError = (errorMessage?: string) => {
  console.error('Falha ao selecionar imagem:', errorMessage || 'NULL');
};

const validateImageSelection = (response: ImagePickerResponse): string | null => {
  if (response.didCancel) {
    return null;
  }

  if (response.errorCode || !response.assets) {
    handleImagePickerError(response.errorMessage);
    return null;
  }

  const [firstAsset] = response.assets;
  if (!firstAsset?.uri) {
    console.error('URI não encontrada');
    return null;
  }

  return firstAsset.uri;
};

export const AddImageButton = ({ onImageSelected }: Props) => {
  const handlePickImage = async () => {
    try {
      const response = await new Promise<ImagePickerResponse>(resolve => {
        launchImageLibrary(
          {
            mediaType: 'photo',
            quality: 1.0,
          },
          resolve
        );
      });

      const imageUri = validateImageSelection(response);
      if (imageUri) {
        console.log('Imagem selecionada com sucesso:', imageUri);
        onImageSelected(imageUri);
      }
    } catch (error) {
      handleImagePickerError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>DITHER POCKET</Text>
        <Text style={styles.subtitle}>Editor de dither na palma da sua mão</Text>
        
        <TouchableOpacity 
          onPress={handlePickImage} 
          style={styles.button}
          accessibilityLabel="Selecionar imagem"
          testID="image-picker-button"
        >
          <Icon name="add-outline" size={32} color="#FF9500" />
          <Text style={styles.buttonText}>Selecionar Imagem</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    paddingVertical: 40,
  },
  content: {
    alignItems: 'center',
    width: '100%',
  },
  title: {
    color: '#FFF',
    fontSize: 32,
    fontWeight: 'bold',
    letterSpacing: 2,
    marginBottom: 8,
  },
  subtitle: {
    color: '#888',
    fontSize: 16,
    marginBottom: 60,
  },
  button: {
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 20,
    width: 200,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    marginBottom: 40,
    borderWidth: 1,
    borderColor: '#222',
    shadowColor: '#FF9500',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 10,
  },
});