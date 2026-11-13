import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private readonly configured: boolean;

  constructor(config: ConfigService) {
    const credentials = {
      cloud_name: config.get<string>('CLOUDINARY_CLOUD_NAME')?.trim(),
      api_key: config.get<string>('CLOUDINARY_API_KEY')?.trim(),
      api_secret: config.get<string>('CLOUDINARY_API_SECRET')?.trim(),
    };
    this.configured = Object.values(credentials).every(Boolean);
    cloudinary.config({
      ...credentials,
      secure: true,
    });
  }

  async uploadImage(
    file: { buffer: Buffer },
    folder = 'profiles',
  ): Promise<{ url: string; publicId: string }> {
    this.assertConfigured();
    try {
      return await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder, resource_type: 'image', timeout: 10000 },
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
      this.logger.warn('Media image upload failed');
      throw new BadGatewayException({
        statusCode: 502,
        error: 'MediaStorageUnavailable',
        message: 'The media storage service could not save the image',
      });
    }
  }

  assertConfigured(): void {
    if (!this.configured) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'MediaStorageNotConfigured',
        message: 'The media storage service is not configured',
      });
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
