import { BadGatewayException, Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryService } from '../users/cloudinary.service';

@Injectable()
export class AttachmentStorageService {
  constructor(private readonly images: CloudinaryService) {}

  async upload(file: Express.Multer.File, type: 'image' | 'document') {
    if (type === 'image') return this.images.uploadImage(file, 'posts');
    try {
      return await new Promise<{ url: string; publicId: string }>(
        (resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: 'posts', resource_type: 'raw' },
            (error, result) => {
              if (error || !result) {
                reject(new Error(error?.message ?? 'No upload result'));
                return;
              }
              resolve({ url: result.secure_url, publicId: result.public_id });
            },
          );
          stream.on('error', reject);
          stream.end(file.buffer);
        },
      );
    } catch {
      throw new BadGatewayException('Unable to upload the attachment');
    }
  }

  async delete(publicId: string, type: 'image' | 'document' | 'link') {
    try {
      const result = (await cloudinary.uploader.destroy(publicId, {
        resource_type: type === 'document' ? 'raw' : 'image',
      })) as { result?: string };
      if (result.result !== 'ok' && result.result !== 'not found')
        throw new Error('Deletion failed');
    } catch {
      throw new BadGatewayException(
        'Unable to delete the attachment from storage',
      );
    }
  }
}
