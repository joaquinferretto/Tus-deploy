import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import {
  IMAGE_MANAGER_ERROR_KIND,
  type BuildImageUploadFormDataInput,
  type ImageAsset,
  type ImageCompressionOptions,
  type ImageManager,
  type ImageManagerError,
  type ImageManagerResult,
  type ImagePermissionResult,
  type PickImageOptions,
  type PreparedImageAsset,
  type UploadFilePart,
} from '@core/domain';

const DEFAULT_ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const DEFAULT_IMAGE_NAME = 'upload.jpg';
const MIN_COMPRESSION_QUALITY = 0.35;
const COMPRESSION_STEP = 0.12;

export class ExpoImageManager implements ImageManager {
  async requestLibraryPermission(): Promise<ImageManagerResult<ImagePermissionResult>> {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      return {
        ok: true,
        value: {
          granted: permission.granted,
          canAskAgain: permission.canAskAgain,
        },
      };
    } catch (cause) {
      return failure({
        kind: IMAGE_MANAGER_ERROR_KIND.PERMISSION_DENIED,
        message: 'Unable to request media library permission.',
        retryable: true,
        cause,
      });
    }
  }

  async pickImage(options: PickImageOptions = {}): Promise<ImageManagerResult<ImageAsset>> {
    const permission = await this.requestLibraryPermission();
    if (!permission.ok) return permission;

    if (!permission.value.granted) {
      return failure({
        kind: IMAGE_MANAGER_ERROR_KIND.PERMISSION_DENIED,
        message: 'Media library access is required to select an image.',
        retryable: permission.value.canAskAgain,
      });
    }

    try {
      const pickerOptions: ImagePicker.ImagePickerOptions = {
        allowsEditing: options.allowsEditing ?? false,
        base64: false,
        exif: false,
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: options.quality ?? 0.92,
      };

      if (options.selectionLimit !== undefined) {
        pickerOptions.selectionLimit = options.selectionLimit;
      }

      const result = await ImagePicker.launchImageLibraryAsync(pickerOptions);
      if (result.canceled) {
        return failure({
          kind: IMAGE_MANAGER_ERROR_KIND.CANCELLED,
          message: 'Image selection was cancelled.',
          retryable: false,
        });
      }

      const firstAsset = result.assets[0];
      if (firstAsset === undefined) {
        return failure({
          kind: IMAGE_MANAGER_ERROR_KIND.CANCELLED,
          message: 'No image was selected.',
          retryable: false,
        });
      }

      const asset = toImageAsset(firstAsset);
      const validation = validateAsset(asset, {
        allowedMimeTypes: options.allowedMimeTypes ?? DEFAULT_ALLOWED_IMAGE_TYPES,
        maxBytes: options.maxBytes,
      });

      if (!validation.ok) return validation;
      return { ok: true, value: asset };
    } catch (cause) {
      return failure({
        kind: IMAGE_MANAGER_ERROR_KIND.UPLOAD_PAYLOAD_FAILED,
        message: 'Unable to open the image picker.',
        retryable: true,
        cause,
      });
    }
  }

  async compressImage(
    asset: ImageAsset,
    options: ImageCompressionOptions,
  ): Promise<ImageManagerResult<PreparedImageAsset>> {
    const validation = validateAsset(asset, {
      allowedMimeTypes: DEFAULT_ALLOWED_IMAGE_TYPES,
      maxBytes: options.maxBytes,
      allowUnknownSize: true,
    });
    if (!validation.ok) return validation;

    try {
      const target = calculateResize(asset, options.maxWidth, options.maxHeight);
      let quality = clampQuality(options.quality);
      let nextUri = asset.uri;
      let nextWidth = target.width;
      let nextHeight = target.height;
      let nextSize: number | undefined;
      let shouldContinue = true;

      while (shouldContinue) {
        const result = await manipulateAsync(
          asset.uri,
          [{ resize: { width: target.width, height: target.height } }],
          {
            base64: false,
            compress: quality,
            format: toSaveFormat(options.outputFormat ?? 'jpeg'),
          },
        );

        nextUri = result.uri;
        nextWidth = result.width;
        nextHeight = result.height;
        nextSize = await readFileSize(result.uri);

        shouldContinue =
          options.maxBytes !== undefined &&
          nextSize !== undefined &&
          nextSize > options.maxBytes &&
          quality > MIN_COMPRESSION_QUALITY;

        quality = Math.max(MIN_COMPRESSION_QUALITY, quality - COMPRESSION_STEP);
      }

      if (options.maxBytes !== undefined && nextSize !== undefined && nextSize > options.maxBytes) {
        return failure({
          kind: IMAGE_MANAGER_ERROR_KIND.FILE_TOO_LARGE,
          message: `Compressed image is ${nextSize} bytes, above ${options.maxBytes} bytes.`,
          retryable: false,
        });
      }

      const prepared: PreparedImageAsset = {
        ...asset,
        uri: nextUri,
        width: nextWidth,
        height: nextHeight,
        mimeType: toMimeType(options.outputFormat ?? 'jpeg'),
        fileName: withExtension(asset.fileName, options.outputFormat ?? 'jpeg'),
        originalUri: asset.uri,
      };

      if (nextSize !== undefined) prepared.fileSize = nextSize;
      if (asset.fileSize !== undefined && nextSize !== undefined && asset.fileSize > 0) {
        prepared.compressionRatio = Number((nextSize / asset.fileSize).toFixed(4));
      }

      return { ok: true, value: prepared };
    } catch (cause) {
      return failure({
        kind: IMAGE_MANAGER_ERROR_KIND.COMPRESSION_FAILED,
        message: 'Image compression failed without reading the file into JS memory.',
        retryable: true,
        cause,
      });
    }
  }

  buildUploadFormData(input: BuildImageUploadFormDataInput): ImageManagerResult<FormData> {
    try {
      const formData = new FormData();

      for (const field of input.fields ?? []) {
        formData.append(field.fieldName, field.value);
      }

      appendUriFile(formData, input.file);
      return { ok: true, value: formData };
    } catch (cause) {
      return failure({
        kind: IMAGE_MANAGER_ERROR_KIND.UPLOAD_PAYLOAD_FAILED,
        message: 'Unable to build multipart image payload.',
        retryable: false,
        cause,
      });
    }
  }

  async prefetch(uri: string): Promise<ImageManagerResult<boolean>> {
    try {
      return { ok: true, value: await Image.prefetch(uri) };
    } catch (cause) {
      return failure({
        kind: IMAGE_MANAGER_ERROR_KIND.UPLOAD_PAYLOAD_FAILED,
        message: 'Unable to prefetch image.',
        retryable: true,
        cause,
      });
    }
  }

  async clearCaches(): Promise<ImageManagerResult<void>> {
    try {
      await Promise.all([Image.clearMemoryCache(), Image.clearDiskCache()]);
      return { ok: true, value: undefined };
    } catch (cause) {
      return failure({
        kind: IMAGE_MANAGER_ERROR_KIND.UPLOAD_PAYLOAD_FAILED,
        message: 'Unable to clear image caches.',
        retryable: true,
        cause,
      });
    }
  }
}

export async function compressImageForUpload(
  manager: ImageManager,
  asset: ImageAsset,
  options: ImageCompressionOptions,
): Promise<ImageManagerResult<PreparedImageAsset>> {
  return manager.compressImage(asset, options);
}

export function buildStreamingImageFormData(
  input: BuildImageUploadFormDataInput,
): ImageManagerResult<FormData> {
  return new ExpoImageManager().buildUploadFormData(input);
}

function toImageAsset(asset: ImagePicker.ImagePickerAsset): ImageAsset {
  const fileName = asset.fileName ?? inferFileName(asset.uri, asset.mimeType);
  const imageAsset: ImageAsset = {
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
    mimeType: asset.mimeType ?? inferMimeType(fileName),
    fileName,
    source: 'library',
  };

  if (asset.fileSize !== undefined) imageAsset.fileSize = asset.fileSize;
  return imageAsset;
}

function validateAsset(
  asset: ImageAsset,
  options: {
    allowedMimeTypes: readonly string[];
    maxBytes: number | undefined;
    allowUnknownSize?: boolean;
  },
): ImageManagerResult<void> {
  if (!options.allowedMimeTypes.includes(asset.mimeType)) {
    return failure({
      kind: IMAGE_MANAGER_ERROR_KIND.INVALID_TYPE,
      message: `Image type ${asset.mimeType} is not allowed.`,
      retryable: false,
    });
  }

  if (
    options.maxBytes !== undefined &&
    asset.fileSize !== undefined &&
    asset.fileSize > options.maxBytes
  ) {
    return failure({
      kind: IMAGE_MANAGER_ERROR_KIND.FILE_TOO_LARGE,
      message: `Image is ${asset.fileSize} bytes, above ${options.maxBytes} bytes.`,
      retryable: false,
    });
  }

  if (options.maxBytes !== undefined && asset.fileSize === undefined && options.allowUnknownSize !== true) {
    return failure({
      kind: IMAGE_MANAGER_ERROR_KIND.FILE_TOO_LARGE,
      message: 'Image size is unknown and cannot be validated before upload.',
      retryable: true,
    });
  }

  return { ok: true, value: undefined };
}

function appendUriFile(formData: FormData, file: UploadFilePart): void {
  const uriBackedFile = {
    uri: file.uri,
    name: file.name,
    type: file.type,
  } as unknown as Blob;

  formData.append(file.fieldName, uriBackedFile);
}

function calculateResize(
  asset: ImageAsset,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const ratio = Math.min(maxWidth / asset.width, maxHeight / asset.height, 1);
  return {
    width: Math.max(1, Math.round(asset.width * ratio)),
    height: Math.max(1, Math.round(asset.height * ratio)),
  };
}

async function readFileSize(uri: string): Promise<number | undefined> {
  const info = await FileSystem.getInfoAsync(uri);
  if (info.exists !== true) return undefined;

  const maybeSize = (info as { size?: unknown }).size;
  return typeof maybeSize === 'number' ? maybeSize : undefined;
}

function clampQuality(quality: number): number {
  return Math.min(1, Math.max(MIN_COMPRESSION_QUALITY, quality));
}

function toSaveFormat(format: ImageCompressionOptions['outputFormat']): SaveFormat {
  if (format === 'png') return SaveFormat.PNG;
  if (format === 'webp') return SaveFormat.WEBP;
  return SaveFormat.JPEG;
}

function toMimeType(format: NonNullable<ImageCompressionOptions['outputFormat']>): string {
  if (format === 'png') return 'image/png';
  if (format === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function withExtension(fileName: string, format: NonNullable<ImageCompressionOptions['outputFormat']>): string {
  const extension = format === 'jpeg' ? 'jpg' : format;
  return fileName.replace(/\.[a-z0-9]+$/i, `.${extension}`);
}

function inferFileName(uri: string, mimeType?: string): string {
  const fallbackExtension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  return uri.split('/').pop() ?? DEFAULT_IMAGE_NAME.replace(/jpg$/, fallbackExtension);
}

function inferMimeType(fileName: string): string {
  if (/\.png$/i.test(fileName)) return 'image/png';
  if (/\.webp$/i.test(fileName)) return 'image/webp';
  return 'image/jpeg';
}

function failure<TValue>(error: ImageManagerError): ImageManagerResult<TValue> {
  return { ok: false, error };
}
