export const IMAGE_MANAGER_ERROR_KIND = {
  PERMISSION_DENIED: 'permission_denied',
  CANCELLED: 'cancelled',
  INVALID_TYPE: 'invalid_type',
  FILE_TOO_LARGE: 'file_too_large',
  COMPRESSION_FAILED: 'compression_failed',
  UPLOAD_PAYLOAD_FAILED: 'upload_payload_failed',
} as const;

export type ImageManagerErrorKind =
  (typeof IMAGE_MANAGER_ERROR_KIND)[keyof typeof IMAGE_MANAGER_ERROR_KIND];

export interface ImageManagerError {
  kind: ImageManagerErrorKind;
  message: string;
  retryable: boolean;
  cause?: unknown;
}

export interface ImagePermissionResult {
  granted: boolean;
  canAskAgain: boolean;
}

export interface ImageAsset {
  uri: string;
  width: number;
  height: number;
  mimeType: string;
  fileName: string;
  fileSize?: number;
  source: 'library' | 'camera' | 'remote';
}

export interface PickImageOptions {
  allowsEditing?: boolean;
  quality?: number;
  selectionLimit?: number;
  maxBytes?: number;
  allowedMimeTypes?: readonly string[];
}

export interface ImageCompressionOptions {
  maxWidth: number;
  maxHeight: number;
  quality: number;
  maxBytes?: number;
  outputFormat?: 'jpeg' | 'png' | 'webp';
}

export interface PreparedImageAsset extends ImageAsset {
  originalUri: string;
  compressionRatio?: number;
}

export interface UploadFilePart {
  fieldName: string;
  uri: string;
  name: string;
  type: string;
}

export interface UploadFieldPart {
  fieldName: string;
  value: string;
}

export interface BuildImageUploadFormDataInput {
  file: UploadFilePart;
  fields?: readonly UploadFieldPart[];
}

export type ImageManagerResult<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; error: ImageManagerError };

export interface ImageManager {
  requestLibraryPermission(): Promise<ImageManagerResult<ImagePermissionResult>>;
  pickImage(options?: PickImageOptions): Promise<ImageManagerResult<ImageAsset>>;
  compressImage(
    asset: ImageAsset,
    options: ImageCompressionOptions,
  ): Promise<ImageManagerResult<PreparedImageAsset>>;
  buildUploadFormData(input: BuildImageUploadFormDataInput): ImageManagerResult<FormData>;
  prefetch(uri: string): Promise<ImageManagerResult<boolean>>;
  clearCaches(): Promise<ImageManagerResult<void>>;
}
