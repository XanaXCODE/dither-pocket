import React, { useState, useEffect } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';


import {
  SafeAreaView,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Alert,
  StatusBar,
  Modal,
  ScrollView,
} from 'react-native';
import Slider from '@react-native-community/slider';
import CheckBox from '@react-native-community/checkbox';
import { AddImageButton } from './src/components/AddImageButton';
import { ImagePreview } from './src/components/ImagePreview';
import { DitherOptions } from './src/components/DitherOptions';
import { ApplyDitherFilter } from './src/utils/ApplyDitherFilter';
import { ProcessImage } from './src/utils/ProcessImage';
import RNFS from 'react-native-fs';
import Icon from 'react-native-vector-icons/Ionicons';
import { request, PERMISSIONS, RESULTS } from 'react-native-permissions';


interface FilterAdjustments {
  scale: number;
  lineScale: number;
  contrast: number;
  midtones: number;
  highlights: number;
  luminanceThreshold: number;
  blur: number;
  invert: boolean;
}

export default function App() {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [processedUri, setProcessedUri] = useState<string | null>(null);
  const [selectedDitherType, setSelectedDitherType] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [filters, setFilters] = useState<FilterAdjustments>({
    scale: 1,
    lineScale: 1,
    contrast: 0,
    midtones: 0,
    highlights: 0,
    luminanceThreshold: 128,
    blur: 0,
    invert: false,
  });

  const currentUriToShow = processedUri ?? imageUri;

  const handleImageSelected = (uri: string) => {
    setImageUri(uri);
    setProcessedUri(null);
    setSelectedDitherType(null);
    resetFilters();
  };

  const resetFilters = () => {
    setFilters({
      scale: 1,
      lineScale: 1,
      contrast: 0,
      midtones: 0,
      highlights: 0,
      luminanceThreshold: 128,
      blur: 0,
      invert: false,
    });
  };

  const handleDitherSelect = (type: string) => {
    setSelectedDitherType(type);
  };

  const handleFilterChange = (name: keyof FilterAdjustments, value: number | boolean) => {
    setFilters(prev => ({
      ...prev,
      [name]: value
    }));
  };


  useEffect(() => {
    const processImageEffect = async () => {
      if (!imageUri) return;
      
      setLoading(true);
      try {
        const adjustedUri = await ProcessImage(imageUri, filters);
        

        if (selectedDitherType) {
          const resultUri = await ApplyDitherFilter(adjustedUri, selectedDitherType, filters.luminanceThreshold);
          setProcessedUri(resultUri);
        } else {
          setProcessedUri(adjustedUri);
        }
      } catch (error) {
        console.error("Error processing image:", error);
        Alert.alert("Error", "Failed to process the image");
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(() => {
      processImageEffect();
    }, 300);

    return () => clearTimeout(timer);
  }, [filters, selectedDitherType, imageUri]);



  async function ensureSavePermission(): Promise<boolean> {
    if (Platform.OS === 'android') {
      const permission = 
        Platform.Version >= 33
          ? PERMISSIONS.ANDROID.READ_MEDIA_IMAGES
          : PERMISSIONS.ANDROID.WRITE_EXTERNAL_STORAGE;

      const result = await request(permission);
      return result === RESULTS.GRANTED;
    } else {
      const result = await request(PERMISSIONS.IOS.PHOTO_LIBRARY_ADD_ONLY);
      return result === RESULTS.GRANTED;
    }
  }



   const handleSave = async () => {
    const uriToSave = processedUri ?? imageUri;
    if (!uriToSave) {
      return Alert.alert('Nenhuma imagem para salvar');
    }

    const hasPerm = await ensureSavePermission();
    if (!hasPerm) {
      return Alert.alert(
        'Permissão necessária',
        'Por favor, habilite o acesso às fotos nas configurações do seu aparelho.'
      );
    }

    try {
      let pathToFile: string;
      if (uriToSave.startsWith('data:image/')) {
        const ext = uriToSave.match(/^data:image\/(\w+);base64,/)?.[1] || 'png';
        const base64 = uriToSave.replace(/^data:image\/\w+;base64,/, '');
        const name = `Dithered_${Date.now()}.${ext}`;
        const dest = `${RNFS.CachesDirectoryPath}/${name}`;
        await RNFS.writeFile(dest, base64, 'base64');
        pathToFile = dest;
      } else {
        pathToFile = uriToSave.startsWith('file://')
          ? uriToSave.replace('file://', '')
          : uriToSave;
      }

      const savedUri = await CameraRoll.save(
        Platform.select({
          ios: pathToFile,
          android: `file://${pathToFile}`,
        }) as string,
        { type: 'photo' }
      );
      Alert.alert('Sucesso', 'Imagem salva na galeria!');
      console.log('Salvou em:', savedUri);

    } catch (error: any) {
      console.error('Erro ao salvar:', error);
      Alert.alert('Erro', `Falha ao salvar imagem: ${error.message || error}`);
    }
  };

  const handleReset = () => {
    resetFilters();
    setSelectedDitherType(null);
    setProcessedUri(null);
  };

  const toggleOptions = () => {
    setShowOptions(!showOptions);
  };

  return (
    <>
      <StatusBar backgroundColor="#000" barStyle="light-content" />
      <SafeAreaView style={styles.safe}>
        {!imageUri ? (
          <AddImageButton onImageSelected={handleImageSelected} />
        ) : (
          <View style={styles.container}>
            <View style={styles.header}>
              <TouchableOpacity 
                style={styles.iconButton} 
                onPress={() => {
                  setImageUri(null);
                  setProcessedUri(null);
                  resetFilters();
                }}
              >
                <Icon name="arrow-back" size={24} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.appTitle}>DITHER POCKET</Text>
              <TouchableOpacity style={styles.iconButton} onPress={handleSave}>
                <Icon name="download-outline" size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            <ImagePreview 
              imageUri={currentUriToShow} 
              loading={loading} 
            />

            <View style={styles.controlsContainer}>
              <View style={styles.ditherBar}>
                <DitherOptions
                  selectedDither={selectedDitherType}
                  onDitherSelect={handleDitherSelect}
                />
                <TouchableOpacity 
                  style={[styles.optionsToggle, showOptions && styles.optionsToggleActive]} 
                  onPress={toggleOptions}
                >
                  <Icon name={showOptions ? "chevron-down" : "chevron-up"} size={24} color="#fff" />
                </TouchableOpacity>
              </View>
              
              {showOptions && (
                <ScrollView style={styles.optionsPanel}>
                  <View style={styles.filterOption}>
                    <Text style={styles.filterLabel}>Scale</Text>
                    <Slider
                      style={styles.slider}
                      minimumValue={0.5}
                      maximumValue={2}
                      step={0.1}
                      value={filters.scale}
                      onValueChange={(value) => handleFilterChange('scale', value)}
                      minimumTrackTintColor="#FF9500"
                      maximumTrackTintColor="#444"
                      thumbTintColor="#FF9500"
                    />
                    <Text style={styles.filterValue}>{filters.scale.toFixed(1)}</Text>
                  </View>

                  <View style={styles.filterOption}>
                    <Text style={styles.filterLabel}>Line Scale</Text>
                    <Slider
                      style={styles.slider}
                      minimumValue={0.5}
                      maximumValue={2}
                      step={0.1}
                      value={filters.lineScale}
                      onValueChange={(value) => handleFilterChange('lineScale', value)}
                      minimumTrackTintColor="#FF9500"
                      maximumTrackTintColor="#444"
                      thumbTintColor="#FF9500"
                    />
                    <Text style={styles.filterValue}>{filters.lineScale.toFixed(1)}</Text>
                  </View>

                  <View style={styles.filterOption}>
                    <Text style={styles.filterLabel}>Contrast</Text>
                    <Slider
                      style={styles.slider}
                      minimumValue={-50}
                      maximumValue={50}
                      step={1}
                      value={filters.contrast}
                      onValueChange={(value) => handleFilterChange('contrast', value)}
                      minimumTrackTintColor="#FF9500"
                      maximumTrackTintColor="#444"
                      thumbTintColor="#FF9500"
                    />
                    <Text style={styles.filterValue}>{filters.contrast.toFixed(0)}</Text>
                  </View>

                  <View style={styles.filterOption}>
                    <Text style={styles.filterLabel}>Midtones</Text>
                    <Slider
                      style={styles.slider}
                      minimumValue={-50}
                      maximumValue={50}
                      step={1}
                      value={filters.midtones}
                      onValueChange={(value) => handleFilterChange('midtones', value)}
                      minimumTrackTintColor="#FF9500"
                      maximumTrackTintColor="#444"
                      thumbTintColor="#FF9500"
                    />
                    <Text style={styles.filterValue}>{filters.midtones.toFixed(0)}</Text>
                  </View>

                  <View style={styles.filterOption}>
                    <Text style={styles.filterLabel}>Highlights</Text>
                    <Slider
                      style={styles.slider}
                      minimumValue={-50}
                      maximumValue={50}
                      step={1}
                      value={filters.highlights}
                      onValueChange={(value) => handleFilterChange('highlights', value)}
                      minimumTrackTintColor="#FF9500"
                      maximumTrackTintColor="#444"
                      thumbTintColor="#FF9500"
                    />
                    <Text style={styles.filterValue}>{filters.highlights.toFixed(0)}</Text>
                  </View>

                  <View style={styles.filterOption}>
                    <Text style={styles.filterLabel}>Luminance Threshold</Text>
                    <Slider
                      style={styles.slider}
                      minimumValue={0}
                      maximumValue={255}
                      step={1}
                      value={filters.luminanceThreshold}
                      onValueChange={(value) => handleFilterChange('luminanceThreshold', value)}
                      minimumTrackTintColor="#FF9500"
                      maximumTrackTintColor="#444"
                      thumbTintColor="#FF9500"
                    />
                    <Text style={styles.filterValue}>{filters.luminanceThreshold.toFixed(0)}</Text>
                  </View>

                  <View style={styles.filterOption}>
                    <Text style={styles.filterLabel}>Blur</Text>
                    <Slider
                      style={styles.slider}
                      minimumValue={0}
                      maximumValue={10}
                      step={0.5}
                      value={filters.blur}
                      onValueChange={(value) => handleFilterChange('blur', value)}
                      minimumTrackTintColor="#FF9500"
                      maximumTrackTintColor="#444"
                      thumbTintColor="#FF9500"
                    />
                    <Text style={styles.filterValue}>{filters.blur.toFixed(1)}</Text>
                  </View>

                  <View style={styles.checkboxOption}>
                    <Text style={styles.filterLabel}>Invert</Text>
                    <CheckBox
                      value={filters.invert}
                      onValueChange={(value) => handleFilterChange('invert', value)}
                      tintColors={{ true: '#FF9500', false: '#888' }}
                    />
                  </View>

                  <TouchableOpacity style={styles.resetButton} onPress={handleReset}>
                    <Text style={styles.resetText}>Reset All</Text>
                  </TouchableOpacity>
                </ScrollView>
              )}
            </View>
          </View>
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#000',
  },
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  appTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  iconButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: '#222',
  },
  controlsContainer: {
    backgroundColor: '#111',
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  ditherBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 10,
  },
  optionsToggle: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: '#222',
  },
  optionsToggleActive: {
    backgroundColor: '#FF9500',
  },
  optionsPanel: {
    paddingHorizontal: 15,
    paddingBottom: 20,
    maxHeight: 300,
  },
  filterOption: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
  },
  filterLabel: {
    color: '#DDD',
    width: 120,
    fontSize: 14,
  },
  slider: {
    flex: 1,
    height: 40,
  },
  filterValue: {
    color: '#FF9500',
    width: 40,
    textAlign: 'right',
    fontSize: 14,
  },
  checkboxOption: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
  },
  resetButton: {
    backgroundColor: '#333',
    padding: 12,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 10,
  },
  resetText: {
    color: '#FF9500',
    fontWeight: 'bold',
  },
});