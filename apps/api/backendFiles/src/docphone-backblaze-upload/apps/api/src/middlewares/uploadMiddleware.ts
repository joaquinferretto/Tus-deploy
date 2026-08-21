/**
 * File upload middleware using Multer with Sharp image compression
 * Enforces file size limits: 20MB audio, 15MB image
 */

import multer from 'multer';
import sharp from 'sharp';
import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler.js';

// Configure Multer for memory storage (we'll process files before saving)
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB max (for audio files)
  },
  fileFilter: (req, file, cb) => {
    // Validate audio file
    if (file.fieldname === 'audio') {
      const allowedAudioTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/m4a', 'audio/ogg', 'audio/webm'];
      if (!allowedAudioTypes.includes(file.mimetype)) {
        return cb(new AppError('Invalid audio file type', 400, 'INVALID_AUDIO_TYPE'));
      }
    }

    // Validate image file
    if (file.fieldname === 'image') {
      const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (!allowedImageTypes.includes(file.mimetype)) {
        return cb(new AppError('Invalid image file type', 400, 'INVALID_IMAGE_TYPE'));
      }
    }

    // Validate generic 'file' (could be audio or image)
    if (file.fieldname === 'file') {
      const allowedTypes = [
        'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/m4a', 'audio/ogg', 'audio/webm',
        'image/jpeg', 'image/jpg', 'image/png', 'image/webp'
      ];
      if (!allowedTypes.includes(file.mimetype)) {
        return cb(new AppError('Invalid file type', 400, 'INVALID_FILE_TYPE'));
      }
    }

    cb(null, true);
  },
});

/**
 * Multer upload configuration for report creation
 * Accepts 'audio' (required) and 'image' (optional) fields
 */
export const uploadFiles = upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'images', maxCount: 10 },
  { name: 'image', maxCount: 10 },
  { name: 'file', maxCount: 1 },
]);

/**
 * Image compression middleware using Sharp
 * Compresses images > 2MB to ensure they stay under 15MB limit
 */
export async function compressImage(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

    const imageFiles = [
      ...(files?.images ?? []),
      ...(files?.image ?? []),
    ];

    if (imageFiles.length === 0) {
      // No image uploaded, skip compression
      return next();
    }

    for (const imageFile of imageFiles) {
      const imageSizeInMB = imageFile.size / (1024 * 1024);

      // Check if image exceeds 15MB hard limit before compression
      if (imageSizeInMB > 15) {
        throw new AppError(
          'Image file size exceeds 15MB limit',
          413,
          'IMAGE_TOO_LARGE'
        );
      }

      // Compress if > 2MB
      if (imageSizeInMB > 2) {
        console.log(`[upload] Compressing image: ${imageSizeInMB.toFixed(2)}MB`);

        const compressedBuffer = await sharp(imageFile.buffer)
          .jpeg({ quality: 80, progressive: true }) // Convert to JPEG with 80% quality
          .toBuffer();

        // Update file buffer and size
        imageFile.buffer = compressedBuffer;
        imageFile.size = compressedBuffer.length;
        imageFile.mimetype = 'image/jpeg';

        const newSizeInMB = imageFile.size / (1024 * 1024);
        console.log(`[upload] Image compressed to: ${newSizeInMB.toFixed(2)}MB`);

        // Verify compressed image is still under 15MB
        if (newSizeInMB > 15) {
          throw new AppError(
            'Image file too large even after compression',
            413,
            'IMAGE_TOO_LARGE'
          );
        }
      }
    }

    next();
  } catch (error) {
    next(error);
  }
}
