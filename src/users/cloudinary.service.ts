import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor(config: ConfigService) {
    cloudinary.config({
      cloud_name: config.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: config.get<string>('CLOUDINARY_API_KEY'),
      api_secret: config.get<string>('CLOUDINARY_API_SECRET'),
      secure: true,
    });
  }

  async uploadImage(
    file: { buffer: Buffer },
    folder = 'profiles',
  ): Promise<{ url: string; publicId: string }> {
    try {
      return await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder, resource_type: 'image' },
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
      });
    } catch {
      throw new BadGatewayException(
        'Error communicating with the media storage service',
      );
    }
  }

  async deleteAsset(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch {
      this.logger.warn('Could not delete the previous media asset');
    }
  }
}
