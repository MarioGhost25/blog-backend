import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryService } from './cloudinary.service';

describe('Cloudinary configuration', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rejects missing credentials before contacting storage without exposing values', async () => {
    const upload = jest.spyOn(cloudinary.uploader, 'upload_stream');
    const service = new CloudinaryService(new ConfigService({}));
    try {
      await service.uploadImage({ buffer: Buffer.from('synthetic') });
      throw new Error('Expected unavailable storage');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getResponse()).toEqual({
        statusCode: 503,
        error: 'MediaStorageNotConfigured',
        message: 'The media storage service is not configured',
      });
    }
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects partial or blank credentials and accepts complete configuration', () => {
    const partial = new CloudinaryService(
      new ConfigService({
        CLOUDINARY_CLOUD_NAME: 'synthetic',
        CLOUDINARY_API_KEY: 'synthetic',
        CLOUDINARY_API_SECRET: ' ',
      }),
    );
    expect(() => partial.assertConfigured()).toThrow(
      ServiceUnavailableException,
    );
    const configured = new CloudinaryService(
      new ConfigService({
        CLOUDINARY_CLOUD_NAME: 'synthetic',
        CLOUDINARY_API_KEY: 'synthetic',
        CLOUDINARY_API_SECRET: 'synthetic',
      }),
    );
    expect(() => configured.assertConfigured()).not.toThrow();
  });
});
