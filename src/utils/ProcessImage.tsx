import RNFS from 'react-native-fs';
import { decode as jpegDecode, encode as jpegEncode } from 'jpeg-js';
import UPNG from 'upng-js';
import { toByteArray, fromByteArray } from 'base64-js';
import { Platform, NativeModules } from 'react-native';

interface FilterAdjustments {
  scale: number;
  lineScale: number; // Propriedade para módulo nativo, não utilizada no JS
  contrast: number;
  midtones: number;
  highlights: number;
  luminanceThreshold: number; // Propriedade para dither, não utilizada diretamente aqui
  blur: number;
  invert: boolean;
}

const { RNImageProcessor } = NativeModules;
const useNativeModule = Platform.OS === 'android' || Platform.OS === 'ios';
const CHUNK_SIZE = 1024 * 1024;

const clamp = (v: number): number => Math.max(0, Math.min(255, v));

const isPngFormat = (data: Uint8Array): boolean => {
  return data.length >= 8 &&
         data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47 &&
         data[4] === 0x0D && data[5] === 0x0A && data[6] === 0x1A && data[7] === 0x0A;
};

const isJpegFormat = (data: Uint8Array): boolean => {
  return data.length >= 2 && data[0] === 0xFF && data[1] === 0xD8;
};

const precomputePixelFilterParams = (filters: FilterAdjustments) => {
  let contrastFactor = 0;
  if (filters.contrast !== 0) {
    contrastFactor = (259 * (filters.contrast + 255)) / (255 * (259 - filters.contrast));
  }

  const midtoneLookupTable = new Uint8Array(256);
  if (filters.midtones !== 0) {
    for (let i = 0; i < 256; i++) {
      const distance = Math.abs(i - 128);
      const weight = 1 - distance / 128;
      const adjustment = weight * filters.midtones;
      midtoneLookupTable[i] = clamp(i + adjustment);
    }
  }

  const highlightLookupTable = new Uint8Array(256);
  if (filters.highlights !== 0) {
    for (let i = 0; i < 256; i++) {
      const weight = i / 255;
      const adjustment = weight * filters.highlights;
      highlightLookupTable[i] = clamp(i + adjustment);
    }
  }

  return { contrastFactor, midtoneLookupTable, highlightLookupTable };
};

export const ProcessImage = async (
  uri: string,
  filters: FilterAdjustments
): Promise<string> => {
  try {
    // Tenta usar o módulo nativo primeiro para máxima performance
    if (useNativeModule && RNImageProcessor && RNImageProcessor.processImage) {
      try {
        return await RNImageProcessor.processImage(uri, filters);
      } catch (nativeError) {
        console.error('Native processing failed, falling back to JS:', nativeError);
      }
    }

    let base64Data: string;

    if (uri.startsWith('data:')) {
      const parts = uri.split(',');
      if (parts.length < 2) {
        throw new Error('Invalid data URI format');
      }
      base64Data = parts[1];
    } else {
      base64Data = await RNFS.readFile(uri, 'base64');
    }

    const bytes = toByteArray(base64Data);
    let width: number, height: number, pixels: Uint8Array;

    const isPng = isPngFormat(bytes);
    const isJpeg = isJpegFormat(bytes);

    if (!isPng && !isJpeg) {
      console.warn('Unsupported image format detected. Returning original URI.');
      return uri; // Retorna o URI original se o formato não for suportado
    }

    if (isPng) {
      const png = UPNG.decode(bytes.buffer);
      width = png.width;
      height = png.height;
      pixels = new Uint8Array(UPNG.toRGBA8(png)[0]);
    } else {
      // jpeg-js decodes to Uint8Array by default, convert to Uint8ClampedArray later if needed.
      const jpeg = jpegDecode(bytes, { maxResolutionInMP: 100 });
      width = jpeg.width;
      height = jpeg.height;
      pixels = jpeg.data;
    }

    let currentWidth = width;
    let currentHeight = height;
    let currentPixels = pixels;

    // Aplica o redimensionamento (scale)
    if (filters.scale !== 1) {
      currentWidth = Math.round(width * filters.scale);
      currentHeight = Math.round(height * filters.scale);
      currentPixels = rescaleImage(pixels, width, height, currentWidth, currentHeight);
    }

    // Cria uma nova Uint8ClampedArray para o processamento de filtros
    const data = new Uint8ClampedArray(currentPixels);
    const w = currentWidth;
    const h = currentHeight;

    // Aplica o blur PRIMEIRO, pois é uma operação que depende de vizinhos e precisa da imagem completa.
    if (filters.blur > 0) {
      applyBlur(data, w, h, filters.blur);
    }

    // Pré-calcula os parâmetros para os filtros pixel-a-pixel
    const pixelFilterParams = precomputePixelFilterParams(filters);

    const totalBytes = w * h * 4;
    // Para imagens grandes, processa em chunks para manter a UI responsiva
    if (totalBytes > CHUNK_SIZE) {
      await processImagePixelFiltersInChunks(data, totalBytes, filters, pixelFilterParams);
    } else {
      // Para imagens menores, aplica os filtros pixel-a-pixel diretamente
      applyPixelFilters(data, 0, totalBytes, filters, pixelFilterParams);
    }

    let output: Uint8Array;
    const imageType = isPng ? 'png' : 'jpeg';

    if (isPng) {
      // UPNG.encode expects an array of buffers, each representing a frame.
      // We're passing the raw Uint8Array buffer from data.
      const encoded = UPNG.encode([new Uint8Array(data.buffer)], w, h, 256, [0]);
      output = new Uint8Array(encoded);
    } else {
      // jpeg-js encode expects { width, height, data }
      output = jpegEncode({ width: w, height: h, data }, 90).data;
    }

    return `data:image/${imageType};base64,${fromByteArray(output)}`;
  } catch (error) {
    console.error('Error processing image:', error);
    return uri; // Retorna o URI original em caso de erro
  }
};

// Gerencia o processamento de filtros pixel-a-pixel em chunks para responsividade da UI
async function processImagePixelFiltersInChunks(
  data: Uint8ClampedArray,
  totalBytes: number,
  filters: FilterAdjustments,
  pixelFilterParams: ReturnType<typeof precomputePixelFilterParams>
) {
  const chunkCount = Math.ceil(totalBytes / CHUNK_SIZE);
  const effectiveChunkSize = Math.ceil(totalBytes / chunkCount);

  const promises = [];

  for (let i = 0; i < totalBytes; i += effectiveChunkSize) {
    const end = Math.min(i + effectiveChunkSize, totalBytes);
    promises.push(
      new Promise<void>(resolve => {
        setTimeout(() => {
          // Aplica os filtros pixel-a-pixel no segmento atual da array `data`
          applyPixelFilters(data, i, end, filters, pixelFilterParams);
          resolve();
        }, 0); // O setTimeout(0) cede o controle para a thread principal, mantendo a UI responsiva
      })
    );
  }

  await Promise.all(promises);
}

// Aplica todos os filtros pixel-a-pixel para um segmento de dados
function applyPixelFilters(
  data: Uint8ClampedArray,
  startIndex: number,
  endIndex: number,
  filters: FilterAdjustments,
  { contrastFactor, midtoneLookupTable, highlightLookupTable }: ReturnType<typeof precomputePixelFilterParams>
): void {
  for (let i = startIndex; i < endIndex; i += 4) { // Incrementa de 4 em 4 para RGB A
    if (filters.contrast !== 0) {
      data[i] = clamp(contrastFactor * (data[i] - 128) + 128);
      data[i + 1] = clamp(contrastFactor * (data[i + 1] - 128) + 128);
      data[i + 2] = clamp(contrastFactor * (data[i + 2] - 128) + 128);
    }

    // Aplica midtones e highlights, ambos dependem do brilho do pixel
    if (filters.midtones !== 0 || filters.highlights !== 0) {
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const roundedBrightness = Math.round(brightness);

      if (filters.midtones !== 0) {
        const adjustment = midtoneLookupTable[roundedBrightness] - brightness;
        data[i] = clamp(data[i] + adjustment);
        data[i + 1] = clamp(data[i + 1] + adjustment);
        data[i + 2] = clamp(data[i + 2] + adjustment);
      }

      if (filters.highlights !== 0) {
        const adjustment = highlightLookupTable[roundedBrightness] - brightness;
        data[i] = clamp(data[i] + adjustment);
        data[i + 1] = clamp(data[i + 1] + adjustment);
        data[i + 2] = clamp(data[i + 2] + adjustment);
      }
    }

    if (filters.invert) {
      data[i] = 255 - data[i];
      data[i + 1] = 255 - data[i + 1];
      data[i + 2] = 255 - data[i + 2];
    }
    // O canal alpha (data[i+3]) não é modificado pelos filtros de cor.
  }
}

// Funções de redimensionamento
function rescaleImage(
  pixels: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number
): Uint8Array {
  const output = new Uint8Array(dstWidth * dstHeight * 4);

  // Decide entre downsample (redução) ou bilinear (ampliação/redução com interpolação)
  if (dstWidth < srcWidth && dstHeight < srcHeight) {
    rescaleDownsample(pixels, output, srcWidth, srcHeight, dstWidth, dstHeight);
  } else {
    rescaleBilinear(pixels, output, srcWidth, srcHeight, dstWidth, dstHeight);
  }

  return output;
}

// Redimensionamento para baixo (downsampling) usando média simples
function rescaleDownsample(
  input: Uint8Array,
  output: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number
): void {
  const xRatio = srcWidth / dstWidth;
  const yRatio = srcHeight / dstHeight;

  for (let y = 0; y < dstHeight; y++) {
    const srcYStart = Math.floor(y * yRatio);
    const srcYEnd = Math.min(Math.ceil((y + 1) * yRatio), srcHeight);

    for (let x = 0; x < dstWidth; x++) {
      const srcXStart = Math.floor(x * xRatio);
      const srcXEnd = Math.min(Math.ceil((x + 1) * xRatio), srcWidth);

      let r = 0, g = 0, b = 0, a = 0;
      let count = 0;

      // Calcula a média dos pixels da área de origem para o pixel de destino
      for (let sy = srcYStart; sy < srcYEnd; sy++) {
        for (let sx = srcXStart; sx < srcXEnd; sx++) {
          const srcIdx = (sy * srcWidth + sx) * 4;
          r += input[srcIdx];
          g += input[srcIdx + 1];
          b += input[srcIdx + 2];
          a += input[srcIdx + 3];
          count++;
        }
      }

      const dstIdx = (y * dstWidth + x) * 4;
      if (count > 0) {
          output[dstIdx] = Math.round(r / count);
          output[dstIdx + 1] = Math.round(g / count);
          output[dstIdx + 2] = Math.round(b / count);
          output[dstIdx + 3] = Math.round(a / count); // Alpha também
      }
    }
  }
}

// Redimensionamento bilinear (interpolação)
function rescaleBilinear(
  input: Uint8Array,
  output: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number
): void {
  const xRatio = (srcWidth - 1) / dstWidth;
  const yRatio = (srcHeight - 1) / dstHeight;

  for (let y = 0; y < dstHeight; y++) {
    const yPos = y * yRatio;
    const y1 = Math.floor(yPos);
    const y2 = Math.min(y1 + 1, srcHeight - 1); // Garante que y2 não exceda o limite

    const yDiff = yPos - y1;

    for (let x = 0; x < dstWidth; x++) {
      const xPos = x * xRatio;
      const x1 = Math.floor(xPos);
      const x2 = Math.min(x1 + 1, srcWidth - 1); // Garante que x2 não exceda o limite

      const xDiff = xPos - x1;

      const idx = (y * dstWidth + x) * 4;

      const idx11 = (y1 * srcWidth + x1) * 4;
      const idx12 = (y1 * srcWidth + x2) * 4;
      const idx21 = (y2 * srcWidth + x1) * 4;
      const idx22 = (y2 * srcWidth + x2) * 4;

      for (let c = 0; c < 4; c++) { // Itera sobre R, G, B, A
        const top = input[idx11 + c] * (1 - xDiff) + input[idx12 + c] * xDiff;
        const bottom = input[idx21 + c] * (1 - xDiff) + input[idx22 + c] * xDiff;
        output[idx + c] = Math.round(top * (1 - yDiff) + bottom * yDiff);
      }
    }
  }
}

// Aplica desfoque usando um kernel de caixa (box blur) em duas passagens
function applyBlur(data: Uint8ClampedArray, width: number, height: number, radius: number): void {
  // Cria uma cópia da imagem original para a primeira passagem (horizontal)
  const original = new Uint8ClampedArray(data);
  const kernelSize = Math.max(1, Math.floor(radius)); // Raio do desfoque (tamanho do kernel)

  // Buffer temporário para a primeira passagem
  const temp = new Uint8ClampedArray(data.length);

  // Primeira passagem: Desfoque horizontal
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
      let count = 0;

      // Soma os valores dos pixels dentro do raio horizontal
      for (let kx = -kernelSize; kx <= kernelSize; kx++) {
        const nx = x + kx; // Posição do pixel vizinho na horizontal

        if (nx >= 0 && nx < width) { // Verifica os limites da imagem
          const idx = (y * width + nx) * 4;
          rSum += original[idx];
          gSum += original[idx + 1];
          bSum += original[idx + 2];
          aSum += original[idx + 3];
          count++;
        }
      }

      const idx = (y * width + x) * 4;
      temp[idx] = Math.round(rSum / count);
      temp[idx + 1] = Math.round(gSum / count);
      temp[idx + 2] = Math.round(bSum / count);
      temp[idx + 3] = Math.round(aSum / count); // Inclui o canal alpha
    }
  }

  // Segunda passagem: Desfoque vertical (usando o buffer temporário)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
      let count = 0;

      // Soma os valores dos pixels dentro do raio vertical
      for (let ky = -kernelSize; ky <= kernelSize; ky++) {
        const ny = y + ky; // Posição do pixel vizinho na vertical

        if (ny >= 0 && ny < height) { // Verifica os limites da imagem
          const idx = (ny * width + x) * 4;
          rSum += temp[idx];
          gSum += temp[idx + 1];
          bSum += temp[idx + 2];
          aSum += temp[idx + 3];
          count++;
        }
      }

      const idx = (y * width + x) * 4;
      data[idx] = Math.round(rSum / count);
      data[idx + 1] = Math.round(gSum / count);
      data[idx + 2] = Math.round(bSum / count);
      data[idx + 3] = Math.round(aSum / count); // Inclui o canal alpha
    }
  }
}