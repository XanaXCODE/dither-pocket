import React from 'react';
import { StyleSheet, Image, View, ActivityIndicator, Text } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';

type Props = {
  imageUri: string | null;
  loading?: boolean;
};

const FrameCorner = ({ position }: { position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' }) => {
  const cornerStyles = [
    styles.frameCorner,
    position === 'top-right' && styles.frameTopRight,
    position === 'bottom-left' && styles.frameBottomLeft,
    position === 'bottom-right' && styles.frameBottomRight,
  ];

  return <View style={cornerStyles} />;
};

export const ImagePreview = ({ imageUri, loading = false }: Props) => {
  if (!imageUri) {
    return (
      <View style={styles.emptyContainer} testID="empty-preview">
        <Icon name="image-outline" size={60} color="#333" />
        <Text style={styles.emptyText}>Nenhuma imagem selecionada</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      <Image 
        source={{ uri: imageUri }} 
        style={styles.image} 
        resizeMode="contain"
        accessibilityLabel="Pré-visualização da imagem selecionada"
      />
      
      {loading && (
        <View style={styles.loadingOverlay} testID="loading-indicator">
          <ActivityIndicator size="large" color="#FF9500" />
          <Text style={styles.loadingText}>Processando imagem...</Text>
        </View>
      )}
      

    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
    paddingHorizontal: 20,
    paddingVertical: 10,
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
    borderRadius: 4,
    backgroundColor: '#111',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 4,
  },
  loadingText: {
    color: '#FF9500',
    marginTop: 10,
    fontSize: 14,
  },
  frameCorner: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: '#FF9500',
    top: 15,
    left: 25,
    borderTopWidth: 2,
    borderLeftWidth: 2,
  },
  frameTopRight: {
    right: 25,
    left: undefined,
    borderTopWidth: 2,
    borderRightWidth: 2,
    borderLeftWidth: 0,
  },
  frameBottomLeft: {
    bottom: 15,
    top: undefined,
    borderBottomWidth: 2,
    borderTopWidth: 0,
  },
  frameBottomRight: {
    bottom: 15,
    right: 25,
    top: undefined,
    left: undefined,
    borderBottomWidth: 2,
    borderRightWidth: 2,
    borderTopWidth: 0,
    borderLeftWidth: 0,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  emptyText: {
    color: '#444',
    marginTop: 10,
    fontSize: 16,
  },
});