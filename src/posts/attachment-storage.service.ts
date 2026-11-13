import { BadGatewayException, Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryService } from '../users/cloudinary.service';
import type { UploadedAttachment } from './types/uploaded-attachment';

@Injectable()
export class AttachmentStorageService {
  constructor(private readonly images: CloudinaryService) {}

  async upload(
    file: UploadedAttachment,
    type: 'image' | 'document',
    publicId: string,
  ) {
    this.images.assertConfigured();
    // A stable identifier makes retries safe, including a lost provider response.
    return this.retry(
      async () =>
        new Promise<{ url: string; publicId: string }>((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              public_id: publicId,
              overwrite: true,
              resource_type: type === 'document' ? 'raw' : 'image',
              type: 'authenticated',
              timeout: 10000,
            },
            (error, result) => {
              if (error || !result || result.public_id !== publicId)
                reject(new Error('Upload failed'));
              else
                resolve({ url: result.secure_url, publicId: result.public_id });
            },
          );
          stream.on('error', reject);
          stream.end(file.buffer);
        }),
    );
  }

  async delete(publicId: string, type: string, delivery = 'upload') {
    return this.retry(async () => {
      const options = {
        resource_type:
          type === 'document' ? ('raw' as const) : ('image' as const),
        type: delivery,
        invalidate: true,
        timeout: 10000,
      };
      const result = (await cloudinary.uploader.destroy(publicId, options)) as {
        result?: string;
      };
      if (result.result !== 'ok' && result.result !== 'not found')
        throw new Error('Deletion failed');
    });
  }

  async read(publicId: string, type: string, mime: string) {
    this.images.assertConfigured();
    const url = cloudinary.utils.private_download_url(
      publicId,
      type === 'document' ? '' : mime === 'image/png' ? 'png' : 'jpg',
      {
        resource_type: type === 'document' ? 'raw' : 'image',
        type: 'authenticated',
        expires_at: Math.floor(Date.now() / 1000) + 60,
        attachment: true,
      },
    );
    try {
      // Signed provider URLs never reach the browser or logs. No redirects/SSRF.
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
        cache: 'no-store',
      });
      if (!response.ok || !response.body) throw new Error();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength;
        if (size > 10 * 1024 * 1024) throw new Error();
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch {
      throw new BadGatewayException('Unable to retrieve the resource');
    }
  }

  private async retry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await operation();
      } catch {
        if (attempt === 2)
          throw new BadGatewayException('Media storage unavailable');
        await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
      }
    }
    throw new BadGatewayException('Media storage unavailable');
  }
}
