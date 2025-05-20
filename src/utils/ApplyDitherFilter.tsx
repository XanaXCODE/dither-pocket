import RNFS from 'react-native-fs';
import { decode as jpegDecode, encode as jpegEncode } from 'jpeg-js';
import UPNG from 'upng-js';
import { toByteArray, fromByteArray } from 'base64-js';
import { Platform } from 'react-native';

export type DitherType = 'FloydSteinberg' | 'Ordered' | 'Bayer2x2' | 'Bayer4x4' | 'Halftone' | 'None';

// Use a typed array for faster operations
const clamp = (v: number): number => v < 0 ? 0 : v > 255 ? 255 : v;

// Cache these common matrix patterns
const BAYER_2X2 = [
  [0, 2],
  [3, 1]
];

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
];

const HALFTONE_PATTERNS = [
  [0, 0, 0, 0],  // 0/4 dots (0)
  [1, 0, 0, 0],  // 1/4 dots (1)
  [1, 0, 0, 1],  // 2/4 dots (2)
  [1, 1, 0, 1],  // 3/4 dots (3)
  [1, 1, 1, 1]   // 4/4 dots (4)
];

// Fast format detection using DataView for better performance
const detectImageFormat = (data: Uint8Array): string => {
  if (data.length < 8) return 'unknown';

  const view = new DataView(data.buffer, data.byteOffset, Math.min(12, data.length));

  // Check PNG signature (8 bytes)
  if (view.getUint32(0) === 0x89504E47 && view.getUint32(4) === 0x0D0A1A0A) {
    return 'png';
  }

  // Check JPEG signature (first 2 bytes)
  if (view.getUint16(0) === 0xFFD8) {
    return 'jpeg';
  }

  return 'unknown';
};

// Helper to create a grayscale buffer from RGB data
// This function returns a NEW Uint8Array to be used as the mutable error buffer for Floyd-Steinberg.
const createGrayscaleBuffer = (data: Uint8ClampedArray, w: number, h: number): Uint8Array => {
  const grayData = new Uint8Array(w * h);

  // Process 4 pixels at a time where possible for better performance
  const length = w * h * 4;
  const limit = length - (length % 16);

  for (let i = 0, j = 0; i < limit; i += 16, j += 4) {
    grayData[j] = Math.round(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]);
    grayData[j+1] = Math.round(0.299 * data[i+4] + 0.587 * data[i+5] + 0.114 * data[i+6]);
    grayData[j+2] = Math.round(0.299 * data[i+8] + 0.587 * data[i+9] + 0.114 * data[i+10]);
    grayData[j+3] = Math.round(0.299 * data[i+12] + 0.587 * data[i+13] + 0.114 * data[i+14]);
  }

  // Handle remaining pixels
  for (let i = limit; i < length; i += 4) {
    const j = Math.floor(i / 4);
    grayData[j] = Math.round(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]);
  }

  return grayData;
};

// This variable is for conceptual worker management for UI responsiveness.
// In JavaScript, setTimeout(0) simply yields to the event loop, it's not true multi-threading.
// The `workerCount` is less critical here for raw speed, more for preventing UI freezes by yielding.
const MAX_WORKERS = Platform.OS === 'ios' ? 2 : 4;
let workerCount = 0; // Global counter for ongoing async operations

export const ApplyDitherFilter = async (
  uri: string,
  type: string,
  threshold: number = 128
): Promise<string> => {
  try {
    // Handle cache to avoid reprocessing the same image with same parameters
    const cacheKey = `${uri}_${type}_${threshold}`;
    const tempDir = `${RNFS.CachesDirectoryPath}/ditherCache`;
    const cacheFile = `${tempDir}/${cacheKey.replace(/[^a-zA-Z0-9]/g, '_')}.cache`;

    // Create cache directory if needed
    try {
      const exists = await RNFS.exists(tempDir);
      if (!exists) {
        await RNFS.mkdir(tempDir);
      } else {
        // Check if we have this image in cache
        const cacheExists = await RNFS.exists(cacheFile);
        if (cacheExists) {
          return await RNFS.readFile(cacheFile, 'utf8');
        }
      }
    } catch (e) {
      console.log('Cache directory error, continuing without cache');
    }

    // Extract image data
    let base64Data: string;

    try {
      if (uri.startsWith('data:')) {
        const parts = uri.split(',');
        if (parts.length < 2) {
          throw new Error('Invalid data URI format');
        }
        base64Data = parts[1];
      } else {
        base64Data = await RNFS.readFile(uri, 'base64');
      }
    } catch (error) {
      console.error('Error reading image data:', error);
      return uri; // Return original on read error
    }

    // Convert base64 to bytes
    const bytes = toByteArray(base64Data);
    let width: number, height: number, pixels: Uint8ClampedArray;

    // Use fast format detection
    const format = detectImageFormat(bytes);

    if (format === 'unknown') {
      console.error('Unsupported image format');
      return uri; // Return original if format not supported
    }

    try {
      if (format === 'png') {
        const png = UPNG.decode(bytes.buffer);
        width = png.width;
        height = png.height;
        pixels = new Uint8ClampedArray(UPNG.toRGBA8(png)[0]);
      } else {
        const jpeg = jpegDecode(bytes, { maxResolutionInMP: 100 });
        width = jpeg.width;
        height = jpeg.height;
        pixels = new Uint8ClampedArray(jpeg.data);
      }
    } catch (error) {
      console.error('Error decoding image:', error);
      return uri; // Return original on decode error
    }

    // Check if image is too large and downscale if needed
    const pixelCount = width * height;
    if (pixelCount > 2000000) { // More than 2 megapixels
      const scale = Math.sqrt(2000000 / pixelCount);
      const newWidth = Math.floor(width * scale);
      const newHeight = Math.floor(height * scale);

      // Create new scaled buffer - this helps with performance on large images
      const newPixels = new Uint8ClampedArray(newWidth * newHeight * 4);

      // Simplified bilinear scaling (faster than proper resampling for our needs)
      for (let y = 0; y < newHeight; y++) {
        for (let x = 0; x < newWidth; x++) {
          const srcX = Math.min(width - 1, Math.floor(x / scale));
          const srcY = Math.min(height - 1, Math.floor(y / scale));

          const srcIdx = (srcY * width + srcX) * 4;
          const dstIdx = (y * newWidth + x) * 4;

          newPixels[dstIdx] = pixels[srcIdx];
          newPixels[dstIdx + 1] = pixels[srcIdx + 1];
          newPixels[dstIdx + 2] = pixels[srcIdx + 2];
          newPixels[dstIdx + 3] = pixels[srcIdx + 3];
        }
      }

      pixels = newPixels;
      width = newWidth;
      height = newHeight;
    }

    // Create a copy of pixels to avoid modifying the original
    const data = new Uint8ClampedArray(pixels);
    const w = width;
    const h = height;

    // Apply dithering based on selected type
    try {
      switch (type) {
        case 'FloydSteinberg':
          // NEW: Create grayscale buffer ONCE for the entire image for correct error propagation
          const grayPixelsForFS = createGrayscaleBuffer(data, w, h);
          await floydSteinbergDither(data, grayPixelsForFS, w, h, threshold);
          break;
        case 'Ordered':
          orderedDither(data, w, h, threshold);
          break;
        case 'Bayer2x2':
          bayer2x2Dither(data, w, h, threshold);
          break;
        case 'Bayer4x4':
          bayer4x4Dither(data, w, h, threshold);
          break;
        case 'Halftone':
          halftoneDither(data, w, h, threshold);
          break;
        case 'None':
          thresholdDither(data, w, h, threshold);
          break;
        default:
          // If no valid dither type specified, just return original
          return uri;
      }
    } catch (error) {
      console.error('Error applying dithering algorithm:', error);
      return uri; // Return original on algorithm error
    }

    // Encode the processed image
    try {
      let output: Uint8Array;
      const imageType = format;

      if (format === 'png') {
        const encoded = UPNG.encode([new Uint8Array(data.buffer)], w, h, 256, [0]);
        output = new Uint8Array(encoded);
      } else {
        output = jpegEncode({ width: w, height: h, data }, 90).data;
      }

      const result = `data:image/${imageType};base64,${fromByteArray(output)}`;

      // Save to cache
      try {
        await RNFS.writeFile(cacheFile, result, 'utf8');
      } catch (e) {
        console.log('Error writing to cache, continuing');
      }

      return result;
    } catch (error) {
      console.error('Error encoding processed image:', error);
      return uri; // Return original on encoding error
    }
  } catch (error) {
    console.error('Error in image processing:', error);
    return uri; // Return original URI on any error
  }
};

// Optimized Floyd-Steinberg Dithering Algorithm
// Accepts grayData as a mutable shared buffer for correct error propagation.
async function floydSteinbergDither(data: Uint8ClampedArray, grayData: Uint8Array, w: number, h: number, threshold: number): Promise<void> {
  // If the image is too large, process it in chunks to avoid blocking the main thread.
  // This is for UI responsiveness, not true parallel processing.
  if (w * h > 250000) {
    const chunkHeight = Math.ceil(h / MAX_WORKERS); // Divide into `MAX_WORKERS` chunks for responsiveness
    const promises = [];

    for (let startY = 0; startY < h; startY += chunkHeight) {
      const endY = Math.min(startY + chunkHeight, h);

      // Always create a promise wrapped in setTimeout(0) to yield to the UI thread.
      const promise = new Promise<void>(resolve => {
        setTimeout(() => {
          // Pass shared grayData and RGB data to the chunk processor
          processFSChunk(data, grayData, w, h, startY, endY, threshold);
          resolve();
        }, 0);
      });
      promises.push(promise);
    }

    // Wait for all chunks to complete
    if (promises.length > 0) {
      await Promise.all(promises);
    }
  } else {
    // For smaller images, process everything at once synchronously (still fast enough)
    processFSChunk(data, grayData, w, h, 0, h, threshold);
  }
}

// Processes a chunk of the image for Floyd-Steinberg dithering.
// `grayData` is a shared, mutable buffer for the entire image's grayscale values.
function processFSChunk(data: Uint8ClampedArray, grayData: Uint8Array, w: number, h: number, startY: number, endY: number, threshold: number): void {
  // Pre-calculate error distribution coefficients for standard Floyd-Steinberg
  const COEF_R = 7 / 16;   // Right
  const COEF_BL = 3 / 16;  // Bottom-Left
  const COEF_B = 5 / 16;   // Bottom
  const COEF_BR = 1 / 16;  // Bottom-Right

  // Process dithering row by row within the chunk boundaries
  for (let y = startY; y < endY; y++) {
    // Apply serpentine scanning for better visual quality and error diffusion
    const leftToRight = (y % 2 === 0);
    const startX = leftToRight ? 0 : w - 1;
    const endX = leftToRight ? w : -1;
    const stepX = leftToRight ? 1 : -1;

    for (let x = startX; x !== endX; x += stepX) {
      const idx = (y * w + x); // Index in 1D grayscale array
      const pixelIdx = idx * 4; // Index in 4-channel RGBA array

      const oldPixel = grayData[idx];
      const newPixel = oldPixel < threshold ? 0 : 255;

      // Set the output pixel in the main RGB data array
      data[pixelIdx] = data[pixelIdx+1] = data[pixelIdx+2] = newPixel;
      // Alpha channel is usually untouched: data[pixelIdx+3] = data[pixelIdx+3];

      // Calculate the quantization error
      const error = oldPixel - newPixel;

      // Distribute error to neighboring pixels based on scan direction
      if (leftToRight) {
        // Distribute to (x+1, y), (x-1, y+1), (x, y+1), (x+1, y+1)
        if (x + 1 < w) { // Right neighbor
          grayData[idx + 1] = clamp(grayData[idx + 1] + error * COEF_R);
        }
        if (y + 1 < h) { // Next row neighbors
          if (x > 0) { // Bottom-left
            grayData[idx + w - 1] = clamp(grayData[idx + w - 1] + error * COEF_BL);
          }
          grayData[idx + w] = clamp(grayData[idx + w] + error * COEF_B); // Bottom
          if (x + 1 < w) { // Bottom-right
            grayData[idx + w + 1] = clamp(grayData[idx + w + 1] + error * COEF_BR);
          }
        }
      } else { // Right-to-Left scan
        // Distribute to (x-1, y), (x+1, y+1), (x, y+1), (x-1, y+1) (mirrored kernel positions)
        if (x - 1 >= 0) { // Left neighbor
          grayData[idx - 1] = clamp(grayData[idx - 1] + error * COEF_R);
        }
        if (y + 1 < h) { // Next row neighbors
          if (x < w - 1) { // Bottom-right relative to scan direction
            grayData[idx + w + 1] = clamp(grayData[idx + w + 1] + error * COEF_BL); // This is the old COEF_BL, mapping to (x+1, y+1)
          }
          grayData[idx + w] = clamp(grayData[idx + w] + error * COEF_B); // Bottom
          if (x - 1 >= 0) { // Bottom-left relative to scan direction
            grayData[idx + w - 1] = clamp(grayData[idx + w - 1] + error * COEF_BR); // This is the old COEF_BR, mapping to (x-1, y+1)
          }
        }
      }
    }
  }
}

// Optimized Ordered Dithering Algorithm
function orderedDither(data: Uint8ClampedArray, w: number, h: number, threshold: number): void {
  const thresholdAdjust = threshold / 128; // Normalize threshold effect
  const matrix = BAYER_4X4; // Using 4x4 for general ordered dither
  const n = 4;
  const nSq = n * n; // Pre-calculate n*n

  // Cache (255 / (n*n))
  const matrixScale = 255 / nSq;

  for (let i = 0; i < data.length; i += 4) {
    const x = (i / 4) % w;
    const y = Math.floor((i / 4) / w);

    // Optimized grayscale conversion
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const matrixThreshold = (matrix[y % n][x % n] + 0.5) * matrixScale * thresholdAdjust;

    const value = gray < matrixThreshold ? 0 : 255;
    data[i] = data[i + 1] = data[i + 2] = value;
  }
}

// Optimized Bayer 2x2 Dithering Algorithm
function bayer2x2Dither(data: Uint8ClampedArray, w: number, h: number, threshold: number): void {
  const thresholdAdjust = threshold / 128;
  const matrix = BAYER_2X2;
  const n = 2;
  const nSq = n * n;
  const matrixScale = 255 / nSq;

  // Process 2x2 blocks at a time where possible
  for (let y = 0; y < h; y += n) {
    for (let x = 0; x < w; x += n) {
      // Process up to 4 pixels at once in a 2x2 block
      for (let dy = 0; dy < n && y + dy < h; dy++) {
        for (let dx = 0; dx < n && x + dx < w; dx++) {
          const idx = ((y + dy) * w + (x + dx)) * 4;
          const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          const matrixThreshold = (matrix[dy][dx] + 0.5) * matrixScale * thresholdAdjust;

          const value = gray < matrixThreshold ? 0 : 255;
          data[idx] = data[idx + 1] = data[idx + 2] = value;
        }
      }
    }
  }
}

// Optimized Bayer 4x4 Dithering Algorithm
function bayer4x4Dither(data: Uint8ClampedArray, w: number, h: number, threshold: number): void {
  const thresholdAdjust = threshold / 128;
  const matrix = BAYER_4X4;
  const n = 4;
  const nSq = n * n;
  const matrixScale = 255 / nSq;

  // Process 4x4 blocks at a time where possible
  for (let y = 0; y < h; y += n) {
    for (let x = 0; x < w; x += n) {
      // Process pixels in a 4x4 block
      for (let dy = 0; dy < n && y + dy < h; dy++) {
        for (let dx = 0; dx < n && x + dx < w; dx++) {
          const idx = ((y + dy) * w + (x + dx)) * 4;
          const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          const matrixThreshold = (matrix[dy][dx] + 0.5) * matrixScale * thresholdAdjust;

          const value = gray < matrixThreshold ? 0 : 255;
          data[idx] = data[idx + 1] = data[idx + 2] = value;
        }
      }
    }
  }
}

// Optimized Halftone Pattern Dithering
function halftoneDither(data: Uint8ClampedArray, w: number, h: number, threshold: number): void {
  const patterns = HALFTONE_PATTERNS;
  const thresholdAdjust = threshold / 128; // Normalize threshold effect
  // Calculate effective range for pattern index once
  const effectivePatternRange = 255 / (4 * thresholdAdjust); // 4 dots in patterns, 255 gray levels

  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      // Calculate average gray value for this 2x2 block
      let totalGray = 0;
      let count = 0;

      // Pre-calculate indices for efficiency within the block
      const indices = [
        (y * w + x) * 4,        // Top-left
        (y * w + x + 1) * 4,    // Top-right
        ((y + 1) * w + x) * 4,  // Bottom-left
        ((y + 1) * w + x + 1) * 4 // Bottom-right
      ];

      // Only calculate for pixels that are in bounds
      for (let i = 0; i < 4; i++) {
        const dx = i % 2;
        const dy = Math.floor(i / 2);

        if (y + dy < h && x + dx < w) {
          const idx = indices[i];
          totalGray += 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          count++;
        }
      }

      const avgGray = count > 0 ? totalGray / count : 0;
      // Determine which pattern to use (0-4)
      const patternIdx = Math.min(4, Math.max(0, Math.floor(avgGray / effectivePatternRange)));
      const pattern = patterns[patternIdx];

      // Apply the pattern to the 2x2 block - only to pixels that are in bounds
      for (let i = 0; i < 4; i++) {
        const dx = i % 2;
        const dy = Math.floor(i / 2);

        if (y + dy < h && x + dx < w) {
          const idx = indices[i];
          const dotValue = pattern[i] ? 255 : 0;
          data[idx] = data[idx + 1] = data[idx + 2] = dotValue;
        }
      }
    }
  }
}

// Simple Threshold Dithering (Optimized)
function thresholdDither(data: Uint8ClampedArray, w: number, h: number, threshold: number): void {
  // Process 4 pixels at a time for better performance using loop unrolling
  const len = data.length;
  const limit = len - (len % 16); // Ensure we only process complete 4-pixel blocks (16 bytes)

  for (let i = 0; i < limit; i += 16) {
    // Process 4 pixels at once
    const gray1 = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const gray2 = 0.299 * data[i + 4] + 0.587 * data[i + 5] + 0.114 * data[i + 6];
    const gray3 = 0.299 * data[i + 8] + 0.587 * data[i + 9] + 0.114 * data[i + 10];
    const gray4 = 0.299 * data[i + 12] + 0.587 * data[i + 13] + 0.114 * data[i + 14];

    data[i] = data[i + 1] = data[i + 2] = gray1 < threshold ? 0 : 255;
    data[i + 4] = data[i + 5] = data[i + 6] = gray2 < threshold ? 0 : 255;
    data[i + 8] = data[i + 9] = data[i + 10] = gray3 < threshold ? 0 : 255;
    data[i + 12] = data[i + 13] = data[i + 14] = gray4 < threshold ? 0 : 255;
  }

  // Handle remaining pixels (less than 4)
  for (let i = limit; i < len; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = data[i + 1] = data[i + 2] = gray < threshold ? 0 : 255;
  }
}